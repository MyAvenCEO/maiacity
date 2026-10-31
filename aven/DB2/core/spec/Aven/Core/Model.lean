import Aven.Core.Verdicts
import Aven.Core.Limits
import Aven.Core.Json
import Aven.Core.Op
import Aven.Core.TargetCbor
import Lean.Data.Json

/-!
# What the running model answers

`aven-core-model` (`Model.lean` beside the spec) and the vectors (`past.json`, `counts.json`) answer from here, so the
property tests and the vectors ask the same Lean. Envelopes are named by BLAKE3 (`Envelope.name blake3`).

A **world** is envelopes, which of them a reader holds (`S`), which are unfit, which unauthorized and which revoked (an
envelope with the name of one of them is), the verdicts `Counts` takes and a version's tips. Its answer gives, for each
envelope `a` of the world: its name; `past`, the names before it among `S`; `inPast`, whether each envelope of `S` is
before it; `split` with each envelope of the world; and whether its whole past is held (`closed`), it is `discounted`, `counts` and is held by the version.
-/

namespace Aven.Core.Model

open Lean Aven.Core Aven.Core.Past

def hexVal (c : Char) : Option Nat :=
  if '0' ≤ c ∧ c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c ∧ c ≤ 'f' then some (c.toNat - 'a'.toNat + 10)
  else none

/-- Bytes from lowercase hex, tail recursive: an envelope can be a megabyte. -/
def unhexChars (cs : List Char) : Option Bytes :=
  let rec go : List Char → List UInt8 → Option (List UInt8)
    | [], acc => some acc.reverse
    | a :: b :: rest, acc => match hexVal a, hexVal b with
      | some x, some y => go rest ((x * 16 + y).toUInt8 :: acc)
      | _, _ => none
    | [_], _ => none
  go cs []

def unhex? (s : String) : Option Bytes := unhexChars s.toList

/-- A hash from its readable form, `b3:<hex>`: a vault's name. -/
def hash? (s : String) : Option Hash :=
  match s.toList with
  | 'b' :: '3' :: ':' :: rest => (unhexChars rest).map fun b => ⟨b⟩
  | _ => none

/-- A Doc id from its readable form, `d:<hex>`. -/
def docId? (s : String) : Option DocId :=
  match s.toList with
  | 'd' :: ':' :: rest => (unhexChars rest).map fun b => ⟨⟨b⟩⟩
  | _ => none

def nm (e : Envelope) : Hash := e.name blake3

structure World where
  all : List Envelope
  held : List Bool
  unfit : List Nat
  unauthorized : List Nat
  revoked : List Nat
  tips : List Nat

namespace World

def S (w : World) : List Envelope := (w.all.zip w.held).filterMap fun (e, h) => if h then some e else none

/-- Not one of `bad`: an envelope with the name of none of them. -/
def notIn (w : World) (bad : List Nat) (nm : Envelope → Hash) (x : Envelope) : Bool :=
  !(bad.any fun i => match w.all[i]? with | some b => nm b == nm x | none => false)

def version (w : World) (nm : Envelope → Hash) : Version := w.tips.filterMap fun i => w.all[i]?.map nm

/-- A name from a table of names worked out once (BLAKE3 in Lean is slow, and the rounds ask for a name many times);
the table holds `nm`'s names, so it gives exactly `nm`. -/
def lookup (table : List (Envelope × Hash)) (e : Envelope) : Hash :=
  match table.find? (fun p => p.1 == e) with
  | some p => p.2
  | none => nm e

def answer (w : World) : Json :=
  let S := w.S
  let table := w.all.map fun e => (e, nm e)
  let nm := lookup table
  Json.mkObj [
    ("names", toJson (w.all.map fun e => (nm e).text)),
    ("past", toJson (w.all.map fun a => (past nm S a).map Hash.text)),
    ("inPast", toJson (w.all.map fun a => S.map fun b => inPast nm S a b)),
    ("split", toJson (w.all.map fun a => w.all.map fun b => splitB nm a b)),
    ("closed", toJson (w.all.map (closedB nm S))),
    ("discounted", toJson (w.all.map (discountedB nm S))),
    ("counts", toJson (w.all.map (countsB nm (w.notIn w.unfit nm) (w.notIn w.unauthorized nm)
      (fun x => !w.notIn w.revoked nm x) S))),
    ("holds", toJson (w.all.map (holdsB nm S (w.version nm))))]

end World

def encodesOpt : Option Value → Json
  | some v => hex (encode v)
  | none => Json.null

/-! ## Coverage and bounds -/

/-- Targets, the facts of some Docs, and who governs whom, which actor spawned which and what each collection lists, as
pairs: for each target, whether it covers each Doc (`Target.coversB`), and whether it narrows each target
(`Target.le`). -/
structure Coverage where
  targets : List Target
  facts : List Facts
  gov : List (Hash × Hash)
  spawned : List (DocId × DocId)
  lists : List (DocId × DocId)

def Coverage.answer (c : Coverage) : Json :=
  let gov v w := c.gov.contains (v, w)
  let spawned a b := c.spawned.contains (a, b)
  let lists a b := c.lists.contains (a, b)
  Json.mkObj [
    ("covers", toJson (c.targets.map fun t => c.facts.map (t.coversB gov spawned lists))),
    ("le", toJson (c.targets.map fun a => c.targets.map fun b => a.le b))]

/-- A bound from its Value (`Bound.value`): null for any value, else an array of the values it allows. -/
def boundOf? : Value → Option Bound
  | .null => some none
  | .array vs => some (some vs)
  | _ => none

def valueOf (h : String) : Except String Value :=
  match unhex? h >>= decodeAll with
  | some v => pure v
  | none => throw s!"not a Value: {h}"

def docPair (p : List String) : Except String (DocId × DocId) :=
  match p with
  | [a, b] => match docId? a, docId? b with
    | some x, some y => pure (x, y)
    | _, _ => throw "not two Doc ids"
  | _ => throw "not a pair"

def factsOf (j : Json) : Except String Facts := do
  let id ← j.getObjValAs? String "id"
  let vault ← j.getObjValAs? String "vault"
  let type ← j.getObjValAs? String "type"
  match docId? id, hash? vault, docId? type with
  | some i, some v, some t => pure ⟨i, v, t⟩
  | _, _, _ => throw "facts: not a Doc id, a vault's name and a type"

def coverageCase (j : Json) : Except String Json := do
  let targets ← (← j.getObjValAs? (List String) "targets").mapM fun h => do
    match Target.ofValue? (← valueOf h) with
    | some t => pure t
    | none => throw s!"not a target: {h}"
  let facts ← (← j.getObjValAs? (List Json) "facts").mapM factsOf
  let gov ← (← j.getObjValAs? (List (List String)) "gov").mapM fun
    | [a, b] => match hash? a, hash? b with
      | some x, some y => pure (x, y)
      | _, _ => throw "gov: not two vaults' names"
    | _ => throw "gov: not a pair"
  let spawned ← (← j.getObjValAs? (List (List String)) "spawned").mapM docPair
  let lists ← (← j.getObjValAs? (List (List String)) "lists").mapM docPair
  return Coverage.answer ⟨targets, facts, gov, spawned, lists⟩

def boundsCase (j : Json) : Except String Json := do
  let bounds ← (← j.getObjValAs? (List String) "bounds").mapM fun h => do
    match boundOf? (← valueOf h) with
    | some b => pure b
    | none => throw s!"not a bound: {h}"
  let values ← (← j.getObjValAs? (List String) "values").mapM valueOf
  return Json.mkObj [
    ("allows", toJson (bounds.map fun b => values.map b.allows)),
    ("within", toJson (bounds.map fun a => bounds.map a.within))]

/-- One case of the running model:
- `{"envelopes": [hex], "held": [bool], "unfit": [index], "unauthorized": [index], "revoked": [index], "tips": [index]}`, envelopes in CBOR: a world's answer;
- `{"accept": hex}`: what `Envelope.accept`, `Signed.accept`, `Target.ofValue?`, `Call.ofValue?` and `Bound.ofValue?`
  take from those bytes, encoded
  again, or null;
- `{"targets": [hex], "facts": [{"id", "vault", "type"}], "gov": [[vault, vault]], "spawned": [[doc, doc]],
  "lists": [[doc, doc]]}`: coverage and narrowing (`Coverage`);
- `{"bounds": [hex], "values": [hex]}`: whether each bound allows each value, and is within each bound. -/
def answerCase (j : Json) : Except String Json := do
  if let .ok h := j.getObjValAs? String "accept" then
    let bs ← (unhex? h).elim (.error "accept: not hex") pure
    return Json.mkObj [("envelope", encodesOpt ((Envelope.accept bs).map Envelope.value)),
      ("signed", encodesOpt ((Signed.accept bs).map Signed.value)),
      ("target", encodesOpt ((decodeAll bs >>= Target.ofValue?).map Target.value)),
      ("call", encodesOpt ((decodeAll bs >>= Call.ofValue?).map Call.value)),
      ("bound", encodesOpt ((decodeAll bs >>= Bound.ofValue?).map Bound.value))]
  if (j.getObjVal? "targets").isOk then return ← coverageCase j
  if (j.getObjVal? "bounds").isOk then return ← boundsCase j
  let hexes ← j.getObjValAs? (List String) "envelopes"
  let all ← hexes.mapM fun h => match unhex? h >>= Envelope.accept with
    | some e => pure e
    | none => throw s!"not an envelope: {h}"
  let held ← j.getObjValAs? (List Bool) "held"
  let unfit ← j.getObjValAs? (List Nat) "unfit"
  let unauthorized ← j.getObjValAs? (List Nat) "unauthorized"
  let revoked ← j.getObjValAs? (List Nat) "revoked"
  let tips ← j.getObjValAs? (List Nat) "tips"
  if held.length ≠ all.length then throw "held: one per envelope"
  return World.answer ⟨all, held, unfit, unauthorized, revoked, tips⟩

end Aven.Core.Model
