/-! Resource lifetime only: a verifier may be retired when no proof is waiting,
and only the owning generation may handle a response or retire that worker.
This does not model proof verification or JavaScript timer implementation. -/
namespace AvenDB.ProofWorker

def mayRetire (pending owner current : Nat) : Prop := pending = 0 ∧ owner = current

theorem busy_worker_kept (n owner current : Nat) : ¬ mayRetire (n + 1) owner current := by
  simp [mayRetire]

theorem stale_generation_kept (pending owner current : Nat) (h : owner ≠ current) :
    ¬ mayRetire pending owner current := by
  simp [mayRetire, h]

theorem idle_owner_released (owner : Nat) : mayRetire 0 owner owner := by
  simp [mayRetire]

end AvenDB.ProofWorker
