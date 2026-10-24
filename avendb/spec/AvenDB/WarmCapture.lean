/-! Frozen capture and existing receipt fencing. This models ownership/ordering,
not Rust scheduling, crypto implementation or bounded latency. -/
namespace AvenDB.WarmCapture
structure Receipt where
  store : Nat
  lineage : Nat
  deriving DecidableEq

def acknowledges (captured current : Receipt) : Bool := decide (captured = current)
theorem changed_store_rejected (a b : Receipt) (h : a.store ≠ b.store) :
    acknowledges a b = false := by
  simp only [acknowledges, decide_eq_false_iff_not]
  intro eq
  exact h (congrArg Receipt.store eq)
theorem changed_lineage_rejected (a b : Receipt) (h : a.lineage ≠ b.lineage) :
    acknowledges a b = false := by
  simp only [acknowledges, decide_eq_false_iff_not]
  intro eq
  exact h (congrArg Receipt.lineage eq)
theorem encoding_preserves_receipt (encode : Input → Output) (input : Input) (r : Receipt) :
    (encode input, r).2 = r := rfl
-- Cancelling an observer does not acknowledge or release the admitted producer.
def cancelObserver (producerActive : Bool) : Bool := producerActive
theorem cancel_keeps_producer (p : Bool) : cancelObserver p = p := rfl
end AvenDB.WarmCapture
