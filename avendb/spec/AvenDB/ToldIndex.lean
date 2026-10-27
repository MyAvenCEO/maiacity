import AvenDB.SharedIndex

/-!
# The told index (batch 5, after B1)

What a peer that keeps an index (the always-on peer) was told: each device tells all its rows of one vault at a time,
and they replace what it told of that vault before (`BlindIndex`, `avendb::index::Rows::take`). The Rust
`told_index` keeps them as a `ShelfIndex` on the peer's shelf, not in memory: each tell's changes applied at once, its
slot after its pages.

- T1: the rows it holds are the fold of the tells it took, whatever it held in memory (`T1_fold`): the index after a
  tell is the rows of the state that tell gives, as `SharedIndex.X1_step` puts again each entry it changed.
- T2: a crash before a tell's slot leaves the rows of the tells before it (`ShelfIndex.I3_crash`). The digest of that
  tell is not kept, so the device's next offer finds the peer lacking the vault and tells it again; a tell replaces
  what its device told of the vault, so taken again it gives the state as if it had come once (`T2_again`).
-/

namespace AvenDB.ToldIndex

variable {S T : Type}

/-- The told state after the tells `ts`, from `s`. -/
def fold (take : S → T → S) (s : S) (ts : List T) : S := ts.foldl take s

/-- T1: the tells taken one by one are the fold of them all. -/
theorem T1_fold (take : S → T → S) (s : S) (ts : List T) (t : T) :
    take (fold take s ts) t = fold take s (ts ++ [t]) := by
  simp [fold, List.foldl_append]

/-- A tell replaces what its device told of its vault: taken twice in a row it is taken once. -/
def Replaces (take : S → T → S) : Prop := ∀ s t, take (take s t) t = take s t

/-- T2: a tell lost to a crash and told again leaves the state it would have left taken once, and a tell taken and
    told again too: the device's offer can't tell which, and needn't. -/
theorem T2_again (take : S → T → S) (hr : Replaces take) (s : S) (ts : List T) (t : T) :
    take (fold take s ts) t = fold take s (ts ++ [t]) ∧
      take (fold take s (ts ++ [t])) t = fold take s (ts ++ [t]) := by
  refine ⟨T1_fold take s ts t, ?_⟩
  rw [← T1_fold take s ts t]
  exact hr _ _

end AvenDB.ToldIndex
