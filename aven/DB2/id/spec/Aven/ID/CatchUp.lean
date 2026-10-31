import Aven.ID.Records

/-! # Catch-up from whoever holds the posts, and presence from beats (PEERS.md §2 and §3; Thread C, C1 and C2)

**Whom to ask (C1).** A peer catches up a device's log from any member that holds it, not from the Aven Peer first.
What it trusts is the device's own signed log tip (`Aven.ID.Records`, `.logTip`): the tip's number and the hash of the
post at that number. A source offers its copy of the log, the posts' hashes in order. A copy that falls short of the
tip, or holds another post at the tip's place, is caught (`caught`): a source can't hide posts behind a newer tip it
has seen signed, nor pass off a forged or split log. The peer asks its sources in order and takes the first that
isn't caught (`choose`); that one's copy reaches the tip (`chosen_reaches`), and when every source is caught, the peer
knows each one fell short or differs (`none_chosen`). Every post is still checked by its receiver as before; this
only decides whom to ask.

**Presence (C2, A35, A42).** A device is present while its newest signed beat (`.presence`) was heard at most `window`
steps ago, by the clock of the peer that heard it (`present`). The beat's counter only orders the device's beats: it
is not a time, so a beat dated ahead stays present no longer than any other (`present_heard`, `present_ages`). Only
the device's own beats count (`present_signed`), and who is present depends only on the beats a peer holds and when
it heard them, not on their order or on who passed them on (`present_set`): no hub counts connections. -/

namespace Aven.ID
namespace CatchUp

/-- A device's signed log tip: the number of its newest post and that post's hash. -/
structure Tip where
  number : Nat
  hash : Nat
  deriving DecidableEq, Repr

/-- A source's copy of a device's log: the posts' hashes, the first first. -/
abbrev Copy := List Nat

/-- A copy reaches the tip: it holds the tip's number of posts, and the post at the tip's place is the tip's. -/
def reaches (tip : Tip) (copy : Copy) : Bool :=
  match tip.number with
  | 0 => true
  | n + 1 => copy[n]? == some tip.hash

/-- A source is caught when its copy doesn't reach the newest signed tip: it withheld posts, or holds another post at
the tip's place. -/
def caught (tip : Tip) (copy : Copy) : Bool := !reaches tip copy

/-- **`withheld_shows`:** a copy shorter than the tip is caught. -/
theorem withheld_shows {tip : Tip} {copy : Copy} (short : copy.length < tip.number) : caught tip copy = true := by
  unfold caught reaches
  cases e : tip.number with
  | zero => omega
  | succ n =>
    have : copy[n]? = none := List.getElem?_eq_none (by omega)
    simp [this]

/-- **`forged_shows`:** a copy holding another post at the tip's place is caught. -/
theorem forged_shows {tip : Tip} {copy : Copy} {n h : Nat} (num : tip.number = n + 1) (at_tip : copy[n]? = some h)
    (other : h ≠ tip.hash) : caught tip copy = true := by
  simp [caught, reaches, num, at_tip, other]

/-- The first source, in the order the peer asks them, whose copy reaches the tip. -/
def choose (tip : Tip) (sources : List (String × Copy)) : Option (String × Copy) :=
  sources.find? fun s => reaches tip s.2

/-- **`chosen_reaches`:** the source chosen is one the peer holds, and its copy reaches the tip. -/
theorem chosen_reaches {tip : Tip} {sources : List (String × Copy)} {s : String × Copy}
    (h : choose tip sources = some s) : s ∈ sources ∧ reaches tip s.2 = true := by
  unfold choose at h
  have r := List.find?_some h
  exact ⟨List.mem_of_find?_eq_some h, r⟩

/-- **`none_chosen`:** when no source is chosen, every source is caught. -/
theorem none_chosen {tip : Tip} {sources : List (String × Copy)} (h : choose tip sources = none) :
    ∀ s ∈ sources, caught tip s.2 = true := by
  intro s ms
  unfold choose at h
  have := List.find?_eq_none.mp h s ms
  simp [caught, this]

/-- **`honest_chosen`:** a source whose copy reaches the tip is never passed over for none: some source is chosen. -/
theorem honest_chosen {tip : Tip} {sources : List (String × Copy)} {s : String × Copy} (ms : s ∈ sources)
    (r : reaches tip s.2 = true) : (choose tip sources).isSome := by
  cases e : choose tip sources with
  | none => have := none_chosen e s ms; simp [caught, r] at this
  | some _ => rfl

/-! ## Presence from signed beats -/

open Records

/-- A beat as a peer holds it: the record and the step of the peer's own clock when it first heard it. -/
structure Heard where
  beat : PeerRecord
  at_ : Nat
  deriving DecidableEq, Repr

/-- `d` is present at step `now` of a peer's own clock: the newest beat it takes from `d`, ordered by counter, was
heard at most `window` steps ago. -/
def present (admits : String → Bool) (window now : Nat) (hs : List Heard) (d : String) : Bool :=
  hs.any fun h => h.beat.kind == .presence && h.beat.about == d &&
    isNewest admits (fun _ => false) (hs.map (·.beat)) h.beat && decide (now ≤ h.at_ + window)

/-- **`present_set`:** holding the same beats, heard at the same steps, in any order, gives the same presence. -/
theorem present_set {admits : String → Bool} {window now : Nat} {hs hs' : List Heard}
    (h : ∀ x, x ∈ hs ↔ x ∈ hs') : present admits window now hs = present admits window now hs' := by
  have hb : ∀ r, r ∈ hs.map (·.beat) ↔ r ∈ hs'.map (·.beat) := by
    intro r
    simp only [List.mem_map]
    exact ⟨fun ⟨x, m, e⟩ => ⟨x, (h x).mp m, e⟩, fun ⟨x, m, e⟩ => ⟨x, (h x).mpr m, e⟩⟩
  funext d
  apply Bool.eq_iff_iff.mpr
  simp only [present, List.any_eq_true, newest_set hb]
  exact ⟨fun ⟨r, m, p⟩ => ⟨r, (h r).mp m, p⟩, fun ⟨r, m, p⟩ => ⟨r, (h r).mpr m, p⟩⟩

/-- **`present_signed`:** a device is present only through a beat it signed itself, which the door admits. -/
theorem present_signed {admits : String → Bool} {window now : Nat} {hs : List Heard} {d : String}
    (h : present admits window now hs d = true) :
    ∃ x ∈ hs, x.beat.kind = .presence ∧ x.beat.about = d ∧ x.beat.signer = d ∧ admits d = true := by
  simp only [present, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at h
  obtain ⟨x, mx, ⟨⟨⟨k, a⟩, n⟩, _⟩⟩ := h
  have t := ((isNewest_iff.mp n).1).1.2
  simp only [takes, k, Bool.and_eq_true, beq_iff_eq] at t
  exact ⟨x, mx, k, a, t.1.trans a, a ▸ t.1 ▸ t.2⟩

/-- **`present_heard`:** a device is present only through a beat this peer heard within the window, by its own clock,
whatever counter the beat carries. -/
theorem present_heard {admits : String → Bool} {window now : Nat} {hs : List Heard} {d : String}
    (h : present admits window now hs d = true) : ∃ x ∈ hs, x.beat.about = d ∧ now ≤ x.at_ + window := by
  simp only [present, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h
  obtain ⟨x, mx, ⟨⟨⟨_, a⟩, _⟩, w⟩⟩ := h
  exact ⟨x, mx, a, w⟩

/-- **`present_ages`:** once a window has passed on a peer's own clock since it last heard from a device, the device
is not present there: no beat dated ahead stays present (A42). -/
theorem present_ages {admits : String → Bool} {window now : Nat} {hs : List Heard} {d : String}
    (old : ∀ x ∈ hs, x.beat.about = d → x.at_ + window < now) : present admits window now hs d = false := by
  cases e : present admits window now hs d
  · rfl
  · obtain ⟨x, mx, a, w⟩ := present_heard e
    have := old x mx a
    omega

/-! ## Examples -/

namespace CatchUpExamples

def tip : Tip := ⟨3, 33⟩

-- the Aven Peer is gone: Alice's Peer holds Bob's log up to the tip, a stale peer only two posts, a forger
-- another third
#guard choose tip [("stale-peer", [11, 22]), ("forger", [11, 22, 99]), ("alice-peer", [11, 22, 33, 44])] ==
  some ("alice-peer", [11, 22, 33, 44])
#guard caught tip [11, 22] && caught tip [11, 22, 99] && !caught tip [11, 22, 33]
#guard choose tip [("stale-peer", [11, 22])] == none

def admitted (k : String) : Bool := k == "bob-light" || k == "alice-peer"
/-- Beats as a peer heard them, at steps of its own clock. -/
def beats : List Heard :=
  [⟨⟨.presence, "bob-light", "bob-light", 0, 10, 0⟩, 10⟩, ⟨⟨.presence, "bob-light", "bob-light", 0, 11, 0⟩, 14⟩,
   ⟨⟨.presence, "alice-peer", "alice-peer", 0, 5, 0⟩, 5⟩, ⟨⟨.presence, "bob-light", "aven-peer", 0, 99, 0⟩, 15⟩,
   -- Alice's Peer dates a beat far ahead: its counter orders it, but it ages from when it was heard
   ⟨⟨.presence, "alice-peer", "alice-peer", 0, 1000, 0⟩, 6⟩]

-- at step 15 with a window of 3: Bob's browser was last heard at 14, Alice's Peer at 6 whatever its counter says;
-- the Aven Peer's word for Bob counts for nothing
#guard present admitted 3 15 beats "bob-light" && !present admitted 3 15 beats "alice-peer"
#guard present admitted 3 8 beats "alice-peer"
#guard !present admitted 3 20 beats "bob-light"

end CatchUpExamples

end CatchUp
end Aven.ID
