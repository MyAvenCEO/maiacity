namespace AvenDB.CeremonyCancellation
-- The active ceremony is owned by its request identity. Timeout and late
-- completion may retire only their own request, never its replacement.
def retire [DecidableEq α] (request : α) (active : Option α) : Option α :=
  if active = some request then none else active

theorem own_retired [DecidableEq α] (request : α) :
    retire request (some request) = none := by simp [retire]

theorem replacement_preserved [DecidableEq α] (old new : α) (different : new ≠ old) :
    retire old (some new) = some new := by simp [retire, different]

-- A timed-out result is terminal. A late approval cannot become success.
inductive Result where
  | pending | approved | failed | expired
  deriving DecidableEq

def finish (current answer : Result) : Result :=
  if current = .pending then answer else current

theorem timeout_terminal (answer : Result) : finish .expired answer = .expired := by
  simp [finish]
end AvenDB.CeremonyCancellation
