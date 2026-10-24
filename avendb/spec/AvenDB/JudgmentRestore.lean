/- Owner-attested restoration under Snapshot's explicit honesty assumption. The kernel
is independently replayed; a known removal invalidates the attested judgment. No theorem
here asserts that an owner is honest or that a Loro decoder is resource bounded. -/
namespace AvenDB.JudgmentRestore
structure State where
  kernel : Nat
  judgment : Nat
structure Attestation where
  ownerApproved : Bool
  confined : Bool
  standing : Bool
  removalKnown : Bool
  judgment : Nat

def restore (s : State) (a : Attestation) : Option State :=
  if a.ownerApproved && a.confined && a.standing && !a.removalKnown
  then some { s with judgment := a.judgment } else none

theorem kernel_preserved (s : State) (a : Attestation) (next : State)
    (h : restore s a = some next) : next.kernel = s.kernel := by
  unfold restore at h
  split at h
  · cases Option.some.inj h
    rfl
  · contradiction

theorem known_removal_refuses (s : State) (a : Attestation)
    (h : a.removalKnown = true) : restore s a = none := by
  simp [restore, h]

theorem exact_judgment (s : State) (a : Attestation) (next : State)
    (h : restore s a = some next) : next.judgment = a.judgment := by
  unfold restore at h
  split at h
  · cases Option.some.inj h
    rfl
  · contradiction
end AvenDB.JudgmentRestore
