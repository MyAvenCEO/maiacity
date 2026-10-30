/-!
# A peer's status

The phase a peer's link is in (README, rule 7) and the progress counter behind rule 3, "no step without progress".
A peer starts, dials, and is live while frames arrive. Every clock step without a frame adds one to `idle`; once
`idle` reaches `limit`, the peer is stalled, never live. A lost link is offline until the next dial.

`aven-db-core`'s `status` module implements this machine, and its tests replay random traces against `Main.lean`.
-/

namespace Aven.DB

inductive Phase where
  | starting
  | connecting
  | live
  | offline
  | stalled
  deriving DecidableEq, Repr

namespace Phase

/-- The phases with a link to watch: a clock step counts against them. -/
def active : Phase → Bool
  | connecting | live | stalled => true
  | starting | offline => false

def name : Phase → String
  | starting => "starting"
  | connecting => "connecting"
  | live => "live"
  | offline => "offline"
  | stalled => "stalled"

end Phase

inductive Event where
  /-- a new attempt to reach the network -/
  | dial
  /-- a frame arrived: progress -/
  | frame
  /-- one step of the peer's one clock -/
  | tick
  /-- the link is gone -/
  | lost
  deriving DecidableEq, Repr

structure Status where
  phase : Phase
  /-- the progress counter: frames received, ever -/
  moved : Nat
  /-- clock steps since `moved` last moved -/
  idle : Nat
  deriving DecidableEq, Repr

namespace Status

def start : Status := ⟨.starting, 0, 0⟩

/-- One event. `limit` is the number of steps without progress after which a peer is stalled. -/
def step (limit : Nat) (s : Status) : Event → Status
  | .dial => ⟨.connecting, s.moved, 0⟩
  | .frame => if s.phase.active then ⟨.live, s.moved + 1, 0⟩ else s
  | .tick =>
    if s.phase.active then
      ⟨if s.idle + 1 ≥ limit then .stalled else s.phase, s.moved, s.idle + 1⟩
    else s
  | .lost => ⟨.offline, s.moved, 0⟩

def run (limit : Nat) (s : Status) (es : List Event) : Status := es.foldl (step limit) s

/-- `n` clock steps and nothing else. -/
def ticks (limit : Nat) (s : Status) (n : Nat) : Status := run limit s (List.replicate n .tick)

/-! ## Each event leaves a peer in exactly one phase -/

/-- The five questions a status line can ask of a phase. -/
def answers (p : Phase) : List Bool :=
  [p = .starting, p = .connecting, p = .live, p = .offline, p = .stalled]

theorem one_phase (p : Phase) : (answers p).count true = 1 := by
  cases p <;> decide

theorem one_phase_after (limit : Nat) (s : Status) (e : Event) :
    (answers (s.step limit e).phase).count true = 1 :=
  one_phase _

/-! ## The progress counter never runs back -/

theorem moved_mono (limit : Nat) (s : Status) (e : Event) : s.moved ≤ (s.step limit e).moved := by
  cases e <;> simp only [step] <;> (try split) <;> simp

/-! ## No step without progress: a peer that doesn't move is stalled, never live -/

/-- What every reachable state keeps: a peer counted as live or connecting has moved within `limit` steps. -/
def Fresh (limit : Nat) (s : Status) : Prop :=
  (s.phase = .live ∨ s.phase = .connecting) → s.idle < limit

theorem fresh_start (limit : Nat) : Fresh limit start := by
  intro h; simp [start] at h

theorem fresh_step (limit : Nat) (hl : 0 < limit) (s : Status) (hs : Fresh limit s) (e : Event) :
    Fresh limit (s.step limit e) := by
  unfold Fresh at *
  cases e with
  | dial => intro _; exact hl
  | lost => intro h; simp [step] at h
  | frame =>
    by_cases ha : s.phase.active = true
    · intro _; simp [step, ha]; exact hl
    · simp [step, ha]; exact hs
  | tick =>
    by_cases ha : s.phase.active = true
    · by_cases hq : s.idle + 1 ≥ limit
      · intro h; simp [step, ha, hq] at h
      · intro _; simp [step, ha, hq]; omega
    · simp [step, ha]; exact hs

theorem fresh_run (limit : Nat) (hl : 0 < limit) (es : List Event) :
    ∀ s, Fresh limit s → Fresh limit (run limit s es) := by
  induction es with
  | nil => intro s hs; exact hs
  | cons e es ih => intro s hs; exact ih _ (fresh_step limit hl s hs e)

/-- Every state reached from the start keeps `Fresh`. -/
theorem fresh_reachable (limit : Nat) (hl : 0 < limit) (es : List Event) : Fresh limit (run limit start es) :=
  fresh_run limit hl es start (fresh_start limit)

theorem ticks_succ (limit : Nat) (s : Status) (n : Nat) :
    ticks limit s (n + 1) = ticks limit (s.step limit .tick) n := by
  simp [ticks, run, List.replicate_succ, List.foldl_cons]

/-- A clock step keeps an active peer active and adds one to its idle steps. -/
theorem tick_active (limit : Nat) (s : Status) (ha : s.phase.active = true) :
    (s.step limit .tick).phase.active = true ∧ (s.step limit .tick).idle = s.idle + 1 := by
  by_cases hq : s.idle + 1 ≥ limit
  · simp only [step, ha, hq, ite_true]; exact ⟨rfl, trivial⟩
  · simp only [step, ha, hq, ite_true, ite_false]; exact ⟨trivial, trivial⟩

theorem tick_inactive (limit : Nat) (s : Status) (ha : s.phase.active = false) : s.step limit .tick = s := by
  simp [step, ha]

theorem ticks_active (limit : Nat) :
    ∀ n s, s.phase.active → (ticks limit s n).phase.active ∧ (ticks limit s n).idle = s.idle + n := by
  intro n
  induction n with
  | zero => intro s ha; simp [ticks, run]; exact ha
  | succ n ih =>
    intro s ha
    rw [ticks_succ]
    obtain ⟨ha', hi⟩ := tick_active limit s ha
    obtain ⟨h1, h2⟩ := ih _ ha'
    exact ⟨h1, by omega⟩

theorem ticks_inactive (limit : Nat) : ∀ n s, s.phase.active = false → ticks limit s n = s := by
  intro n
  induction n with
  | zero => intro s _; simp [ticks, run]
  | succ n ih => intro s ha; rw [ticks_succ, tick_inactive limit s ha]; exact ih s ha

/-- A peer whose progress doesn't move for `limit` steps is not live. -/
theorem quiet_not_live (limit : Nat) (hl : 0 < limit) (s : Status) (hs : Fresh limit s) :
    (ticks limit s limit).phase ≠ .live := by
  intro h
  have hlt : (ticks limit s limit).idle < limit := fresh_run limit hl _ s hs (Or.inl h)
  cases ha : s.phase.active
  · rw [ticks_inactive limit limit s ha] at h
    simp [h, Phase.active] at ha
  · have := (ticks_active limit limit s ha).2
    omega

/-- Stronger, for a peer with a link: after `limit` quiet steps it is stalled. -/
theorem quiet_stalled (limit : Nat) (hl : 0 < limit) (s : Status) (hs : Fresh limit s) (ha : s.phase.active = true) :
    (ticks limit s limit).phase = .stalled := by
  obtain ⟨ha', hi⟩ := ticks_active limit limit s ha
  have hf : Fresh limit (ticks limit s limit) := fresh_run limit hl _ s hs
  unfold Fresh at hf
  generalize ticks limit s limit = t at *
  cases hp : t.phase <;> rw [hp] at ha' hf <;> simp [Phase.active] at ha' hf <;> omega

end Status

end Aven.DB
