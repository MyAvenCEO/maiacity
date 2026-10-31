import Aven.Core.Target
import Aven.Core.CborLaws

/-!
# A target in CBOR (A8)

A target is a map, its keys the ones caps writes (`id/caps`, "Targets"), sorted as the codec sorts them:

| Target | Map |
|---|---|
| one Doc | `{"doc": id}` |
| a vault's Docs | `{"below": bool, "vault": vault}` |
| a vault's Docs of one root type | `{"type": type Doc, "below": bool, "vault": vault}` |
| one actor | `{"actor": id, "below": bool}` |
| a vault's actors of one definition | `{"def": type Doc, "vault": vault}` |

Doc ids are byte strings of their hash, a vault is its text. Each form has keys no other form has, so a target reads
back as itself (`Target.ofValue_value`), and an allowed one is a canonical Value (`Target.value_canon`), so a cap's
bytes, and its hash, name its targets exactly.
-/

namespace Aven.Core

/-- The keys, as their UTF-8 bytes. -/
def keyDoc : Bytes := [0x64, 0x6F, 0x63]
def keyDef : Bytes := [0x64, 0x65, 0x66]
def keyType : Bytes := [0x74, 0x79, 0x70, 0x65]
def keyActor : Bytes := [0x61, 0x63, 0x74, 0x6F, 0x72]
def keyBelow : Bytes := [0x62, 0x65, 0x6C, 0x6F, 0x77]
def keyVault : Bytes := [0x76, 0x61, 0x75, 0x6C, 0x74]

#guard keyDoc = "doc".toUTF8.toList ∧ keyDef = "def".toUTF8.toList ∧ keyType = "type".toUTF8.toList ∧
  keyActor = "actor".toUTF8.toList ∧ keyBelow = "below".toUTF8.toList ∧ keyVault = "vault".toUTF8.toList

def Target.value : Target → Value
  | .doc d => .map [(keyDoc, .bytes d.hash.bytes)]
  | .vault v b => .map [(keyBelow, .bool b), (keyVault, .text v)]
  | .vaultType v t b => .map [(keyType, .bytes t.hash.bytes), (keyBelow, .bool b), (keyVault, .text v)]
  | .actor a b => .map [(keyActor, .bytes a.hash.bytes), (keyBelow, .bool b)]
  | .vaultDef v d => .map [(keyDef, .bytes d.hash.bytes), (keyVault, .text v)]

def Target.ofValue? : Value → Option Target
  | .map [(a, .bytes d)] => if a = keyDoc then some (.doc ⟨⟨d⟩⟩) else none
  | .map [(a, .bool b), (c, .text v)] =>
    if a = keyBelow ∧ c = keyVault then some (.vault v b) else none
  | .map [(a, .bytes t), (c, .bool b), (e, .text v)] =>
    if a = keyType ∧ c = keyBelow ∧ e = keyVault then some (.vaultType v ⟨⟨t⟩⟩ b) else none
  | .map [(a, .bytes x), (c, .bool b)] =>
    if a = keyActor ∧ c = keyBelow then some (.actor ⟨⟨x⟩⟩ b) else none
  | .map [(a, .bytes d), (c, .text v)] =>
    if a = keyDef ∧ c = keyVault then some (.vaultDef v ⟨⟨d⟩⟩) else none
  | _ => none

/-- A target reads back as itself. -/
theorem Target.ofValue_value (t : Target) : Target.ofValue? t.value = some t := by
  cases t <;> simp [Target.value, Target.ofValue?, keyDoc, keyDef, keyType, keyActor, keyBelow, keyVault]

/-- A target the profile allows: its vault, if it has one, is text the codec takes. -/
def Target.ok : Target → Bool
  | .vault v _ | .vaultType v _ _ | .vaultDef v _ => textOk v
  | _ => true

/-- An allowed target is a canonical Value. -/
theorem Target.value_canon (t : Target) (h : t.ok = true) (hb : ∀ d : DocId, d.hash.bytes.length < limit) :
    Canon t.value = true := by
  cases t <;> simp_all [Target.value, Target.ok, Canon, Shape, ShapeMap, depth, depthMap, keysSorted, strictlySorted, keyBytes, textOk,
    keyDoc, keyDef, keyType, keyActor, keyBelow, keyVault, limit] <;> decide

#guard (Target.vault "v:alice".toUTF8.toList true).value matches .map _
#guard Target.ofValue? (Target.doc ⟨⟨[1, 2]⟩⟩).value == some (.doc ⟨⟨[1, 2]⟩⟩)

end Aven.Core
