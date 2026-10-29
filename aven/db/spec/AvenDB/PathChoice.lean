/-!
# Which path a node sends on: a fit direct path, else the relay

A node has paths to a peer: the relay's, and direct ones (WebRTC, WebTransport, IP). It sends on one
(`avendb-net/src/path_choice.rs`, `Measured`). iroh's own choice ranked every direct path above the relay whatever its
round trip: a Mac's page kept a WebRTC path of a 10.8 s round trip that lost 4 of its 5 askings, with the relay at
715 ms beside it, and took nothing in 10 min (2026-10-28).

Now each path costs what it measured: its round trip over the share of what it sent that arrived (`cost`). A path that
received nothing yet, lost all it sent, or stopped delivering has no cost and is never chosen
(`unmeasured_never_chosen`). A direct path is fit while it costs at most twice the cheapest relay path and `stick` more
(`fit`): it spares the relay its bandwidth and hop, and on a loopback what they differ by is jitter. The choice is the
cheapest fit direct path, else the cheapest relay path (`choose`), so a direct path that is not fit is never sent on
beside a measured relay (`an_unfit_direct_path_is_never_chosen`) and a fit one always is over the relay
(`a_fit_direct_path_beats_the_relay`). Its selector looks again each second, so a path that grew slow or stopped is
left at the next look. Keeping the current path against jitter under `stick` is in the code alone.
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
  else some (if p.sent = 0 then p.rtt else p.rtt * p.sent / (p.sent - p.lost))

/-- Jitter, in the costs' unit (5 ms in the code). -/
def stick : Nat := 5

/-- A direct path of cost `c` is fit beside the cheapest relay path's cost `r`, if there is one. -/
def fit (c : Nat) : Option Nat → Bool
  | none => true
  | some r => decide (c ≤ 2 * r + stick)

/-- The cheaper of two candidates, each a path with its cost; the first of two alike. -/
def better (a b : Path × Nat) : Path × Nat := if b.2 < a.2 then b else a

/-- The cheapest of some candidates. -/
def pick : List (Path × Nat) → Option (Path × Nat)
  | [] => none
  | a :: as => some (match pick as with
    | none => a
    | some r => better a r)

/-- The measured paths of `ps` that `keep` keeps, each with its cost. -/
def measured (keep : Path → Nat → Bool) (ps : List Path) : List (Path × Nat) :=
  ps.filterMap fun p => (cost p).bind fun c => if keep p c then some (p, c) else none

/-- The cheapest relay path's cost. -/
def relayCost (ps : List Path) : Option Nat := (pick (measured (fun p _ => p.relay) ps)).map (·.2)

/-- The path sent on: the cheapest fit direct path, else the cheapest relay path. -/
def choose (ps : List Path) : Option (Path × Nat) :=
  match pick (measured (fun p c => !p.relay && fit c (relayCost ps)) ps) with
  | some d => some d
  | none => pick (measured (fun p _ => p.relay) ps)

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

theorem mem_measured {keep : Path → Nat → Bool} {ps : List Path} {p : Path} {c : Nat} :
    (p, c) ∈ measured keep ps ↔ p ∈ ps ∧ cost p = some c ∧ keep p c = true := by
  simp only [measured, List.mem_filterMap, Option.bind_eq_some_iff]
  constructor
  · rintro ⟨q, hq, d, hd, he⟩
    split at he
    · simp at he; obtain ⟨rfl, rfl⟩ := he; exact ⟨hq, hd, by assumption⟩
    · simp at he
  · rintro ⟨hp, hc, hk⟩
    exact ⟨p, hp, c, hc, by simp [hk]⟩

/-- What is chosen is a path of them, measured. -/
theorem choose_cost {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c)) : q ∈ ps ∧ cost q = some c := by
  unfold choose at h
  split at h
  · rename_i d hd; simp at h; subst h; have := mem_measured.mp (pick_mem hd); exact ⟨this.1, this.2.1⟩
  · have := mem_measured.mp (pick_mem h); exact ⟨this.1, this.2.1⟩

/-- A path with no cost, unmeasured, lost or stopped, is never chosen. -/
theorem unmeasured_never_chosen {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c)) : cost q ≠ none := by
  rw [(choose_cost h).2]; simp

/-- A chosen direct path is fit beside the relay. -/
theorem an_unfit_direct_path_is_never_chosen {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c))
    (hq : q.relay = false) : fit c (relayCost ps) = true := by
  unfold choose at h
  split at h
  · rename_i d hd; simp at h; subst h
    have := (mem_measured.mp (pick_mem hd)).2.2; simp_all
  · have := (mem_measured.mp (pick_mem h)).2.2; simp_all

/-- A fit direct path is chosen over every relay path, and the chosen one costs no more than any fit direct path. -/
theorem a_fit_direct_path_beats_the_relay {ps : List Path} {q : Path} {c : Nat} (h : choose ps = some (q, c))
    {p : Path} (hp : p ∈ ps) (hd : p.relay = false) {d : Nat} (hc : cost p = some d) (hf : fit d (relayCost ps) = true) :
    q.relay = false ∧ c ≤ d := by
  have hm : (p, d) ∈ measured (fun p c => !p.relay && fit c (relayCost ps)) ps := mem_measured.mpr ⟨hp, hc, by simp [hd, hf]⟩
  unfold choose at h
  split at h
  · rename_i r hr; simp at h; subst h
    have hk := (mem_measured.mp (pick_mem hr)).2.2
    simp at hk
    exact ⟨hk.1, pick_le hr _ hm⟩
  · rename_i hn; exact absurd (pick_none hn) (List.ne_nil_of_mem hm)

namespace Examples

-- the Mac's page of 2026-10-28: WebRTC at 10.8 s that lost 4 of 5, the relay at 715 ms: the relay
def rtc : Path := { relay := false, rtt := 10800, sent := 5, lost := 4, received := true, stalled := false }
def relay : Path := { relay := true, rtt := 715, sent := 50, lost := 0, received := true, stalled := false }
#guard cost rtc == some 54000
#guard (choose [rtc, relay]).map (·.1) == some relay
-- a direct path at most twice as slow as the relay is taken
#guard (choose [{ rtc with rtt := 500, sent := 100, lost := 0 }, { relay with rtt := 275 }]).map (·.1.relay) == some false
-- a loopback: a direct path a few ms slower than a local relay is taken
#guard (choose [{ rtc with rtt := 4, sent := 50, lost := 0 }, { relay with rtt := 1 }]).map (·.1.relay) == some false
-- one that received nothing yet, or stopped, never
#guard (choose [{ rtc with rtt := 1, received := false }, relay]).map (·.1) == some relay
#guard (choose [{ rtc with rtt := 1, sent := 100, lost := 0, stalled := true }, relay]).map (·.1) == some relay

end Examples

end AvenDB.PathChoice
