import Aven.Runtime.State

/-!
# state-runtime's examples

Two actors of the todo app (aven/actor/ARCHITECTURE.md, section 9) as state parts: a `task` with a statechart (open,
doing, done) and a `list` without a machine. Each example runs a part on an input under the contract, from their
Values, and names the result: the phase after, the writes the turn commits (and the state they make) and the sends,
or the failure. `lake build` checks every one; `vectors` exports them (`state.json`) with the part, the input and the
result in the one codec, for state-runtime's crate to replay.
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode Canon)

/-! ## The grammar as Values -/

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

def Msg.value (m : Msg) : Value := .array [m.sender, .text (ascii m.name), m.payload, m.ask.getD .null]

def StateInput.value (i : StateInput) : Value :=
  .array [i.state, i.msg.value, .array [.uint i.now, .uint i.seed], .text (ascii i.phase)]

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

/-- An address as the actors write it in a Value: `[scope, id, n]`. -/
def addr (scope id : String) (n : Nat) : Value := .array [str scope, str id, .uint n]

def person : Value := addr "local" "person" 0
def listAddr : Value := addr "local" "list" 1
def taskAddr : Value := addr "local" "task-1" 1

def taskState : Value := obj [("title", str "Buy bread"), ("list", listAddr)]

def tellOf (name : String) (payload : Value) (sender : Value := person) : Msg := ⟨sender, name, payload, none⟩

/-- An ask, its id as the kernel writes it: `[sender, to, seq]`. -/
def askId : Value := .array [listAddr, taskAddr, .uint 7]

def askOf (name : String) (payload : Value) : Msg := ⟨listAddr, name, payload, some askId⟩

def now : Nat := 1730000000000
def seed : Nat := 42

def roomy : Limits := ⟨1_000_000, 16 * 1048576, 1048576⟩

/-- What an example expects: the phase after, the writes the turn commits, the state they make and the sends, or the
failure. -/
inductive Expect where
  | ok (phase : String) (writes : List Write) (after : Value) (sends : List Out)
  | fail (f : Failure)

structure StateExample where
  name : String
  part : Value
  input : Value
  limits : Limits
  expect : Expect

/-- A map's fields. -/
def fields : Value → List (Bytes × Value)
  | .map kvs => kvs
  | _ => []

def sx (name : String) (sp : StatePart) (st : Value) (m : Msg) (ph : String) (e : Expect)
    (l : Limits := roomy) : StateExample :=
  ⟨name, sp.value, (StateInput.mk st m now seed ph).value, l, e⟩

def Expect.result : Expect → Except Failure Value
  | .ok ph ws _ fx => .ok (StateOut.value ⟨ws, fx, ph⟩)
  | .fail f => .error f

def stateExamples : List StateExample :=
  [sx "a task starts" taskPart taskState (tellOf "start" .null) "open"
     (.ok "doing" [.put [f "startedAt"] (.uint now)]
       (obj [("title", str "Buy bread"), ("list", listAddr), ("startedAt", .uint now)]) []),
   sx "a task can't finish before it starts" taskPart taskState (tellOf "finish" .null) "open" (.fail .refused),
   sx "a finished task tells its list" taskPart (obj [("title", str "Buy bread"), ("list", listAddr)])
     (tellOf "finish" .null) "doing"
     (.ok "done" [.put [f "doneAt"] (.uint now)]
       (obj [("title", str "Buy bread"), ("list", listAddr), ("doneAt", .uint now)])
       [.tell listAddr "done" (str "Buy bread")]),
   sx "reopening removes both times" taskPart
     (obj [("title", str "x"), ("list", listAddr), ("startedAt", .uint 1), ("doneAt", .uint 2)])
     (tellOf "reopen" .null) "done"
     (.ok "open" [.remove [f "doneAt"], .remove [f "startedAt"]] (obj [("title", str "x"), ("list", listAddr)]) []),
   sx "renaming stays in its phase" taskPart taskState (tellOf "rename" (obj [("title", str "Buy rye bread")])) "doing"
     (.ok "doing" [.put [f "title"] (str "Buy rye bread")]
       (obj [("title", str "Buy rye bread"), ("list", listAddr)]) []),
   sx "a done task can't be renamed" taskPart taskState (tellOf "rename" (obj [("title", str "y")])) "done"
     (.fail .refused),
   sx "an ask is answered" taskPart taskState (askOf "title" .null) "done"
     (.ok "done" [] taskState [.reply askId (str "Buy bread")]),
   sx "a reply to a tell can't be made" taskPart taskState (tellOf "title" .null) "open" (.fail .refused),
   sx "a message the part doesn't name is refused" taskPart taskState (tellOf "delete" .null) "open" (.fail .refused),
   sx "a phase the part doesn't know is refused" taskPart taskState (tellOf "start" .null) "lost" (.fail .refused),
   sx "a list adds a task" listPart (obj [("tasks", .array [str "a"])]) (tellOf "add" (obj [("task", str "b")])) ""
     (.ok "" [.edit [f "tasks"] (.push (str "b"))] (obj [("tasks", .array [str "a", str "b"])]) []),
   sx "adding to an empty list makes the array" listPart (obj []) (tellOf "add" (obj [("task", str "a")])) ""
     (.ok "" [.edit [f "tasks"] (.push (str "a"))] (obj [("tasks", .array [str "a"])]) []),
   sx "a merge keeps the fields it doesn't name" listPart
     (obj [("meta", obj [("name", str "Home"), ("color", str "red")])])
     (tellOf "retitle" (obj [("name", str "Shop")])) ""
     (.ok "" [.patch [f "meta"] (fields (obj [("name", str "Shop")]))]
       (obj [("meta", obj [("name", str "Shop"), ("color", str "red")])]) []),
   sx "dropping the first task" listPart (obj [("tasks", .array [str "a", str "b"])]) (tellOf "drop" .null) ""
     (.ok "" [.remove [f "tasks", .index 0]] (obj [("tasks", .array [str "b"])]) []),
   sx "dropping from an empty list is refused" listPart (obj [("tasks", .array [])]) (tellOf "drop" .null) ""
     (.fail .refused),
   sx "appending to a field that isn't an array is refused" listPart (obj [("tasks", str "oops")])
     (tellOf "add" (obj [("task", str "a")])) "" (.fail .refused),
   sx "a path into a missing payload field is refused" listPart (obj []) (tellOf "add" (obj [("other", str "a")])) ""
     (.fail .refused),
   sx "a list's done is told by its task" listPart (obj []) (tellOf "done" (str "Buy bread") taskAddr) ""
     (.ok "" [.edit [f "finished"] (.push (str "Buy bread"))] (obj [("finished", .array [str "Buy bread"])]) []),
   sx "a tell to something that isn't an address is refused" taskPart
     (obj [("title", str "Buy bread"), ("list", str "local/list/1")]) (tellOf "finish" .null) "doing" (.fail .refused),
   sx "too little fuel" taskPart taskState (tellOf "start" .null) "open" (.fail .outOfFuel) ⟨3, 16 * 1048576, 1048576⟩,
   sx "too little memory" taskPart taskState (tellOf "start" .null) "open" (.fail .outOfMemory)
     ⟨1_000_000, 64, 1048576⟩,
   sx "too little room for the output" taskPart taskState (tellOf "start" .null) "open" (.fail .outputTooLarge)
     ⟨1_000_000, 16 * 1048576, 16⟩,
   ⟨"an input that isn't one", taskPart.value, .array [str "no"], roomy, .fail .badInput⟩,
   ⟨"a part that isn't one", .array [], (StateInput.mk taskState (tellOf "start" .null) now seed "open").value, roomy,
     .fail .refused⟩]

def StateExample.run (e : StateExample) : Except Failure Value := Aven.Runtime.run stateRuntime e.limits e.part e.input

def sameResult : Except Failure Value → Except Failure Value → Bool
  | .ok a, .ok b => encode a == encode b
  | .error a, .error b => a == b
  | _, _ => false

#guard stateExamples.all fun e => sameResult e.run e.expect.result

-- what each turn commits, applied to the state it was handed, makes the state after
#guard stateExamples.all fun e => match e.expect, StateInput.ofValue? e.input with
  | .ok _ ws after _, some inp => (applyAll inp.state ws).map encode == some (encode after)
  | .ok .., none => false
  | .fail _, _ => true

-- every answer is an allowed Value of the codec, and so is every part and input
#guard stateExamples.all fun e => Canon e.part && Canon e.input && match e.run with
  | .ok o => Canon o
  | .error _ => true

-- both parts parse back to themselves
#guard [taskPart, listPart].all fun sp =>
  ((StatePart.ofValue? sp.value).map fun q => encode q.value) == some (encode sp.value)

/-- A machine's transitions as a table, the way a definition's machine allows them. -/
def transitions (t : List (String × String × String)) (name f to : String) : Bool := t.contains (name, f, to)

/-- The task's machine, as its definition declares it. -/
def taskMachine : List (String × String × String) :=
  [("start", "open", "doing"), ("finish", "doing", "done"), ("reopen", "done", "open"), ("rename", "open", "open"),
   ("rename", "doing", "doing"), ("title", "open", "open"), ("title", "doing", "doing"), ("title", "done", "done")]

-- the task fits its machine; a machine without one of its moves doesn't fit it
#guard taskPart.fits (transitions taskMachine)
#guard !taskPart.fits (transitions (taskMachine.erase ("reopen", "done", "open")))
-- every answer of the task's examples is a transition of its machine
#guard stateExamples.all fun e => match StatePart.ofValue? e.part, StateInput.ofValue? e.input, e.run with
  | some sp, some inp, .ok _ => if sp.handlers.length == taskPart.handlers.length then
      match step sp inp with
      | .ok o => transitions taskMachine inp.msg.name inp.phase o.phase
      | .error _ => false
    else true
  | _, _, _ => true

end Aven.Runtime
