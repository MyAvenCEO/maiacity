import Aven.DB.Json

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes the examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`:

- `status.json`: a limit and status events; the state after each (`Aven.DB.Status`).
- `presence.json`: connections joining and leaving; what every peer is told after each (`Aven.DB.Presence`).
- `timeline.json`: a timeline line's parts; the line (`Aven.DB.Timeline`).
- `wire.json`: chunks of a stream; the frames each completes, and the error that ends it (`Aven.DB.Wire`).
- `store.json`: traces of store calls from an empty store; the result of each (`Aven.DB.Store`). Every backend
  replays them in the conformance suite.
- `hashes.json`: spellings of a hash; whether the store reads each as one.
- `chat.json`: messages arriving in a room and the clock moving on; after each step the answer, the body the message's
  sender signs, who is present and the lines said (`Aven.DB.Chat`). The door admits `alice`, `aven` and `bob`; each
  name is a test key, which aven-db-core's tests sign with for real.
- `files.json`: files cut into chunks; each chunk's bounds and hash, the index, the file's name, and the chunks each
  range touches with the bytes read from them alone; files of the city-dome's size by their size alone
  (`Aven.DB.Files`).
- `chats.json`: lines arriving at peers and peers catching up; after each step the answers, the peer's heads, loose
  lines, forks and what its chat shows (`Aven.DB.Chains`); and what a line's device signs. Lines are named by labels,
  which aven-db-core's tests replace with the hashes of real signed blobs.

`aven-db-core`'s and `aven-db-store`'s tests load them. `bun run up --check` runs this again and fails when the files
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

/-! ## Status and presence -/

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

/-! ## The timeline and the wire -/

def timeline : List Json :=
  lineExamples.map fun (name, (t, peer, event, fields), _) =>
    vector name (Json.mkObj [("t", toJson t), ("peer", peer), ("event", event),
      ("fields", Json.arr (fields.map fun (k, v) => Json.arr #[k, v]).toArray)]) (line t peer event fields)

/-- A long run of one character is written as `{"fill", "len"}`, so the file stays small. -/
def chunkJson (c : String) : Json :=
  match c.toList with
  | x :: rest => if rest.length ≥ 100 ∧ rest.all (· == x) then
      Json.mkObj [("fill", toString x), ("len", toJson c.length)] else c
  | [] => c

def WireError.name : WireError → String
  | .bad => "bad"
  | .tooLong => "tooLong"

def wire : List Json :=
  wireExamples.map fun (name, chunks, _) =>
    let (frames, err) := decode chunks
    vector name (Json.mkObj [("chunks", Json.arr (chunks.map chunkJson).toArray)])
      (Json.mkObj [("frames", Json.arr (frames.map fun fs => Json.arr (fs.map Frame.json).toArray).toArray),
        ("error", toJson (err.map WireError.name))])

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
    ("steps", Json.arr (steps.map fun
      | .hear p l => Json.mkObj [("peer", p), ("hear", l.json)]
      | .catchUp p src => Json.mkObj [("peer", p), ("catchUp", src)]).toArray)]
  let expected := (World.run [] steps).map fun (p, as, k) =>
    Json.mkObj [("peer", p), ("answers", Json.arr (as.map Answer.json).toArray),
      ("heads", Json.arr (k.heads.map fun (d, i) => toJson [d, i]).toArray),
      ("loose", toJson (k.loose.map (·.id))), ("forks", toJson k.forks), ("shown", toJson (k.shown.map (·.id)))]
  vector name input (Json.arr expected.toArray)

open Chains in
/-- Every device's chain of four lines, a fork at each place, and now and then a line tampered with. -/
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
   Line.make "a text that reads like a file" "alice" 4 (some prev) 10 s!"file {prev}\nsize 1\ntype x\nname"].map fun l =>
    vector s!"what {l.id} signs" (Json.mkObj [("line", l.json)]) (Json.mkObj [("signs", l.signs)])

def chats : List Json :=
  bodies ++ Chains.chainExamples.map (fun (name, steps, _) => chainVector name steps) ++
  (List.range generated).map fun i => chainVector s!"seed {i + 1}" (randomChains (i + 1))

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  for (file, vs) in [("status.json", status), ("presence.json", presence), ("timeline.json", timeline),
      ("wire.json", wire), ("store.json", store), ("hashes.json", hashes), ("refs.json", refs),
      ("chat.json", chat), ("files.json", files), ("chats.json", chats)] do
    IO.FS.writeFile (dir / file) (render vs)
