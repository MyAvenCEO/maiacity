import Aven.DB.Docs.Genesis
import Aven.DB.Docs.Schema

/-!
# Built-in types' fit, by whoever defines them

A built-in type is versioned by its label, so it has no schema; its shape is its definer's Lean structure (the
architect, 31 Oct 2026). Fit takes the built-in checks as a parameter, `BuiltinFit : DocId → Option (Value → Bool)`:
the docs layer supplies its own five (`docsBuiltinFit`: branch, closed, version, schema, split), avenID supplies `cap`,
`revoke` and `epoch`, and a type nobody supplies is no built-in.

A built-in Record is a statement written whole at its birth: its fields, as a map, must pass its definer's check. It is
never edited afterwards, and may be removed (`builtin_fits_iff`).

The docs five, each a map of exactly these fields:
- `branch`: `name` text, `base` a list of hashes, `nonce` a hash, and optionally `follows` text;
- `closed`: optionally `at`, a list of hashes;
- `version`: `name` text, `at` a list of hashes: a named version, on any Doc;
- `schema`: `name` text, `at` a list of hashes, and `schema` a schema's one form (`Schema.ofValue?`): a type Doc's
  version, named by its schema's hash (A39, A207, `pin_resolves_one`). It alone carries a schema;
- `split`: `writer` an unsigned integer, `after` a hash.
-/

namespace Aven.DB.Docs

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

/-- Who checks a built-in type's Records: its definer, by type Doc. -/
abbrev BuiltinFit := DocId → Option (Value → Bool)

/-- What a change does to its Record, as fit reads it. -/
inductive BuiltinKind where
  | new
  | edited
  | gone
  deriving DecidableEq, Repr

/-- A change to a Record of type `t`, which `bf` defines: written whole at birth and passing its definer's check, or
removed; never edited. `none` when no definer supplies `t`. -/
def builtinFits (bf : BuiltinFit) (t : DocId) (kind : BuiltinKind) (fields : List (Bytes × Value)) : Option Bool :=
  (bf t).map fun check => match kind with
    | .new => check (.map fields)
    | .edited => false
    | .gone => true

theorem builtin_fits_iff {bf : BuiltinFit} {t : DocId} {check : Value → Bool} (h : bf t = some check)
    {kind : BuiltinKind} {fields : List (Bytes × Value)} :
    builtinFits bf t kind fields = some true ↔ kind = .gone ∨ (kind = .new ∧ check (.map fields) = true) := by
  cases kind <;> simp [builtinFits, h]

/-! ## The docs layer's five -/

def isHash : Value → Bool
  | .bytes b => b.length == 32
  | _ => false

def isHashes : Value → Bool
  | .array xs => xs.all isHash
  | _ => false

def isText : Value → Bool
  | .text _ => true
  | _ => false

def isSchema (v : Value) : Bool := (Schema.ofValue? v).isSome

def isUint : Value → Bool
  | .uint _ => true
  | _ => false

/-- A map of exactly the given fields, each passing its check: the required ones present, nothing else, no field
twice. -/
def shape (spec : List (String × (Value → Bool) × Bool)) : Value → Bool
  | .map fs =>
    (fs.map (·.1)).Nodup &&
      fs.all (fun (f, v) => spec.any fun (n, ok, _) => k n == f && ok v) &&
      spec.all fun (n, _, required) => !required || fs.any (·.1 == k n)
  | _ => false

def branchShape : Value → Bool :=
  shape [("name", isText, true), ("base", isHashes, true), ("nonce", isHash, true), ("follows", isText, false)]
def closedShape : Value → Bool := shape [("at", isHashes, false)]
def versionShape : Value → Bool := shape [("name", isText, true), ("at", isHashes, true)]
def schemaShape : Value → Bool := shape [("name", isText, true), ("at", isHashes, true), ("schema", isSchema, true)]
def splitShape : Value → Bool := shape [("writer", isUint, true), ("after", isHash, true)]

/-- The docs layer's built-in types, each with its shape. -/
def docsBuiltinFit (H : Bytes → Hash) : BuiltinFit := fun t =>
  if t == builtinType H "branch" then some branchShape
  else if t == builtinType H "closed" then some closedShape
  else if t == builtinType H "version" then some versionShape
  else if t == builtinType H "schema" then some schemaShape
  else if t == builtinType H "split" then some splitShape
  else none

/-- Two definers' checks, the first's where both define a type. -/
def BuiltinFit.or (a b : BuiltinFit) : BuiltinFit := fun t => (a t).or (b t)

#guard versionShape (.map [(k "at", .array []), (k "name", .text (k "v1"))])
#guard !versionShape (.map [(k "name", .text (k "v1"))])
#guard !versionShape (.map [(k "at", .array []), (k "name", .text (k "v1")), (k "schema", (Schema.mk [] [] false).value)])
#guard schemaShape (.map [(k "at", .array []), (k "name", .text (k "v1")), (k "schema", (Schema.mk [] [] false).value)])
#guard !schemaShape (.map [(k "at", .array []), (k "name", .text (k "v1"))])
#guard !schemaShape (.map [(k "at", .array []), (k "name", .text (k "v1")), (k "schema", .map [])])
#guard (docsBuiltinFit blake3 (builtinType blake3 "split")).isSome
#guard (docsBuiltinFit blake3 (typeOfTypes blake3)).isNone

end Aven.DB.Docs
