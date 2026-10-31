import Aven.ID.Revoke

/-! # Time is a claim, and expiry is acked (rule 12, caps' side; R12)

Envelopes are ordered by what they name, never by time. An envelope's time is its writer's claim: shown, and used by
caps' time conditions only as readers ack it (ARCHITECTURE.md, rule 12). For a write, a cap's expiry is judged against
the envelope's signed time, and for good from the first ack after it, so an expiry works like a revocation the clock
makes (`id/caps/README.md`, "Conditions" and "Expiry"). The first writer whose clock has passed it acks it, and from
that ack on, only what the ack had seen counts.

Envelopes are Core's. Their signed time, like what they acknowledge, is read from inside the seal (`time`,
`Reads.acks`), and an ack of a cap's expiry names the expiry by its id.

The theorems:
- `time_acked`: once a writer whose clock had passed the expiry acks it, a write the ack hadn't seen doesn't count,
  whatever time it claims, so a writer can't backdate past an ack;
- `claimed_late`: a write that claims a time at or past the expiry doesn't count;
- `before_ack`: until the first ack, a write is judged by the time it claims. That is the limit rule 12 accepts: a
  writer can backdate until a reader's ack lands.

Examples on Bob's cap, which expires at 100, are Core envelopes named by BLAKE3, checked as the module builds. -/

namespace Aven.ID

open Aven.Core Aven.Core.Past

section

variable (nm : Envelope → Hash) (rd : Reads) (time : Envelope → Nat)

/-- The envelopes of a Doc that ack the expiry `x` at `t`: by a writer whose claimed time had passed it. -/
def expiryAcks (doc : List Envelope) (x : Hash) (t : Nat) : List Envelope :=
  doc.filter fun a => (rd.acks a).contains x && decide (t ≤ time a)

/-- A write under a cap whose expiry `x` falls at `t` counts for the clock when its own signed time is before `t` and
every ack of the expiry had it in its past. -/
def inTime (doc : List Envelope) (x : Hash) (t : Nat) (e : Envelope) : Bool :=
  decide (time e < t) && (expiryAcks rd time doc x t).all fun a => inPast nm doc a e

variable {nm rd time} {doc : List Envelope} {x : Hash} {t : Nat} {e a : Envelope}

/-- Once a writer whose clock had passed the expiry acks it, a write the ack hadn't seen doesn't count, whatever time it
claims. -/
theorem time_acked (ha : a ∈ doc) (acks : x ∈ rd.acks a) (late : t ≤ time a) (he : e ∈ doc)
    (unseen : ¬ Before nm doc a e) : inTime nm rd time doc x t e = false := by
  have m : a ∈ expiryAcks rd time doc x t := by simp [expiryAcks, ha, acks, late]
  cases h : inTime nm rd time doc x t e
  · rfl
  · simp only [inTime, Bool.and_eq_true, List.all_eq_true] at h
    exact absurd ((inPast_iff he).mp (h.2 a m)) unseen

/-- A write that claims a time at or past the expiry doesn't count. -/
theorem claimed_late (late : t ≤ time e) : inTime nm rd time doc x t e = false := by
  simp [inTime, Nat.not_lt.mpr late]

/-- Until the first ack, a write is judged by the time it claims. -/
theorem before_ack (none : expiryAcks rd time doc x t = []) : inTime nm rd time doc x t e = decide (time e < t) := by
  simp [inTime, none]

end

/-! ## Examples

Bob writes under `cap-a`, which expires at 100: at 90, and at 95. Alice writes at 120, having seen Bob's first, and acks
the expiry. Then Bob writes again, claiming 95 and naming only his own first write, and once more, honestly, at 105. -/

namespace ExpiryExamples

open RevokeExamples

/-- The id an ack of `cap-a`'s expiry names. -/
def expiryA : Hash := blake3 (utf8 "expired cap-a")

def bob90 : Envelope := env 2 1 "b90" "bob" [capA] [] [] 90
def aliceAck : Envelope := env 1 1 "a120" "alice" [] [expiryA] [nm bob90] 120
def bobBackdated : Envelope := env 2 2 "b95" "bob" [capA] [] [nm bob90] 95
def bob105 : Envelope := env 2 3 "b105" "bob" [capA] [] [nm bob90] 105

def expiryDoc : List Envelope := [bob90, aliceAck, bobBackdated, bob105]

#guard inTime nm reads time expiryDoc expiryA 100 bob90 && !inTime nm reads time expiryDoc expiryA 100 bobBackdated &&
  !inTime nm reads time expiryDoc expiryA 100 bob105 &&
  inTime nm reads time [bob90, bobBackdated] expiryA 100 bobBackdated

end ExpiryExamples

end Aven.ID
