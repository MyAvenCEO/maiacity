import Aven.ID.Epochs

/-! # Forgetting (PEERS.md §4; Thread D, D5)

What the network can promise when something is to be forgotten, on top of `Aven.ID.Epochs`' world of keys and seals,
with the cryptography taken as sound: a key is learned only as one's own or by opening a seal with a key already
known (`WorldOf.confidential`). That is the assumption every theorem here rests on: sealing is sound and its keys are
distinct (no two keys open alike), as everywhere in the Aven models.

- **Rotation shuts removed readers out of what follows** (`rotation_shuts_out`): every epoch after a removal, sealed
  only to the remaining readers' keys and to later epochs, stays closed to a removed reader that owns none of them.
- **Once no one holds a Doc's keys, no copy is readable** (`forgotten`): drop every key that opens the Doc, down from
  its epoch keys through every key they are sealed under, and no party, keepers included, learns any of them again,
  however many sealed copies keepers still hold. A sealed copy is readable only with its key (`readable`), so none is
  (`forgotten_unreadable`).
- **What can't be promised** (`copied_stays`): a reader that kept a key or the plain bytes it read before has them in
  its own store, and nothing the network does takes them back. Forgetting closes what follows and what no one holds;
  it never undoes what was seen.

A withdrawn keep cap and a delete, which make keepers drop the sealed bytes themselves, are the caps thread's
(`Aven.ID.Keep`, D2 and D3). -/

namespace Aven.ID
namespace Forget

open WorldOf

variable {κ : Type} [DecidableEq κ]

/-- A sealed copy is readable by `p` when `p` learns its key. -/
def readable (w : WorldOf κ) (p : String) (key : κ) : Bool := w.learns p key

/-- **`rotation_shuts_out`:** epochs after a removal, each sealed only under the remaining readers' new keys or a later
epoch, stay closed to a removed reader that owns none of those keys. -/
theorem rotation_shuts_out {w : WorldOf κ} {removed : String} {later remaining : List κ}
    (sealed : ∀ s ∈ w.seals, s.1 ∈ later ++ remaining → s.2 ∈ later ++ remaining)
    (notOwn : ∀ k ∈ later ++ remaining, k ∉ w.own removed) :
    ∀ n, ∀ e ∈ later, w.knows n removed e = false := by
  intro n e me
  simpa [knows] using fun m => unknowable notOwn sealed n e m (List.mem_append.mpr (.inl me))

/-- **`forgotten`:** a Doc's keys `S`, closed under what they are sealed under, that no party owns any more: no party
learns any of them. -/
theorem forgotten {w : WorldOf κ} {S : List κ} (c : w.Closed S) (dropped : ∀ p, ∀ k ∈ S, k ∉ w.own p) :
    ∀ p n, ∀ k ∈ S, w.knows n p k = false := by
  intro p n k mk
  simpa [knows] using fun m => unknowable (dropped p) c n k m mk

/-- **`forgotten_unreadable`:** then no copy sealed under one of those keys is readable, by anyone, keepers included. -/
theorem forgotten_unreadable {w : WorldOf κ} {S : List κ} (c : w.Closed S) (dropped : ∀ p, ∀ k ∈ S, k ∉ w.own p)
    {key : κ} (mk : key ∈ S) : ∀ p, readable w p key = false :=
  fun p => forgotten c dropped p w.seals.length key mk

/-- **`copied_stays`:** what a reader copied into its own store, a key or what it opened, stays known to it whatever
the network drops: the limit of forgetting. -/
theorem copied_stays {w : WorldOf κ} {p : String} {k : κ} (kept : k ∈ w.own p) : ∀ n, w.knows n p k = true := by
  intro n
  induction n with
  | zero => simp [knows, knownAfter, kept]
  | succ n ih =>
    have : k ∈ w.knownAfter p n := of_decide_eq_true ih
    simp [knows, knownAfter, step, this]

/-! ## Examples -/

namespace ForgetExamples

/-- A Doc's epoch key `e1`, sealed to Alice's and Bob's vault keys; after Bob's removal, `e2` is sealed to Alice's
alone. The keeper holds both sealed copies and no key. -/
def before : WorldOf String :=
  { own := fun p => if p == "alice" then ["alice-key"] else if p == "bob" then ["bob-key"] else []
    seals := [("e1", "alice-key"), ("e1", "bob-key"), ("e2", "alice-key")] }

#guard before.learns "bob" "e1" && !before.learns "bob" "e2" && !before.learns "keeper" "e1"

/-- Everyone drops the Doc's keys: Alice and Bob forget their vault keys for it. -/
def after : WorldOf String := { before with own := fun _ => [] }

#guard ["alice", "bob", "keeper"].all fun p => !readable after p "e1" && !readable after p "e2"

/-- Bob copied `e1` before: he still reads what `e1` sealed, and nothing after it. -/
def copied : WorldOf String := { after with own := fun p => if p == "bob" then ["e1"] else [] }

#guard readable copied "bob" "e1" && !readable copied "bob" "e2"

end ForgetExamples

end Forget
end Aven.ID
