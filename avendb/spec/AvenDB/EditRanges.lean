/-!
Directional proof-backed edit transfer. The offered set is captured only after current scope permission and
current durability checks. A fingerprint is routing evidence; a fetched edit separately needs its signed-root
path and ordinary edit validation. Collision resistance, signatures, byte codecs and scheduling are assumptions.
The fallback legacy pass reconciles records outside the serving device's own durable signer ledger.
-/
namespace AvenDB.EditRanges

abbrev Held (K : Type) := K → Bool

def missing (known offered : Held K) : Held K := fun k => offered k && !known k
def receive (known fetched : Held K) : Held K := fun k => known k || fetched k

/-- A completed verified sparse fetch supplies exactly the offered records that were absent. -/
theorem complete_is_union (known offered : Held K) (k : K) :
    receive known (missing known offered) k = (known k || offered k) := by
  cases hk : known k <;> cases ho : offered k <;> simp [receive, missing, hk, ho]

/-- Remote withdrawal never authorizes deletion of local history. -/
theorem retains_known (known fetched : Held K) (k : K) (h : known k = true) :
    receive known fetched k = true := by
  simp [receive, h]

/-- No returned leaf outside the authorized offered set is requested as a missing edit. -/
theorem missing_only_offered (known offered : Held K) (k : K)
    (h : missing known offered k = true) : offered k = true := by
  simp only [missing, Bool.and_eq_true] at h
  exact h.1

/-- Accept a staged fetch only for the same selected connection/scope and current authorization revision.
`valid` stands for required inclusion evidence AND ordinary signature validation, not fingerprint equality. -/
def accept (current captured : Nat) (scope sameScope valid : Bool) (fetched : Held K) : Held K :=
  fun k => if current = captured ∧ scope = true ∧ sameScope = true ∧ valid = true then fetched k else false

theorem stale_yields_nothing (current captured : Nat) (scope sameScope valid : Bool) (fetched : Held K)
    (h : current ≠ captured) : accept current captured scope sameScope valid fetched = fun _ => false := by
  funext k
  simp [accept, h]

theorem revoked_yields_nothing (current captured : Nat) (sameScope valid : Bool) (fetched : Held K) :
    accept current captured false sameScope valid fetched = fun _ => false := by
  funext k
  simp [accept]

theorem foreign_scope_yields_nothing (current captured : Nat) (scope valid : Bool) (fetched : Held K) :
    accept current captured scope false valid fetched = fun _ => false := by
  funext k
  simp [accept]

theorem invalid_evidence_yields_nothing (current captured : Nat) (scope sameScope : Bool) (fetched : Held K) :
    accept current captured scope sameScope false fetched = fun _ => false := by
  funext k
  simp [accept]

theorem duplicate_receive (known fetched : Held K) :
    receive (receive known fetched) fetched = receive known fetched := by
  funext k
  cases hk : known k <;> cases hf : fetched k <;> simp [receive, hk, hf]

end AvenDB.EditRanges
