import Aven.Core

/-! # Revocations and acks

A revocation ends a cap and every cap resting on it, and wins over what it had not seen (`id/caps/README.md`,
rule 14). An envelope is `Aven.Core`'s, named by `nm`, and its past is Core's `Reaches`, which `Aven.Core.Past` decides.
Caps reads three things of it, as the docs layer hands them from inside its seal (`Reads`): the vault it writes for,
the ids of the cap chain it writes under (every link, root first, so revoking any link reaches it), and the
revocations it acknowledges. A Doc is the list of envelopes a reader holds.

A revocation lives in the Doc, as one of its envelopes, when it ends a cap on that Doc. Otherwise it lives elsewhere
(a cap on a vault's Docs, a group, a device's removal) and reaches the Doc through its kept list, when its revoker held
the Doc, or through another writer's ack. The verdict:

- an envelope whose deps aren't all here **waits**, naming them by hash (`waits_named`);
- a revoked holder's envelope that had seen the revocation never counts, whatever anyone acknowledges: no laundering
  (`seen_never_counts`). Having seen it means, in Core's past, that the revocation's envelope is before it, or that it
  or something in its past acknowledges the revocation (`saw_iff`);
- under a Doc cap, only the revocation's own past is kept (`doc_cap_kept`);
- elsewhere, once the revocation has reached the Doc, only what its kept list or another writer's ack had seen counts
  (`elsewhere_kept`).

`revocation_wins` is the three together.

**A delete** (A22, Samuel, 31 Oct 2026: the right to be forgotten). A vault deletes a Doc by a Record in it: an
envelope its own vault writes on its own authority, which caps reads as a delete. Once a reader holds one, an envelope
counts only if it is the delete or in its past: the Doc ends where its vault ended it, and nothing written after it or
beside it counts, whatever cap it writes under (`delete_ends`). Until a reader holds one, a delete changes nothing
(`undeleted_survive`). It depends on the envelopes named, never on the order they came in, so readers holding the same
deletes, and the same past of each, agree (`deleted_agree`). What a reader had seen can't be unseen (rule 15):
forgetting is each device's, dropping the Doc's keys and bytes. The keeper's half is `Keep`'s (`Books.deleted_gone`).
-/

namespace Aven.ID

open Aven.Core Aven.Core.Past

/-- What caps reads of an envelope, from inside its seal. -/
structure Reads where
  /-- The vault it writes for. -/
  vault : Envelope → String
  /-- The ids of the caps it writes under, every link, root first. -/
  caps : Envelope → List Hash
  /-- The revocations it acknowledges. -/
  acks : Envelope → List Hash

/-- A revocation of `cap`: living in the Doc as the envelope named `envelope`, or elsewhere, with a kept list of names
for this Doc when its revoker held it. -/
structure Revocation where
  id : Hash
  cap : Hash
  envelope : Option Hash := none
  kept : Option (List Hash) := none
  deriving DecidableEq, Repr

section

variable (nm : Envelope → Hash) (rd : Reads)

/-- `e` had seen `r`: `r`'s envelope is before `e`, or `e` or something before it acknowledges `r`. -/
def saw (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  (match r.envelope with
   | some x => (past nm doc e).contains x
   | none => false) ||
  (rd.acks e).contains r.id ||
  doc.any fun y => inPast nm doc e y && (rd.acks y).contains r.id

/-- The envelopes of the Doc from other vaults that acknowledge `r`. -/
def ackers (doc : List Envelope) (e : Envelope) (r : Revocation) : List Envelope :=
  doc.filter fun a => (rd.acks a).contains r.id && rd.vault a != rd.vault e

/-- `r` has reached the Doc: it lives in it, its revoker kept a list for it, or another writer acknowledges it. -/
def effective (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  r.envelope.isSome || r.kept.isSome || !(ackers rd doc e r).isEmpty

/-- `r` keeps `e`: under a Doc cap, `e` is before the revocation's envelope; elsewhere, its kept list names `e` or
another writer's ack had seen it. -/
def keptBy (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  match r.envelope with
  | some x => doc.any fun y => nm y == x && inPast nm doc y e
  | none => (r.kept.getD []).contains (nm e) || (ackers rd doc e r).any fun a => inPast nm doc a e

/-- `r` ends `e`: `e` writes under the revoked cap, and either had seen `r` or isn't kept by it once it took effect. -/
def rejects (doc : List Envelope) (e : Envelope) (r : Revocation) : Bool :=
  (rd.caps e).contains r.cap && (saw nm rd doc e r || (effective rd doc e r && !keptBy nm rd doc e r))

inductive Verdict where
  | counts
  | revoked (revocation : Hash)
  | waits (missing : List Hash)
  deriving DecidableEq, Repr

/-- What `e` builds on that isn't here, by name. -/
def missing (doc : List Envelope) (e : Envelope) : List Hash :=
  (parents e).filter fun d => !doc.any (nm · == d)

/-- The authorized verdict of `e`, with the revocations `rs` the reader holds. -/
def verdict (doc : List Envelope) (rs : List Revocation) (e : Envelope) : Verdict :=
  match missing nm doc e with
  | [] =>
    match rs.find? (rejects nm rd doc e) with
    | some r => .revoked r.id
    | none => .counts
  | m => .waits m

variable {nm rd} {doc : List Envelope} {rs : List Revocation} {e : Envelope}

/-- Having seen a revocation, in Core's past: its envelope is before `e`, or `e` or something in its past acknowledges
it. -/
theorem saw_iff {r : Revocation} : saw nm rd doc e r = true ↔
    (∃ x, r.envelope = some x ∧ ∃ y ∈ doc, nm y = x ∧ Before nm doc e y) ∨
      ∃ y, Reaches nm doc e y ∧ r.id ∈ rd.acks y := by
  have acked : ((rd.acks e).contains r.id || doc.any fun y => inPast nm doc e y && (rd.acks y).contains r.id) = true ↔
      ∃ y, Reaches nm doc e y ∧ r.id ∈ rd.acks y := by
    simp only [Bool.or_eq_true, List.contains_iff_mem, List.any_eq_true, Bool.and_eq_true]
    constructor
    · rintro (h | ⟨y, m, p, a⟩)
      · exact ⟨e, .refl _, h⟩
      · exact ⟨y, reaches_iff.mpr (.inr ((inPast_iff m).mp p)), a⟩
    · rintro ⟨y, p, a⟩
      rcases reaches_iff.mp p with rfl | b
      · exact .inl a
      · exact .inr ⟨y, b.mem, (inPast_iff b.mem).mpr b, a⟩
  rw [saw, Bool.or_assoc, Bool.or_eq_true, acked]
  cases hx : r.envelope with
  | none => simp
  | some x => simp only [found_iff]; simp

theorem counts_kept (h : verdict nm rd doc rs e = .counts) : ∀ r ∈ rs, rejects nm rd doc e r = false := by
  unfold verdict at h
  split at h
  · split at h
    · contradiction
    · rename_i n
      intro r m
      simpa using List.find?_eq_none.mp n r m
  · contradiction

/-- No laundering: a revoked holder's envelope that had seen its revocation never counts. -/
theorem seen_never_counts {r : Revocation} (m : r ∈ rs) (hit : r.cap ∈ rd.caps e) (s : saw nm rd doc e r = true) :
    verdict nm rd doc rs e ≠ .counts := by
  intro h
  have := counts_kept h r m
  simp [rejects, s] at this
  exact this hit

/-- Under a Doc cap, only the revocation's own past is kept: no other writer's ack can add to it. -/
theorem doc_cap_kept {r : Revocation} {x : Hash} (m : r ∈ rs) (hit : r.cap ∈ rd.caps e) (lives : r.envelope = some x)
    (he : e ∈ doc) (h : verdict nm rd doc rs e = .counts) : ∃ y ∈ doc, nm y = x ∧ Before nm doc y e := by
  have := counts_kept h r m
  simp only [rejects, effective, keptBy, lives, Option.isSome_some, Bool.true_or, Bool.true_and, Bool.and_eq_false_iff,
    Bool.or_eq_false_iff, Bool.not_eq_false', List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at this
  rcases this with no | ⟨_, y, my, rfl, p⟩
  · rw [List.contains_iff_mem.mpr hit] at no
    cases no
  · exact ⟨y, my, rfl, (inPast_iff he).mp p⟩

/-- Elsewhere, once the revocation has reached the Doc, only what its kept list or another writer's ack had seen
counts. -/
theorem elsewhere_kept {r : Revocation} (m : r ∈ rs) (hit : r.cap ∈ rd.caps e) (lives : r.envelope = none)
    (reached : effective rd doc e r = true) (he : e ∈ doc) (h : verdict nm rd doc rs e = .counts) :
    nm e ∈ r.kept.getD [] ∨ ∃ a ∈ ackers rd doc e r, Before nm doc a e := by
  have := counts_kept h r m
  simp only [rejects, reached, keptBy, lives, Bool.true_and, Bool.or_eq_false_iff, Bool.not_eq_false',
    Bool.or_eq_true, List.any_eq_true, List.contains_iff_mem, Bool.and_eq_false_iff] at this
  rcases this with no | ⟨_, k⟩
  · rw [List.contains_iff_mem.mpr hit] at no
    cases no
  · rcases k with k | ⟨a, ma, p⟩
    · exact .inl k
    · exact .inr ⟨a, ma, (inPast_iff he).mp p⟩

/-- Revocation wins over what it had not seen (rule 14): the three rules together. -/
theorem revocation_wins {r : Revocation} (m : r ∈ rs) (hit : r.cap ∈ rd.caps e) (he : e ∈ doc)
    (h : verdict nm rd doc rs e = .counts) :
    saw nm rd doc e r = false ∧
      (∀ x, r.envelope = some x → ∃ y ∈ doc, nm y = x ∧ Before nm doc y e) ∧
      (r.envelope = none → effective rd doc e r = true →
        nm e ∈ r.kept.getD [] ∨ ∃ a ∈ ackers rd doc e r, Before nm doc a e) := by
  refine ⟨?_, fun x l => doc_cap_kept m hit l he h, fun l r' => elsewhere_kept m hit l r' he h⟩
  cases s : saw nm rd doc e r
  · rfl
  · exact absurd h (seen_never_counts m hit s)

/-- A wait names only what the envelope builds on and the reader lacks, by hash, so it can end. -/
theorem waits_named {ms : List Hash} (h : verdict nm rd doc rs e = .waits ms) :
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ parents e ∧ ∀ y ∈ doc, nm y ≠ d := by
  unfold verdict at h
  split at h
  · split at h <;> contradiction
  · rename_i m n
    cases h
    refine ⟨n, fun d dm => ?_⟩
    simp only [missing, List.mem_filter, Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at dm
    exact dm

end

/-! ## A delete (A22) -/

section

variable (nm : Envelope → Hash) (rd : Reads)

/-- The deletes a reader holds of a Doc: the envelopes that read as a delete (`isDelete`) and that the Doc's vault
wrote on its own authority (`byOwner`: caps' `Reader.Own`, never an actor host's). -/
def deletesOf (isDelete byOwner : Envelope → Bool) (doc : List Envelope) : List Envelope :=
  doc.filter fun d => isDelete d && byOwner d

/-- `e` survives the deletes a reader holds: it is each of them, or in its past. -/
def survives (isDelete byOwner : Envelope → Bool) (doc : List Envelope) (e : Envelope) : Bool :=
  (deletesOf isDelete byOwner doc).all fun d => nm d == nm e || inPast nm doc d e

/-- Caps' liveness with the deletes a reader holds: the revocations' verdict counts it, and it survives every delete. -/
def liveWith (isDelete byOwner : Envelope → Bool) (doc : List Envelope) (rs : List Revocation) (e : Envelope) :
    Bool :=
  verdict nm rd doc rs e == .counts && survives nm isDelete byOwner doc e

variable {nm rd} {isDelete byOwner : Envelope → Bool} {doc doc' : List Envelope} {d e : Envelope}

/-- What `liveWith` says, read through this lemma rather than its definition: the revocations' verdict counts it, and it
survives every delete the reader holds. -/
theorem liveWith_iff {rs : List Revocation} :
    liveWith nm rd isDelete byOwner doc rs e = true ↔
      verdict nm rd doc rs e = .counts ∧ survives nm isDelete byOwner doc e = true := by
  simp only [liveWith, Bool.and_eq_true, beq_iff_eq]

/-- **A delete ends the Doc** (A22): once a reader holds a delete its vault wrote, an envelope survives only if it is
the delete, or in its past. Nothing written after it, or beside it, counts, whatever cap it writes under. -/
theorem delete_ends (hd : d ∈ doc) (del : isDelete d = true) (own : byOwner d = true) (he : e ∈ doc)
    (s : survives nm isDelete byOwner doc e = true) : nm d = nm e ∨ Before nm doc d e := by
  simp only [survives, deletesOf, List.all_eq_true, List.mem_filter, Bool.and_eq_true, Bool.or_eq_true,
    beq_iff_eq] at s
  rcases s d ⟨hd, del, own⟩ with eq | p
  · exact .inl eq
  · exact .inr ((inPast_iff he).mp p)

/-- Until a reader holds a delete its vault wrote, a delete changes nothing: a delete by anyone else is no delete. -/
theorem undeleted_survive (none : ∀ d ∈ doc, isDelete d = true → byOwner d = false) :
    survives nm isDelete byOwner doc e = true := by
  simp only [survives, deletesOf, List.all_eq_true, List.mem_filter, Bool.and_eq_true]
  intro d ⟨m, del, own⟩
  rw [none d m del] at own
  cases own

/-- **Readers agree on a delete**: two readers that hold the same deletes, and the same past of each, give every
envelope the same survival, whatever else each holds and in whatever order it came. -/
theorem deleted_agree (same : ∀ d, d ∈ deletesOf isDelete byOwner doc ↔ d ∈ deletesOf isDelete byOwner doc')
    (past : ∀ d ∈ deletesOf isDelete byOwner doc, inPast nm doc d e = inPast nm doc' d e) :
    survives nm isDelete byOwner doc e = survives nm isDelete byOwner doc' e := by
  apply Bool.eq_iff_iff.mpr
  simp only [survives, List.all_eq_true]
  constructor
  · intro h d m
    have m' := (same d).mpr m
    rw [← past d m']
    exact h d m'
  · intro h d m
    rw [past d m]
    exact h d ((same d).mp m)

end

/-! ## Examples, on Core's envelopes

Each example envelope is a Core envelope named as Core names it, by BLAKE3 of its encoding, and carries what caps
reads of it in its body: the vault it writes for, the caps it writes under, the revocations it acknowledges, and its
signed time (`Aven.ID.Expiry`). Names go through BLAKE3 and UTF-8, so the verdicts are checked as the module builds. -/

namespace RevokeExamples

open Aven.Core (Envelope Hash Bytes Value DocId blake3)

def utf8 (s : String) : Bytes := s.toUTF8.toList

/-- Core's name: BLAKE3 of the envelope's encoding. -/
def nm : Envelope → Hash := Envelope.name blake3

def capA : Hash := blake3 (utf8 "cap-a")
def capB : Hash := blake3 (utf8 "cap-b")
def capTeam : Hash := blake3 (utf8 "cap-team")
def revA : Hash := blake3 (utf8 "rev-a")
def revT : Hash := blake3 (utf8 "rev-t")
/-- A name no envelope here has. -/
def zz : Hash := blake3 (utf8 "zz")

def notes : DocId := ⟨blake3 (utf8 "the notes' genesis")⟩

/-- An example envelope at its writer's place `seq`, with its label, vault, caps, acks and signed time in its body,
and, for a delete Record, `delete`. It names what it builds on as deps, never as prev, so its past is what it lists. -/
def env (writer seq : Nat) (label vault : String) (caps acks deps : List Hash) (time : Nat := 0)
    (delete : Bool := false) : Envelope :=
  { doc := notes, branch := utf8 "main", writer, seq, prev := none, deps,
    body := .map ([(utf8 "acks", .array (acks.map Hash.value)), (utf8 "caps", .array (caps.map Hash.value)),
      (utf8 "time", .uint time), (utf8 "label", .text (utf8 label)), (utf8 "vault", .text (utf8 vault))] ++
      if delete then [(utf8 "delete", .bool true)] else []),
    sigs := [⟨utf8 vault, []⟩] }

private def field (e : Envelope) (key : String) : Option Value :=
  match e.body with
  | .map kvs => (kvs.find? (·.1 == utf8 key)).map (·.2)
  | _ => none

private def hashes : Option Value → List Hash
  | some (.array vs) => vs.filterMap fun | .bytes b => some ⟨b⟩ | _ => none
  | _ => []

/-- What caps reads of an example envelope: its body's vault, caps and acks. -/
def reads : Reads :=
  { vault := fun e => match field e "vault" with | some (.text b) => String.fromUTF8! ⟨b.toArray⟩ | _ => "",
    caps := fun e => hashes (field e "caps"), acks := fun e => hashes (field e "acks") }

/-- Its signed time, its writer's claim. -/
def time (e : Envelope) : Nat :=
  match field e "time" with
  | some (.uint n) => n
  | _ => 0

/-- Its label, for the vectors. -/
def label (e : Envelope) : String :=
  match field e "label" with
  | some (.text b) => String.fromUTF8! ⟨b.toArray⟩
  | _ => ""

/-! A Doc cap revoked inside the Doc: `r0` is Alice's revocation of `cap-a`, after `b1`. -/

def b1 : Envelope := env 2 1 "b1" "bob" [capA] [] []
def r0 : Envelope := env 1 1 "r0" "alice" [] [] [nm b1]
def b2 : Envelope := env 2 2 "b2" "bob" [capA] [] [nm r0]
def b3 : Envelope := env 2 3 "b3" "bob" [capA] [] [nm b1]
def a1 : Envelope := env 1 2 "a1" "alice" [] [revA] [nm b3]
def c1 : Envelope := env 3 1 "c1" "maia-city" [capA, capB] [] [nm b1]

def docCapDoc : List Envelope := [b1, r0, b2, b3, a1, c1]

def docCapRevocations : List Revocation := [⟨revA, capA, some (nm r0), none⟩]

/-! A cap on a vault's Docs, revoked elsewhere and acknowledged here by Alice's `y1`. -/

def x1 : Envelope := env 2 1 "x1" "bob" [capTeam] [] []
def x2 : Envelope := env 2 2 "x2" "bob" [capTeam] [] [nm x1]
def y1 : Envelope := env 1 1 "y1" "alice" [] [revT] [nm x1]
def x3 : Envelope := env 2 3 "x3" "bob" [capTeam] [] [nm y1]
def y2 : Envelope := env 1 2 "y2" "alice" [] [revT] [nm x3]
def w1 : Envelope := env 2 4 "w1" "bob" [] [] [zz]

def elsewhereDoc : List Envelope := [x1, x2, y1, x3, y2, w1]

def elsewhereRevocations : List Revocation := [⟨revT, capTeam, none, none⟩]

/-- The same revocation, with its revoker's kept list naming `x1`. -/
def keptRevocations : List Revocation := [⟨revT, capTeam, none, some [nm x1]⟩]

/-! Bob's own ack of the revocation of his cap. -/

def x5 : Envelope := env 2 5 "x5" "bob" [capTeam] [] []
def y3 : Envelope := env 2 6 "y3" "bob" [] [revT] [nm x5]

/-- Verdicts, each written out by hand: a Doc, the revocations held, the envelope, and its verdict. -/
def revocationExamples : List (String × List Envelope × List Revocation × Envelope × Verdict) := [
  ("under a Doc cap, what the revocation had seen counts", docCapDoc, docCapRevocations, b1, .counts),
  ("written after seeing the revocation", docCapDoc, docCapRevocations, b2, .revoked revA),
  ("concurrent with the revocation: not in its past", docCapDoc, docCapRevocations, b3, .revoked revA),
  ("under a Doc cap, a later ack keeps nothing more", docCapDoc, docCapRevocations, b3, .revoked revA),
  ("revoking a cap ends what rests on it", docCapDoc, docCapRevocations, c1, .revoked revA),
  ("not under the revoked cap", docCapDoc, docCapRevocations, a1, .counts),
  ("elsewhere: an ack had seen it", elsewhereDoc, elsewhereRevocations, x1, .counts),
  ("elsewhere: no ack had seen it", elsewhereDoc, elsewhereRevocations, x2, .revoked revT),
  ("no laundering: written after an ack, acknowledged again later", elsewhereDoc, elsewhereRevocations, x3,
    .revoked revT),
  ("before any ack reaches the Doc, it still counts", elsewhereDoc.take 2, elsewhereRevocations, x2, .counts),
  ("a kept list keeps what it names", elsewhereDoc.take 2, keptRevocations, x1, .counts),
  ("and nothing else", elsewhereDoc.take 2, keptRevocations, x2, .revoked revT),
  ("the holder's own ack keeps nothing it wrote", [x5, y3], elsewhereRevocations, x5, .counts),
  ("waiting for what it builds on, named by hash", elsewhereDoc, elsewhereRevocations, w1, .waits [zz])]

#guard revocationExamples.all fun (_, doc, rs, e, v) => verdict nm reads doc rs e == v

/-! Alice deletes the notes, after Alice's `n1` and Bob's `m1`. Bob writes `m2` beside the delete, Alice's other device
writes `n2` after it, and Bob writes a delete as well, which is no delete: the notes are Alice's. -/

/-- A delete Record, as caps reads one from inside the seal. -/
def isDelete (e : Envelope) : Bool := field e "delete" == some (.bool true)

/-- On the notes' vault's own authority: Alice's. -/
def byAlice (e : Envelope) : Bool := reads.vault e == "alice"

def n1 : Envelope := env 1 10 "n1" "alice" [] [] []
def m1 : Envelope := env 2 10 "m1" "bob" [capA] [] [nm n1]
def del : Envelope := env 1 11 "del" "alice" [] [] [nm m1] (delete := true)
def m2 : Envelope := env 2 11 "m2" "bob" [capA] [] [nm m1]
def n2 : Envelope := env 1 12 "n2" "alice" [] [] [nm del]
def bobsDelete : Envelope := env 2 12 "bobs-delete" "bob" [capA] [] [nm m2] (delete := true)

def deletedDoc : List Envelope := [n1, m1, del, m2, n2, bobsDelete]

/-- Whether each envelope survives the deletes held, each answer written out by hand. -/
def deleteExamples : List (String × List Envelope × Envelope × Bool) := [
  ("before the delete, Alice's own", deletedDoc, n1, true),
  ("before the delete, Bob's under cap-a", deletedDoc, m1, true),
  ("the delete itself", deletedDoc, del, true),
  ("beside the delete: not in its past", deletedDoc, m2, false),
  ("after the delete, by Alice's own device", deletedDoc, n2, false),
  ("a delete by someone else, after it", deletedDoc, bobsDelete, false),
  ("without Alice's delete, Bob's changes nothing", [n1, m1, m2, bobsDelete], m2, true)]

#guard deleteExamples.all fun (_, doc, e, b) => survives nm isDelete byAlice doc e == b

end RevokeExamples

end Aven.ID
