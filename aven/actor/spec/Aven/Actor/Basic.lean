/-!
# The things an actor is made of (ARCHITECTURE.md, sections 2, 4 and 6)

Values, addresses, messages, definitions and journal entries. Version 1's numbers are integers. A Value's name (the
BLAKE3 hash of its canonical bytes) is not modelled here: the kernel never looks inside a name, so its theorems hold
for any.
-/

namespace Aven.Actor

/-- A Value: JSON with no surprises (section 2). Version 1's numbers are integers. -/
inductive Value where
  | null
  | bool (b : Bool)
  | int (i : Int)
  | str (s : String)
  | arr (xs : List Value)
  | obj (kvs : List (String × Value))
  deriving Repr, Inhabited

/-- An address `<scope>/<id>/<n>` (section 6). `n` is the incarnation: how often `id` had been spawned when this one
was. The scope is `local` in version 1. -/
structure Addr where
  scope : String
  id : String
  n : Nat
  deriving DecidableEq, Repr, Inhabited

/-- The device's person, where clicks come from (section 9). Incarnation 0: it is never spawned. -/
def person : Addr := ⟨"local", "person", 0⟩

/-- The kernel, an actor too (section 7). Incarnation 0: it is never spawned. -/
def kernelAddr : Addr := ⟨"local", "kernel", 0⟩

/-- A message's name `(from, to, seq)` (section 4). -/
structure MsgId where
  sender : Addr
  to : Addr
  seq : Nat
  deriving DecidableEq, Repr, Inhabited

/-- Why an ask could not be answered (section 4). -/
inductive Reason where
  | timeout
  | refused
  | error
  deriving DecidableEq, Repr, Inhabited

inductive Kind where
  | tell
  | ask (deadline : Nat)
  | reply (re : MsgId)
  | fail (re : MsgId) (reason : Reason)
  deriving DecidableEq, Repr, Inhabited

/-- A message (section 4). `run` and the reserved `cap` do not change what the kernel does in version 1. -/
structure Message where
  sender : Addr
  to : Addr
  seq : Nat
  name : String
  payload : Value
  kind : Kind
  deriving Repr, Inhabited

def Message.id (m : Message) : MsgId := ⟨m.sender, m.to, m.seq⟩

/-- The ask a reply or a fail answers. -/
def Kind.answers : Kind → Option MsgId
  | .reply re => some re
  | .fail re _ => some re
  | _ => none

/-- What a turn may do (section 6): tell, ask within some time, or reply to an ask it was sent. -/
inductive Effect where
  | tell (to : Addr) (name : String) (payload : Value)
  | ask (to : Addr) (name : String) (payload : Value) (within : Nat)
  | reply (re : MsgId) (payload : Value)
  deriving Repr, Inhabited

/-- The turn's time and seed, journaled so a replay sees the same (section 6). -/
structure Given where
  now : Nat
  seed : Nat
  deriving DecidableEq, Repr, Inhabited

/-- What a turn gives back: `turn(state, message, given) → { state', effects, phase'? }`. -/
structure Output where
  state : Value
  effects : List Effect
  phase : Option String
  deriving Repr, Inhabited

/-- A machine is data (section 6): Prolog's facts `transition(Message, From, To)` as a table, per phase the messages
it allows and the phases each may lead to. The interface's second part. -/
structure Machine where
  initial : String
  phases : List (String × List (String × List String))
  deriving Repr, Inhabited

/-- The phases that `name` may lead to out of `phase`. -/
def Machine.targets (mc : Machine) (phase name : String) : List String :=
  (mc.phases.filter (·.1 == phase)).flatMap fun e => (e.2.filter (·.1 == name)).flatMap (·.2)

/-- Whether `phase` allows `name` at all. -/
def Machine.opens (mc : Machine) (name phase : String) : Bool := !(mc.targets phase name).isEmpty

/-- Whether `name` may take `phase` to `to`. -/
def Machine.allows (mc : Machine) (name phase to : String) : Bool := (mc.targets phase name).contains to

def Machine.declared (mc : Machine) : List String := mc.phases.map (·.1)

/-- One message of an interface (section 6): a label in this interface, prose for people and models, and its types
by id, `<type Doc>/<schema hash>`. Names and prose are never matched; types are. -/
structure MsgSpec where
  name : String
  description : String
  type : String
  reply : Option String
  deriving DecidableEq, Repr, Inhabited

/-- A definition (section 6). The interface's schemas are a check on a message's name and payload; the turn is
whatever its runtime computes, a pure function. -/
structure Def where
  name : String
  description : String
  /-- The interface: the messages it accepts. -/
  interface : List MsgSpec
  /-- The types its turns may send. -/
  sends : List String
  accepts : String → Value → Bool
  machine : Option Machine
  turn : Value → Message → Given → Option Output
  init : Value

def Def.initialPhase (d : Def) : String := (d.machine.map (·.initial)).getD ""

def Def.messages (d : Def) : List String := d.interface.map (·.name)

/-- The type of the message `name` in this interface. -/
def Def.typeOf (d : Def) (name : String) : Option String := (d.interface.find? (·.name == name)).map (·.type)

/-- The built-in ask every actor accepts, answered by the kernel (section 6). -/
def describeName : String := "describe"

def Kind.isAsk : Kind → Bool
  | .ask _ => true
  | _ => false

/-- How a handled message ended (section 7). -/
inductive Outcome where
  | done
  /-- A `describe` ask, answered by the kernel from the definition; not a turn. -/
  | described
  | refused
  | error
  deriving DecidableEq, Repr, Inhabited

/-- A journal entry (section 7): the message whole, the definition in force, `given`, the state and phase before and
after, the effects and the outcome. Runtimes, fuel and the interpreter's version are pinned by the definition's name
in this model, since a definition names its parts. -/
structure Entry where
  msg : Message
  defn : Option String
  given : Given
  before : Value
  phaseBefore : String
  after : Value
  phaseAfter : String
  effects : List Effect
  outcome : Outcome
  deriving Repr, Inhabited

/-- The repository's definitions, by name. Only these can be spawned. -/
abbrev Library := String → Option Def

/-- Asks default to 30 s, at most 10 minutes (section 4), in milliseconds. -/
def askDefault : Nat := 30000
def askMax : Nat := 600000

end Aven.Actor
