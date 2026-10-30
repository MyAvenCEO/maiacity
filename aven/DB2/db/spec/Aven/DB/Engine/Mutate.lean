import Aven.DB.Engine.Query

/-!
# The engine's mutations and lowering (db/engine, "Mutations"; ARCHITECTURE.md, A18 and A19)

A mutation is a list of core operations applied to one Doc as one commit, all or nothing: `put` a new Record, `patch`
fields of the Records a `where` finds, `remove` them, or `edit` one field of one Record (text, lists and trees: Loro's
container edit, here its resulting value). A plugin's operation reaches the engine only lowered to these.

- **Ids are made, not drawn:** a Record `put` creates is named by (writer, counter, op index), so every reader that
  re-runs the commit names it alike, and no two commits' Records share a name (A18).
- **References point backward:** `{ "ref": n }` names the Record op `n` put; `n` is an earlier op, and a `put`.
- **All or nothing:** a commit that fails anywhere changes nothing.
- **A lowering is pinned by its runtime's hash:** readers that agree on what a hash names lower alike.

A18 and A19 wait for Samuel; this models their recommendation. Footprints with verbs, fields and constraints, and the
check of a diff against its footprint, come with `Aven.Core`'s verbs and footprints. -/

namespace Aven.DB.Engine

/-- A Record's id, made from who wrote it: the writer, its counter for this commit, the op's place in it. -/
structure NewId (W : Type) where
  writer : W
  counter : Nat
  index : Nat
  deriving DecidableEq, Repr

/-- A Record in one Doc. -/
structure Record (W Ty Val : Type) where
  id : NewId W
  ty : Ty
  fields : Tuple Val
  deriving Repr

/-- A field's value in a `put`: given, or the id of a Record an earlier `put` of this commit creates. -/
inductive Cell (Val : Type) where
  | lit (v : Val)
  | ref (n : Nat)
  deriving DecidableEq, Repr

inductive Op (W Ty Val : Type) where
  | put (ty : Ty) (fields : List (String × Cell Val))
  | patch (ty : Ty) (where_ : List (String × Val)) (set : List (String × Val))
  | remove (ty : Ty) (where_ : List (String × Val))
  | edit (id : NewId W) (field : String) (v : Val)
  deriving Repr

inductive Refused where
  /-- a `{ "ref": n }` to an op that is not an earlier `put` -/
  | badRef (op n : Nat)
  /-- an `edit` of a Record the Doc doesn't have -/
  | missing (op : Nat)
  deriving DecidableEq, Repr

variable {W Ty Val : Type} [DecidableEq W] [DecidableEq Ty] [DecidableEq Val]

def Op.isPut : Op W Ty Val → Bool
  | .put _ _ => true
  | _ => false

def Op.refs : Op W Ty Val → List Nat
  | .put _ fields => fields.filterMap fun
    | (_, .ref n) => some n
    | _ => none
  | _ => []

/-- Every reference of every op points at an earlier `put`. -/
def refsBackward (ops : List (Op W Ty Val)) : Bool :=
  (List.range ops.length).all fun i =>
    ((ops[i]?.map Op.refs).getD []).all fun n => n < i && ((ops[n]?.map Op.isPut).getD false)

/-- A Record matches a `where` when it has every listed field with that value. -/
def found (ty : Ty) (where_ : List (String × Val)) (r : Record W Ty Val) : Bool :=
  decide (r.ty = ty) && where_.all fun (c, v) => get r.fields c == some v

/-- Set fields: replaced where present, added where not. -/
def setFields (t : Tuple Val) (set : List (String × Val)) : Tuple Val :=
  set.foldl (fun t (c, v) => (c, v) :: t.filter (·.1 != c)) t

/-- One op at index `i` of a commit by `w` with counter `c`. `ofId` writes an id as a value. -/
def step (ofId : NewId W → Val) (w : W) (c : Nat) (i : Nat) (s : List (Record W Ty Val)) :
    Op W Ty Val → Except Refused (List (Record W Ty Val))
  | .put ty fields =>
    let cell : Cell Val → Val := fun
      | .lit v => v
      | .ref n => ofId ⟨w, c, n⟩
    .ok (s ++ [⟨⟨w, c, i⟩, ty, fields.map fun (k, x) => (k, cell x)⟩])
  | .patch ty where_ set =>
    .ok (s.map fun r => if found ty where_ r then { r with fields := setFields r.fields set } else r)
  | .remove ty where_ => .ok (s.filter fun r => ! found ty where_ r)
  | .edit id field v =>
    if s.any (·.id == id) then
      .ok (s.map fun r => if r.id == id then { r with fields := setFields r.fields [(field, v)] } else r)
    else .error (.missing i)

def stepsFrom (ofId : NewId W → Val) (w : W) (c : Nat) :
    Nat → List (Record W Ty Val) → List (Op W Ty Val) → Except Refused (List (Record W Ty Val))
  | _, s, [] => .ok s
  | i, s, op :: ops => do stepsFrom ofId w c (i + 1) (← step ofId w c i s op) ops

/-- A commit: every reference checked first, then every op in turn. -/
def commit (ofId : NewId W → Val) (w : W) (c : Nat) (s : List (Record W Ty Val)) (ops : List (Op W Ty Val)) :
    Except Refused (List (Record W Ty Val)) :=
  if refsBackward ops then stepsFrom ofId w c 0 s ops
  else
    let bad := (List.range ops.length).find? fun i =>
      ! ((ops[i]?.map Op.refs).getD []).all fun n => n < i && ((ops[n]?.map Op.isPut).getD false)
    .error (.badRef (bad.getD 0) 0)

/-- What the Doc holds after a commit: its result, or exactly what it held before. -/
def apply (ofId : NewId W → Val) (w : W) (c : Nat) (s : List (Record W Ty Val)) (ops : List (Op W Ty Val)) :
    List (Record W Ty Val) :=
  match commit ofId w c s ops with
  | .ok s' => s'
  | .error _ => s

/-- **All or nothing:** a refused commit leaves the Doc as it was. -/
theorem refused_changes_nothing (ofId : NewId W → Val) (w : W) (c : Nat) (s : List (Record W Ty Val))
    (ops : List (Op W Ty Val)) (e : Refused) (h : commit ofId w c s ops = .error e) : apply ofId w c s ops = s := by
  simp [apply, h]

/-- **References point backward:** in a commit that is accepted, every `{ "ref": n }` of op `i` names an earlier op,
and that op is a `put`. -/
theorem refs_point_backward (ofId : NewId W → Val) (w : W) (c : Nat) (s s' : List (Record W Ty Val))
    (ops : List (Op W Ty Val)) (h : commit ofId w c s ops = .ok s') :
    ∀ i (hi : i < ops.length), ∀ n ∈ (ops[i]).refs, n < i ∧ ∃ hn : n < ops.length, (ops[n]).isPut = true := by
  intro i hi n hn
  have hb : refsBackward ops = true := by
    simp only [commit] at h
    split at h
    · assumption
    · cases h
  simp only [refsBackward, List.all_eq_true, List.mem_range] at hb
  have := hb i hi
  simp only [List.getElem?_eq_getElem hi, Option.map_some, Option.getD_some,
    Bool.and_eq_true, decide_eq_true_eq] at this
  obtain ⟨hlt, hput⟩ := this n hn
  have hn' : n < ops.length := Nat.lt_trans hlt hi
  refine ⟨hlt, hn', ?_⟩
  simpa [List.getElem?_eq_getElem hn'] using hput

/-- The ids a commit's `put`s create. -/
def created (w : W) (c : Nat) (ops : List (Op W Ty Val)) : List (NewId W) :=
  ((List.range ops.length).filter fun i => (ops[i]?.map Op.isPut).getD false).map fun i => ⟨w, c, i⟩

omit [DecidableEq W] [DecidableEq Ty] [DecidableEq Val] in
/-- **Ids are made, not drawn:** one commit's new ids are all different, and differ from every id another writer, or
the same writer under another counter, makes. -/
theorem created_distinct (w : W) (c : Nat) (ops : List (Op W Ty Val)) : (created w c ops).Nodup := by
  simp only [created]
  refine List.Pairwise.map _ ?_ ((List.nodup_range).filter _)
  intro i j hij e
  cases e
  exact hij rfl

omit [DecidableEq W] in
theorem ids_differ_across (w w' : W) (c c' i i' : Nat) (h : w ≠ w' ∨ c ≠ c') :
    (⟨w, c, i⟩ : NewId W) ≠ ⟨w', c', i'⟩ := by
  intro e
  cases e
  simp at h

/-! ## Lowering, pinned by its runtime's hash (A18) -/

/-- What a device knows of runtimes: the lowering a hash names, if it has it. -/
abbrev Runtimes (H Src : Type) (W Ty Val : Type) := H → Option (Src → Option (List (Op W Ty Val)))

def lower {H Src : Type} (rt : Runtimes H Src W Ty Val) (h : H) (src : Src) : Option (List (Op W Ty Val)) :=
  (rt h).bind (· src)

/-- **Readers lower alike:** two devices that agree on what one runtime hash names lower every operation alike, and so
make the same commit, ids included, whatever other runtimes they hold. -/
theorem readers_agree {H Src : Type} (rt rt' : Runtimes H Src W Ty Val) (h : H) (same : rt h = rt' h)
    (ofId : NewId W → Val) (w : W) (c : Nat) (s : List (Record W Ty Val)) (src : Src) :
    (lower rt h src).map (commit ofId w c s) = (lower rt' h src).map (commit ofId w c s) := by
  simp [lower, same]

end Aven.DB.Engine
