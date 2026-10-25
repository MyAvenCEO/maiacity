namespace AvenDB.EntryJudgmentSlices
structure Job where
  basis : Nat
  cursor : Nat
  total : Nat
  deriving DecidableEq

def eligible (job : Job) (current : Nat) : Bool := job.basis == current

def advance (job : Job) (budget : Nat) : Job :=
  { job with cursor := min job.total (job.cursor + budget) }

def publish (job : Job) (current : Nat) : Prop :=
  job.basis = current ∧ job.cursor = job.total

theorem incomplete_hidden (job : Job) (current : Nat) (h : job.cursor ≠ job.total) :
    ¬ publish job current := by simp [publish, h]

theorem stale_hidden (job : Job) (current : Nat) (h : job.basis ≠ current) :
    ¬ publish job current := by simp [publish, h]

theorem step_bounded (job : Job) (budget : Nat) :
    (advance job budget).cursor ≤ job.cursor + budget := by
  exact Nat.min_le_right _ _

def upkeepAllowed (pending : List Job) : Prop := pending = []
theorem pending_blocks_upkeep (job : Job) (rest : List Job) :
    ¬ upkeepAllowed (job :: rest) := by simp [upkeepAllowed]
end AvenDB.EntryJudgmentSlices
