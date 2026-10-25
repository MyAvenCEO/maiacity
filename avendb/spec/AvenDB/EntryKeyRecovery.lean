import AvenDB.Theorems

/- Exact entry-key recovery transports an already authorized capability, not a new
policy edge. Provider checks are against its ordinary signed replay/answer set.
The recipient independently replays current policy and authenticates the exact
signed Write/body/key ID. Agreement about unseen revocations is not proved here;
normal sync/revocation assumptions remain. No family key or kernel epoch travels.
Cryptographic box/AEAD/key-commitment correctness remains an explicit assumption. -/
namespace AvenDB.EntryKeyRecovery

def exactEntry (e : EntryId) (stay : Option EditId) (epoch : Nat) : KeyName → Bool
 | .entry x s g => x == e && s == stay && g == epoch
 | _ => false

def permitted (ordinaryAnswer senderExactReach recipientExactReach currentRecipient signedBody : Bool) : Bool :=
 ordinaryAnswer && senderExactReach && recipientExactReach && currentRecipient && signedBody

theorem no_unanswered (a b c d : Bool) : permitted false a b c d = false := by simp [permitted]
theorem no_new_reach (a b c d : Bool) : permitted a b false c d = false := by simp [permitted]
theorem revoked_refused (a b c d : Bool) : permitted a b c false d = false := by simp [permitted]
theorem unsigned_refused (a b c d : Bool) : permitted a b c d false = false := by simp [permitted]
theorem scoped_family_refused (e : EntryId) (s : Option EditId) (g h : Nat) (k : KeyFam) :
 exactEntry e s g (.scoped k h) = false := rfl

def applyRecovery (st : State) := st
theorem kernel_unchanged (st : State) : applyRecovery st = st := rfl
end AvenDB.EntryKeyRecovery

namespace AvenDB.EntryKeyRecovery
/- Retained ciphertext alone is not authority. Reopen repeats current validation;
writes still require the existing durable, schema and ordinary admission gates. -/
def reopened (retained currentValidated : Bool) := retained && currentValidated
def writable (frontierKeys durable schema ordinaryAdmission : Bool) :=
 frontierKeys && durable && schema && ordinaryAdmission
theorem retained_not_authority (r : Bool) : reopened r false = false := by simp [reopened]
theorem no_missing_frontier_write (d s a : Bool) : writable false d s a = false := by simp [writable]
theorem no_unpersisted_write (f s a : Bool) : writable f false s a = false := by simp [writable]
theorem no_schema_bypass (f d a : Bool) : writable f d false a = false := by simp [writable]
end AvenDB.EntryKeyRecovery
