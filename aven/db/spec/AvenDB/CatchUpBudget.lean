/-!
# Every step of a catch-up is bounded, and the steps end (G5)

A catch-up runs a step at a time, each its own turn of a node's Lab, so that a person's write waits for one step, not
for the whole catch-up (`Lab::catch_up_step` in lab.rs, `Writes.lean` for the wait). Until 2026-10-27 a step was
bounded only while it showed entries: a first sync's replay of every edit was one step (10.5-24 s at 130,000 edits),
and so was the opening of every body (1.7 s).

Now a step does one of four kinds of work, each at most `k` units of it:

- replay: the log's next `k` edits at most, stepped on from where the last step left (`step_replay`, `REPLAY_WORK`);
- index: the replay's next `k` edits at most added to the key index, where a whole replay or a removal has it made
  again of every edit (`KeyIndexed::step`, `INDEX_WORK`; made whole in one step until 2026-10-28, 27.9 s on an iPhone);
- read: the next `k` bodies at most, those of new edits first, then those a step left (`read`, `READ_WORK`);
- show: the next entries a showing left, by the writes it judges (`show_items`, `SHOW_WORK`).

A step that lets go of bare edits no checkpoint vouches for (`trust`) leaves the replay of what it keeps to the next
steps, as `replay` work, rather than replay every edit again in the same turn (until 2026-10-28).

`step` models one step. Its work is at most `k` (`work_le`). Without new edits, each step leaves strictly less to do
(`step_shrinks`), so the catch-up ends within `left` steps (`ends_within`). Bodies of new edits go first: a page of at
most `k` new bodies is read whole in the next read step (`fresh_first`).

A device holding its owners' bases of entries steps the same way (until 2026-10-28 it took its whole catch-up in one
step): after each step it lays the bases over again (`rebuild_owner_bases`), work of at most `c` that depends on the
bases it holds (16 at most, each at most 1 MiB), not on the log. Its step stays bounded by `k + c` (`based_le`).

A device's start (`Lab::restore_end_with`) does what is left past its stored view in one go only while that is at most
`w` units (`RESTORE_WHOLE`); with more, it does one step and ends behind, its node's catch-up taking the rest a step at a
time (until 2026-10-28 it did it all: an iPhone's unlock of a partial vault with no stored view took 313 s). Its work is
at most `max w k` however much is left (`start_le`), and what it leaves ends like any catch-up (`start_ends`).

What a device takes in the middle of a catch-up (a page, the keys a pull brought after its pages) adds to what is left
and brings it one step on, not the whole of it (`take`, `taken_le`; `Lab::receive_now_prepared`). Until 2026-10-28 it
brought the whole catch-up in one turn: 1.8 min on an iPhone, whose page's worker runs the Lab and answered no peer
meanwhile, so every peer's asking of it waited out its connection.
-/

namespace AvenDB.CatchUpBudget

/-- What a catch-up still has to do: edits to replay, bodies to open, entries to show. -/
structure Todo where
  replay : Nat
  index : Nat
  read : List Nat
  shows : List Nat
  deriving DecidableEq, Repr

/-- How much is left, in units of work. -/
def Todo.left (t : Todo) : Nat := t.replay + t.index + t.read.length + t.shows.length

/-- One read: at most `k` bodies, of the new edits `fresh` first, then of those left; what it leaves. -/
def readStep (k : Nat) (fresh left : List Nat) : List Nat := (fresh ++ left).drop k

/-- One step of at most `k` units: the replay first, then the key index, then the bodies, then the entries. -/
def step (k : Nat) (t : Todo) : Todo :=
  if 0 < t.replay then { t with replay := t.replay - k }
  else if 0 < t.index then { t with index := t.index - k }
  else if t.read ≠ [] then { t with read := readStep k [] t.read }
  else { t with shows := t.shows.drop k }

/-- The work one step does. -/
def work (k : Nat) (t : Todo) : Nat := t.left - (step k t).left

theorem work_le (k : Nat) (t : Todo) : work k t ≤ k := by
  unfold work step Todo.left readStep
  split
  · simp only; omega
  · split
    · simp only; omega
    · split
      · simp only [List.nil_append, List.length_drop]; omega
      · simp only [List.length_drop]; omega

/-- A based device's step: the step's work and the bases laid over again, at most `c`. -/
def basedWork (k c : Nat) (t : Todo) : Nat := work k t + c

theorem based_le (k c : Nat) (t : Todo) : basedWork k c t ≤ k + c := by
  unfold basedWork; have := work_le k t; omega

/-- A step with anything left to do, and `0 < k`, leaves strictly less. -/
theorem step_shrinks (k : Nat) (hk : 0 < k) (t : Todo) (h : 0 < t.left) : (step k t).left < t.left := by
  unfold step Todo.left readStep at *
  split
  · simp only; omega
  · split
    · simp only; omega
    · split
      · rename_i _ _ hr
        have : 0 < t.read.length := List.length_pos_iff.mpr hr
        simp only [List.nil_append, List.length_drop]; omega
      · rename_i h0 hi hr
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
      have : (step k t).left ≤ t.left := by have := work_le k t; unfold work at this; unfold step Todo.left readStep at *; split <;> (try split) <;> (try split) <;> simp_all <;> omega
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

/-- A start's work: what is left, in one go while that is at most `w`; else one step of at most `k`. -/
def startWork (w k : Nat) (t : Todo) : Nat := if t.left ≤ w then t.left else work k t

/-- What a start leaves to its catch-up: nothing, or what its one step left. -/
def startLeaves (w k : Nat) (t : Todo) : Todo := if t.left ≤ w then { replay := 0, index := 0, read := [], shows := [] } else step k t

theorem start_le (w k : Nat) (t : Todo) : startWork w k t ≤ max w k := by
  unfold startWork
  split
  · omega
  · have := work_le k t; omega

theorem start_ends (w k : Nat) (hk : 0 < k) (t : Todo) :
    (steps k (startLeaves w k t).left (startLeaves w k t)).left = 0 :=
  ends_within k hk _

/-- What a device takes in the middle of a catch-up, `more`, added to what is left. -/
def Todo.add (t more : Todo) : Todo :=
  { replay := t.replay + more.replay, index := t.index + more.index, read := more.read ++ t.read,
    shows := t.shows ++ more.shows }

/-- Taking `more` in the middle of a catch-up: what is left grows by it, and one step brings it on. -/
def take (k : Nat) (t more : Todo) : Todo := step k (t.add more)

/-- What a device takes mid catch-up costs its turn one step's work at most, however much is left, and leaves the rest
to the catch-up's steps, which end (`ends_within`). -/
theorem taken_le (k : Nat) (t more : Todo) : (t.add more).left - (take k t more).left ≤ k := work_le k (t.add more)

namespace Examples

-- a first sync: 130,000 edits to replay and to index, 130,000 bodies, 3,200 entries; 768 units a step
def first : Todo := { replay := 130000, index := 130000, read := List.range 130000, shows := List.range 3200 }
#guard (step 768 first).replay == 130000 - 768
#guard work 768 first == 768
-- once replayed, a step adds 768 edits at most to its key index made again, then opens 768 bodies at most
#guard work 768 { first with replay := 0 } == 768
#guard (step 768 { first with replay := 0 }).index == 130000 - 768
#guard work 768 { first with replay := 0, index := 0 } == 768
-- a live page of 5 bodies in the middle of the backlog is read in the next step
#guard readStep 768 [1, 2, 3, 4, 5] (List.range 1000) == (List.range 1000).drop 763
-- an unlock of that first sync with no stored view does 48 units, not all 393,200
#guard startWork 4096 48 first == 48
#guard startWork 4096 48 { replay := 100, index := 0, read := [], shows := List.range 40 } == 140

-- the keys a pull brings in the middle of a first sync: one step, not the 393,200 units left
#guard (first.add { replay := 0, index := 0, read := [1, 2], shows := [] }).left - (take 768 first { replay := 0, index := 0, read := [1, 2], shows := [] }).left == 768

end Examples

end AvenDB.CatchUpBudget
