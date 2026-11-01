import Aven.ID.Tree

/-! # Height

A vault's height is the length of the longest line of owners above it, counted with as much fuel as the tree has
vaults. A well-formed tree's owners stand strictly lower than what they own, which is how it has no cycles. -/

namespace Aven.ID

def maxl : List Nat → Nat
  | [] => 0
  | x :: xs => max x (maxl xs)

theorem le_maxl {x : Nat} : ∀ {l : List Nat}, x ∈ l → x ≤ maxl l
  | y :: ys, h => by
    cases List.mem_cons.mp h with
    | inl e => subst e; exact Nat.le_max_left _ _
    | inr m => exact Nat.le_trans (le_maxl m) (Nat.le_max_right _ _)

theorem maxl_le {n : Nat} : ∀ {l : List Nat}, (∀ x ∈ l, x ≤ n) → maxl l ≤ n
  | [], _ => Nat.zero_le _
  | y :: ys, h => Nat.max_le.mpr ⟨h y (by simp), maxl_le fun x m => h x (by simp [m])⟩

namespace Tree

variable {V : Type} [DecidableEq V]

def height (t : Tree V) : Nat → V → Nat
  | 0, _ => 0
  | f + 1, b => maxl ((t.ownersOf b).map fun a => t.height f a + 1)

theorem height_le (t : Tree V) : ∀ (f : Nat) (b : V), t.height f b ≤ f
  | 0, _ => Nat.le_refl _
  | f + 1, b => maxl_le fun x m => by
    obtain ⟨a, _, e⟩ := List.mem_map.mp m
    subst e
    exact Nat.succ_le_succ (t.height_le f a)

def rank (t : Tree V) (b : V) : Nat := t.height t.vaults.length b

theorem rank_le (t : Tree V) (b : V) : t.rank b ≤ t.vaults.length := t.height_le _ _

end Tree
end Aven.ID
