import Aven.Core.Signed

/-!
# Envelopes, logs, splits and versions (rules 2 and 3, A3, A4)

An **envelope** is the one signed unit of change. It names its place in its writer's **log** (its Doc, its branch, its
writer id and its sequence number), the envelope before it in that log by hash, and the tips of the other logs it
builds on by hash: never a counter alone (rule 2). What it carries beyond that is each part's own (`body`).

A **split** is a writer signing two different envelopes at one place of its log. Splits are final: an envelope whose
past holds a split never counts, for any reader, however many more envelopes it learns of (A4).

What it proves:
- `chain_no_split`, `chains_agree`: a log read as a chain holds no split, and two readers' chains of one log agree
  wherever both hold it unless there is a split between them;
- `reaches_mono`, `split_final`: more envelopes never undo a split;
- `counts_past`: what an envelope that counts builds on counts too;
- `Version.holds_mono`: a version holds more as more arrives, never less.
-/

namespace Aven.Core

structure Envelope where
  doc : DocId
  branch : Bytes
  writer : Nat
  seq : Nat
  prev : Option Hash
  deps : List Hash
  body : Value
  signer : Bytes
  sig : Bytes

def optHash : Option Hash → Value
  | none => .null
  | some h => h.value

private def k (s : String) : Bytes := s.toUTF8.toList

/-- What the writer signs: everything but the signature, keys in the codec's order. -/
def Envelope.unsigned (e : Envelope) : Value :=
  .map [(k "doc", .bytes e.doc.hash.bytes), (k "seq", .uint e.seq), (k "body", e.body),
    (k "deps", .array (e.deps.map Hash.value)), (k "prev", optHash e.prev), (k "branch", .text e.branch),
    (k "signer", .bytes e.signer), (k "writer", .uint e.writer)]

/-- The whole envelope, signature included: what its name hashes. -/
def Envelope.value (e : Envelope) : Value :=
  .map [(k "doc", .bytes e.doc.hash.bytes), (k "seq", .uint e.seq), (k "sig", .bytes e.sig), (k "body", e.body),
    (k "deps", .array (e.deps.map Hash.value)), (k "prev", optHash e.prev), (k "branch", .text e.branch),
    (k "signer", .bytes e.signer), (k "writer", .uint e.writer)]

def envelopeLabel : Bytes := k "avenDB envelope 1"

def Envelope.signing (e : Envelope) : Bytes := signingBytes envelopeLabel e.unsigned

def Envelope.valid (verify : Verify) (e : Envelope) : Bool := verify e.signer e.signing e.sig

def Envelope.name (H : Bytes → Hash) (e : Envelope) : Hash := nameOf H e.value

#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 none [] .null [] []).value with | .map kvs => kvs | _ => [])
#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 none [] .null [] []).unsigned with | .map kvs => kvs | _ => [])

theorem optHash_inj : ∀ {a b : Option Hash}, optHash a = optHash b → a = b
  | none, none, _ => rfl
  | some _, none, h => by simp [optHash, Hash.value] at h
  | none, some _, h => by simp [optHash, Hash.value] at h
  | some ⟨_⟩, some ⟨_⟩, h => by simp_all [optHash, Hash.value]

theorem hashes_inj : ∀ {a b : List Hash}, a.map Hash.value = b.map Hash.value → a = b
  | [], [], _ => rfl
  | [], _ :: _, h => by simp at h
  | _ :: _, [], h => by simp at h
  | ⟨x⟩ :: xs, ⟨y⟩ :: ys, h => by
    simp only [List.map_cons, List.cons.injEq, Hash.value, Value.bytes.injEq] at h
    rw [hashes_inj h.2, h.1]

theorem Envelope.value_inj {a b : Envelope} (h : a.value = b.value) : a = b := by
  obtain ⟨⟨⟨da⟩⟩, bra, wa, sa, pa, dsa, ba, sga, sia⟩ := a
  obtain ⟨⟨⟨db⟩⟩, brb, wb, sb, pb, dsb, bb, sgb, sib⟩ := b
  simp only [Envelope.value, Value.map.injEq, List.cons.injEq, Prod.mk.injEq, Value.bytes.injEq, Value.uint.injEq,
    Value.array.injEq, Value.text.injEq, true_and, and_true] at h
  obtain ⟨hd, hs, hg, hb, hdeps, hp, hbr, hsg, hw⟩ := h
  rw [optHash_inj hp, hashes_inj hdeps]
  subst hd hs hg hb hbr hsg hw
  rfl

/-- Two well-formed envelopes with one name are one envelope. -/
theorem Envelope.name_inj {H : Bytes → Hash} (hH : Injective H) {a b : Envelope} (ha : Canon a.value = true)
    (hb : Canon b.value = true) (h : a.name H = b.name H) : a = b :=
  Envelope.value_inj (nameOf_inj hH ha hb h)

/-! ## Logs and splits

The model is parametric in how envelopes are named, `nm`; the theorems that need names to be collision-free assume
it of `nm`, which `Envelope.name_inj` gives for well-formed envelopes under an injective hash. -/

variable (nm : Envelope → Hash)

/-- Two envelopes of one log: one Doc, one branch, one writer id. -/
def SameLog (a b : Envelope) : Prop := a.doc = b.doc ∧ a.branch = b.branch ∧ a.writer = b.writer

/-- Two different envelopes at one place of one log (A4). -/
def Split (a b : Envelope) : Prop := SameLog a b ∧ a.seq = b.seq ∧ nm a ≠ nm b

theorem Split.symm {a b : Envelope} (h : Split nm a b) : Split nm b a :=
  ⟨⟨h.1.1.symm, h.1.2.1.symm, h.1.2.2.symm⟩, h.2.1.symm, fun e => h.2.2 e.symm⟩

/-- `a` builds directly on `b`: `b` is the envelope before it in its log, or a tip it names. -/
def BuildsOn (a b : Envelope) : Prop := a.prev = some (nm b) ∨ nm b ∈ a.deps

/-- `b` is in `a`'s past, through envelopes of `S`. -/
inductive Reaches (S : List Envelope) : Envelope → Envelope → Prop
  | refl (a : Envelope) : Reaches S a a
  | step {a b c : Envelope} : b ∈ S → BuildsOn nm a b → Reaches S b c → Reaches S a c

/-- An envelope's past, itself included, holds half of a split. -/
def Discounted (S : List Envelope) (e : Envelope) : Prop :=
  ∃ x y, Reaches nm S e x ∧ y ∈ S ∧ Split nm x y

/-- An envelope counts when everything in its past passes the other verdicts (`ok`: fit and authorized) and none of it
is half of a split (docs, rule 13). -/
def Counts (ok : Envelope → Prop) (S : List Envelope) (e : Envelope) : Prop :=
  ∀ x, Reaches nm S e x → ok x ∧ ∀ y ∈ S, ¬ Split nm x y

theorem reaches_trans {S : List Envelope} {a b c : Envelope} (h₁ : Reaches nm S a b) (h₂ : Reaches nm S b c) :
    Reaches nm S a c := by
  induction h₁ with
  | refl => exact h₂
  | step hb hab _ ih => exact .step hb hab (ih h₂)

theorem reaches_mono {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S') {a b : Envelope} (h : Reaches nm S a b) :
    Reaches nm S' a b := by
  induction h with
  | refl => exact .refl _
  | step hb hab _ ih => exact .step (hs _ hb) hab ih

/-- What an envelope that counts builds on counts too. -/
theorem counts_past {ok : Envelope → Prop} {S : List Envelope} {e x : Envelope} (h : Counts nm ok S e)
    (hx : Reaches nm S e x) : Counts nm ok S x :=
  fun y hy => h y (reaches_trans nm hx hy)

theorem discounted_not_counts {ok : Envelope → Prop} {S : List Envelope} {e : Envelope} (h : Discounted nm S e) :
    ¬ Counts nm ok S e := by
  intro hc
  obtain ⟨x, y, hx, hy, hs⟩ := h
  exact (hc x hx).2 y hy hs

/-- Splits are final: once an envelope's past holds a split, no reader that learns more ever counts it (A4). -/
theorem split_final {ok : Envelope → Prop} {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S') {e : Envelope}
    (h : Discounted nm S e) : ¬ Counts nm ok S' e := by
  obtain ⟨x, y, hx, hy, hsp⟩ := h
  exact discounted_not_counts nm ⟨x, y, reaches_mono nm hs hx, hs y hy, hsp⟩

/-! ## A log read as a chain -/

/-- A log as one reader holds it: its envelopes from the first, each at its place and naming the one before. -/
def IsChain (c : List Envelope) : Prop :=
  ∀ (i : Nat) (h : i < c.length),
    SameLog c[i] c[0] ∧ c[i].seq = i + 1 ∧
      c[i].prev = (if h0 : i = 0 then none else some (nm (c[i - 1]'(by omega))))

/-- A chain holds no split. -/
theorem chain_no_split {c : List Envelope} (hc : IsChain nm c)
    {a b : Envelope} (ha : a ∈ c) (hb : b ∈ c) : ¬ Split nm a b := by
  intro ⟨_, hs, hn⟩
  obtain ⟨i, hi, rfl⟩ := List.getElem_of_mem ha
  obtain ⟨j, hj, rfl⟩ := List.getElem_of_mem hb
  have := (hc i hi).2.1
  have := (hc j hj).2.1
  have hij : i = j := by omega
  subst hij
  exact hn rfl

/-- Two readers' chains of one log agree wherever both hold it, unless a split lies between them. -/
theorem chains_agree (hnm : ∀ a b, nm a = nm b → a = b) {c₁ c₂ : List Envelope} (h₁ : IsChain nm c₁)
    (h₂ : IsChain nm c₂) (h₀ : ∀ (p : 0 < c₁.length) (q : 0 < c₂.length), SameLog c₁[0] c₂[0])
    (hns : ∀ a ∈ c₁, ∀ b ∈ c₂, ¬ Split nm a b) (i : Nat) (hi₁ : i < c₁.length) (hi₂ : i < c₂.length) :
    c₁[i] = c₂[i] := by
  have ⟨l₁, s₁, _⟩ := h₁ i hi₁
  have ⟨l₂, s₂, _⟩ := h₂ i hi₂
  have l₀ := h₀ (by omega) (by omega)
  have same : SameLog c₁[i] c₂[i] :=
    ⟨l₁.1.trans (l₀.1.trans l₂.1.symm), l₁.2.1.trans (l₀.2.1.trans l₂.2.1.symm),
      l₁.2.2.trans (l₀.2.2.trans l₂.2.2.symm)⟩
  have hn := hns _ (List.getElem_mem hi₁) _ (List.getElem_mem hi₂)
  apply hnm
  apply Classical.byContradiction
  intro hne
  exact hn ⟨same, by omega, hne⟩

/-! ## Versions -/

/-- A version: a set of envelopes with everything they build on, named by its tips. -/
abbrev Version := List Hash

/-- `e` is in version `v`: in the past of one of its tips. -/
def Version.holds (S : List Envelope) (v : Version) (e : Envelope) : Prop :=
  ∃ t ∈ S, nm t ∈ v ∧ Reaches nm S t e

/-- A version holds more as more arrives, never less. -/
theorem Version.holds_mono {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S') {v : Version} {e : Envelope}
    (h : Version.holds nm S v e) : Version.holds nm S' v e := by
  obtain ⟨t, ht, hv, hr⟩ := h
  exact ⟨t, hs t ht, hv, reaches_mono nm hs hr⟩

end Aven.Core
