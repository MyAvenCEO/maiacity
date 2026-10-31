import Aven.DB.Json
import Aven.DB.Engine
import Aven.DB.Docs

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes the examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`:

- `status.json`: a limit and status events; the state after each (`Aven.DB.Status`).
- `timeline.json`: a timeline line's parts; the line (`Aven.DB.Timeline`).
- `store.json`: traces of store calls from an empty store; the result of each (`Aven.DB.Store`). Every backend
  replays them in the conformance suite.
- `hashes.json`: spellings of a hash; whether the store reads each as one.
- `chat.json`: messages arriving in a room and the clock moving on; after each step the answer, the body the message's
  sender signs, who is present and the lines said (`Aven.DB.Chat`). The door admits `alice`, `aven` and `bob`; each
  name is a test key, which aven-gen1's tests sign with for real.
- `files.json`: files cut into chunks; each chunk's bounds and hash, the index, the file's name, and the chunks each
  range touches with the bytes read from them alone; files of the city-dome's size by their size alone
  (`Aven.DB.Files`).
- `chats.json`: lines arriving at peers and peers catching up; after each step the answers, the peer's heads, loose
  lines, forks and what its chat shows (`Aven.DB.Chains`); what a line's device signs; and blobs read as lines or
  refused as not canonical (`Aven.DB.Chains.read`). Lines are named by labels,
  which aven-gen1's tests replace with the hashes of real signed blobs.
- `queries.json`: a directory's genesis facts, Records, the Docs held, a target, a stored query; the answer (refused,
  complete, or short with the Docs missing), the query's bound and cost, and the work it did (`Aven.DB.Engine.Query`).
- `wants.json`: wants, the keys caps allow and each key's prerequisites; the queue, one round over the pages left with
  the device's uploads first, and what eviction to a budget keeps (`Aven.DB.Engine.Wants`).
- `mutations.json`: a writer id, its counter, a Doc's Records and core operations; the footprint, the Records after the
  commit or why it was refused, and every reader's check of the diff (`Aven.DB.Engine.Mutate`,
  `Aven.DB.Engine.Footprint`).
- `lower.json`: `core/1`'s calls, their params in order; each call's encoding and the steps it lowers to, or null when
  it is refused; and committers' ops with the call each names (`Aven.DB.Engine.Lower`).
- `changes.json`: a Doc's Records before and after a commit (some tampered with after), every type at one schema, and
  the commit's footprint; the changes a reader sees, a change's fields in order as `[field, value]`, or `[field]` for
  one it removes, and the verdict's footprint part (`Aven.DB.Engine.Changes`).
- `merge-check.json`: main's Records before a merge, the merged Records and the footprint of the calls the merge
  brings; the changes the merge makes on main and the verdict's footprint part on them (`merge_steps`).
- `lookups.json`: a shape, the Records and Docs at version V, the Records now, the Docs unfolded since and listed now, a
  probe; the index at V, its hits, the candidates, the query over them and the folded index (`Aven.DB.Engine.Index`).
- `merges.json`: one place's base, the target's and the other branch's values and the merger's choice; the merged value,
  and backing out a commit (`Aven.DB.Docs.Merge`).
- `lenses.json`: writes of a todo's done-ness by v0 and v1 apps; what a v0 reader reads (`Aven.DB.Docs.Lens`).
- `indexes.json`: invoices' entries (vendor, total, Doc) in any order, a size limit and a vendor; the nodes they make
  and what a lookup of that vendor finds, by total (`Aven.DB.Docs.Index`, `Aven.DB.Docs.Key`).
- `trees.json`: a fold's entries in hex, a size limit and a range; every level's nodes as their CBOR in hex, leaves
  first (a leaf an array of entries, an inner node an array of `[first, last, child]`), the root, and what a walk from
  the root through those nodes finds (`Aven.DB.Docs.Walk`).
- `writers.json`: devices, Docs, branches and generations; their CBOR, the derived bytes and the writer id
  (`Aven.DB.Docs.Writers`).
- `envelopes.json`: what a reader holds, an envelope's names and its Loro dependencies; whether it agrees, waits or is
  refused (`Aven.DB.Docs.OpIds`).
- `checkpoints.json`: checkpoints over a toy CRDT (the sum of sequence numbers); whether each is taken, checks and is
  accepted (`Aven.DB.Docs.Checkpoint`).
- `fit.json`: envelopes under two schemas writing one field; which fit, and the merged value with its schema
  (`Aven.DB.Docs.Fit`).
- `logs.json`: two readers holding each side of a split, then both, then a stuck log's next envelope; what each sees of
  each envelope: whether it counts, and whether it is half of a split (`Aven.DB.Docs.countsB`, Core's `Past`).
- `counts.json`: envelopes with their fit and authorized verdicts; which count, and the live state over them.
- `genesis.json`: geneses, their encodings and Doc ids, and the built-in types' ids (`Aven.DB.Docs.Genesis`).
- `bodies.json`: docs envelope bodies, their encodings and commit messages, and Values a reader refuses as one
  (`Aven.DB.Docs.Body`).
- `segments.json`: segments' bodies and names, and which a reader takes (`Aven.DB.Docs.Segment`).
- `heads.json`: a head's encoding (`Aven.DB.Docs.Head`).
- `held.json`: what a peer holds of a Doc, its envelopes' names and blob hashes in the order held (`Docs.Held`).
- `loro.json`: rule 7 on Loro commits: the deps a change carries, read with its writer's previous op, and the verdict
  (`Aven.DB.Docs.loroAgrees`).
- `placements.json`: envelopes with and without the genesis; whether each is its log's first, and whether the
  genesis sits where it must (`genesis_iff_first`).
- `builtins.json`: Records of the docs layer's built-in types; which their shapes take (`docsBuiltinFit`).
- `schemas.json`: schemas' one form: which Values a reader takes as a schema, and a taken one's hash
  (`Aven.DB.Docs.Schema`).
- `keys.json`: tuples and their keys in hex; pairs of tuples and whether the first key sorts before the second
  (`Aven.DB.Docs.Key`).

`aven-gen1`'s and `aven-db-store`'s tests load them. `bun run up --check` runs this again and fails when the files
differ from what is committed. -/

open Lean Aven.DB

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

/-! ## Status -/

def statusVector (name : String) (limit : Nat) (es : List Event) : Json :=
  vector name (Json.mkObj [("limit", toJson limit), ("events", toJson (es.map Event.name))])
    (Json.arr ((trail (Status.step limit) Status.start es).map Status.json).toArray)

def randomEvents (seed : Nat) : Nat × List Event := Id.run do
  let (limit, r) := (Rng.seed seed).below 6
  let (len, r) := r.below 80
  -- ticks are the common case, as in a running peer
  let (es, _) := r.many len fun r =>
    let (k, r) := r.below 10
    ((if k = 0 then .dial else if k = 1 then .lost else if k ≤ 4 then .frame else .tick), r)
  return (limit + 1, es)

def status : List Json :=
  statusExamples.map (fun (name, es, _) => statusVector name 3 es) ++
  (List.range generated).map fun i => let (limit, es) := randomEvents (i + 1); statusVector s!"seed {i + 1}" limit es

/-! ## The timeline -/

def timeline : List Json :=
  lineExamples.map fun (name, (t, peer, event, fields), _) =>
    vector name (Json.mkObj [("t", toJson t), ("peer", peer), ("event", event),
      ("fields", Json.arr (fields.map fun (k, v) => Json.arr #[k, v]).toArray)]) (line t peer event fields)

/-! ## The store -/

open Store in
def storeVector (name : String) (ops : List Op) : Json :=
  vector name (Json.mkObj [("ops", Json.arr (ops.map Op.json).toArray)]) (replay ops)

open Store in
/-- A random trace that follows the model as it draws, so compare-and-set often expects what the ref holds. -/
def randomTrace (seed : Nat) : List Op := Id.run do
  let blobs : List Bytes := [bytes "a", bytes "b", [], noise 40 1, noise 64 2, noise 65 3, bytes "x"]
  let hashes := blobs.map nm ++ [nm (bytes "never put")]
  let names := ["head", "doc.3f9a.head", "peer.key", nm (bytes "x"), ".tmp", "a/b"]
  let pick {α : Type} [Inhabited α] (r : Rng) (l : List α) : α × Rng := let (i, r) := r.below l.length; (l[i]!, r)
  let (len, r) := (Rng.seed seed).below 40
  let mut r := r
  let mut s : Store := {}
  let mut ops := #[]
  for _ in [0:len + 1] do
    let (k, r') := r.below 21
    let (h, r') := pick r' hashes
    let (b, r') := pick r' blobs
    let (n, r') := pick r' (if k % 7 = 0 then names else names.take 4)
    let (a, r') := r'.below 70
    let (e, r') := r'.below 70
    let (guess, r') := r'.below 3
    r := r'
    -- what a writer expects: mostly what the ref holds, now and then another hash or nothing
    let expected := if guess = 0 then (if a % 2 = 0 then none else some h) else get s.refs n
    let op : Op := match k with
      | 0 | 1 | 2 | 3 => .put b
      | 4 | 5 => .get h
      | 6 | 7 => .getRange h (a % 8 * 10) (e % 8 * 10)
      | 8 => .has h
      | 9 => .list
      | 10 | 11 => .delete h
      | 12 | 13 => .getRef n
      | 14 | 15 | 16 => .setRef n expected h
      | 17 => .deleteRef n (expected.getD h)
      | 18 => .size h
      | _ => .listRefs
    s := (step Blake3.hash s op).1
    ops := ops.push op
  return ops.toList

def store : List Json :=
  Store.storeExamples.map (fun (name, ops, _) => storeVector name ops) ++
  (List.range generated).map fun i => storeVector s!"seed {i + 1}" (randomTrace (i + 1))

def hashes : List Json :=
  Store.hashExamples.map fun (s, _) =>
    vector s!"{s.length} characters" (Json.mkObj [("hash", s)]) (toJson (Store.validHash s))

/-- A ref's text at rest: what a hash is written as, and what each text reads back as. -/
def refs : List Json :=
  (Store.refExamples.map fun (s, r) =>
    vector s!"stored {s.quote}" (Json.mkObj [("stored", s)]) (Json.mkObj [("reads", toJson r)])) ++
  [vector "written" (Json.mkObj [("hash", Store.nm (Store.bytes "a ref"))])
    (Json.mkObj [("stored", Store.refText (Store.nm (Store.bytes "a ref")))]),
   vector "a browser store's version" (Json.mkObj []) (Json.mkObj [("version", Store.version)])]

/-! ## The chat -/

open Chat in
def Aven.DB.Chat.Message.json (m : Message) : Json :=
  Json.mkObj [("network", m.network), ("from", m.sender), ("at", toJson m.time), ("kind", m.kind.name),
    ("text", m.text), ("signer", m.signer), ("signed", m.signed)]

open Chat in
def Aven.DB.Chat.Refusal.name : Refusal → String
  | .wrongNetwork => "wrongNetwork"
  | .notMember => "notMember"
  | .badSignature => "badSignature"
  | .stale => "stale"
  | .empty => "empty"
  | .tooLong => "tooLong"
  | .notSaid => "notSaid"

open Chat in
def chatVector (name : String) (steps : List Step) : Json :=
  let input := Json.mkObj [("network", "aven"), ("members", toJson Chat.members),
    ("steps", Json.arr (steps.map fun
      | .arrive now m => Json.mkObj [("now", toJson now), ("message", m.json)]
      | .clock now => Json.mkObj [("now", toJson now)]).toArray)]
  let expected := (steps.zip (({} : Room).run steps)).map fun (step, answer, r) =>
    Json.mkObj [("answer", match answer with | none => Json.mkObj [("ok", true)] | some why => Json.mkObj [("error", why.name)]),
      ("body", match step with | .arrive _ m => toJson m.body | .clock _ => Json.null),
      ("present", toJson (r.present step.now)),
      ("said", Json.arr (r.said.map fun (who, text) => Json.arr #[who, text]).toArray)]
  vector name input (Json.arr expected.toArray)

open Chat in
def randomChat (seed : Nat) : List Step := Id.run do
  let (len, r) := (Rng.seed (seed + 500)).below 30
  let mut r := r
  let mut now := 0
  let mut sent : Array Message := #[]
  let mut steps := #[]
  for _ in [0:len + 1] do
    let (k, r1) := r.below 12
    let (who, r2) := r1.below 4
    let (gap, r3) := r2.below 16000
    let (t, r4) := r3.below 8
    r := r4
    now := now + gap
    let sender := ["alice", "aven", "bob", "eve"][who]!
    let tamper : Tamper := match t with
      | 0 => .signer "eve"
      | 1 => .text "changed"
      | 2 => .network "other"
      | _ => .none
    if k = 0 then steps := steps.push (.clock now)
    else if k = 1 && !sent.isEmpty then steps := steps.push (.arrive now sent[now % sent.size]!)
    else
      let m := if k < 4 then Message.make sender now .here "" tamper
        else if k < 5 then Message.make sender now .bye "" tamper
        else if k < 6 then Message.make sender now .say (if t < 6 then "" else long) .none
        else Message.make sender now .say s!"line {now}" tamper
      sent := sent.push m
      steps := steps.push (.arrive now m)
  return steps.toList

def chat : List Json :=
  Chat.chatExamples.map (fun (name, steps, _) => chatVector name steps) ++
  (List.range generated).map fun i => chatVector s!"seed {i + 1}" (randomChat (i + 1))

/-! ## Files -/

open Files in
def rangeJson (c n : Nat) (b : Option (List UInt8)) (r : Nat × Nat) : Json :=
  let (a, e) := r
  if a > e ∨ e > n then Json.mkObj [("error", "range")]
  else Json.mkObj ([("touches", toJson (touches c a e))] ++
    match b with
    | some b => [("bytes", toJson (Blake3.hex (read c b a e)))]
    | none => [])

/-- A file of real bytes, cut into chunks of `c`: its chunks' hashes, its index and name, and each range read. -/
def fileVector (name : String) (c : Nat) (b : List UInt8) (ranges : List (Nat × Nat)) : Json :=
  let n := b.length
  vector name (Json.mkObj [("chunk", toJson c), ("bytes", Blake3.hex b),
      ("ranges", Json.arr (ranges.map fun (a, e) => toJson [a, e]).toArray)])
    (Json.mkObj [("count", toJson (Files.count c n)),
      ("bounds", Json.arr ((List.range (Files.count c n)).map fun i =>
        let (s, e) := Files.bounds c n i; toJson [s, e]).toArray),
      ("chunks", toJson ((Files.split c b).map Blake3.hash)),
      ("index", Blake3.hex (Files.index b c)), ("file", Files.name b c),
      ("reads", Json.arr (ranges.map (rangeJson c n (some b))).toArray)])

/-- A file of `n` bytes, by its size alone: its chunks' bounds and the chunks each range touches. -/
def sizeVector (name : String) (c n : Nat) (ranges : List (Nat × Nat)) : Json :=
  vector name (Json.mkObj [("chunk", toJson c), ("size", toJson n),
      ("ranges", Json.arr (ranges.map fun (a, e) => toJson [a, e]).toArray)])
    (Json.mkObj [("count", toJson (Files.count c n)),
      ("bounds", Json.arr ((List.range (Files.count c n)).map fun i =>
        let (s, e) := Files.bounds c n i; toJson [s, e]).toArray),
      ("reads", Json.arr (ranges.map (rangeJson c n none)).toArray)])

def randomFile (seed : Nat) : Nat × List UInt8 × List (Nat × Nat) := Id.run do
  let (len, r) := (Rng.seed (seed + 900)).below 80
  let (c, r) := r.below 17
  let (rs, _) := r.many 5 fun r =>
    let (a, r) := r.below (len + 3)
    let (e, r) := r.below (len + 3)
    ((min a e, max a e), r)
  return (c + 1, Store.noise len seed, rs)

open Files in
/-- Whether chunk `i` of a file of `n` bytes, `len` long, is cut as it must be; and the limits. -/
def fitsVectors : List Json :=
  let mib := chunkSize
  let one (name : String) (c n i len : Nat) :=
    vector s!"fits: {name}" (Json.mkObj [("fits", Json.mkObj [("chunk", toJson c), ("size", toJson n), ("i", toJson i),
      ("len", toJson len)])]) (Json.mkObj [("fits", toJson (fits c n i len))])
  [vector "limits" (Json.mkObj [("limits", Json.null)])
    (Json.mkObj [("chunk", toJson chunkSize), ("maxBlob", toJson maxBlob), ("maxFile", toJson maxFile)]),
   one "a whole middle chunk" 4 10 1 4, one "the short last chunk" 4 10 2 2, one "a short middle chunk" 4 10 1 2,
   one "a whole last chunk where a short one belongs" 4 10 2 4, one "a chunk past the end" 4 10 3 1,
   one "an empty last chunk" 4 8 2 0, one "a chunk too long" 4 10 0 5,
   one "a movie's middle chunk, whole" mib 200000000 95 mib,
   one "a movie's middle chunk, one byte short" mib 200000000 95 (mib - 1),
   one "a movie's last chunk" mib 200000000 190 (200000000 - 190 * mib),
   one "a movie's last chunk, whole" mib 200000000 190 mib]

def files : List Json :=
  let mib := Files.chunkSize
  [fileVector "ten bytes in chunks of 4" 4 Files.abc [(0, 10), (3, 9), (4, 8), (9, 10), (5, 5), (0, 11), (6, 3)],
   fileVector "an empty file" 4 [] [(0, 0), (0, 1)],
   fileVector "a file of exactly two chunks" 8 (Store.noise 16 7) [(0, 16), (7, 9), (8, 16)],
   fileVector "3000 bytes in chunks of 1024, each chunk more than one of BLAKE3's" 1024 (Store.noise 3000 11)
     [(0, 3000), (1000, 1100), (2047, 2049)],
   sizeVector "a 200 MB movie in 1 MiB chunks, read from its middle" mib 200000000
     [(100000000, 100500000), (100500000, 101000000), (0, 1), (199999999, 200000000), (0, 200000000)],
   sizeVector "exactly one chunk" mib mib [(0, mib), (mib - 1, mib), (0, mib + 1)],
   sizeVector "one byte more than a chunk" mib (mib + 1) [(mib, mib + 1), (mib - 1, mib + 1)],
   sizeVector "one byte" mib 1 [(0, 1), (1, 1)]] ++ fitsVectors ++
  (List.range generated).map fun i =>
    let (c, b, rs) := randomFile (i + 1)
    fileVector s!"seed {i + 1}" c b rs

/-! ## The chat's chains -/

open Chains in
def Aven.DB.Chains.Body.json : Body → Json
  | .text t => Json.mkObj [("text", t)]
  | .file f n name type => Json.mkObj [("file", f), ("size", toJson n), ("name", name), ("type", type)]
  | .retract t d s p time =>
    Json.mkObj [("retract", t), ("device", d), ("seq", toJson s), ("prev", toJson p), ("at", toJson time)]
  | .redacted => Json.mkObj [("redacted", true)]

open Chains in
def Aven.DB.Chains.Line.json (l : Line) : Json :=
  Json.mkObj [("id", l.id), ("network", l.network), ("device", l.device), ("seq", toJson l.seq),
    ("prev", toJson l.prev), ("at", toJson l.time), ("body", l.body.json), ("signer", l.signer),
    ("signed", l.signed)]

open Chains in
def Aven.DB.Chains.Refusal.name : Refusal → String
  | .wrongNetwork => "wrongNetwork"
  | .notMember => "notMember"
  | .badSignature => "badSignature"
  | .empty => "empty"
  | .tooLong => "tooLong"
  | .badSeq => "badSeq"
  | .badFile => "badFile"
  | .notCanonical => "notCanonical"
  | .badRetract => "badRetract"

open Chains in
def Aven.DB.Chains.Answer.json : Answer → Json
  | .moved ids => Json.mkObj [("moved", toJson ids)]
  | .known => "known"
  | .gap => "gap"
  | .fork => "fork"
  | .refused why => Json.mkObj [("refused", why.name)]

open Chains in
def chainVector (name : String) (steps : List Step) : Json :=
  let input := Json.mkObj [("network", "aven"), ("members", toJson Chains.members),
    ("vaults", Json.mkObj (Chains.vaults.map fun (d, v) => (d, toJson v))),
    ("steps", Json.arr (steps.map fun
      | .hear p l => Json.mkObj [("peer", p), ("hear", l.json)]
      | .catchUp p src => Json.mkObj [("peer", p), ("catchUp", src)]).toArray)]
  let expected := (World.run [] steps).map fun (p, as, dropped, k) =>
    Json.mkObj [("peer", p), ("answers", Json.arr (as.map Answer.json).toArray),
      ("heads", Json.arr (k.heads.map fun (d, i) => toJson [d, i]).toArray),
      ("loose", toJson (k.loose.map (·.id))), ("forks", toJson k.forks), ("shown", toJson (k.shown.map (·.id))),
      ("deleted", toJson ((k.shown.filter (k.deleted Chains.vaults)).map (·.id))), ("dropped", toJson dropped)]
  vector name input (Json.arr expected.toArray)

open Chains in
/-- Every device's chain of four lines, a fork at each place, now and then a line tampered with, and retractions of
lines of any device, by any device, so some count (the same vault) and some don't. -/
def randomChains (seed : Nat) : List Step := Id.run do
  let devices := ["alice", "bob", "carol", "eve"]
  let main (d : String) (s : Nat) : Line :=
    Line.make s!"{d}{s}" d s (if s = 1 then none else some s!"{d}{s - 1}") (s * 100 + d.length) s!"line {s}"
  let fork (d : String) (s : Nat) : Line :=
    Line.make s!"{d}{s}'" d s (if s = 1 then none else some s!"{d}{s - 1}") (s * 100 + 50) s!"fork {s}"
  let (len, r) := (Rng.seed (seed + 700)).below 30
  let mut r := r
  let mut steps := #[]
  for i in [0:len + 1] do
    let (k, r1) := r.below 10
    let (p, r2) := r1.below 4
    let (d, r3) := r2.below 4
    let (s, r4) := r3.below 4
    let (q, r5) := r4.below 4
    r := r5
    let peer := peers[p]!
    let dev := devices[d]!
    if k < 2 then steps := steps.push (.catchUp peer peers[q]!)
    else if k = 2 then steps := steps.push (.hear peer (fork dev (s + 1)))
    else if k = 9 then
      -- half the time its own line, which counts; else any device's, which counts only for its own
      let tdev := if p % 2 = 0 then dev else devices[q]!
      -- the line before the retraction's own place, so a device retracting its own isn't a fork of it
      let t := main tdev (max s 1)
      steps := steps.push (.hear peer (Line.make' s!"r{dev}{s + 1}-{t.id}" dev (s + 1) (if s = 0 then none else some s!"{dev}{s}")
        (s * 100 + 30) (.retract t.id t.device t.seq t.prev t.time)))
    else if k = 3 then
      steps := steps.push (.hear peer (Line.make s!"t{i}" dev (s + 1) (if s = 0 then none else some s!"{dev}{s}")
        (s * 100) "tampered" (if q % 2 = 0 then .signer "eve" else .text "changed")))
    else steps := steps.push (.hear peer (main dev (s + 1)))
  return steps.toList

open Chains in
/-- What a line's device signs, with a real previous hash. -/
def bodies : List Json :=
  let prev := Blake3.hash (Store.bytes "a line")
  [Line.make "first" "alice" 1 none 1730000000000 "hi", Line.make "second" "alice" 2 (some prev) 1730000000001 "two\nlines",
   Line.make "unicode" "bob" 7 (some prev) 5 "grüß dich 👋",
   Line.make' "a file" "alice" 3 (some prev) 9 (.file prev 200000000 "the dome\nat night.mp4" "video/mp4"),
   Line.make "a text that reads like a file" "alice" 4 (some prev) 10 s!"file {prev}\nsize 1\ntype x\nname",
   Line.make' "a retraction" "alice" 5 (some prev) 11 (.retract prev "alice" 4 (some prev) 10)].map fun l =>
    vector s!"what {l.id} signs" (Json.mkObj [("line", l.json)]) (Json.mkObj [("signs", l.signs)])

open Chains in
def Aven.DB.Chains.Fields.json (f : Fields) : Json :=
  Json.mkObj [("network", f.network), ("device", f.device), ("seq", toJson f.seq), ("prev", toJson f.prev),
    ("at", toJson f.time), ("sig", f.sig), ("body", f.body.json)]

open Chains in
/-- A blob read as a line, or refused (`Aven.DB.Chains.read`): canonical lines, and the same lines written another
way. -/
def reads : List Json :=
  let one (name blob : String) :=
    vector s!"read: {name}" (Json.mkObj [("read", blob)]) (match read blob with
      | .ok f => Json.mkObj [("line", f.json)]
      | .error why => Json.mkObj [("refused", why.name)])
  [one "a text line" sample.blob, one "a first line, a file" sampleFile.blob, one "a retraction" sampleRetract.blob] ++
    variants.map fun (n, b) => one n b

def chats : List Json :=
  bodies ++ reads ++ Chains.chainExamples.map (fun (name, steps, _) => chainVector name steps) ++
  Chains.retractExamples.map (fun (name, steps, _) => chainVector name steps) ++
  (List.range generated).map fun i => chainVector s!"seed {i + 1}" (randomChains (i + 1))

/-! ## Docs: merges and lenses (`Aven.DB.Docs`) -/

open Docs in
def mergeCases : List (String × String × String × String × Bool) := [
  ("only the target changed", "Order seeds", "Order seeds today", "Order seeds", false),
  ("only the other branch changed", "Order seeds", "Order seeds", "Order seeds by Friday", false),
  ("both changed, the target keeps its own", "Order seeds", "Order seeds today", "Order seeds by Friday", false),
  ("both changed, the merger takes the other's", "Order seeds", "Order seeds today", "Order seeds by Friday", true),
  ("both changed alike", "Order seeds", "Order beans", "Order beans", false)]

open Docs in
def merges : List Json :=
  mergeCases.map (fun (name, base, target, other, take) =>
    vector name (Json.mkObj [("base", base), ("target", target), ("other", other), ("takeOther", toJson take)])
      (toJson (merge3 base target other take))) ++
  -- backing out the commit that set "by Friday", where nothing since touched the title, and where something did
  [vector "back out, untouched since" (Json.mkObj [("after", "by Friday"), ("now", "by Friday"), ("before", "")])
      (toJson (merge3 "by Friday" "by Friday" "" false)),
    vector "back out, changed since" (Json.mkObj [("after", "by Friday"), ("now", "by Monday"), ("before", "")])
      (toJson (merge3 "by Friday" "by Monday" "" false))]

open Docs in
def TodoWrite.json : TodoWrite → Json
  | .done b => Json.mkObj [("done", toJson b)]
  | .status s => Json.mkObj [("status", s)]

open Docs in
def lensCases : List (String × List (Write TodoWrite)) := [
  ("a v0 tick after a v1 status", [⟨1, .status "doing"⟩, ⟨2, .done true⟩]),
  ("a v1 status after a v0 tick", [⟨1, .done true⟩, ⟨2, .status "doing"⟩]),
  ("only v1 writes", [⟨3, .status "done"⟩, ⟨1, .status "open"⟩]),
  ("nothing written", [])]

open Docs in
def lenses : List Json :=
  lensCases.map fun (name, ws) =>
    let input := ws.map fun w => Json.mkObj [("stamp", toJson w.stamp), ("write", TodoWrite.json w.value)]
    vector name (Json.arr input.toArray)
      (match readThrough asDone ws with
       | some w => Json.mkObj [("stamp", toJson w.stamp), ("done", toJson w.value)]
       | none => Json.null)

/-! ## The engine -/

section Engine
open Aven.Core Aven.DB.Engine Aven.DB.Engine.Examples

def pick {α : Type} (r : Rng) (xs : List α) (d : α) : α × Rng :=
  let (i, r) := r.below (max 1 xs.length)
  (xs.getD i d, r)

/-- A subset: each element kept with probability one half. -/
def subset {α : Type} (r : Rng) (xs : List α) : List α × Rng := Id.run do
  let mut r := r
  let mut out := #[]
  for x in xs do
    let (b, r') := r.below 2
    r := r'
    if b = 1 then out := out.push x
  return (out.toList, r)

def gDocs : List DocId := ["d1", "d2", "d3"].map doc
def gTypes : List DocId := ["type:a", "type:b"].map doc
def gDir : List Facts := [⟨doc "d1", vault "v1", doc "type:list"⟩, ⟨doc "d2", vault "v1", doc "type:list"⟩,
  ⟨doc "d3", vault "v2", doc "type:list"⟩]
def gTargets : List Target := [.doc (doc "d1") .self, .vault (vault "v1") false, .vault (vault "v2") false,
  .vaultType (vault "v1") (doc "type:list") false]

def randomRecord (r : Rng) (i : Nat) : Rec Value × Rng :=
  let (d, r) := pick r gDocs (doc "d1")
  let (ty, r) := pick r gTypes (doc "type:a")
  let (k, r) := r.below 4
  (⟨d, ty, rows [("id", text s!"r{i}"), ("k", .uint k)]⟩, r)

def randomQuery (r : Rng) : Nat → Query Value × Rng
  | 0 => let (ty, r) := pick r gTypes (doc "type:a"); (.scan ty, r)
  | d + 1 =>
    let (op, r) := r.below 9
    let (q, r) := randomQuery r d
    let (q2, r) := randomQuery r d
    let (k, r) := r.below 4
    let (cmp, r) := pick r [Cmp.eq, .ne, .lt, .le] .eq
    let col := utf8 "k"
    match op with
    | 0 => (.filter col cmp (.uint k) q, r)
    | 1 => (.project [col] q, r)
    | 2 => (.join q q2 col col, r)
    | 3 => (.leftJoin q q2 col col, r)
    | 4 => (.anti q q2 col col, r)
    | 5 => (.order col q, r)
    | 6 => (.group col q, r)
    | 7 => (.limit k q, r)
    | _ => (q, r)

def randomQueryVector (seed : Nat) : Json := Id.run do
  let r := Rng.seed (seed + 7000)
  let (n, r) := r.below 9
  let mut r := r
  let mut db := #[]
  for i in [0:n] do
    let (rec, r') := randomRecord r i
    db := db.push rec
    r := r'
  let (held, r1) := subset r gDocs
  let (t, r2) := r1.below 9
  let (q, _) := randomQuery r2 2
  return queryVector s!"seed {seed}" gDir db.toList held ⟨gTargets[t]?, q⟩

def queries : List Json := queryExamples ++ (List.range generated).map fun i => randomQueryVector (i + 1)

def gKeys : List WantKey := ["k0", "k1", "k2", "k3", "k4", "k5"].map fun l => key l .records

/-- Each key's prerequisites among the keys before it, closed: what a prerequisite needs is a prerequisite too. -/
def randomPre (r : Rng) : List (WantKey × List WantKey) × Rng := Id.run do
  let mut r := r
  let mut pre : List (WantKey × List WantKey) := []
  for i in [0:gKeys.length] do
    let (direct, r') := subset r (gKeys.take i)
    r := r'
    let closed := direct.foldl (fun acc k => acc ++ (pre.lookup k).getD [] ++ [k]) []
    pre := pre ++ [(gKeys.getD i (key "k0" .records), gKeys.filter (closed.contains ·))]
  return (pre.filter (!·.2.isEmpty), r)

def randomWantVector (seed : Nat) : Json := Id.run do
  let r := Rng.seed (seed + 8000)
  let (n, r) := r.below 7
  let mut r := r
  let mut ws : Array (Want WantKey) := #[]
  let mut kept : Array (Kept WantKey) := #[]
  for _ in [0:n] do
    let (k, r1) := pick r gKeys (key "k0" .records)
    let (t, r2) := pick r1 [Tier.screen, .turn, .next, .later, .idle] .idle
    let (sg, r3) := r2.below 5
    let (b, r4) := r3.below 200
    let (u, r5) := r4.below 10
    ws := ws.push ⟨k, t, sg⟩
    kept := kept.push ⟨k, t, b, u⟩
    r := r5
  let up := key "up" .records
  let (caps, r1) := subset r gKeys
  let (pre, r2) := randomPre r1
  let (lk, r3) := subset r2 (up :: gKeys)
  let mut left : Array (WantKey × Nat) := #[]
  let mut r4 := r3
  for k in lk do
    let (m, r') := r4.below 4
    left := left.push (k, m)
    r4 := r'
  let (got, r5) := subset r4 (up :: gKeys)
  let (budget, _) := r5.below 600
  return wantVector s!"seed {seed}" ws.toList caps pre left.toList [up] got budget kept.toList

def wants : List Json := wantExamples ++ (List.range generated).map fun i => randomWantVector (i + 1)

def randomOp (r : Rng) : Op Value × Rng :=
  let (op, r) := r.below 4
  let (ty, r) := pick r [task, note] task
  let (k, r) := r.below 3
  let (n, r) := r.below 4
  match op with
  | 0 => let (isRef, r) := r.below 2
         (.put ty [(utf8 "x1", if isRef = 0 then .lit (.uint k) else .ref n)], r)
  | 1 => (.patch ty (rows [("x1", .uint k)]) (rows [("done", .uint 1)]), r)
  | 2 => (.remove ty (rows [("done", .uint 1)]), r)
  | _ => let (w, r) := pick r [1, 2, 3] 1
         (.edit ty ⟨w, 4, 0⟩ (utf8 "x1") (.uint k), r)

def randomMutationVector (seed : Nat) : Json := Id.run do
  let r := Rng.seed (seed + 9000)
  let (n, r) := r.below 5
  let mut r := r
  let mut ops := #[]
  for _ in [0:n + 1] do
    let (op, r') := randomOp r
    ops := ops.push op
    r := r'
  let (c, _) := r.below 9
  return mutationVector s!"seed {seed}" 1 c todo ops.toList

def mutations : List Json := mutationExamples ++ (List.range generated).map fun i => randomMutationVector (i + 1)

/-! ### Lowering `core/1`'s calls (`Engine.Lower`), the change view and the verdict (`Engine.Changes`) -/

def callJson (c : Call) : Json :=
  Json.mkObj [("op", toJson c.op.text),
    ("params", Json.arr (c.params.map fun (p, v) => Json.arr #[toJson (utf8Text p), v.json]).toArray)]

def loweredJson (c : Call) : Json :=
  Json.mkObj [("cbor", if Canon c.value then toJson (hex (encode c.value)) else Json.null), ("steps", match lowerCore blake3 c with
    | some sts => Json.arr (sts.map stepJson).toArray
    | none => Json.null)]

/-- A call, its params in order; its encoding (null when its params aren't in the codec's order, as no encoder
writes them) and its steps, or null when it is refused. -/
def lowerVector (name : String) (c : Call) : Json := vector name (Json.mkObj [("call", callJson c)]) (loweredJson c)

/-- A committer's op; the call it names, its encoding and its steps, which are the op's own footprint step. -/
def opCallVector (name : String) (o : Op Value) : Json :=
  vector name (Json.mkObj [("op", opJson o)]) (loweredJson (o.call blake3))

def params (ty : Value) (fs : List String) : List (Bytes × Value) :=
  [(utf8 "type", ty), (utf8 "fields", .array (fs.map text))]

def taskType : Value := .bytes task.hash.bytes

def lowerExamples : List Json :=
  (coreOps.map fun o => lowerVector s!"core/1's {o.name}"
    ⟨o.id blake3, params taskType (if o = .remove then [] else ["x2", "done"])⟩) ++
  [lowerVector "a remove that names a field: refused" ⟨CoreOp.remove.id blake3, params taskType ["x2"]⟩,
   lowerVector "fields before type: refused" ⟨CoreOp.patch.id blake3, (params taskType ["done"]).reverse⟩,
   lowerVector "no fields: refused" ⟨CoreOp.patch.id blake3, [(utf8 "type", taskType)]⟩,
   lowerVector "a key more: refused" ⟨CoreOp.patch.id blake3, params taskType ["done"] ++ [(utf8 "value", .uint 1)]⟩,
   lowerVector "a type of 31 bytes: refused" ⟨CoreOp.patch.id blake3, params (.bytes (task.hash.bytes.take 31)) ["done"]⟩,
   lowerVector "a type as text: refused" ⟨CoreOp.patch.id blake3, params (text "task") ["done"]⟩,
   lowerVector "a field that isn't text: refused"
     ⟨CoreOp.patch.id blake3, [(utf8 "type", taskType), (utf8 "fields", .array [text "done", .uint 1])]⟩,
   lowerVector "a read with params of its own: no step" ⟨CoreOp.read.id blake3, [(utf8 "query", text "open tasks")]⟩,
   lowerVector "another plugin's op: not core/1's" ⟨blake3 (utf8 "tree/1 move"), params taskType ["parent"]⟩] ++
  ((bananas ++ tick ++ [Op.remove task (rows [("done", .uint 1)]), Op.edit task ⟨2, 4, 0⟩ (utf8 "x2") (text "dawn")]).mapIdx
    fun i (o : Op Value) => opCallVector s!"the call of op {i}, a {o.core.name}" o)

def lowerVectors : List Json :=
  lowerExamples ++ (List.range generated).map fun i => opCallVector s!"seed {i + 1}" (randomOp (Rng.seed (i + 1 + 9500))).1

def kindName : Docs.ChangeKind → String
  | .new => "new"
  | .edited => "edited"
  | .gone => "gone"

def changeJson (c : Docs.RecordChange) : Json :=
  Json.mkObj [("id", toJson (hex c.id)), ("type", Json.arr (#[toJson c.type.type.text] ++ (c.type.schema.map fun h => toJson h.text).toArray)), ("kind", toJson (kindName c.kind)),
    ("fields", Json.arr (c.fields.map fun (f, v) => match v with
      | some x => Json.arr #[toJson (utf8Text f), x.json]
      | none => Json.arr #[toJson (utf8Text f)]).toArray)]

/-- Records before and after, and a footprint; the changes a reader sees, under `ver` (every type at one schema), and
the verdict's footprint part on them. -/
def checkVector (name : String) (before after : List (Record Value)) (fp : List Step) : Json :=
  let cs := changesFrom ver before after
  vector name (Json.mkObj [("schema", toJson (blake3 (utf8 "schema:v1")).text),
      ("before", Json.arr (before.map recordJson).toArray), ("after", Json.arr (after.map recordJson).toArray),
      ("footprint", Json.arr (fp.map stepJson).toArray)])
    (Json.mkObj [("changes", Json.arr (cs.map changeJson).toArray), ("verdict", toJson (verdictFootprint ver fp before after))])

/-- A commit's changes against its own footprint, `tamper` applied to what it made: none for an honest writer. -/
def commitCheck (name : String) (w c : Nat) (s : List (Record Value)) (ops : List (Op Value))
    (tamper : List (Record Value) → List (Record Value) := id) : Option Json :=
  match commit valEq ofId w c s ops with
  | .ok s' => some (checkVector name s (tamper s') (footprint ops))
  | .error _ => none

/-- Retitle the first Record: a write no tick's footprint makes. -/
def retitle : List (Record Value) → List (Record Value)
  | r :: rs => { r with fields := setFields r.fields (rows [("x2", text "tampered")]) } :: rs
  | [] => []

def changesExamples : List Json := [
  commitCheck "I ate 2 bananas" 1 7 [] bananas,
  commitCheck "tick one task done" 1 8 todo tick,
  commitCheck "rename a task" 1 8 todo
    [.patch task (rows [("x2", text "Order seeds")]) (rows [("x2", text "Order bean seeds")])],
  commitCheck "remove done tasks" 1 9 todo (tick ++ [.remove task (rows [("done", .uint 1)])]),
  commitCheck "edit a title" 2 5 todo [.edit task ⟨2, 4, 0⟩ (utf8 "x2") (text "Water the beans at dawn")],
  commitCheck "a tick that also renames: beyond its footprint" 1 8 todo tick retitle,
  commitCheck "a tick that also drops the other task: beyond its footprint" 1 8 todo tick (·.take 1),
  commitCheck "nothing changes" 1 8 todo []].filterMap id

def randomChangesVector (seed : Nat) : Option Json := Id.run do
  let r := Rng.seed (seed + 9700)
  let (n, r) := r.below 5
  let mut r := r
  let mut ops := #[]
  for _ in [0:n + 1] do
    let (op, r') := randomOp r
    ops := ops.push op
    r := r'
  let (c, r1) := r.below 9
  let (t, _) := r1.below 3
  let tamper : List (Record Value) → List (Record Value) := if t = 0 then retitle else if t = 1 then (·.drop 1) else id
  return commitCheck s!"seed {seed}" 1 c todo ops.toList tamper

def changeVectors : List Json :=
  changesExamples ++ ((List.range (4 * generated)).filterMap fun i => randomChangesVector (i + 1)).take generated

def rename : List (Op Value) := [.patch task [] (rows [("x2", text "Order bean seeds")])]

def mergeCheckExamples : List Json := [
  checkVector "the settling tick alone, against the proposal: passes" proposal merged (footprint settle),
  checkVector "the whole merge on main, with only the tick's footprint: refused" mainBefore merged (footprint settle),
  checkVector "the whole merge on main, with the rename's call too: passes" mainBefore merged
    (footprint (settle ++ rename)),
  checkVector "a task retyped as a note: refused, whatever the footprint" todo retyped (footprint tick)]

/-- The steps a merge's footprint is drawn from. -/
def gSteps : List Step := [⟨task, .patch, [utf8 "done"]⟩, ⟨task, .patch, [utf8 "x2"]⟩,
  ⟨task, .putNew, [utf8 "x2", utf8 "done"]⟩, ⟨task, .remove, []⟩, ⟨note, .putNew, [utf8 "x1"]⟩,
  ⟨note, .edit, [utf8 "x1"]⟩]

/-- Main's Records, with distinct ids; the merged Records: each of main's kept, changed or dropped, and new ones. -/
def randomMergeVector (seed : Nat) : Json := Id.run do
  let r := Rng.seed (seed + 9800)
  let (n, r) := r.below 4
  let mut r := r
  let mut main := #[]
  let mut merged := #[]
  for i in [0:n] do
    let (ty, r1) := pick r [task, note] task
    let (d, r2) := r1.below 2
    let rec0 : Record Value := ⟨⟨1, 1, i⟩, ty, rows [("x1", text s!"r{i}"), ("done", .uint d)]⟩
    main := main.push rec0
    let (fate, r3) := r2.below 5
    if fate = 0 then merged := merged.push rec0
    else if fate = 1 then merged := merged.push { rec0 with fields := setFields rec0.fields (rows [("done", .uint 1)]) }
    else if fate = 2 then merged := merged.push { rec0 with fields := setFields rec0.fields (rows [("x1", text "new")]) }
    else if fate = 3 then merged := merged.push { rec0 with fields := rec0.fields.filter (·.1 != utf8 "done") }
    r := r3
  let (m, r') := r.below 3
  r := r'
  for j in [0:m] do
    let (ty, r') := pick r [task, note] task
    merged := merged.push ⟨⟨2, 1, j⟩, ty, rows [("x1", text s!"n{j}")]⟩
    r := r'
  let (fp, _) := subset r gSteps
  return checkVector s!"seed {seed}" main.toList merged.toList fp

def mergeChecks : List Json := mergeCheckExamples ++ (List.range generated).map fun i => randomMergeVector (i + 1)

def gInvoices (r : Rng) (docs : List DocId) : List (Rec Value) × Rng := Id.run do
  let mut r := r
  let mut out := #[]
  for d in docs do
    let (c, r1) := pick r ["ana", "ben", "cai"] "ana"
    let (t, r2) := r1.below 5
    let (twice, r3) := r2.below 4
    out := out.push (⟨d, invoice, rows [("customer", text c), ("total", .uint (100 * t))]⟩ : Rec Value)
    if twice = 0 then out := out.push ⟨d, invoice, rows [("customer", text c), ("total", .uint (100 * t + 50))]⟩
    r := r3
  return (out.toList, r)

def randomIndexVector (seed : Nat) : Json := Id.run do
  let r := Rng.seed (seed + 9500)
  let all := (List.range 6).map inv
  let (docsV, r1) := subset r all
  let (dbV, r2) := gInvoices r1 docsV
  let (unfolded, r3) := subset r2 all
  -- what the directory lists now: everything listed at V or unfolded, minus unfolded Docs that went
  let (gone, r4) := subset r3 unfolded
  let now := all.filter fun d => (docsV.contains d || unfolded.contains d) && !gone.contains d
  let (fresh, r5) := gInvoices r4 (unfolded.filter now.contains)
  let db := dbV.filter (fun x => !unfolded.contains x.doc) ++ fresh
  let (c, r6) := pick r5 ["ana", "ben", "cai"] "ana"
  let (lo, r7) := r6.below 5
  let (ranged, _) := r7.below 2
  let p : Probe Value := ⟨[text c], if ranged = 0 then none else some (.uint (100 * lo), .uint 10000)⟩
  return indexVector s!"seed {seed}" byCustomer dbV db docsV unfolded now p

def lookups : List Json := indexExamples ++ (List.range generated).map fun i => randomIndexVector (i + 1)

end Engine

/-! ## Docs: sealed indexes (`Aven.DB.Docs.Index`) -/

/-- The vectors' boundary, the spec's rule with fewer bits: an entry whose BLAKE3's first byte has its low 2 bits zero
ends its node (about four entries a node; the spec uses 6 bits). Any rule on the entry alone keeps the theorems. -/
def indexBoundary (e : List UInt8) : Bool := ((Aven.Core.Blake3.digest e).headD 0).toNat % 4 == 0

open Docs.Key in
def Aven.DB.Docs.Key.Field.json : Field → Json
  | .bytes b => Json.mkObj [("bytes", Aven.Core.hex b)]
  | .text b => String.fromUTF8! ⟨b.toArray⟩
  | .nint n => toJson (-(n : Int) - 1)
  | .uint n => toJson n

open Docs.Key in
def keyCases : List (String × List Field) := [
  ("an unsigned integer", [.uint 1000]), ("a negative integer", [.nint 4]),
  ("text with a zero byte", [.text [0x61, 0x00, 0x62]]), ("text, then a number", [.text "Acme".toUTF8.toList, .uint 7]),
  ("bytes", [.bytes [0x00, 0xFF]]), ("nothing", [])]

open Docs.Key in
def keyPairs : List (String × List Field × List Field) := [
  ("shorter text first by code point, not by length", [.text "b".toUTF8.toList], [.text "ab".toUTF8.toList]),
  ("a prefix first", [.text "Acme".toUTF8.toList], [.text "Acme".toUTF8.toList, .uint 1]),
  ("negatives before positives", [.nint 0], [.uint 0]),
  ("-5 before -1", [.nint 4], [.nint 0]),
  ("255 before 256", [.uint 255], [.uint 256]),
  ("a zero byte inside text", [.text [0x61, 0x00]], [.text [0x61]])]

open Docs.Key in
def keys : List Json :=
  (keyCases.map fun (name, t) => vector name (Json.arr (t.map Field.json).toArray) (Aven.Core.hex (keyBytes t))) ++
  keyPairs.map fun (name, a, b) =>
    vector name (Json.arr #[Json.arr (a.map Field.json).toArray, Json.arr (b.map Field.json).toArray])
      (toJson (Aven.Core.lexLt (keyBytes a) (keyBytes b)))

open Docs.Key in
/-- Invoices by vendor and total, each its Doc's entry. -/
def invoices : List (List Field × String) := [
  ([.text "Acme".toUTF8.toList, .uint 120], "d:01"), ([.text "Bolt".toUTF8.toList, .uint 40], "d:02"),
  ([.text "Acme".toUTF8.toList, .uint 7], "d:03"), ([.text "Ab".toUTF8.toList, .uint 900], "d:04"),
  ([.text "Acme".toUTF8.toList, .uint 3000], "d:05"), ([.text "Zed".toUTF8.toList, .uint 1], "d:06")]

open Docs.Key in
def invoiceEntry (fs : List Field) (doc : String) : List UInt8 := entry fs ⟨⟨doc.toUTF8.toList⟩⟩

open Docs.Key in
def indexCases : List (String × List (List Field × String) × Nat × List Field) := [
  ("Acme's invoices, by total", invoices, 64, [.text "Acme".toUTF8.toList]),
  ("the same entries, another order", invoices.reverse, 64, [.text "Acme".toUTF8.toList]),
  ("small nodes, cut by size", invoices, 40, [.text "Acme".toUTF8.toList]),
  ("one entry twice, folded once", invoices ++ invoices.take 1, 64, [.text "Bolt".toUTF8.toList])]

open Docs.Key in
def indexes : List Json :=
  indexCases.map fun (name, es, limit, pre) =>
    let bs := es.map fun (fs, d) => invoiceEntry fs d
    let lo := keyBytes pre
    let hi := lo ++ [0xFF]
    let shown (b : List UInt8) : Json :=
      match es.find? (fun (fs, d) => invoiceEntry fs d == b) with
      | some (fs, d) => Json.arr ((fs.map Field.json) ++ [Json.str d]).toArray
      | none => Aven.Core.hex b
    let nodes := Docs.Index.chunks indexBoundary List.length limit (Docs.Index.entries bs)
    let found := Docs.Index.lookup indexBoundary List.length limit lo hi bs
    vector name (Json.mkObj [("entries", Json.arr (bs.map shown).toArray), ("limit", toJson limit),
        ("prefix", Json.arr (pre.map Field.json).toArray)])
      (Json.mkObj [("nodes", Json.arr (nodes.map fun n => Json.arr (n.map shown).toArray).toArray),
        ("found", Json.arr (found.map shown).toArray)])

/-- Forty invoices, enough for a tree of several levels: vendor `v<i mod 5>`, total `i × 37`, Doc `d:<i>`. -/
def manyInvoices : List (List Docs.Key.Field × String) :=
  (List.range 40).map fun i =>
    ([.text s!"v{i % 5}".toUTF8.toList, .uint (i * 37)], s!"d:{if i < 10 then "0" else ""}{i}")

open Docs.Key in
def treeCases : List (String × List (List Field × String) × Nat × List Field) := [
  ("forty invoices, one vendor's", manyInvoices, 4096, [.text "v3".toUTF8.toList]),
  ("the same, another order", manyInvoices.reverse, 4096, [.text "v3".toUTF8.toList]),
  ("six invoices, two leaves", invoices, 4096, [.text "Acme".toUTF8.toList])]

/-- The store a reader holds after fetching every node of a fold, by name. -/
def storeOf (lvls : List (List (List Aven.Core.Value))) (h : Aven.Core.Hash) : Option Aven.Core.Value :=
  (lvls.flatten.map Aven.Core.Value.array).find? fun v => decide (Aven.Core.nameOf Aven.Core.blake3 v = h)

def hexJson (b : List UInt8) : Json := Json.str (Aven.Core.hex b)

open Docs.Key Docs.Index in
def trees : List Json :=
  treeCases.map fun (name, es, limit, pre) =>
    let bs := es.map fun (fs, d) => invoiceEntry fs d
    let lo := keyBytes pre
    let hi := lo ++ [0xFF]
    let lvls := levels indexBoundary List.length limit Aven.Core.blake3 bs
    let r := root indexBoundary List.length limit Aven.Core.blake3 bs
    let top := (lvls.getLast?.bind List.head?).getD []
    let walked := top.flatMap (walk (storeOf lvls) lo hi (lvls.length - 1))
    vector name (Json.mkObj [("entries", Json.arr (bs.map hexJson).toArray), ("limit", toJson limit),
        ("range", Json.arr #[hexJson lo, hexJson hi])])
      (Json.mkObj [("levels", Json.arr (lvls.map fun lv =>
          Json.arr (lv.map fun n => hexJson (Aven.Core.encode (.array n))).toArray).toArray),
        ("root", hexJson r.bytes), ("walked", Json.arr (walked.map hexJson).toArray)])

open Docs.Key Docs.Index in
/-- A walk from the root through the fetched nodes finds what the flat lookup finds, in every tree vector. -/
def treesAgree : Bool :=
  treeCases.all fun (_, es, limit, pre) =>
    let bs := es.map fun (fs, d) => invoiceEntry fs d
    let lo := keyBytes pre
    let lvls := levels indexBoundary List.length limit Aven.Core.blake3 bs
    let top := (lvls.getLast?.bind List.head?).getD []
    top.flatMap (walk (storeOf lvls) lo (lo ++ [0xFF]) (lvls.length - 1)) ==
      lookup indexBoundary List.length limit lo (lo ++ [0xFF]) bs

#guard treesAgree

/-- A peer that answers every name with a forged leaf holding one entry in the range: the reader refuses the forged
nodes (their hash isn't the name asked for), so the walk finds nothing it shouldn't, here nothing at all. -/
def forged (lo : List UInt8) (_ : Aven.Core.Hash) : Option Aven.Core.Value :=
  some (.array [.bytes (lo ++ [0x01]), .bytes (lo ++ [0x01]), .bytes []])

open Docs.Key Docs.Index in
def treesForged : Bool :=
  treeCases.all fun (_, es, limit, pre) =>
    let bs := es.map fun (fs, d) => invoiceEntry fs d
    let lo := keyBytes pre
    let lvls := levels indexBoundary List.length limit Aven.Core.blake3 bs
    let top := (lvls.getLast?.bind List.head?).getD []
    let walked := top.flatMap (walk (verify Aven.Core.blake3 (forged lo)) lo (lo ++ [0xFF]) (lvls.length - 1))
    walked.all fun x => (lookup indexBoundary List.length limit lo (lo ++ [0xFF]) bs).contains x

#guard treesForged

/-! ## Docs: writer ids, envelopes' op ids, checkpoints, fit -/

section DocsVectors

open Aven.Core

def docOf (s : String) : DocId := ⟨blake3 s.toUTF8.toList⟩

def natJson (n : Nat) : Json := Json.str (toString n)

/-- Writer ids: the derivation's input, its output and the id, for devices, Docs, branches and generations. -/
def writerCases : List (String × Docs.WriterIn) := [
  ("a device on main", ⟨List.replicate 32 7, docOf "a Doc's genesis", "main".toUTF8.toList, 0⟩),
  ("the same device, another Doc", ⟨List.replicate 32 7, docOf "another Doc's genesis", "main".toUTF8.toList, 0⟩),
  ("the same device, a proposal", ⟨List.replicate 32 7, docOf "a Doc's genesis", "proposal/1".toUTF8.toList, 0⟩),
  ("the same device, its next generation", ⟨List.replicate 32 7, docOf "a Doc's genesis", "main".toUTF8.toList, 1⟩),
  ("another device", ⟨List.replicate 32 8, docOf "a Doc's genesis", "main".toUTF8.toList, 0⟩)]

def writers : List Json :=
  writerCases.map fun (name, w) =>
    vector name (Json.mkObj [("device", hexJson w.device), ("doc", Json.str w.doc.text),
        ("branch", Json.str (String.fromUTF8! ⟨w.branch.toArray⟩)), ("generation", toJson w.generation)])
      (Json.mkObj [("input", hexJson (Docs.writerInput w)),
        ("derived", hexJson (Blake3.deriveKey "avenDB writer 1" (Docs.writerInput w))),
        ("writer", natJson (Docs.writer w))])

#guard (writerCases.map fun (_, w) => Docs.writer w).Nodup

/-- Envelopes of one Doc, with the op ids a reader learns of each: its last op, and the Loro dependencies it carries. -/
def opEnv (writer seq : Nat) (prev : Option Hash) (deps : List Hash) (post : String) : Envelope :=
  ⟨docOf "a Doc's genesis", "main".toUTF8.toList, writer, seq, prev, deps,
    .map [("post".toUTF8.toList, .text post.toUTF8.toList)], [⟨List.replicate 32 7, List.replicate 64 9⟩]⟩

def a1 : Envelope := opEnv 1 1 none [] "first"
def b1 : Envelope := opEnv 2 1 none [] "another writer's first"
def a2 : Envelope := opEnv 1 2 (some (a1.name blake3)) [b1.name blake3] "builds on both"
def a2gone : Envelope := opEnv 1 2 (some (a1.name blake3)) [blake3 "nothing held".toUTF8.toList] "names what isn't held"

/-- Each envelope's last op id, (writer id, counter). -/
def lastOf (e : Envelope) : Docs.OpId :=
  let n := e.name blake3
  if n = a1.name blake3 then (1, 3) else if n = b1.name blake3 then (2, 0) else if n = a2.name blake3 then (1, 5)
  else (1, 9)

def opCases : List (String × List Envelope × Envelope × List Docs.OpId × List (Envelope × Docs.OpId)) := [
  ("deps are the last ops of what it names", [a1, b1], a2, [(1, 3), (2, 0)], []),
  ("a dep that isn't the last op of what it names", [a1, b1], a2, [(1, 2), (2, 0)], []),
  ("deps in another order than the names", [a1, b1], a2, [(2, 0), (1, 3)], []),
  ("names an envelope the reader doesn't hold", [a1, b1], a2gone, [(1, 3)], []),
  ("two envelopes held with one last op id", [a1, b1], a2, [(1, 3), (2, 0)], [(b1, (1, 3))])]

def envelopes : List Json :=
  opCases.map fun (name, held, e, deps, clash) =>
    let last := fun x => match clash.find? (fun c => c.1.name blake3 == x.name blake3) with
      | some (_, o) => o
      | none => lastOf x
    let O : Docs.Ops := ⟨last, fun x => if x.name blake3 = e.name blake3 then deps else []⟩
    let opJson (o : Docs.OpId) : Json := Json.arr #[toJson o.1, toJson o.2]
    let envJson (x : Envelope) : Json := Json.mkObj [("name", Json.str (x.name blake3).text),
      ("named", Json.arr ((Docs.namedPast x).map fun h => Json.str h.text).toArray), ("last", opJson (last x))]
    let verdict := if !Docs.usedOk O (held ++ [e]) then "refused: an op id used twice"
      else if (Docs.resolveAll (Envelope.name blake3) held (Docs.namedPast e)).isNone then "waits: names what isn't held"
      else if Docs.opsAgreeB (Envelope.name blake3) O held e then "agrees" else "refused: op ids and hashes disagree"
    vector name (Json.mkObj [("held", Json.arr (held.map envJson).toArray), ("envelope", envJson e),
        ("deps", Json.arr (deps.map opJson).toArray)])
      (Json.str verdict)

/-- A toy CRDT for the checkpoint vectors: the state is the sum of the envelopes' sequence numbers, in any order. -/
def sumLoro : Docs.Loro Nat := ⟨0, fun s e => s + e.seq, fun s a b => Nat.add_right_comm s a.seq b.seq⟩

def runtimeA : Hash := blake3 "runtime a".toUTF8.toList
def vaultW : List UInt8 := "writer's vault".toUTF8.toList
def mayWrite (v : List UInt8) (_ : List Hash) : Bool := v == vaultW

def honestCp : Docs.Checkpoint :=
  ⟨[a2.name blake3], [a1, b1, a2], nameOf blake3 (.uint (sumLoro.replay [a1, b1, a2])), runtimeA, vaultW⟩

def cpCases : List (String × Docs.Checkpoint) := [
  ("honest: its tips covered, its state the replay, by the reader's runtime, from a writer", honestCp),
  ("a state that isn't the replay", { honestCp with state := nameOf blake3 (.uint 99) }),
  ("made by another runtime", { honestCp with runtime := blake3 "runtime b".toUTF8.toList }),
  ("a tip it doesn't cover", { honestCp with version := [blake3 "elsewhere".toUTF8.toList] }),
  ("signed by a vault that may not write the Doc", { honestCp with vault := "a reader's vault".toUTF8.toList })]

def checkpoints : List Json :=
  cpCases.map fun (name, cp) =>
    let checks := cp.check sumLoro (fun s => .uint s) blake3 runtimeA
    let taken := !(Docs.takenCheckpoints mayWrite [cp]).isEmpty
    vector name (Json.mkObj [("version", Json.arr (cp.version.map fun h => Json.str h.text).toArray),
        ("covers", Json.arr (cp.covers.map fun x => Json.str (x.name blake3).text).toArray),
        ("state", Json.str cp.state.text), ("runtime", Json.str cp.runtime.text),
        ("vault", Json.str (String.fromUTF8! ⟨cp.vault.toArray⟩)),
        ("readerRuntime", Json.str runtimeA.text), ("writers", Json.arr #[Json.str "writer's vault"])])
      (Json.mkObj [("taken", toJson taken), ("checks", toJson checks), ("accepted", toJson (taken && checks))])

/-- Fit: each envelope names its schema; `v1` allows totals up to 100, `v2` up to 1000. -/
def fitRule (schema : String) (_ : String) (v : Nat) : Bool := if schema == "v1" then v ≤ 100 else v ≤ 1000

def fitCases : List (String × List (Docs.Changes String String Nat)) := [
  ("two writers, one schema: the later write wins and fits",
    [⟨"v1", [⟨"total", ⟨1, 40⟩⟩]⟩, ⟨"v1", [⟨"total", ⟨2, 90⟩⟩]⟩]),
  ("a v2 writer and a v1 writer: the value fits the schema of the envelope that wrote it",
    [⟨"v1", [⟨"total", ⟨1, 40⟩⟩]⟩, ⟨"v2", [⟨"total", ⟨2, 500⟩⟩]⟩]),
  ("an envelope that doesn't fit its schema is refused, and its write never merges",
    [⟨"v1", [⟨"total", ⟨1, 40⟩⟩]⟩, ⟨"v1", [⟨"total", ⟨2, 500⟩⟩]⟩])]

def fit : List Json :=
  fitCases.map fun (name, es) =>
    let fits (e : Docs.Changes String String Nat) : Bool := e.changes.all fun c => fitRule e.schema c.field c.write.value
    let kept := es.filter fits
    let merged := Docs.latest (Docs.writesOf "total" kept)
    let chJson (e : Docs.Changes String String Nat) : Json := Json.mkObj [("schema", Json.str e.schema),
      ("writes", Json.arr (e.changes.map fun c => Json.mkObj [("field", Json.str c.field),
        ("stamp", toJson c.write.stamp), ("value", toJson c.write.value)]).toArray)]
    vector name (Json.mkObj [("envelopes", Json.arr (es.map chJson).toArray),
        ("rules", Json.mkObj [("v1", Json.str "total ≤ 100"), ("v2", Json.str "total ≤ 1000")])])
      (Json.mkObj [("fits", Json.arr (es.map fun e => toJson (fits e)).toArray),
        ("total", match merged with
          | some w => Json.mkObj [("value", toJson w.value.2), ("schema", Json.str w.value.1),
              ("fits", toJson (fitRule w.value.1 "total" w.value.2))]
          | none => Json.null)])

/-! ### Logs and counts, as readers hold envelopes over time -/

def lx1 : Envelope := opEnv 1 1 none [] "first"
def lx2 : Envelope := opEnv 1 2 (some (lx1.name blake3)) [] "second"
def lx2' : Envelope := opEnv 1 2 (some (lx1.name blake3)) [] "a copy of the second says otherwise"
def ly1 : Envelope := opEnv 2 1 none [lx2.name blake3] "builds on the second"
def lz1 : Envelope := opEnv 3 1 none [lx2'.name blake3] "builds on the copy"
def lx3 : Envelope := opEnv 1 3 (some (lx2.name blake3)) [] "the stuck log goes on"
def lw1 : Envelope := opEnv 4 1 none [ly1.name blake3] "builds on the other writer"

def labelled : List (String × Envelope) :=
  [("x1", lx1), ("x2", lx2), ("x2'", lx2'), ("y1", ly1), ("z1", lz1), ("x3", lx3), ("w1", lw1)]

def labelOf (e : Envelope) : String :=
  match labelled.find? (fun (_, x) => x.name blake3 == e.name blake3) with
  | some (l, _) => l
  | none => "?"

def envSummary (l : String) (e : Envelope) : Json :=
  Json.mkObj [("label", Json.str l), ("name", Json.str (e.name blake3).text), ("writer", toJson e.writer),
    ("seq", toJson e.seq), ("prev", match e.prev with | some h => Json.str (labelOf' h) | none => Json.null),
    ("deps", Json.arr (e.deps.map fun h => Json.str (labelOf' h)).toArray)]
where labelOf' (h : Hash) : String :=
  match labelled.find? (fun (_, x) => x.name blake3 == h) with
  | some (l, _) => l
  | none => h.text

/-- What a reader holding `S` sees of each envelope: whether it counts, and whether it is half of a split it holds. -/
def readerView (S : List Envelope) (ok : Envelope → Bool) : Json :=
  Json.mkObj (S.map fun e => (labelOf e, Json.mkObj [("counts", toJson (Docs.countsB (Envelope.name blake3) ok (fun _ => true) S e)),
    ("split", toJson (S.any fun y => Docs.splitB (Envelope.name blake3) e y))]))

def logSteps : List (String × List Envelope × List Envelope) := [
  ("before they sync: each holds one side", [lx1, lx2, ly1], [lx1, lx2', lz1]),
  ("after they sync: both hold both sides", [lx1, lx2, ly1, lx2', lz1], [lx1, lx2', lz1, lx2, ly1]),
  ("the stuck log goes on: its next envelope never counts", [lx1, lx2, ly1, lx2', lz1, lx3],
    [lx1, lx2', lz1, lx2, ly1, lx3])]

def logs : List Json :=
  logSteps.map fun (name, a, b) =>
    vector name (Json.mkObj [("envelopes", Json.arr (labelled.map fun (l, e) => envSummary l e).toArray),
        ("readerA", Json.arr (a.map fun e => Json.str (labelOf e)).toArray),
        ("readerB", Json.arr (b.map fun e => Json.str (labelOf e)).toArray)])
      (Json.mkObj [("readerA", readerView a fun _ => true), ("readerB", readerView b fun _ => true)])

/-- Counts: envelopes with their fit and authorized verdicts; which count, and the live state (the toy CRDT's sum of
sequence numbers over what counts). -/
def countHeld : List Envelope := [lx1, lx2, ly1, lw1]

def countCases : List (String × List (String × Bool × Bool)) := [
  ("every verdict holds: all count", []),
  ("an unfit envelope: it and what builds on it don't count", [("y1", false, true)]),
  ("a revocation turns one unauthorized: it and everything after it drop", [("x2", true, false)])]

def counts : List Json :=
  countCases.map fun (name, overrides) =>
    let verdict (e : Envelope) : Bool × Bool :=
      match overrides.find? (·.1 == labelOf e) with
      | some (_, f, a) => (f, a)
      | none => (true, true)
    let counted := countHeld.filter
      (Docs.countsB (Envelope.name blake3) (fun e => (verdict e).1) (fun e => (verdict e).2) countHeld)
    vector name (Json.mkObj [("envelopes", Json.arr (countHeld.map fun e => Json.mkObj [("envelope", envSummary (labelOf e) e),
          ("fit", toJson (verdict e).1), ("authorized", toJson (verdict e).2)]).toArray)])
      (Json.mkObj [("counts", Json.arr (counted.map fun e => Json.str (labelOf e)).toArray),
        ("live", toJson (sumLoro.replay counted))])


/-! ### The formats: genesis, bodies, segments, heads, and rule 7 in Loro's terms -/

def tb (s : String) : List UInt8 := s.toUTF8.toList

def todoType : DocId := docOf "a todo type"

def todoGenesis : Docs.Genesis :=
  ⟨[(todoType, [blake3 (tb "todo v1")])], todoType, List.replicate 32 5, tb "alice's vault"⟩

def genesisCases : List (String × Docs.Genesis) := [
  ("a todo Doc, its type pinned at one version", todoGenesis),
  ("the same, another nonce", ⟨[(todoType, [blake3 (tb "todo v1")])], todoType, List.replicate 32 6,
    tb "alice's vault"⟩),
  ("two versions of two types pinned", ⟨[(docOf "a line type", [blake3 (tb "line v1")]),
    (todoType, [blake3 (tb "todo v1"), blake3 (tb "todo v2")].mergeSort (fun a b => !Aven.Core.lexLt b.bytes a.bytes))].mergeSort
      (fun a b => !Aven.Core.lexLt b.1.hash.bytes a.1.hash.bytes),
    todoType, List.replicate 32 7, tb "bob's vault"⟩),
  ("nothing pinned", ⟨[], todoType, List.replicate 32 8, tb "alice's vault"⟩)]

def genesisJson (g : Docs.Genesis) : Json :=
  Json.mkObj [("vault", hexJson g.vault), ("type", Json.str g.type.text), ("nonce", hexJson g.nonce),
    ("pins", Json.arr (g.pins.map fun (t, hs) => Json.arr #[Json.str t.text,
      Json.arr (hs.map fun h => Json.str h.text).toArray]).toArray)]

def genesisVectors : List Json :=
  (genesisCases.map fun (name, g) =>
    vector name (genesisJson g)
      (Json.mkObj [("value", hexJson (encode g.value)), ("id", Json.str (g.id blake3).text),
        ("ok", toJson (g.ok (Docs.isBuiltin blake3)))])) ++
  [vector "the built-in types" (Json.arr (Docs.builtinNames.map Json.str).toArray)
    (Json.arr (Docs.builtinNames.map fun n => Json.str (Docs.builtinType blake3 n).text).toArray)]

#guard genesisCases.all fun (_, g) => Docs.genesis? g.value == some g
#guard genesisCases.all fun (_, g) => g.ok (Docs.isBuiltin blake3)

def userVersion : Docs.Version := ⟨todoType, some (blake3 (tb "todo v1"))⟩
def builtinVersion : Docs.Version := ⟨Docs.builtinType blake3 "version", none⟩

def firstBody : Docs.Body :=
  { acks := [], time := tb "2026-10-31T12:00:00Z", calls := [⟨CoreOp.patch.id blake3, []⟩],
    cap := some (blake3 (tb "a cap")), changes := [1, 2, 3], generation := 0, opsFrom := 4, opsTo := 9,
    records := [(tb "t1", userVersion)] }

def genesisBody : Docs.Body :=
  { acks := [], time := tb "2026-10-31T12:00:00Z", calls := [⟨CoreOp.put.id blake3, [(tb "title", .text (tb "Order seeds"))]⟩],
    cap := none, changes := [9], generation := 0, opsFrom := 0, opsTo := 3, records := [(tb "root", userVersion)],
    genesis := some todoGenesis }

def builtinBody : Docs.Body :=
  { acks := [blake3 (tb "a revocation")], time := [], calls := [], cap := none, changes := [], generation := 2,
    opsFrom := 17, opsTo := 18, records := [(tb "v1", builtinVersion), (tb "t22", userVersion)] }

def bodyCases : List (String × Docs.Body) := [
  ("one Record, one call", firstBody),
  ("the Doc's first envelope carries its genesis", genesisBody),
  ("a built-in type's Record, an acknowledged revocation, a later generation", builtinBody)]

def bodyJson (b : Docs.Body) : Json :=
  Json.mkObj [("acks", Json.arr (b.acks.map fun h => Json.str h.text).toArray), ("at", Json.str (String.fromUTF8! ⟨b.time.toArray⟩)),
    ("calls", Json.arr (b.calls.map fun c => hexJson (encode c.value)).toArray),
    ("cap", match b.cap with | some h => Json.str h.text | none => Json.null), ("changes", hexJson b.changes),
    ("generation", toJson b.generation), ("from", toJson b.opsFrom), ("to", toJson b.opsTo),
    ("records", Json.arr (b.records.map fun (i, v) => Json.arr #[Json.str (String.fromUTF8! ⟨i.toArray⟩),
      Json.str v.type.text, match v.schema with | some h => Json.str h.text | none => Json.null]).toArray),
    ("genesis", match b.genesis with | some g => hexJson (encode g.value) | none => Json.null)]

/-- Values a reader must refuse as a body. -/
def badBodies : List (String × Value) :=
  let edit (f : List (List UInt8 × Value) → List (List UInt8 × Value)) : Value :=
    match firstBody.value with
    | Value.map kvs => Value.map (f kvs)
    | v => v
  [("ops running backwards", { firstBody with opsFrom := 10 }.value),
   ("a key it doesn't have", edit fun kvs => kvs ++ [(tb "zzzzzzzzzzzzzzz", .null)]),
   ("a key missing", edit fun kvs => kvs.filter (·.1 != tb "acks")),
   ("a cap that isn't a hash", edit fun kvs => kvs.map fun (k, v) => if k == tb "cap" then (k, .bytes [1, 2]) else (k, v)),
   ("a version with a short type", edit fun kvs => kvs.map fun (k, v) =>
      if k == tb "records" then (k, .map [(tb "t1", .array [.bytes [1]])]) else (k, v))]

def bodyVectors : List Json :=
  (bodyCases.map fun (name, b) =>
    vector name (bodyJson b) (Json.mkObj [("value", hexJson (encode b.value)), ("message", Json.str b.message)])) ++
  badBodies.map fun (name, v) =>
    vector s!"refused: {name}" (hexJson (encode v)) (toJson (Docs.Body.ofValue? v).isSome)

#guard bodyCases.all fun (_, b) => (Docs.Body.ofValue? b.value).map (·.value) == some b.value
#guard badBodies.all fun (_, v) => (Docs.Body.ofValue? v).isNone

def segEnvs : List Envelope := [a1, opEnv 1 2 (some (a1.name blake3)) [] "second"]

def segmentCases : List (String × Docs.Segment) := [
  ("two envelopes of writer 1, the log's first segment", ⟨tb "main", 1, 0, 1, 3, none, segEnvs⟩),
  ("a later segment names the one before", ⟨tb "main", 1, 0, 1, 3,
    some ((Docs.Segment.mk (tb "main") 1 0 1 3 none segEnvs).name blake3), segEnvs⟩),
  ("refused: `to` isn't past its last envelope", ⟨tb "main", 1, 0, 1, 4, none, segEnvs⟩),
  ("refused: it doesn't start where it says", ⟨tb "main", 1, 0, 2, 4, none, segEnvs⟩),
  ("refused: another writer's envelope", ⟨tb "main", 1, 0, 1, 3, none, [a1, b1]⟩),
  ("refused: empty", ⟨tb "main", 1, 0, 1, 1, none, []⟩)]

def segmentVectors : List Json :=
  segmentCases.map fun (name, sg) =>
    vector name (Json.mkObj [("branch", Json.str "main"), ("writer", toJson sg.writer),
        ("generation", toJson sg.generation), ("from", toJson sg.segFrom), ("to", toJson sg.segTo),
        ("prev", match sg.prev with | some h => Json.str h.text | none => Json.null),
        ("envelopes", Json.arr (sg.envelopes.map fun e => hexJson (encode e.value)).toArray)])
      (Json.mkObj [("value", hexJson (encode sg.value)), ("name", Json.str (sg.name blake3).text),
        ("ok", toJson (sg.ok Docs.Limits.defaults (Envelope.name blake3)))])

def heldVectors : List Json :=
  let one : Docs.Held := ⟨docOf "a Doc's genesis", [(a1.name blake3, blake3 (encode a1.value)),
    (b1.name blake3, blake3 (encode b1.value)), (a2.name blake3, blake3 (encode a2.value))]⟩
  let twice : Value := .map [(tb "doc", .bytes (docOf "a Doc's genesis").hash.bytes),
    (tb "envelopes", .array [.array [(a1.name blake3).value, (blake3 (encode a1.value)).value],
      .array [(a1.name blake3).value, (blake3 (encode a1.value)).value]])]
  [vector "three envelopes, in the order held" (Json.mkObj [("doc", Json.str one.doc.text),
      ("envelopes", Json.arr (one.envelopes.map fun (n, b) => Json.arr #[Json.str n.text, Json.str b.text]).toArray)])
    (Json.mkObj [("value", hexJson (encode one.value)), ("reads", toJson (Docs.Held.ofValue? one.value).isSome)]),
   vector "refused: an envelope named twice" (hexJson (encode twice)) (toJson (Docs.Held.ofValue? twice).isSome)]

def headVectors : List Json :=
  let h : Docs.Head := ⟨docOf "a Doc's genesis", [(tb "main", [(1, a2.name blake3), (2, b1.name blake3)])]⟩
  [vector "two logs of main" (Json.mkObj [("doc", Json.str h.doc.text),
      ("logs", Json.arr #[Json.arr #[toJson 1, Json.str (a2.name blake3).text],
        Json.arr #[toJson 2, Json.str (b1.name blake3).text]])])
    (Json.mkObj [("value", hexJson (encode h.value)), ("ok", toJson h.ok)])]

/-- Rule 7 on Loro commits: `a2` is writer 1's second commit, its first counter 4, naming `a1` (last op 1@3) and `b1`
(last op 2@0). -/
def loroCases : List (String × Envelope × List Docs.OpId) := [
  ("the writer's own previous op is dominated, so Loro leaves it out", a2, [(2, 0)]),
  ("the writer's own previous op is in the change's deps", a2, [(1, 3), (2, 0)]),
  ("the change's deps in another order", a2, [(2, 0), (1, 3)]),
  ("an older op of its own writer", a2, [(1, 2), (2, 0)]),
  ("a dependency it names isn't in the change", a2, []),
  ("it names what the reader doesn't hold", a2gone, [(2, 0)])]

def loroVectors : List Json :=
  loroCases.map fun (name, e, frontier) =>
    let opJson (o : Docs.OpId) : Json := Json.arr #[toJson o.1, toJson o.2]
    vector name (Json.mkObj [("held", Json.arr ([a1, b1].map fun x =>
          Json.mkObj [("name", Json.str (x.name blake3).text), ("last", opJson (lastOf x))]).toArray),
        ("writer", toJson e.writer), ("start", toJson 4),
        ("named", Json.arr ((Docs.namedPast e).map fun h => Json.str h.text).toArray),
        ("frontier", Json.arr (frontier.map opJson).toArray)])
      (Json.mkObj [("carried", match Docs.carriedDeps e.writer 4 frontier with
          | some c => Json.arr (c.map opJson).toArray | none => Json.null),
        ("verdict", Json.str (Docs.loroAgrees (Envelope.name blake3) lastOf [a1, b1] e 4 frontier).text)])

/-- Where the genesis rides: exactly in a log's first envelope. -/
def placementCases : List (String × Envelope × Bool) := [
  ("a log's first envelope with the genesis", a1, true),
  ("a log's first envelope without it", a1, false),
  ("a later envelope with the genesis", a2, true),
  ("a later envelope without it", a2, false),
  ("a first sequence number that builds on another log, with the genesis", ly1, true),
  ("a first sequence number that builds on another log, without it", ly1, false)]

def placementVectors : List Json :=
  (placementCases.map fun (name, e, carries) =>
    let b : Docs.Body := { firstBody with genesis := if carries then some todoGenesis else none }
    vector name (Json.mkObj [("seq", toJson e.seq), ("prev", toJson e.prev.isSome), ("deps", toJson e.deps.length),
        ("genesis", toJson carries)])
      (Json.mkObj [("first", toJson (Docs.isFirst e)), ("placed", toJson (Docs.genesisPlaced e b))])) ++
  /- the genesis a first envelope carries must name the envelope's Doc -/
  ([("its own Doc's genesis", ({ a1 with doc := todoGenesis.id blake3 } : Envelope), todoGenesis),
    ("another Doc's genesis", ({ a1 with doc := todoGenesis.id blake3 } : Envelope),
      { todoGenesis with nonce := List.replicate 32 6 })] : List (String × Envelope × Docs.Genesis)).map
    fun (name, e, g) =>
      let b : Docs.Body := { firstBody with genesis := some g }
      vector s!"a log's first envelope carrying {name}" (Json.mkObj [("doc", Json.str e.doc.text),
          ("genesis", hexJson (encode g.value))])
        (Json.mkObj [("ok", toJson (Docs.genesisOk blake3 e b))])

def builtinCases : List (String × String × Value) :=
  let h := Value.bytes (blake3 (tb "a tip")).bytes
  let sc := (⟨tb "todo", [(tb "title", .text, true)], true⟩ : Docs.Schema).value
  [("version", "a named version", .map [(tb "at", .array [h]), (tb "name", .text (tb "v1"))]),
   ("version", "refused: no name", .map [(tb "at", .array [h])]),
   ("version", "refused: a field it doesn't have", .map [(tb "x", .null), (tb "at", .array [h]), (tb "name", .text (tb "v1"))]),
   ("version", "refused: a tip that isn't a hash", .map [(tb "at", .array [.bytes [1]]), (tb "name", .text (tb "v1"))]),
   ("version", "refused: a schema, which only a type Doc's version carries",
      .map [(tb "at", .array [h]), (tb "name", .text (tb "v1")), (tb "schema", sc)]),
   ("schema", "a type Doc's version with its schema", .map [(tb "at", .array [h]), (tb "name", .text (tb "v1")), (tb "schema", sc)]),
   ("schema", "refused: no schema", .map [(tb "at", .array [h]), (tb "name", .text (tb "v1"))]),
   ("schema", "refused: a schema not in its one form", .map [(tb "at", .array [h]), (tb "name", .text (tb "v1")),
      (tb "schema", .map [(tb "title", .text (tb "todo"))])]),
   ("schema", "refused: no name", .map [(tb "at", .array [h]), (tb "schema", sc)]),
   ("branch", "a proposal", .map [(tb "base", .array [h]), (tb "name", .text (tb "seeds")), (tb "nonce", h)]),
   ("branch", "a variant that follows main", .map [(tb "base", .array [h]), (tb "name", .text (tb "v")), (tb "nonce", h),
      (tb "follows", .text (tb "main"))]),
   ("branch", "refused: no nonce", .map [(tb "base", .array [h]), (tb "name", .text (tb "seeds"))]),
   ("closed", "closed, with nothing more", .map []),
   ("closed", "closed at its tips", .map [(tb "at", .array [h])]),
   ("split", "a writer's split", .map [(tb "after", h), (tb "writer", .uint 7)]),
   ("split", "refused: a writer that isn't a number", .map [(tb "after", h), (tb "writer", .text (tb "7"))]),
   ("split", "refused: not a map", .array [])]

#guard builtinCases.all fun (_, _, v) => decodeAll (encode v) == some v

def builtinVectors : List Json :=
  (builtinCases.map fun (ty, name, v) =>
    let t := Docs.builtinType blake3 ty
    vector s!"{ty}: {name}" (Json.mkObj [("type", Json.str t.text), ("record", hexJson (encode v))])
      (Json.mkObj [("new", toJson (Docs.builtinFits (Docs.docsBuiltinFit blake3) t .new
          (match v with | .map fs => fs | _ => []))),
        ("fits", toJson ((Docs.docsBuiltinFit blake3 t).map (· v)))])) ++
  [vector "another Doc's type is no docs built-in" (Json.mkObj [("type", Json.str todoType.text)])
    (toJson (Docs.docsBuiltinFit blake3 todoType).isSome)]

open Docs in
def schemaCases : List (String × Value) :=
  let todo : Schema := ⟨tb "todo", [(tb "title", .text, true), (tb "done", .bool, false),
    (tb "tags", .array .text, false), (tb "count", .uint 100, false), (tb "owner", .hash, false),
    (tb "blob", .bytes, false), (tb "extra", .any, false)], true⟩
  let field (n : String) (kind : Value) (r : Bool) : Value := .array [.text (tb n), kind, .bool r]
  let form (fs : List Value) : Value :=
    .map [(tb "title", .text (tb "t")), (tb "closed", .bool false), (tb "fields", .array fs)]
  [("a todo, every kind", todo.value),
   ("an open schema with no fields", (⟨tb "anything", [], false⟩ : Schema).value),
   ("lists of lists of bounded numbers",
      (⟨tb "grid", [(tb "rows", .array (.array (.uint 9)), true)], true⟩ : Schema).value),
   ("refused: a field named twice", form [field "a" (.text (tb "text")) true, field "a" (.text (tb "bool")) false]),
   ("refused: a kind it doesn't have", form [field "a" (.text (tb "float")) true]),
   ("refused: a bound that isn't a number", form [field "a" (.array [.text (tb "uint"), .text (tb "9")]) true]),
   ("refused: uint without its bound", form [field "a" (.array [.text (tb "uint")]) true]),
   ("refused: a field without required", form [.array [.text (tb "a"), .text (tb "text")]]),
   ("refused: required that isn't a bool", form [.array [.text (tb "a"), .text (tb "text"), .text (tb "yes")]]),
   ("refused: a key it doesn't have",
      .map [(tb "title", .text (tb "t")), (tb "closed", .bool false), (tb "fields", .array []), (tb "lenses", .array [])]),
   ("refused: no title", .map [(tb "closed", .bool false), (tb "fields", .array [])]),
   ("refused: not a map", .array [])]

#guard schemaCases.all fun (_, v) => decodeAll (encode v) == some v

/-- Schemas' one form: which Values a reader takes (`Schema.ofValue?`), and a taken one's hash, the schema half of a
type id. -/
def schemaVectors : List Json :=
  schemaCases.map fun (name, v) =>
    vector s!"schema: {name}" (Json.mkObj [("value", hexJson (encode v))])
      (match Docs.Schema.ofValue? v with
        | some s => Json.mkObj [("ok", true), ("hash", hexJson (Docs.Schema.hash blake3 s).bytes)]
        | none => Json.mkObj [("ok", false)])

end DocsVectors

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  for (file, vs) in [("status.json", status), ("timeline.json", timeline),
      ("store.json", store), ("hashes.json", hashes), ("refs.json", refs),
      ("chat.json", chat), ("files.json", files), ("chats.json", chats), ("queries.json", queries),
      ("wants.json", wants), ("mutations.json", mutations), ("merges.json", merges), ("lenses.json", lenses),
      ("indexes.json", indexes), ("trees.json", trees), ("lookups.json", lookups), ("keys.json", keys), ("writers.json", writers), ("envelopes.json", envelopes),
      ("checkpoints.json", checkpoints), ("fit.json", fit), ("logs.json", logs),
      ("counts.json", counts), ("lower.json", lowerVectors), ("changes.json", changeVectors),
      ("merge-check.json", mergeChecks), ("genesis.json", genesisVectors), ("bodies.json", bodyVectors),
      ("segments.json", segmentVectors), ("heads.json", headVectors), ("loro.json", loroVectors),
      ("placements.json", placementVectors), ("held.json", heldVectors), ("builtins.json", builtinVectors),
      ("schemas.json", schemaVectors)] do
    IO.FS.writeFile (dir / file) (render vs)
