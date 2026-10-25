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

namespace AvenDB.EntryJudgmentSlices
-- The caller establishes unchanged target, key, lane and group context through
-- the strict ordinary-content transition; a generic log change cannot rebase.
def preserve (job : Job) (before after : Nat) (unchanged : Bool) : Option Job :=
  if job.basis = before ∧ unchanged = true then some {job with basis := after} else none

theorem changed_context_cancels (job : Job) (before after : Nat) :
    preserve job before after false = none := by simp [preserve]

theorem preservation_keeps_progress (job result : Job) (before after : Nat) (unchanged : Bool)
    (h : preserve job before after unchanged = some result) : result.cursor = job.cursor := by
  simp only [preserve] at h
  split at h
  · cases h; rfl
  · contradiction
end AvenDB.EntryJudgmentSlices

namespace ReceiveJudgmentBoundary
-- Deferred receive keeps the admitted bytes; it does not publish unfinished
-- judgment. A later scheduled turn may publish only completed judgment.
def visible (admitted judged : Bool) : Bool := admitted && judged
theorem admissionAloneNotVisible : visible true false = false := rfl
theorem finishedAdmissionVisible : visible true true = true := rfl
end ReceiveJudgmentBoundary

namespace OwnerSuffixPacing
-- Admission changes the log generation before its accepted overlay is rebuilt.
-- A retained owner base is usable only against the exact current generation.
def current (overlay log : Nat) : Prop := overlay = log
theorem deferredSuffixInvalidates (generation : Nat) :
    ¬ current generation (generation + 1) := by
  simp [current]
theorem canonicalRebuildRestores (generation : Nat) :
    current generation generation := rfl
end OwnerSuffixPacing
