/-!
# Which path a node sends on: the one that delivers soonest by what it measured

A node has paths to a peer: the relay's, and direct ones (WebRTC, WebTransport, IP). It sends on one
(`avendb-net/src/path_choice.rs`, `Measured`). iroh's own choice ranked every direct path above the relay whatever its
round trip: a Mac's page kept a WebRTC path of a 10.8 s round trip that lost 4 of its 5 askings, with the relay at
715 ms beside it, and took nothing in 10 min (2026-10-28).

Now each path costs what it measured: its round trip over the share of what it sent that arrived, a relay's twice over
(`cost`). A path that received nothing yet, lost all it sent, or stopped delivering has no cost and is never chosen
(`unmeasured_never_chosen`). The choice is the cheapest of the rest (`chosen_is_cheapest`), so a direct path more than
twice as slow as the relay is never sent on beside it (`a_slow_direct_path_loses_to_the_relay`). Its selector looks
again each second, so a path that grew slow or stopped is left at the next look. Jitter of under `stick` keeps the
current path; that is in the code alone, a choice between two paths of about one cost.
-/

namespace AvenDB.PathChoice

/-- What a path measured: its round trip, what it sent and lost, whether it received anything, whether it stopped. -/
structure Path where
  relay : Bool
  rtt : Nat
  sent : Nat
  lost : Nat
  received : Bool
  stalled : Bool
  deriving DecidableEq, Repr

/-- Its cost, none if it is unmeasured, lost all it sent or stopped. -/
def cost (p : Path) : Option Nat :=
  if !p.received || p.stalled || (0 < p.sent && p.sent ≤ p.lost) then none
  else
    let lossy := if p.sent = 0 then p.rtt else p.rtt * p.sent / (p.sent - p.lost)
    some (if p.relay then 2 * lossy else lossy)

/-- The cheaper of two candidates, each a path with its cost; the first of two alike. -/
def better (a b : Path × Nat) : Path × Nat := if b.2 < a.2 then b else a

/-- The measured paths of `ps`, each with its cost. -/
def measured (ps : List Path) : List (Path × Nat) := ps.filterMap fun p => (cost p).map (p, ·)

/-- The cheapest of some candidates. -/
def pick : List (Path × Nat) → Option (Path × Nat)
  | [] => none
  | a :: as => some (match pick as with
    | none => a
    | some r => better a r)

/-- The path sent on: the cheapest measured. -/
def choose (ps : List Path) : Option (Path × Nat) := pick (measured ps)

theorem pick_none {l : List (Path × Nat)} (h : pick l = none) : l = [] := by
  cases l with
  | nil => rfl
  | cons a as => simp [pick] at h

theorem pick_mem {l : List (Path × Nat)} {y : Path × Nat} (h : pick l = some y) : y ∈ l := by
  induction l generalizing y with
  | nil => simp [pick] at h
  | cons a as ih =>
    simp only [pick, Option.some.injEq] at h
    cases hr : pick as with
    | none => rw [hr] at h; simp at h; subst h; exact List.mem_cons_self ..
    | some r =>
      rw [hr] at h; simp only [better] at h
      split at h
      · subst h; exact List.mem_cons_of_mem _ (ih hr)
      · subst h; exact List.mem_cons_self ..

theorem pick_le {l : List (Path × Nat)} {y : Path × Nat} (h : pick l = some y) : ∀ x ∈ l, y.2 ≤ x.2 := by
  induction l generalizing y with
  | nil => simp [pick] at h
  | cons a as ih =>
    simp only [pick, Option.some.injEq] at h
    intro x hx
    cases hr : pick as with
    | none =>
      rw [hr] at h; simp at h; subst h
      rw [pick_none hr] at hx; simp at hx; subst hx; exact Nat.le_refl _
    | some r =>
      rw [hr] at h; simp only [better] at h
      have hrs := ih hr
      rcases List.mem_cons.mp hx with rfl | hx
      · split at h <;> subst h <;> omega
      · have := hrs x hx; split at h <;> subst h <;> omega

theorem mem_measured {ps : List Path} {p : Path} {c : Nat} : (p, c) ∈ measured ps ↔ p ∈ ps ∧ cost p = some c := by
  simp [measured, List.mem_filterMap]

/-- What is chosen is a path of them, and measured. -/
theorem choose_cost {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c)) : q ∈ ps ∧ cost q = some c :=
  mem_measured.mp (pick_mem h)

/-- A path with no cost, unmeasured, lost or stopped, is never chosen. -/
theorem unmeasured_never_chosen {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c)) : cost q ≠ none := by
  rw [(choose_cost h).2]; simp

/-- What is chosen costs no more than any measured path. -/
theorem chosen_is_cheapest {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c))
    {p : Path} (hp : p ∈ ps) {d : Nat} (hd : cost p = some d) : c ≤ d :=
  pick_le h (p, d) (mem_measured.mpr ⟨hp, hd⟩)

/-- So beside the relay, a direct path that costs more than it is never sent on. -/
theorem a_slow_direct_path_loses_to_the_relay {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c))
    {r : Path} (hr : r ∈ ps) {d : Nat} (hd : cost r = some d) (hq : d < c) : False := by
  have := chosen_is_cheapest h hr hd; omega

namespace Examples

-- the Mac's page of 2026-10-28: WebRTC at 10.8 s that lost 4 of 5, the relay at 715 ms: the relay
def rtc : Path := { relay := false, rtt := 10800, sent := 5, lost := 4, received := true, stalled := false }
def relay : Path := { relay := true, rtt := 715, sent := 50, lost := 0, received := true, stalled := false }
#guard cost rtc == some 54000
#guard cost relay == some 1430
#guard (choose [rtc, relay]).map (·.1) == some relay
-- a direct path at most twice as slow as the relay is kept
#guard (choose [{ rtc with rtt := 500, sent := 100, lost := 0 }, { relay with rtt := 275 }]).map (·.1.relay) == some false
-- one that received nothing yet, or stopped, never
#guard (choose [{ rtc with rtt := 1, received := false }, relay]).map (·.1) == some relay
#guard (choose [{ rtc with rtt := 1, sent := 100, lost := 0, stalled := true }, relay]).map (·.1) == some relay

end Examples

end AvenDB.PathChoice
