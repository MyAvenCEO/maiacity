import Aven.ID.CapsCbor
import Aven.ID.Revoke
import Aven.ID.KeyFormats

/-! # avenID's Records in a Doc (A39, A30)

A Doc's access map holds Records of avenID's built-in types `cap`, `revoke` and `epoch` (`Aven.ID.Types`). This module
says what each looks like, so the docs layer can check a Record against its type (its `BuiltinFit`):

- a **cap Record** is the cap's body (`Cap.body`, `Aven.ID.CapsCbor`) with its signatures beside it under `sigs`;
- a **revoke Record** is a revocation's Value (`Revocation.value`, `Aven.ID.Revoke`) with its signatures;
- an **epoch Record** is the epoch's key blob (`KeyFormats.Epoch.value`) with its signatures.

A signature is Core's `Sig`, `{"sig": bytes, "signer": bytes}`, over the Record's one name: the hash of
`[label, body]`, the label implied by the Record's type and never stored (A30). The signatures are sorted by signer,
one each, within Core's limits (`sigsWithin`). Each Record is a map whose
keys sort as the codec sorts them, `sigs` among them.

Each reader (`CapRecord.ofValue?`, `RevokeRecord.ofValue?`, `EpochRecord.ofValue?`) reads a Value field by field and
then keeps it only if writing it back gives the very same Value, so a Record has one form: what `ofValue?` reads is
what `value` writes (`CapRecord.ofValue?_value` and the others), and no other key, order or spelling fits. On top of
that each field has its form: hashes are 32 bytes; an epoch's commitment 32 bytes, its sealed keys 48 and its stanzas'
ciphertexts 1120, with the flat scheme and suite 1, and a vault key exactly when it is a keyring's.

`idBuiltinFit` gives the check for each of the three types, and none for any other Doc: the docs layer joins it with
the other packages' built-ins. -/

namespace Aven.ID

open Aven.Core

/-! ## A cap Record -/

/-- A cap Record: a cap and its signatures. -/
structure CapRecord where
  cap : Cap
  sigs : List Core.Sig

def CapRecord.value (r : CapRecord) : Value := withSigs r.cap.body r.sigs

def CapRecord.ofValue? (v : Value) : Option CapRecord := do
  let (kvs, sigs) ← splitSigs v
  let r : CapRecord := ⟨← Cap.ofBody? (.map kvs), sigs⟩
  if r.value = v then some r else none

/-- What `CapRecord.ofValue?` reads is what `CapRecord.value` writes: a cap Record has one form. -/
theorem CapRecord.ofValue?_value {v : Value} {r : CapRecord} (h : CapRecord.ofValue? v = some r) : r.value = v := by
  simp only [CapRecord.ofValue?, Option.bind_eq_bind, Option.bind_eq_some_iff] at h
  obtain ⟨_, _, _, _, h⟩ := h
  split at h
  · cases h; assumption
  · cases h

/-! ## A revoke Record -/

structure RevokeRecord where
  revocation : Revocation
  sigs : List Core.Sig

def RevokeRecord.value (r : RevokeRecord) : Value := withSigs r.revocation.value r.sigs

def RevokeRecord.ofValue? (v : Value) : Option RevokeRecord := do
  let (kvs, sigs) ← splitSigs v
  let r : RevokeRecord := ⟨← Revocation.ofValue? (.map kvs), sigs⟩
  if r.value = v then some r else none

theorem RevokeRecord.ofValue?_value {v : Value} {r : RevokeRecord} (h : RevokeRecord.ofValue? v = some r) :
    r.value = v := by
  simp only [RevokeRecord.ofValue?, Option.bind_eq_bind, Option.bind_eq_some_iff] at h
  obtain ⟨_, _, _, _, h⟩ := h
  split at h
  · cases h; assumption
  · cases h

/-! ## An epoch Record -/

namespace KeyFormats

/-- An X-Wing ciphertext's length, a sealed key's, and a commitment's or tag's. -/
def ctLen : Nat := 1120
def sealedLen : Nat := 48

def Scope.ofText? (s : String) : Option Scope :=
  if s = "keyring" then some .keyring else if s = "doc" then some .doc else none

def recOptBytes? (n : Nat) : Option Value → Option (Option Bytes)
  | none => some none
  | some v => (recBytes? n v).map some

def Stanza.ofValue? : Value → Option Stanza
  | .map kvs => do
    guard (recNat? (← recField kvs "suite") = some stanzaSuite)
    some { ct := ← recBytes? ctLen (← recField kvs "ct"), commit := ← recBytes? 32 (← recField kvs "commit"),
           sealed := ← recBytes? sealedLen (← recField kvs "sealed"), tag := ← recOptBytes? 32 (recField kvs "tag") }
  | _ => none

/-- An epoch from its blob's fields: the flat scheme, a vault key exactly when it is a keyring's. -/
def Epoch.ofFields? (kvs : List (Bytes × Value)) : Option Epoch := do
  guard (recText? (← recField kvs "scheme") = some "flat 1")
  let scope ← Scope.ofText? (← recText? (← recField kvs "scope"))
  let .array prev ← recField kvs "prev" | none
  let .array stanzas ← recField kvs "stanzas" | none
  let vault ← recOptBytes? sealedLen (recField kvs "vault")
  guard (decide (scope = .keyring) == vault.isSome)
  some { scope, id := ← recText? (← recField kvs "id"), n := ← recNat? (← recField kvs "n"),
         prev := ← prev.mapM (recBytes? 32), stanzas := ← stanzas.mapM Stanza.ofValue?,
         commit := ← recBytes? 32 (← recField kvs "commit"), back := ← recOptBytes? sealedLen (recField kvs "back"),
         vault }

end KeyFormats

structure EpochRecord where
  epoch : KeyFormats.Epoch
  sigs : List Core.Sig

def EpochRecord.value (r : EpochRecord) : Value := withSigs r.epoch.value r.sigs

def EpochRecord.ofValue? (v : Value) : Option EpochRecord := do
  let (kvs, sigs) ← splitSigs v
  let r : EpochRecord := ⟨← KeyFormats.Epoch.ofFields? kvs, sigs⟩
  if r.value = v then some r else none

theorem EpochRecord.ofValue?_value {v : Value} {r : EpochRecord} (h : EpochRecord.ofValue? v = some r) :
    r.value = v := by
  simp only [EpochRecord.ofValue?, Option.bind_eq_bind, Option.bind_eq_some_iff] at h
  obtain ⟨_, _, _, _, h⟩ := h
  split at h
  · cases h; assumption
  · cases h

/-! ## The fit of avenID's built-in types -/

/-- How a Record of each of avenID's built-in types must look in a Doc, by its type; none for any other type. -/
def idBuiltinFit (t : DocId) : Option (Value → Bool) :=
  if t = capType then some fun v => (CapRecord.ofValue? v).isSome
  else if t = revokeType then some fun v => (RevokeRecord.ofValue? v).isSome
  else if t = epochType then some fun v => (EpochRecord.ofValue? v).isSome
  else none

/-- A Value that fits a type reads back as a Record of it, written exactly as that Record writes itself. -/
theorem idBuiltinFit_cap {v : Value} (h : (idBuiltinFit capType).map (· v) = some true) :
    ∃ r, CapRecord.ofValue? v = some r ∧ r.value = v := by
  simp only [idBuiltinFit, ↓reduceIte, Option.map_some, Option.some.injEq, Option.isSome_iff_exists] at h
  obtain ⟨r, hr⟩ := h
  exact ⟨r, hr, CapRecord.ofValue?_value hr⟩

end Aven.ID
