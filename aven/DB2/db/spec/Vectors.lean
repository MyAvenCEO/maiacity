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

/-! ## The chat -/

open Chat in
def Aven.DB.Chat.Announce.json (a : Announce) : Json :=
  Json.mkObj [("file", a.file), ("size", toJson a.size), ("name", a.name), ("type", a.type)]

open Chat in
def Aven.DB.Chat.Message.json (m : Message) : Json :=
  Json.mkObj (([("network", toJson m.network), ("from", toJson m.sender), ("at", toJson m.time),
    ("kind", toJson m.kind.name), ("text", toJson m.text)] : List (String × Json)) ++
    (m.file.map fun a => ("file", a.json)).toList ++ [("signer", toJson m.signer), ("signed", toJson m.signed)])

open Chat in
def Aven.DB.Chat.Refusal.name : Refusal → String
  | .wrongNetwork => "wrongNetwork"
  | .notMember => "notMember"
  | .badSignature => "badSignature"
  | .stale => "stale"
  | .empty => "empty"
  | .tooLong => "tooLong"
  | .notSaid => "notSaid"
  | .badFile => "badFile"

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
      ("said", Json.arr (r.said.map fun (who, text) => Json.arr #[who, text]).toArray),
      ("files", Json.arr (r.files.map fun (who, a) => Json.arr #[who, a.json]).toArray)]
  vector name input (Json.arr expected.toArray)

open Chat in
def randomChat (seed : Nat) : List Step := Id.run do
  let (len, r) := (Rng.seed (seed + 500)).below 30
  let mut r := r
  let mut now := 0
  let mut sent : Array Message := #[]
  let mut steps := #[]
  for _ in [0:len + 1] do
    let (k, r1) := r.below 13
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
      let m := if k = 12 then Message.make sender now .file "" (if t = 1 then .size 7 else tamper)
          (some { movie with size := gap, name := s!"file {now}" })
        else if k < 4 then Message.make sender now .here "" tamper
        else if k < 5 then Message.make sender now .bye "" tamper
        else if k < 6 then Message.make sender now .say (if t < 6 then "" else long) .none
        else Message.make sender now .say s!"line {now}" tamper
      sent := sent.push m
      steps := steps.push (.arrive now m)
  return steps.toList

def chat : List Json :=
  Chat.chatExamples.map (fun (name, steps, _) => chatVector name steps) ++
  Chat.fileExamples.map (fun (name, steps, _) => chatVector name steps) ++
  (List.range generated).map fun i => chatVector s!"seed {i + 1}" (randomChat (i + 1))

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  for (file, vs) in [("status.json", status), ("presence.json", presence), ("timeline.json", timeline),
      ("wire.json", wire), ("store.json", store), ("hashes.json", hashes),
      ("chat.json", chat)] do
    IO.FS.writeFile (dir / file) (render vs)
