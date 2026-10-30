import Aven.Actor.Basic

/-!
# The kernel (ARCHITECTURE.md, sections 3, 4 and 7)

Docs in memory: one inbox per sender and receiver, written only by the sender's kernel, and one journal per actor.
The kernel is a function from its state and one event to its next state. The scheduler is not modelled: a trace says
which actor handles its next message from which sender, so every theorem holds for every schedule.

- `handle r s`: `r` handles the next message from `s` that it has not handled yet.
- `tick t`: the clock moves to `t`, and every ask whose deadline has passed fails with `timeout`.
- `spawn id dn`: the kernel spawns the repository's definition `dn` under `id`, as a new incarnation.
- `retire a`: `a` goes, as a face actor does when it is unplaced. Its Doc stays.
- `send e`: the person tells or asks, as a click does.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)

def upd {α β : Type} [DecidableEq α] (f : α → β) (a : α) (b : β) : α → β :=
  fun x => if x = a then b else f x

def upd2 {α β : Type} [DecidableEq α] (f : α → α → β) (a b : α) (v : β) : α → α → β :=
  fun x y => if x = a ∧ y = b then v else f x y

/-- The kernel's checks before a turn (section 7): a tell or an ask must fit the interface, and a machine must have a
transition for the message's name out of the current phase. -/
def gate (d : Def) (m : Message) (ph : String) : Bool :=
  let iface := match m.kind with
    | .tell | .ask _ => d.accepts m.name m.payload
    | _ => true
  let mach := match d.machine with
    | none => true
    | some mc => mc.opens m.name ph
  iface && mach

/-- The turn, and the kernel's check after it: under a machine the new phase must be a transition's `To`. -/
def runTurn (d : Def) (st : Value) (m : Message) (g : Given) (ph : String) :
    Option (Value × String × List Effect) :=
  match d.turn st m g with
  | none => none
  | some out =>
    match d.machine with
    | none => some (out.state, out.phase.getD ph, out.effects)
    | some mc =>
      match out.phase with
      | some p => if mc.allows m.name ph p then some (out.state, p, out.effects) else none
      | none => none

/-- The tool specs `describe` answers with: every message of the interface the current phase allows. Caps are not
in version 1, so every asker may send them all. -/
def Def.describe (d : Def) (ph : String) : List MsgSpec :=
  d.interface.filter fun sp => match d.machine with
    | none => true
    | some mc => mc.opens sp.name ph

/-- Text as a Value: its UTF-8 bytes. -/
def text (s : String) : Value := .text s.toUTF8.toList

/-- A map's keys in the order deterministic CBOR sorts them: shorter encodings first, then bytewise. -/
def MsgSpec.toValue (sp : MsgSpec) : Value :=
  .map [("name".toUTF8.toList, text sp.name), ("type".toUTF8.toList, sp.type.value),
    ("reply".toUTF8.toList, match sp.reply with | some t => t.value | none => .null),
    ("description".toUTF8.toList, text sp.description)]

def Def.describeValue (d : Def) (ph : String) : Value :=
  .map [("name".toUTF8.toList, text d.name), ("messages".toUTF8.toList, .array ((d.describe ph).map MsgSpec.toValue)),
    ("description".toUTF8.toList, text d.description)]

/-- What handling `m` comes to, from what the journal entry pins: the definition in force, the state and phase
before, the message and `given`. The kernel uses this, and so does replay. -/
def judge (lib : Library) (dn : Option String) (st : Value) (m : Message) (g : Given) (ph : String) :
    Value × String × Outcome × List Effect :=
  match dn.bind lib with
  | none => (st, ph, .refused, [])
  | some d =>
    if m.name == describeName && m.kind.isAsk then (st, ph, .described, [.reply m.id (d.describeValue ph)])
    else if gate d m ph then
      match runTurn d st m g ph with
      | some (st', ph', fx) => (st', ph', .done, fx)
      | none => (st, ph, .error, [])
    else (st, ph, .refused, [])

/-- Replaying a journal from an actor's first state and phase (law 8). -/
def replay (lib : Library) (start : Value × String) (es : List Entry) : Value × String :=
  es.foldl (fun sp e => let j := judge lib e.defn sp.1 e.msg e.given sp.2; (j.1, j.2.1)) start

structure Kernel where
  /-- The definition each live actor runs. -/
  defs : Addr → Option String
  /-- Each actor's first state and phase. -/
  start : Addr → Value × String
  state : Addr → Value
  phase : Addr → String
  /-- `inbox s r`: the inbox Doc from `s` to `r`, in `s`'s order. -/
  inbox : Addr → Addr → List Message
  /-- `read r s`: how many messages of `inbox s r` `r` has handled. -/
  read : Addr → Addr → Nat
  journal : Addr → List Entry
  /-- How often each id has been spawned. -/
  spawned : String → Nat
  /-- The asks still waiting for an answer, with their deadlines. -/
  pending : List (MsgId × Nat)
  now : Nat

def Kernel.empty : Kernel :=
  ⟨fun _ => none, fun _ => (.null, ""), fun _ => .null, fun _ => "", fun _ _ => [], fun _ _ => 0, fun _ => [],
    fun _ => 0, [], 0⟩

/-- Sending is appending to the inbox Doc from `s` to `r` (section 4). `seq` counts per pair, from 1. -/
def Kernel.append (k : Kernel) (s r : Addr) (name : String) (payload : Value) (kind : Kind) : Kernel :=
  { k with inbox := upd2 k.inbox s r (k.inbox s r ++ [⟨s, r, (k.inbox s r).length + 1, name, payload, kind⟩]) }

def Kernel.isPending (k : Kernel) (id : MsgId) : Bool := k.pending.any (·.1 == id)

/-- `me` answers the ask `re`: only an ask sent to `me`, only while it waits, so once. A late answer is dropped. -/
def Kernel.answer (k : Kernel) (me : Addr) (re : MsgId) (payload : Value) (reason : Option Reason) : Kernel :=
  if re.to = me ∧ k.isPending re then
    let k := { k with pending := k.pending.filter (·.1 != re) }
    match reason with
    | none => k.append me re.sender "reply" payload (.reply re)
    | some why => k.append me re.sender "fail" payload (.fail re why)
  else k

/-- Whether the router lets `s` send `name` to `r`: the type of `name` in `r`'s interface must be one `s` declared in
its `sends` (section 6). The person and the kernel are built in and declare none. -/
def Kernel.declares (lib : Library) (k : Kernel) (s r : Addr) (name : String) : Bool :=
  match (k.defs s).bind lib with
  | none => true
  | some ds =>
    match ((k.defs r).bind lib).bind (·.typeOf name) with
    | some t => ds.sends.contains t
    | none => false

/-- One effect of `s`'s turn, through the router. Only a live actor is sent to, and only a type `s` declared. A tell to no live actor is dropped;
an ask to none is never sent, and the kernel fails it at once with `refused`: its `re` has seq 0, which no message
ever has, so it can never be taken for the answer to a real ask. -/
def Kernel.send (lib : Library) (k : Kernel) (s : Addr) : Effect → Kernel
  | .tell r name p => if (k.defs r).isSome ∧ k.declares lib s r name then k.append s r name p .tell else k
  | .ask r name p within =>
    let id : MsgId := ⟨s, r, (k.inbox s r).length + 1⟩
    if (k.defs r).isSome ∧ (name == describeName || k.declares lib s r name) then
      let dl := k.now + min within askMax
      { k.append s r name p (.ask dl) with pending := k.pending ++ [(id, dl)] }
    else k.append kernelAddr s "fail" .null (.fail { id with seq := 0 } .refused)
  | .reply re p => k.answer s re p none

def Kernel.sendAll (lib : Library) (k : Kernel) (s : Addr) (fx : List Effect) : Kernel :=
  fx.foldl (fun k e => k.send lib s e) k

/-- `r` handles its next message from `s` (section 7): judge it, journal it whole with the state it leaves, then
send. Commit, then send (law 11). A refused or failed ask is answered with `fail`; a tell is not. -/
def Kernel.handle (lib : Library) (k : Kernel) (r s : Addr) : Kernel :=
  match (k.inbox s r)[k.read r s]? with
  | none => k
  | some m =>
    let g : Given := ⟨k.now, (k.journal r).length⟩
    let j := judge lib (k.defs r) (k.state r) m g (k.phase r)
    let e : Entry := ⟨m, k.defs r, g, k.state r, k.phase r, j.1, j.2.1, j.2.2.2, j.2.2.1⟩
    let k' : Kernel := { k with
      read := upd2 k.read r s (k.read r s + 1)
      journal := upd k.journal r (k.journal r ++ [e])
      state := upd k.state r j.1
      phase := upd k.phase r j.2.1 }
    match j.2.2.1, m.kind with
    | .done, _ => k'.sendAll lib r j.2.2.2
    | .described, _ => k'.sendAll lib r j.2.2.2
    | .refused, .ask _ => k'.answer r m.id .null (some .refused)
    | .error, .ask _ => k'.answer r m.id .null (some .error)
    | _, _ => k'

/-- The clock moves on, and every ask past its deadline fails with `timeout`, from the actor it was sent to. -/
def Kernel.tick (k : Kernel) (t : Nat) : Kernel :=
  let k := { k with now := max k.now t }
  (k.pending.filter (·.2 ≤ k.now)).foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k

/-- One round of reaching: the phases one allowed message away from those already reached. -/
def Machine.grow (mc : Machine) (ps : List String) : List String :=
  ps ++ (mc.phases.filter (fun e => ps.contains e.1)).flatMap fun e => e.2.flatMap (·.2)

/-- The phases reachable from the initial one: as many rounds as there are phases is enough. -/
def Machine.reach (mc : Machine) : List String := Nat.repeat mc.grow mc.phases.length [mc.initial]

/-- The admission check (section 6): the initial phase is declared, every message the machine names is in the
interface, every phase it leads to is declared, and every declared phase is reachable. -/
def Machine.wellFormed (mc : Machine) (messages : List String) : Bool :=
  mc.declared.contains mc.initial &&
  mc.phases.all (fun e => e.2.all fun t => messages.contains t.1 && t.2.all mc.declared.contains) &&
  mc.declared.all mc.reach.contains

def Def.admit (d : Def) : Bool :=
  match d.machine with
  | none => true
  | some mc => mc.wellFormed d.messages

/-- The address a spawn of `id` gets: the next incarnation. -/
def Kernel.next (k : Kernel) (id : String) : Addr := ⟨"local", id, k.spawned id + 1⟩

/-- Spawning (section 7): the kernel's turn on a `spawn` ask. Only a definition from the repository that its
admission check accepts (`Aven.Actor.Machines`), as a new incarnation of `id`. -/
def Kernel.spawn (lib : Library) (k : Kernel) (id dn : String) : Kernel :=
  match (lib dn).filter Def.admit with
  | none => k
  | some d =>
    let a := k.next id
    { k with
      spawned := upd k.spawned id (k.spawned id + 1)
      defs := upd k.defs a (some dn)
      start := upd k.start a (d.init, d.initialPhase)
      state := upd k.state a d.init
      phase := upd k.phase a d.initialPhase }

/-- Retiring (section 7): the kernel's turn on a `retire` tell. The actor's Doc stays. -/
def Kernel.retire (k : Kernel) (a : Addr) : Kernel := { k with defs := upd k.defs a none }

inductive Event where
  | handle (r s : Addr)
  | tick (t : Nat)
  | spawn (id dn : String)
  | retire (a : Addr)
  | send (e : Effect)
  deriving Repr, Inhabited

def Kernel.step (lib : Library) (k : Kernel) : Event → Kernel
  | .handle r s => k.handle lib r s
  | .tick t => k.tick t
  | .spawn id dn => k.spawn lib id dn
  | .retire a => k.retire a
  | .send e => k.send lib person e

def Kernel.run (lib : Library) (k : Kernel) (es : List Event) : Kernel := es.foldl (Kernel.step lib) k

end Aven.Actor
