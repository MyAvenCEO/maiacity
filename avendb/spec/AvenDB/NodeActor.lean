/-! The node actor (sync v2, P7): one task owns the node's outreach to its peers, the telling of its holdings and the
asking for theirs, where it used to sit behind four shared locks (`telling`, `unreached`, `asking`, `owed`) and an
announcer that woke every `retry` to look. Each peer has one lane per kind of outreach; the actor takes one message at
a time (a wake, a finished attempt, its timer) and the time it took it at, so a run is a function of its messages.
Rust: `avendb-net/src/actor.rs`, whose tests mirror the theorems here.

What it guarantees: at most one attempt in flight per lane; a wake is never lost (it starts an attempt, or is owed to
the one in flight, or waits for the lane's backoff with the timer set for it); a failed attempt is tried again once its
wait is over; waits double and stop at a minute; and the actor sleeps until the earliest lane is due, never polling. -/
namespace AvenDB.NodeActor

/-- One peer's lane: an attempt in flight, a wake owed to it, a wake waiting for the backoff, the failures in a row
and the moment (in ms) the lane may try again. -/
structure Lane where
  busy : Bool := false
  owed : Bool := false
  pending : Bool := false
  failures : Nat := 0
  dueAt : Nat := 0
deriving Repr, DecidableEq

/-- The longest wait, a minute (`BACKOFF_MAX`). -/
def maxWait : Nat := 60000

/-- After `n` failures in a row, `retry` doubled `n` times (16 at most), a minute at most (`Backoff::failed`). -/
def wait (retry n : Nat) : Nat := min (retry * 2 ^ (min n 16)) maxWait

/-- A wake at `now`: an attempt starts (`true`), or the wake is owed to the one in flight, or it waits for the lane's
backoff. -/
def wake (l : Lane) (now : Nat) : Lane × Bool :=
  if l.busy then ({ l with owed := true }, false)
  else if now < l.dueAt then ({ l with pending := true }, false)
  else ({ l with busy := true, owed := false, pending := false }, true)

/-- The attempt in flight ended at `now`, `ok` or not: a success clears the backoff, a failure waits longer, and the
lane wakes again (by its timer) if a wake was owed or the attempt failed. -/
def finish (l : Lane) (now retry : Nat) (ok : Bool) : Lane :=
  { busy := false
    owed := false
    pending := l.owed || !ok
    failures := if ok then 0 else l.failures + 1
    dueAt := if ok then now else now + wait retry l.failures }

/-- The actor's timer at `now`: a waiting lane whose wait is over wakes. -/
def tick (l : Lane) (now : Nat) : Lane × Bool :=
  if l.pending && decide (l.dueAt ≤ now) then wake { l with pending := false } now else (l, false)

/-- When the actor must wake next for this lane, if at all. -/
def due (l : Lane) : Option Nat := if l.pending && !l.busy then some l.dueAt else none

/-- The messages a lane takes. -/
inductive Msg where
  | wake (now : Nat)
  | finish (now retry : Nat) (ok : Bool)
  | tick (now : Nat)

def step (l : Lane) : Msg → Lane
  | .wake now => (wake l now).1
  | .finish now retry ok => finish l now retry ok
  | .tick now => (tick l now).1

/-- A run: the lane after its messages, one at a time, in order. -/
def run (l : Lane) (ms : List Msg) : Lane := ms.foldl step l

/-- A run is its messages: the same messages give the same lane, and a run goes on from where it stopped. -/
theorem run_append (l : Lane) (xs ys : List Msg) : run l (xs ++ ys) = run (run l xs) ys := by
  simp [run, List.foldl_append]

/-- At most one attempt in flight: a wake while one is starts none. -/
theorem one_in_flight (l : Lane) (now : Nat) (h : l.busy = true) : (wake l now).2 = false := by
  simp [wake, h]

/-- A wake is never lost: it starts an attempt, or it is owed to the one in flight, or it waits for the backoff. -/
theorem wake_kept (l : Lane) (now : Nat) :
    (wake l now).2 = true ∨ (wake l now).1.owed = true ∨ (wake l now).1.pending = true := by
  unfold wake
  by_cases hb : l.busy = true
  · simp [hb]
  · by_cases hn : now < l.dueAt <;> simp [hb, hn]

/-- What was owed to an attempt wakes the lane again once it ends, whatever its outcome. -/
theorem owed_wakes_again (l : Lane) (now retry : Nat) (ok : Bool) (h : l.owed = true) :
    (finish l now retry ok).pending = true := by
  simp [finish, h]

/-- A failed attempt is tried again, after its wait. -/
theorem failure_tried_again (l : Lane) (now retry : Nat) :
    (finish l now retry false).pending = true ∧ (finish l now retry false).dueAt = now + wait retry l.failures := by
  simp [finish]

/-- A success clears the backoff: the next wake may start at once. -/
theorem success_clears (l : Lane) (now retry : Nat) :
    (finish l now retry true).failures = 0 ∧ (finish l now retry true).dueAt = now := by
  simp [finish]

/-- Waits stop at a minute. -/
theorem wait_capped (retry n : Nat) : wait retry n ≤ maxWait := Nat.min_le_right _ _

/-- Waits never shrink as failures go on. -/
theorem wait_mono (retry : Nat) {n m : Nat} (h : n ≤ m) : wait retry n ≤ wait retry m := by
  unfold wait
  have hp : 2 ^ (min n 16) ≤ 2 ^ (min m 16) := Nat.pow_le_pow_right (by decide) (by omega)
  have hm : retry * 2 ^ (min n 16) ≤ retry * 2 ^ (min m 16) := Nat.mul_le_mul_left _ hp
  omega

/-- The timer wakes a waiting lane once its wait is over, and an idle lane can start then. -/
theorem tick_starts (l : Lane) (now : Nat)
    (hp : l.pending = true) (hb : l.busy = false) (hd : l.dueAt ≤ now) : (tick l now).2 = true := by
  simp [tick, wake, hp, hb, hd, Nat.not_lt.mpr hd]

/-- The actor sleeps until a waiting lane is due, and only then: no lane waits without its timer set. -/
theorem waiting_has_timer (l : Lane) (hp : l.pending = true) (hb : l.busy = false) : due l = some l.dueAt := by
  simp [due, hp, hb]

/-- A run that ends every attempt it starts leaves no lane busy: the actor holds nothing across messages. -/
theorem finish_frees (l : Lane) (now retry : Nat) (ok : Bool) : (finish l now retry ok).busy = false := rfl

end AvenDB.NodeActor
