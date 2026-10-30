import Aven.Runtime.State

/-!
# state-runtime's examples

Two actors of the todo app (aven/actor/ARCHITECTURE.md, section 9) as state parts: a `task` with a statechart (open,
doing, done) and a `list` without a machine. Each example runs a part on an input under the contract, from their
Values, and names the result: the phase and state after and the effects, or the failure. `lake build` checks every
one; `vectors` exports them (`state.json`) with the part, the input and the result in the one codec, for state-runtime's
crate to replay.
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode Canon)
open Aven.Actor (Addr MsgId Kind Message Effect Given Machine)

/-! ## The grammar as Values -/

def Key.value : Key → Value
  | .field b => .text b
  | .index n => .uint n

def pathValue (p : Path) : Value := .array (p.map Key.value)

def Expr.value : Expr → Value
  | .lit v => .array [.text (ascii "lit"), v]
  | .payload p => .array [.text (ascii "payload"), pathValue p]
  | .state p => .array [.text (ascii "state"), pathValue p]
  | .now => .array [.text (ascii "now")]
  | .seed => .array [.text (ascii "seed")]

def Update.value : Update → Value
  | .set p e => .array [.text (ascii "set"), pathValue p, e.value]
  | .merge p e => .array [.text (ascii "merge"), pathValue p, e.value]
  | .append p e => .array [.text (ascii "append"), pathValue p, e.value]
  | .remove p => .array [.text (ascii "remove"), pathValue p]

def Target.value : Target → Value
  | .sender => .array [.text (ascii "sender")]
  | .state p => .array [.text (ascii "state"), pathValue p]

def Send.value : Send → Value
  | .tell to n e => .array [.text (ascii "tell"), to.value, .text (ascii n), e.value]
  | .ask to n e w => .array [.text (ascii "ask"), to.value, .text (ascii n), e.value, .uint w]
  | .reply e => .array [.text (ascii "reply"), e.value]

def Handler.value (h : Handler) : Value :=
  .array [.text (ascii h.on), .array (h.moves.map fun (f, t) => .array [.text (ascii f), .text (ascii t)]),
    .array (h.updates.map Update.value), .array (h.sends.map Send.value)]

def StatePart.value (sp : StatePart) : Value :=
  .array [.text (ascii sp.initial), .array (sp.handlers.map Handler.value)]

def messageValue (m : Message) : Value :=
  .array [addrValue m.sender, addrValue m.to, .uint m.seq, .text (ascii m.name), m.payload, kindValue m.kind]

def StateInput.value (i : StateInput) : Value :=
  .array [i.state, messageValue i.msg, .array [.uint i.given.now, .uint i.given.seed], .text (ascii i.phase)]

/-! ## Two actors -/

def f (s : String) : Key := .field (ascii s)
def str (s : String) : Value := .text (ascii s)
def obj (kvs : List (String × Value)) : Value := .map (kvs.foldl (fun acc (k, v) => putField (ascii k) v acc) [])

/-- A task: a title, a statechart open → doing → done, and back to open. Finishing tells the list it's in. -/
def taskPart : StatePart :=
  ⟨"open",
   [⟨"start", [("open", "doing")], [.set [f "startedAt"] .now], []⟩,
    ⟨"finish", [("doing", "done")], [.set [f "doneAt"] .now],
      [.tell (.state [f "list"]) "done" (.state [f "title"])]⟩,
    ⟨"reopen", [("done", "open")], [.remove [f "doneAt"], .remove [f "startedAt"]], []⟩,
    ⟨"rename", [("open", "open"), ("doing", "doing")], [.set [f "title"] (.payload [f "title"])], []⟩,
    ⟨"title", [("open", "open"), ("doing", "doing"), ("done", "done")], [], [.reply (.state [f "title"])]⟩]⟩

/-- A listPart without a machine: one phase, `""`. -/
def listPart : StatePart :=
  ⟨"",
   [⟨"add", [("", "")], [.append [f "tasks"] (.payload [f "task"])], []⟩,
    ⟨"retitle", [("", "")], [.merge [f "meta"] (.payload [])], []⟩,
    ⟨"drop", [("", "")], [.remove [f "tasks", .index 0]], []⟩,
    ⟨"done", [("", "")], [.append [f "finished"] (.payload [])], []⟩]⟩

def listAddr : Addr := ⟨"local", "list", 1⟩
def taskAddr : Addr := ⟨"local", "task-1", 1⟩

def taskState : Value := obj [("title", str "Buy bread"), ("list", addrValue listAddr)]

def tellOf (name : String) (payload : Value) (sender : Addr := Aven.Actor.person) (to : Addr := taskAddr) : Message :=
  ⟨sender, to, 1, name, payload, .tell⟩

def askOf (name : String) (payload : Value) : Message := ⟨listAddr, taskAddr, 7, name, payload, .ask 30000⟩

def given : Given := ⟨1730000000000, 42⟩

def roomy : Limits := ⟨1_000_000, 16 * 1048576, 1048576⟩

/-- What an example expects: the phase, the state and the effects after, or the failure. -/
inductive Expect where
  | ok (phase : String) (state : Value) (effects : List Effect)
  | fail (f : Failure)

structure StateExample where
  name : String
  part : Value
  input : Value
  limits : Limits
  expect : Expect

def sx (name : String) (sp : StatePart) (st : Value) (m : Message) (ph : String) (e : Expect)
    (l : Limits := roomy) : StateExample :=
  ⟨name, sp.value, (StateInput.mk st m given ph).value, l, e⟩

def Expect.result : Expect → Except Failure Value
  | .ok ph st fx => .ok (outValue ⟨st, fx, some ph⟩)
  | .fail f => .error f

def stateExamples : List StateExample :=
  [sx "a task starts" taskPart taskState (tellOf "start" .null) "open"
     (.ok "doing" (obj [("title", str "Buy bread"), ("list", addrValue listAddr), ("startedAt", .uint given.now)]) []),
   sx "a task can't finish before it starts" taskPart taskState (tellOf "finish" .null) "open" (.fail .refused),
   sx "a finished task tells its list" taskPart (obj [("title", str "Buy bread"), ("list", addrValue listAddr)])
     (tellOf "finish" .null) "doing"
     (.ok "done" (obj [("title", str "Buy bread"), ("list", addrValue listAddr), ("doneAt", .uint given.now)])
       [.tell listAddr "done" (str "Buy bread")]),
   sx "reopening removes both times" taskPart
     (obj [("title", str "x"), ("list", addrValue listAddr), ("startedAt", .uint 1), ("doneAt", .uint 2)])
     (tellOf "reopen" .null) "done" (.ok "open" (obj [("title", str "x"), ("list", addrValue listAddr)]) []),
   sx "renaming stays in its phase" taskPart taskState (tellOf "rename" (obj [("title", str "Buy rye bread")])) "doing"
     (.ok "doing" (obj [("title", str "Buy rye bread"), ("list", addrValue listAddr)]) []),
   sx "a done task can't be renamed" taskPart taskState (tellOf "rename" (obj [("title", str "y")])) "done"
     (.fail .refused),
   sx "an ask is answered" taskPart taskState (askOf "title" .null) "done"
     (.ok "done" taskState [.reply ⟨listAddr, taskAddr, 7⟩ (str "Buy bread")]),
   sx "a reply to a tell can't be made" taskPart taskState (tellOf "title" .null) "open" (.fail .refused),
   sx "a message the part doesn't name is refused" taskPart taskState (tellOf "delete" .null) "open" (.fail .refused),
   sx "a phase the part doesn't know is refused" taskPart taskState (tellOf "start" .null) "lost" (.fail .refused),
   sx "a list adds a task" listPart (obj [("tasks", .array [str "a"])]) (tellOf "add" (obj [("task", str "b")])) ""
     (.ok "" (obj [("tasks", .array [str "a", str "b"])]) []),
   sx "adding to an empty list makes the array" listPart (obj []) (tellOf "add" (obj [("task", str "a")])) ""
     (.ok "" (obj [("tasks", .array [str "a"])]) []),
   sx "a merge keeps the fields it doesn't name" listPart
     (obj [("meta", obj [("name", str "Home"), ("color", str "red")])])
     (tellOf "retitle" (obj [("name", str "Shop")])) ""
     (.ok "" (obj [("meta", obj [("name", str "Shop"), ("color", str "red")])]) []),
   sx "dropping the first task" listPart (obj [("tasks", .array [str "a", str "b"])]) (tellOf "drop" .null) ""
     (.ok "" (obj [("tasks", .array [str "b"])]) []),
   sx "dropping from an empty list is refused" listPart (obj [("tasks", .array [])]) (tellOf "drop" .null) ""
     (.fail .refused),
   sx "appending to a field that isn't an array is refused" listPart (obj [("tasks", str "oops")])
     (tellOf "add" (obj [("task", str "a")])) "" (.fail .refused),
   sx "a path into a missing payload field is refused" listPart (obj []) (tellOf "add" (obj [("other", str "a")])) ""
     (.fail .refused),
   sx "a list's done is told by its task" listPart (obj []) (tellOf "done" (str "Buy bread") taskAddr listAddr) ""
     (.ok "" (obj [("finished", .array [str "Buy bread"])]) []),
   sx "too little fuel" taskPart taskState (tellOf "start" .null) "open" (.fail .outOfFuel) ⟨3, 16 * 1048576, 1048576⟩,
   sx "too little memory" taskPart taskState (tellOf "start" .null) "open" (.fail .outOfMemory)
     ⟨1_000_000, 64, 1048576⟩,
   sx "too little room for the output" taskPart taskState (tellOf "start" .null) "open" (.fail .outputTooLarge)
     ⟨1_000_000, 16 * 1048576, 16⟩,
   ⟨"an input that isn't one", taskPart.value, .array [str "no"], roomy, .fail .badInput⟩,
   ⟨"a part that isn't one", .array [], (StateInput.mk taskState (tellOf "start" .null) given "open").value, roomy,
     .fail .refused⟩]

def StateExample.run (e : StateExample) : Except Failure Value := Aven.Runtime.run stateRuntime e.limits e.part e.input

def sameResult : Except Failure Value → Except Failure Value → Bool
  | .ok a, .ok b => encode a == encode b
  | .error a, .error b => a == b
  | _, _ => false

#guard stateExamples.all fun e => sameResult e.run e.expect.result

-- every answer is an allowed Value of the codec, and so is every part and input
#guard stateExamples.all fun e => Canon e.part && Canon e.input && match e.run with
  | .ok o => Canon o
  | .error _ => true

-- both parts parse back to themselves, fit their own statechart, and pass the actors' admission of a machine
#guard [taskPart, listPart].all fun sp =>
  ((StatePart.ofValue? sp.value).map fun q => encode q.value) == some (encode sp.value)
#guard [taskPart, listPart].all fun sp => sp.fits sp.machine && sp.machine.wellFormed (sp.handlers.map (·.on)).eraseDups

-- a part whose move its definition's machine doesn't allow doesn't fit it
#guard !taskPart.fits ⟨"open", [("open", [("start", ["done"])])]⟩

end Aven.Runtime
