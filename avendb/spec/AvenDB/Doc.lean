/-!
# Documents, proposals, merge and promote

Loro isn't modelled op by op. A document's history is the list of its updates, and the `Loro` structure states
what we rely on as laws: the content depends only on which updates are present (convergence), and `revertTo` can
bring a document to the content of any version it contains (Loro's `revert_to`). Theorems about proposals hold for
every `Loro` that satisfies these laws, so no axiom is needed.
-/

namespace AvenDB

abbrev Update := Nat
abbrev History := List Update

/-- What we rely on from Loro. -/
structure Loro where
  Doc : Type
  materialize : History → Doc
  /-- Convergence: the same updates give the same content, whatever their order or repetition. -/
  converges : ∀ h₁ h₂ : History, (∀ u, u ∈ h₁ ↔ u ∈ h₂) → materialize h₁ = materialize h₂
  /-- `revertTo h t`: a new update that brings `h` to the content of `t`, a version `h` contains. -/
  revertTo : History → History → Update
  revert_new : ∀ h t, revertTo h t ∉ h
  reverts : ∀ h t, (∀ u ∈ t, u ∈ h) → materialize (h ++ [revertTo h t]) = materialize t

/-- Merge a proposal into main: import the updates main doesn't have. -/
def merge (main proposal : History) : History := main ++ proposal.filter (fun u => decide (u ∉ main))

/-- Promote: merge, then revert to the proposal's head. (The Loro research showed that reverting main first and
    importing afterwards doesn't reliably give the proposal's content.) -/
def promote (L : Loro) (main proposal : History) : History :=
  merge main proposal ++ [L.revertTo (merge main proposal) proposal]

theorem mem_merge {a b : History} {u : Update} : u ∈ merge a b ↔ u ∈ a ∨ u ∈ b := by
  unfold merge
  simp only [List.mem_append, List.mem_filter, decide_eq_true_eq]
  constructor
  · rintro (h | ⟨h, _⟩)
    · exact Or.inl h
    · exact Or.inr h
  · rintro (h | h)
    · exact Or.inl h
    · by_cases ha : u ∈ a
      · exact Or.inl ha
      · exact Or.inr ⟨h, ha⟩

/-- T10a: merging is commutative. -/
theorem T10_merge_comm (L : Loro) (a b : History) : L.materialize (merge a b) = L.materialize (merge b a) :=
  L.converges _ _ fun u => by simp only [mem_merge, Or.comm]

/-- T10b: merging the same proposal again changes nothing. -/
theorem T10_merge_idem (L : Loro) (a b : History) :
    L.materialize (merge (merge a b) b) = L.materialize (merge a b) :=
  L.converges _ _ fun u => by simp only [mem_merge, or_self, or_assoc]

/-- T10c: merging keeps every update of both sides; no history is lost. -/
theorem T10_merge_keeps (a b : History) (u : Update) (h : u ∈ a ∨ u ∈ b) : u ∈ merge a b := mem_merge.2 h

/-- T10d: promote ends with exactly the proposal's content. -/
theorem T10_promote_content (L : Loro) (main proposal : History) :
    L.materialize (promote L main proposal) = L.materialize proposal :=
  L.reverts _ _ fun _ hu => mem_merge.2 (Or.inr hu)

/-- T10e: promote keeps both histories. -/
theorem T10_promote_keeps (L : Loro) (main proposal : History) (u : Update) (h : u ∈ main ∨ u ∈ proposal) :
    u ∈ promote L main proposal :=
  List.mem_append.2 (Or.inl (mem_merge.2 h))

end AvenDB
