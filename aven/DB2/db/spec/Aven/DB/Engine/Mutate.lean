import Aven.DB.Engine.Query

/-!
# The engine's mutations and lowering (db/engine, "Mutations"; ARCHITECTURE.md, A18 and A19)

A mutation is a list of core operations applied to one Doc as one commit, all or nothing: `put` a new Record, `patch`
fields of the Records a `where` finds, `remove` them, or `edit` one field of one Record (text, lists and trees: Loro's
container edit, here its resulting value). Every op names the type it writes, so its footprint is known before it runs
(`Engine.Footprint`). A plugin's operation reaches the engine only lowered to these.

- **Ids are made, not drawn:** a Record `put` creates is named by (writer, counter, op index), so every reader that
  re-runs the commit names it alike, and no two commits' Records share a name (A18). The writer is the envelope's
  writer id (`Aven.Core.Envelope.writer`).
- **References point backward:** `{ "ref": n }` names the Record op `n` put; `n` is an earlier op, and a `put`.
- **All or nothing:** a commit that fails anywhere changes nothing.
- **A lowering is pinned by its runtime's hash:** readers that agree on what a hash names lower alike.

A18 and A19 were decided as recommended (Samuel, 30 Oct 2026). -/

namespace Aven.DB.Engine

open Aven.Core

/-- A Record's id, made from who wrote it: the writer id, its counter for this commit, the op's place in it. -/
structure NewId where
  writer : Nat
  counter : Nat
  index : Nat
  deriving DecidableEq, Repr

/-- A Record in one Doc. -/
structure Record (Val : Type) where
  id : NewId
  type : DocId
  fields : Tuple Val

/-- A field's value in a `put`: given, or the id of a Record an earlier `put` of this commit creates. -/
inductive Cell (Val : Type) where
  | lit (v : Val)
  | ref (n : Nat)

inductive Op (Val : Type) where
  | put (type : DocId) (fields : List (Bytes × Cell Val))
  | patch (type : DocId) (where_ : List (Bytes × Val)) (set : List (Bytes × Val))
  | remove (type : DocId) (where_ : List (Bytes × Val))
  | edit (type : DocId) (id : NewId) (field : Bytes) (v : Val)

inductive Refused where
  /-- a `{ "ref": n }` in op `op` to an op that is not an earlier `put` -/
  | badRef (op : Nat)
  /-- an `edit` of a Record of that type the Doc doesn't have -/
  | missing (op : Nat)
  deriving DecidableEq, Repr

variable {Val : Type}

def Op.isPut : Op Val → Bool
  | .put _ _ => true
  | _ => false

def Op.refs : Op Val → List Nat
  | .put _ fields => fields.filterMap fun
    | (_, .ref n) => some n
    | _ => none
  | _ => []

/-- Op `i`'s references all point at an earlier `put`. -/
def refsOk (ops : List (Op Val)) (i : Nat) : Bool :=
  ((ops[i]?.map Op.refs).getD []).all fun n => n < i && ((ops[n]?.map Op.isPut).getD false)

/-- Every reference of every op points at an earlier `put`. -/
def refsBackward (ops : List (Op Val)) : Bool := (List.range ops.length).all (refsOk ops)

/-- A Record matches a `where` when it is of the type and has every listed field with that value. -/
def found (eq : Val → Val → Bool) (ty : DocId) (where_ : List (Bytes × Val)) (r : Record Val) : Bool :=
  r.type == ty && where_.all fun (c, v) => match get r.fields c with | some x => eq x v | none => false

/-- Set fields: replaced where present, added where not. -/
def setFields (t : Tuple Val) : List (Bytes × Val) → Tuple Val
  | [] => t
  | (c, v) :: rest => setFields ((c, v) :: t.filter (·.1 != c)) rest

/-- The Record an `edit` names: its id, and the type the op says. -/
def edits (ty : DocId) (id : NewId) (r : Record Val) : Bool := r.id == id && r.type == ty

/-- One op at index `i` of a commit by writer `w` with counter `c`. `ofId` writes an id as a value. -/
def step (eq : Val → Val → Bool) (ofId : NewId → Val) (w c i : Nat) (s : List (Record Val)) :
    Op Val → Except Refused (List (Record Val))
  | .put ty fields =>
    let cell : Cell Val → Val := fun
      | .lit v => v
      | .ref n => ofId ⟨w, c, n⟩
    .ok (s ++ [⟨⟨w, c, i⟩, ty, fields.map fun (k, x) => (k, cell x)⟩])
  | .patch ty where_ set =>
    .ok (s.map fun r => if found eq ty where_ r then { r with fields := setFields r.fields set } else r)
  | .remove ty where_ => .ok (s.filter fun r => ! found eq ty where_ r)
  | .edit ty id field v =>
    if s.any (edits ty id) then
      .ok (s.map fun r => if edits ty id r then { r with fields := setFields r.fields [(field, v)] } else r)
    else .error (.missing i)

def stepsFrom (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) :
    Nat → List (Record Val) → List (Op Val) → Except Refused (List (Record Val))
  | _, s, [] => .ok s
  | i, s, op :: ops => do stepsFrom eq ofId w c (i + 1) (← step eq ofId w c i s op) ops

/-- A commit: every reference checked first, then every op in turn. -/
def commit (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (s : List (Record Val)) (ops : List (Op Val)) :
    Except Refused (List (Record Val)) :=
  if refsBackward ops then stepsFrom eq ofId w c 0 s ops
  else .error (.badRef (((List.range ops.length).find? fun i => ! refsOk ops i).getD 0))

/-- What the Doc holds after a commit: its result, or exactly what it held before. -/
def apply (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (s : List (Record Val)) (ops : List (Op Val)) :
    List (Record Val) :=
  match commit eq ofId w c s ops with
  | .ok s' => s'
  | .error _ => s

/-- **All or nothing:** a refused commit leaves the Doc as it was. -/
theorem refused_changes_nothing (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (s : List (Record Val))
    (ops : List (Op Val)) (e : Refused) (h : commit eq ofId w c s ops = .error e) :
    apply eq ofId w c s ops = s := by
  simp [apply, h]

/-- **References point backward:** in a commit that is accepted, every `{ "ref": n }` of op `i` names an earlier op,
and that op is a `put`. -/
theorem refs_point_backward (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (s s' : List (Record Val))
    (ops : List (Op Val)) (h : commit eq ofId w c s ops = .ok s') :
    ∀ i (hi : i < ops.length), ∀ n ∈ (ops[i]).refs, n < i ∧ ∃ hn : n < ops.length, (ops[n]).isPut = true := by
  intro i hi n hn
  have hb : refsBackward ops = true := by
    simp only [commit] at h
    split at h
    · assumption
    · cases h
  simp only [refsBackward, List.all_eq_true, List.mem_range] at hb
  have := hb i hi
  simp only [refsOk, List.getElem?_eq_getElem hi, Option.map_some, Option.getD_some, List.all_eq_true,
    Bool.and_eq_true, decide_eq_true_eq] at this
  obtain ⟨hlt, hput⟩ := this n hn
  have hn' : n < ops.length := Nat.lt_trans hlt hi
  refine ⟨hlt, hn', ?_⟩
  simpa [List.getElem?_eq_getElem hn'] using hput

/-- The ids a commit's `put`s create. -/
def created (w c : Nat) (ops : List (Op Val)) : List NewId :=
  ((List.range ops.length).filter fun i => (ops[i]?.map Op.isPut).getD false).map fun i => ⟨w, c, i⟩

/-- **Ids are made, not drawn:** one commit's new ids are all different, and differ from every id another writer, or
the same writer under another counter, makes. -/
theorem created_distinct (w c : Nat) (ops : List (Op Val)) : (created w c ops).Nodup := by
  simp only [created]
  refine List.Pairwise.map _ ?_ ((List.nodup_range).filter _)
  intro i j hij e
  cases e
  exact hij rfl

theorem ids_differ_across (w w' c c' i i' : Nat) (h : w ≠ w' ∨ c ≠ c') :
    (⟨w, c, i⟩ : NewId) ≠ ⟨w', c', i'⟩ := by
  intro e
  cases e
  simp at h

/-! ## Lowering, pinned by its runtime's hash (A18) -/

/-- What a device knows of runtimes: the lowering a runtime's hash names, if it has it. -/
abbrev Runtimes (Src Val : Type) := Hash → Option (Src → Option (List (Op Val)))

def lower {Src : Type} (rt : Runtimes Src Val) (h : Hash) (src : Src) : Option (List (Op Val)) :=
  (rt h).bind (· src)

/-- **Readers lower alike:** two devices that agree on what one runtime hash names lower every operation alike, and so
make the same commit, ids included, whatever other runtimes they hold. -/
theorem readers_agree {Src : Type} (rt rt' : Runtimes Src Val) (h : Hash) (same : rt h = rt' h)
    (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (s : List (Record Val)) (src : Src) :
    (lower rt h src).map (commit eq ofId w c s) = (lower rt' h src).map (commit eq ofId w c s) := by
  simp [lower, same]

end Aven.DB.Engine
