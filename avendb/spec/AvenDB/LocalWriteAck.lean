/-! A local write acknowledgement is a backend receipt, not a peer receipt.
The implementation must supply the exact journal prefix containing the edit and
its key/signing dependencies. This model assumes honest backend completion;
it does not prove OS fsync, browser retention, or a latency bound. -/
namespace AvenDB.LocalWriteAck

structure Receipt where
  edit : Nat
  journal : Nat
  dependenciesKept : Bool

def acknowledges (written : Nat) (receipt : Receipt) : Prop :=
  receipt.edit = written ∧ written ≤ receipt.journal ∧ receipt.dependenciesKept = true

def success (written : Nat) (result : Except String Receipt) : Prop :=
  ∃ receipt, result = .ok receipt ∧ acknowledges written receipt

theorem failure_not_success (written : Nat) (error : String) :
    ¬ success written (.error error) := by
  intro ⟨receipt, h, _⟩
  cases h

theorem success_contains_write (written : Nat) (receipt : Receipt)
    (h : success written (.ok receipt)) : written ≤ receipt.journal := by
  obtain ⟨r, same, valid⟩ := h
  cases same
  exact valid.2.1

def returned (written : Nat) (result : Except String Receipt)
    (_warmDone _peersDone : Bool) : Prop := success written result

theorem independent_of_optional_work (written : Nat) (result : Except String Receipt)
    (warmA warmB peersA peersB : Bool) :
    returned written result warmA peersA = returned written result warmB peersB := rfl

end AvenDB.LocalWriteAck
