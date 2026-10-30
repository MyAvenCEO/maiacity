import Aven.Actor.Deadlines
import Aven.Runtime.Markup

/-!
# Actors and their runtimes

The runtimes live in `aven/runtimes`; this file joins them to actors. state-runtime's join (a part as a turn, and
its phase taken only where the machine allows) comes with `Aven.Runtime.State` (#1550).

- `face_actor_checked`: what a face actor's face-runtime gives back passes the applier's check, before the applier
  draws it.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)
open Aven.Runtime (FacePart Placement FaceOut faceRun treeLimits)

/-- A face actor's face passes the applier's check before the applier draws it. -/
theorem face_actor_checked {fp : FacePart} {data : Value} {o : FaceOut} {pls : List Placement}
    (h : faceRun fp data = some (o, pls)) : Aven.Runtime.check treeLimits o.tree = true :=
  Aven.Runtime.face_passes_check (Aven.Runtime.faceRun_ok h)

end Aven.Actor
