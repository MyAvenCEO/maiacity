/-! Coverage (sync v2, P1): one answer to "is this read complete?", on every read.

A read answers `complete`, `partial` or `denied`, and nothing else says it: no flag bag, no clock. The answer is a
function of what the device holds and of what its reachable peers announced, so the same query on the same state
gives the same answer on a fast Mac, a slow iPhone and a CI runner.

* Each candidate the device holds is classified `shown` (it matches and the device can show it whole), `out` (it
  does not match, or the device may not see it) or `waits` (the device cannot decide yet: its semantic groups, its
  record, its history or a judgment of it has not arrived). A classification is sound: `shown` and `out` are the
  truth; only `waits` is unknown.
* A log a reachable peer announced and the device does not hold up to that announced head is `behind`. `mayMatch` is
  conservative: a log holding a matching entry may match.
* `complete` means nothing waits and no behind log may match (`complete_iff`). Then the rows shown are exactly the
  matching entries of every log the reachable peers announced (`complete_exact`).

Paging is by cursor, apart from coverage: a page says where it ended, and the next starts after that key
(`after_page`), so pages never depend on a time budget. -/
namespace AvenDB.Coverage

/-- What a candidate waits on. -/
inductive Waiting where
  | semantics
  | record
  | history
  | judgment
  deriving DecidableEq, Repr

/-- A held candidate, as the device classifies it. -/
inductive Class where
  | shown
  | out
  | waits (on : Waiting)
  deriving DecidableEq, Repr

/-- The one answer. `rows` shown (JSON `have`), `known` = `rows` plus the candidates that wait, `waiting` those candidates,
`logs` the behind logs that may match. -/
inductive Coverage where
  | complete
  | «partial» (rows known : Nat) (waiting : List (Nat × Waiting)) (logs : Nat)
  | denied
  deriving DecidableEq, Repr

def Coverage.isComplete : Coverage → Bool
  | .complete => true
  | _ => false

def waitOf : Nat × Class → Option (Nat × Waiting)
  | (e, .waits on) => some (e, on)
  | _ => none

def isShown : Nat × Class → Bool
  | (_, .shown) => true
  | _ => false

/-- The answer of a read the device may make: its held candidates, the logs its reachable peers announced that it
lacks, and which of those may match. -/
def answer (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) : Coverage :=
  let waiting := cands.filterMap waitOf
  let logs := (behind.filter mayMatch).length
  if waiting = [] ∧ logs = 0 then .complete
  else
    let rows := (cands.filter isShown).length
    .«partial» rows (rows + waiting.length) waiting logs

/-- A read the device has no standing for answers `denied`, whatever it holds. -/
def read (allowed : Bool) (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) : Coverage :=
  if allowed then answer cands behind mayMatch else .denied

theorem denied_without_standing (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) :
    read false cands behind mayMatch = .denied := rfl

theorem filterMap_waitOf_nil (cands : List (Nat × Class)) :
    cands.filterMap waitOf = [] ↔ ∀ c ∈ cands, waitOf c = none := by
  simp [List.filterMap_eq_nil_iff]

theorem waitOf_none (c : Nat × Class) : waitOf c = none ↔ ∀ on, c.2 ≠ .waits on := by
  obtain ⟨e, k⟩ := c
  cases k <;> simp [waitOf]

/-- "Complete" has one meaning: no held candidate waits, and no announced log the device lacks may match. -/
theorem complete_iff (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool) :
    answer cands behind mayMatch = .complete ↔
      (∀ c ∈ cands, ∀ on, c.2 ≠ .waits on) ∧ (∀ l ∈ behind, mayMatch l = false) := by
  unfold answer
  have hw : cands.filterMap waitOf = [] ↔ ∀ c ∈ cands, ∀ on, c.2 ≠ .waits on := by
    rw [filterMap_waitOf_nil]
    exact ⟨fun h c hc => (waitOf_none c).1 (h c hc), fun h c hc => (waitOf_none c).2 (h c hc)⟩
  have hl : (behind.filter mayMatch).length = 0 ↔ ∀ l ∈ behind, mayMatch l = false := by
    simp [List.length_eq_zero_iff, List.filter_eq_nil_iff]
  by_cases h : cands.filterMap waitOf = [] ∧ (behind.filter mayMatch).length = 0
  · simp only [h, and_self, ↓reduceIte]
    exact ⟨fun _ => ⟨hw.1 h.1, hl.1 h.2⟩, fun _ => trivial⟩
  · simp only [h, ↓reduceIte]
    constructor
    · intro hc; cases hc
    · intro hab; exact absurd ⟨hw.2 hab.1, hl.2 hab.2⟩ h

/-- One waiting candidate is enough to keep a read partial. -/
theorem waiting_is_partial (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool)
    (e : Nat) (on : Waiting) (h : (e, Class.waits on) ∈ cands) :
    (answer cands behind mayMatch).isComplete = false := by
  cases hc : answer cands behind mayMatch with
  | complete => exact absurd ((complete_iff _ _ _).1 hc |>.1 _ h on) (by simp)
  | «partial» => rfl
  | denied => rfl

/-- A behind log that may match keeps a read partial: the case of a new device whose peer announced logs it has not
pulled yet. It turns complete once those logs arrive (`behind` loses them) and nothing waits. -/
theorem behind_is_partial (cands : List (Nat × Class)) (behind : List Nat) (mayMatch : Nat → Bool)
    (l : Nat) (hl : l ∈ behind) (hm : mayMatch l = true) :
    (answer cands behind mayMatch).isComplete = false := by
  cases hc : answer cands behind mayMatch with
  | complete => exact absurd ((complete_iff _ _ _).1 hc |>.2 l hl) (by simp [hm])
  | «partial» => rfl
  | denied => rfl

theorem arrived_is_complete (cands : List (Nat × Class)) (mayMatch : Nat → Bool)
    (h : ∀ c ∈ cands, ∀ on, c.2 ≠ .waits on) :
    answer cands [] mayMatch = .complete :=
  (complete_iff _ _ _).2 ⟨h, by simp⟩

/-! ## What complete promises

The truth: every entry of every log the reachable peers announced, with whether it matches. The device holds some of
them, each in the log `logOf`; it classifies the held ones soundly; every entry it does not hold sits in a log it lacks
(`behind`), and `mayMatch` is conservative. Then a complete answer shows exactly the matching entries. -/

structure World where
  entries : List Nat
  hits : Nat → Bool
  held : Nat → Bool
  logOf : Nat → Nat
  classOf : Nat → Class

/-- The device's candidates: the entries it holds, classified. -/
def World.cands (w : World) : List (Nat × Class) :=
  (w.entries.filter w.held).map fun e => (e, w.classOf e)

/-- The rows it shows. -/
def World.shown (w : World) : List Nat :=
  (w.entries.filter w.held).filter fun e => w.classOf e == .shown

def World.sound (w : World) : Prop :=
  ∀ e ∈ w.entries, w.held e = true →
    (w.classOf e = .shown → w.hits e = true) ∧ (w.classOf e = .out → w.hits e = false)

def World.announced (w : World) (behind : List Nat) (mayMatch : Nat → Bool) : Prop :=
  ∀ e ∈ w.entries, w.held e = false → w.logOf e ∈ behind ∧ (w.hits e = true → mayMatch (w.logOf e) = true)

theorem complete_exact (w : World) (behind : List Nat) (mayMatch : Nat → Bool)
    (sound : w.sound) (ann : w.announced behind mayMatch)
    (h : answer w.cands behind mayMatch = .complete) :
    w.shown = w.entries.filter w.hits := by
  obtain ⟨nowait, quiet⟩ := (complete_iff _ _ _).1 h
  unfold World.shown
  rw [List.filter_filter]
  apply List.filter_congr
  intro e he
  cases hh : w.held e with
  | false =>
    obtain ⟨inb, mm⟩ := ann e he hh
    cases hm : w.hits e with
    | false => simp
    | true => exact absurd (mm hm) (by simp [quiet _ inb])
  | true =>
    have hc : (e, w.classOf e) ∈ w.cands := by
      simp only [World.cands, List.mem_map, List.mem_filter]
      exact ⟨e, ⟨he, hh⟩, rfl⟩
    obtain ⟨s, o⟩ := sound e he hh
    cases hk : w.classOf e with
    | shown => simp [s hk]
    | out => simp [o hk]
    | waits on => exact absurd hk (nowait _ hc on)

/-! ## Combining parts

A read of several parts (several vaults, a row and the links it follows) answers the meet of its parts: complete only
when every part is, denied when any part is. -/

def meet : Coverage → Coverage → Coverage
  | .denied, _ => .denied
  | _, .denied => .denied
  | .complete, c => c
  | c, .complete => c
  | .«partial» h k w l, .«partial» h' k' w' l' => .«partial» (h + h') (k + k') (w ++ w') (l + l')

theorem meet_complete_left (c : Coverage) : meet .complete c = c := by cases c <;> rfl
theorem meet_complete_right (c : Coverage) : meet c .complete = c := by cases c <;> rfl
theorem meet_denied_left (c : Coverage) : meet .denied c = .denied := by cases c <;> rfl
theorem meet_denied_right (c : Coverage) : meet c .denied = .denied := by cases c <;> rfl

theorem meet_complete_iff (a b : Coverage) : meet a b = .complete ↔ a = .complete ∧ b = .complete := by
  cases a <;> cases b <;> simp [meet]

/-! ## Paging by cursor

Rows come in one strict order of keys. A page is a prefix of the rows after the cursor; the next cursor is the key of
the page's last row; the next page starts right after it. Concatenated pages are the whole answer, and no page
depends on how long the device took. -/

def after (k : Nat) (xs : List Nat) : List Nat := xs.filter (k < ·)

theorem after_page (a b : List Nat) (k : Nat) (sorted : (a ++ [k] ++ b).Pairwise (· < ·)) :
    after k (a ++ [k] ++ b) = b := by
  rw [List.pairwise_append, List.pairwise_append] at sorted
  obtain ⟨⟨_, _, hak⟩, hb, hab⟩ := sorted
  unfold after
  rw [List.filter_append, List.filter_append]
  have h1 : a.filter (k < ·) = [] := by
    rw [List.filter_eq_nil_iff]
    intro x hx
    have := hak x hx k (by simp)
    simp; omega
  have h2 : [k].filter (k < ·) = [] := by simp
  have h3 : b.filter (k < ·) = b := by
    rw [List.filter_eq_self]
    intro y hy
    have := hab k (by simp) y hy
    simpa using this
  rw [h1, h2, h3]; rfl

end AvenDB.Coverage
