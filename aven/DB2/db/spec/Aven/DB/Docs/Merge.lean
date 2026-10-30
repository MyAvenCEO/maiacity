/-!
# Three-way merges, revert and back out

A merge settles every place both branches changed since their base three-way, on top of Loro's union (docs, rule 22):
a field, a Record by id, a list's order. Text never conflicts. The person merging may take the other branch's value at a
conflict.

What it proves, per place and so for any set of places (`mergeAll`):
- `keeps_target`: nothing the target changed since the base is lost, unless the merger took the other side there;
- `lands_other`: what only the other branch changed lands;
- `conflict_by_choice`: where both changed one place differently, the result is the merger's choice;
- `merge_same`: two branches that agree give that;
- `back_out_removes`, `back_out_keeps_later`: backing out a commit takes out its change where nothing since touched
  it, and keeps what came since where something did.
-/

namespace Aven.DB.Docs

/-- One place merged: its base, the target's value, the other branch's, and whether the merger takes the other's. -/
def merge3 {V : Type} [DecidableEq V] (base target other : V) (takeOther : Bool) : V :=
  if target = base then other
  else if other = base then target
  else if takeOther then other else target

theorem keeps_target {V : Type} [DecidableEq V] {base target other : V} {t : Bool} (h : target ≠ base)
    (hc : other = base ∨ t = false) : merge3 base target other t = target := by
  unfold merge3; rcases hc with hc | hc <;> simp_all

theorem lands_other {V : Type} [DecidableEq V] {base other : V} {t : Bool} : merge3 base base other t = other := by
  simp [merge3]

theorem conflict_by_choice {V : Type} [DecidableEq V] {base target other : V} {t : Bool} (h₁ : target ≠ base)
    (h₂ : other ≠ base) : merge3 base target other t = if t then other else target := by
  simp [merge3, h₁, h₂]

theorem merge_same {V : Type} [DecidableEq V] {base x : V} {t : Bool} : merge3 base x x t = x := by
  unfold merge3; split <;> simp_all

/-- Every place merged: places are fields, Records by id, a list's order. -/
def mergeAll {P V : Type} [DecidableEq V] (base target other : P → V) (take : P → Bool) : P → V :=
  fun p => merge3 (base p) (target p) (other p) (take p)

/-- Backing out a commit: a three-way merge whose base is the state after it, the target now, the other side the
state before it, never taking the other side at a conflict. -/
def backOut {P V : Type} [DecidableEq V] (after now before : P → V) : P → V :=
  mergeAll after now before fun _ => false

theorem back_out_removes {P V : Type} [DecidableEq V] {after now before : P → V} {p : P} (h : now p = after p) :
    backOut after now before p = before p := by
  simp [backOut, mergeAll, h, lands_other]

theorem back_out_keeps_later {P V : Type} [DecidableEq V] {after now before : P → V} {p : P}
    (h : now p ≠ after p) : backOut after now before p = now p := by
  simp only [backOut, mergeAll]
  exact keeps_target h (.inr rfl)

end Aven.DB.Docs
