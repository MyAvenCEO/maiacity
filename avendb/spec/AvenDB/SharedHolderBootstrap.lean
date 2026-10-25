/- A holder is not the publisher. The owner-approved scope and current recipient
key/read entitlement are assumptions checked by the existing projection validator.
Local mutation still requires ordinary per-write policy, counted dependencies,
schema fit and a complete immutable grant proof. This contract does not prove the
owner's historical attestation independently or support cap-group history. -/
namespace AvenDB.SharedHolderBootstrap
def adoption (ownerApproved currentRecipient scopeAndKey : Bool) : Bool :=
 ownerApproved && currentRecipient && scopeAndKey
def mutation (adopted ready ordinaryAdmission fixedGrantProof : Bool) : Bool :=
 adopted && ready && ordinaryAdmission && fixedGrantProof
theorem recipient_not_publisher (r k : Bool) : adoption false r k = false := by simp [adoption]
theorem read_does_not_grant_write (a r p : Bool) : mutation a r false p = false := by simp [mutation]
theorem pending_refuses_write (a o p : Bool) : mutation a false o p = false := by simp [mutation]
theorem missing_proof_refuses_write (a r o : Bool) : mutation a r o false = false := by simp [mutation]
-- No remote epoch assignment or audience-key insertion. Current policy and
-- owner approval are independently checked; AEAD/key binding is an assumption.
def capsuleRead (standingOwnerRoot currentRecipient exactScope exactKey : Bool) : Bool :=
 standingOwnerRoot && currentRecipient && exactScope && exactKey
theorem capsule_revocation (o s k : Bool) : capsuleRead o false s k = false := by simp [capsuleRead]
theorem capsule_wrong_scope (o r k : Bool) : capsuleRead o r false k = false := by simp [capsuleRead]
theorem capsule_wrong_key (o r s : Bool) : capsuleRead o r s false = false := by simp [capsuleRead]
def capsuleKernel (kernel : α) := kernel
theorem capsule_preserves_kernel (kernel : α) : capsuleKernel kernel = kernel := rfl
-- A retained capsule supplies an authenticated view but not an ordinary write key.
def capsuleMutation (ordinaryWriteReady : Bool) : Bool := false && ordinaryWriteReady
theorem retained_capsule_is_readonly (ready : Bool) : capsuleMutation ready = false := by simp [capsuleMutation]
end AvenDB.SharedHolderBootstrap
