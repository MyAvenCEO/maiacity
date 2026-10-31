import Aven.Peer
import Lean.Data.Json

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes Aven.Peer's examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`.

- `topics.json`: a group's epoch key and a wire version, and the group's gossip topic (`groupTopic`), in hex.
- `live.json`: sealed envelopes of sizes about the gossip limit: what a writer gossips for each (`Live.of`) and its
  bytes, in hex; a version message; and messages a reader refuses, `expected` null.
- `doc-sync.json`: generated worlds of two readers. Each world is entries (an envelope as sync reads it: its name, its
  writer, its place, `prev` and `deps`, by name) and which of them each reader holds, each a version; expected are each
  reader's tips and its version (`version`), what each answers the other's tips with (`beyond`), whether each holds a
  split in each writer's log, and what each holds after one exchange. Splits are common: one entry in eight is a second one at its log's newest
  place.
-/

open Lean Aven.Core Aven.Core.Past Aven.Peer.DocSync

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

/-- xorshift64, as the Rust property tests draw: the same file on every run. -/
structure Rng where
  s : UInt64

def Rng.seed (n : Nat) : Rng := ⟨(n.toUInt64 * 0x9e3779b97f4a7c15) ||| 1⟩

def Rng.below (r : Rng) (n : Nat) : Nat × Rng :=
  let x := r.s ^^^ (r.s <<< 13)
  let x := x ^^^ (x >>> 7)
  let x := x ^^^ (x <<< 17)
  (x.toNat % n, ⟨x⟩)

/-! ## Topics -/

def keys : List Bytes :=
  [List.replicate 32 0, List.replicate 32 255, (List.range 32).map Nat.toUInt8, (blake3 [1, 2, 3]).bytes]

def topics : List Json :=
  (keys.zipIdx.flatMap fun (k, i) => [3, 4].map fun w => (k, i, w)).map fun (k, i, w) =>
    vector s!"epoch key {i + 1}, wire {w}" (Json.mkObj [("key", hex k), ("wire", toJson w)])
      (Json.mkObj [("topic", hex (groupTopic w k).bytes)])

/-! ## What a topic carries -/

/-- The Doc the live vectors name. -/
def liveDoc : Hash := blake3 [1]

def liveVectors : List Json :=
  ([0, 1, 100, 4085, 4086, 70000].map fun n =>
    let b := (List.range n).map Nat.toUInt8
    let l := Live.of liveDoc b
    vector s!"a sealed envelope of {n} bytes" (Json.mkObj [("sealed", hex b)])
      (Json.mkObj [("kind", match l with | .sealed _ => "sealed" | .hash _ _ => "hash" | .version _ _ => "version"),
        ("bytes", hex (encode l.value))])) ++
  [vector "a version" (Json.mkObj [("doc", hex liveDoc.bytes), ("version", hex (blake3 [2]).bytes)])
    (Json.mkObj [("kind", "version"), ("bytes", hex (encode (Live.version liveDoc (blake3 [2])).value))])] ++
  ([("a hash of 31 bytes", Value.map [(text "doc", .bytes liveDoc.bytes), (text "hash", .bytes (List.replicate 31 1))]),
    ("a hash without its Doc", .map [(text "hash", .bytes liveDoc.bytes)]),
    ("another key", .map [(text "line", .bytes [1])]),
    ("a key extra", .map [(text "sealed", .bytes [1]), (text "x", .null)]),
    ("text, not bytes", .map [(text "sealed", .text (text "a"))])].map fun (name, v) =>
    vector name (Json.mkObj [("bytes", hex (encode v))]) Json.null)

/-! ## Sync between two readers -/

def Entry.json (x : Entry) : Json :=
  Json.mkObj [("name", x.name.text), ("writer", toJson x.writer), ("seq", toJson x.seq),
    ("prev", match x.prev with | some p => toJson p.text | none => Json.null),
    ("deps", toJson (x.deps.map Hash.text))]

def Tip.json (t : Tip) : Json :=
  Json.mkObj [("writer", toJson t.writer), ("seq", toJson t.seq), ("name", t.name.text)]

/-- A world: entries in order, each building only on earlier ones, in up to three writers' logs. -/
def Rng.entries (r : Rng) : List Entry × Rng := Id.run do
  let (count, r) := r.below 14
  let mut r := r
  let mut all : Array Entry := #[]
  for i in [0:count + 1] do
    let (w, r1) := r.below 3
    let (splitHere, r2) := r1.below 8
    let (nd, r3) := r2.below 3
    r := r3
    let mine := all.toList.filter (·.writer == w + 1)
    let last := mine.getLast?
    -- a second envelope at the newest place of its log, beside the one there: a split
    let (seq, prev) := match last, splitHere with
      | some l, 0 => (l.seq, l.prev)
      | some l, _ => (l.seq + 1, some l.name)
      | none, _ => (1, none)
    let mut deps := #[]
    for _ in [0:nd] do
      let (j, r') := r.below (all.size + 1)
      r := r'
      if h : j < all.size then
        let d := all[j].name
        if all[j].writer != w + 1 && !deps.contains d then deps := deps.push d
    all := all.push ⟨blake3 [i.toUInt8, 0x5c], w + 1, seq, prev, deps.toList⟩
  return (all.toList, r)

/-- A reader's holdings: the entries it picked and everything they build on, so it holds a version. -/
def Rng.reader (r : Rng) (all : List Entry) : List Bool × Rng := Id.run do
  let mut r := r
  let mut picked := #[]
  for _ in all do
    let (p, r') := r.below 3
    r := r'
    picked := picked.push (p == 0)
  -- down from the newest: whatever a held entry builds on is held
  let mut held := picked
  for i in (List.range all.length).reverse do
    if held[i]! then
      let ps := parents all[i]!
      for j in [0:all.length] do
        if ps.contains all[j]!.name then held := held.set! j true
  return (held.toList, r)

def pick (all : List Entry) (hs : List Bool) : List Entry :=
  (all.zip hs).filterMap fun (x, h) => if h then some x else none

def names (xs : List Entry) : Json := toJson (xs.map fun x => x.name.text)

def writers (all : List Entry) : List Nat := (all.map (·.writer)).eraseDups

def splits (S : List Entry) (all : List Entry) : Json :=
  Json.mkObj ((writers all).map fun w => (toString w, toJson (split S w)))

def syncVectors : List Json :=
  (List.range 60).map fun i =>
    let (all, r) := (Rng.seed (3000 + i)).entries
    let (ha, r) := r.reader all
    let (hb, _) := r.reader all
    let A := pick all ha
    let B := pick all hb
    let toB := beyond A (tips B)
    let toA := beyond B (tips A)
    vector s!"world {i + 1}"
      (Json.mkObj [("entries", Json.arr (all.map Entry.json).toArray), ("a", toJson ha), ("b", toJson hb)])
      (Json.mkObj [("tipsA", Json.arr ((tips A).map Tip.json).toArray),
        ("tipsB", Json.arr ((tips B).map Tip.json).toArray),
        ("versionA", (version (tips A)).text), ("versionB", (version (tips B)).text),
        ("aAnswersB", names toB), ("bAnswersA", names toA),
        ("splitA", splits A all), ("splitB", splits B all),
        ("heldA", toJson (held (A ++ toA)).length), ("heldB", toJson (held (B ++ toB)).length)])

def write (dir : System.FilePath) (file : String) (vs : List Json) : IO Unit :=
  IO.FS.writeFile (dir / file) (String.join (vs.map fun v => v.compress ++ "\n"))

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  write dir "topics.json" topics
  write dir "live.json" liveVectors
  write dir "doc-sync.json" syncVectors
