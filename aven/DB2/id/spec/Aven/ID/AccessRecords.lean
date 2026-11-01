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
that each field has its form: hashes are 32 bytes, and an epoch's blob is read by its owner, `KeyFormats`
(`Epoch.ofFields?`, with its named lengths).

`idBuiltinFit` gives the check for each of the three types, and none for any other Doc: the docs layer joins it with
the other packages' built-ins. -/

namespace Aven.ID

open Aven.Core

/-! ## A cap Record -/

/-- A cap Record: a cap, its vaults named by their 32 bytes (A190, A210), and its signatures. -/
structure CapRecord where
  cap : Cap Hash
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
