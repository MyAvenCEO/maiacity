import Aven.Actor.Address

/-!
# Moving an actor's home (A202)

An address names no device (A201), so moving an actor changes only who signs its log. The move is the owner's act
(D14): its statement sets the actor's new home, whose device cap then covers the actor (A27).

- **An orderly move** is a handover in the actor's own log: the old home's last entry is `handover {to, version}`,
  naming the Doc's tips by hash, and the new home's first envelope builds on it. A reader takes an envelope only from
  the home in force and only on the log's tip, so the log stays one and the old home writes no more.
- **A lost old home:** the owner's statement alone moves it (`Move`), and the new home goes on from the latest version
  it could gather. The move starts a new **generation** of the actor's sends: a receiver orders messages per (sender,
  generation, seq), and the statement names, per pair, the last seq of the old generation it accepts as seen.

The model takes the hash of an envelope as a parameter `H`, and a log entry's own content as opaque bytes.

What it proves:

- `handover_single_writer`: every envelope a reader takes is signed by the home in force, and after a handover to
  another home, nothing the old home signs is taken.
- `handover_continues`: the first envelope taken after a handover is the new home's, and it builds on the handover
  entry, so the log is one chain.
- `generation_order`: a receiver takes one sender's messages in strictly increasing (generation, seq), so each at
  most once; within a generation none is skipped (`admit_next`), nothing of a closed generation past the statement's
  seq is taken (`beyond_seen_refused`), and a new generation starts only once the old one reached it
  (`new_generation_after_seen`).
-/

namespace Aven.Actor

open Aven.Core (Bytes Hash)

/-! ## The handover -/

/-- What a log entry says: a turn's content, or the old home's last entry, the handover to `to` at the Doc's `tips`. -/
inductive Body where
  | entry (content : Bytes)
  | handover (to : Bytes) (tips : List Hash)
  deriving DecidableEq, Repr, Inhabited

/-- An envelope of the actor's log: its signing device, the entry it builds on, and what it says. -/
structure Envelope where
  signer : Bytes
  prev : Option Hash
  body : Body
  deriving DecidableEq, Repr, Inhabited

/-- The owner's statement for a lost home (D14 approval): the new home, the version it goes on from, its
generation, and per receiver the last seq of the old generation accepted as seen. -/
structure Move where
  to : Bytes
  base : Option Hash
  seen : List (Addr × Nat)
  deriving DecidableEq, Repr, Inhabited

/-- What a reader holds of an actor's log: the home in force, the log's tip and the generation of its sends. -/
structure Log where
  home : Bytes
  tip : Option Hash
  gen : Nat
  deriving DecidableEq, Repr, Inhabited

/-- The home an envelope leaves in force. -/
def Envelope.next (e : Envelope) (home : Bytes) : Bytes :=
  match e.body with
  | .handover to _ => to
  | .entry _ => home

/-- A reader takes an envelope only from the home in force and only on the log's tip. -/
def Log.take (H : Envelope → Hash) (l : Log) (e : Envelope) : Option Log :=
  if e.signer = l.home ∧ e.prev = l.tip then some ⟨e.next l.home, some (H e), l.gen⟩ else none

/-- The owner's statement moves a lost home: a new home, the version it goes on from, and a new generation. -/
def Log.move (l : Log) (m : Move) : Log := ⟨m.to, m.base, l.gen + 1⟩

/-- Every envelope a reader takes is signed by the home in force, and after a handover to another home nothing the old
home signs is taken. -/
theorem handover_single_writer {H : Envelope → Hash} {l l' : Log} {e : Envelope} (h : l.take H e = some l') :
    e.signer = l.home ∧
      ∀ to tips, e.body = .handover to tips → to ≠ l.home → ∀ e', e'.signer = l.home → l'.take H e' = none := by
  unfold Log.take at h
  split at h
  · next hc =>
    cases h
    refine ⟨hc.1, fun to tips hb hne e' hs => ?_⟩
    simp only [Log.take, Envelope.next, hb, hs]
    simp [Ne.symm hne]
  · cases h

/-- The first envelope taken after a handover is the new home's, and it builds on the handover entry. -/
theorem handover_continues {H : Envelope → Hash} {l l' l'' : Log} {h e : Envelope} {to : Bytes} {tips : List Hash}
    (hb : h.body = .handover to tips) (h1 : l.take H h = some l') (h2 : l'.take H e = some l'') :
    e.signer = to ∧ e.prev = some (H h) := by
  unfold Log.take at h1 h2
  split at h1
  · cases h1
    split at h2
    · next hc => simpa [Envelope.next, hb] using hc
    · cases h2
  · cases h1

/-- A move keeps nothing of the old home: the new home is in force, from the statement's version, one generation on. -/
theorem move_new_generation (l : Log) (m : Move) :
    (l.move m).home = m.to ∧ (l.move m).tip = m.base ∧ (l.move m).gen = l.gen + 1 := ⟨rfl, rfl, rfl⟩

/-! ## Generations in the per-pair order -/

/-- (generation, seq) before (generation, seq): an earlier generation, or the same one and a smaller seq. -/
def Key.before (a b : Nat × Nat) : Prop := a.1 < b.1 ∨ (a.1 = b.1 ∧ a.2 < b.2)

theorem Key.before_trans {a b c : Nat × Nat} (h1 : Key.before a b) (h2 : Key.before b c) : Key.before a c := by
  unfold Key.before at *; omega

/-- What a receiver holds per sender: the generation it is in, the last seq it took there, and, once the owner's
statement moved the sender, the last seq of this generation it accepts as seen. -/
structure Order where
  gen : Nat
  last : Nat
  close : Option Nat
  deriving DecidableEq, Repr, Inhabited

def Order.key (o : Order) : Nat × Nat := (o.gen, o.last)

/-- A receiver takes `(g, q)` when it is the next seq of its generation, within the statement's seq once one closed
it; or the first of the next generation, once the old one reached the statement's seq. -/
def Order.admit (o : Order) (g q : Nat) : Option Order :=
  if g = o.gen ∧ q = o.last + 1 ∧ o.close.all (q ≤ ·) then some { o with last := q }
  else if g = o.gen + 1 ∧ q = 1 ∧ o.close = some o.last then some ⟨g, 1, none⟩
  else none

/-- The owner's statement closes the receiver's current generation of that sender at the seq it names, never below
what the receiver already took. -/
def Order.closeAt (o : Order) (n : Nat) : Order := { o with close := some (max n o.last) }

/-- What a receiver sees of one sender: a message `(generation, seq)`, or the owner's statement for the pair. -/
inductive Arrival where
  | msg (g q : Nat)
  | statement (seen : Nat)
  deriving DecidableEq, Repr, Inhabited

/-- The receiver over a stream of arrivals: where it ends, and the keys it took, in order. -/
def Order.feed : Order → List Arrival → Order × List (Nat × Nat)
  | o, [] => (o, [])
  | o, .statement n :: as => Order.feed (o.closeAt n) as
  | o, .msg g q :: as =>
    match o.admit g q with
    | some o' => let r := Order.feed o' as; (r.1, (g, q) :: r.2)
    | none => Order.feed o as

theorem Order.admit_key {o o' : Order} {g q : Nat} (h : o.admit g q = some o') :
    Key.before o.key (g, q) ∧ o'.key = (g, q) := by
  unfold Order.admit at h
  split at h
  · next hc => cases h; obtain ⟨rfl, rfl, -⟩ := hc; simp [Order.key, Key.before]
  · split at h
    · next hc => cases h; obtain ⟨rfl, rfl, -⟩ := hc; simp [Order.key, Key.before]
    · cases h

theorem Order.feed_after (o : Order) (as : List Arrival) : ∀ k ∈ (o.feed as).2, Key.before o.key k := by
  induction as generalizing o with
  | nil => simp [Order.feed]
  | cons a as ih =>
    cases a with
    | statement n => simpa [Order.feed, Order.closeAt, Order.key] using ih (o.closeAt n)
    | msg g q =>
      simp only [Order.feed]
      split
      · next o' h =>
        obtain ⟨hb, hk⟩ := Order.admit_key h
        intro k hk'
        simp only [List.mem_cons] at hk'
        rcases hk' with rfl | hk'
        · exact hb
        · exact Key.before_trans hb (hk ▸ ih o' k hk')
      · exact ih o

/-- A receiver takes one sender's messages in strictly increasing (generation, seq): in order, each at most once. -/
theorem generation_order (o : Order) (as : List Arrival) : (o.feed as).2.Pairwise Key.before := by
  induction as generalizing o with
  | nil => simp [Order.feed]
  | cons a as ih =>
    cases a with
    | statement n => exact ih _
    | msg g q =>
      simp only [Order.feed]
      split
      · next o' h =>
        refine List.Pairwise.cons (fun k hk => ?_) (ih o')
        have := Order.feed_after o' as k hk
        rwa [(Order.admit_key h).2] at this
      · exact ih o

/-- Within a generation none is skipped: the only seq of the current generation a receiver takes is the next. -/
theorem admit_next {o o' : Order} {q : Nat} (h : o.admit o.gen q = some o') : q = o.last + 1 := by
  unfold Order.admit at h
  split at h
  · next hc => exact hc.2.1
  · split at h
    · next hc => omega
    · cases h

/-- Nothing of a closed generation past the statement's seq is taken. -/
theorem beyond_seen_refused {o : Order} {n q : Nat} (hc : o.close = some n) (hq : n < q) : o.admit o.gen q = none := by
  unfold Order.admit
  simp only [hc, Option.all_some, decide_eq_true_eq, true_and]
  split
  · next h => omega
  · split
    · next h => omega
    · rfl

/-- A new generation starts only once the receiver took the old one up to the statement's seq. -/
theorem new_generation_after_seen {o o' : Order} {q : Nat} (h : o.admit (o.gen + 1) q = some o') :
    o.close = some o.last := by
  unfold Order.admit at h
  split at h
  · next hc => omega
  · split at h
    · next hc => exact hc.2.2
    · cases h

end Aven.Actor
