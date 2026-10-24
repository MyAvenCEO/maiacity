/-! Upkeep computes authorized families from one immutable state. Reusing that
same-round selection for current entry audiences must equal fresh authorization.
This is not a persisted authorization cache or a performance proof. -/
namespace AvenDB.UpkeepFamilies

def selected (families : List α) (entitled : α → Bool) : List α :=
  families.filter entitled

theorem current_family_equivalence [BEq α] [LawfulBEq α]
    (families : List α) (entitled : α → Bool) (family : α)
    (current : family ∈ families) :
    family ∈ selected families entitled ↔ entitled family = true := by
  simp [selected, List.mem_filter, current]

-- Each new state supplies its own family list and predicate; no old decision is reused.
theorem changed_state_equivalence [BEq α] [LawfulBEq α]
    (newFamilies : List α) (newEntitled : α → Bool) (family : α)
    (current : family ∈ newFamilies) :
    family ∈ selected newFamilies newEntitled ↔ newEntitled family = true :=
  current_family_equivalence newFamilies newEntitled family current
end AvenDB.UpkeepFamilies
