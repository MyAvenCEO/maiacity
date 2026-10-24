/-!
Signature preparation is an immutable input optimization, not cached authorization.
The opaque Rust token owns the original signed edits. A preparation result is consulted only for that
same first occurrence; absent results use ordinary verification. Duplicate/checkpoint handling and
current gate admission still run under the Lab lock. This model assumes the cryptographic verifier
and the Rust token's ownership boundary; differential Rust tests check their integration.
-/
namespace AvenDB.PreparedReceive

def signature (prepared : Option Bool) (verify : Bool) : Bool := prepared.getD verify

theorem prepared_agrees (prepared : Option Bool) (verify : Bool)
    (valid : ∀ result, prepared = some result → result = verify) :
    signature prepared verify = verify := by
  cases prepared with
  | none => rfl
  | some result => simpa [signature] using valid result rfl

def admitted (signed currentGate : Bool) : Bool := signed && currentGate

theorem preparation_never_grants_gate (signed : Bool) : admitted signed false = false := by
  simp [admitted]

theorem current_gate_is_required (signed gate : Bool) (h : admitted signed gate = true) :
    gate = true := by cases signed <;> cases gate <;> simp_all [admitted]

end AvenDB.PreparedReceive
