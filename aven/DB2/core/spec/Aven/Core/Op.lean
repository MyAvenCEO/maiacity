import Aven.Core.Target
import Aven.Core.ValueEq

/-!
# Ops (A32)

An operation is named by the hash of its stored form (rule 1): one of `core/1`'s, the core verbs, or a plugin's, which
lowers to core ops (engine README, "Operations"). A cap line names an op by its id and bounds on its parameters, and
nothing else (`Aven.ID.Line`); an envelope names the op it ran and its parameters (`Call`); the steps it writes are the
op's lowering, never written in a cap. So what an owner approves is an op's name and definition, exactly what it lets
the holder do (A32, Samuel, 31 Oct 2026: "caps should be built from their ops").

- `core/1`'s ops are read, put, patch, remove, edit, tell, keep and share, each with a fixed id: the name of its stored
  form `{"op": name, "plugin": "core/1"}`. Reading is still holding the key (rule 5); free editing is `edit` on a type
  and field. Read, tell, keep and share lower to no step (`CoreOp.writes`). A stored query is an op by its hash.
- A bound is an enumeration: any value, or one of some values, and for a list each of its elements one of them. Ranges
  come only when a real op needs them. A narrower bound allows no value a wider one doesn't (`Bound.within_allows`).
- An envelope names the op it ran and its parameters, a `Call`: `{"op": id, "params": {…}}` (`Call.value`), read back
  by `Call.ofValue?` (`Call.ofValue_value`); a bound reads back by `Bound.ofValue?` (`Bound.ofValue_value`). Another
  plugin's built-in ops are named as `core/1`'s are, `{"op": name, "plugin": "tree/1"}` for the tree's.
- Every Doc has a type (A39): a type Doc's own type is the built-in type of types, which is its own type too
  (`typeOfTypes`, `typeOfTypes_typed`).
-/

namespace Aven.Core

/-- An operation, named by the hash of its stored form. -/
abbrev OpId := Hash

/-- `core/1`'s operations, the core verbs. -/
inductive CoreOp where
  | read | put | patch | remove | edit | tell | keep | share
  deriving DecidableEq, Repr

def CoreOp.name : CoreOp → String
  | .read => "read" | .put => "put" | .patch => "patch" | .remove => "remove" | .edit => "edit"
  | .tell => "tell" | .keep => "keep" | .share => "share"

/-- Whether a core op writes: put, patch, remove and edit lower to steps; read, tell, keep and share to none. -/
def CoreOp.writes : CoreOp → Bool
  | .put | .patch | .remove | .edit => true
  | .read | .tell | .keep | .share => false

private def k (s : String) : Bytes := s.toUTF8.toList

/-- A core op's stored form, `{"op": name, "plugin": "core/1"}`, its keys in the codec's order. -/
def CoreOp.value (o : CoreOp) : Value := .map [(k "op", .text (k o.name)), (k "plugin", .text (k "core/1"))]

/-- A core op's id: the name of its stored form. -/
def CoreOp.id (H : Bytes → Hash) (o : CoreOp) : OpId := nameOf H o.value

#guard [CoreOp.read, .put, .patch, .remove, .edit, .tell, .keep, .share].all fun o => Canon o.value

/-! ## Bounds on parameters -/

/-- A bound on one parameter: any value (`none`), or one of these values; for a list, each of its elements one of
them. -/
abbrev Bound := Option (List Value)

def Bound.allows : Bound → Value → Bool
  | none, _ => true
  | some vs, .array xs => xs.all (vs.contains ·)
  | some vs, v => vs.contains v

/-- A bound as a Value: null for any value, else the values it allows. -/
def Bound.value : Bound → Value
  | none => .null
  | some vs => .array vs

/-- A bound read back from its Value: null for any value, an array for the values it allows. -/
def Bound.ofValue? : Value → Option Bound
  | .null => some none
  | .array vs => some (some vs)
  | _ => none

/-- A bound reads back as itself. -/
theorem Bound.ofValue_value (b : Bound) : Bound.ofValue? b.value = some b := by
  cases b <;> rfl

/-- A bound within another: any value it allows, the other allows too. -/
def Bound.within : Bound → Bound → Bool
  | _, none => true
  | some vs, some ws => vs.all (ws.contains ·)
  | none, some _ => false

theorem Bound.within_allows {a b : Bound} {v : Value} (w : a.within b = true) (h : a.allows v = true) :
    b.allows v = true := by
  cases b with
  | none => rfl
  | some ws =>
    cases a with
    | none => simp [Bound.within] at w
    | some vs =>
      simp only [Bound.within, List.all_eq_true, List.contains_iff_mem] at w
      cases v <;> simp_all [Bound.allows, List.all_eq_true]

theorem Bound.within_trans {a b c : Bound} (h : a.within b = true) (k : b.within c = true) : a.within c = true := by
  cases c with
  | none => rfl
  | some ws =>
    cases b with
    | none => simp [Bound.within] at k
    | some vs =>
      cases a with
      | none => simp [Bound.within] at h
      | some us =>
        simp only [Bound.within, List.all_eq_true, List.contains_iff_mem] at h k ⊢
        exact fun x m => k x (h x m)

/-! ## Calls -/

/-- An op called: the op by its id and its parameters by name, as an envelope names what it ran. The Doc it acts on is
the envelope's. -/
structure Call where
  op : OpId
  params : List (Bytes × Value) := []
  deriving DecidableEq, Repr

/-- A parameter's value in a call; one the call doesn't give reads as null. -/
def Call.param (c : Call) (p : Bytes) : Value := (c.params.lookup p).getD .null

/-- A call as an envelope's body carries it: `{"op": id, "params": {name: value, …}}`, its op id as the bytes of its
hash, its params a map with text keys. A call whose params aren't in the codec's order, or name one twice, isn't
canonical, so one call has one encoding. -/
def Call.value (c : Call) : Value := .map [(k "op", .bytes c.op.bytes), (k "params", .map c.params)]

/-- A call read back from `Call.value`'s shape: its op a hash of 32 bytes, its params a map. Bytes that aren't
canonical never reach it: the codec refuses them, a call's params out of order among them. -/
def Call.ofValue? : Value → Option Call
  | .map [(a, .bytes op), (b, .map ps)] =>
    if a = k "op" ∧ b = k "params" ∧ op.length = 32 then some ⟨⟨op⟩, ps⟩ else none
  | _ => none

/-- A call whose op is a hash reads back as itself. -/
theorem Call.ofValue_value (c : Call) (h : c.op.ok = true) : Call.ofValue? c.value = some c := by
  obtain ⟨⟨op⟩, ps⟩ := c
  simp only [Hash.ok, beq_iff_eq] at h
  simp [Call.value, Call.ofValue?, h]

/-! ## The type of types (A39) -/

/-- A built-in type: no Doc's genesis, its id the name of the label `<namespace> <name> 1`, so every reader knows it
without fetching anything. The one way a part names its built-in types (A45): avenID's and the docs layer's list
theirs through it. -/
def builtinType (H : Bytes → Hash) (ns name : String) : DocId :=
  ⟨nameOf H (.text (k s!"{ns} {name} 1"))⟩

/-- The built-in type of types: the root type of every type Doc, and its own. It is no Doc's genesis, which couldn't
name its own hash: it is a built-in type, `avenDB type of types 1`. -/
def typeOfTypes (H : Bytes → Hash) : DocId := builtinType H "avenDB" "type of types"

#guard typeOfTypes blake3 == ⟨nameOf blake3 (.text (k "avenDB type of types 1"))⟩

/-- A type Doc: one whose root type is the type of types. -/
def Facts.isType (H : Bytes → Hash) (f : Facts) : Bool := f.type == typeOfTypes H

/-- The type of types' own facts: built in, in no vault, and its own type. -/
def typeOfTypesFacts (H : Bytes → Hash) : Facts := ⟨typeOfTypes H, [], typeOfTypes H⟩

/-- The type of types is a type Doc: its own type. -/
theorem typeOfTypes_typed (H : Bytes → Hash) : (typeOfTypesFacts H).isType H = true := by
  simp [Facts.isType, typeOfTypesFacts]

end Aven.Core
