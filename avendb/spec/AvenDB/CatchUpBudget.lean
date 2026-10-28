/-!
# Every step of a catch-up is bounded, and the steps end (G5)

A catch-up runs a step at a time, each its own turn of a node's Lab, so that a person's write waits for one step, not
for the whole catch-up (`Lab::catch_up_step` in lab.rs, `Writes.lean` for the wait). Until 2026-10-27 a step was
bounded only while it showed entries: a first sync's replay of every edit was one step (10.5-24 s at 130,000 edits),
and so was the opening of every body (1.7 s).

Now a step does one of three kinds of work, each at most `k` units of it:

- replay: the log's next `k` edits at most, stepped on from where the last step left (`step_replay`, `REPLAY_WORK`);
- read: the next `k` bodies at most, those of new edits first, then those a step left (`read`, `READ_WORK`);
- show: the next entries a showing left, by the writes it judges (`show_items`, `SHOW_WORK`).

`step` models one step. Its work is at most `k` (`work_le`). Without new edits, each step leaves strictly less to do
(`step_shrinks`), so the catch-up ends within `left` steps (`ends_within`). Bodies of new edits go first: a page of at
most `k` new bodies is read whole in the next read step (`fresh_first`).
-/

namespace AvenDB.CatchUpBudget

/-- What a catch-up still has to do: edits to replay, bodies to open, entries to show. -/
structure Todo where
  replay : Nat
  read : List Nat
  shows : List Nat
  deriving DecidableEq, Repr

/-- How much is left, in units of work. -/
def Todo.left (t : Todo) : Nat := t.replay + t.read.length + t.shows.length

/-- One read: at most `k` bodies, of the new edits `fresh` first, then of those left; what it leaves. -/
def readStep (k : Nat) (fresh left : List Nat) : List Nat := (fresh ++ left).drop k

/-- One step of at most `k` units: the replay first, then the bodies, then the entries. -/
def step (k : Nat) (t : Todo) : Todo :=
  if 0 < t.replay then { t with replay := t.replay - k }
  else if t.read ≠ [] then { t with read := readStep k [] t.read }
  else { t with shows := t.shows.drop k }

/-- The work one step does. -/
def work (k : Nat) (t : Todo) : Nat := t.left - (step k t).left

theorem work_le (k : Nat) (t : Todo) : work k t ≤ k := by
  unfold work step Todo.left readStep
  split
  · simp only; omega
  · split
    · simp only [List.nil_append, List.length_drop]; omega
    · simp only [List.length_drop]; omega

/-- A step with anything left to do, and `0 < k`, leaves strictly less. -/
theorem step_shrinks (k : Nat) (hk : 0 < k) (t : Todo) (h : 0 < t.left) : (step k t).left < t.left := by
  unfold step Todo.left readStep at *
  split
  · simp only; omega
  · split
    · rename_i _ hr
      have : 0 < t.read.length := List.length_pos_iff.mpr hr
      simp only [List.nil_append, List.length_drop]; omega
    · rename_i h0 hr
      have : t.read = [] := by simpa using hr
      simp only [this, List.length_nil, List.length_drop] at *
      omega

/-- `n` steps. -/
def steps (k : Nat) : Nat → Todo → Todo
  | 0, t => t
  | n + 1, t => steps k n (step k t)

theorem steps_left_le (k : Nat) (hk : 0 < k) (n : Nat) (t : Todo) : (steps k n t).left ≤ t.left - n := by
  induction n generalizing t with
  | zero => simp [steps]
  | succ n ih =>
    simp only [steps]
    by_cases h : 0 < t.left
    · have := step_shrinks k hk t h
      have := ih (step k t)
      omega
    · have h0 : t.left = 0 := by omega
      have : (step k t).left ≤ t.left := by have := work_le k t; unfold work at this; unfold step Todo.left readStep at *; split <;> (try split) <;> simp_all <;> omega
      have := ih (step k t)
      omega

/-- Without new edits, a catch-up ends within as many steps as it has units left. -/
theorem ends_within (k : Nat) (hk : 0 < k) (t : Todo) : (steps k t.left t).left = 0 := by
  have := steps_left_le k hk t.left t
  omega

/-- Bodies of new edits go first: at most `k` of them are all read in the next read step, however many were left. -/
theorem fresh_first (k : Nat) (fresh left : List Nat) (h : fresh.length ≤ k) :
    readStep k fresh left = left.drop (k - fresh.length) := by
  unfold readStep
  rw [List.drop_append, List.drop_eq_nil_of_le h, List.nil_append]

namespace Examples

-- a first sync: 130,000 edits to replay, 130,000 bodies, 3,200 entries; 768 units a step
def first : Todo := { replay := 130000, read := List.range 130000, shows := List.range 3200 }
#guard (step 768 first).replay == 130000 - 768
#guard work 768 first == 768
-- once replayed, a step opens 768 bodies at most
#guard work 768 { first with replay := 0 } == 768
-- a live page of 5 bodies in the middle of the backlog is read in the next step
#guard readStep 768 [1, 2, 3, 4, 5] (List.range 1000) == (List.range 1000).drop 763

end Examples

end AvenDB.CatchUpBudget
