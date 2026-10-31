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
- A bound is an enumeration: one of some values, and for a list each of its elements one of them. A param that may take
  any value is left out, never null (A200). Ranges come only when a real op needs them. A narrower bound allows no value a wider one doesn't (`Bound.within_allows`).
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

/-- A plugin's built-in op in its stored form, `{"op": name, "plugin": plugin}`, its keys in the codec's order. -/
def OpId.stored (plugin name : String) : Value := .map [(k "op", .text (k name)), (k "plugin", .text (k plugin))]

/-- Any plugin's built-in op id: the name of its stored form, the one way an op of `core/1`, `tree/1` or any other
plugin is named (A45). -/
def OpId.ofPlugin (H : Bytes → Hash) (plugin name : String) : OpId := nameOf H (OpId.stored plugin name)

/-- A core op's stored form, `{"op": name, "plugin": "core/1"}`. -/
def CoreOp.value (o : CoreOp) : Value := OpId.stored "core/1" o.name

/-- A core op's id: `core/1`'s op of its name. -/
def CoreOp.id (H : Bytes → Hash) (o : CoreOp) : OpId := OpId.ofPlugin H "core/1" o.name

/-- `core/1`'s write params, by name: the type a write is on and the fields it sets (caps' lines and the engine's
lowering read them here). -/
def typeParam : Bytes := k "type"
def fieldsParam : Bytes := k "fields"

#guard [CoreOp.read, .put, .patch, .remove, .edit, .tell, .keep, .share].all fun o => Canon o.value

/-! ## Bounds on parameters -/

/-- A bound on one parameter: the values it may take; for a list, each of its elements one of them. A parameter that
may take any value isn't bounded: a cap line leaves it out (A200). -/
abbrev Bound := List Value

def Bound.allows (vs : Bound) : Value → Bool
  | .array xs => xs.all (vs.contains ·)
  | v => vs.contains v

/-- A bound as a Value: the array of the values it allows. -/
def Bound.value (vs : Bound) : Value := .array vs

/-- The most values one bound allows (rule 10; the limit follows its primitive's owner, A45): room for every field of
a schema, every type of a vault or every op of a plugin a cap line names. -/
def maxBoundValues : Nat := 256

/-- The most params one call names: `core/1`'s take two, a plugin's op a handful. -/
def maxParams : Nat := 64

/-- A bound read back from its Value: an array of at most `maxBoundValues`. A null is no bound (A200). -/
def Bound.ofValue? : Value → Option Bound
  | .array vs => if vs.length ≤ maxBoundValues then some vs else none
  | _ => none

/-- A bound within its limit reads back as itself. -/
theorem Bound.ofValue_value (b : Bound) (h : b.length ≤ maxBoundValues) : Bound.ofValue? b.value = some b := by
  simp [Bound.value, Bound.ofValue?, h]

/-- A bound within another: every value it allows, the other allows too, a subset. -/
def Bound.within (vs ws : Bound) : Bool := vs.all (ws.contains ·)

theorem Bound.within_allows {a b : Bound} {v : Value} (w : a.within b = true) (h : a.allows v = true) :
    b.allows v = true := by
  simp only [Bound.within, List.all_eq_true, List.contains_iff_mem] at w
  cases v <;> simp_all [Bound.allows, List.all_eq_true]

theorem Bound.within_trans {a b c : Bound} (h : a.within b = true) (k : b.within c = true) : a.within c = true := by
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

/-- A call read back from `Call.value`'s shape: its op a hash (`Hash.ofValue?`), its params a map of at most
`maxParams`. Bytes that aren't canonical never reach it: the codec refuses them, a call's params out of order among
them. -/
def Call.ofValue? : Value → Option Call
  | .map [(a, .bytes op), (b, .map ps)] =>
    if a = k "op" ∧ b = k "params" ∧ ps.length ≤ maxParams then (Hash.ofValue? (.bytes op)).map (⟨·, ps⟩)
    else none
  | _ => none

/-- A call whose op is a hash, within its limit, reads back as itself. -/
theorem Call.ofValue_value (c : Call) (h : c.op.ok = true) (hp : c.params.length ≤ maxParams) :
    Call.ofValue? c.value = some c := by
  obtain ⟨⟨op⟩, ps⟩ := c
  simp only [Hash.ok, beq_iff_eq] at h
  simp [Call.value, Call.ofValue?, Hash.ofValue?, h, hp]

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

/-- The name that stands for no vault: 32 zero bytes, which no vault's genesis hashes to. -/
def noVault : Hash := ⟨List.replicate 32 0⟩

/-- The type of types' own facts: built in, in no vault (`noVault`), and its own type. -/
def typeOfTypesFacts (H : Bytes → Hash) : Facts := ⟨typeOfTypes H, noVault, typeOfTypes H⟩

/-- The type of types is a type Doc: its own type. -/
theorem typeOfTypes_typed (H : Bytes → Hash) : (typeOfTypesFacts H).isType H = true := by
  simp [Facts.isType, typeOfTypesFacts]

end Aven.Core
