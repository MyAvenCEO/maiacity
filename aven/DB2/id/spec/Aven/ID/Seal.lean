import Aven.Core
import Aven.ID.Padme

/-! # The seal (A43, A176, A177; D13, D18)

One construction seals a Doc's loose envelopes, its segments and its checkpoints under the Doc's epoch key, so a
keeper sees of each only its Doc, its epoch and its padded length (D13). It follows a stanza's pattern
(`Aven.ID.KeyFormats`): key-committing, with the commitment checked before anything is decrypted.

- **What it seals** (`seals`, A177) is an `envelope`, a `segment` or a `checkpoint`.
- **The keys:** from the epoch's 32-byte key, `derive_key("avenDB <seals> 1")` is the cipher's key and
  `derive_key("avenDB <seals> commit 1")` the commitment's, so the three never share a key.
- **The nonce** is 24 random bytes, XChaCha20-Poly1305's.
- **The AAD** is `encode({doc, epoch, seals})` (the codec's order), binding the ciphertext to its Doc, to what it seals
  and to its epoch.
- **The commitment** is the commitment key's keyed BLAKE3 over `encode({aad, nonce})`. A reader checks it in constant
  time before it decrypts, so a sealed thing opens under one key only (`open_checks_commit`).
- **The plaintext** is padded before sealing: a `0x80` byte, then zeros, to the one padding's length of its length
  plus one (`Aven.ID.Padme.padSealed`, A176: 256 B, 1 KiB or 4 KiB, then Padmé).
- **Outside:** `encode({ct, doc, epoch, nonce, commit})` and nothing else (D13).
- **What it seals, read back:** a keeper serves sealed things without saying what they seal (it is in the AAD, D13),
  so a reader computes each one's commitment over `{aad, nonce}` and takes the one that matches, refusing a thing
  matching none, all before decrypting (`sealsOf`). At most one matches (`seals_by_commit`).

XChaCha20-Poly1305 stays outside Lean, held to its standard's known answers, as the stanzas' is: the model takes it as
a parameter with its one law, that opening what was sealed under the same key, nonce and AAD gives it back
(`Aead.correct`). What goes into it and what comes out around it is fixed here, byte for byte (`seals.json`).

What it proves: `unpad_pad`, `open_seal`, `open_checks_commit`, and what it seals by its commitment:
`seals_by_commit`, `sealsOf_sound`, `sealsOf_complete`, `sealsOf_seal`. -/

namespace Aven.ID.Seal

open Aven.Core Aven.ID.Padme

def t (s : String) : Bytes := s.toUTF8.toList

/-- What a seal holds (A177). -/
inductive Seals where
  | envelope
  | segment
  | checkpoint
  deriving DecidableEq, Repr

def Seals.text : Seals → String
  | .envelope => "envelope"
  | .segment => "segment"
  | .checkpoint => "checkpoint"

def keyLabel (k : Seals) : String := "avenDB " ++ k.text ++ " 1"
def commitLabel (k : Seals) : String := "avenDB " ++ k.text ++ " commit 1"

/-- The cipher's key for what it seals, from the epoch's key. -/
def cipherKey (k : Seals) (epochKey : Bytes) : Bytes := Blake3.deriveKey (keyLabel k) epochKey

/-- The commitment's key for what it seals, from the epoch's key. -/
def commitKey (k : Seals) (epochKey : Bytes) : Bytes := Blake3.deriveKey (commitLabel k) epochKey

/-- The AAD, `{doc, epoch, seals}`, its keys in the codec's order. -/
def aadValue (k : Seals) (doc : DocId) (epoch : Hash) : Value :=
  .map [(t "doc", .bytes doc.hash.bytes), (t "epoch", .bytes epoch.bytes), (t "seals", .text (t k.text))]

def aad (k : Seals) (doc : DocId) (epoch : Hash) : Bytes := encode (aadValue k doc epoch)

/-- The commitment: the commitment key's keyed BLAKE3 over `{aad, nonce}`. -/
def commit (k : Seals) (epochKey : Bytes) (aad nonce : Bytes) : Bytes :=
  Blake3.keyedHash (commitKey k epochKey) (encode (.map [(t "aad", .bytes aad), (t "nonce", .bytes nonce)]))

#guard keysSorted [(t "doc", .null), (t "epoch", .null), (t "seals", .null)] = true
#guard keysSorted [(t "aad", .null), (t "nonce", .null)] = true
#guard keysSorted [(t "ct", .null), (t "doc", .null), (t "epoch", .null), (t "nonce", .null), (t "commit", .null)] = true

/-! ## The padded plaintext -/

/-- `0x80`, then zeros, to the one padding's length of the plaintext's length plus one (A176). -/
def pad (pt : Bytes) : Bytes :=
  pt ++ [0x80] ++ List.replicate (padSealed (pt.length + 1) - (pt.length + 1)) 0

/-- The plaintext back, `none` unless the padding is whole: zeros after a `0x80`, to the one padding's length. -/
def unpad (p : Bytes) : Option Bytes :=
  match p.reverse.dropWhile (· == 0) with
  | 0x80 :: rest => if padSealed (rest.length + 1) = p.length then some rest.reverse else none
  | _ => none

theorem dropWhile_zeros (n : Nat) (r : Bytes) :
    (List.replicate n (0 : UInt8) ++ 0x80 :: r).dropWhile (· == 0) = 0x80 :: r := by
  induction n with
  | zero => simp
  | succ n ih => simp [List.replicate_succ, ih]

theorem pad_length (pt : Bytes) : (pad pt).length = padSealed (pt.length + 1) := by
  have := padSealed_ge (pt.length + 1)
  simp [pad]
  omega

theorem unpad_pad (pt : Bytes) : unpad (pad pt) = some pt := by
  have hr : (pad pt).reverse = List.replicate (padSealed (pt.length + 1) - (pt.length + 1)) 0 ++ 0x80 :: pt.reverse := by
    simp [pad, List.reverse_append]
  unfold unpad
  rw [hr, dropWhile_zeros]
  simp [pad_length]

/-! ## Sealing and opening, the AEAD as a parameter -/

/-- An AEAD by its one law: what was sealed under a key, nonce and AAD opens under them. -/
structure Aead where
  enc : (key nonce aad pt : Bytes) → Bytes
  dec : (key nonce aad ct : Bytes) → Option Bytes
  correct : ∀ key nonce aad pt, dec key nonce aad (enc key nonce aad pt) = some pt

/-- A sealed thing as it travels. -/
structure Sealed where
  ct : Bytes
  doc : DocId
  epoch : Hash
  nonce : Bytes
  commit : Bytes
  deriving DecidableEq, Repr

/-- Outside, `{ct, doc, epoch, nonce, commit}`, its keys in the codec's order, and nothing else (D13). -/
def Sealed.value (s : Sealed) : Value :=
  .map [(t "ct", .bytes s.ct), (t "doc", .bytes s.doc.hash.bytes), (t "epoch", .bytes s.epoch.bytes),
    (t "nonce", .bytes s.nonce), (t "commit", .bytes s.commit)]

/-- What a keeper sees: the Doc, the epoch and the padded length. -/
def Sealed.outside (s : Sealed) : DocId × Hash × Nat := (s.doc, s.epoch, s.ct.length)

def sealWith (A : Aead) (k : Seals) (epochKey : Bytes) (doc : DocId) (epoch : Hash) (nonce pt : Bytes) : Sealed :=
  let a := aad k doc epoch
  { ct := A.enc (cipherKey k epochKey) nonce a (pad pt), doc, epoch, nonce, commit := commit k epochKey a nonce }

/-- Open: the commitment first, then the AEAD, then the padding. -/
def openWith (A : Aead) (k : Seals) (epochKey : Bytes) (s : Sealed) : Option Bytes :=
  let a := aad k s.doc s.epoch
  if commit k epochKey a s.nonce = s.commit then
    (A.dec (cipherKey k epochKey) s.nonce a s.ct).bind unpad
  else none

/-- What a sealed thing seals, found by its commitment alone, before anything is decrypted: what a reader does with an
item a keeper served, the keeper knowing only hashes (D13). Each one's commitment key is its own. -/
def sealsOf (epochKey : Bytes) (s : Sealed) : Option Seals :=
  [Seals.envelope, .segment, .checkpoint].find? fun k => commit k epochKey (aad k s.doc s.epoch) s.nonce == s.commit

/-- The commitment nothing collides under: for one epoch key, Doc, epoch and nonce, no two `seals`' commitments are
equal. Each one's key and AAD are its own, so this is BLAKE3's collision resistance, which Lean takes as given. -/
def Distinct (key : Bytes) (doc : DocId) (epoch : Hash) (nonce : Bytes) : Prop :=
  ∀ k k', commit k key (aad k doc epoch) nonce = commit k' key (aad k' doc epoch) nonce → k = k'

/-- At most one `seals` matches a sealed thing's commitment, under a commitment nothing collides under. -/
theorem seals_by_commit {key : Bytes} {s : Sealed} (hd : Distinct key s.doc s.epoch s.nonce) {k k' : Seals}
    (h : commit k key (aad k s.doc s.epoch) s.nonce = s.commit)
    (h' : commit k' key (aad k' s.doc s.epoch) s.nonce = s.commit) : k = k' :=
  hd k k' (h.trans h'.symm)

/-- What is found is one whose commitment the sealed thing carries, so opening it as that passes the commitment. -/
theorem sealsOf_sound {key : Bytes} {s : Sealed} {k : Seals} (h : sealsOf key s = some k) :
    commit k key (aad k s.doc s.epoch) s.nonce = s.commit := by
  have := List.find?_some h
  simpa using this

/-- The one whose commitment matches is the one found, whatever the order they are tried in. -/
theorem sealsOf_complete {key : Bytes} {s : Sealed} (hd : Distinct key s.doc s.epoch s.nonce) {k : Seals}
    (h : commit k key (aad k s.doc s.epoch) s.nonce = s.commit) : sealsOf key s = some k := by
  cases hk : sealsOf key s with
  | none =>
    exfalso
    have := List.find?_eq_none.mp hk k (by cases k <;> simp)
    simp [h] at this
  | some k' => exact congrArg some (seals_by_commit hd (sealsOf_sound hk) h)

/-- A reader finds what a thing was sealed as. -/
theorem sealsOf_seal (A : Aead) (k : Seals) (key : Bytes) (doc : DocId) (epoch : Hash) (nonce pt : Bytes)
    (hd : Distinct key doc epoch nonce) : sealsOf key (sealWith A k key doc epoch nonce pt) = some k :=
  sealsOf_complete (s := sealWith A k key doc epoch nonce pt) hd (by simp only [sealWith])

theorem open_seal (A : Aead) (k : Seals) (key : Bytes) (doc : DocId) (epoch : Hash) (nonce pt : Bytes) :
    openWith A k key (sealWith A k key doc epoch nonce pt) = some pt := by
  simp [openWith, sealWith, A.correct, unpad_pad]

/-- Whatever opens, opens only under a key whose commitment the sealed thing carries, for its own Doc, `seals`, epoch and
nonce: the AEAD is never asked to decrypt under another. -/
theorem open_checks_commit {A : Aead} {k : Seals} {key : Bytes} {s : Sealed} {pt : Bytes}
    (h : openWith A k key s = some pt) : commit k key (aad k s.doc s.epoch) s.nonce = s.commit := by
  unfold openWith at h
  by_cases hc : commit k key (aad k s.doc s.epoch) s.nonce = s.commit
  · exact hc
  · simp [hc] at h


end Aven.ID.Seal
