/-!
# Migration discovery is only a scheduling gate

Correspondence: `avendb-browser::local_move_pending` and `Device::moving`. The probe neither drafts nor applies
an edit. A positive probe takes the existing catch-up path and then recomputes `drafted` from the current Lab.
`Device::move_keys`, `Lab::draft_move`, `Lab::draft_retire`, and the peer-frontier requirement are unchanged.
The edit semantics remain `Examples.keyMove`, the strong-removal examples (T16), and `Checkpoint.trusted`.

The retirement constructors below represent candidates whose static predicates in `Lab::retires` already hold:
roots/owners/already-moved own devices are independent of peer liveness; unmoved own devices retire only offline;
a governed old device retires only if its next device is live. `governedCovers` states that each such next device
belongs to the governed device set. This proves the empty/all-governed union covers every actual live subset.
It does not prove Rust extraction, network freshness, or discovery liveness; native differential/scenario tests
and frontend timer-generation tests cover those implementation boundaries. A no-work answer is reconsidered.
-/
namespace AvenDB.MigrationProbe

inductive Candidate where
  | fixed
  | ownOffline (device : Nat)
  | governedOnline (next : Nat)
  deriving DecidableEq

def eligible (candidate : Candidate) (live : Nat → Bool) : Bool :=
  match candidate with
  | .fixed => true
  | .ownOffline device => !(live device)
  | .governedOnline next => live next

def retired (candidates : List Candidate) (live : Nat → Bool) : Bool :=
  candidates.any (fun candidate => eligible candidate live)

def governedCovers (candidates : List Candidate) (governed : Nat → Bool) : Prop :=
  ∀ next, Candidate.governedOnline next ∈ candidates → governed next = true

def retirementProbe (candidates : List Candidate) (governed : Nat → Bool) : Bool :=
  retired candidates (fun _ => false) || retired candidates governed

/-- No particular live-peer subset can hide a retirement from the conservative two-extreme probe. -/
theorem retirement_covered (candidates : List Candidate) (governed live : Nat → Bool)
    (cover : governedCovers candidates governed) (work : retired candidates live = true) :
    retirementProbe candidates governed = true := by
  obtain ⟨candidate, member, _⟩ := List.any_eq_true.mp work
  change (retired candidates (fun _ => false) || retired candidates governed) = true
  simp only [Bool.or_eq_true]
  cases candidate with
  | fixed =>
    exact Or.inl (List.any_eq_true.mpr ⟨Candidate.fixed, member, rfl⟩)
  | ownOffline device =>
    exact Or.inl (List.any_eq_true.mpr ⟨Candidate.ownOffline device, member, rfl⟩)
  | governedOnline next =>
    exact Or.inr (List.any_eq_true.mpr ⟨Candidate.governedOnline next, member, cover next member⟩)

/-- Only a successful existing freshness check can expose the plan recomputed afterwards. -/
def checkedPlan {Plan : Type} (possible fresh : Bool) (recomputed : Option Plan) : Option Plan :=
  if possible && fresh then recomputed else none

theorem exposed_plan_requires_freshness {Plan : Type} (possible fresh : Bool)
    (recomputed : Option Plan) (plan : Plan) (h : checkedPlan possible fresh recomputed = some plan) :
    fresh = true ∧ recomputed = some plan := by
  cases possible <;> cases fresh <;> simp_all [checkedPlan]

theorem no_work_exposes_no_plan {Plan : Type} (fresh : Bool) (recomputed : Option Plan) :
    checkedPlan false fresh recomputed = none := by
  simp [checkedPlan]

theorem positive_probe_preserves_existing_check {Plan : Type} (fresh : Bool) (recomputed : Option Plan) :
    checkedPlan true fresh recomputed = (if fresh then recomputed else none) := by
  simp [checkedPlan]

end AvenDB.MigrationProbe
