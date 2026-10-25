import AvenDB.State

/-!
The narrow owner-write scope uses the actual executable policy model. These
lemmas justify excluding share-op/cap-group evaluation from that one branch;
they do NOT justify excluding wide-reader key-epoch authority, or assert that
an incomplete network inventory establishes a complete authorization closure.
-/
namespace AvenDB.OwnerAuthorityScope

theorem owner_may_write (st : State) (en : Entry) :
    mayWrite st en.vault en = true := by
  simp [mayWrite]

theorem owner_may_create (st : State) (v : VaultId) (audience : Audience) :
    mayCreate st v v audience = true := by
  simp [mayCreate]

/-- Owner writes still need schema fit and counted causal dependencies. They do
not inspect a grant's group operations, proposal acceptance or share selector. -/
theorem owner_counts_reduce (st : State) (en : Entry) (deps : List EditId)
    (proof : Option ShareId) (main : Bool) (touches : List Touch) (fits : Bool) :
    counts st en.vault en deps proof main touches fits =
      (fits && deps.all (fun d => !st.uncounted.contains d)) := by
  simp [counts]

end AvenDB.OwnerAuthorityScope
