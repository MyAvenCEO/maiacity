import Aven.Core.Target
import Aven.Core.CborLaws

/-!
# A target in CBOR (A8, A32)

A target is a map, its keys the ones caps writes (`id/caps`, "Targets"), sorted as the codec sorts them:

| Target | Map |
|---|---|
| one Doc, with what it spawned or lists, or not | `{"doc": id, "reach": "self" or "spawned" or "lists"}` |
| a vault's Docs | `{"below": bool, "vault": vault}` |
| a vault's Docs of one root type | `{"type": type Doc, "below": bool, "vault": vault}` |

Doc ids and vaults are byte strings of their 32-byte names, read through `Hash.ofValue?`: a vault is its name, never
text. Each form has keys no other form has, so a target whose ids are hashes reads back as itself (`Target.ofValue_value`), and an id of any other length is refused.
An allowed target is a canonical Value (`Target.value_canon`), so a cap's bytes, and its hash, name its targets
exactly.
-/

namespace Aven.Core

/-- The keys, and a reach's names, as their UTF-8 bytes. -/
def keyDoc : Bytes := [0x64, 0x6F, 0x63]
def keyType : Bytes := [0x74, 0x79, 0x70, 0x65]
def keyBelow : Bytes := [0x62, 0x65, 0x6C, 0x6F, 0x77]
def keyReach : Bytes := [0x72, 0x65, 0x61, 0x63, 0x68]
def keyVault : Bytes := [0x76, 0x61, 0x75, 0x6C, 0x74]

def Reach.bytes : Reach → Bytes
  | .self => [0x73, 0x65, 0x6C, 0x66]
  | .spawned => [0x73, 0x70, 0x61, 0x77, 0x6E, 0x65, 0x64]
  | .lists => [0x6C, 0x69, 0x73, 0x74, 0x73]

#guard keyDoc = "doc".toUTF8.toList ∧ keyType = "type".toUTF8.toList ∧ keyBelow = "below".toUTF8.toList ∧
  keyReach = "reach".toUTF8.toList ∧ keyVault = "vault".toUTF8.toList
#guard Reach.self.bytes = "self".toUTF8.toList ∧ Reach.spawned.bytes = "spawned".toUTF8.toList ∧
  Reach.lists.bytes = "lists".toUTF8.toList

def Reach.ofBytes? (b : Bytes) : Option Reach :=
  if b = Reach.self.bytes then some .self
  else if b = Reach.spawned.bytes then some .spawned
  else if b = Reach.lists.bytes then some .lists
  else none

theorem Reach.ofBytes_bytes (r : Reach) : Reach.ofBytes? r.bytes = some r := by
  cases r <;> decide

def Target.value : Target → Value
  | .doc d r => .map [(keyDoc, .bytes d.hash.bytes), (keyReach, .text r.bytes)]
  | .vault v b => .map [(keyBelow, .bool b), (keyVault, .bytes v.bytes)]
  | .vaultType v t b => .map [(keyType, .bytes t.hash.bytes), (keyBelow, .bool b), (keyVault, .bytes v.bytes)]

def Target.ofValue? : Value → Option Target
  | .map [(a, .bytes d), (c, .text r)] =>
    if a = keyDoc ∧ c = keyReach then
      (Hash.ofValue? (.bytes d)).bind fun h => (Reach.ofBytes? r).map (.doc ⟨h⟩ ·)
    else none
  | .map [(a, .bool b), (c, .bytes v)] =>
    if a = keyBelow ∧ c = keyVault then (Hash.ofValue? (.bytes v)).map (.vault · b) else none
  | .map [(a, .bytes t), (c, .bool b), (e, .bytes v)] =>
    if a = keyType ∧ c = keyBelow ∧ e = keyVault then
      (Hash.ofValue? (.bytes v)).bind fun v => (Hash.ofValue? (.bytes t)).map (.vaultType v ⟨·⟩ b)
    else none
  | _ => none

/-- Its ids, Doc, type and vault, are hashes, 32 bytes each. -/
def Target.idsOk : Target → Bool
  | .doc d _ => d.hash.ok
  | .vaultType v t _ => v.ok && t.hash.ok
  | .vault v _ => v.ok

/-- A target whose ids are hashes reads back as itself. -/
theorem Target.ofValue_value (t : Target) (h : t.idsOk = true) : Target.ofValue? t.value = some t := by
  cases t with
  | doc d r =>
    simp only [Target.idsOk, Hash.ok, beq_iff_eq] at h
    cases r <;> simp [Target.value, Target.ofValue?, Reach.ofBytes_bytes, Hash.ofValue?, h]
  | vault v b =>
    simp only [Target.idsOk, Hash.ok, beq_iff_eq] at h
    simp [Target.value, Target.ofValue?, keyBelow, keyVault, Hash.ofValue?, h]
  | vaultType v t b =>
    simp only [Target.idsOk, Hash.ok, Bool.and_eq_true, beq_iff_eq] at h
    simp [Target.value, Target.ofValue?, keyType, keyBelow, keyVault, Hash.ofValue?, h]

/-- A target whose ids are hashes is a canonical Value. -/
theorem Target.value_canon (t : Target) (h : t.idsOk = true) : Canon t.value = true := by
  cases t with
  | doc d r =>
    simp only [Target.idsOk, Hash.ok, beq_iff_eq] at h
    cases r <;> simp_all [Target.value, Canon, Shape, ShapeMap, depth, depthMap, keysSorted,
      strictlySorted, keyBytes, textOk, keyDoc, keyReach, Reach.bytes, limit] <;> decide
  | vault v b =>
    simp only [Target.idsOk, Hash.ok, beq_iff_eq] at h
    simp_all [Target.value, Canon, Shape, ShapeMap, depth, depthMap, keysSorted, strictlySorted,
      keyBytes, keyBelow, keyVault, limit] <;> decide
  | vaultType v t b =>
    simp only [Target.idsOk, Hash.ok, Bool.and_eq_true, beq_iff_eq] at h
    simp_all [Target.value, Canon, Shape, ShapeMap, depth, depthMap, keysSorted, strictlySorted,
      keyBytes, keyType, keyBelow, keyVault, limit] <;> decide

#guard (Target.vault ⟨List.replicate 32 3⟩ true).value matches .map _
#guard Target.ofValue? (Target.vault ⟨List.replicate 31 3⟩ true).value == none
#guard Target.ofValue? (Target.doc ⟨⟨List.replicate 32 1⟩⟩ .lists).value ==
  some (.doc ⟨⟨List.replicate 32 1⟩⟩ .lists)
#guard Target.ofValue? (Target.doc ⟨⟨[1, 2]⟩⟩ .lists).value == none

end Aven.Core
