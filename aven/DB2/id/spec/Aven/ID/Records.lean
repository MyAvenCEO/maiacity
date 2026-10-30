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

Each carries a counter, and a newer one replaces an older one. What a record says is opaque here, named by its hash as
a number (`body`): only which record is newest matters to the rules. Each kind signs under a label of its own
(`RecordKind.label`, `Aven.Core.signingBytes`), so a record of one kind is never read as another's.

The theorems:
- `newest_set`: which record is newest depends only on the set of records a peer holds, not their order;
- `newest_signed`: the newest record about a device was signed by that device (a release's by a release signer), so
  no peer's word stands in for it;
- `newest_agree`: two records that are both newest say the same thing. Two records with the same counter and
  different bodies are a split (A4), and the smaller body is taken everywhere;
- `newest_grows`: holding more records never makes the newest one older;
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

/-- A record: its kind, the device it is about (a release's: the name of the release line), who signed it, its counter
and what it says, by hash. -/
structure PeerRecord where
  kind : RecordKind
  about : String
  signer : String
  counter : Nat
  body : Nat
  deriving DecidableEq, Repr

/-- A record a peer takes: a release signed by a release signer, or any other kind signed by the device it is about,
which the door admits. Its signature was checked as it came (`Aven.Core.Signed.valid`). -/
def takes (admits releasers : String → Bool) (r : PeerRecord) : Bool :=
  match r.kind with
  | .release => releasers r.signer
  | _ => r.signer == r.about && admits r.signer

/-- `a` is newer than `b`: a larger counter, or the same counter and a smaller body. -/
def newer (a b : PeerRecord) : Bool := b.counter < a.counter || (a.counter == b.counter && a.body < b.body)

/-- The records a peer takes of one kind about one device. -/
def candidates (admits releasers : String → Bool) (k : RecordKind) (about : String) (rs : List PeerRecord) :
    List PeerRecord :=
  rs.filter fun r => takes admits releasers r && r.kind == k && r.about == about

/-- `r` is the newest record of its kind about its device among `rs`: no other one taken is newer. -/
def isNewest (admits releasers : String → Bool) (rs : List PeerRecord) (r : PeerRecord) : Bool :=
  (candidates admits releasers r.kind r.about rs).contains r &&
    (candidates admits releasers r.kind r.about rs).all fun s => !newer s r

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
    (r ∈ rs ∧ takes admits releasers r = true) ∧
      ∀ s ∈ rs, takes admits releasers s = true → s.kind = r.kind → s.about = r.about →
        newer s r = false := by
  simp only [isNewest, Bool.and_eq_true, List.contains_iff_mem, mem_candidates, List.all_eq_true,
    Bool.not_eq_true', and_true, and_imp]

/-- **`newest_set`:** holding the same records, in any order, gives the same newest one. -/
theorem newest_set (h : ∀ x, x ∈ rs ↔ x ∈ rs') :
    isNewest admits releasers rs = isNewest admits releasers rs' := by
  funext r
  apply Bool.eq_iff_iff.mpr
  simp only [isNewest_iff, h]

/-- **`newest_signed`:** the newest record about a device was signed by it; a release's by a release signer. -/
theorem newest_signed (h : isNewest admits releasers rs r = true) :
    (r.kind = .release ∧ releasers r.signer = true) ∨ (r.kind ≠ .release ∧ r.signer = r.about) := by
  have t := ((isNewest_iff.mp h).1).2
  unfold takes at t
  cases e : r.kind <;> simp_all

/-- **`newest_agree`:** two newest records of one kind about one device say the same thing, with the same counter. -/
theorem newest_agree (h : isNewest admits releasers rs r = true) (h' : isNewest admits releasers rs r' = true)
    (k : r'.kind = r.kind) (a : r'.about = r.about) : r.counter = r'.counter ∧ r.body = r'.body := by
  have n₁ := (isNewest_iff.mp h).2 r' (isNewest_iff.mp h').1.1 (isNewest_iff.mp h').1.2 k a
  have n₂ := (isNewest_iff.mp h').2 r (isNewest_iff.mp h).1.1 (isNewest_iff.mp h).1.2 k.symm a.symm
  simp only [newer, Bool.or_eq_false_iff, decide_eq_false_iff_not, Bool.and_eq_false_iff, beq_eq_false_iff_ne,
    ne_eq] at n₁ n₂
  omega

/-- **`newest_grows`:** a record newest among more records is no older than one newest among fewer. -/
theorem newest_grows (sub : ∀ x ∈ rs, x ∈ rs') (h : isNewest admits releasers rs r = true)
    (h' : isNewest admits releasers rs' r' = true) (k : r'.kind = r.kind) (a : r'.about = r.about) :
    r.counter ≤ r'.counter := by
  have n := (isNewest_iff.mp h').2 r (sub r (isNewest_iff.mp h).1.1) (isNewest_iff.mp h).1.2 k.symm a.symm
  simp only [newer, Bool.or_eq_false_iff, decide_eq_false_iff_not] at n
  omega

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
  [⟨.address, "alice-peer", "alice-peer", 1, 10⟩,
   ⟨.address, "alice-peer", "alice-peer", 3, 30⟩,
   -- the Aven Peer passing on its own word about Alice: not taken
   ⟨.address, "alice-peer", "aven-peer", 9, 90⟩,
   -- a split: Alice's Peer signed two addresses with one counter; the smaller body is taken everywhere
   ⟨.address, "alice-peer", "alice-peer", 3, 20⟩,
   -- a stranger's beat: not taken
   ⟨.presence, "mallory-peer", "mallory-peer", 5, 1⟩,
   ⟨.presence, "bob-peer", "bob-peer", 7, 1⟩,
   ⟨.logTip, "bob-peer", "bob-peer", 4, 44⟩,
   ⟨.release, "aven", "release-signer", 2, 202⟩,
   ⟨.release, "aven", "bob-peer", 5, 505⟩]

#guard newest admitted releaseSigners .address "alice-peer" records ==
  some ⟨.address, "alice-peer", "alice-peer", 3, 20⟩
#guard newest admitted releaseSigners .address "alice-peer" records.reverse ==
  some ⟨.address, "alice-peer", "alice-peer", 3, 20⟩
#guard newest admitted releaseSigners .presence "mallory-peer" records == none
#guard newest admitted releaseSigners .presence "bob-peer" records == some ⟨.presence, "bob-peer", "bob-peer", 7, 1⟩
#guard newest admitted releaseSigners .release "aven" records == some ⟨.release, "aven", "release-signer", 2, 202⟩
#guard newest admitted releaseSigners .treeTip "bob-peer" records == none

end RecordExamples

end Records
end Aven.ID
