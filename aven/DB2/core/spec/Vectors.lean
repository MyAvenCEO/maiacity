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
- `signed.json`: signed things; what their signer signs, their whole encoding and their name.
- `limits.json`: the limits (`Aven.Core.Limits`), then envelopes and signed things exactly at each limit and one past
  it: their size encoded and whether a reader accepts them. Where `bodyZeros` is given, the body is that many zero
  bytes (a megabyte written out would be two in hex).
- `past.json`: generated worlds (`Aven.Core.Model`): envelopes and which a reader holds; for each envelope, the names
  before it and whether each held one is before it.
- `counts.json`: the same worlds with bad envelopes and a version's tips; for each envelope, whether it is discounted,
  counts and is held by the version.
- `targets.json`: pairs of targets; whether the first narrows the second, and which Docs each covers.
- `target-bytes.json`: each target form, readable, and its CBOR in hex (`Aven.Core.TargetCbor`); and the CBOR of
  targets whose Doc or type id isn't 32 bytes, refused on read (`expected` null).
- `ops.json`: `core/1`'s ops, each with its stored form and its id; a call as an envelope's body carries it, and one
  whose params are out of order or whose op isn't 32 bytes, refused on read (`expected` null); the type of types'
  id; bounds in CBOR, read back, and Values that are no bound, refused; and
  bounds on a parameter, whether a value is within one, and whether one is within another (`Aven.Core.Op`, A32).

Values are shown in their readable form (`Aven.Core.Json`).
-/

open Lean Aven.Core

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

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

/-- `v` inside `n` arrays. -/
def wrap : Nat → Value → Value
  | 0, v => v
  | n + 1, v => .array [wrap n v]

/-- `v` inside `n` maps, each under the key "a". -/
def wrapMap : Nat → Value → Value
  | 0, v => v
  | n + 1, v => .map [(k "a", wrapMap n v)]

/-- The depth limit from both sides: Values as deep as allowed, read back, and one deeper, refused. -/
def deepExamples (n : Nat) : List (String × Value) :=
  [(s!"arrays {n} deep", wrap (n - 1) (.array [])), (s!"maps {n} deep", wrapMap (n - 1) (.map [])),
    (s!"an integer {n} deep", wrap (n - 1) (.uint 1))]

def tooDeep : List (String × Bytes) := (deepExamples (maxDepth + 1)).map fun (name, v) => (name, encode v)

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
  (deepExamples maxDepth).map (fun (name, v) => vector name v.json (encodes v)) ++
  (refusalExamples ++ generatedRefusals ++ tooDeep).map fun (name, bs) => vector name (hex bs) (decodes bs)

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

/-- An envelope of another writer that builds on both of the first writer's. -/
def e3 : Envelope :=
  { env 43 1 none (.map [(k "post", .text (k "builds on both"))]) with deps := [e2.name blake3, e1.name blake3] }

def envelopes : List Json :=
  [("the first", e1), ("the second", e2), ("with deps", e3)].map fun (name, e) =>
    vector name e.json
      (Json.mkObj [("signs", hex e.signing), ("cbor", encodes e.value), ("name", (e.name blake3).text)])

def splitB (a b : Envelope) : Bool :=
  a.doc == b.doc && a.branch == b.branch && a.writer == b.writer && a.seq == b.seq && a.name blake3 != b.name blake3

def logs : List Json :=
  [("two places of one log", e1, e2), ("one envelope twice", e2, e2), ("a split", e2, e2'),
   ("two writers", e2, other)].map fun (name, a, b) =>
    vector name (Json.arr #[a.json, b.json]) (toJson (splitB a b))

/-! ## Signed things -/

def Aven.Core.Signed.json (s : Signed) : Json :=
  Json.mkObj [("label", utf8Text s.label), ("body", s.body.json), ("signer", hex s.signer), ("sig", hex s.sig)]

def s1 : Signed := ⟨k "aven example 1", .map [(k "says", .text (k "hello"))], List.replicate 32 7, List.replicate 64 9⟩
def s2 : Signed := { s1 with label := k "aven example 2" }
def s3 : Signed := { s1 with signer := List.replicate 32 8, sig := List.replicate 64 10 }

def signedVectors : List Json :=
  [("a signed thing", s1), ("another label, one body", s2), ("signed again by another", s3)].map fun (name, s) =>
    vector name s.json (Json.mkObj [("signs", hex (signingBytes s.label s.body)), ("cbor", encodes s.value),
      ("name", (s.name blake3).text)])

#guard s3.name blake3 == s1.name blake3 && s2.name blake3 != s1.name blake3

/-! ## Limits -/

def zeros (n : Nat) : Value := .bytes (List.replicate n 0)

/-- `n` bytes of the letter a, as text. -/
def as (n : Nat) : Bytes := List.replicate n 97

/-- `e` with a body of zeros that makes it exactly `size` bytes encoded: its body's head grows by four bytes past
65535. -/
def envelopeOfSize (e : Envelope) (size : Nat) : Envelope × Nat :=
  let n := size - (encode { e with body := zeros 0 }.value).length - 4
  ({ e with body := zeros n }, n)

def signedOfSize (s : Signed) (size : Nat) : Signed × Nat :=
  let n := size - (encode { s with body := zeros 0 }.value).length - 4
  ({ s with body := zeros n }, n)

def limitEnvelopes : List (String × Envelope) :=
  [(s!"{maxDeps} deps", { e1 with deps := List.replicate maxDeps (e1.name blake3) }),
   (s!"{maxDeps + 1} deps", { e1 with deps := List.replicate (maxDeps + 1) (e1.name blake3) }),
   (s!"a branch of {maxBranchBytes} bytes", { e1 with branch := as maxBranchBytes }),
   (s!"a branch of {maxBranchBytes + 1} bytes", { e1 with branch := as (maxBranchBytes + 1) }),
   (s!"a signer of {maxSignerBytes} bytes", { e1 with signer := List.replicate maxSignerBytes 7 }),
   (s!"a signer of {maxSignerBytes + 1} bytes", { e1 with signer := List.replicate (maxSignerBytes + 1) 7 }),
   (s!"a signature of {maxSigBytes} bytes", { e1 with sig := List.replicate maxSigBytes 9 }),
   (s!"a signature of {maxSigBytes + 1} bytes", { e1 with sig := List.replicate (maxSigBytes + 1) 9 })]

def limitSigned : List (String × Signed) :=
  [(s!"a label of {maxLabelBytes} bytes", { s1 with label := as maxLabelBytes }),
   (s!"a label of {maxLabelBytes + 1} bytes", { s1 with label := as (maxLabelBytes + 1) }),
   (s!"a signer of {maxSignerBytes} bytes", { s1 with signer := List.replicate maxSignerBytes 7 }),
   (s!"a signer of {maxSignerBytes + 1} bytes", { s1 with signer := List.replicate (maxSignerBytes + 1) 7 }),
   (s!"a signature of {maxSigBytes} bytes", { s1 with sig := List.replicate maxSigBytes 9 }),
   (s!"a signature of {maxSigBytes + 1} bytes", { s1 with sig := List.replicate (maxSigBytes + 1) 9 })]

def accepted (bs : Bytes) (ok : Bool) : Json := Json.mkObj [("bytes", toJson bs.length), ("accepted", toJson ok)]

def limits : List Json :=
  [vector "the limits" Json.null (Json.mkObj [("maxEnvelopeBytes", toJson maxEnvelopeBytes),
    ("maxDeps", toJson maxDeps), ("maxBranchBytes", toJson maxBranchBytes), ("maxLabelBytes", toJson maxLabelBytes),
    ("maxSignerBytes", toJson maxSignerBytes), ("maxSigBytes", toJson maxSigBytes), ("maxDepth", toJson maxDepth)])] ++
  (limitEnvelopes.map fun (name, e) =>
    let bs := encode e.value
    vector s!"an envelope, {name}" (Json.mkObj [("envelope", e.json)]) (accepted bs (Envelope.accept bs).isSome)) ++
  ([maxEnvelopeBytes, maxEnvelopeBytes + 1].map fun size =>
    let (e, n) := envelopeOfSize e1 size
    let bs := encode e.value
    vector s!"an envelope of {size} bytes" (Json.mkObj [("envelope", { e with body := .null }.json), ("bodyZeros", toJson n)])
      (accepted bs (Envelope.accept bs).isSome)) ++
  (limitSigned.map fun (name, s) =>
    let bs := encode s.value
    vector s!"a signed thing, {name}" (Json.mkObj [("signed", s.json)]) (accepted bs (Signed.accept bs).isSome)) ++
  ([maxEnvelopeBytes, maxEnvelopeBytes + 1].map fun size =>
    let (s, n) := signedOfSize s1 size
    let bs := encode s.value
    vector s!"a signed thing of {size} bytes" (Json.mkObj [("signed", { s with body := .null }.json), ("bodyZeros", toJson n)])
      (accepted bs (Signed.accept bs).isSome))

/-! ## The past and the verdicts, on generated worlds -/

/-- A small world where splits and shared parents are common: two Docs, two writers, three places, bodies from four.
Each envelope names earlier ones, or a name nobody holds, as its prev and deps. -/
def Rng.world (r : Rng) : Aven.Core.Model.World × Rng := Id.run do
  let (n, r) := r.below 10
  let mut r := r
  let mut all : Array Envelope := #[]
  let mut held : Array Bool := #[]
  let pick (all : Array Envelope) (r : Rng) : Hash × Rng :=
    let (i, r) := r.below (all.size + 1)
    if h : i < all.size then (all[i].name blake3, r) else (blake3 [i.toUInt8, 0xFF], r)
  for _ in [0:n + 1] do
    let (d, r1) := r.below 2
    let (w, r2) := r1.below 2
    let (s, r3) := r2.below 3
    let (hasPrev, r4) := r3.below 3
    let (p, r5) := pick all r4
    let (nd, r6) := r5.below 3
    let (deps, r7) := r6.many nd (pick all)
    let (b, r8) := r7.below 4
    let (h, r9) := r8.below 3
    r := r9
    let e : Envelope := Envelope.mk ⟨blake3 [d.toUInt8]⟩ (k "main") w (s + 1)
      (if hasPrev = 0 then none else some p) deps (.uint b) (List.replicate 32 7) (List.replicate 64 9)
    all := all.push e
    held := held.push (h ≠ 0)
  let (nb, r') := r.below 3
  let (bad, r') := r'.many nb fun r => r.below all.size
  let (nt, r') := r'.below 3
  let (tips, r') := r'.many nt fun r => r.below all.size
  return (⟨all.toList, held.toList, bad, tips⟩, r')

def worlds : List Aven.Core.Model.World :=
  (List.range 40).map fun i => (Rng.world (Rng.seed (1000 + i))).1

def worldInput (w : Aven.Core.Model.World) : List (String × Json) :=
  [("envelopes", Json.arr (w.all.map Envelope.json).toArray), ("held", toJson w.held)]

def pastVectors : List Json :=
  worlds.zipIdx.map fun (w, i) =>
    let a := w.answer
    vector s!"world {i + 1}" (Json.mkObj (worldInput w))
      (Json.mkObj [("past", a.getObjValD "past"), ("inPast", a.getObjValD "inPast")])

def countsVectors : List Json :=
  worlds.zipIdx.map fun (w, i) =>
    let a := w.answer
    vector s!"world {i + 1}" (Json.mkObj (worldInput w ++ [("bad", toJson w.bad), ("tips", toJson w.tips)]))
      (Json.mkObj [("discounted", a.getObjValD "discounted"), ("counts", a.getObjValD "counts"),
        ("holds", a.getObjValD "holds")])

/-! ## Targets and footprints -/

def Aven.Core.Target.json : Target → Json
  | .doc d r => Json.mkObj [("doc", d.text), ("reach", r.name)]
  | .vault v b => Json.mkObj [("vault", utf8Text v), ("below", toJson b)]
  | .vaultType v t b => Json.mkObj [("vault", utf8Text v), ("type", t.text), ("below", toJson b)]

def invoice : DocId := ⟨blake3 (k "the invoice type's genesis")⟩
def alice : Bytes := k "v:alice"
def coop : Bytes := k "v:maia-city"
def actorA : DocId := ⟨blake3 (k "an actor's genesis")⟩

def targetPairs : List (String × Target × Target) := [
  ("a vault without below, in one with it", .vault alice false, .vault alice true),
  ("a vault with below, in one without it", .vault alice true, .vault alice false),
  ("a type of a vault, in the vault", .vaultType alice invoice false, .vault alice false),
  ("a type, below, in the vault without below", .vaultType alice invoice true, .vault alice false),
  ("a vault's actors of one definition, in that vault", .vaultType alice actorA false, .vaultType alice actorA true),
  ("another vault", .vault coop false, .vault alice true),
  ("an actor, in it with what it spawned", .doc actorA .self, .doc actorA .spawned),
  ("a collection, in it with what it lists", .doc actorA .self, .doc actorA .lists),
  ("what it spawned, in what it lists", .doc actorA .spawned, .doc actorA .lists),
  ("a Doc, in a vault: read from the two targets alone, never", .doc actorA .self, .vault alice true)]

/-- Each target form, its readable form and its CBOR: what a cap's bytes hold (`Aven.Core.TargetCbor`). -/
def targetForms : List (String × Target) := [
  ("one Doc", .doc invoice .self), ("one actor and what it spawned", .doc actorA .spawned),
  ("a collection and what it lists", .doc invoice .lists), ("a vault's Docs", .vault alice false),
  ("and below", .vault alice true), ("a vault's Docs of one type", .vaultType alice invoice false)]

/-- Targets whose ids aren't hashes: their CBOR, refused on read (`expected` null). -/
def badTargets : List (String × Target) := [
  ("a Doc id of 31 bytes", .doc ⟨⟨List.replicate 31 1⟩⟩ .self),
  ("a Doc id of 33 bytes", .doc ⟨⟨List.replicate 33 1⟩⟩ .spawned),
  ("a type id of 31 bytes", .vaultType alice ⟨⟨List.replicate 31 1⟩⟩ false),
  ("a type id of 33 bytes", .vaultType alice ⟨⟨List.replicate 33 1⟩⟩ true)]

#guard badTargets.all fun (_, t) => Canon t.value && Target.ofValue? t.value == none

def targetBytes : List Json :=
  targetForms.map (fun (name, t) => vector name t.json (encodes t.value)) ++
  badTargets.map fun (name, t) => vector s!"refused: {name}" (encodes t.value) Json.null

#guard targetForms.all fun (_, t) => Canon t.value && t.idsOk && Target.ofValue? t.value == some t

def targets : List Json :=
  targetPairs.map fun (name, a, b) => vector name (Json.arr #[a.json, b.json]) (toJson (a.le b))

def Aven.Core.Step.json (s : Step) : Json :=
  Json.mkObj [("type", s.type.text), ("verb", s.verb.name), ("fields", toJson (s.fields.map utf8Text))]

def Aven.Core.Bound.json : Bound → Json
  | none => Json.null
  | some vs => Json.arr (vs.map Value.json).toArray

/-- `core/1`'s ops: each one's stored form and its id. -/
def coreOps : List Json :=
  [CoreOp.read, .put, .patch, .remove, .edit, .tell, .keep, .share].map fun o =>
    vector s!"core/1's {o.name}" o.value.json
      (Json.mkObj [("id", (o.id blake3).text), ("cbor", hex (encode o.value)), ("writes", toJson o.writes)])

def status : Value := .text (k "status")
def total : Value := .text (k "total")

/-- Bounds on a parameter: whether each allows a value, and whether one is within another. -/
def boundAllows : List (String × Bound × Value × Bool) := [
  ("any value", none, total, true),
  ("one of these", some [status], status, true),
  ("not one of these", some [status], total, false),
  ("a list, each element one of these", some [status, total], .array [status, total], true),
  ("a list with one element outside", some [status], .array [status, total], false)]

def boundWithin : List (String × Bound × Bound × Bool) := [
  ("fewer values, within more", some [status], some [status, total], true),
  ("more values, within fewer", some [status, total], some [status], false),
  ("any value, within one of these", none, some [status], false),
  ("one of these, within any", some [status], none, true)]

#guard boundAllows.all fun (_, b, v, a) => b.allows v == a
#guard boundWithin.all fun (_, a, b, w) => a.within b == w

/-- A call to `core/1`'s patch: a type Doc and the fields it sets, as an envelope's body carries it. -/
def patchCall : Call :=
  ⟨CoreOp.patch.id blake3, [(k "type", .bytes (blake3 (k "type:task")).bytes), (k "fields", .array [status])]⟩

#guard Canon patchCall.value

/-- The same call with its params out of the codec's order: not canonical, so no call; its bytes are refused. -/
def unsortedCall : Call := { patchCall with params := patchCall.params.reverse }

#guard !Canon unsortedCall.value && (decodeAll (encode unsortedCall.value)).isNone

def calls : List Json :=
  [vector "a call to core/1's patch: a type and the fields it sets" patchCall.value.json
    (Json.mkObj [("cbor", hex (encode patchCall.value)), ("op", (CoreOp.patch.id blake3).text)]),
   vector "a call with its params out of order: refused on read" (hex (encode unsortedCall.value)) Json.null,
   vector "a call whose op isn't 32 bytes: refused on read"
     (hex (encode (Call.value { patchCall with op := ⟨List.replicate 31 1⟩ }))) Json.null]

#guard Call.ofValue? patchCall.value == some patchCall
#guard Call.ofValue? (Call.value { patchCall with op := ⟨List.replicate 31 1⟩ }) == none

/-- Bounds in CBOR: each read back, and Values that are no bound, refused (`expected` null). -/
def boundBytes : List Json :=
  ([("any value", (none : Bound)), ("one of these", some [status, total]), ("none at all", some [])].map
    fun (name, b) => vector s!"a bound: {name}" (hex (encode (Bound.value b))) (Bound.json b)) ++
  ([("text", status), ("a map", .map [(k "a", status)])].map fun (name, v) =>
    vector s!"no bound: {name}" (hex (encode v)) Json.null)

#guard [status, .map [(k "a", status)]].all fun v => (Bound.ofValue? v).isNone

def ops : List Json :=
  coreOps ++ calls ++
  [vector "the type of types" (utf8Text (k "avenDB type of types 1")) (typeOfTypes blake3).text] ++
  (boundAllows.map fun (name, b, v, _) =>
    vector s!"does it allow? {name}" (Json.mkObj [("bound", b.json), ("value", v.json)]) (toJson (b.allows v))) ++
  (boundWithin.map fun (name, a, b, _) =>
    vector s!"is it within? {name}" (Json.arr #[a.json, b.json]) (toJson (a.within b))) ++
  boundBytes

/-! ## Checks before writing -/

-- every generated Value is allowed and decodes back from its encoding; every refusal is refused
#guard randomValues.all fun v => Canon v && (decodeAll (encode v)).map encode == some (encode v)
#guard (refusalExamples ++ generatedRefusals).all fun (_, bs) => (decodeAll bs).isNone
#guard valueExamples.all fun (_, v) => Canon v
-- the limit: 512 deep is allowed and reads back, 513 is neither, though its forms are the profile's
#guard (deepExamples maxDepth).all fun (_, v) => depth v == maxDepth && Canon v &&
  (decodeAll (encode v)).map encode == some (encode v)
#guard (deepExamples (maxDepth + 1)).all fun (_, v) => depth v == maxDepth + 1 && Shape v && !Canon v
#guard tooDeep.all fun (_, bs) => (decodeAll bs).isNone
#guard [e1, e2, e2', other, e3].all fun e => Canon e.value
#guard [e1, e2, e3].all fun e => Envelope.accept (encode e.value) == some e
#guard [s1, s2, s3].all fun s => Canon s.value && (Signed.accept (encode s.value)).isSome
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
  write dir "signed.json" signedVectors
  let ls := limits
  -- each pair is one at the limit, accepted, and one past it, refused; the sizes land exactly
  for (v, i) in (ls.drop 1).zipIdx do
    if (v.getObjValD "expected").getObjValD "accepted" != toJson (i % 2 == 0) then
      throw (IO.userError s!"limits: {(v.getObjValD "name").compress} is on the wrong side")
  write dir "limits.json" ls
  write dir "past.json" pastVectors
  write dir "counts.json" countsVectors
  write dir "targets.json" targets
  write dir "target-bytes.json" targetBytes
  write dir "ops.json" ops
