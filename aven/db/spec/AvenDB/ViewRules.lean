import AvenDB.StoredView

/-!
# The replay rules a stored view is sealed to

A device seals its stored view (`StoredView.lean`, M1) to the number of the replay rules it was worked out under,
`viewRules`, never to the build of the engine that worked it out. A release that keeps the rules keeps every device's
stored view: the device opens it and steps the new edits on it (V1). A release that changes them names a new number,
and every view sealed to the old one stays shut, so the device replays its edits once and seals its view again.

`viewRules` names what `view` and `standing` (`Step.lean`) give for a list of edits, with all they read: `order`,
`resolve`, `runWith`, `step`, `apply`, the cuts and the priorities, and the state they build (`State.lean`). Bump it
in the same change as any edit to those that changes what they give, and as any fix to the engine that changes what
its replay gives (the Rust core's pinned views, `tests/all/stored_view.rs`, fail until it is bumped). A change of how the
engine writes a view down is not a change of the rules: the view's own format line names that (`policy/view.rs`).

The engine reads the number from this file as it builds (`crates/avendb/build.rs`), so this line is its one source.

The proof of VR1: a view opens only under the rules it was sealed to, only against edits whose first ones are the
very edits it is of, and what opens is then what the replay of those edits gives (`VR1_opens_replay`). Whatever an
older engine gave under other rules never opens (`VR2_other_rules_stay_shut`). A view of the first edits a device
holds opens however many edits came after them (`VR3_prefix_opens`), so a device may seal its view at any point of
its log, not only when it has caught up; the edits after it step on it as V1 says, or replay.
-/

namespace AvenDB.ViewRules

open Syncing

/-- The number of the replay rules. -/
def viewRules : Nat := 1

/-- A view as a device seals it: the rules it was worked out under, the ids of the edits it is of, in the order the
    device took them, what it knows of them and the edits that stand. -/
structure Sealed where
  rules : Nat
  ids   : List EditId
  st    : State
  stood : List Edit

/-- The view an engine under rules `r` seals of `held`, `v` and `s` being what its replay gives. -/
def sealWith (r : Nat) (v : List Edit → State) (s : List Edit → List Edit) (held : List Edit) : Sealed :=
  ⟨r, held.map Edit.id, v held, s held⟩

/-- The view this engine seals of `held`. -/
def sealOf (held : List Edit) : Sealed := sealWith viewRules view standing held

/-- What a sealed view gives a device that holds `mine`: what it knows and the edits that stand, where it was sealed
    under these rules and of the very first edits of `mine`; else nothing, and the device replays. -/
def opens (s : Sealed) (mine : List Edit) : Option (State × List Edit) :=
  if s.rules = viewRules ∧ (mine.take s.ids.length).map Edit.id = s.ids then some (s.st, s.stood) else none

/-- Ids name edits (they are the hashes of the signed edits): lists of edits with the same ids are the same. -/
theorem map_id_inj (hinj : ∀ a b : Edit, a.id = b.id → a = b) :
    ∀ xs ys : List Edit, xs.map Edit.id = ys.map Edit.id → xs = ys
  | [], [], _ => rfl
  | [], _ :: _, h => by simp at h
  | _ :: _, [], h => by simp at h
  | x :: xs, y :: ys, h => by
    simp only [List.map_cons, List.cons.injEq] at h
    rw [hinj x y h.1, map_id_inj hinj xs ys h.2]

/-- VR1: a view that opens was sealed under these rules, of the first edits the device holds, and gives what the
    replay of those edits gives, whatever engine sealed it, so long as an engine under these rules replays as `view`
    and `standing` do. -/
theorem VR1_opens_replay (r : Nat) (v : List Edit → State) (s : List Edit → List Edit) (held mine : List Edit)
    (hrules : r = viewRules → v = view ∧ s = standing) (hinj : ∀ a b : Edit, a.id = b.id → a = b)
    {st : State} {stood : List Edit} (h : opens (sealWith r v s held) mine = some (st, stood)) :
    mine.take held.length = held ∧ st = view held ∧ stood = standing held := by
  unfold opens sealWith at h
  dsimp only at h
  split at h
  · rename_i hc
    obtain ⟨hr, hid⟩ := hc
    obtain ⟨h1, h2⟩ := Prod.mk.inj (Option.some.inj h)
    obtain ⟨hv, hs⟩ := hrules hr
    have hl : (held.map Edit.id).length = held.length := by simp
    rw [hl] at hid
    exact ⟨map_id_inj hinj _ _ hid, by rw [← h1, hv], by rw [← h2, hs]⟩
  · simp at h

/-- VR2: a view sealed under other rules never opens. -/
theorem VR2_other_rules_stay_shut (r : Nat) (v : List Edit → State) (s : List Edit → List Edit)
    (held mine : List Edit) (hr : r ≠ viewRules) : opens (sealWith r v s held) mine = none := by
  unfold opens sealWith
  dsimp only
  simp [hr]

/-- VR3: the view of the first edits a device holds opens, however many edits it took after them, and gives the
    replay of those first edits. -/
theorem VR3_prefix_opens (held more : List Edit) :
    opens (sealOf held) (held ++ more) = some (view held, standing held) := by
  unfold opens sealOf sealWith
  dsimp only
  simp

end AvenDB.ViewRules
