import Aven.Core
import Lean.Data.Json

/-!
# The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes the core's examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`.

- `cbor.json`: Values in their readable form and their encodings in hex; byte strings the codec must refuse, with
  `expected` null. Generated Values cover every form and every argument width's edges; generated refusals widen an
  argument past its shortest form, swap two map keys, cut the bytes short or add one after them.
- `names.json`: BLAKE3 names of encodings, and type ids in their readable and CBOR forms.
- `envelopes.json`: envelopes; what their writer signs, their whole encoding and their name.
- `logs.json`: pairs of envelopes; whether they are a split.
- `targets.json`: pairs of targets; whether the first narrows the second, and which Docs each covers.
- `footprints.json`: grants and footprints; whether the grants cover them.

The readable form of a Value: integers as numbers, text as strings, arrays as arrays, maps as objects, `true`, `false`
and `null` as themselves, and a byte string as `{"bytes": hex}`.
-/

open Lean Aven.Core

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

/-! ## The readable form -/

def utf8Text (b : Bytes) : String := String.fromUTF8! ⟨b.toArray⟩

partial def Aven.Core.Value.json : Value → Json
  | .uint n => toJson n
  | .nint n => toJson (-(n : Int) - 1)
  | .bytes b => Json.mkObj [("bytes", hex b)]
  | .text b => utf8Text b
  | .array xs => Json.arr (xs.map Value.json).toArray
  | .map kvs => Json.mkObj (kvs.map fun (k, v) => (utf8Text k, v.json))
  | .bool b => toJson b
  | .null => Json.null

/-! ## Draws -/

/-- xorshift64, as the Rust property tests draw: the same file on every run. -/
structure Rng where
  s : UInt64

def Rng.seed (n : Nat) : Rng := ⟨(n.toUInt64 * 0x9e3779b97f4a7c15) ||| 1⟩

def Rng.below (r : Rng) (n : Nat) : Nat × Rng :=
  let x := r.s ^^^ (r.s <<< 13)
  let x := x ^^^ (x >>> 7)
  let x := x ^^^ (x <<< 17)
  (x.toNat % n, ⟨x⟩)

def Rng.many {α : Type} (r : Rng) (n : Nat) (f : Rng → α × Rng) : List α × Rng := Id.run do
  let mut r := r
  let mut out := #[]
  for _ in [0:n] do
    let (a, r') := f r
    out := out.push a
    r := r'
  return (out.toList, r)

/-- The edges of every argument width. -/
def edges : List Nat :=
  [0, 1, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296, 18446744073709551615]

def Rng.number (r : Rng) : Nat × Rng :=
  let (k, r) := r.below 3
  if k = 0 then let (i, r) := r.below edges.length; (edges[i]!, r)
  else if k = 1 then r.below 300
  else let (a, r) := r.below 4294967296; let (b, r) := r.below 4294967296; (a * 4294967296 + b, r)

/-- Text from a small alphabet, one, two, three and four byte characters among it. -/
def alphabet : List String := ["a", "b", "z", "0", " ", "é", "ß", "€", "語", "😀"]

def Rng.text (r : Rng) : Bytes × Rng :=
  let (n, r) := r.below 6
  let (cs, r) := r.many n fun r => let (i, r) := r.below alphabet.length; (alphabet[i]!, r)
  ((String.join cs).toUTF8.toList, r)

def insertKey (kv : Bytes × Value) : List (Bytes × Value) → List (Bytes × Value)
  | [] => [kv]
  | x :: xs =>
    if lexLt (keyBytes kv.1) (keyBytes x.1) then kv :: x :: xs
    else if keyBytes kv.1 == keyBytes x.1 then x :: xs
    else x :: insertKey kv xs

def Rng.value : Nat → Rng → Value × Rng
  | 0, r => let (n, r) := r.number; (.uint n, r)
  | d + 1, r =>
    let (k, r) := r.below 9
    match k with
    | 0 => let (n, r) := r.number; (.uint n, r)
    | 1 => let (n, r) := r.number; (.nint n, r)
    | 2 =>
      let (n, r) := r.below 40
      let (bs, r) := r.many n fun r => let (b, r) := r.below 256; (b.toUInt8, r)
      (.bytes bs, r)
    | 3 => let (t, r) := r.text; (.text t, r)
    | 4 => let (n, r) := r.below 4; let (xs, r) := r.many n (Rng.value d); (.array xs, r)
    | 5 =>
      let (n, r) := r.below 4
      let (kvs, r) := r.many n fun r => let (key, r) := r.text; let (v, r) := Rng.value d r; ((key, v), r)
      (.map (kvs.foldl (fun acc kv => insertKey kv acc) []), r)
    | 6 => (.bool true, r)
    | 7 => (.bool false, r)
    | _ => (.null, r)

def generated : Nat := 120

def randomValues : List Value :=
  (List.range generated).map fun i => (Rng.value 3 (Rng.seed (i + 1))).1

/-! ## CBOR -/

def k (s : String) : Bytes := s.toUTF8.toList

def valueExamples : List (String × Value) := [
  ("zero", .uint 0), ("23", .uint 23), ("24", .uint 24), ("1000", .uint 1000),
  ("the largest", .uint 18446744073709551615), ("minus one", .nint 0), ("minus 100", .nint 99),
  ("empty bytes", .bytes []), ("a hash", .bytes (Blake3.digest [])), ("text", .text (k "IETF")),
  ("text, four bytes a character", .text (k "😀")), ("nested arrays", .array [.uint 1, .array [.uint 2, .uint 3]]),
  ("a map, shorter key first", .map [(k "b", .uint 1), (k "aa", .uint 2)]),
  ("true", .bool true), ("false", .bool false), ("null", .null)]

def refusalExamples : List (String × Bytes) := [
  ("not the shortest: 23 in one byte", [0x18, 0x17]),
  ("not the shortest: 255 in two bytes", [0x19, 0x00, 0xFF]),
  ("not the shortest: a length", [0x58, 0x01, 0x00]),
  ("a half float", [0xF9, 0x3C, 0x00]), ("a double", [0xFB, 0x3F, 0xF0, 0, 0, 0, 0, 0, 0]),
  ("a tag", [0xC2, 0x41, 0x01]), ("an indefinite array", [0x9F, 0x01, 0xFF]),
  ("an indefinite text", [0x7F, 0x61, 0x61, 0xFF]), ("a simple value in one byte", [0xF8, 0x20]),
  ("undefined", [0xF7]), ("keys out of order", [0xA2, 0x61, 0x62, 0x01, 0x61, 0x61, 0x02]),
  ("a duplicate key", [0xA2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02]), ("a key that isn't text", [0xA1, 0x01, 0x02]),
  ("an overlong slash", [0x62, 0xC0, 0xAF]), ("a surrogate", [0x63, 0xED, 0xA0, 0x80]),
  ("a lone continuation byte", [0x61, 0x80]), ("above U+10FFFF", [0x64, 0xF4, 0x90, 0x80, 0x80]),
  ("a byte after the item", [0x01, 0x01]), ("too few bytes", [0x42, 0x01]), ("nothing", [])]

def encodes (v : Value) : Json := hex (encode v)

def decodes (bs : Bytes) : Json := match decodeAll bs with
  | some v => v.json
  | none => Json.null

/-- An encoding with its first argument widened to eight bytes: never the shortest form. -/
def widen (bs : Bytes) : Option Bytes :=
  match bs with
  | b :: _ =>
    let major := b.toNat / 32
    match readHead bs with
    | some (m, n, rest) =>
      if n < 4294967296 ∧ m ≠ 7 then some (UInt8.ofNat (major * 32 + 27) :: be 8 n ++ rest) else none
    | none => none
  | [] => none

/-- A map's first two entries swapped. -/
def swapped : Value → Option Value
  | .map (a :: b :: rest) => some (.map (b :: a :: rest))
  | _ => none

def generatedRefusals : List (String × Bytes) := Id.run do
  let mut out := #[]
  for (v, i) in randomValues.zipIdx do
    let e := encode v
    if let some w := widen e then out := out.push (s!"seed {i + 1}, widened", w)
    if let some s := swapped v then out := out.push (s!"seed {i + 1}, keys swapped", encode s)
    if e.length > 1 then out := out.push (s!"seed {i + 1}, cut short", e.dropLast)
    out := out.push (s!"seed {i + 1}, a byte after it", e ++ [0x00])
  return out.toList

def cbor : List Json :=
  valueExamples.map (fun (name, v) => vector name v.json (encodes v)) ++
  (randomValues.zipIdx.map fun (v, i) => vector s!"seed {i + 1}" v.json (encodes v)) ++
  (refusalExamples ++ generatedRefusals).map fun (name, bs) => vector name (hex bs) (decodes bs)

/-! ## Names -/

def schema : Hash := blake3 (encode (.map [(k "title", .text (k "Todo, v1"))]))
def todoType : DocId := ⟨blake3 (k "the todo type's genesis")⟩
def todoV1 : TypeId := ⟨todoType, schema⟩

def names : List Json :=
  (valueExamples.map fun (name, v) => vector name (encodes v) (nameOf blake3 v).text) ++
  [vector "a type id" (Json.mkObj [("type", todoType.text), ("schema", schema.text)])
    (Json.mkObj [("text", todoV1.text), ("cbor", encodes todoV1.value)])]

/-! ## Envelopes and logs -/

def doc : DocId := ⟨blake3 (k "a Doc's genesis")⟩

def env (writer seq : Nat) (prev : Option Hash) (body : Value) : Envelope :=
  { doc, branch := k "main", writer, seq, prev, deps := [], body,
    signer := List.replicate 32 7, sig := List.replicate 64 9 }

def e1 : Envelope := env 42 1 none (.map [(k "post", .text (k "hello"))])
def e2 : Envelope := env 42 2 (some (e1.name blake3)) (.map [(k "post", .text (k "again"))])
def e2' : Envelope := env 42 2 (some (e1.name blake3)) (.map [(k "post", .text (k "a copy says otherwise"))])
def other : Envelope := env 43 2 none (.map [(k "post", .text (k "another writer"))])

def Aven.Core.Envelope.json (e : Envelope) : Json :=
  Json.mkObj [("doc", e.doc.text), ("branch", utf8Text e.branch), ("writer", toJson e.writer), ("seq", toJson e.seq),
    ("prev", match e.prev with | some h => h.text | none => Json.null), ("deps", toJson (e.deps.map Hash.text)),
    ("body", e.body.json), ("signer", hex e.signer), ("sig", hex e.sig)]

def envelopes : List Json :=
  [("the first", e1), ("the second", e2)].map fun (name, e) =>
    vector name e.json
      (Json.mkObj [("signs", hex e.signing), ("cbor", encodes e.value), ("name", (e.name blake3).text)])

def splitB (a b : Envelope) : Bool :=
  a.doc == b.doc && a.branch == b.branch && a.writer == b.writer && a.seq == b.seq && a.name blake3 != b.name blake3

def logs : List Json :=
  [("two places of one log", e1, e2), ("one envelope twice", e2, e2), ("a split", e2, e2'),
   ("two writers", e2, other)].map fun (name, a, b) =>
    vector name (Json.arr #[a.json, b.json]) (toJson (splitB a b))

/-! ## Targets and footprints -/

def Aven.Core.Target.json : Target → Json
  | .doc d => Json.mkObj [("doc", d.text)]
  | .vault v b => Json.mkObj [("vault", utf8Text v), ("below", toJson b)]
  | .vaultType v t b => Json.mkObj [("vault", utf8Text v), ("type", t.text), ("below", toJson b)]
  | .actor a b => Json.mkObj [("actor", a.text), ("below", toJson b)]
  | .vaultDef v d => Json.mkObj [("vault", utf8Text v), ("def", d.text)]

def invoice : DocId := ⟨blake3 (k "the invoice type's genesis")⟩
def alice : Bytes := k "v:alice"
def coop : Bytes := k "v:maia-city"
def actorA : DocId := ⟨blake3 (k "an actor's genesis")⟩

def targetPairs : List (String × Target × Target) := [
  ("a vault without below, in one with it", .vault alice false, .vault alice true),
  ("a vault with below, in one without it", .vault alice true, .vault alice false),
  ("a type of a vault, in the vault", .vaultType alice invoice false, .vault alice false),
  ("a type, below, in the vault without below", .vaultType alice invoice true, .vault alice false),
  ("a definition in a vault, in that vault's type", .vaultDef alice actorA, .vaultType alice actorA true),
  ("another vault", .vault coop false, .vault alice true),
  ("a Doc, in itself as an actor", .doc actorA, .actor actorA false),
  ("an actor, in it with what it spawned", .actor actorA false, .actor actorA true)]

def targets : List Json :=
  targetPairs.map fun (name, a, b) => vector name (Json.arr #[a.json, b.json]) (toJson (a.le b))

def Aven.Core.Step.json (s : Step) : Json :=
  Json.mkObj [("type", s.type.text), ("verb", s.verb.name), ("fields", toJson (s.fields.map utf8Text))]

def Aven.Core.Grant.json (g : Grant) : Json :=
  Json.mkObj [("type", g.type.text), ("verb", g.verb.name),
    ("fields", match g.fields with | some fs => toJson (fs.map utf8Text) | none => Json.null)]

def footprintCases : List (String × List Grant × List Step) := [
  ("patching the status a grant names", [⟨invoice, .patch, some [k "status"]⟩], [⟨invoice, .patch, [k "status"]⟩]),
  ("patching a field it doesn't name", [⟨invoice, .patch, some [k "status"]⟩], [⟨invoice, .patch, [k "total"]⟩]),
  ("any field", [⟨invoice, .patch, none⟩], [⟨invoice, .patch, [k "total"], ⟩]),
  ("another verb", [⟨invoice, .patch, none⟩], [⟨invoice, .remove, []⟩]),
  ("a new invoice and its status", [⟨invoice, .putNew, none⟩, ⟨invoice, .patch, some [k "status"]⟩],
    [⟨invoice, .putNew, [k "total"]⟩, ⟨invoice, .patch, [k "status"]⟩])]

def footprints : List Json :=
  footprintCases.map fun (name, g, fp) =>
    vector name (Json.mkObj [("grants", Json.arr (g.map Grant.json).toArray),
        ("footprint", Json.arr (fp.map Step.json).toArray)])
      (toJson (covers g fp))

/-! ## Checks before writing -/

-- every generated Value is allowed and decodes back from its encoding; every refusal is refused
#guard randomValues.all fun v => Canon v && (decodeAll (encode v)).map encode == some (encode v)
#guard (refusalExamples ++ generatedRefusals).all fun (_, bs) => (decodeAll bs).isNone
#guard valueExamples.all fun (_, v) => Canon v
#guard [e1, e2, e2', other].all fun e => Canon e.value
#guard splitB e2 e2' && !splitB e1 e2 && !splitB e2 e2 && !splitB e2 other

def write (dir : System.FilePath) (file : String) (vs : List Json) : IO Unit :=
  IO.FS.writeFile (dir / file) (String.join (vs.map fun v => v.compress ++ "\n"))

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  write dir "cbor.json" cbor
  write dir "names.json" names
  write dir "envelopes.json" envelopes
  write dir "logs.json" logs
  write dir "targets.json" targets
  write dir "footprints.json" footprints
