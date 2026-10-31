import Aven.Peer
import Lean.Data.Json

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes Aven.Peer's examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`.

- `topics.json`: an epoch's key and its Doc's gossip topic (`topic`), in hex.
- `doc-sync.json`: generated worlds of two readers. Each world is entries (an envelope as sync reads it: its name, its
  writer, its place, `prev` and `deps`, by name) and which of them each reader holds, each a version; expected are each
  reader's tips, what each answers the other's tips with (`beyond`), whether each holds a split in each writer's log,
  and what each holds after one exchange. Splits are common: one entry in eight is a second one at its log's newest
  place.

- `presence.json`: connections joining and leaving; what every peer is told after each (`Aven.Peer.Presence`).
- `wire.json`: greeting lines, and the greeting each is or none (`Aven.Peer.Wire.Greeting`).
- `frames.json`: streams as chunks of hex: the greeting read, the frames each chunk completes in Core's CBOR, and the
  error that ends it (`Aven.Peer.WireCbor`, A29). A line's bytes are hex in the readable form.
- `upgrades.json`: a peer's wire version and the version a hello names; its answer (none, or `update` and its own
  version) and whether the hello's peer follows that refusal; and the gossip topic's name for a wire version and a
  network (`Aven.Peer.Wire`, "The wire version").
- `notices.json`: notices as entries of their signers' logs, and the newest of each kind about each device, in several
  orders; beats and the newest of each (`Aven.Peer.Notices`, A193). `catchup.json`: sources offered against a signed
  log tip, the one chosen and the ones caught, and presence from signed beats (`Aven.Peer.CatchUp`). `failures.json`:
  the nine checks the box runs with the Aven Peer stopped, each with what the models say it must see
  (`Aven.Peer.Failures`, PEERS.md).
-/

open Lean Aven.Core Aven.Core.Past Aven.Peer.DocSync Aven.Peer

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
  keys.zipIdx.map fun (k, i) =>
    vector s!"epoch key {i + 1}" (Json.mkObj [("key", hex k)]) (Json.mkObj [("topic", hex (topic k))])

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
        ("aAnswersB", names toB), ("bAnswersA", names toA),
        ("splitA", splits A all), ("splitB", splits B all),
        ("heldA", toJson (held (A ++ toA)).length), ("heldB", toJson (held (B ++ toB)).length)])

/-- `n` draws from `f`. -/
def Rng.many {α : Type} (r : Rng) (n : Nat) (f : Rng → α × Rng) : List α × Rng := Id.run do
  let mut r := r
  let mut out := #[]
  for _ in [0:n] do
    let (a, r') := f r
    out := out.push a
    r := r'
  return (out.toList, r)

def generated : Nat := 60

/-! ## Presence -/

def presenceVector (name : String) (cs : List Change) : Json :=
  vector name (Json.mkObj [("changes", Json.arr (cs.map Change.json).toArray)])
    (Json.arr ((trail Presence.step Presence.empty cs).map fun p => toJson p.told).toArray)

def randomChanges (seed : Nat) : List Change := Id.run do
  let (len, r) := (Rng.seed seed).below 60
  let (cs, _) := r.many len fun r =>
    let (j, r) := r.below 3
    let (p, r) := r.below 6
    ((if j ≠ 0 then .join p else .leave p), r)
  return cs

def presence : List Json :=
  presenceExamples.map (fun (name, cs, _) => presenceVector name cs) ++
  (List.range generated).map fun i => presenceVector s!"seed {i + 1}" (randomChanges (i + 1))

/-! ## The wire -/

def WireError.name : WireError → String
  | .bad => "bad"
  | .tooLong => "tooLong"

/-- A frame in the vectors' readable form: its Value's keys as JSON, a line's bytes in hex. -/
def Frame.json : Frame → Json
  | .presence ps => Json.mkObj [("frame", "presence"), ("peers", toJson ps)]
  | .beat n => Json.mkObj [("frame", "beat"), ("n", toJson n)]
  | .claim st => Json.mkObj [("frame", "claim"), ("statement", st)]
  | .signIn st => Json.mkObj [("frame", "sign_in"), ("statement", st)]
  | .invite st => Json.mkObj [("frame", "invite"), ("statement", st)]
  | .withdraw st => Json.mkObj [("frame", "withdraw"), ("statement", st)]
  | .join st => Json.mkObj [("frame", "join"), ("statement", st)]
  | .network c t st => Json.mkObj [("frame", "network"), ("claimed", toJson c), ("tree", toJson t),
      ("statements", toJson st)]
  | .refused w => Json.mkObj [("frame", "refused"), ("why", w)]
  | .heads hs more => Json.mkObj [("frame", "heads"), ("heads", toJson hs), ("more", toJson more)]
  | .catchUp hs only => Json.mkObj [("frame", "catch_up"), ("have", toJson hs), ("only", toJson only)]
  | .lines ls => Json.mkObj [("frame", "lines"), ("lines", toJson (ls.map Aven.Core.hex))]
  | .kept fs => Json.mkObj [("frame", "kept"), ("files", toJson fs)]

/-- The greetings: a line, and the greeting it is, or none. -/
def wire : List Json :=
  let lines : List (String × String) := [
    ("a hello", (Greeting.hello "alice-peer" wireVersion).json.compress),
    ("an update", (Greeting.update wireVersion).json.compress),
    ("a hello of version 1", (Greeting.hello "alice-peer" 1).json.compress),
    ("a hello without its version, as version 0 sent it", "{\"frame\":\"hello\",\"peer\":\"a\"}"),
    ("a hello with a key extra", "{\"frame\":\"hello\",\"peer\":\"a\",\"wire\":2,\"x\":1}"),
    ("a hello whose version is text", "{\"frame\":\"hello\",\"peer\":\"a\",\"wire\":\"2\"}"),
    ("an update without its version", "{\"frame\":\"update\"}"),
    ("a frame, which is no greeting", "{\"frame\":\"beat\",\"n\":1}"),
    ("not JSON", "nope")]
  lines.map fun (name, line) =>
    vector name (Json.mkObj [("line", line)]) ((Greeting.parse line).elim Json.null Greeting.json)

open WireCbor in
/-- Streams as hex: the greeting read, the frames each chunk completes, and the error that ends it. -/
def frames : List Json :=
  let hello := greetingBytes (.hello "alice-peer" wireVersion)
  let result (chunks : List (List UInt8)) := let (g, fs, err) := WireCbor.read chunks
    Json.mkObj [("greeting", g.elim Json.null Greeting.json),
      ("frames", Json.arr (fs.map fun f => Json.arr (f.map Frame.json).toArray).toArray),
      ("error", toJson (err.map WireError.name))]
  let one (name : String) (chunks : List (List UInt8)) :=
    vector name (Json.mkObj [("chunks", toJson (chunks.map Aven.Core.hex))]) (result chunks)
  (frameExamples.map fun f => one s!"a frame: {(Frame.json f).compress}" [hello ++ frameBytes f]) ++
  [one "every frame, the greeting in a chunk of its own" [hello, bytesOf frameExamples],
   one "cut in the greeting and in a frame" [hello.take 9, hello.drop 9 ++ (bytesOf (frameExamples.take 2)).take 5,
     (bytesOf (frameExamples.take 2)).drop 5],
   one "an update, and nothing after it" [greetingBytes (.update wireVersion)],
   one "version 0's hello, without its version" [Aven.Core.text "{\"frame\":\"hello\",\"peer\":\"a\"}\n"],
   one "a greeting past the limit, without its newline" [List.replicate (maxFrame + 1) 0x61],
   one "a key missing" [hello ++ framed (obj [("frame", txt "heads"), ("heads", .array [])])],
   one "a key extra" [hello ++ framed (obj [("n", .uint 1), ("extra", .null), ("frame", txt "beat")])],
   one "a key of the wrong kind" [hello ++ framed (obj [("n", txt "1"), ("frame", txt "beat")])],
   one "a line as text, not bytes" [hello ++ framed (obj [("frame", txt "lines"), ("lines", .array [txt "x"])])],
   one "a frame no peer sends" [hello ++ framed (obj [("frame", txt "shout")])],
   one "a number longer than it needs" [hello ++ Aven.Core.be 4 4 ++ [0xA1, 0x61, 0x6E, 0x18]],
   one "a length of none" [hello ++ [0, 0, 0, 0]],
   one "a length over the limit" [hello ++ Aven.Core.be 4 (maxFrame + 1)],
   one "a frame half in" [hello ++ (frameBytes (.beat 7)).take 6]]

def upgrades : List Json :=
  (meetExamples.map fun (name, mine, theirs) =>
    vector name (Json.mkObj [("mine", toJson mine), ("theirs", toJson theirs)])
      (Json.mkObj [("answer", match meet mine theirs with | some f => f.json | none => Json.null),
        ("follows", toJson (follows theirs mine))])) ++
  ([(wireVersion, "aven"), (wireVersion, "maia.city"), (3, "aven")].map fun (w, n) =>
    vector s!"the topic of {n} on wire {w}" (Json.mkObj [("wire", toJson w), ("network", toJson n)])
      (Json.mkObj [("topic", toJson (topicName w n))]))

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def write (dir : System.FilePath) (file : String) (vs : List Json) : IO Unit :=
  IO.FS.writeFile (dir / file) (String.join (vs.map fun v => v.compress ++ "\n"))

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  write dir "topics.json" topics
  write dir "doc-sync.json" syncVectors
  for (file, vs) in [("presence.json", presence), ("wire.json", wire), ("frames.json", frames),
      ("upgrades.json", upgrades), ("notices.json", NoticesJson.noticeVectors),
      ("catchup.json", NoticesJson.catchUpVectors), ("failures.json", Failures.failureVectors)] do
    IO.FS.writeFile (dir / file) (render vs)