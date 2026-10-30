import Aven.Actor
import Lean.Data.Json

/-!
# The test vectors (ARCHITECTURE.md, section 14)

`lake exe vectors [DIR]` writes the kernel's traces as JSON, one vector per line, into `DIR` (`vectors/` by default),
where they are committed. Every vector is `{"name", "input", "expected"}`.

- `kernel.json`: a trace of events from the empty kernel, and the kernel after it.
- `traces.json`: the same for generated traces: 40 of them, the three test actors spawned and then 40 events drawn
  with xorshift64 from a fixed seed as `Aven.Core`'s vectors draw, each against the kernel so far (a `handle` among
  inboxes with a message waiting), over addresses that live, die and never were, and every kind of event.

The traces run four test definitions, which the Rust tests implement natively, exactly as written here:

- `counter`: state a count from 0. `inc` (a tell) adds one; `get` (an ask) replies with the count.
- `task`: state its title. A machine, open and done: `finish` takes open to done, `reopen` done to open.
- `asker`: on `go`, asks `local/c/1` for `get` within 1000 and tells it `inc`, which it never declared; a `reply`
  becomes its state, and a `fail` makes it `"failed"`.
- `broken`: a machine that leads to a phase it never declares, which admission refuses.

An event is `["spawn", id, definition]`, `["handle", receiver, sender]`, `["tick", t]`, `["retire", address]`, or a
send from the person, `["tell", to, name, payload]` or `["ask", to, name, payload, within]`. An address is
`scope/id/n`. A Value's readable form is `Aven.Core`'s: integers as numbers, text as strings, arrays, maps as objects,
a byte string as `{"bytes": hex}`; a type id is its text, `d:<hex>/b3:<hex>`.
-/

open Lean Aven.Core Aven.Actor

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def Aven.Actor.Addr.text (a : Addr) : String := s!"{a.scope}/{a.id}/{a.n}"

def Aven.Actor.MsgId.json (i : MsgId) : Json :=
  Json.mkObj [("from", i.sender.text), ("to", i.to.text), ("seq", i.seq)]

def Aven.Actor.Reason.name : Reason → String
  | .timeout => "timeout"
  | .refused => "refused"
  | .error => "error"

def Aven.Actor.Kind.json : Kind → Json
  | .tell => "tell"
  | .ask dl => Json.mkObj [("ask", dl)]
  | .reply re => Json.mkObj [("reply", re.json)]
  | .fail re why => Json.mkObj [("fail", re.json), ("reason", why.name)]

def Aven.Actor.Outcome.name : Outcome → String
  | .done => "done"
  | .described => "described"
  | .refused => "refused"
  | .error => "error"

def Aven.Actor.Message.json (m : Message) : Json :=
  Json.mkObj [("seq", m.seq), ("name", m.name), ("kind", m.kind.json), ("payload", Value.json m.payload)]

def Aven.Actor.Entry.json (e : Entry) : Json :=
  Json.mkObj [("from", e.msg.sender.text), ("seq", e.msg.seq), ("name", e.msg.name), ("outcome", e.outcome.name),
    ("phaseBefore", e.phaseBefore), ("phaseAfter", e.phaseAfter), ("after", Value.json e.after)]

/-! ## The test definitions -/

def k (s : String) : Bytes := s.toUTF8.toList

/-- A test type id: a type Doc and a schema, both named from a label. -/
def tid (type schema : String) : TypeId := ⟨⟨blake3 (k ("type:" ++ type))⟩, blake3 (k ("schema:" ++ schema))⟩

def tInc : TypeId := tid "counter" "inc"
def tGet : TypeId := tid "counter" "get"
def tCount : TypeId := tid "counter" "count"
def tGo : TypeId := tid "asker" "go"
def tStep : TypeId := tid "task" "step"

def counterAddr : Addr := ⟨"local", "c", 1⟩

def counter : Def where
  name := "counter"
  description := "Counts."
  interface := [⟨"inc", "Adds one.", tInc, none⟩, ⟨"get", "Its count.", tGet, some tCount⟩]
  sends := []
  accepts := fun _ _ => true
  machine := none
  turn := fun st m _ => match m.name with
    | "inc" => some ⟨match st with | .uint n => .uint (n + 1) | _ => .uint 1, [], none⟩
    | "get" => some ⟨st, [.reply m.id st], none⟩
    | _ => none
  init := .uint 0

def taskMachine : Machine := ⟨"open", [("open", [("finish", ["done"])]), ("done", [("reopen", ["open"])])]⟩

def task : Def where
  name := "task"
  description := "A thing to do."
  interface := [⟨"finish", "Marks it done.", tStep, none⟩, ⟨"reopen", "Marks it open again.", tStep, none⟩]
  sends := []
  accepts := fun _ _ => true
  machine := some taskMachine
  turn := fun st m _ => match m.name with
    | "finish" => some ⟨st, [], some "done"⟩
    | "reopen" => some ⟨st, [], some "open"⟩
    | _ => none
  init := text "Buy milk"

def asker : Def where
  name := "asker"
  description := "Asks the counter."
  interface := [⟨"go", "Asks the counter for its count.", tGo, none⟩]
  sends := [tGet]
  accepts := fun _ _ => true
  machine := none
  turn := fun st m _ => match m.name with
    | "go" => some ⟨st, [.ask counterAddr "get" .null 1000, .tell counterAddr "inc" .null], none⟩
    | "reply" => some ⟨m.payload, [], none⟩
    | "fail" => some ⟨text "failed", [], none⟩
    | _ => none
  init := .null

def broken : Def where
  name := "broken"
  description := "Leads to a phase it never declares."
  interface := [⟨"go", "Goes.", tGo, none⟩]
  sends := []
  accepts := fun _ _ => true
  machine := some ⟨"a", [("a", [("go", ["b"])])]⟩
  turn := fun st _ _ => some ⟨st, [], some "b"⟩
  init := .null

def lib : Library
  | "counter" => some counter
  | "task" => some task
  | "asker" => some asker
  | "broken" => some broken
  | _ => none

/-! ## Traces -/

def addr (id : String) (n : Nat := 1) : Addr := ⟨"local", id, n⟩

def Aven.Actor.Event.json : Event → Json
  | .spawn id dn => Json.arr #["spawn", id, dn]
  | .handle r s => Json.arr #["handle", r.text, s.text]
  | .tick t => Json.arr #["tick", t]
  | .retire a => Json.arr #["retire", a.text]
  | .send (.tell r name p) => Json.arr #["tell", r.text, name, Value.json p]
  | .send (.ask r name p within) => Json.arr #["ask", r.text, name, Value.json p, within]
  | .send (.reply re p) => Json.arr #["reply", re.json, Value.json p]

def traces : List (String × List Event) := [
  ("a counter counts, and answers an ask",
    [.spawn "c" "counter", .send (.tell counterAddr "inc" .null), .send (.tell counterAddr "inc" .null),
     .handle counterAddr person, .handle counterAddr person, .send (.ask counterAddr "get" .null 500),
     .handle counterAddr person]),
  ("messages from one sender are handled in the order sent",
    [.spawn "c" "counter", .send (.tell counterAddr "inc" .null), .send (.ask counterAddr "get" .null 500),
     .send (.tell counterAddr "inc" .null), .handle counterAddr person, .handle counterAddr person,
     .handle counterAddr person]),
  ("a machine allows finish, refuses it twice, then reopens",
    [.spawn "t" "task", .send (.tell (addr "t") "finish" .null), .handle (addr "t") person,
     .send (.tell (addr "t") "finish" .null), .handle (addr "t") person,
     .send (.tell (addr "t") "reopen" .null), .handle (addr "t") person]),
  ("an ask past its deadline fails with timeout, and the late reply is dropped",
    [.spawn "c" "counter", .send (.ask counterAddr "get" .null 100), .tick 200, .handle counterAddr person]),
  ("an ask to no live actor fails at once, from the kernel, at seq 0",
    [.send (.ask (addr "nobody") "get" .null 100)]),
  ("an actor asks another; an undeclared tell is refused by the router",
    [.spawn "c" "counter", .spawn "a" "asker", .send (.tell (addr "a") "go" .null), .handle (addr "a") person,
     .handle counterAddr (addr "a"), .handle (addr "a") counterAddr]),
  ("describe lists what the phase allows",
    [.spawn "t" "task", .send (.ask (addr "t") "describe" .null 100), .handle (addr "t") person,
     .send (.tell (addr "t") "finish" .null), .handle (addr "t") person,
     .send (.ask (addr "t") "describe" .null 100), .handle (addr "t") person]),
  ("a face placed again is a new incarnation; the old address takes nothing",
    [.spawn "t" "task", .retire (addr "t"), .spawn "t" "task", .send (.tell (addr "t") "finish" .null),
     .send (.tell (addr "t" 2) "finish" .null), .handle (addr "t" 2) person]),
  ("admission refuses a machine that leads to an undeclared phase",
    [.spawn "b" "broken", .send (.tell (addr "b") "go" .null)])]

/-- Every address a trace touches: the person, the kernel, and every incarnation it spawned. -/
def addrsOf (kn : Kernel) (es : List Event) : List Addr :=
  let ids := (es.filterMap fun | .spawn id _ => some id | _ => none).eraseDups
  let spawned := ids.flatMap fun id => (List.range (kn.spawned id)).map fun i => addr id (i + 1)
  let named := es.flatMap fun
    | .handle r s => [r, s]
    | .retire a => [a]
    | .send (.tell r _ _) => [r]
    | .send (.ask r _ _ _) => [r]
    | _ => []
  ([person, kernelAddr] ++ spawned ++ named).eraseDups

def summary (es : List Event) : Json :=
  let kn := Kernel.empty.run lib es
  let as := addrsOf kn es
  let actors := as.filter (fun a => (kn.defs a).isSome || !(kn.journal a).isEmpty) |>.map fun a =>
    Json.mkObj [("address", a.text), ("def", match kn.defs a with | some d => toJson d | none => Json.null),
      ("phase", kn.phase a), ("state", Value.json (kn.state a)),
      ("journal", Json.arr ((kn.journal a).map Entry.json).toArray)]
  let inboxes := as.flatMap fun s => as.filterMap fun r =>
    if (kn.inbox s r).isEmpty then none
    else some (Json.mkObj [("from", s.text), ("to", r.text),
      ("messages", Json.arr ((kn.inbox s r).map Message.json).toArray)])
  Json.mkObj [("now", kn.now), ("actors", Json.arr actors.toArray), ("inboxes", Json.arr inboxes.toArray),
    ("pending", Json.arr (kn.pending.map fun (i, dl) =>
      Json.mkObj [("ask", i.json), ("deadline", dl)]).toArray)]

def kernelVectors : List Json :=
  traces.map fun (name, es) => vector name (Json.arr (es.map Event.json).toArray) (summary es)

/-! ## Generated traces -/

/-- xorshift64, as the Rust property tests draw: the same file on every run. -/
structure Rng where
  s : UInt64

def Rng.seed (n : Nat) : Rng := ⟨(n.toUInt64 * 0x9e3779b97f4a7c15) ||| 1⟩

def Rng.below (r : Rng) (n : Nat) : Nat × Rng :=
  let x := r.s ^^^ (r.s <<< 13)
  let x := x ^^^ (x >>> 7)
  let x := x ^^^ (x <<< 17)
  (x.toNat % n, ⟨x⟩)

def Rng.pick {α : Type} [Inhabited α] (r : Rng) (xs : List α) : α × Rng :=
  let (i, r) := r.below xs.length
  (xs[i]!, r)

/-- The addresses a generated trace uses: the person, two incarnations of each test actor, and one that never is. -/
def pool : List Addr :=
  [person, counterAddr, addr "c" 2, addr "t", addr "t" 2, addr "a", addr "nobody"]

def names : List String := ["inc", "get", "finish", "reopen", "go", "describe", "nothing"]

/-- One drawn event. A `handle` is drawn among the inboxes with a message not handled yet, when there is one. -/
def Rng.event (r : Rng) (kn : Kernel) : Event × Rng :=
  let (kind, r) := r.below 10
  match kind with
  | 0 => let (d, r) := r.pick [("c", "counter"), ("t", "task"), ("a", "asker"), ("b", "broken")]; (.spawn d.1 d.2, r)
  | 1 => let (a, r) := r.pick pool; (.retire a, r)
  | 2 => let (t, r) := r.below 400; (.tick (kn.now + t), r)
  | 3 | 4 =>
    let (to, r) := r.pick pool
    let (name, r) := r.pick names
    (.send (.tell to name .null), r)
  | 5 =>
    let (to, r) := r.pick pool
    let (name, r) := r.pick names
    let (within, r) := r.below 300
    (.send (.ask to name .null within), r)
  | _ =>
    let senders := pool ++ [kernelAddr]
    let ready := pool.flatMap fun rcv => (senders.filter fun snd =>
      kn.read rcv snd < (kn.inbox snd rcv).length).map fun snd => (rcv, snd)
    match ready with
    | [] => let (rcv, r) := r.pick pool; let (snd, r) := r.pick senders; (.handle rcv snd, r)
    | _ => let (p, r) := r.pick ready; (.handle p.1 p.2, r)

/-- A drawn trace: the three test actors spawned first, then `n` drawn events, each drawn against the kernel so far. -/
def Rng.trace (r : Rng) (n : Nat) : List Event × Rng := Id.run do
  let start : List Event := [.spawn "c" "counter", .spawn "t" "task", .spawn "a" "asker"]
  let mut r := r
  let mut kn := Kernel.empty.run lib start
  let mut out := start.toArray
  for _ in [0:n] do
    let (e, r') := r.event kn
    out := out.push e
    kn := kn.step lib e
    r := r'
  return (out.toList, r)

def generated : List (List Event) := Id.run do
  let mut r := Rng.seed 1
  let mut out := #[]
  for _ in [0:40] do
    let (es, r') := r.trace 40
    out := out.push es
    r := r'
  return out.toList

def traceVectors : List Json :=
  (List.range generated.length).zip generated |>.map fun (i, es) =>
    vector s!"generated trace {i + 1}" (Json.arr (es.map Event.json).toArray) (summary es)

/-! ## Checks before writing -/

def final (es : List Event) : Kernel := Kernel.empty.run lib es

-- the counter counts to 2 and replies 2
#guard match (final (traces[0]!.2)).state counterAddr with | .uint 2 => true | _ => false
-- the second finish is refused and the task ends open
#guard (final (traces[2]!.2)).phase (addr "t") == "open"
-- the timed-out ask fails, so nothing waits
#guard (final (traces[3]!.2)).pending.isEmpty
-- the router drops the asker's undeclared `inc`: the counter's count stays 0, and the asker learns it
#guard match (final (traces[5]!.2)).state (addr "a") with | .uint 0 => true | _ => false
-- the broken definition is never spawned
#guard ((final (traces[8]!.2)).defs (addr "b")).isNone
-- admission accepts the test machines
#guard task.admit && counter.admit && asker.admit && !broken.admit

def write (dir : System.FilePath) (file : String) (vs : List Json) : IO Unit :=
  IO.FS.writeFile (dir / file) (String.join (vs.map fun v => v.compress ++ "\n"))

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := (args.head?.getD "vectors")
  IO.FS.createDirAll dir
  write dir "kernel.json" kernelVectors
  write dir "traces.json" traceVectors
