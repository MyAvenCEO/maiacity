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

namespace OwnerDependencyScheduling
-- A missing frontier is only a normal-transfer request; it never licenses
-- admission. Admission still requires every discovered frontier to be current.
def admissible (unknown : Bool) (missing : List α) : Bool := !unknown && missing.isEmpty
theorem missingNeverAdmits (unknown : Bool) (head : α) (tail : List α) :
    admissible unknown (head :: tail) = false := by simp [admissible]
theorem unknownNeverAdmits (missing : List α) :
    admissible true missing = false := by simp [admissible]
end OwnerDependencyScheduling

namespace AvenDB.OwnerAudienceClosure
/-- Every historical audience and named keep grant remains a required dependency.
A later move does not erase the authority needed to rejudge earlier writes. -/
def requiredShares (audiences : List Audience) (keeps : List ShareId) : List ShareId :=
  audiences.flatten ++ keeps

theorem historicalShareRetained (before after : List Audience) (keeps : List ShareId)
    (share : ShareId) (h : share ∈ before.flatten) :
    share ∈ requiredShares (before ++ after) keeps := by
  simp only [requiredShares, List.flatten_append, List.mem_append]
  exact Or.inl (Or.inl h)

theorem keepShareRetained (audiences : List Audience) (keeps : List ShareId)
    (share : ShareId) (h : share ∈ keeps) :
    share ∈ requiredShares audiences keeps := by
  simp only [requiredShares, List.mem_append]
  exact Or.inr h
end AvenDB.OwnerAudienceClosure

namespace AvenDB.AcceptedBaseSuffix
/-- A retained base is only a suffix starting point. It is never held history. -/
structure Evidence where
  currentBase : Bool
  currentAuthority : Bool
  signaturesValid : Bool
  localHistory : Nat

def mayReceive (e : Evidence) : Bool := e.currentBase && e.currentAuthority && e.signaturesValid
def historyCoverageAfterRequest (e : Evidence) : Nat := e.localHistory

theorem staleBaseRefused (e : Evidence) (h : e.currentBase = false) : mayReceive e = false := by
  simp [mayReceive, h]
theorem missingAuthorityRefused (e : Evidence) (h : e.currentAuthority = false) : mayReceive e = false := by
  simp [mayReceive, h]
theorem requestingSuffixDoesNotInventHistory (e : Evidence) :
    historyCoverageAfterRequest e = e.localHistory := rfl
end AvenDB.AcceptedBaseSuffix
