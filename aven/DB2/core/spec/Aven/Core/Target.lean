import Aven.Core.Names

/-!
# Targets, verbs and footprints

**One target grammar** for what a cap covers, what a want asks for and what a query ranges over (A8, recommended by
the architect; not yet decided by Samuel). Its forms are caps' (`id/caps`, "Targets"). Whether a Doc is in a target is
read from what its genesis fixes: its id, its vault and its root type (docs, "A Doc"). Who governs whom and which
actor spawned which come from avenID and the actors, so the model takes them as parameters.

**Verbs** are what a cap allows (ARCHITECTURE.md, "verb"). A **footprint** is what a write touches, per lowered step:
the type, the step's verb and the fields (caps, "Footprints"). Constraints on field values stay caps' own.

What it proves: a narrower target covers only what the wider one does (`Target.le_sound`), and footprint coverage
grows with the grants and composes (`covers_mono`, `covers_append`).
-/

namespace Aven.Core

/-- What a Doc's genesis fixes, which is all a target reads. -/
structure Facts where
  id : DocId
  vault : Bytes
  type : DocId

inductive Target where
  /-- One Doc. -/
  | doc (d : DocId)
  /-- Every Doc of a vault, and with `below` every Doc of the vaults it governs. -/
  | vault (v : Bytes) (below : Bool)
  /-- A vault's Docs of one root type, a type Doc. -/
  | vaultType (v : Bytes) (t : DocId) (below : Bool)
  /-- One actor, and with `below` every actor it spawned. -/
  | actor (a : DocId) (below : Bool)
  /-- Every actor of one definition in a vault: its root type is the definition's type Doc. -/
  | vaultDef (v : Bytes) (d : DocId)
  deriving DecidableEq, Repr

/-- `gov v w`: vault `v` governs vault `w` (avenID). `spawned a b`: actor `a` spawned actor `b`, directly or not. -/
def Target.covers (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop) : Target → Facts → Prop
  | .doc d, f => f.id = d
  | .vault v b, f => f.vault = v ∨ (b = true ∧ gov v f.vault)
  | .vaultType v t b, f => f.type = t ∧ (f.vault = v ∨ (b = true ∧ gov v f.vault))
  | .actor a b, f => f.id = a ∨ (b = true ∧ spawned a f.id)
  | .vaultDef v d, f => f.vault = v ∧ f.type = d

/-- `a` is a narrowing of `b`, read from the two targets alone. -/
def Target.le : Target → Target → Bool
  | .vault v b, .vault w c => v == w && (!b || c)
  | .vaultType v _ b, .vault w c => v == w && (!b || c)
  | .vaultType v t b, .vaultType w u c => v == w && t == u && (!b || c)
  | .vaultDef v _, .vault w _ => v == w
  | .vaultDef v d, .vaultType w u _ => v == w && d == u
  | .vaultDef v d, .vaultDef w e => v == w && d == e
  | .actor a b, .actor c d => a == c && (!b || d)
  | .doc d, .doc e => d == e
  | .doc d, .actor a _ => d == a
  | _, _ => false

theorem Target.le_sound {gov : Bytes → Bytes → Prop} {spawned : DocId → DocId → Prop} :
    ∀ {a b : Target} {f : Facts}, a.le b = true → a.covers gov spawned f → b.covers gov spawned f
  | .vault v b, .vault w c, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, Bool.not_eq_true'] at h
    obtain ⟨rfl, h⟩ := h
    simp only [Target.covers] at hc ⊢
    rcases hc with hc | ⟨hb, hg⟩
    · exact .inl hc
    · rcases h with h | h <;> simp_all
  | .vaultType v t b, .vault w c, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, Bool.not_eq_true'] at h
    obtain ⟨rfl, h⟩ := h
    simp only [Target.covers] at hc ⊢
    rcases hc.2 with hc | ⟨hb, hg⟩
    · exact .inl hc
    · rcases h with h | h <;> simp_all
  | .vaultType v t b, .vaultType w u c, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, Bool.not_eq_true'] at h
    obtain ⟨⟨rfl, rfl⟩, h⟩ := h
    simp only [Target.covers] at hc ⊢
    refine ⟨hc.1, ?_⟩
    rcases hc.2 with hc | ⟨hb, hg⟩
    · exact .inl hc
    · rcases h with h | h <;> simp_all
  | .vaultDef v d, .vault w _, f, h, hc => by
    simp only [Target.le, beq_iff_eq] at h
    subst h
    exact .inl hc.1
  | .vaultDef v d, .vaultType w u _, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨rfl, rfl⟩ := h
    exact ⟨hc.2, .inl hc.1⟩
  | .vaultDef v d, .vaultDef w e, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨rfl, rfl⟩ := h
    exact hc
  | .actor a b, .actor c d, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, Bool.not_eq_true'] at h
    obtain ⟨rfl, h⟩ := h
    simp only [Target.covers] at hc ⊢
    rcases hc with hc | ⟨hb, hs⟩
    · exact .inl hc
    · rcases h with h | h <;> simp_all
  | .doc d, .doc e, f, h, hc => by
    simp only [Target.le, beq_iff_eq] at h
    subst h
    exact hc
  | .doc d, .actor a _, f, h, hc => by
    simp only [Target.le, beq_iff_eq] at h
    subst h
    exact .inl hc

/-! ## Verbs and footprints -/

inductive Verb where
  | read | query | put | patch | remove | edit | tell | keep | share
  deriving DecidableEq, Repr

/-- A write step's verb: a put of a Record that didn't exist at the envelope's base, or of one that did; a patch, a
remove, or an edit of a text, list or tree (caps, "Footprints"; A19). -/
inductive StepVerb where
  | putNew | putReplace | patch | remove | edit
  deriving DecidableEq, Repr

/-- As caps writes it. -/
def StepVerb.name : StepVerb → String
  | .putNew => "put-new"
  | .putReplace => "put-replace"
  | .patch => "patch"
  | .remove => "remove"
  | .edit => "edit"

/-- One lowered step of a write: the type (a type Doc), its verb, and the fields it writes. -/
structure Step where
  type : DocId
  verb : StepVerb
  fields : List Bytes
  deriving DecidableEq, Repr

/-- What a cap grants for writes: a type, a verb, and the fields, or every field. -/
structure Grant where
  type : DocId
  verb : StepVerb
  fields : Option (List Bytes)
  deriving DecidableEq, Repr

def Grant.allows (g : Grant) (s : Step) : Bool :=
  g.type == s.type && g.verb == s.verb &&
    match g.fields with
    | none => true
    | some fs => s.fields.all (fs.contains ·)

/-- Every step of a footprint is allowed by one of the grants. -/
def covers (grants : List Grant) (fp : List Step) : Bool := fp.all fun s => grants.any (·.allows s)

theorem covers_mono {g g' : List Grant} (hg : ∀ x ∈ g, x ∈ g') {fp : List Step} (h : covers g fp = true) :
    covers g' fp = true := by
  simp only [covers, List.all_eq_true, List.any_eq_true] at h ⊢
  intro s hs
  obtain ⟨x, hx, ha⟩ := h s hs
  exact ⟨x, hg x hx, ha⟩

theorem covers_append {g : List Grant} {a b : List Step} (ha : covers g a = true) (hb : covers g b = true) :
    covers g (a ++ b) = true := by
  simp only [covers, List.all_append, Bool.and_eq_true] at ha hb ⊢
  exact ⟨ha, hb⟩

end Aven.Core
