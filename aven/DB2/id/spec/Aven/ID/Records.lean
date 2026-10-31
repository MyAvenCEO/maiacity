import Aven.Core

/-! # Signed records, not a peer's word (PEERS.md §6 and §7)

What peers tell each other about themselves travels as records, each signed by the one it is about, so who passed it
on never matters:

- **address:** how to reach a device: its home relay and direct addresses;
- **presence:** a device's beat while it is there;
- **log tip:** the newest post of a device's own log, by hash and number;
- **tree tip:** the tree statements a member device holds, by their names;
- **release:** a release's version, its wire version and the hashes of what it ships, signed by the release signers
  (A15).

Each carries a generation and a counter, and a newer one replaces an older one. What a record says is opaque here,
named by its hash as a number (`body`): only which record is newest matters to the rules. Each kind signs under a label
of its own (`RecordKind.label`, `Aven.Core.signingBytes`), so a record of one kind is never read as another's.

**Two kinds of signed thing** (A31, A42). An address, a log tip or a release record is history: an entry in its
signer's own log, whose generation names the log and whose counter is its place there, so the newest is the latest in
the latest generation. Two different records at one place are a split, and a split is final (A4): nothing at or after
it in that generation counts, for any reader, however much more it learns (`split_final`). A split ends one
generation, not the device: its next generation counts again (`split_spares_next`), so a device that split re-homes in
a new one (`Node.rehome_new_generation`). Presence and tree tips are beats: they decide nothing, and the latest counter
is all that matters; a peer ages a beat by its own clock (`CatchUp.present`).

The theorems:
- `newest_set`: which record is newest depends only on the set of records a peer holds, not their order;
- `newest_signed`: the newest record about a device was signed by that device (a release's by a release signer), so
  no peer's word stands in for it;
- `newest_agree`: two records that are both newest say the same thing;
- `split_final`: once a peer holds a split in a signer's history, nothing at or after it in that generation is ever
  newest there;
- `split_spares_next`: a split in one generation leaves every later generation counting;
- `newest_grows`: holding more records never makes the newest one older, while what was newest still counts;
- `speaks_same`: a peer speaks only its own wire version, with no fallback (README rule 9). -/

namespace Aven.ID
namespace Records

inductive RecordKind where
  | address
  | presence
  | logTip
  | treeTip
  | release
  deriving DecidableEq, Repr

/-- The label each kind signs under. -/
def RecordKind.label : RecordKind → String
  | .address => "aven/peer/address/1"
  | .presence => "aven/peer/presence/1"
  | .logTip => "aven/peer/log-tip/1"
  | .treeTip => "aven/peer/tree-tip/1"
  | .release => "aven/peer/release/1"

theorem label_inj {a b : RecordKind} (h : a.label = b.label) : a = b := by
  cases a <;> cases b <;> simp_all [RecordKind.label]

/-- A record: its kind, the device it is about (a release's: the name of the release line), who signed it, its
generation (history's log; a beat's is 0) and counter, and what it says, by hash. -/
structure PeerRecord where
  kind : RecordKind
  about : String
  signer : String
  generation : Nat
  counter : Nat
  body : Nat
  deriving DecidableEq, Repr

/-- A record a peer takes: a release signed by a release signer, or any other kind signed by the device it is about,
which the door admits. Its signature was checked as it came (`Aven.Core.Signed.valid`). -/
def takes (admits releasers : String → Bool) (r : PeerRecord) : Bool :=
  match r.kind with
  | .release => releasers r.signer
  | _ => r.signer == r.about && admits r.signer

/-- History, an entry in its signer's own log (A31, A42): an address, a log tip or a release record. Presence and tree
tips are beats. -/
def RecordKind.history : RecordKind → Bool
  | .address | .logTip | .release => true
  | _ => false

/-- `a` is newer than `b`: a later generation, or the same one and a larger counter, or the same place and a smaller
body (which, in history, is a split and never counts). -/
def newer (a b : PeerRecord) : Bool :=
  b.generation < a.generation ||
    (a.generation == b.generation && (b.counter < a.counter || (a.counter == b.counter && a.body < b.body)))

/-- The records a peer takes of one kind about one device. -/
def candidates (admits releasers : String → Bool) (k : RecordKind) (about : String) (rs : List PeerRecord) :
    List PeerRecord :=
  rs.filter fun r => takes admits releasers r && r.kind == k && r.about == about

/-- `r` counts: a beat always; history only while no split in its generation lies at or before its place. -/
def counts (admits releasers : String → Bool) (rs : List PeerRecord) (r : PeerRecord) : Bool :=
  !r.kind.history ||
    (candidates admits releasers r.kind r.about rs).all fun s =>
      (candidates admits releasers r.kind r.about rs).all fun t =>
        !(s.generation == r.generation && t.generation == r.generation && s.counter == t.counter &&
          decide (s.counter ≤ r.counter) && s.body != t.body)

/-- `r` is the newest record of its kind about its device among `rs`: it counts, and no other one taken that counts
is newer. -/
def isNewest (admits releasers : String → Bool) (rs : List PeerRecord) (r : PeerRecord) : Bool :=
  (candidates admits releasers r.kind r.about rs).contains r && counts admits releasers rs r &&
    (candidates admits releasers r.kind r.about rs).all fun s => !(counts admits releasers rs s && newer s r)

/-- The newest record of a kind about a device, if a peer holds any. -/
def newest (admits releasers : String → Bool) (k : RecordKind) (about : String) (rs : List PeerRecord) :
    Option PeerRecord :=
  (candidates admits releasers k about rs).find? (isNewest admits releasers rs)

variable {admits releasers : String → Bool} {rs rs' : List PeerRecord} {r r' : PeerRecord}

theorem mem_candidates {k : RecordKind} {about : String} :
    r ∈ candidates admits releasers k about rs ↔ r ∈ rs ∧ takes admits releasers r = true ∧ r.kind = k ∧
      r.about = about := by
  simp [candidates, and_assoc]

theorem isNewest_iff : isNewest admits releasers rs r = true ↔
    ((r ∈ rs ∧ takes admits releasers r = true) ∧ counts admits releasers rs r = true) ∧
      ∀ s ∈ rs, takes admits releasers s = true → s.kind = r.kind → s.about = r.about →
        counts admits releasers rs s = true → newer s r = false := by
  simp only [isNewest, Bool.and_eq_true, List.contains_iff_mem, mem_candidates, List.all_eq_true,
    Bool.not_eq_true', and_true, and_imp, Bool.and_eq_false_iff]
  constructor
  · rintro ⟨a, b⟩
    refine ⟨a, fun s ms ts ks as cs => ?_⟩
    rcases b s ms ts ks as with h | h
    · simp [cs] at h
    · exact h
  · rintro ⟨a, b⟩
    exact ⟨a, fun s ms ts ks as => by
      cases cs : counts admits releasers rs s
      · exact .inl rfl
      · exact .inr (b s ms ts ks as cs)⟩

theorem counts_set (h : ∀ x, x ∈ rs ↔ x ∈ rs') : counts admits releasers rs = counts admits releasers rs' := by
  funext r
  apply Bool.eq_iff_iff.mpr
  simp only [counts, Bool.or_eq_true, List.all_eq_true, mem_candidates, h]

/-- **`newest_set`:** holding the same records, in any order, gives the same newest one. -/
theorem newest_set (h : ∀ x, x ∈ rs ↔ x ∈ rs') :
    isNewest admits releasers rs = isNewest admits releasers rs' := by
  funext r
  apply Bool.eq_iff_iff.mpr
  simp only [isNewest_iff, h, counts_set h]

/-- **`newest_signed`:** the newest record about a device was signed by it; a release's by a release signer. -/
theorem newest_signed (h : isNewest admits releasers rs r = true) :
    (r.kind = .release ∧ releasers r.signer = true) ∨ (r.kind ≠ .release ∧ r.signer = r.about) := by
  have t := ((isNewest_iff.mp h).1).1.2
  unfold takes at t
  cases e : r.kind <;> simp_all

/-- **`newest_agree`:** two newest records of one kind about one device say the same thing, at the same place. -/
theorem newest_agree (h : isNewest admits releasers rs r = true) (h' : isNewest admits releasers rs r' = true)
    (k : r'.kind = r.kind) (a : r'.about = r.about) :
    r.generation = r'.generation ∧ r.counter = r'.counter ∧ r.body = r'.body := by
  have n₁ := (isNewest_iff.mp h).2 r' (isNewest_iff.mp h').1.1.1 (isNewest_iff.mp h').1.1.2 k a
    (isNewest_iff.mp h').1.2
  have n₂ := (isNewest_iff.mp h').2 r (isNewest_iff.mp h).1.1.1 (isNewest_iff.mp h).1.1.2 k.symm a.symm
    (isNewest_iff.mp h).1.2
  simp only [newer, Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne,
    ne_eq] at n₁ n₂
  omega

/-- **`newest_grows`:** a record newest among more records is no older than one newest among fewer, while the one
newest among fewer still counts among more: a split arriving later is the only thing that takes it back (A4). -/
theorem newest_grows (sub : ∀ x ∈ rs, x ∈ rs') (h : isNewest admits releasers rs r = true)
    (still : counts admits releasers rs' r = true)
    (h' : isNewest admits releasers rs' r' = true) (k : r'.kind = r.kind) (a : r'.about = r.about) :
    r.generation < r'.generation ∨ (r.generation = r'.generation ∧ r.counter ≤ r'.counter) := by
  have n := (isNewest_iff.mp h').2 r (sub r (isNewest_iff.mp h).1.1.1) (isNewest_iff.mp h).1.1.2 k.symm a.symm
    still
  simp only [newer, Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne,
    ne_eq] at n
  omega

/-- **`split_final`:** two different history records of one signer at one place, held by a peer: no record of that
generation at or after that place is ever newest for it, however many more records it learns. -/
theorem split_final {s t : PeerRecord} (hist : s.kind.history = true) (ms : s ∈ rs) (mt : t ∈ rs)
    (ts : takes admits releasers s = true) (tt : takes admits releasers t = true) (kt : t.kind = s.kind)
    (at_ : t.about = s.about) (gt : t.generation = s.generation) (place : s.counter = t.counter)
    (differ : s.body ≠ t.body) (sub : ∀ x ∈ rs, x ∈ rs') {r : PeerRecord} (kr : r.kind = s.kind)
    (ar : r.about = s.about) (gr : r.generation = s.generation) (late : s.counter ≤ r.counter) :
    isNewest admits releasers rs' r = false := by
  cases e : isNewest admits releasers rs' r
  · rfl
  · exfalso
    have c := (isNewest_iff.mp e).1.2
    simp only [counts, kr, hist, Bool.not_true, Bool.false_or, List.all_eq_true, mem_candidates, ar] at c
    have := c s ⟨sub s ms, ts, rfl, rfl⟩ t ⟨sub t mt, tt, kt, at_⟩
    simp [place, differ, gt, gr] at this
    omega

/-- **`split_spares_next`:** a split ends its own generation, not the device: a record counts whenever no two records
of its own generation split at or before its place, whatever other generations hold. -/
theorem split_spares_next (r : PeerRecord)
    (clean : ∀ s ∈ candidates admits releasers r.kind r.about rs, ∀ t ∈ candidates admits releasers r.kind r.about rs,
      s.generation = r.generation → t.generation = r.generation → s.counter = t.counter → s.body = t.body) :
    counts admits releasers rs r = true := by
  simp only [counts, Bool.or_eq_true, List.all_eq_true]
  right
  intro s ms t mt
  simp only [Bool.not_eq_true', Bool.and_eq_false_iff, beq_eq_false_iff_ne, ne_eq, decide_eq_false_iff_not,
    bne_eq_false_iff_eq]
  by_cases g : s.generation = r.generation
  · by_cases g' : t.generation = r.generation
    · by_cases c : s.counter = t.counter
      · exact .inr (clean s ms t mt g g' c)
      · exact .inl (.inl (.inr c))
    · exact .inl (.inl (.inl (.inr g')))
  · exact .inl (.inl (.inl (.inl g)))

/-- `newest` finds the newest record when there is one. -/
theorem newest_isNewest {k : RecordKind} {about : String}
    (h : newest admits releasers k about rs = some r) : isNewest admits releasers rs r = true ∧ r.kind = k ∧
      r.about = about := by
  have := List.find?_some h
  have m := List.mem_of_find?_eq_some h
  exact ⟨this, (mem_candidates.mp m).2.2.1, (mem_candidates.mp m).2.2.2⟩

/-! ## The wire version (§7) -/

/-- A peer speaks to another only on its own wire version: anything else is refused with `update`. -/
def speaks (mine theirs : Nat) : Bool := mine == theirs

/-- **`speaks_same`:** no fallback: a peer speaks exactly one wire version. -/
theorem speaks_same {mine theirs : Nat} : speaks mine theirs = true ↔ theirs = mine := by
  simp only [speaks, beq_iff_eq]
  exact ⟨Eq.symm, Eq.symm⟩

/-! ## Examples -/

namespace RecordExamples

def admitted (k : String) : Bool := k == "alice-peer" || k == "bob-peer"
def releaseSigners (k : String) : Bool := k == "release-signer"

def records : List PeerRecord :=
  [⟨.address, "alice-peer", "alice-peer", 0, 1, 10⟩,
   ⟨.address, "alice-peer", "alice-peer", 0, 3, 30⟩,
   -- the Aven Peer passing on its own word about Alice: not taken
   ⟨.address, "alice-peer", "aven-peer", 0, 9, 90⟩,
   -- a split: Alice's Peer signed two addresses at one place in its log; from there on nothing of that generation
   -- counts (A4), so its address is the one before
   ⟨.address, "alice-peer", "alice-peer", 0, 3, 20⟩,
   -- Bob's Peer split its first generation and re-homed in its second: the second's counts (A42)
   ⟨.address, "bob-peer", "bob-peer", 0, 2, 21⟩, ⟨.address, "bob-peer", "bob-peer", 0, 2, 22⟩,
   ⟨.address, "bob-peer", "bob-peer", 1, 0, 100⟩,
   -- a stranger's beat: not taken
   ⟨.presence, "mallory-peer", "mallory-peer", 0, 5, 1⟩,
   ⟨.presence, "bob-peer", "bob-peer", 0, 7, 1⟩,
   -- Bob's log tips are history: a split at 4 leaves the tip before it
   ⟨.logTip, "bob-peer", "bob-peer", 0, 3, 33⟩, ⟨.logTip, "bob-peer", "bob-peer", 0, 4, 44⟩,
   ⟨.logTip, "bob-peer", "bob-peer", 0, 4, 45⟩,
   ⟨.release, "aven", "release-signer", 0, 2, 202⟩,
   ⟨.release, "aven", "bob-peer", 0, 5, 505⟩]

#guard newest admitted releaseSigners .address "alice-peer" records ==
  some ⟨.address, "alice-peer", "alice-peer", 0, 1, 10⟩
#guard newest admitted releaseSigners .address "alice-peer" records.reverse ==
  some ⟨.address, "alice-peer", "alice-peer", 0, 1, 10⟩
#guard newest admitted releaseSigners .address "bob-peer" records == some ⟨.address, "bob-peer", "bob-peer", 1, 0, 100⟩
#guard newest admitted releaseSigners .logTip "bob-peer" records == some ⟨.logTip, "bob-peer", "bob-peer", 0, 3, 33⟩
#guard newest admitted releaseSigners .presence "mallory-peer" records == none
#guard newest admitted releaseSigners .presence "bob-peer" records ==
  some ⟨.presence, "bob-peer", "bob-peer", 0, 7, 1⟩
#guard newest admitted releaseSigners .release "aven" records ==
  some ⟨.release, "aven", "release-signer", 0, 2, 202⟩
#guard newest admitted releaseSigners .treeTip "bob-peer" records == none

end RecordExamples

end Records
end Aven.ID
