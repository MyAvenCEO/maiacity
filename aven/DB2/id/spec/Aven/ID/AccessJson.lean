import Aven.ID.AccessRecords
import Aven.ID.CapsExamples
import Aven.ID.KeyFormatsJson
import Aven.Core.Json
import Lean.Data.Json

/-! # avenID's Records as vectors (`vectors/access.json`)

Values that fit or don't fit avenID's built-in types (`Aven.ID.AccessRecords`), each with the type it is checked
against. Every vector is `{"name", "input": {"type": "d:…", "value": Value}, "expected"}`, the Value as Core's vectors
write one (`Aven.Core.Value.json`). Expected is `{"fits": true, "name": …}` for one that fits, its name being the cap's
digest, the revocation's id or the epoch's name; `{"fits": false}` for one that doesn't; and `{"fits": null}` for a
type that isn't avenID's. -/

open Lean Aven.Core

namespace Aven.ID.AccessJson

open Aven.ID



def vec (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

/-- Two signatures as they lie beside a Record: a device's and an owner's, of made-up bytes. -/
def sigs : List SigEntry :=
  [⟨(List.range 32).map (·.toUInt8), (List.range 64).map fun i => (i + 1).toUInt8⟩,
   ⟨(List.range 32).map fun i => (i + 7).toUInt8, (List.range 64).map fun i => (i + 9).toUInt8⟩]

def fits (t : DocId) (v : Value) : Json :=
  match idBuiltinFit t with
  | none => Json.mkObj [("fits", Json.null)]
  | some f =>
    if f v then
      let name : String :=
        if t = capType then ((CapRecord.ofValue? v).map fun r => r.cap.id).getD ""
        else if t = revokeType then ((RevokeRecord.ofValue? v).map fun r => r.revocation.id.text).getD ""
        else ((EpochRecord.ofValue? v).map fun r => r.epoch.name.text).getD ""
      Json.mkObj [("fits", true), ("name", name)]
    else Json.mkObj [("fits", false)]

def case (name : String) (t : DocId) (v : Value) : Json :=
  vec name (Json.mkObj [("type", t.text), ("value", v.json)]) (fits t v)

/-- A map with one field replaced, or added where the codec's order puts it. -/
def setField (v : Value) (k : String) (x : Value) : Value :=
  match v with
  | .map kvs => .map (insertKey (recKey k, x) (kvs.filter (·.1 != recKey k)))
  | v => v

def dropField (v : Value) (k : String) : Value :=
  match v with
  | .map kvs => .map (kvs.filter (·.1 != recKey k))
  | v => v

def caps : List (String × Cap) :=
  [("cap-a", capA), ("cap-b, held by a group", capB), ("a public cap", capPublic), ("Aven's cap", capAven),
   ("an actor host's cap", capHost), ("an attenuation", attRead), ("a keep cap", keepBob)]

def revocations : List (String × Revocation) :=
  [("living in the Doc", ⟨RevokeExamples.revA, RevokeExamples.capA, some (RevokeExamples.nm RevokeExamples.r0), none⟩),
   ("living elsewhere", ⟨RevokeExamples.revT, RevokeExamples.capTeam, none, none⟩),
   ("living elsewhere, with a kept list", ⟨RevokeExamples.revT, RevokeExamples.capTeam, none, some [RevokeExamples.nm RevokeExamples.x1]⟩)]

def epochs : List (String × KeyFormats.Epoch) :=
  [("a keyring's second epoch", KeyFormats.keyringEpoch), ("a Doc's first epoch", KeyFormats.docEpoch)]

def capRecord (c : Cap) : Value := (CapRecord.mk c sigs).value
def revokeRecord (r : Revocation) : Value := (RevokeRecord.mk r sigs).value
def epochRecord (e : KeyFormats.Epoch) : Value := (EpochRecord.mk e sigs).value

def accessVectors : List Json :=
  caps.map (fun (n, c) => case s!"a cap Record: {n}" capType (capRecord c)) ++
  revocations.map (fun (n, r) => case s!"a revoke Record: {n}" revokeType (revokeRecord r)) ++
  epochs.map (fun (n, e) => case s!"an epoch Record: {n}" epochType (epochRecord e)) ++
  [case "a cap Record with no signatures yet" capType (CapRecord.mk capA []).value,
   -- what doesn't fit
   case "a cap's bare body, no sigs" capType capA.body,
   case "a cap Record with a field it doesn't have" capType (setField (capRecord capA) "note" (.text (recKey "hi"))),
   case "a cap Record missing its conditions" capType (dropField (capRecord capA) "conditions"),
   case "a cap Record whose share is text" capType (setField (capRecord capA) "share" (.text (recKey "1"))),
   case "a cap Record of an unknown form" capType (setField (capRecord capA) "form" (.text (recKey "lend"))),
   case "a cap Record whose op id is 31 bytes" capType
     (capRecord { capA with grant := capA.grant.map fun l => { l with op := ⟨l.op.bytes.take 31⟩ } }),
   case "a cap Record whose signer is text" capType
     (setField (capRecord capA) "sigs" (.array [.map [(recKey "sig", .bytes [1]), (recKey "signer", .text [2])]])),
   case "a cap Record whose sigs is no list" capType (setField (capRecord capA) "sigs" .null),
   case "a cap Record checked as a revocation" revokeType (capRecord capA),
   case "a revoke Record whose cap is 31 bytes" revokeType
     (setField (revokeRecord ⟨RevokeExamples.revA, RevokeExamples.capA, none, none⟩) "cap" (.bytes (RevokeExamples.capA.bytes.take 31))),
   case "a revoke Record with neither kept nor envelope written" revokeType
     (dropField (dropField (revokeRecord ⟨RevokeExamples.revT, RevokeExamples.capTeam, none, none⟩) "kept") "envelope"),
   case "an epoch Record checked as a cap" capType (epochRecord KeyFormats.docEpoch),
   case "an epoch Record of another scheme" epochType
     (setField (epochRecord KeyFormats.docEpoch) "scheme" (.text (recKey "tree 1"))),
   case "a Doc's epoch with a vault key" epochType
     (epochRecord { KeyFormats.docEpoch with vault := some ((List.range 48).map (·.toUInt8)) }),
   case "a keyring's epoch without its vault key" epochType
     (epochRecord { KeyFormats.keyringEpoch with vault := none }),
   case "an epoch Record whose stanza is short" epochType
     (epochRecord { KeyFormats.docEpoch with stanzas := [{ KeyFormats.patternStanza 20 true with ct := [1, 2] }] }),
   case "a number, not a Record" capType (.uint 7),
   -- a type that isn't avenID's
   case "a Record of a type that isn't avenID's" (builtinType "tree") (capRecord capA),
   case "a Record of the type of types" (typeOfTypes blake3) (capRecord capA)]

end Aven.ID.AccessJson
