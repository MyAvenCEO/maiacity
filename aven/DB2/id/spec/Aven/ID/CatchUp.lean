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

**Presence (C2).** A device is present while its newest signed beat (`.presence`, its counter the clock step it was
sent in) is at most `window` steps old (`present`). Only the device's own beats count (`present_signed`), and who is
present depends only on the beats a peer holds, not on their order or on who passed them on (`present_set`): no hub
counts connections. -/

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

/-- `d` is present at clock step `now`: the newest beat a peer takes from it is at most `window` steps old. -/
def present (admits : String → Bool) (window now : Nat) (rs : List PeerRecord) (d : String) : Bool :=
  rs.any fun r => r.kind == .presence && r.about == d && isNewest admits (fun _ => false) rs r &&
    decide (now ≤ r.counter + window)

/-- **`present_set`:** holding the same beats, in any order, gives the same presence. -/
theorem present_set {admits : String → Bool} {window now : Nat} {rs rs' : List PeerRecord}
    (h : ∀ x, x ∈ rs ↔ x ∈ rs') : present admits window now rs = present admits window now rs' := by
  funext d
  apply Bool.eq_iff_iff.mpr
  simp only [present, List.any_eq_true, newest_set h]
  exact ⟨fun ⟨r, m, p⟩ => ⟨r, (h r).mp m, p⟩, fun ⟨r, m, p⟩ => ⟨r, (h r).mpr m, p⟩⟩

/-- **`present_signed`:** a device is present only through a beat it signed itself, which the door admits. -/
theorem present_signed {admits : String → Bool} {window now : Nat} {rs : List PeerRecord} {d : String}
    (h : present admits window now rs d = true) :
    ∃ r ∈ rs, r.kind = .presence ∧ r.about = d ∧ r.signer = d ∧ admits d = true := by
  simp only [present, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at h
  obtain ⟨r, mr, ⟨⟨⟨k, a⟩, n⟩, _⟩⟩ := h
  have t := ((isNewest_iff.mp n).1).1.2
  simp only [takes, k, Bool.and_eq_true, beq_iff_eq] at t
  exact ⟨r, mr, k, a, t.1.trans a, a ▸ t.1 ▸ t.2⟩

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
def beats : List PeerRecord :=
  [⟨.presence, "bob-light", "bob-light", 10, 0⟩, ⟨.presence, "bob-light", "bob-light", 14, 0⟩,
   ⟨.presence, "alice-peer", "alice-peer", 5, 0⟩, ⟨.presence, "bob-light", "aven-peer", 99, 0⟩]

-- at step 15 with a window of 3: Bob's browser beat at 14, Alice's Peer last at 5; the Aven Peer's word for Bob counts
-- for nothing
#guard present admitted 3 15 beats "bob-light" && !present admitted 3 15 beats "alice-peer"
#guard !present admitted 3 20 beats "bob-light"

end CatchUpExamples

end CatchUp
end Aven.ID
