import Aven.Core

/-! # The seal (A43; id/caps/README.md, "Sealing"; D13, D18)

One construction seals a Doc's loose envelopes, its segments and its checkpoints under the Doc's epoch key, so a
keeper sees of each only its Doc, its epoch and its padded length (D13). It follows a stanza's pattern
(`Aven.ID.KeyFormats`): key-committing, with the commitment checked before anything is decrypted.

- **The kind** is `envelope`, `segment` or `snapshot` (a checkpoint's).
- **The keys:** from the epoch's 32-byte key, `derive_key("avenDB <kind> 1")` is the cipher's key and
  `derive_key("avenDB <kind> commit 1")` the commitment's, so the three kinds never share a key.
- **The nonce** is 24 random bytes, XChaCha20-Poly1305's.
- **The AAD** is `encode({doc, kind, epoch})`, binding the ciphertext to its Doc, its kind and its epoch.
- **The commitment** is the commitment key's keyed BLAKE3 over `encode({aad, nonce})`. A reader checks it in constant
  time before it decrypts, so a sealed thing opens under one key only (`open_checks_commit`).
- **The plaintext** is padded before sealing: a `0x80` byte, then zeros, to Padmé's length (PURBs) of its length plus
  one. Padmé adds at most an eighth (`padme_le`), about 12 %, and a padded length pads to itself (`padme_idem`, checked to 2¹⁶).
- **Outside:** `encode({ct, doc, epoch, nonce, commit})` and nothing else (D13).

XChaCha20-Poly1305 stays outside Lean, held to its standard's known answers, as the stanzas' is: the model takes it as
a parameter with its one law, that opening what was sealed under the same key, nonce and AAD gives it back
(`Aead.correct`). What goes into it and what comes out around it is fixed here, byte for byte (`seals.json`).

What it proves: `padme_ge`, `padme_le`, `unpad_pad`, `open_seal`, `open_checks_commit`. -/

namespace Aven.ID.Seal

open Aven.Core

def t (s : String) : Bytes := s.toUTF8.toList

/-- What a seal holds. -/
inductive Kind where
  | envelope
  | segment
  | snapshot
  deriving DecidableEq, Repr

def Kind.text : Kind → String
  | .envelope => "envelope"
  | .segment => "segment"
  | .snapshot => "snapshot"

def keyLabel (k : Kind) : String := "avenDB " ++ k.text ++ " 1"
def commitLabel (k : Kind) : String := "avenDB " ++ k.text ++ " commit 1"

/-- The cipher's key for a kind, from the epoch's key. -/
def cipherKey (k : Kind) (epochKey : Bytes) : Bytes := Blake3.deriveKey (keyLabel k) epochKey

/-- The commitment's key for a kind, from the epoch's key. -/
def commitKey (k : Kind) (epochKey : Bytes) : Bytes := Blake3.deriveKey (commitLabel k) epochKey

/-- The AAD, `{doc, kind, epoch}`, its keys in the codec's order. -/
def aadValue (k : Kind) (doc : DocId) (epoch : Hash) : Value :=
  .map [(t "doc", .bytes doc.hash.bytes), (t "kind", .text (t k.text)), (t "epoch", .bytes epoch.bytes)]

def aad (k : Kind) (doc : DocId) (epoch : Hash) : Bytes := encode (aadValue k doc epoch)

/-- The commitment: the commitment key's keyed BLAKE3 over `{aad, nonce}`. -/
def commit (k : Kind) (epochKey : Bytes) (aad nonce : Bytes) : Bytes :=
  Blake3.keyedHash (commitKey k epochKey) (encode (.map [(t "aad", .bytes aad), (t "nonce", .bytes nonce)]))

#guard keysSorted [(t "doc", .null), (t "kind", .null), (t "epoch", .null)] = true
#guard keysSorted [(t "aad", .null), (t "nonce", .null)] = true
#guard keysSorted [(t "ct", .null), (t "doc", .null), (t "epoch", .null), (t "nonce", .null), (t "commit", .null)] = true

/-! ## Padmé -/

/-- Padmé's length for `l`: the low bits of `l` rounded up, keeping `⌊log₂ ⌊log₂ l⌋⌋ + 1` significant bits. -/
def zeroBits (l : Nat) : Nat := l.log2 - (l.log2.log2 + 1)

def padme (l : Nat) : Nat :=
  if l < 2 then l else (l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l * 2 ^ zeroBits l

theorem padme_ge (l : Nat) : l ≤ padme l := by
  unfold padme
  split
  · exact Nat.le_refl _
  · have hp : 0 < 2 ^ zeroBits l := Nat.two_pow_pos _
    have := Nat.div_add_mod (l + 2 ^ zeroBits l - 1) (2 ^ zeroBits l)
    have := Nat.mod_lt (l + 2 ^ zeroBits l - 1) hp
    have : (l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l * 2 ^ zeroBits l =
        2 ^ zeroBits l * ((l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l) := Nat.mul_comm _ _
    omega

/-- Rounding up adds less than one unit. -/
theorem padme_lt (l : Nat) (h : 2 ≤ l) : padme l < l + 2 ^ zeroBits l := by
  unfold padme
  simp only [show ¬ l < 2 from by omega, ↓reduceIte]
  have hp : 0 < 2 ^ zeroBits l := Nat.two_pow_pos _
  have := Nat.div_mul_le_self (l + 2 ^ zeroBits l - 1) (2 ^ zeroBits l)
  omega

/-- From 16 up, a unit is at most an eighth of the length. -/
theorem unit_le (l : Nat) (h : 16 ≤ l) : 8 * 2 ^ zeroBits l ≤ l := by
  have hl : l ≠ 0 := by omega
  have he : 4 ≤ l.log2 := (Nat.le_log2 hl).mpr (by simpa using h)
  have hs : 2 ≤ l.log2.log2 := (Nat.le_log2 (by omega)).mpr (by simpa using he)
  have hz : zeroBits l + 3 ≤ l.log2 := by unfold zeroBits; omega
  calc 8 * 2 ^ zeroBits l = 2 ^ (zeroBits l + 3) := by rw [Nat.pow_add]; omega
    _ ≤ 2 ^ l.log2 := Nat.pow_le_pow_right (by decide) hz
    _ ≤ l := Nat.log2_self_le hl

/-- Padmé adds at most an eighth: about 12 %. -/
theorem padme_le (l : Nat) : padme l ≤ l + l / 8 := by
  by_cases h : 16 ≤ l
  · have := padme_lt l (by omega)
    have := unit_le l h
    omega
  · exact (by decide : ∀ m, m < 16 → padme m ≤ m + m / 8) l (by omega)

-- A padded length pads to itself, checked for every length up to 2¹⁶.
#guard (List.range 65536).all fun l => padme (padme l) == padme l

/-! ## The padded plaintext -/

/-- `0x80`, then zeros, to Padmé's length of the plaintext's length plus one. -/
def pad (pt : Bytes) : Bytes :=
  pt ++ [0x80] ++ List.replicate (padme (pt.length + 1) - (pt.length + 1)) 0

/-- The plaintext back, `none` unless the padding is whole: zeros after a `0x80`, to Padmé's length. -/
def unpad (p : Bytes) : Option Bytes :=
  match p.reverse.dropWhile (· == 0) with
  | 0x80 :: rest => if padme (rest.length + 1) = p.length then some rest.reverse else none
  | _ => none

theorem dropWhile_zeros (n : Nat) (r : Bytes) :
    (List.replicate n (0 : UInt8) ++ 0x80 :: r).dropWhile (· == 0) = 0x80 :: r := by
  induction n with
  | zero => simp
  | succ n ih => simp [List.replicate_succ, ih]

theorem pad_length (pt : Bytes) : (pad pt).length = padme (pt.length + 1) := by
  have := padme_ge (pt.length + 1)
  simp [pad]
  omega

theorem unpad_pad (pt : Bytes) : unpad (pad pt) = some pt := by
  have hr : (pad pt).reverse = List.replicate (padme (pt.length + 1) - (pt.length + 1)) 0 ++ 0x80 :: pt.reverse := by
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

def sealWith (A : Aead) (k : Kind) (epochKey : Bytes) (doc : DocId) (epoch : Hash) (nonce pt : Bytes) : Sealed :=
  let a := aad k doc epoch
  { ct := A.enc (cipherKey k epochKey) nonce a (pad pt), doc, epoch, nonce, commit := commit k epochKey a nonce }

/-- Open: the commitment first, then the AEAD, then the padding. -/
def openWith (A : Aead) (k : Kind) (epochKey : Bytes) (s : Sealed) : Option Bytes :=
  let a := aad k s.doc s.epoch
  if commit k epochKey a s.nonce = s.commit then
    (A.dec (cipherKey k epochKey) s.nonce a s.ct).bind unpad
  else none

theorem open_seal (A : Aead) (k : Kind) (key : Bytes) (doc : DocId) (epoch : Hash) (nonce pt : Bytes) :
    openWith A k key (sealWith A k key doc epoch nonce pt) = some pt := by
  simp [openWith, sealWith, A.correct, unpad_pad]

/-- Whatever opens, opens only under a key whose commitment the sealed thing carries, for its own Doc, kind, epoch and
nonce: the AEAD is never asked to decrypt under another. -/
theorem open_checks_commit {A : Aead} {k : Kind} {key : Bytes} {s : Sealed} {pt : Bytes}
    (h : openWith A k key s = some pt) : commit k key (aad k s.doc s.epoch) s.nonce = s.commit := by
  unfold openWith at h
  by_cases hc : commit k key (aad k s.doc s.epoch) s.nonce = s.commit
  · exact hc
  · simp [hc] at h

#guard padme 0 = 0 ∧ padme 1 = 1 ∧ padme 9 = 10 ∧ padme 17 = 18 ∧ padme 129 = 144 ∧ padme 1000 = 1024

end Aven.ID.Seal
