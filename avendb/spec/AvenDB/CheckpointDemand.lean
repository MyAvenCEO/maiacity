/-! A scoped checkpoint transport does not turn peer hints into authority. These Boolean
premises represent concrete checks (not cryptography proofs). Current authorization is
relative to held verified governance; unknown revocations and global freshness are not proved. -/
namespace AvenDB.CheckpointDemand
structure Gates where
  ownerApproved : Bool
  readerAuthorized : Bool
  responseRevisionCurrent : Bool
  signedEvidenceAccepted : Bool
  ciphertextVerified : Bool
  bounded : Bool
  demandCurrent : Bool

def deliver (g : Gates) : Bool :=
  g.ownerApproved && g.readerAuthorized && g.responseRevisionCurrent &&
  g.signedEvidenceAccepted && g.ciphertextVerified && g.bounded && g.demandCurrent

def apply (g : Gates) (policy history record : Nat) : Nat × Nat × Option Nat :=
  (policy, history, if deliver g then some record else none)

theorem no_demand_no_adoption (g : Gates) (h : g.demandCurrent = false) : deliver g = false := by
  simp [deliver, h]
theorem revoked_reader_no_delivery (g : Gates) (h : g.readerAuthorized = false) : deliver g = false := by
  simp [deliver, h]
theorem stale_response_no_delivery (g : Gates) (h : g.responseRevisionCurrent = false) : deliver g = false := by
  simp [deliver, h]
theorem unsigned_no_adoption (g : Gates) (h : g.ownerApproved = false) : deliver g = false := by
  simp [deliver, h]
theorem projection_preserves_policy (g : Gates) (p h r : Nat) : (apply g p h r).1 = p := rfl
end AvenDB.CheckpointDemand
