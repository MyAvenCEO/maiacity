/- Local query rows are not a proof of network discovery. Candidate records may
be absent or untranslatable; neither zero rows nor checkpoint provenance closes
that uncertainty. This model grants no authority and asserts no sync completion. -/
namespace AvenDB.QueryReadiness
structure Evidence where
  unresolvedCandidates : Nat
  checkpointPartial : Bool
  authoritativeEmpty : Bool := false

def localEvidence (unresolved : Nat) (checkpoint : Bool) : Evidence :=
  { unresolvedCandidates := unresolved, checkpointPartial := checkpoint }
theorem local_empty_not_authoritative (n : Nat) (p : Bool) :
    (localEvidence n p).authoritativeEmpty = false := rfl
theorem unresolved_retained (n : Nat) (p : Bool) :
    (localEvidence n p).unresolvedCandidates = n := rfl
end AvenDB.QueryReadiness
