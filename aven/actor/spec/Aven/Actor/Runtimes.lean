import Aven.Actor.Deadlines
import Aven.Runtime.State
import Aven.Runtime.Markup

/-!
# Actors and their runtimes

The runtimes live in `aven/runtimes` (`Aven.Runtime.State`, `Aven.Runtime.Markup`); this file joins them to actors.

- `StatePart.turn`: a state-runtime part as an actor's turn. A reply goes to the ask being handled (a reply to a
  tell is dropped); a tell goes to an address given as text, `scope/id/n` (anything else is dropped).
- `stateTurn_phase`: the phase a state-runtime turn asks for is its rule's; the kernel takes it only where the
  machine allows it (`machine_sound`), as for every turn.
- `face_actor_checked`: what a face actor's face-runtime gives back passes the applier's check, before the applier
  draws it.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)
open Aven.Runtime (StatePart SendOut FacePart Placement FaceOut faceRun treeLimits)

def Addr.ofText? (s : String) : Option Addr :=
  match s.splitOn "/" with
  | [scope, id, n] => n.toNat?.map fun n => ⟨scope, id, n⟩
  | _ => none

def sendEffect (m : Message) (s : SendOut) : Option Effect :=
  match s with
  | .reply v => if m.kind.isAsk then some (.reply m.id v) else none
  | .tell to name p => (Addr.ofText? to).map fun a => .tell a name p

/-- A state-runtime part as an actor's turn. -/
def stateTurn (part : StatePart) (st : Value) (m : Message) (_ : Given) (_ : String) : Option Output :=
  (part.step st m.name m.payload).map fun o => ⟨o.state, o.sends.filterMap (sendEffect m), o.phase⟩

theorem stateTurn_phase (part : StatePart) (st : Value) (m : Message) (g : Given) (rule : Aven.Runtime.StateRule)
    (ph : String) (h : part.lookup m.name = some rule) : (stateTurn part st m g ph).map (·.phase) = some rule.phase := by
  simp [stateTurn, Aven.Runtime.StatePart.step, h]

/-- A face actor's face passes the applier's check before the applier draws it. -/
theorem face_actor_checked {fp : FacePart} {data : Value} {o : FaceOut} {pls : List Placement}
    (h : faceRun fp data = some (o, pls)) : Aven.Runtime.check treeLimits o.tree = true :=
  Aven.Runtime.face_passes_check (Aven.Runtime.faceRun_ok h)

end Aven.Actor
