import Aven.DB.Docs.Loro

/-!
# What counts: writer ids and three verdicts

An envelope counts when it is **fit**, **authorized** and **not a split**, and everything it builds on counts (docs,
rule 13; caps, "Checking"). Fit is judged once and never turns; authorized can turn when a revocation arrives; a split
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

/-- The verdicts beside "not a split": whether an envelope fits its schemas, and whether its signer may write it. -/
structure Verdicts where
  fit : Envelope → Prop
  authorized : Envelope → Prop

/-- An envelope counts, among `S`, named by `H`. -/
def counts (H : Bytes → Hash) (v : Verdicts) (S : List Envelope) (e : Envelope) : Prop :=
  Counts (Envelope.name H) (fun x => v.fit x ∧ v.authorized x) S e

theorem counts_verdicts {H : Bytes → Hash} {v : Verdicts} {S : List Envelope} {e x : Envelope}
    (h : counts H v S e) (hx : Reaches (Envelope.name H) S e x) :
    v.fit x ∧ v.authorized x ∧ ∀ y ∈ S, ¬ Split (Envelope.name H) x y :=
  let ⟨⟨f, a⟩, s⟩ := h x hx; ⟨f, a, s⟩

/-- A revocation only narrows what is authorized, so it only narrows what counts. -/
theorem revocation_narrows {H : Bytes → Hash} {fit a a' : Envelope → Prop} (ha : ∀ x, a' x → a x)
    {S : List Envelope} {e : Envelope} (h : counts H ⟨fit, a'⟩ S e) : counts H ⟨fit, a⟩ S e := by
  intro x hx
  obtain ⟨⟨f, ax⟩, s⟩ := h x hx
  exact ⟨⟨f, ha x ax⟩, s⟩

/-- A split found among `S` is never undone by more envelopes (A4). -/
theorem split_final {H : Bytes → Hash} {v : Verdicts} {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S')
    {e : Envelope} (h : Discounted (Envelope.name H) S e) : ¬ counts H v S' e :=
  Aven.Core.split_final (Envelope.name H) hs h

open Classical in
/-- A branch's live state: the replay of the envelopes that count. A verdict that turns rebuilds it from them. -/
noncomputable def live {St : Type} (L : Loro St) (H : Bytes → Hash) (v : Verdicts) (S : List Envelope) : St :=
  L.replay (S.filter fun e => decide (counts H v S e))

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

/-- The import check: every op of the changes carries the signer's writer id for this Doc, branch and generation. -/
def opsOk (wid : WriterIn → Nat) (e : Envelope) (generation : Nat) (ops : List Nat) : Bool :=
  ops.all (· == wid ⟨e.signer, e.doc, e.branch, generation⟩)

/-- Past the check, an op is no other device's, Doc's, branch's or generation's. -/
theorem ops_are_signers {wid : WriterIn → Nat} (hw : ∀ a b, wid a = wid b → a = b) {e : Envelope} {g : Nat}
    {ops : List Nat} (h : opsOk wid e g ops = true) {x : Nat} (hx : x ∈ ops) {i : WriterIn} (hi : wid i = x) :
    i = ⟨e.signer, e.doc, e.branch, g⟩ := by
  simp only [opsOk, List.all_eq_true, beq_iff_eq] at h
  exact hw _ _ (hi.trans (h x hx))

end Aven.DB.Docs
