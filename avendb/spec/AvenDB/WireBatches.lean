import AvenDB.Batches

/-!
# Paths on the wire (P8)

V5 proves that a signed root and a path up to it authenticate an edit exactly as the edit's own signature does. This
file proves the same once edits travel and are kept that way: one signature per edit leaves the wire.

A device holds each signer's part of an edit one of two ways (`Held`): the signer's signature on it, as every edit
held before batches keeps, or a path up to a root of the signer's log that the signer signed (`Proof`), kept with the
edit for good, so it checks again after a restart as a signature does. A reply sends each part as it is held, but a
root once: the reply carries a table of roots (`table`), each root in it once (`table_nodup`), and a path names its
root by its place in it (`Sent`, `strip`). That is the saving. ML-DSA-65's 3,309 bytes and its check go once per
root and page, where they went once per edit; a path is a few hundred bytes and checks at hashing speed.

The receiver puts each part back as it was held (`reassemble`), and refuses an edit any part of which names no root
of the table. It then checks each part as V5 checks it (`checkHeld`): a signature on the edit, or a path to a root of
the signer's log that the signer signed while the signer isn't frozen. So it takes exactly the edits of the signers'
logs (`takes_wire`), and so exactly what a device sent every signature takes (`V5_wire_takes_as_today`): it knows the
same, the same edits stand, and it holds the same edits on a checkpoint's word. The paths the sender holds come back as
they were (`reassemble_strip`), so the receiver can send them on in its turn, to a peer that reads paths.

Old apps read signatures alone for one release. A device sends an old app only the edits it holds every part of as a
signature (`toOld`), which check there exactly as today (`old_checks_as_today`). A device that asks for signatures
alone holds every edit that way and so serves every edit it holds to an old app (`signatures_serve_all`): the server
does so for one release.

What a path shows beyond a signature: the length of its signer's log at the root, so how many edits that device
signed by then, in every vault, and the edit's place in it. A root is in the reply only beside an edit that names its
signer, as the signature it replaces would be.
-/

namespace AvenDB.WireBatches

open Batches

/-- How a device holds one signer's part of an edit: the signer's signature on it, or a path up to a root of the
    signer's log, with that root (`batch::Proof`). -/
inductive Held where
  | sig
  | proof (pr : Proof)
  deriving DecidableEq, Repr

/-- How one part travels: the signature itself, or a path and the place of its root in the reply's table of roots. -/
inductive Sent where
  | sig
  | path (place : Nat) (path : List (Bool × Digest))
  deriving DecidableEq, Repr

/-- The roots each part held by a path names, edit by edit, signer by signer. -/
def named (held : EditId → SignerId → Held) (edits : List Edit) : List Root :=
  edits.flatMap fun o => o.sigs.filterMap fun s =>
    match held o.id s with
    | .proof pr => some pr.root
    | .sig => none

/-- The reply's table of roots: each root `rs` names, once. -/
def table (rs : List Root) : List Root := rs.foldr List.insert []

theorem mem_table {rs : List Root} {r : Root} : r ∈ table rs ↔ r ∈ rs := by
  induction rs with
  | nil => simp [table]
  | cons a rs ih =>
    simp only [table, List.foldr_cons] at ih ⊢
    rw [List.mem_insert_iff, ih, List.mem_cons]

/-- Each root goes once, however many edits of its batch the reply holds. -/
theorem table_nodup (rs : List Root) : (table rs).Nodup := by
  induction rs with
  | nil => exact List.nodup_nil
  | cons a rs ih =>
    simp only [table, List.foldr_cons] at ih ⊢
    unfold List.insert
    split
    · exact ih
    · next h => exact List.nodup_cons.2 ⟨by simpa using h, ih⟩

/-- A part as it travels: a path names its root by its place in the table `tbl`. -/
def strip (tbl : List Root) : Held → Sent
  | .sig => .sig
  | .proof pr => .path (tbl.idxOf pr.root) pr.path

/-- A part as the receiver holds it again: a path takes the root at its place, none if the table holds none there. -/
def reassemble (tbl : List Root) : Sent → Option Held
  | .sig => some .sig
  | .path i p => tbl[i]?.map fun r => .proof ⟨r, p⟩

/-- A part whose root the table holds comes back as it was held. -/
theorem reassemble_strip {tbl : List Root} {h : Held} (hm : ∀ pr, h = .proof pr → pr.root ∈ tbl) :
    reassemble tbl (strip tbl h) = some h := by
  cases h with
  | sig => rfl
  | proof pr =>
    have hr := hm pr rfl
    simp only [strip, reassemble]
    rw [List.getElem?_eq_getElem (List.idxOf_lt_length_of_mem hr)]
    simp [List.getElem_idxOf]

/-- The table of a reply holds the root of every part held by a path. -/
theorem named_mem {held : EditId → SignerId → Held} {edits : List Edit} {o : Edit} (ho : o ∈ edits) {s : SignerId}
    (hs : s ∈ o.sigs) {pr : Proof} (hp : held o.id s = .proof pr) : pr.root ∈ table (named held edits) := by
  refine mem_table.2 (List.mem_flatMap.2 ⟨o, ho, List.mem_filterMap.2 ⟨s, hs, ?_⟩⟩)
  rw [hp]

/-- What a device checks of one part, as V5 checks it: a signature on the edit, or a path up to a root of the signer's
    log that the signer signed, while the signer isn't frozen. -/
def checkHeld (signs : SignerId → Said → Bool) (rs : List Root) (s : SignerId) (e : EditId) : Held → Bool
  | .sig => signs s (.edit e)
  | .proof pr => !frozen signs rs s && pr.shows signs s e

/-- The paths a part brings, as V5 takes them. -/
def proofsOf : Held → List Proof
  | .sig => []
  | .proof pr => [pr]

/-- A part that checks is one V5 checks. -/
theorem checkHeld_check {signs : SignerId → Said → Bool} {rs : List Root} {s : SignerId} {e : EditId} {h : Held}
    (hc : checkHeld signs rs s e h = true) : check signs rs (fun _ _ => proofsOf h) s e = true := by
  cases h with
  | sig => simp only [checkHeld] at hc; simp [check, hc]
  | proof pr => simp only [checkHeld, Bool.and_eq_true] at hc; simp [check, proofsOf, hc.1, hc.2]

/-- A part is sound: the signature it is, or the path it is, shows its signer signed the edit. -/
def Sound (signs : SignerId → Said → Bool) (s : SignerId) (e : EditId) : Held → Prop
  | .sig => signs s (.edit e) = true
  | .proof pr => pr.shows signs s e = true

/-- What a device takes of a reply: each edit every part of which comes back from the table and checks. -/
def wireAuth (signs : SignerId → Said → Bool) (rs : List Root) (tbl : List Root) (sent : EditId → SignerId → Sent)
    (s : SignerId) (e : EditId) : Bool :=
  match reassemble tbl (sent e s) with
  | some h => checkHeld signs rs s e h
  | none => false

/-- A device sent the parts `held` holds of `edits`, each root once, takes exactly the edits of their signers' logs,
    where every signer keeps one log and each part of an edit of its log is sound. -/
theorem takes_wire {signs : SignerId → Said → Bool} {L : SignerId → List EditId} {f : SignerId → Nat}
    (hk : ∀ s, Keeps signs s (L s) (f s)) (rs : List Root) {held : EditId → SignerId → Held} {edits : List Edit}
    (hv : ∀ o ∈ edits, ∀ s ∈ o.sigs, o.id ∈ L s → Sound signs s o.id (held o.id s)) :
    let tbl := table (named held edits)
    Batches.takes (wireAuth signs rs tbl fun e s => strip tbl (held e s)) edits = Batches.takes (fun s e => (L s).contains e) edits := by
  intro tbl
  unfold Batches.takes
  refine List.filter_congr fun o ho => ?_
  have back : ∀ s ∈ o.sigs, reassemble tbl (strip tbl (held o.id s)) = some (held o.id s) := fun s hs =>
    reassemble_strip fun pr hp => named_mem ho hs hp
  refine Bool.eq_iff_iff.2 ⟨fun h => ?_, fun h => ?_⟩
  · refine List.all_eq_true.2 fun s hs => ?_
    have hc := List.all_eq_true.1 h s hs
    simp only [wireAuth, back s hs] at hc
    exact List.contains_iff_mem.2 (check_sound (hk s) rs _ (checkHeld_check hc))
  · refine List.all_eq_true.2 fun s hs => ?_
    have hl := List.contains_iff_mem.1 (List.all_eq_true.1 h s hs)
    simp only [wireAuth, back s hs]
    have hs' := hv o ho s hs hl
    cases hh : held o.id s with
    | sig => rw [hh] at hs'; exact hs'
    | proof pr => rw [hh] at hs'; simp only [Sound] at hs'; simp [checkHeld, frozen_keeps (hk s) rs, hs']

/-- V5 on the wire: where every signer keeps one log, signing its edits one by one, roots of its log in batches of any
    size, or both, a device sent each part of each edit of their logs as it is held, a signature or a path, each root
    once, takes exactly the edits a device sent every signature takes (`today`, as in `V5_batches_check_the_same`). -/
theorem V5_wire_takes_as_today {signs today : SignerId → Said → Bool} {L : SignerId → List EditId}
    {f : SignerId → Nat} (hk : ∀ s, Keeps signs s (L s) (f s))
    (ht : ∀ s e, today s (.edit e) = (L s).contains e) (rs : List Root) {held : EditId → SignerId → Held}
    {edits : List Edit} (hv : ∀ o ∈ edits, ∀ s ∈ o.sigs, o.id ∈ L s → Sound signs s o.id (held o.id s)) :
    let tbl := table (named held edits)
    Batches.takes (wireAuth signs rs tbl fun e s => strip tbl (held e s)) edits =
      Batches.takes (check today [] fun _ _ => []) edits := by
  intro tbl
  rw [takes_wire hk rs hv]
  unfold Batches.takes
  refine List.filter_congr fun o _ => ?_
  simp [check_no_paths, ht]

/-- A part that names a place the table holds no root at is refused, and so is its edit. -/
theorem refused_unplaced {signs : SignerId → Said → Bool} {rs tbl : List Root} {sent : EditId → SignerId → Sent}
    {s : SignerId} {e : EditId} {i : Nat} {p : List (Bool × Digest)} (hs : sent e s = .path i p) (hi : tbl.length ≤ i) :
    wireAuth signs rs tbl sent s e = false := by
  simp [wireAuth, hs, reassemble, List.getElem?_eq_none hi]

/-! ## Old apps -/

/-- An edit an old app reads: every part of it a signature. -/
def legacy (held : EditId → SignerId → Held) (o : Edit) : Bool := o.sigs.all fun s => held o.id s == .sig

/-- What a device sends an old app of `edits`: those it holds as signatures alone. -/
def toOld (held : EditId → SignerId → Held) (edits : List Edit) : List Edit := edits.filter (legacy held)

/-- What an old app is sent checks there exactly as today: each part a signature, checked with no path at all. -/
theorem old_checks_as_today (signs : SignerId → Said → Bool) (rs : List Root) {held : EditId → SignerId → Held}
    {edits : List Edit} {o : Edit} (ho : o ∈ toOld held edits) {s : SignerId} (hs : s ∈ o.sigs) :
    checkHeld signs rs s o.id (held o.id s) = check signs rs (fun _ _ => []) s o.id := by
  have hl := (List.mem_filter.1 ho).2
  have h : held o.id s = .sig := by simpa using List.all_eq_true.1 hl s hs
  rw [h, check_no_paths]
  rfl

/-- A device that asks for signatures alone holds every part as a signature, so it serves every edit it holds to an old
    app: the server does so for one release. -/
theorem signatures_serve_all {held : EditId → SignerId → Held} (h : ∀ e s, held e s = .sig) (edits : List Edit) :
    toOld held edits = edits := by
  unfold toOld legacy
  exact List.filter_eq_self.2 fun o _ => List.all_eq_true.2 fun s _ => by simp [h]

/-! ## Scenarios -/

namespace Examples

open Batches.Examples

def edit (i : EditId) : Edit := { id := i, depth := 0, author := 7, cosigners := [], action := .settings 0 (.threshold 1) }

/-- Three edits of the batch of five, held by paths to the root over all five. -/
def held : EditId → SignerId → Held := fun e _ =>
  match five.idxOf e with
  | i => if i < 5 then .proof ⟨r5, path five i⟩ else .sig

def page : List Edit := [edit 11, edit 13, edit 15]

-- one root goes for three edits
#guard (table (named held page)).length == 1
-- each part comes back as it was held, and each checks
#guard page.all fun o => reassemble (table (named held page)) (strip (table (named held page)) (held o.id 7)) == some (held o.id 7)
#guard page.all fun o => wireAuth signsOne [r5] (table (named held page)) (fun e s => strip (table (named held page)) (held e s)) 7 o.id
-- a path that names a place with no root is refused
#guard !wireAuth signsOne [r5] [] (fun _ _ => .path 0 (path five 0)) 7 11
-- the clone's root freezes the signer: its paths check no more
#guard !wireAuth signsTwo [r3, r5, r4'] (table (named held page)) (fun e s => strip (table (named held page)) (held e s)) 7 11
-- an old app is sent only what is held as signatures
#guard toOld held page == [] && toOld (fun _ _ => .sig) page == page

end Examples

end AvenDB.WireBatches
