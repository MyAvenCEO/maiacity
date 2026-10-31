import Aven.Core.Signed

/-!
# Envelopes, logs, splits and versions (rules 2 and 3, A3, A4)

An **envelope** is the one signed unit of change. It names its place in its writer's **log** (its Doc, its branch, its
writer id and its sequence number), the envelope before it in that log by hash, and the tips of the other logs it
builds on by hash: never a counter alone (rule 2). What it carries beyond that is each part's own (`body`).

A **split** is a writer signing two different envelopes at one place of its log. Splits are final: an envelope whose
past holds a split never counts, for any reader, however many more envelopes it learns of (A4).

Its signatures sit beside its name (A30), a set that only grows: adding one never renames it (`Envelope.name_addSig`)
and is never a split (`addSig_no_split`). The log's writer's signature places it (`Envelope.placed`); the others are
approvals over the same bytes.

An envelope counts only once its whole past is held (`Closed`, rule 11).

What it proves:
- `Envelope.name_inj`: one name is one envelope, but for its signatures;
- `log_no_split`, `logs_agree`: a log as one reader holds it has no split, and two readers' copies of one log agree
  wherever both hold it unless there is a split between them;
- `reaches_mono`, `split_final`: more envelopes never undo a split;
- `counts_past`: what an envelope that counts builds on counts too;
- `closed_mono`: a whole past stays whole as more arrives;
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
  sigs : List Sig

def optHash : Option Hash → Value
  | none => .null
  | some h => h.value

private def k (s : String) : Bytes := s.toUTF8.toList

/-- The `prev` key: the envelope before, or left out in a log's first envelope, never null (A200). -/
def prevKey : Option Hash → List (Bytes × Value)
  | none => []
  | some h => [(k "prev", h.value)]

/-- What its signers sign: everything but the signatures, keys in the codec's order. -/
def Envelope.unsigned (e : Envelope) : Value :=
  .map ([(k "doc", .bytes e.doc.hash.bytes), (k "seq", .uint e.seq), (k "body", e.body),
    (k "deps", .array (e.deps.map Hash.value))] ++ prevKey e.prev ++ [(k "branch", .text e.branch),
    (k "writer", .uint e.writer)])

/-- The whole envelope, its signatures beside it, as it travels. Its name hashes only what is signed (A30). -/
def Envelope.value (e : Envelope) : Value :=
  .map ([(k "doc", .bytes e.doc.hash.bytes), (k "seq", .uint e.seq), (k "body", e.body),
    (k "deps", .array (e.deps.map Hash.value))] ++ prevKey e.prev ++ [(k "sigs", .array (e.sigs.map Sig.value)),
    (k "branch", .text e.branch), (k "writer", .uint e.writer)])

def envelopeLabel : Bytes := k "avenDB envelope 1"

def Envelope.signing (e : Envelope) : Bytes := signingBytes envelopeLabel e.unsigned

/-- Which keys write which envelope's log: a parameter, as `Verify` is. The docs layer supplies it from how it derives
a writer id (the device key, the Doc, the branch, the generation), and caps checks the key against the device cap. -/
abbrev Writes := (key : Bytes) → Envelope → Bool

/-- An envelope is placed in its log when a key that writes that log signed it: some signature's signer `writes` it
and verifies over its signing bytes. Every other signature is an approval over the same bytes. An envelope with no
such signature is nothing: a reader refuses it, so it is never held, never counts and is never half of a split. -/
def Envelope.placed (verify : Verify) (writes : Writes) (e : Envelope) : Bool :=
  e.sigs.any fun x => writes x.signer e && x.valid verify e.signing

/-- The signatures beside it that verify, the writer's among them: what approvals count. -/
def Envelope.approvals (verify : Verify) (e : Envelope) : List Sig := e.sigs.filter (Sig.valid verify e.signing)

/-- An envelope's name: the hash of exactly what its signers sign, `[label, everything but the signatures]`, so signing
one envelope again, by its writer or anyone, never makes two names (A30). -/
def Envelope.name (H : Bytes → Hash) (e : Envelope) : Hash := H e.signing

#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 none [] .null []).value with | .map kvs => kvs | _ => [])
#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 none [] .null []).unsigned with | .map kvs => kvs | _ => [])
#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 (some ⟨[]⟩) [] .null []).value with | .map kvs => kvs | _ => [])
#guard keysSorted (match (Envelope.mk ⟨⟨[]⟩⟩ [] 0 0 (some ⟨[]⟩) [] .null []).unsigned with
  | .map kvs => kvs | _ => [])

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

theorem sigs_inj : ∀ {a b : List Sig}, a.map Sig.value = b.map Sig.value → a = b
  | [], [], _ => rfl
  | [], _ :: _, h => by simp at h
  | _ :: _, [], h => by simp at h
  | ⟨x, x'⟩ :: xs, ⟨y, y'⟩ :: ys, h => by
    simp only [List.map_cons, List.cons.injEq, Sig.value, Value.map.injEq, Prod.mk.injEq, Value.bytes.injEq,
      true_and, and_true] at h
    obtain ⟨⟨rfl, rfl⟩, t⟩ := h
    rw [sigs_inj t]

theorem Envelope.value_inj {a b : Envelope} (h : a.value = b.value) : a = b := by
  obtain ⟨⟨⟨da⟩⟩, bra, wa, sa, pa, dsa, ba, sga⟩ := a
  obtain ⟨⟨⟨db⟩⟩, brb, wb, sb, pb, dsb, bb, sgb⟩ := b
  rcases pa with _ | ⟨⟨pa⟩⟩ <;> rcases pb with _ | ⟨⟨pb⟩⟩ <;>
    simp only [Envelope.value, prevKey, Hash.value, List.nil_append, List.cons_append, List.append_nil,
      Value.map.injEq, List.cons.injEq, Prod.mk.injEq, Value.bytes.injEq, Value.uint.injEq, Value.array.injEq,
      Value.text.injEq, reduceCtorEq, true_and, and_true, and_false] at h
  · obtain ⟨hd, hs, hb, hdeps, hsg, hbr, hw⟩ := h
    rw [hashes_inj hdeps, sigs_inj hsg]
    subst hd hs hb hbr hw
    rfl
  · obtain ⟨hd, hs, hb, hdeps, hp, hsg, hbr, hw⟩ := h
    rw [hashes_inj hdeps, sigs_inj hsg]
    subst hd hs hb hp hbr hw
    rfl

/-- What an envelope signs fixes everything but its signatures. -/
theorem Envelope.unsigned_inj {a b : Envelope} (h : a.unsigned = b.unsigned) : { a with sigs := b.sigs } = b := by
  obtain ⟨⟨⟨da⟩⟩, bra, wa, sa, pa, dsa, ba, sga⟩ := a
  obtain ⟨⟨⟨db⟩⟩, brb, wb, sb, pb, dsb, bb, sgb⟩ := b
  rcases pa with _ | ⟨⟨pa⟩⟩ <;> rcases pb with _ | ⟨⟨pb⟩⟩ <;>
    simp only [Envelope.unsigned, prevKey, Hash.value, List.nil_append, List.cons_append, List.append_nil,
      Value.map.injEq, List.cons.injEq, Prod.mk.injEq, Value.bytes.injEq, Value.uint.injEq, Value.array.injEq,
      Value.text.injEq, reduceCtorEq, true_and, and_true, and_false] at h
  · obtain ⟨hd, hs, hb, hdeps, hbr, hw⟩ := h
    rw [hashes_inj hdeps]
    subst hd hs hb hbr hw
    rfl
  · obtain ⟨hd, hs, hb, hdeps, hp, hbr, hw⟩ := h
    rw [hashes_inj hdeps]
    subst hd hs hb hp hbr hw
    rfl

theorem envelopeLabel_ok : textOk envelopeLabel = true := by decide +kernel

/-- Two well-formed envelopes with one name say the same thing: they differ at most in their signatures (A30). -/
theorem Envelope.name_inj {H : Bytes → Hash} (hH : Injective H) {a b : Envelope} (ha : Canon a.unsigned = true)
    (hb : Canon b.unsigned = true) (h : a.name H = b.name H) : { a with sigs := b.sigs } = b :=
  Envelope.unsigned_inj (signing_separates envelopeLabel_ok envelopeLabel_ok ha hb (hH _ _ h)).2

/-- An envelope's signatures never touch its name: a name never hangs on a signature (A30). -/
theorem Envelope.name_sigs (H : Bytes → Hash) (e : Envelope) (sigs : List Sig) :
    ({ e with sigs } : Envelope).name H = e.name H := rfl

/-- Adding a signature never renames an envelope. -/
theorem Envelope.name_addSig (H : Bytes → Hash) (e : Envelope) (x : Sig) :
    ({ e with sigs := addSig x e.sigs } : Envelope).name H = e.name H := rfl

/-- Adding a signature keeps an envelope placed: the set only grows. -/
theorem Envelope.placed_addSig {verify : Verify} {writes : Writes} {e : Envelope} (x : Sig)
    (hw : ∀ k, writes k { e with sigs := addSig x e.sigs } = writes k e) (h : e.placed verify writes = true) :
    ({ e with sigs := addSig x e.sigs } : Envelope).placed verify writes = true := by
  simp only [Envelope.placed, List.any_eq_true, Bool.and_eq_true, Sig.valid, Envelope.signing,
    Envelope.unsigned] at h ⊢
  obtain ⟨y, m, hy, hv⟩ := h
  exact ⟨y, addSig_mono x _ y m, by rw [hw]; exact hy, hv⟩

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

/-- An envelope signed again is no split: a split is two different bodies at one place, never two sets of signatures
over one (A4, A30). -/
theorem sigs_no_split (H : Bytes → Hash) (e : Envelope) (sigs : List Sig) :
    ¬ Split (Envelope.name H) e { e with sigs } :=
  fun h => h.2.2 (Envelope.name_sigs H e sigs).symm

/-- Adding a signature is never a split. -/
theorem addSig_no_split (H : Bytes → Hash) (e : Envelope) (x : Sig) :
    ¬ Split (Envelope.name H) e { e with sigs := addSig x e.sigs } :=
  sigs_no_split H e _

/-- `a` builds directly on `b`: `b` is the envelope before it in its log, or a tip it names. -/
def BuildsOn (a b : Envelope) : Prop := a.prev = some (nm b) ∨ nm b ∈ a.deps

/-- `b` is in `a`'s past, through envelopes of `S`. -/
inductive Reaches (S : List Envelope) : Envelope → Envelope → Prop
  | refl (a : Envelope) : Reaches S a a
  | step {a b c : Envelope} : b ∈ S → BuildsOn nm a b → Reaches S b c → Reaches S a c

/-- An envelope's whole past is held: every envelope it reaches, itself included, names as its prev and deps only
envelopes of `S` (rule 11: an envelope built on a parent a reader lacks waits, and counts for nothing until it comes). -/
def Closed (S : List Envelope) (e : Envelope) : Prop :=
  ∀ x, Reaches nm S e x → ∀ h, (x.prev = some h ∨ h ∈ x.deps) → ∃ y ∈ S, nm y = h

/-- An envelope's past, itself included, holds half of a split. -/
def Discounted (S : List Envelope) (e : Envelope) : Prop :=
  ∃ x y, Reaches nm S e x ∧ y ∈ S ∧ Split nm x y

/-- An envelope counts when its whole past is held (`Closed`), everything in it is `fit` and `authorized`, none of it is
`revoked` and none of it is half of a split (A4, A30, A45, A182). This is the one counting rule (A45): the docs layer,
avenID and the tree each supply their verdicts here, and none defines its own. `authorized` is a function of an envelope
and its own past (A147); `revoked` is avenCAPS', read from what the reader holds: a counted revocation of a cap in the
envelope's chain, taken effect in its Doc, whose kept past doesn't hold it (A182). Counting is not monotone in what a
reader holds, by design: a split or a revocation learned later discounts (A4, A182, `split_final`, `revoked_not_counts`),
and a parent learned later is the first step to counting (`closed_mono`). -/
def Counts (fit authorized revoked : Envelope → Prop) (S : List Envelope) (e : Envelope) : Prop :=
  Closed nm S e ∧ ∀ x, Reaches nm S e x → ((fit x ∧ authorized x) ∧ ¬ revoked x) ∧ ∀ y ∈ S, ¬ Split nm x y

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

theorem closed_past {S : List Envelope} {e x : Envelope} (h : Closed nm S e) (hx : Reaches nm S e x) :
    Closed nm S x :=
  fun y hy => h y (reaches_trans nm hx hy)

/-- What an envelope that counts builds on counts too. -/
theorem counts_past {fit authorized revoked : Envelope → Prop} {S : List Envelope} {e x : Envelope}
    (h : Counts nm fit authorized revoked S e) (hx : Reaches nm S e x) : Counts nm fit authorized revoked S x :=
  ⟨closed_past nm h.1 hx, fun y hy => h.2 y (reaches_trans nm hx hy)⟩

theorem discounted_not_counts {fit authorized revoked : Envelope → Prop} {S : List Envelope} {e : Envelope}
    (h : Discounted nm S e) : ¬ Counts nm fit authorized revoked S e := by
  intro hc
  obtain ⟨x, y, hx, hy, hs⟩ := h
  exact (hc.2 x hx).2 y hy hs

/-- A revocation discounts, as a split does (A182): an envelope whose past, itself included, holds a revoked envelope
doesn't count. -/
theorem revoked_not_counts {fit authorized revoked : Envelope → Prop} {S : List Envelope} {e x : Envelope}
    (hx : Reaches nm S e x) (h : revoked x) : ¬ Counts nm fit authorized revoked S e :=
  fun hc => (hc.2 x hx).1.2 h

/-- Two envelopes name the same parents. -/
def SameParents (a b : Envelope) : Prop := a.prev = b.prev ∧ a.deps = b.deps

/-- What a closed envelope reaches among more envelopes has the parents of something it reaches among `S`, when one
name is one set of parents (as `Envelope.name_inj` gives for well-formed envelopes under an injective hash). -/
theorem reaches_closed {S S' : List Envelope}
    (hp : ∀ a b, nm a = nm b → SameParents a b) {a c : Envelope} (h : Reaches nm S' a c) :
    ∀ a₀, SameParents a₀ a → Closed nm S a₀ → ∃ c₀, Reaches nm S a₀ c₀ ∧ SameParents c₀ c := by
  induction h with
  | refl a => exact fun a₀ e _ => ⟨a₀, .refl _, e⟩
  | @step a b c _ hab _ ih =>
    intro a₀ e hc
    have hb : a₀.prev = some (nm b) ∨ nm b ∈ a₀.deps := by
      rcases hab with h | h
      · exact .inl (e.1.trans h)
      · exact .inr (e.2 ▸ h)
    obtain ⟨y, my, ny⟩ := hc a₀ (.refl _) (nm b) hb
    have hy : BuildsOn nm a₀ y := by unfold BuildsOn; rw [ny]; exact hb
    have ry : Reaches nm S a₀ y := .step my hy (.refl _)
    obtain ⟨c₀, r, sp⟩ := ih y (hp y b ny) (closed_past nm hc ry)
    exact ⟨c₀, reaches_trans nm ry r, sp⟩

/-- A closed envelope stays closed as more arrives, when one name is one set of parents. -/
theorem closed_mono {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S') (hp : ∀ a b, nm a = nm b → SameParents a b)
    {e : Envelope} (h : Closed nm S e) : Closed nm S' e := by
  intro x hx k hk
  obtain ⟨x₀, r, sp⟩ := reaches_closed nm hp hx e ⟨rfl, rfl⟩ h
  have hk₀ : x₀.prev = some k ∨ k ∈ x₀.deps := by
    rcases hk with h | h
    · exact .inl (sp.1.trans h)
    · exact .inr (sp.2 ▸ h)
  obtain ⟨y, my, ny⟩ := h x₀ r k hk₀
  exact ⟨y, hs y my, ny⟩

/-- Splits are final: once an envelope's past holds a split, no reader that learns more ever counts it (A4). -/
theorem split_final {fit authorized revoked : Envelope → Prop} {S S' : List Envelope} (hs : ∀ x ∈ S, x ∈ S')
    {e : Envelope} (h : Discounted nm S e) : ¬ Counts nm fit authorized revoked S' e := by
  obtain ⟨x, y, hx, hy, hsp⟩ := h
  exact discounted_not_counts nm ⟨x, y, reaches_mono nm hs hx, hs y hy, hsp⟩

/-! ## A log as one reader holds it (A1: `IsLog`) -/

/-- A log as one reader holds it: its envelopes from the first, each at its place and naming the one before. -/
def IsLog (c : List Envelope) : Prop :=
  ∀ (i : Nat) (h : i < c.length),
    SameLog c[i] c[0] ∧ c[i].seq = i + 1 ∧
      c[i].prev = (if h0 : i = 0 then none else some (nm (c[i - 1]'(by omega))))

/-- A log holds no split. -/
theorem log_no_split {c : List Envelope} (hc : IsLog nm c)
    {a b : Envelope} (ha : a ∈ c) (hb : b ∈ c) : ¬ Split nm a b := by
  intro ⟨_, hs, hn⟩
  obtain ⟨i, hi, rfl⟩ := List.getElem_of_mem ha
  obtain ⟨j, hj, rfl⟩ := List.getElem_of_mem hb
  have := (hc i hi).2.1
  have := (hc j hj).2.1
  have hij : i = j := by omega
  subst hij
  exact hn rfl

/-- Two readers' copies of one log agree wherever both hold it, unless a split lies between them. -/
theorem logs_agree (hnm : ∀ a b, nm a = nm b → a = b) {c₁ c₂ : List Envelope} (h₁ : IsLog nm c₁)
    (h₂ : IsLog nm c₂) (h₀ : ∀ (p : 0 < c₁.length) (q : 0 < c₂.length), SameLog c₁[0] c₂[0])
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
