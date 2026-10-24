/-! A representation boundary, NOT a cryptographic impossibility theorem.
`Claim` is the owner-attested Write-metadata projection (not the complete signed Edit).
`Judgment` adds a body-derived schema/authorization verdict omitted from that projection.
The model deliberately does not assume the owner is honest or that the omitted verdict
has a sound proof. Under these assumptions metadata alone cannot reconstruct the verdict.
Original author signatures over complete encrypted edits do not assert this derived bit. -/
namespace AvenDB.ProvenanceBoundary
structure Claim where
  entry : Nat
  edit : Nat
  author : Nat
  deriving DecidableEq
structure Judgment where
  claim : Claim
  counted : Bool

def visible (j : Judgment) : Claim := j.claim

theorem omitted_judgment_not_recoverable :
    ¬ ∃ decide : Claim → Bool, ∀ j : Judgment, decide (visible j) = j.counted := by
  rintro ⟨decide, sound⟩
  let c : Claim := ⟨1, 2, 3⟩
  have yes := sound ⟨c, true⟩
  have no := sound ⟨c, false⟩
  have impossible : true = false := yes.symm.trans no
  cases impossible

structure Evidence where
  originalSignatures : Bool
  ownerApproved : Bool
  semanticWitnessVerified : Bool

def independent (e : Evidence) : Bool := e.originalSignatures && e.semanticWitnessVerified

theorem signatures_do_not_supply_omitted_witness (e : Evidence)
    (h : e.semanticWitnessVerified = false) : independent e = false := by
  simp [independent, h]

/- The existing Snapshot model can instead assume honest owner-attested state. That is
an explicit assumption, distinct from independently verified historical provenance. -/
def conditionalOwnerBase (e : Evidence) (honest confined standing nonstale : Bool) : Bool :=
  e.ownerApproved && honest && confined && standing && nonstale

theorem owner_path_requires_honesty (e : Evidence) (honest confined standing nonstale : Bool)
    (h : conditionalOwnerBase e honest confined standing nonstale = true) : honest = true := by
  simp only [conditionalOwnerBase, Bool.and_eq_true] at h
  exact h.1.1.1.2
end AvenDB.ProvenanceBoundary
