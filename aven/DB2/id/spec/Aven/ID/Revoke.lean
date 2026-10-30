import Aven.ID.Past

/-! # Revocations and acks

A revocation ends a cap and every cap resting on it, and wins over what it had not seen (`id/caps/README.md`,
rule 14). An envelope is `Aven.Core`'s, named by `nm`, and its past is Core's `Reaches`, which `Aven.ID.Past` decides.
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

`revocation_wins` is the three together. -/

namespace Aven.ID

open Aven.Core Past

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
  (tips e).filter fun d => !doc.any (nm · == d)

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
    ms ≠ [] ∧ ∀ d ∈ ms, d ∈ tips e ∧ ∀ y ∈ doc, nm y ≠ d := by
  unfold verdict at h
  split at h
  · split at h <;> contradiction
  · rename_i m n
    cases h
    refine ⟨n, fun d dm => ?_⟩
    simp only [missing, List.mem_filter, Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at dm
    exact dm

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

/-- An example envelope at its writer's place `seq`, with its label, vault, caps, acks and signed time in its body. It
names what it builds on as deps, never as prev, so its past is what it lists. -/
def env (writer seq : Nat) (label vault : String) (caps acks deps : List Hash) (time : Nat := 0) : Envelope :=
  { doc := notes, branch := utf8 "main", writer, seq, prev := none, deps,
    body := .map [(utf8 "acks", .array (acks.map Hash.value)), (utf8 "caps", .array (caps.map Hash.value)),
      (utf8 "time", .uint time), (utf8 "label", .text (utf8 label)), (utf8 "vault", .text (utf8 vault))],
    signer := utf8 vault, sig := [] }

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

end RevokeExamples

end Aven.ID
