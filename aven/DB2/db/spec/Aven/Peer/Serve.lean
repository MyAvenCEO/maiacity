import Aven.Peer.Keeper
import Aven.Peer.Fetch

/-!
# A keeper serving its connections (PEERS.md §3 and §4; A22, A44)

What a keeper does with each ask on one connection, composing avenID's gate (`Aven.ID.Keep`), its arrivals
(`Aven.Peer.Keeper`) and the fetch gate (`Aven.Peer.Fetch`). The keeper reads no caps: avenID's gate answers for it.
Here the gate is a parameter, given by its verdicts, as the Rust keeper is tested before avenID's module lands:
- `serves doc proof`: the vault to bill if the keeper keeps `doc` (a valid keep cap ∩ its offers, not withdrawn, not
  deleted: `Books.keeps`) and `proof` signs this connection's exporter with the Doc's current fetch key
  (`Keep.serves`); none otherwise;
- `quota vault`: how much the keeper keeps for `vault` (`Books.quota`).

The asks:
- **`prove doc proof`:** the Doc is proven on this connection, billed to the vault the gate names, or refused.
- **`upload doc puts`:** from a connection that proved `doc`, the puts go into the Doc's arrivals in one write, the new
  items' bytes on the vault's bill, if they stay within its quota; otherwise refused whole, nothing taken.
- **`after doc n`:** the first page of what came after `n`, and whether more follows.
- **`fetch doc hashes`:** the fetch gate's answer over what the keeper holds for `doc`.

What it proves:
- `unproven_refused`: an upload, an after or a fetch for a Doc not proven on the connection is refused and changes
  nothing: a Doc no keep cap names is never kept or served;
- `kept_only_proven`: the keeper holds a Doc's items only after an upload from a connection the gate served for it;
- `quota_kept`: no vault's bill ever passes its quota (`quota_holds`, by the keeper's own sums).
-/

namespace Aven.Peer.Serve

open Aven.Peer.Keeper Aven.Peer.Fetch
open Aven.DB (pageSize)

/-- avenID's gate, by its verdicts. -/
structure Gate where
  serves : String → Nat → Option String
  quota : String → Nat

/-- An ask on a connection. -/
inductive Ask where
  | prove (doc : String) (proof : Nat)
  | upload (doc : String) (puts : List Put)
  | after (doc : String) (n : Nat)
  | fetch (doc : String) (hashes : List Nat)
  deriving DecidableEq, Repr

/-- The keeper's reply. -/
inductive Reply where
  | proven (doc : String)
  | proveRefused (doc : String)
  | took (doc : String) (numbers : List (Nat × Nat))
  | uploadRefused (doc : String) (why : String)
  | arrived (doc : String) (entries : List (Nat × Nat)) (more : Bool)
  | fetched (doc : String) (served missing later : List Nat)
  | refused (doc : String)
  deriving DecidableEq, Repr

/-- A keeper: what it holds of each Doc, and each vault's bill. -/
structure Keeper where
  docs : List (String × Store) := []
  bills : List (String × Nat) := []
  deriving Repr

/-- A connection: the door's device for it, and the Docs proven on it with the vault each bills. -/
structure Conn where
  device : String
  proven : List (String × String) := []
  deriving Repr

def lookup {α : Type} (xs : List (String × α)) (k : String) : Option α := (xs.find? (·.1 == k)).map (·.2)

def setAt {α : Type} (xs : List (String × α)) (k : String) (v : α) : List (String × α) :=
  (k, v) :: xs.filter (·.1 != k)

theorem find_filter_ne {α : Type} (k j : String) (e : j ≠ k) : ∀ (xs : List (String × α)),
    (xs.filter (·.1 != k)).find? (·.1 == j) = xs.find? (·.1 == j)
  | [] => rfl
  | ⟨a, b⟩ :: xs => by
    by_cases h : a = k
    · subst h
      have : (a == j) = false := by simpa using Ne.symm e
      simp [this, find_filter_ne a j e xs]
    · have : (a != k) = true := by simpa using h
      simp only [List.filter_cons, this, ↓reduceIte, List.find?_cons, find_filter_ne k j e xs]

theorem lookup_setAt {α : Type} (xs : List (String × α)) (k j : String) (v : α) :
    lookup (setAt xs k v) j = if j = k then some v else lookup xs j := by
  unfold lookup setAt
  by_cases e : j = k
  · subst e; simp
  · have : (k == j) = false := by simpa using Ne.symm e
    simp only [List.find?_cons, this, e, ↓reduceIte, find_filter_ne k j e xs]

namespace Keeper

def store (k : Keeper) (doc : String) : Store := (lookup k.docs doc).getD {}

def bill (k : Keeper) (v : String) : Nat := (lookup k.bills v).getD 0

/-- The bytes an upload adds: the puts new to the Doc, once each. -/
def adds (s : Store) : List Put → Nat
  | [] => 0
  | p :: ps => (if s.holds p.hash then 0 else p.bytes) + adds (s.put "" ⟨p.hash, p.bytes, []⟩) ps

/-- One ask on connection `c`. -/
def step (g : Gate) (k : Keeper) (c : Conn) : Ask → Keeper × Conn × Reply
  | .prove doc proof =>
    match g.serves doc proof with
    | some v => (k, { c with proven := setAt c.proven doc v }, .proven doc)
    | none => (k, c, .proveRefused doc)
  | .upload doc puts =>
    match lookup c.proven doc with
    | none => (k, c, .refused doc)
    | some v =>
      let s := k.store doc
      let more := adds s puts
      if k.bill v + more ≤ g.quota v then
        let s' := s.upload c.device puts
        ({ docs := setAt k.docs doc s', bills := setAt k.bills v (k.bill v + more) }, c,
          .took doc (puts.filterMap fun p => (s'.items.find? (·.hash == p.hash)).map fun i => (p.hash, i.n)))
      else (k, c, .uploadRefused doc "quota")
  | .after doc n =>
    match lookup c.proven doc with
    | none => (k, c, .refused doc)
    | some _ =>
      let all := (k.store doc).afterAll n
      (k, c, .arrived doc (all.take pageSize) (pageSize < all.length))
  | .fetch doc hs =>
    match lookup c.proven doc with
    | none => (k, c, .refused doc)
    | some _ =>
      let s := k.store doc
      let held : Held := fun h => (s.items.find? (·.hash == h)).map fun i => (doc, List.replicate i.bytes 0)
      match answer [doc] held doc hs with
      | some a => (k, c, .fetched doc (a.served.map (·.1)) a.missing a.later)
      | none => (k, c, .refused doc)

/-- **`unproven_refused`:** an ask other than `prove`, for a Doc not proven on the connection, is refused and changes
nothing. -/
theorem unproven_refused (g : Gate) (k : Keeper) (c : Conn) {a : Ask} {doc : String}
    (notProve : ∀ p, a ≠ .prove doc p) (about : a = .upload doc [] ∨ (∃ ps, a = .upload doc ps) ∨ (∃ n, a = .after doc n) ∨
      (∃ hs, a = .fetch doc hs)) (np : lookup c.proven doc = none) :
    (k.step g c a).2.2 = .refused doc ∧ (k.step g c a).1.docs = k.docs := by
  have := notProve
  rcases about with rfl | ⟨ps, rfl⟩ | ⟨n, rfl⟩ | ⟨hs, rfl⟩ <;> simp [step, np]

/-- **`kept_only_proven`:** after one ask, every Doc the keeper holds items of either held them before or was proven
on the connection: the gate served it a proof. -/
theorem kept_only_proven (g : Gate) (k : Keeper) (c : Conn) (a : Ask) (doc : String)
    (now : lookup (k.step g c a).1.docs doc ≠ lookup k.docs doc) : ∃ v, lookup c.proven doc = some v := by
  cases a with
  | prove d p => cases e : g.serves d p <;> simp [step, e] at now
  | upload d ps =>
    cases e : lookup c.proven d with
    | none => simp [step, e] at now
    | some v =>
      simp only [step, e] at now
      split at now
      · rw [lookup_setAt] at now
        split at now
        · rename_i h; subst h; exact ⟨v, e⟩
        · exact absurd rfl now
      · exact absurd rfl now
  | after d n => cases e : lookup c.proven d <;> simp [step, e] at now
  | fetch d hs =>
    cases e : lookup c.proven d with
    | none => simp [step, e] at now
    | some _ =>
      simp only [step, e] at now
      split at now <;> exact absurd rfl now

/-- **`quota_kept`:** a keeper whose bills are within their quotas keeps them so after any ask. -/
theorem quota_kept (g : Gate) (k : Keeper) (c : Conn) (a : Ask) (ok : ∀ v, k.bill v ≤ g.quota v) :
    ∀ v, (k.step g c a).1.bill v ≤ g.quota v := by
  intro w
  cases a with
  | prove d p => cases e : g.serves d p <;> simp [step, e, ok w]
  | upload d ps =>
    cases e : lookup c.proven d with
    | none => simp [step, e, ok w]
    | some v =>
      simp only [step, e]
      split
      · rename_i fits
        simp only [bill, lookup_setAt]
        split
        · rename_i h; subst h; simpa [bill] using fits
        · exact ok w
      · exact ok w
  | after d n => cases e : lookup c.proven d <;> simp [step, e, ok w]
  | fetch d hs =>
    cases e : lookup c.proven d with
    | none => simp [step, e, ok w]
    | some _ => simp only [step, e]; split <;> exact ok w

/-- Asks in order on one connection; the replies. -/
def run (g : Gate) : Keeper → Conn → List Ask → Keeper × Conn × List Reply
  | k, c, [] => (k, c, [])
  | k, c, a :: as =>
    let (k', c', r) := k.step g c a
    let (k'', c'', rs) := run g k' c' as
    (k'', c'', r :: rs)

end Keeper

/-! ## Examples -/

namespace ServeExamples

/-- The Aven Peer keeps d1 for Alice's vault (proof 1 is current, 2 an old key); it keeps nothing of d9, which no
keep cap names; Alice may keep 3000 bytes there. -/
def gate : Gate where
  serves doc proof := if doc = "d1" && proof = 1 then some "alice" else none
  quota v := if v = "alice" then 3000 else 0

def replies (as : List Ask) : List Reply := (Keeper.run gate {} ⟨"alice-peer-light", []⟩ as).2.2

-- an upload before proving, an old key, and a Doc no keep cap names: refused
#guard replies [.upload "d1" [⟨11, 900, []⟩], .prove "d1" 2, .prove "d9" 1, .upload "d9" [⟨11, 900, []⟩]] ==
  [.refused "d1", .proveRefused "d1", .proveRefused "d9", .refused "d9"]
-- proven: three loose envelopes taken, numbered; past the quota refused whole; the segment's covers drop them
#guard replies [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩, ⟨12, 900, []⟩], .upload "d1" [⟨13, 900, []⟩, ⟨14, 900, []⟩],
    .upload "d1" [⟨13, 900, []⟩], .after "d1" 0, .fetch "d1" [11, 99]] ==
  [.proven "d1", .took "d1" [(11, 1), (12, 2)], .uploadRefused "d1" "quota", .took "d1" [(13, 3)],
   .arrived "d1" [(1, 11), (2, 12), (3, 13)] false, .fetched "d1" [11] [99] []]

end ServeExamples

end Aven.Peer.Serve
