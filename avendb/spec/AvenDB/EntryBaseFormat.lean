/- Stage-one envelope model only. Owner authenticity and held-policy checks are inputs,
not cryptographic proofs. No theorem claims honest CRDT state or suffix convergence. -/
namespace AvenDB.EntryBaseFormat
structure Envelope where
  version : Nat
  vault : Nat
  entry : Nat
  fullSnapshots : Bool
  basisBound : Bool
  linesBound : Bool
  bytesBound : Bool
structure Authority where
  ownerApproved : Bool
  currentReader : Bool
  ciphertextBound : Bool
  currentPolicy : Bool

def accept (e : Envelope) (a : Authority) (vault entry : Nat) : Bool :=
  decide (e.version = 2) && decide (e.vault = vault) && decide (e.entry = entry) &&
  e.fullSnapshots && e.basisBound && e.linesBound && e.bytesBound &&
  a.ownerApproved && a.currentReader && a.ciphertextBound && a.currentPolicy

def writable (_e : Envelope) (_a : Authority) : Bool := false

theorem representation_not_writable (e : Envelope) (a : Authority) : writable e a = false := rfl
theorem wrong_entry_rejected (e : Envelope) (a : Authority) (v x : Nat) (h : e.entry ≠ x) :
    accept e a v x = false := by simp [accept, h]
theorem wrong_vault_rejected (e : Envelope) (a : Authority) (v x : Nat) (h : e.vault ≠ v) :
    accept e a v x = false := by simp [accept, h]
theorem shallow_rejected (e : Envelope) (a : Authority) (v x : Nat) (h : e.fullSnapshots = false) :
    accept e a v x = false := by simp [accept, h]
theorem revoked_rejected (e : Envelope) (a : Authority) (v x : Nat) (h : a.currentReader = false) :
    accept e a v x = false := by simp [accept, h]
theorem stale_policy_rejected (e : Envelope) (a : Authority) (v x : Nat) (h : a.currentPolicy = false) :
    accept e a v x = false := by simp [accept, h]
end AvenDB.EntryBaseFormat
