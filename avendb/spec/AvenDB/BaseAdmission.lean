/- Admission conditions are supplied by the existing signature/policy/CRDT implementation.
This proves the shared Boolean gate, not cryptography, Loro equivalence, or durable recovery. -/
namespace AvenDB.BaseAdmission
structure Evidence where
  dependenciesCounted : Bool
  lands : Bool
  authorized : Bool
  schemaFits : Bool
  proposalPasses : Bool

def admit (e : Evidence) : Bool :=
  e.dependenciesCounted && e.lands && e.authorized && e.schemaFits && e.proposalPasses

def localAdmission (e : Evidence) := admit e
def remote (e : Evidence) := admit e

theorem peer_equivalent (e : Evidence) : localAdmission e = remote e := rfl

theorem authorized (e : Evidence) (h : admit e = true) : e.authorized = true := by
  simp only [admit, Bool.and_eq_true] at h
  exact h.1.1.2

theorem counted_dependencies (e : Evidence) (h : admit e = true) : e.dependenciesCounted = true := by
  simp only [admit, Bool.and_eq_true] at h
  exact h.1.1.1.1

theorem rejects_revoked (e : Evidence) (h : e.authorized = false) : admit e = false := by
  unfold admit
  rw [h]
  simp

/- Equivalence requires independent counted-history and exact CRDT-byte correspondence;
an owner-authenticated claim alone is deliberately insufficient. -/
def equivalent (countedFacts snapshotBytes : Bool) := countedFacts && snapshotBytes

theorem equivalence_needs_snapshot (facts bytes : Bool)
    (h : equivalent facts bytes = true) : bytes = true := by
  simp only [equivalent, Bool.and_eq_true] at h
  exact h.2
end AvenDB.BaseAdmission
