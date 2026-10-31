import Aven.Core.Names

/-!
# Targets and steps

**One target grammar** for what a cap covers, what a want asks for and what a query ranges over (A8, decided by
Samuel, 30 Oct 2026; its CBOR is `Aven.Core.TargetCbor`). Its forms are three (A32, Samuel, 31 Oct 2026): a Doc, with
what it spawned or what it lists, or neither; a vault's Docs; and a vault's Docs of one root type, each with the vaults
below it or not. Whether a Doc is in a target is read from what its genesis fixes, its id, its vault and its root type
(docs, "A Doc"), never from its content, so what a target covers can't drift with the data (caps rule 6). Who governs
whom, which actor spawned which and what a collection lists come from avenID, the actors and the collections' own
signed listings, so the model takes them as parameters.

A **step** is what a write touches, per lowered core op: the type, the step's verb and the fields (caps,
"Footprints"). Steps are computed from an op's lowering (E1 to E3), never written in a cap.

What it proves: a narrower target covers only what the wider one does (`Target.le_sound`); `Target.coversB` decides
coverage (`Target.coversB_iff`).
-/

namespace Aven.Core

/-- What a Doc's genesis fixes, which is all a target reads. -/
structure Facts where
  id : DocId
  /-- Its vault, by the vault's 32-byte name (avenID's `VaultName`): a vault in any format is its name, never text. -/
  vault : Hash
  type : DocId

/-- What a Doc target reaches besides the Doc itself: nothing more, every actor it spawned, or every Doc it lists, a
collection (A32). -/
inductive Reach where
  | self
  | spawned
  | lists
  deriving DecidableEq, Repr

inductive Target where
  /-- One Doc, and with its reach the actors it spawned or the Docs it lists. -/
  | doc (d : DocId) (reach : Reach)
  /-- Every Doc of a vault, and with `below` every Doc of the vaults it governs. -/
  | vault (v : Hash) (below : Bool)
  /-- A vault's Docs of one root type, a type Doc. -/
  | vaultType (v : Hash) (t : DocId) (below : Bool)
  deriving DecidableEq, Repr

/-- `gov v w`: vault `v` governs vault `w` (avenID). `spawned a b`: actor `a` spawned actor `b`, directly or not.
`lists c d`: the collection `c` lists the Doc `d`, by its issuer's signed listings, nested at most a bounded depth. -/
def Target.covers (gov : Hash → Hash → Prop) (spawned lists : DocId → DocId → Prop) : Target → Facts → Prop
  | .doc d .self, f => f.id = d
  | .doc d .spawned, f => f.id = d ∨ spawned d f.id
  | .doc d .lists, f => f.id = d ∨ lists d f.id
  | .vault v b, f => f.vault = v ∨ (b = true ∧ gov v f.vault)
  | .vaultType v t b, f => f.type = t ∧ (f.vault = v ∨ (b = true ∧ gov v f.vault))

/-- `Target.covers`, decided, with who governs whom, which actor spawned which and what a collection lists given as
tests, as a device evaluates them. -/
def Target.coversB (gov : Hash → Hash → Bool) (spawned lists : DocId → DocId → Bool) : Target → Facts → Bool
  | .doc d .self, f => f.id == d
  | .doc d .spawned, f => f.id == d || spawned d f.id
  | .doc d .lists, f => f.id == d || lists d f.id
  | .vault v b, f => f.vault == v || (b && gov v f.vault)
  | .vaultType v t b, f => f.type == t && (f.vault == v || (b && gov v f.vault))

theorem Target.coversB_iff {gov : Hash → Hash → Bool} {spawned lists : DocId → DocId → Bool} {t : Target}
    {f : Facts} :
    t.coversB gov spawned lists f = true ↔ t.covers (gov · · = true) (spawned · · = true) (lists · · = true) f := by
  cases t with
  | doc d r => cases r <;> simp [Target.coversB, Target.covers]
  | _ => simp [Target.coversB, Target.covers]

/-- As caps writes it. -/
def Reach.name : Reach → String
  | .self => "self"
  | .spawned => "spawned"
  | .lists => "lists"

/-- A reach within another: the Doc alone is within either. -/
def Reach.le : Reach → Reach → Bool
  | .self, _ => true
  | .spawned, .spawned => true
  | .lists, .lists => true
  | _, _ => false

/-- `a` is a narrowing of `b`, read from the two targets alone. -/
def Target.le : Target → Target → Bool
  | .vault v b, .vault w c => v == w && (!b || c)
  | .vaultType v _ b, .vault w c => v == w && (!b || c)
  | .vaultType v t b, .vaultType w u c => v == w && t == u && (!b || c)
  | .doc d r, .doc e s => d == e && r.le s
  | _, _ => false

theorem Target.le_sound {gov : Hash → Hash → Prop} {spawned lists : DocId → DocId → Prop} :
    ∀ {a b : Target} {f : Facts}, a.le b = true → a.covers gov spawned lists f → b.covers gov spawned lists f
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
  | .doc d r, .doc e s, f, h, hc => by
    simp only [Target.le, Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨rfl, h⟩ := h
    cases r <;> cases s <;> simp_all [Reach.le, Target.covers]

/-! ## Steps -/

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

end Aven.Core
