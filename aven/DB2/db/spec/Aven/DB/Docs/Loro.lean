import Aven.Core

/-!
# Loro, by the properties it states

The docs layer doesn't model Loro's algorithms. It models what Loro promises and what the docs spec relies on
(docs, "What Lean proves"; the docs audit's W20):

- **Convergence:** the same changes applied in any order give the same state. Loro states it for orders in which each
  change follows what it builds on. The model takes the stronger form, any order, which keeps the theorems short; the
  Rust tests check it against Loro on causal orders, where both agree.
- **A snapshot is a cache:** loading a snapshot and the changes after it gives what replaying every change gives.

What it proves: `converges` and `snapshot_load`.
-/

namespace Aven.DB.Docs

open Aven.Core

/-- A CRDT whose state is the merge of the envelopes applied to it. -/
structure Loro (St : Type) where
  empty : St
  apply : St → Envelope → St
  /-- Two changes applied one after the other give one state, in either order. -/
  comm : ∀ s a b, apply (apply s a) b = apply (apply s b) a

/-- The state after applying `l`, from nothing. -/
def Loro.replay {St : Type} (L : Loro St) (l : List Envelope) : St := l.foldl L.apply L.empty

/-- The same envelopes in any order give the same state. -/
theorem Loro.converges {St : Type} (L : Loro St) {l₁ l₂ : List Envelope} (h : l₁.Perm l₂) :
    L.replay l₁ = L.replay l₂ :=
  h.foldl_eq' (fun _ _ _ _ z => L.comm z _ _) _

/-- A snapshot is a cache: the state of what it covers, then the rest, is the state of everything (docs, rule 5). -/
theorem Loro.snapshot_load {St : Type} (L : Loro St) (covered after : List Envelope) :
    after.foldl L.apply (L.replay covered) = L.replay (covered ++ after) := by
  simp [Loro.replay, List.foldl_append]

end Aven.DB.Docs
