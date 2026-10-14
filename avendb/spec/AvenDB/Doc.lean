/-!
# Documents, proposals and one merge

Loro isn't modelled op by op. A document's history is the list of its updates, and the `Loro` structure states
what we rely on as laws: what a history shows depends only on which updates are present (convergence), and `put`
makes an update that brings a history to show any record (`Item::put_record`). Theorems about proposals hold for
every `Loro` that satisfies these laws, so no axiom is needed.

A record is seen place by place (`Rec`): a field, a field of a row, a row itself. Merging one line into another keeps
every update of both (T10a to T10c). What the line merged into then shows is worked out from three records, as git
merges a file: the base, what both lines held in common; ours, the line merged into; theirs, the line merged in
(`mergeInto`). A place only one side changed shows that change, and a place both changed alike shows it. A place both
changed differently shows both changes joined where they don't clash, as a text both edited at places apart; where
they do clash, a conflict, the line merged into keeps its own value, unless the person merging takes the other's
there. So nothing the line merged into changed is lost (T10d), all the other line changed alone lands (T10e), and the
person's choice touches the conflicts alone (`T10_merge_choice`).
-/

namespace AvenDB

abbrev Update := Nat
abbrev History := List Update

/-- A record place by place: its value at each place, `none` where it has nothing. -/
abbrev Rec (P V : Type) := P → Option V

/-- What we rely on from Loro, for records with places `P` and values `V`. -/
structure Loro (P V : Type) where
  materialize : History → Rec P V
  /-- Convergence: the same updates give the same content, whatever their order or repetition. -/
  converges : ∀ h₁ h₂ : History, (∀ u, u ∈ h₁ ↔ u ∈ h₂) → materialize h₁ = materialize h₂
  /-- `put h r`: a new update that brings `h` to show record `r` (`Item::put_record`). -/
  put : History → Rec P V → Update
  put_new : ∀ h r, put h r ∉ h
  puts : ∀ h r, materialize (h ++ [put h r]) = r

/-- Merge a proposal into main: import the updates main doesn't have. -/
def merge (main proposal : History) : History := main ++ proposal.filter (fun u => decide (u ∉ main))

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
theorem T10_merge_comm {P V : Type} (L : Loro P V) (a b : History) : L.materialize (merge a b) = L.materialize (merge b a) :=
  L.converges _ _ fun u => by simp only [mem_merge, Or.comm]

/-- T10b: merging the same proposal again changes nothing. -/
theorem T10_merge_idem {P V : Type} (L : Loro P V) (a b : History) :
    L.materialize (merge (merge a b) b) = L.materialize (merge a b) :=
  L.converges _ _ fun u => by simp only [mem_merge, or_self, or_assoc]

/-- T10c: merging keeps every update of both sides; no history is lost. -/
theorem T10_merge_keeps (a b : History) (u : Update) (h : u ∈ a ∨ u ∈ b) : u ∈ merge a b := mem_merge.2 h

/-! ## One merge, place by place -/

section Places

variable {P V : Type} [DecidableEq V]

/-- What both changes of place `p` join to where they don't clash, by `join` (in Rust `history::join`: a text both
    edited at places apart), if anything. -/
def joined (join : V → V → V → Option V) (base ours theirs : Rec P V) (p : P) : Option V :=
  match base p, ours p, theirs p with
  | some b, some o, some t => join b o t
  | _, _, _ => none

/-- A conflict at place `p`: both sides changed it since the base, to different values that don't join. -/
def conflict (join : V → V → V → Option V) (base ours theirs : Rec P V) (p : P) : Bool :=
  ours p != base p && theirs p != base p && ours p != theirs p && (joined join base ours theirs p).isNone

/-- One merge of `theirs` into `ours` from their `base` (`History::merge`): place by place, the change of whichever
    side changed it, both changes joined where they don't clash, and at a conflict ours, or theirs where the person
    merging takes it (`take`). -/
def mergeInto (join : V → V → V → Option V) (base ours theirs : Rec P V) (take : P → Bool) : Rec P V := fun p =>
  if ours p = base p then theirs p
  else if theirs p = base p ∨ ours p = theirs p then ours p
  else match joined join base ours theirs p with
    | some v => some v
    | none => if take p then theirs p else ours p

variable (join : V → V → V → Option V) (base ours theirs : Rec P V) (take : P → Bool)

/-- T10d: nothing the line merged into changed is lost: at each place it changed since the base, it shows its own
    value, or both changes joined, unless the person merging took the other's at a conflict there. -/
theorem T10_merge_keeps_ours (p : P) (hch : ours p ≠ base p)
    (hk : ¬(conflict join base ours theirs p = true ∧ take p = true)) :
    mergeInto join base ours theirs take p = ours p ∨
      ∃ v, joined join base ours theirs p = some v ∧ mergeInto join base ours theirs take p = some v := by
  unfold mergeInto
  by_cases h2 : theirs p = base p ∨ ours p = theirs p
  · simp [hch, h2]
  · simp only [hch, h2, ↓reduceIte]
    cases hv : joined join base ours theirs p with
    | some v => exact .inr ⟨v, rfl, rfl⟩
    | none =>
      have hc : conflict join base ours theirs p = true := by
        simp only [not_or] at h2
        simp [conflict, hch, h2.1, h2.2, hv]
      have ht : take p = false := by simpa using fun ht => hk ⟨hc, ht⟩
      simp [ht]

/-- T10e: all the other line changed alone lands: at each place the line merged into left as the base had it, the
    merge shows the other line's value. -/
theorem T10_merge_lands_theirs (p : P) (h : ours p = base p) : mergeInto join base ours theirs take p = theirs p := by
  simp [mergeInto, h]

/-- T10e, whole: merging into a line that didn't change since the base shows the other line (a fast-forward). -/
theorem T10_merge_fast_forward (h : ours = base) : mergeInto join base ours theirs take = theirs :=
  funext fun p => T10_merge_lands_theirs join base ours theirs take p (by rw [h])

/-- And merging a line that didn't change since the base changes nothing. -/
theorem T10_merge_nothing_new (h : theirs = base) : mergeInto join base ours theirs take = ours := by
  funext p
  unfold mergeInto
  by_cases hp : ours p = base p
  · simp [hp, h]
  · simp [hp, h]

/-- The person's choice touches the conflicts alone, and at a conflict the merge shows the side they chose. -/
theorem T10_merge_choice (take' : P → Bool) (p : P) (h : conflict join base ours theirs p = false) :
    mergeInto join base ours theirs take p = mergeInto join base ours theirs take' p := by
  unfold mergeInto
  by_cases h1 : ours p = base p
  · simp [h1]
  · by_cases h2 : theirs p = base p ∨ ours p = theirs p
    · simp [h1, h2]
    · simp only [h1, h2, ↓reduceIte]
      cases hv : joined join base ours theirs p with
      | some v => rfl
      | none =>
        simp only [not_or] at h2
        simp [conflict, h1, h2.1, h2.2, hv] at h

theorem T10_merge_conflict (p : P) (h : conflict join base ours theirs p = true) :
    mergeInto join base ours theirs take p = if take p then theirs p else ours p := by
  simp only [conflict, Bool.and_eq_true, bne_iff_ne, ne_eq, Option.isNone_iff_eq_none] at h
  obtain ⟨⟨⟨hch, htb⟩, hot⟩, hv⟩ := h
  have h2 : ¬(theirs p = base p ∨ ours p = theirs p) := by rintro (h | h) <;> contradiction
  unfold mergeInto
  simp only [hch, h2, ↓reduceIte, hv]

end Places

end AvenDB
