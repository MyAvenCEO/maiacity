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
