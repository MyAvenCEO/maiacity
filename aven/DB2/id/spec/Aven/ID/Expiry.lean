import Aven.ID.Revoke

/-! # Time is a claim, and expiry is acked (rule 12, caps' side; R12)

Envelopes are ordered by what they name, never by time. An envelope's time is its writer's claim: shown, and used by
caps' time conditions only as readers ack it (ARCHITECTURE.md, rule 12). For a write, a cap's expiry is judged against
the envelope's signed time, and for good from the first ack after it, so an expiry works like a revocation the clock
makes (`id/caps/README.md`, "Conditions" and "Expiry"). The first writer whose clock has passed it acks it, and from that
ack on, only what the ack had seen counts.

The theorems:
- `time_acked`: once a writer whose clock had passed the expiry acks it, a write the ack hadn't seen doesn't count,
  whatever time it claims, so a writer can't backdate past an ack;
- `claimed_late`: a write that claims a time at or past the expiry doesn't count;
- `before_ack`: until the first ack, a write is judged by the time it claims. That is the limit rule 12 accepts: a
  writer can backdate until a reader's ack lands.

Examples on Bob's cap, which expires at 100, are checked by `decide`. -/

namespace Aven.ID

/-- An envelope with its signed time: its writer's claim. -/
structure Timed where
  env : Envelope
  time : Nat
  deriving DecidableEq, Repr

/-- What an envelope acks when it acks `cap`'s expiry. -/
def expiryOf (cap : String) : String := "expired " ++ cap

/-- The envelopes of a Doc that ack `cap`'s expiry at `t`: by a writer whose claimed time had passed it. -/
def expiryAcks (doc : List Timed) (cap : String) (t : Nat) : List Timed :=
  doc.filter fun a => a.env.acks.contains (expiryOf cap) && decide (t ≤ a.time)

/-- A write under `cap`, which expires at `t`, counts for the clock when its own signed time is before `t` and every ack
of the expiry had it in its past. -/
def inTime (doc : List Timed) (cap : String) (t : Nat) (e : Timed) : Bool :=
  decide (e.time < t) && (expiryAcks doc cap t).all fun a => (pastOf (doc.map (·.env)) a.env.id).contains e.env.id

/-- Once a writer whose clock had passed the expiry acks it, a write the ack hadn't seen doesn't count, whatever time it
claims. -/
theorem time_acked {doc : List Timed} {cap : String} {t : Nat} {e a : Timed} (ha : a ∈ doc)
    (acks : a.env.acks.contains (expiryOf cap) = true) (late : t ≤ a.time)
    (unseen : (pastOf (doc.map (·.env)) a.env.id).contains e.env.id = false) : inTime doc cap t e = false := by
  have m : a ∈ expiryAcks doc cap t := by simp [expiryAcks, ha, List.contains_iff_mem.mp acks, late]
  cases h : inTime doc cap t e
  · rfl
  · simp only [inTime, Bool.and_eq_true, List.all_eq_true] at h
    rw [h.2 a m] at unseen
    cases unseen

/-- A write that claims a time at or past the expiry doesn't count. -/
theorem claimed_late {doc : List Timed} {cap : String} {t : Nat} {e : Timed} (late : t ≤ e.time) :
    inTime doc cap t e = false := by
  simp [inTime, Nat.not_lt.mpr late]

/-- Until the first ack, a write is judged by the time it claims. -/
theorem before_ack {doc : List Timed} {cap : String} {t : Nat} {e : Timed} (none : expiryAcks doc cap t = []) :
    inTime doc cap t e = decide (e.time < t) := by
  simp [inTime, none]

/-! ## Examples

Bob writes under `cap-a`, which expires at 100: at 90, and at 95. Alice writes at 120, having seen Bob's first, and acks
the expiry. Then Bob writes again, claiming 95 and naming only his own first write, and once more, honestly, at 105. -/

def bob90 : Timed := ⟨⟨"b90", "bob", ["cap-a"], [], []⟩, 90⟩
def aliceAck : Timed := ⟨⟨"a120", "alice", [], ["b90"], [expiryOf "cap-a"]⟩, 120⟩
def bobBackdated : Timed := ⟨⟨"b95", "bob", ["cap-a"], ["b90"], []⟩, 95⟩
def bob105 : Timed := ⟨⟨"b105", "bob", ["cap-a"], ["b90"], []⟩, 105⟩

def expiryDoc : List Timed := [bob90, aliceAck, bobBackdated, bob105]

theorem expiry_examples :
    inTime expiryDoc "cap-a" 100 bob90 = true ∧ inTime expiryDoc "cap-a" 100 bobBackdated = false ∧
      inTime expiryDoc "cap-a" 100 bob105 = false ∧
      inTime [bob90, bobBackdated] "cap-a" 100 bobBackdated = true := by decide

end Aven.ID
