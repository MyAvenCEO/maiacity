import Aven.Peer
import Lean.Data.Json

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes Aven.Peer's examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`.

- `topics.json`: a group's epoch key and a wire version, and the group's gossip topic (`groupTopic`), in hex.
- `live.json`: sealed envelopes of sizes about the gossip limit: what a writer gossips for each (`Live.of`) and its
  bytes, in hex; a version message; and messages a reader refuses, `expected` null.
- `judge.json`: pages that crashed the docs worker, and which of their envelopes crash it alone (after given ones
  went through, or whatever went before); expected, what sifting marks unfit (`Aven.Peer.Judge.sift`).
- `doc-sync.json`: generated worlds of two readers. Each world is entries (an envelope as sync reads it: its name, its
  writer, its place, `prev` and `deps`, by name) and which of them each reader holds, each a version; expected are each
  reader's tips and its version (`version`), what each answers the other's tips with (`beyond`), whether each holds a
  split in each writer's log, and what each holds after one exchange. Splits are common: one entry in eight is a second one at its log's newest
  place.

- `presence.json`: connections joining and leaving; what every peer is told after each (`Aven.Peer.Presence`).
- `wire.json`: greeting lines, and the greeting each is or none (`Aven.Peer.Wire.Greeting`).
- `frames.json`: streams as chunks of hex: the greeting read, the frames each chunk completes in Core's CBOR, and the
  error that ends it (`Aven.Peer.WireCbor`, A29). A line's bytes are hex in the readable form.
- `upgrades.json`: a peer's wire version and the version a hello names; its answer (none, or `update` and its own
  version) and whether the hello's peer follows that refusal; and the gossip topic's name for a wire version and a
  network (`Aven.Peer.Wire`, "The wire version").
- `keeper.json`: uploads from devices to a keeper, one Doc, from an empty store; after each, the items held (number,
  hash, uploaders) and the next number, the pages of what came after each asked number, and where a device at that
  number holding 11 and 12 is after catching up, with what it holds (`Aven.Peer.Keeper`).
- `fetch.json`: what a peer holds for which Doc and each item's length, the Docs proven on a connection, a fetch; the
  answer (refused, or the hashes served, missing and later); and items' lengths with their parts' offsets and lengths
  (`Aven.Peer.Fetch`).
- `serve.json`: a gate's verdicts (which proof of which Doc it serves, for which vault; each vault's quota) and asks,
  each on its device's connection; the keeper's reply to each, and each vault's bill at the end (`Aven.Peer.Serve`).
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

/-! ## Sifting a page that crashed the judge -/

/-- A page of `n` envelopes; each of `kills` crashes the judge alone, and each `(e, after)` of `when` crashes it once
`after` went through. -/
structure Sifted where
  page : List Nat
  kills : List Nat
  when : List (Nat × Nat)

def Sifted.run (s : Sifted) (held : List Nat) (e : Nat) : Aven.Peer.Judge.Run :=
  if s.kills.contains e || s.when.any (fun (x, a) => x == e && held.contains a) then .crashed else .done

def sifts : List Sifted := [
  ⟨[1, 2, 3, 4, 5], [2], [(4, 3)]⟩,
  ⟨[1, 4, 3], [], [(4, 3)]⟩,
  ⟨[1, 2, 3], [], []⟩,
  ⟨[7], [7], []⟩,
  ⟨[], [], []⟩,
  ⟨[1, 2, 3, 4, 5, 6], [1, 6], [(3, 2), (5, 3)]⟩]

def judgeVectors : List Json :=
  sifts.zipIdx.map fun (s, i) =>
    vector s!"page {i + 1}"
      (Json.mkObj [("page", toJson s.page), ("kills", toJson s.kills),
        ("when", toJson (s.when.map fun (e, a) => [e, a]))])
      (Json.mkObj [("unfit", toJson (Aven.Peer.Judge.sift s.run [] s.page))])

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
def hx (b : Aven.Core.Bytes) : Json := Json.str (Aven.Core.hex b)

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
  | .prove d k sg => Json.mkObj [("frame", "prove"), ("doc", hx d), ("key", hx k), ("sig", hx sg)]
  | .proven d => Json.mkObj [("frame", "proven"), ("doc", hx d)]
  | .proveRefused d w => Json.mkObj [("frame", "prove_refused"), ("doc", hx d), ("why", w)]
  | .fetch d hs => Json.mkObj [("frame", "fetch"), ("doc", hx d), ("hashes", toJson (hs.map Aven.Core.hex))]
  | .items d h a t b => Json.mkObj [("frame", "items"), ("doc", hx d), ("hash", hx h), ("at", toJson a),
      ("total", toJson t), ("bytes", hx b)]
  | .missing d hs => Json.mkObj [("frame", "missing"), ("doc", hx d), ("hashes", toJson (hs.map Aven.Core.hex))]
  | .fetched d hs => Json.mkObj [("frame", "fetched"), ("doc", hx d), ("later", toJson (hs.map Aven.Core.hex))]
  | .fetchRefused d w => Json.mkObj [("frame", "fetch_refused"), ("doc", hx d), ("why", w)]
  | .keepAfter d n => Json.mkObj [("frame", "keep_after"), ("doc", hx d), ("n", toJson n)]
  | .keepArrived d es more => Json.mkObj [("frame", "keep_arrived"), ("doc", hx d),
      ("entries", Json.arr (es.map fun (n, h) => Json.mkObj [("n", toJson n), ("hash", hx h)]).toArray),
      ("more", toJson more)]
  | .keepPut d h t b cs => Json.mkObj [("frame", "keep_put"), ("doc", hx d), ("hash", hx h), ("total", toJson t),
      ("bytes", hx b), ("covers", toJson (cs.map Aven.Core.hex))]
  | .keepPart d h a t b => Json.mkObj [("frame", "keep_part"), ("doc", hx d), ("hash", hx h), ("at", toJson a),
      ("total", toJson t), ("bytes", hx b)]
  | .keepEnd d => Json.mkObj [("frame", "keep_end"), ("doc", hx d)]
  | .keepTook d es => Json.mkObj [("frame", "keep_took"), ("doc", hx d),
      ("numbers", Json.arr (es.map fun (n, h) => Json.mkObj [("n", toJson n), ("hash", hx h)]).toArray)]
  | .keepRefused d w => Json.mkObj [("frame", "keep_refused"), ("doc", hx d), ("why", w)]

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
   one "covers in a later part of an upload" [hello ++ framed (obj [("at", .uint 1), ("doc", .bytes h32),
     ("hash", .bytes h32), ("bytes", .bytes []), ("frame", txt "keep_part"), ("total", .uint 2),
     ("covers", .array [])])],
   one "an offset in an upload's first part" [hello ++ framed (obj [("at", .uint 0), ("doc", .bytes h32),
     ("hash", .bytes h32), ("bytes", .bytes []), ("frame", txt "keep_put"), ("total", .uint 2),
     ("covers", .array [])])],
   one "a hash as text, not bytes" [hello ++ framed (obj [("doc", .bytes h32), ("frame", txt "fetch"),
     ("hashes", .array [txt "ab"])])],
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

/-! ## A keeper's arrivals -/

open Aven.Peer.Keeper in
def keeperPut (p : Put) : Json :=
  Json.mkObj [("hash", toJson p.hash), ("bytes", toJson p.bytes), ("covers", toJson p.covers)]

open Aven.Peer.Keeper in
def keeperVector (name : String) (ups : List (String × List Put)) (asks : List Nat) : Json :=
  let states := (ups.foldl (fun (acc : List Aven.Peer.Keeper.Store × Aven.Peer.Keeper.Store) u =>
    let s := acc.2.upload u.1 u.2; (acc.1 ++ [s], s)) ([], ({} : Aven.Peer.Keeper.Store))).1
  vector name
    (Json.mkObj [("uploads", Json.arr (ups.map fun (d, ps) =>
        Json.mkObj [("device", Json.str d), ("puts", Json.arr (ps.map keeperPut).toArray)]).toArray),
      ("after", toJson asks)])
    (Json.arr (states.map fun s => Json.mkObj [("next", toJson s.next),
        ("items", Json.arr (s.items.map fun i => Json.mkObj [("n", toJson i.n), ("hash", toJson i.hash),
          ("bytes", toJson i.bytes), ("uploaders", toJson i.uploaders)]).toArray),
        ("after", Json.arr (asks.map fun n => Json.arr ((s.after n).map fun q =>
          Json.arr (q.map fun (m, h) => Json.arr #[toJson m, toJson h]).toArray).toArray).toArray),
        ("caughtUp", Json.arr (asks.map fun n =>
          let r := ({ at_ := n, held := [11, 12] } : Reader).catchUp s
          Json.mkObj [("at", toJson r.at_), ("held", toJson r.held)]).toArray)]).toArray)

open Aven.Peer.Keeper in
def keeperExamples : List (String × List (String × List Put) × List Nat) := [
  ("a reader's covers take only itself off; the writer's segment drops its loose envelopes",
    [("bob", [⟨11, 900, []⟩, ⟨12, 900, []⟩, ⟨13, 900, []⟩]), ("carol", [⟨12, 900, []⟩, ⟨99, 100, [11, 12]⟩]),
     ("bob", [⟨50, 3000, [11, 12, 13]⟩])], [0, 2, 5]),
  ("a writer that never comes back keeps its loose envelopes", [("dave", [⟨21, 900, []⟩]), ("bob", [⟨51, 3000, [21]⟩])],
    [0]),
  ("a segment can't cover itself", [("bob", [⟨60, 3000, [60]⟩])], [0]),
  ("the same bytes twice get one number", [("bob", [⟨70, 900, []⟩, ⟨70, 900, []⟩]), ("bob", [⟨70, 900, []⟩])], [0]),
  ("500 loose envelopes, then their two segments", [("alice", (List.range 500).map fun i => ⟨1000 + i, 900, []⟩),
     ("alice", [⟨2000, 200000, (List.range 256).map (1000 + ·)⟩, ⟨2001, 200000, (List.range 244).map (1256 + ·)⟩])],
    [0, 200, 499, 500, 501])]

open Aven.Peer.Keeper in
def randomUploads (seed : Nat) : List (String × List Put) := Id.run do
  let (len, r) := (Rng.seed seed).below 12
  let (ups, _) := r.many (len + 1) fun r =>
    let (d, r) := r.below 3
    let (k, r) := r.below 5
    let (ps, r) := r.many (k + 1) fun r =>
      let (h, r) := r.below 16
      let (c, r) := r.below 3
      let (cs, r) := r.many (if c = 0 then 3 else 0) fun r => r.below 16
      (⟨h, h * 10 + 1, cs⟩, r)
    ((["alice", "bob", "carol"].getD d "alice", ps), r)
  return ups

def keeper : List Json :=
  keeperExamples.map (fun (name, ups, asks) => keeperVector name ups asks) ++
  (List.range generated).map fun i => keeperVector s!"seed {i + 1}" (randomUploads (i + 1)) [0, 3, 8]

/-! ## The fetch gate -/

open Aven.Peer.Fetch in
def fetchVector (name : String) (table : List (Nat × String × Nat)) (proven : List String) (doc : String)
    (hs : List Nat) : Json :=
  let held : Held := fun h => (table.find? (·.1 == h)).map fun (_, d, n) => (d, List.replicate n 0)
  vector name
    (Json.mkObj [("held", Json.arr (table.map fun (h, d, n) =>
        Json.mkObj [("hash", toJson h), ("doc", Json.str d), ("bytes", toJson n)]).toArray),
      ("proven", toJson proven), ("doc", Json.str doc), ("hashes", toJson hs)])
    (match answer proven held doc hs with
     | none => Json.mkObj [("refused", toJson true)]
     | some a => Json.mkObj [("served", toJson (a.served.map (·.1))), ("missing", toJson a.missing),
        ("later", toJson a.later)])

open Aven.Peer.Fetch in
def partsVector (n : Nat) : Json :=
  vector s!"an item of {n} bytes in parts" (Json.mkObj [("bytes", toJson n)])
    (Json.arr ((parts 1 (List.replicate n 0)).map fun p =>
      Json.arr #[toJson p.at_, toJson p.bytes.length]).toArray)

def fetchTable : List (Nat × String × Nat) :=
  [(1, "d1", 500 * 1024), (2, "d1", 600 * 1024), (3, "d1", 1024), (9, "d2", 10)]

def fetchCases : List Json :=
  [fetchVector "another Doc's hash is missing; what doesn't fit waits, in order" fetchTable ["d1"] "d1" [9, 1, 2, 3, 7],
   fetchVector "one item larger than the bytes in flight is served alone" fetchTable ["d1"] "d1" [2],
   fetchVector "a Doc not proven gets nothing" fetchTable ["d2"] "d1" [1],
   fetchVector "too many hashes get nothing" fetchTable ["d1"] "d1" (List.replicate 129 1),
   fetchVector "128 hashes are answered" fetchTable ["d1", "d2"] "d2" ((List.range 127).map (· + 100) ++ [9]),
   fetchVector "nothing held: all missing" fetchTable ["d1"] "d1" [5, 6],
   fetchVector "once one waits, nothing after it is served, not even an empty item"
     (fetchTable ++ [(4, "d1", 0)]) ["d1"] "d1" [1, 2, 4]] ++
  [0, 1, 49151, 49152, 49153, 100 * 1024, 1024 * 1024 + 3].map partsVector ++
  (List.range generated).map fun i => Id.run do
    let (k, r) := (Rng.seed (i + 1)).below 12
    let (table, r) := r.many (k + 1) fun r =>
      let (h, r) := r.below 20
      let (d, r) := r.below 2
      let (n, r) := r.below (400 * 1024)
      ((h, if d = 0 then "d1" else "d2", n), r)
    let (len, r) := r.below 10
    let (hs, r) := r.many (len + 1) fun r => r.below 24
    let (p, _) := r.below 3
    return fetchVector s!"seed {i + 1}" table (if p = 0 then [] else if p = 1 then ["d1"] else ["d1", "d2"]) "d1" hs

/-! ## A keeper serving a connection -/

open Aven.Peer.Keeper Aven.Peer.Serve in
def askJson : Ask → Json
  | .prove d p => Json.mkObj [("ask", "prove"), ("doc", Json.str d), ("proof", toJson p)]
  | .upload d ps => Json.mkObj [("ask", "upload"), ("doc", Json.str d), ("puts", Json.arr (ps.map keeperPut).toArray)]
  | .after d n => Json.mkObj [("ask", "after"), ("doc", Json.str d), ("n", toJson n)]
  | .fetch d hs => Json.mkObj [("ask", "fetch"), ("doc", Json.str d), ("hashes", toJson hs)]

open Aven.Peer.Serve in
def replyJson : Reply → Json
  | .proven d => Json.mkObj [("reply", "proven"), ("doc", Json.str d)]
  | .proveRefused d => Json.mkObj [("reply", "prove_refused"), ("doc", Json.str d)]
  | .took d ns => Json.mkObj [("reply", "took"), ("doc", Json.str d),
      ("numbers", Json.arr (ns.map fun (h, n) => Json.arr #[toJson h, toJson n]).toArray)]
  | .uploadRefused d why => Json.mkObj [("reply", "upload_refused"), ("doc", Json.str d), ("why", Json.str why)]
  | .arrived d es more => Json.mkObj [("reply", "arrived"), ("doc", Json.str d),
      ("entries", Json.arr (es.map fun (n, h) => Json.arr #[toJson n, toJson h]).toArray), ("more", toJson more)]
  | .fetched d s m l => Json.mkObj [("reply", "fetched"), ("doc", Json.str d), ("served", toJson s),
      ("missing", toJson m), ("later", toJson l)]
  | .refused d => Json.mkObj [("reply", "refused"), ("doc", Json.str d)]

open Aven.Peer.Serve in
def serveVector (name : String) (serves : List (String × Nat × String)) (quotas : List (String × Nat))
    (as : List (String × Ask)) : Json :=
  let g : Gate := { serves := fun d p => (serves.find? fun (d', p', _) => d' == d && p' == p).map (·.2.2),
                    quota := fun v => ((quotas.find? (·.1 == v)).map (·.2)).getD 0 }
  let (k, rs) := Keeper.run g {} [] as
  vector name
    (Json.mkObj [("serves", Json.arr (serves.map fun (d, p, v) =>
        Json.mkObj [("doc", Json.str d), ("proof", toJson p), ("vault", Json.str v)]).toArray),
      ("quotas", Json.arr (quotas.map fun (v, q) => Json.mkObj [("vault", Json.str v), ("quota", toJson q)]).toArray),
      ("asks", Json.arr (as.map fun (d, a) => (askJson a).setObjVal! "device" (Json.str d)).toArray)])
    (Json.mkObj [("replies", Json.arr (rs.map replyJson).toArray),
      ("bills", Json.mkObj (quotas.map fun (v, _) => (v, toJson (k.bill v))))])

def on (d : String) (as : List Aven.Peer.Serve.Ask) : List (String × Aven.Peer.Serve.Ask) := as.map (d, ·)

open Aven.Peer.Keeper Aven.Peer.Serve in
def serveCases : List Json :=
  [serveVector "refused before proving, by an old key, and for a Doc no keep cap names"
     [("d1", 1, "alice")] [("alice", 3000)] (on "alice-peer-light"
     [.upload "d1" [⟨11, 900, []⟩], .prove "d1" 2, .prove "d9" 1, .upload "d9" [⟨11, 900, []⟩], .after "d9" 0,
      .fetch "d9" [11]]),
   serveVector "taken within the quota, refused whole past it, covered by a segment"
     [("d1", 1, "alice")] [("alice", 3000)] (on "alice-peer-light"
     [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩, ⟨12, 900, []⟩], .upload "d1" [⟨13, 900, []⟩, ⟨14, 900, []⟩],
      .upload "d1" [⟨13, 900, []⟩], .after "d1" 0, .fetch "d1" [11, 99], .upload "d1" [⟨50, 300, [11, 12, 13]⟩],
      .after "d1" 1, .fetch "d1" [11, 50], .upload "d1" [⟨20, 2500, []⟩]]),
   serveVector "an item dropped and put again in one upload stays on its bill"
     [("d1", 1, "alice")] [("alice", 3000)] (on "alice-peer-light"
     [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩], .upload "d1" [⟨50, 300, [11]⟩, ⟨11, 900, []⟩],
      .upload "d1" [⟨20, 1900, []⟩], .after "d1" 0]),
   serveVector "a drop frees its payer's bill: the quota counts what is held"
     [("d1", 1, "alice")] [("alice", 3000)] (on "alice-peer-light"
     [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩, ⟨12, 900, []⟩, ⟨13, 900, []⟩], .upload "d1" [⟨20, 2500, []⟩],
      .upload "d1" [⟨50, 300, [11, 12, 13]⟩], .upload "d1" [⟨20, 2500, []⟩]]),
   serveVector "the bill follows the uploaders: covered by its first, it moves to the next, past her quota"
     [("d1", 3, "bob"), ("d1", 4, "carol")] [("bob", 3000), ("carol", 500)]
     [("bob-peer-light", .prove "d1" 3), ("carol-peer", .prove "d1" 4), ("bob-peer-light", .upload "d1" [⟨12, 900, []⟩]),
      ("carol-peer", .upload "d1" [⟨12, 900, []⟩]), ("bob-peer-light", .upload "d1" [⟨50, 300, [12]⟩]),
      ("carol-peer", .upload "d1" [⟨77, 10, []⟩]), ("carol-peer", .after "d1" 0),
      ("carol-peer", .upload "d1" [⟨60, 10, [12]⟩]), ("carol-peer", .upload "d1" [⟨77, 10, []⟩])],
   serveVector "500 envelopes, after 0 in pages"
     [("d1", 1, "alice")] [("alice", 1000000)] (on "alice-peer"
     [.prove "d1" 1, .upload "d1" ((List.range 500).map fun i => ⟨1000 + i, 900, []⟩), .after "d1" 0,
      .after "d1" 128, .after "d1" 384, .after "d1" 500])] ++
  (List.range generated).map fun i => Id.run do
    let (len, r) := (Rng.seed (i + 1)).below 16
    let (as, _) := r.many (len + 1) fun r =>
      let (who, r) := r.below 3
      let dev := ["a-device", "b-device", "c-device"].getD who "a-device"
      let (k, r) := r.below 4
      let (d, r) := r.below 2
      let doc := if d = 0 then "d1" else "d2"
      if k = 0 then let (p, r) := r.below 4; ((dev, Ask.prove doc p), r)
      else if k = 1 then
        let (n, r) := r.below 4
        let (ps, r) := r.many (n + 1) fun r =>
          let (h, r) := r.below 12
          let (c, r) := r.below 3
          let (cs, r) := r.many (if c = 0 then 2 else 0) fun r => r.below 12
          (⟨h, 100 * (h + 1), cs⟩, r)
        ((dev, Ask.upload doc ps), r)
      else if k = 2 then let (n, r) := r.below 6; ((dev, Ask.after doc n), r)
      else let (n, r) := r.below 4; let (hs, r) := r.many (n + 1) fun r => r.below 14; ((dev, Ask.fetch doc hs), r)
    return serveVector s!"seed {i + 1}" [("d1", 1, "alice"), ("d2", 2, "bob"), ("d1", 3, "carol"), ("d2", 3, "carol")]
      [("alice", 2500), ("bob", 1000), ("carol", 1500)] as

def write (dir : System.FilePath) (file : String) (vs : List Json) : IO Unit :=
  IO.FS.writeFile (dir / file) (String.join (vs.map fun v => v.compress ++ "\n"))

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  write dir "topics.json" topics
  write dir "live.json" liveVectors
  write dir "judge.json" judgeVectors
  write dir "doc-sync.json" syncVectors
  for (file, vs) in [("presence.json", presence), ("wire.json", wire), ("frames.json", frames),
      ("upgrades.json", upgrades), ("keeper.json", keeper), ("fetch.json", fetchCases), ("serve.json", serveCases)] do
    IO.FS.writeFile (dir / file) (render vs)
