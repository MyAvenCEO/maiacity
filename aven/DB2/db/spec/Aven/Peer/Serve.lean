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
- `quota vault`: how much the keeper keeps for `vault` at once (`Books.quota`).

The asks:
- **`prove doc proof`:** the Doc is proven on this connection, and the device acts for the vault the gate names; or
  refused.
- **`upload doc puts`:** from a connection that proved `doc`, the puts go into the Doc's arrivals in one write, if the
  vault's bill after it is within its quota or no larger than before; otherwise refused whole, nothing taken.
- **`after doc n`:** the first page of what came after `n`, and whether more follows.
- **`fetch doc hashes`:** the fetch gate's answer over what the keeper holds for `doc`.

What it proves:
- `unproven_refused`: an upload, an after or a fetch for a Doc not proven on the connection is refused and changes
  nothing: a Doc no keep cap names is never kept or served;
- `kept_only_proven`: the keeper holds a Doc's items only after an upload from a connection the gate served for it;
- `bill_follows`: a vault's bill is the bytes of the items held whose earliest remaining uploader acts for it. An item
  is billed to the vault of the first device that uploaded it; when that device covers it, the bill moves to the next
  uploader in upload order (`put_order`), and it is freed when the item drops (the architect, 31 Oct 2026: the quota
  counts what is held; a rate limit, apart, counts bytes taken per window);
- `moved_bill_keeps`: a bill that moved can put a vault over its quota. A refused upload changes nothing, and no ask
  drops an item another device uploaded;
- admission: an upload is taken when the vault's bill after it is within its quota, or no larger than before
  (`admitted_within`), so a vault over its quota can always shed bytes and never grow past it (`over_quota_sheds`).
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

/-- A keeper: what it holds of each Doc, and the vault each device acts for, as the gate named it. -/
structure Keeper where
  docs : List (String × Store) := []
  acts : List (String × String) := []
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

/-- Who pays for an item: the vault its earliest remaining uploader acts for. -/
def payer (k : Keeper) (i : Item) : Option String := i.uploaders.head?.bind (lookup k.acts)

/-- A vault's bill: the bytes of the items held, in every Doc, that it pays for. -/
def bill (k : Keeper) (v : String) : Nat :=
  (k.docs.map fun e => ((e.2.items.filter fun i => k.payer i == some v).map (·.bytes)).sum).sum

/-- One ask on connection `c`. -/
def step (g : Gate) (k : Keeper) (c : Conn) : Ask → Keeper × Conn × Reply
  | .prove doc proof =>
    match g.serves doc proof with
    | some v => ({ k with acts := setAt k.acts c.device v }, { c with proven := setAt c.proven doc v }, .proven doc)
    | none => (k, c, .proveRefused doc)
  | .upload doc puts =>
    match lookup c.proven doc with
    | none => (k, c, .refused doc)
    | some v =>
      let s' := (k.store doc).upload c.device puts
      let k' := { k with docs := setAt k.docs doc s' }
      if k'.bill v ≤ g.quota v || k'.bill v ≤ k.bill v then
        (k', c, .took doc (puts.filterMap fun p => (s'.items.find? (·.hash == p.hash)).map fun i => (p.hash, i.n)))
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
    (about : (∃ ps, a = .upload doc ps) ∨ (∃ n, a = .after doc n) ∨ (∃ hs, a = .fetch doc hs))
    (np : lookup c.proven doc = none) :
    (k.step g c a).2.2 = .refused doc ∧ (k.step g c a).1.docs = k.docs := by
  rcases about with ⟨ps, rfl⟩ | ⟨n, rfl⟩ | ⟨hs, rfl⟩ <;> simp [step, np]

/-- **`kept_only_proven`:** after one ask, every Doc whose items changed was proven on the connection: the gate served
it a proof. -/
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

/-- **`bill_follows`:** a vault's bill is the bytes of the items held whose earliest remaining uploader acts for it.
After a put an item's uploaders are those before in upload order, with the putting device added at the end or taken
off (`Store.put_order`), so when its first uploader covers it, the bill moves to the next in upload order; when none
is left the item drops and is no one's. -/
theorem bill_follows (k : Keeper) (v : String) :
    k.bill v = (k.docs.map fun e =>
      ((e.2.items.filter fun i => i.uploaders.head?.bind (lookup k.acts) == some v).map (·.bytes)).sum).sum := rfl

/-- The keeper after taking an upload, before it decides to. -/
def taking (k : Keeper) (c : Conn) (doc : String) (ps : List Put) : Keeper :=
  { k with docs := setAt k.docs doc ((k.store doc).upload c.device ps) }

/-- **`admitted_within`:** a taken upload leaves the vault's bill within its quota, or no larger than before. -/
theorem admitted_within (g : Gate) (k : Keeper) (c : Conn) {doc : String} {ps : List Put} {v : String}
    (pv : lookup c.proven doc = some v) {ns : List (Nat × Nat)} (h : (k.step g c (.upload doc ps)).2.2 = .took doc ns) :
    (k.step g c (.upload doc ps)).1 = k.taking c doc ps ∧
      ((k.taking c doc ps).bill v ≤ g.quota v ∨ (k.taking c doc ps).bill v ≤ k.bill v) := by
  simp only [step, pv] at h ⊢
  split at h
  · rename_i ok
    simp only [ok, ↓reduceIte]
    refine ⟨rfl, ?_⟩
    simp only [Bool.or_eq_true, decide_eq_true_eq] at ok
    exact ok
  · simp at h

/-- **`over_quota_sheds`:** an upload that doesn't grow the vault's bill is taken, so a vault a moved bill pushed past
its quota can always shed bytes (a covering segment), and never grow past it. -/
theorem over_quota_sheds (g : Gate) (k : Keeper) (c : Conn) {doc : String} {ps : List Put} {v : String}
    (pv : lookup c.proven doc = some v) (sheds : (k.taking c doc ps).bill v ≤ k.bill v) :
    (k.step g c (.upload doc ps)).1 = k.taking c doc ps ∧ ∃ ns, (k.step g c (.upload doc ps)).2.2 = .took doc ns := by
  simp only [step, pv]
  split
  · exact ⟨rfl, _, rfl⟩
  · rename_i no
    exact (no (by simp only [Bool.or_eq_true, decide_eq_true_eq]; exact .inr sheds)).elim

/-- **`moved_bill_keeps`:** a bill that moved over a vault's quota only refuses its new uploads. A refused upload
changes nothing; and no ask drops an item another device uploaded: it stays, with that uploader on it. -/
theorem moved_bill_keeps (g : Gate) (k : Keeper) (c : Conn) (a : Ask) :
    ((∀ doc ps, a = .upload doc ps → (k.step g c a).2.2 = .uploadRefused doc "quota" → (k.step g c a).1.docs = k.docs) ∧
      ∀ doc i x, i ∈ (k.store doc).items → x ∈ i.uploaders → x ≠ c.device →
        ∃ j ∈ ((k.step g c a).1.store doc).items, j.n = i.n ∧ j.hash = i.hash ∧ x ∈ j.uploaders) := by
  refine ⟨fun doc ps e r => ?_, fun doc i x m hx xd => ?_⟩
  · subst e
    simp only [step] at r ⊢
    split at r
    · simp at r
    · rename_i v _
      split at r
      · simp at r
      · split <;> simp_all
  · have same : ∀ k' : Keeper, k'.docs = k.docs → ∃ j ∈ (k'.store doc).items, j.n = i.n ∧ j.hash = i.hash ∧
        x ∈ j.uploaders := fun k' e => ⟨i, by simp only [store, e]; exact m, rfl, rfl, hx⟩
    cases a with
    | prove d p => cases e : g.serves d p <;> simp only [step, e] <;> exact same _ rfl
    | upload d ps =>
      cases e : lookup c.proven d with
      | none => simp only [step, e]; exact same _ rfl
      | some v =>
        simp only [step, e]
        split
        · simp only [store, lookup_setAt]
          split
          · rename_i h
            subst h
            have := Store.gone_writer_kept (x := x) [(c.device, ps)] (s := k.store doc)
              (fun u mu => by simp only [List.mem_singleton] at mu; subst mu; exact Ne.symm xd) m hx
            simpa [List.foldl, store] using this
          · exact ⟨i, m, rfl, rfl, hx⟩
        · exact same _ rfl
    | after d n => cases e : lookup c.proven d <;> simp only [step, e] <;> exact same _ rfl
    | fetch d hs =>
      cases e : lookup c.proven d with
      | none => simp only [step, e]; exact same _ rfl
      | some _ => simp only [step, e]; split <;> exact same _ rfl

/-- Asks in order, each on the connection of the device that makes it; the replies. -/
def run (g : Gate) : Keeper → List (String × Conn) → List (String × Ask) → Keeper × List Reply
  | k, _, [] => (k, [])
  | k, cs, (d, a) :: as =>
    let (k', c', r) := k.step g ((lookup cs d).getD ⟨d, []⟩) a
    let (k'', rs) := run g k' (setAt cs d c') as
    (k'', r :: rs)

end Keeper

/-! ## Examples -/

namespace ServeExamples

/-- The Aven Peer keeps d1 for Alice's and Bob's vaults (proofs 1 and 3 are current, 2 an old key); it keeps nothing of
d9, which no keep cap names; Alice may keep 3000 bytes there, Bob 3000, Carol 500. -/
def gate : Gate where
  serves doc proof :=
    if doc = "d1" && proof = 1 then some "alice" else if doc = "d1" && proof = 3 then some "bob"
    else if doc = "d1" && proof = 4 then some "carol" else none
  quota v := if v = "alice" then 3000 else if v = "bob" then 3000 else if v = "carol" then 500 else 0

def replies (as : List (String × Ask)) : List Reply := (Keeper.run gate {} [] as).2

def alice (as : List Ask) : List (String × Ask) := as.map ("alice-peer-light", ·)

-- an upload before proving, an old key, and a Doc no keep cap names: refused
#guard replies (alice [.upload "d1" [⟨11, 900, []⟩], .prove "d1" 2, .prove "d9" 1, .upload "d9" [⟨11, 900, []⟩]]) ==
  [.refused "d1", .proveRefused "d1", .proveRefused "d9", .refused "d9"]
-- proven: loose envelopes taken, numbered; past the quota refused whole
#guard replies (alice [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩, ⟨12, 900, []⟩],
    .upload "d1" [⟨13, 900, []⟩, ⟨14, 900, []⟩], .upload "d1" [⟨13, 900, []⟩], .after "d1" 0, .fetch "d1" [11, 99]]) ==
  [.proven "d1", .took "d1" [(11, 1), (12, 2)], .uploadRefused "d1" "quota", .took "d1" [(13, 3)],
   .arrived "d1" [(1, 11), (2, 12), (3, 13)] false, .fetched "d1" [11] [99] []]
-- the bill counts what is held: Alice's segment drops 2700 bytes of loose envelopes, so 2500 more fit again
#guard (replies (alice [.prove "d1" 1, .upload "d1" [⟨11, 900, []⟩, ⟨12, 900, []⟩, ⟨13, 900, []⟩],
    .upload "d1" [⟨20, 2500, []⟩], .upload "d1" [⟨50, 300, [11, 12, 13]⟩], .upload "d1" [⟨20, 2500, []⟩]])).drop 2 ==
  [.uploadRefused "d1" "quota", .took "d1" [(50, 4)], .took "d1" [(20, 5)]]
-- the bill follows the uploaders: Bob uploads 12, Carol relays it; Bob's segment covers it, so 12 moves to Carol's
-- bill, past her quota of 500. Only her new uploads are refused: 12 stays held
def moved : List (String × Ask) :=
  [("bob-peer-light", .prove "d1" 3), ("carol-peer", .prove "d1" 4), ("bob-peer-light", .upload "d1" [⟨12, 900, []⟩]),
   ("carol-peer", .upload "d1" [⟨12, 900, []⟩]), ("bob-peer-light", .upload "d1" [⟨50, 300, [12]⟩]),
   ("carol-peer", .upload "d1" [⟨77, 10, []⟩]), ("carol-peer", .after "d1" 0)]
#guard replies moved ==
  [.proven "d1", .proven "d1", .took "d1" [(12, 1)], .took "d1" [(12, 1)], .took "d1" [(50, 2)],
   .uploadRefused "d1" "quota", .arrived "d1" [(1, 12), (2, 50)] false]
#guard let k := (Keeper.run gate {} [] moved).1; (k.bill "carol", k.bill "bob") == (900, 300)
-- Carol sheds it: her segment covering 12 drops 900 bytes for 10, so it is taken, and then 77 fits
#guard (replies (moved ++ [("carol-peer", .upload "d1" [⟨60, 10, [12]⟩]), ("carol-peer", .upload "d1" [⟨77, 10, []⟩])])).drop 7 ==
  [.took "d1" [(60, 3)], .took "d1" [(77, 4)]]

end ServeExamples

end Aven.Peer.Serve
