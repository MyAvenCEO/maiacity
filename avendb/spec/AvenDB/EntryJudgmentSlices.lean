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

namespace PreparedJudgmentReuse
structure Context where
  log : Nat
  keys : Nat
  deriving DecidableEq
def reuse (saved current : Context) (reshow opened : Bool) : Bool :=
  decide (saved = current) && !reshow && !opened
theorem changedContextRejects (saved current : Context) (h : saved ≠ current)
    (reshow opened : Bool) : reuse saved current reshow opened = false := by
  simp [reuse, h]
theorem newBodyRejects (saved current : Context) (reshow : Bool) :
    reuse saved current reshow true = false := by simp [reuse]
-- Reuse keeps the entire sequence of historical group definitions, not only
-- the final group version, because each ordinary write uses its replay place.
def retainedHistory (history : List Nat) := history
theorem preservesEveryHistoricalVersion (history : List Nat) :
    retainedHistory history = history := rfl
end PreparedJudgmentReuse

namespace ColdQuerySlices
-- A partial query's observed count is not an exact count of its local match set.
def exactCount (deferred unresolved : Nat) : Bool := deferred == 0 && unresolved == 0
theorem deferredCountNotExact (n unresolved : Nat) :
    exactCount (n+1) unresolved = false := by simp [exactCount]
def pageComplete (deferred : Nat) : Bool := deferred == 0
theorem deferredPageNotComplete (n : Nat) : pageComplete (n+1) = false := by simp [pageComplete]
def admitted (used : Nat) : Bool := used < 4
theorem fourColdCandidatesExhaustTurn : admitted 4 = false := rfl
-- Unavailable semantic dependencies are not work a local hydration can finish.
def charge (canProgress alreadyAttempted : Bool) : Nat :=
    if canProgress && !alreadyAttempted then 1 else 0
theorem unresolvedDoesNotConsumeBudget (seen : Bool) : charge false seen = 0 := by simp [charge]
theorem candidateChargedOnlyOnce (ready : Bool) : charge ready true = 0 := by simp [charge]
-- An already-ready record does not need scheduling admission. This result
-- never replaces the independent authorization of the actual query read.
def needsWork (ready : Bool) := !ready
theorem readyDoesNotNeedWork : needsWork true = false := rfl
end ColdQuerySlices
