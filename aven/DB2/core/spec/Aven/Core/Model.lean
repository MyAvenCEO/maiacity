import Aven.Core.Verdicts
import Aven.Core.Limits
import Aven.Core.Json
import Lean.Data.Json

/-!
# What the running model answers

`aven-core-model` (`Model.lean` beside the spec) and the vectors (`past.json`, `counts.json`) answer from here, so the
property tests and the vectors ask the same Lean. Envelopes are named by BLAKE3 (`Envelope.name blake3`).

A **world** is envelopes, which of them a reader holds (`S`), which are bad (`ok` is false for an envelope with a bad
one's name: what the other verdicts, fit and authorized, would refuse) and a version's tips. Its answer gives, for each
envelope `a` of the world: its name; `past`, the names before it among `S`; `inPast`, whether each envelope of `S` is
before it; `split` with each envelope of the world; and whether it is `discounted`, `counts` and is held by the version.
-/

namespace Aven.Core.Model

open Lean Aven.Core Aven.Core.Past

def hexVal (c : Char) : Option Nat :=
  if '0' ≤ c ∧ c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c ∧ c ≤ 'f' then some (c.toNat - 'a'.toNat + 10)
  else none

/-- Bytes from lowercase hex, tail recursive: an envelope can be a megabyte. -/
def unhex? (s : String) : Option Bytes :=
  let rec go : List Char → List UInt8 → Option (List UInt8)
    | [], acc => some acc.reverse
    | a :: b :: rest, acc => match hexVal a, hexVal b with
      | some x, some y => go rest ((x * 16 + y).toUInt8 :: acc)
      | _, _ => none
    | [_], _ => none
  go s.toList []

def nm (e : Envelope) : Hash := e.name blake3

structure World where
  all : List Envelope
  held : List Bool
  bad : List Nat
  tips : List Nat

namespace World

def S (w : World) : List Envelope := (w.all.zip w.held).filterMap fun (e, h) => if h then some e else none

def ok (w : World) (nm : Envelope → Hash) (x : Envelope) : Bool :=
  !(w.bad.any fun i => match w.all[i]? with | some b => nm b == nm x | none => false)

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
    ("discounted", toJson (w.all.map (discountedB nm S))),
    ("counts", toJson (w.all.map (countsB nm (w.ok nm) S))),
    ("holds", toJson (w.all.map (holdsB nm S (w.version nm))))]

end World

def encodesOpt : Option Value → Json
  | some v => hex (encode v)
  | none => Json.null

/-- One case of the running model:
- `{"envelopes": [hex], "held": [bool], "bad": [index], "tips": [index]}`, envelopes in CBOR: a world's answer;
- `{"accept": hex}`: what `Envelope.accept` and `Signed.accept` take from those bytes, encoded again, or null. -/
def answerCase (j : Json) : Except String Json := do
  if let .ok h := j.getObjValAs? String "accept" then
    let bs ← (unhex? h).elim (.error "accept: not hex") pure
    return Json.mkObj [("envelope", encodesOpt ((Envelope.accept bs).map Envelope.value)),
      ("signed", encodesOpt ((Signed.accept bs).map Signed.value))]
  let hexes ← j.getObjValAs? (List String) "envelopes"
  let all ← hexes.mapM fun h => match unhex? h >>= Envelope.accept with
    | some e => pure e
    | none => throw s!"not an envelope: {h}"
  let held ← j.getObjValAs? (List Bool) "held"
  let bad ← j.getObjValAs? (List Nat) "bad"
  let tips ← j.getObjValAs? (List Nat) "tips"
  if held.length ≠ all.length then throw "held: one per envelope"
  return World.answer ⟨all, held, bad, tips⟩

end Aven.Core.Model
