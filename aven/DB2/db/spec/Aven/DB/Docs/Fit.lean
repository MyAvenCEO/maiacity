import Aven.Core

/-!
# Fit, and why schemas say only what survives a merge

A field replaced whole merges by its later write, Loro's map: the write with the greater stamp (Lamport, then writer
id, as one number here). So a merge never makes a value no one wrote, and a rule about a single value holds of the
merge when it holds of every write (docs, rule 16; Samuel, 30 Oct 2026).

A rule about a container's size doesn't survive: two writers each adding one item to a list allowed one item both fit,
and their merge holds two (`size_rule_breaks`). That is why the schema language leaves such rules out.

What it proves: `latest_mem`, `fit_merge`, `latest_append` (the later write of a merge is the later of each side's),
and the counterexample.
-/

namespace Aven.DB.Docs

open Aven.Core

/-- One write of a field: its stamp and its value. -/
structure Write (V : Type) where
  stamp : Nat
  value : V

/-- The later of two writes; the first on a tie. -/
def pick {V : Type} : Option (Write V) → Option (Write V) → Option (Write V)
  | none, y => y
  | x, none => x
  | some a, some b => if a.stamp < b.stamp then some b else some a

/-- A field's value after every write: the latest. -/
def latest {V : Type} : List (Write V) → Option (Write V)
  | [] => none
  | w :: ws => pick (some w) (latest ws)

theorem pick_mem {V : Type} {x y : Option (Write V)} {w : Write V} (h : pick x y = some w) :
    x = some w ∨ y = some w := by
  match x, y with
  | none, _ => exact .inr h
  | some a, none => exact .inl h
  | some a, some b =>
    simp only [pick] at h
    split at h <;> simp_all

theorem latest_mem {V : Type} : ∀ {ws : List (Write V)} {w : Write V}, latest ws = some w → w ∈ ws
  | [], _, h => by simp [latest] at h
  | x :: ws, w, h => by
    rcases pick_mem h with h | h
    · simp only [Option.some.injEq] at h; simp [h]
    · exact List.mem_cons_of_mem _ (latest_mem h)

/-- A rule on single values holds of the merge when every write keeps it. -/
theorem fit_merge {V : Type} (P : V → Prop) {ws : List (Write V)} (h : ∀ w ∈ ws, P w.value) {w : Write V}
    (hw : latest ws = some w) : P w.value :=
  h w (latest_mem hw)

theorem pick_assoc {V : Type} (x y z : Option (Write V)) : pick x (pick y z) = pick (pick x y) z := by
  match x, y, z with
  | none, _, _ => simp [pick]
  | some a, none, _ => simp [pick]
  | some a, some b, none => simp [pick]; split <;> simp
  | some a, some b, some c =>
    simp only [pick]
    by_cases h₁ : b.stamp < c.stamp <;> by_cases h₂ : a.stamp < b.stamp <;> by_cases h₃ : a.stamp < c.stamp <;>
      simp [h₁, h₂, h₃] <;> omega

/-- The latest write of two sides merged is the later of each side's latest. -/
theorem latest_append {V : Type} : ∀ (a b : List (Write V)), latest (a ++ b) = pick (latest a) (latest b)
  | [], b => by simp [latest, pick]
  | x :: a, b => by simp only [List.cons_append, latest, latest_append a b, pick_assoc]

/-- A size rule doesn't survive a merge: each side has one item, the merge has two. -/
theorem size_rule_breaks : ∃ (base a b : List Nat), base.length ≤ 1 ∧ (base ++ a).length ≤ 1 ∧
    (base ++ b).length ≤ 1 ∧ ¬ (base ++ a ++ b).length ≤ 1 :=
  ⟨[], [1], [2], by decide, by decide, by decide, by decide⟩

end Aven.DB.Docs
