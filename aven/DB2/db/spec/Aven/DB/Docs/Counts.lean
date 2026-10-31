import Aven.DB.Docs.Loro

/-!
# What counts: writer ids and three verdicts

An envelope counts when its whole past is held (Core's `Closed`, rule 11), it is **fit**, **authorized** and **not a
split**, and everything it builds on counts (docs, rule 13; caps, "Checking"). Fit is judged once and never turns; authorized can turn when a revocation arrives; a split
is found when its other half does. The live state of a branch is the replay of what counts.

A **writer id** is worked out from the signing device, the Doc, the branch and the generation (docs, rule 8). The model
takes the derivation as a parameter that doesn't collide, the hash assumption; the vectors use the real one.

What it proves:
- `counts_verdicts`: what counts is fit, authorized and no half of a split, and so is all it builds on;
- `revocation_narrows`: a narrower authorization never makes more count;
- `split_final`: a split found is never undone by learning more;
- `writer_ids_distinct`, `ops_are_signers`: distinct devices, Docs, branches or generations write as distinct writer
  ids, so an envelope whose ops all carry its signer's writer id holds no other device's op.
-/

namespace Aven.DB.Docs

open Aven.Core

/-- The verdicts beside "not a split": whether an envelope fits its schemas, whether its signer may write it, and
whether a revocation the reader holds discounts it (A182). -/
structure Verdicts where
  fit : Envelope → Prop
  authorized : Envelope → Prop
  revoked : Envelope → Prop

/-- An envelope counts, among `S`, named by `H`. -/
def counts (H : Bytes → Hash) (v : Verdicts) (S : List Envelope) (e : Envelope) : Prop :=
  Counts (Envelope.name H) v.fit v.authorized v.revoked S e

theorem counts_verdicts {H : Bytes → Hash} {v : Verdicts} {S : List Envelope} {e x : Envelope}
    (h : counts H v S e) (hx : Reaches (Envelope.name H) S e x) :
    v.fit x ∧ v.authorized x ∧ ¬ v.revoked x ∧ ∀ y ∈ S, ¬ Split (Envelope.name H) x y :=
  let ⟨⟨⟨f, a⟩, r⟩, s⟩ := h.2 x hx; ⟨f, a, r, s⟩

/-- A revocation only narrows what is authorized, so it only narrows what counts. -/
theorem revocation_narrows {H : Bytes → Hash} {fit a a' rv : Envelope → Prop} (ha : ∀ x, a' x → a x)
    {S : List Envelope} {e : Envelope} (h : counts H ⟨fit, a', rv⟩ S e) : counts H ⟨fit, a, rv⟩ S e := by
  refine ⟨h.1, fun x hx => ?_⟩
  obtain ⟨⟨⟨f, ax⟩, r⟩, s⟩ := h.2 x hx
  exact ⟨⟨⟨f, ha x ax⟩, r⟩, s⟩

/-- A split found among `S` is never undone by more envelopes (A4). -/
theorem split_final {H : Bytes → Hash} {v : Verdicts} {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S')
    {e : Envelope} (h : Discounted (Envelope.name H) S e) : ¬ counts H v S' e :=
  Aven.Core.split_final (Envelope.name H) hs h

open Classical in
/-- A branch's live state: the replay of the envelopes that count. A verdict that turns rebuilds it from them. -/
noncomputable def live {St : Type} (L : Loro St) (H : Bytes → Hash) (v : Verdicts) (S : List Envelope) : St :=
  L.replay (S.filter fun e => decide (counts H v S e))

/-! ## Counts, decided

What a reader runs: an envelope's past from Core's `Past` (`inPast`, which decides `Reaches`), and each envelope of it
checked against the verdicts and every envelope held for a split. `countsB` is exactly `Counts` (`countsB_iff`). -/

/-- Two envelopes split, decided. -/
def splitB (nm : Envelope → Hash) (a b : Envelope) : Bool :=
  a.doc == b.doc && a.branch == b.branch && a.writer == b.writer && a.seq == b.seq && nm a != nm b

theorem splitB_iff {nm : Envelope → Hash} {a b : Envelope} : splitB nm a b = true ↔ Split nm a b := by
  simp only [splitB, Bool.and_eq_true, beq_iff_eq, bne_iff_ne, Split, SameLog, and_assoc]

/-- An envelope counts, decided: Core's `countsB`. Its whole past is held, it and everything in its past are fit and
authorized and not revoked, and none of them is half of a split. -/
def countsB (nm : Envelope → Hash) (fit authorized revoked : Envelope → Bool) (S : List Envelope) (e : Envelope) :
    Bool :=
  Aven.Core.countsB nm fit authorized revoked S e

theorem countsB_iff {nm : Envelope → Hash} {fit authorized revoked : Envelope → Bool} {S : List Envelope}
    {e : Envelope} :
    countsB nm fit authorized revoked S e = true ↔
      Counts nm (fun x => fit x = true) (fun x => authorized x = true) (fun x => revoked x = true) S e :=
  Aven.Core.countsB_iff

/-! ## Writer ids -/

structure WriterIn where
  device : Bytes
  doc : DocId
  branch : Bytes
  generation : Nat
  deriving DecidableEq

/-- Distinct inputs give distinct writer ids, when the derivation doesn't collide. -/
theorem writer_ids_distinct {wid : WriterIn → Nat} (hw : ∀ a b, wid a = wid b → a = b) {a b : WriterIn}
    (h : a ≠ b) : wid a ≠ wid b :=
  fun e => h (hw a b e)

/-- The import check: every op of the changes carries the writer id of the device that placed the envelope (the key
whose signature `Envelope.placed` takes) for this Doc, branch and generation. -/
def opsOk (wid : WriterIn → Nat) (e : Envelope) (device : Bytes) (generation : Nat) (ops : List Nat) : Bool :=
  ops.all (· == wid ⟨device, e.doc, e.branch, generation⟩)

/-- Past the check, an op is no other device's, Doc's, branch's or generation's. -/
theorem ops_are_signers {wid : WriterIn → Nat} (hw : ∀ a b, wid a = wid b → a = b) {e : Envelope} {d : Bytes}
    {g : Nat} {ops : List Nat} (h : opsOk wid e d g ops = true) {x : Nat} (hx : x ∈ ops) {i : WriterIn}
    (hi : wid i = x) : i = ⟨d, e.doc, e.branch, g⟩ := by
  simp only [opsOk, List.all_eq_true, beq_iff_eq] at h
  exact hw _ _ (hi.trans (h x hx))

end Aven.DB.Docs
