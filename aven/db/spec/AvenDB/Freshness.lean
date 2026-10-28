import AvenDB.Coverage

/-! Freshness (batch 5, B5): one answer, on every read, to "may the page treat this as final?".

Coverage (`Coverage.lean`) says whether a read is complete against what the device's live peers announced. Freshness
adds who the device can hear now, and turns the two into one of three values a page shows and acts by, for any query,
schema or type alike; no page decides it for itself:

* `current`: a live peer is connected, every live peer told what it holds, and the read is complete (nothing waits,
  no announced log the device lacks may match). Then the rows are exactly the truth the peers announced
  (`current_exact`): a settled item never shows as open.
* `offline asOf`: no live peer. The device shows what it holds, as of `asOf`, the last time it was current with a live
  peer (0: never). Local-first: the rows show, said to be as of then.
* `behind logs waits unheard`: a live peer holds newer data for the read's scope (`logs` announced logs that may match),
  candidates wait (`waits`), or a live peer has not yet told what it holds (`unheard`). The node fetches that scope
  first; a page says "catching up" and never shows the rows as final.

An action (approve, accept, decline, delete) reads the same value (`act`): `go` only on `current`, `wait` while
`behind`, and on `offline` it asks the person to confirm that it acts on data as of `asOf`. A sheet that opens by itself
opens only on `current` (`pops_iff`): never from data that is behind or offline. No clock decides any of it: `asOf` is a
stamp the node keeps, never compared with the time now. -/
namespace AvenDB.Freshness

open AvenDB.Coverage

inductive Freshness where
  | current
  | offline (asOf : Nat)
  | behind (logs waits unheard : Nat)
  deriving DecidableEq, Repr

/-- What the device hears now: its live peers, how many of them have not told what they hold, and the stamp of the
last time it was current with a live peer (0: never). -/
structure Heard where
  live : Nat
  unheard : Nat
  asOf : Nat
  deriving DecidableEq, Repr

/-- What a read still lacks: candidates that wait, and announced logs the device lacks that may match. -/
def pending : Coverage → Nat × Nat
  | .complete => (0, 0)
  | .«partial» _ _ waiting logs => (waiting.length, logs)
  | .denied => (0, 0)

/-- The one value. -/
def of (h : Heard) (c : Coverage) : Freshness :=
  if h.live = 0 then .offline h.asOf
  else if pending c = (0, 0) ∧ h.unheard = 0 then .current
  else .behind (pending c).2 (pending c).1 h.unheard

/-! ## What `current` promises -/

theorem current_iff (h : Heard) (c : Coverage) :
    of h c = .current ↔ h.live ≠ 0 ∧ h.unheard = 0 ∧ pending c = (0, 0) := by
  unfold of
  by_cases hl : h.live = 0
  · simp [hl]
  · by_cases hp : pending c = (0, 0) ∧ h.unheard = 0
    · simp [hl, hp]
    · simp only [hl, hp, ↓reduceIte]
      constructor
      · intro hc; cases hc
      · rintro ⟨_, u, p⟩; exact absurd ⟨p, u⟩ hp

/-- Without a live peer a read is offline, whatever it holds: never current, never behind. -/
theorem offline_without_peers (h : Heard) (c : Coverage) (hl : h.live = 0) : of h c = .offline h.asOf := by
  simp [of, hl]

/-- What a read `Coverage.answer` makes still lacks: its waiting candidates and its behind logs that may match. -/
theorem pending_answer_eq (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) :
    pending (answer cands behind mayMatch) = ((cands.filterMap waitOf).length, (behind.filter mayMatch).length) := by
  unfold answer
  by_cases hc : cands.filterMap waitOf = [] ∧ (behind.filter mayMatch).length = 0
  · simp only [hc, and_self, ↓reduceIte, pending, List.length_nil]
  · simp only [hc, ↓reduceIte, pending]

/-- A read `Coverage.answer` makes has nothing pending exactly when it is complete. -/
theorem pending_answer (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) :
    pending (answer cands behind mayMatch) = (0, 0) ↔ answer cands behind mayMatch = .complete := by
  rw [pending_answer_eq, complete_iff, Prod.mk.injEq, List.length_eq_zero_iff, List.length_eq_zero_iff,
    filterMap_waitOf_nil, List.filter_eq_nil_iff]
  constructor
  · rintro ⟨h1, h2⟩
    exact ⟨fun c hc => (waitOf_none c).1 (h1 c hc), fun l hl => by simpa using h2 l hl⟩
  · rintro ⟨h1, h2⟩
    exact ⟨fun c hc => (waitOf_none c).2 (h1 c hc), fun l hl => by simp [h2 l hl]⟩

/-- With a live peer that told what it holds, a read is current exactly when it is complete. -/
theorem current_iff_complete (h : Heard) (hl : h.live ≠ 0) (hu : h.unheard = 0)
    (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) :
    of h (answer cands behind mayMatch) = .current ↔ answer cands behind mayMatch = .complete := by
  rw [current_iff, ← pending_answer]
  exact ⟨fun ⟨_, _, p⟩ => p, fun p => ⟨hl, hu, p⟩⟩

/-- A current read shows exactly the matching entries of every log the live peers announced: no settled item shows as
it was before it settled. -/
theorem current_exact (h : Heard) (w : World) (behind : List Nat) (mayMatch : Nat → Bool)
    (sound : w.sound) (ann : w.announced behind mayMatch)
    (hc : of h (answer w.cands behind mayMatch) = .current) :
    w.shown = w.entries.filter w.hits := by
  obtain ⟨_, _, p⟩ := (current_iff _ _).1 hc
  exact complete_exact w behind mayMatch sound ann ((pending_answer _ _ _).1 p)

/-- One behind log that may match keeps a read behind while a live peer is there: the 27 Oct iPhone, 2,778 logs left. -/
theorem behind_log_is_behind (h : Heard) (hl : h.live ≠ 0) (c : Coverage) (hp : (pending c).2 ≠ 0) :
    ∃ l w u, of h c = .behind l w u := by
  unfold of
  simp only [hl, ↓reduceIte]
  have : ¬(pending c = (0, 0) ∧ h.unheard = 0) := fun ⟨p, _⟩ => hp (by simp [p])
  simp only [this, ↓reduceIte]
  exact ⟨_, _, _, rfl⟩

/-- A live peer that has not told what it holds keeps every read behind: a device just connected is never current
before it heard. -/
theorem unheard_is_behind (h : Heard) (hl : h.live ≠ 0) (hu : h.unheard ≠ 0) (c : Coverage) :
    ∃ l w u, of h c = .behind l w u := by
  unfold of
  simp only [hl, ↓reduceIte]
  have : ¬(pending c = (0, 0) ∧ h.unheard = 0) := fun ⟨_, u⟩ => hu u
  simp only [this, ↓reduceIte]
  exact ⟨_, _, _, rfl⟩

/-! ## Actions read the same value -/

inductive Act where
  | go
  | wait
  | confirm (asOf : Nat)
  deriving DecidableEq, Repr

def act : Freshness → Act
  | .current => .go
  | .behind .. => .wait
  | .offline t => .confirm t

theorem go_iff (f : Freshness) : act f = .go ↔ f = .current := by
  cases f <;> simp [act]

theorem behind_waits (l w u : Nat) : act (.behind l w u) = .wait := rfl

theorem offline_confirms (t : Nat) : act (.offline t) = .confirm t := rfl

/-- Whether an action's sheet opens: by itself (`asked` false) or because the person asked for it (`asked` true). It
opens by itself only on `current`; on `offline` only when the person asked and is told the data is as of `asOf`; never
while `behind`. -/
def opens (f : Freshness) (asked : Bool) : Bool :=
  match act f with
  | .go => true
  | .wait => false
  | .confirm _ => asked

/-- A sheet that pops up by itself does so only from current data. -/
theorem pops_iff (f : Freshness) : opens f false = true ↔ f = .current := by
  cases f <;> simp [opens, act]

theorem behind_never_opens (l w u : Nat) (asked : Bool) : opens (.behind l w u) asked = false := rfl

/-! ## The 27 Oct iPhone

Three live peers, all heard; the AIPs read holds AIP-29 as proposed, while 2,778 of the 3,028 announced logs, some of
which may hold its acceptance, have not arrived. The read is behind: the page shows it catching up, and the approval
sheet neither pops up nor opens when asked. -/

def iphone : Heard := ⟨3, 0, 0⟩
def aipsRead : Coverage := .«partial» 4 4 [] 2778

example : of iphone aipsRead = .behind 2778 0 0 := by decide
example : opens (of iphone aipsRead) false = false := by decide
example : opens (of iphone aipsRead) true = false := by decide
/-- Once the logs arrived, the same read is current and the sheet goes by the AIP's real stage. -/
example : of iphone .complete = .current := by decide
/-- Offline, the same device shows what it holds as of its stamp; the sheet opens only when asked, said so. -/
example : of ⟨0, 0, 1793120000⟩ aipsRead = .offline 1793120000 := by decide
example : opens (of ⟨0, 0, 1793120000⟩ aipsRead) false = false := by decide

end AvenDB.Freshness
