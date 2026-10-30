import Aven.Core

/-!
# The directory's guarantees

A directory lists a vault's Docs of one root type. Between folds it keeps, in its own Doc, which Docs are
**unfolded**: written since the last fold, version V, in a way the folded Values don't show yet (docs, "Directories and
indexes"). The rule that makes an index exact: **whoever commits to a Doc of the type marks it unfolded in the same
commit whenever its entries change**: when the Doc is born, when a field an index sorts by changes, when it leaves.
A fold clears the mark, and its version is the new V.

The engine's `lookup_exact` and `fold_eq_build` take two facts about the directory as hypotheses; they are proven here:
- `listed_now`: every Doc listed now was listed at V or is unfolded;
- `same_entries`: a Doc that isn't unfolded has the entries it had at V.

A Doc's **entries** are what every index of the type reads from it (the engine's keys). The model takes them as one
value per Doc, `none` for a Doc that isn't there.
-/

namespace Aven.DB.Docs.Directory

open Aven.Core

/-- What the directory knows of each Doc: its entries, and whether it is unfolded. -/
structure Dir (E : Type) where
  entries : DocId → Option E
  unfolded : List DocId

/-- A Doc is listed while it has entries. -/
def Dir.listed {E : Type} (d : Dir E) (doc : DocId) : Prop := (d.entries doc).isSome

/-- One commit to a Doc of the type, giving its entries after it (`none` when it leaves). The directory rule: the same
commit marks it unfolded whenever its entries change. -/
def Dir.commit {E : Type} [DecidableEq E] (d : Dir E) (doc : DocId) (after : Option E) : Dir E :=
  { entries := fun x => if x = doc then after else d.entries x,
    unfolded := if after = d.entries doc then d.unfolded else doc :: d.unfolded }

/-- A run of commits. -/
def Dir.run {E : Type} [DecidableEq E] (d : Dir E) : List (DocId × Option E) → Dir E
  | [] => d
  | (doc, after) :: cs => (d.commit doc after).run cs

/-- A fold: the marks go, and this is the new V. -/
def Dir.fold {E : Type} (d : Dir E) : Dir E := { d with unfolded := [] }

theorem mem_unfolded_run {E : Type} [DecidableEq E] {doc : DocId} :
    ∀ {d : Dir E} {cs : List (DocId × Option E)}, doc ∈ d.unfolded → doc ∈ (d.run cs).unfolded
  | _, [], h => h
  | d, (x, a) :: cs, h => by
    apply mem_unfolded_run (cs := cs)
    simp only [Dir.commit]
    split
    · exact h
    · exact List.mem_cons_of_mem _ h

/-- A Doc that isn't unfolded has the entries it had at V. -/
theorem same_entries {E : Type} [DecidableEq E] {doc : DocId} :
    ∀ {v : Dir E} {cs : List (DocId × Option E)}, doc ∉ (v.run cs).unfolded → (v.run cs).entries doc = v.entries doc
  | _, [], _ => rfl
  | v, (x, a) :: cs, h => by
    have ih := same_entries (v := v.commit x a) (cs := cs) h
    have e : (v.commit x a).entries doc = v.entries doc := by
      by_cases hx : doc = x
      · subst hx
        by_cases hs : a = v.entries doc
        · simp [Dir.commit, hs]
        · exfalso
          exact h (mem_unfolded_run (d := v.commit doc a) (cs := cs) (by simp [Dir.commit, hs]))
      · simp [Dir.commit, hx]
    exact ih.trans e

/-- Every Doc listed now was listed at V, or is unfolded. -/
theorem listed_now {E : Type} [DecidableEq E] {v : Dir E} {cs : List (DocId × Option E)} {doc : DocId}
    (h : (v.run cs).listed doc) : v.listed doc ∨ doc ∈ (v.run cs).unfolded := by
  by_cases hu : doc ∈ (v.run cs).unfolded
  · exact .inr hu
  · left
    simpa [Dir.listed, same_entries hu] using h

/-- After a fold, nothing is unfolded: the fold's Values show everything. -/
theorem fold_clears {E : Type} (d : Dir E) (doc : DocId) : doc ∉ d.fold.unfolded := by
  simp [Dir.fold]

end Aven.DB.Docs.Directory
