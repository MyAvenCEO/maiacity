import Aven.Core
import Aven.ID.Keys
import Aven.ID.Padme

/-! # avenID's key formats (A43; id/caps/README.md, "Passkeys and the PRF step", "Epochs", "Sealing")

Every byte avenID's keys are made from, so aven-id holds to them byte for byte (`derivations.json`, `stanzas.json`).
Structured inputs are Core CBOR, a label beside its body where something is signed or derived from (rule 1, one codec);
the derivations are BLAKE3's (`Aven.Core.Blake3`) and SHA-256's (`Aven.ID.Keys`). X-Wing, ML-DSA-65, Ed25519's signing
and XChaCha20-Poly1305 stay outside Lean, held to their standards' known answers and Wycheproof; what goes in and
comes out of them is fixed here.

**The PRF step.**
- The PRF input is `encode(["avenID prf 1", {epoch}])`: the owner's epoch, and no vault (A43, 31 Oct 2026). The
  authenticator's PRF secret is already its credential's own, and a passkey belongs to one vault, so the vault would
  separate nothing; without it a new browser asks the PRF in its one sign-in tap, before it knows its vault, and the
  claim's keys exist before the assertion that signs them. Rotating the epoch changes the input and every key derived
  from it, so a leaked output never opens a later epoch.
- The browser hands the authenticator `SHA-256("WebAuthn PRF" ‖ 0 ‖ input)` (WebAuthn Level 3, `prf`).
- From the 32-byte output: `derive_key("avenID owner 1")` read for 64 bytes, the first 32 the owner key's Ed25519
  seed and the next 32 its ML-DSA-65 ξ; `derive_key("avenID seal 1")`, the seal key's X-Wing seed. Device keys never
  come from here (D11), and nothing derived is stored (A42).

**A stanza** seals a 32-byte key to a reader's X-Wing key, key-committing:
- from X-Wing's shared secret, `derive_key("avenID stanza key 1")` is the cipher's key and
  `derive_key("avenID stanza commit 1")` the commitment's;
- the AAD is `encode({id, epoch, scope, recipient})`: the vault or the Doc, the epoch's number, `keyring` or `doc`,
  and BLAKE3 of the reader's X-Wing public key;
- the stanza carries `commit`, the commitment key's keyed BLAKE3 of the AAD, which the reader checks in constant time
  before decrypting. XChaCha20-Poly1305 then seals the key with nonce zero: every key is used once.

**An epoch** of a keyring or a Doc commits to its key (`keyed_hash(key, "avenID commit 1")`), seals the previous key
under `derive_key("avenID back 1", key)` and a keyring's vault key under `derive_key("avenID keyring vault 1", key)`,
each with the AAD `encode({id, epoch, scope})`. A reader finds its stanza by its tag, `keyed_hash(tag seed,
encode({id, epoch}))`, or, untagged, by opening. Its blob is a Value; its name is BLAKE3 of the blob without its
stanzas, so sealing it to one more reader doesn't rename it (`name_ignores_stanzas`).

**Padding** (D18). An epoch's stanza list is padded with stanzas that open for no one, bytes of the same lengths drawn
at random, to `padme (max n 4)` entries for `n` readers: never fewer than four, so a lone reader doesn't show, and then
Padmé's at most an eighth more (`Aven.ID.Padme`, the one Padmé that segments use too), so the count tells little
(`padded_ge`, `padded_le`). A dummy can't be told from a reader's stanza, by the writer either, so a reseal
adds its stanza and pads again to `padded` of the new length.

**Tag seeds** live in the epoch before. A reader's tag seed in an epoch is the keyed hash, under
`derive_key("avenID tag seed 1", previous epoch's key)`, of its X-Wing public key's BLAKE3 (`tagSeed`): every writer
that rotates and every reader of the previous epoch knows that key, and the keeper doesn't, so it links no reader
across Docs or epochs. A first epoch, and a reader new to an epoch, has no tag: its stanza is found by opening.

**Reading a blob back** (`Stanza.ofValue?`, `Epoch.ofValue?`, hosted here for the access Records, A45): exactly the
lengths below, the flat scheme, suite 1, a vault key exactly for a keyring, and only a Value its own `value` writes back
the same (`Epoch.ofValue_value`). -/

namespace Aven.ID.KeyFormats

open Aven.Core

/-- Text as a Value's bytes. -/
def t (s : String) : Bytes := s.toUTF8.toList

/-- A label beside its body, encoded. -/
def labelled (label : String) (body : Value) : Bytes := encode (.array [.text (t label), body])

/-! ## The PRF step -/

def prfLabel : String := "avenID prf 1"
def ownerLabel : String := "avenID owner 1"
def sealLabel : String := "avenID seal 1"

/-- The bytes a proof reads: `avenID prf 1` and `epoch`. -/
def prfLabelBytes : Bytes := [0x61, 0x76, 0x65, 0x6E, 0x49, 0x44, 0x20, 0x70, 0x72, 0x66, 0x20, 0x31]
def keyEpoch : Bytes := [0x65, 0x70, 0x6F, 0x63, 0x68]

#guard prfLabelBytes = t prfLabel ∧ keyEpoch = t "epoch"

def prfBody (epoch : Nat) : Value := .map [(keyEpoch, .uint epoch)]

def prfInput (epoch : Nat) : Bytes := encode (.array [.text prfLabelBytes, prfBody epoch])

def prfSalt (epoch : Nat) : Bytes :=
  Keys.sha256.digest (t "WebAuthn PRF" ++ [0] ++ prfInput epoch)

/-- The owner key's seeds: Ed25519's, then ML-DSA-65's ξ. -/
def ownerSeeds (prf : Bytes) : Bytes × Bytes :=
  let x := Blake3.deriveKeyXof ownerLabel prf 64
  (x.take 32, x.drop 32)

def sealSeed (prf : Bytes) : Bytes := Blake3.deriveKey sealLabel prf

/-! ## A device's hybrid key

A device's ML-DSA-65 half is derived from its own Ed25519 seed, never from a passkey (D11), in its own process and wiped
after use (A43, 31 Oct 2026). A quantum attacker recovers Ed25519's clamped scalar from the public key, never the seed
it was hashed from (RFC 8032), so the ML-DSA key stays out of reach; the seed is never exported or derived from
elsewhere. The device's two halves rotate together, with its device key (D19). Nothing trusts the ML-DSA half until
its vault owner's hybrid signature binds it. -/

def deviceMlDsaLabel : String := "avenID device ml-dsa 1"

/-- A device's ML-DSA-65 ξ, from its Ed25519 seed. -/
def deviceMlDsaSeed (ed25519Seed : Bytes) : Bytes := Blake3.deriveKey deviceMlDsaLabel ed25519Seed

theorem prf_shape {n : Nat} (hn : n < limit) : Shape (.array [.text prfLabelBytes, prfBody n]) = true := by
  have closed : utf8 prfLabelBytes = true ∧ utf8 keyEpoch = true := by decide
  simp [Shape, ShapeList, ShapeMap, prfBody, keysSorted, strictlySorted, textOk, closed, hn, limit]
  simp_all [prfLabelBytes, keyEpoch]

/-- Two owner epochs never share a PRF input. -/
theorem prf_input_separates {m n : Nat} (hm : m < limit) (hn : n < limit) (h : prfInput m = prfInput n) : m = n := by
  have := encode_inj_shape (prf_shape hm) (prf_shape hn) h
  simpa [prfBody] using this

/-! ## Stanzas -/

def stanzaKeyLabel : String := "avenID stanza key 1"
def stanzaCommitLabel : String := "avenID stanza commit 1"

/-- What a stanza seals for: a vault's keyring, or a Doc. -/
inductive Scope where
  | keyring
  | doc
  deriving DecidableEq, Repr

def Scope.text : Scope → String
  | .keyring => "keyring"
  | .doc => "doc"

def stanzaAad (scope : Scope) (id : String) (epoch : Nat) (recipient : Bytes) : Bytes :=
  encode (.map [(t "id", .text (t id)), (t "epoch", .uint epoch), (t "scope", .text (t scope.text)),
    (t "recipient", .bytes recipient)])

def stanzaKey (shared : Bytes) : Bytes := Blake3.deriveKey stanzaKeyLabel shared
def stanzaCommitKey (shared : Bytes) : Bytes := Blake3.deriveKey stanzaCommitLabel shared
def stanzaCommit (shared aad : Bytes) : Bytes := Blake3.keyedHash (stanzaCommitKey shared) aad

/-- The stanza suite: X-Wing, the BLAKE3 derivations above, XChaCha20-Poly1305. -/
def stanzaSuite : Nat := 1

/-! ### Lengths -/

/-- X-Wing's ciphertext: ML-KEM-768's 1088 bytes and X25519's 32. -/
def ctLen : Nat := 1120
/-- A commitment, a stanza's or an epoch's: a BLAKE3 output. -/
def commitLen : Nat := 32
/-- A sealed key: 32 bytes and Poly1305's 16-byte tag. -/
def sealedLen : Nat := 48
def tagLen : Nat := 32
/-- An epoch's name, as `prev` holds it: a BLAKE3 hash. -/
def nameLen : Nat := 32

/-- A stanza as it travels: X-Wing's ciphertext, the commitment, the sealed key, and the tag when it has one. -/
structure Stanza where
  ct : Bytes
  commit : Bytes
  sealed : Bytes
  tag : Option Bytes := none
  deriving DecidableEq, Repr

def Stanza.value (s : Stanza) : Value :=
  .map ([(t "ct", .bytes s.ct)] ++ (s.tag.map fun g => (t "tag", .bytes g)).toList ++
    [(t "suite", .uint stanzaSuite), (t "commit", .bytes s.commit), (t "sealed", .bytes s.sealed)])

/-! ## Epochs -/

def commitLabel : String := "avenID commit 1"
def backLabel : String := "avenID back 1"
def vaultLabel : String := "avenID keyring vault 1"

def commit (key : Bytes) : Bytes := Blake3.keyedHash key (t commitLabel)
def backKey (key : Bytes) : Bytes := Blake3.deriveKey backLabel key
def vaultKey (key : Bytes) : Bytes := Blake3.deriveKey vaultLabel key

/-- What an epoch's own key seals is bound to the epoch. -/
def innerAad (scope : Scope) (id : String) (epoch : Nat) : Bytes :=
  encode (.map [(t "id", .text (t id)), (t "epoch", .uint epoch), (t "scope", .text (t scope.text))])

def tag (seed : Bytes) (id : String) (epoch : Nat) : Bytes :=
  Blake3.keyedHash seed (encode (.map [(t "id", .text (t id)), (t "epoch", .uint epoch)]))

def tagSeedLabel : String := "avenID tag seed 1"

/-- A reader's tag seed in the epoch after the one whose key is `prevKey`: the keyed hash of its X-Wing public key's
BLAKE3 (`recipient`) under that key's subkey. -/
def tagSeed (prevKey recipient : Bytes) : Bytes := Blake3.keyedHash (Blake3.deriveKey tagSeedLabel prevKey) recipient

/-! ### Padding (D18) -/

/-- The fewest stanzas an epoch has. -/
def minStanzas : Nat := 4

/-- How many stanzas an epoch with `n` readers has: at least four, then Padmé. -/
def padded (n : Nat) : Nat := Padme.padme (max n minStanzas)

theorem padded_ge (n : Nat) : n ≤ padded n :=
  Nat.le_trans (Nat.le_max_left n minStanzas) (Padme.padme_ge _)

theorem padded_min (n : Nat) : minStanzas ≤ padded n :=
  Nat.le_trans (Nat.le_max_right n minStanzas) (Padme.padme_ge _)

/-- At most an eighth more than four or the readers, whichever is more. -/
theorem padded_le (n : Nat) : padded n ≤ max n minStanzas + max n minStanzas / 8 := Padme.padme_le _

#guard (List.range 5).all fun n => padded n == 4
#guard padded 8 = 8 ∧ padded 9 = 10 ∧ padded 100 = 104 ∧ padded 1000 = 1024
-- a padded count pads to itself, so a list that was padded once reads as padded
#guard (List.range 4096).all fun n => padded (padded n) == padded n

/-- One epoch's key blob. -/
structure Epoch where
  scope : Scope
  id : String
  n : Nat
  prev : List Bytes
  stanzas : List Stanza
  commit : Bytes
  back : Option Bytes := none
  vault : Option Bytes := none
  deriving DecidableEq, Repr

/-- The blob as a Value, its keys sorted as the codec sorts them. -/
def Epoch.value (e : Epoch) : Value :=
  .map ([(t "n", .uint e.n), (t "id", .text (t e.id))] ++ (e.back.map fun b => (t "back", .bytes b)).toList ++
    [(t "prev", .array (e.prev.map .bytes)), (t "scope", .text (t e.scope.text))] ++
    (e.vault.map fun v => (t "vault", .bytes v)).toList ++
    [(t "commit", .bytes e.commit), (t "scheme", .text (t "flat 1")),
      (t "stanzas", .array (e.stanzas.map Stanza.value))])

def Epoch.bytes (e : Epoch) : Bytes := encode e.value

/-- The epoch's name: BLAKE3 of its blob without its stanzas. -/
def Epoch.name (e : Epoch) : Hash := blake3 (encode { e with stanzas := [] }.value)

/-- Sealing an epoch to one more reader keeps its name. -/
theorem name_ignores_stanzas (e : Epoch) (s : List Stanza) : ({ e with stanzas := s } : Epoch).name = e.name := rfl

/-- Whether an epoch's stanza list is padded: as many as some count of readers pads to. -/
def Epoch.isPadded (e : Epoch) : Bool := padded e.stanzas.length == e.stanzas.length

/-! ### Reading a blob back -/

def Scope.ofText? (s : String) : Option Scope :=
  if s = "keyring" then some .keyring else if s = "doc" then some .doc else none

/-- A map's field by its key. -/
def field (kvs : List (Bytes × Value)) (key : String) : Option Value := (kvs.find? (·.1 == t key)).map (·.2)

def textOf? : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

def natOf? : Value → Option Nat
  | .uint n => some n
  | _ => none

/-- Bytes of exactly `n`. -/
def bytesOf? (n : Nat) : Value → Option Bytes
  | .bytes b => if b.length = n then some b else none
  | _ => none

def optBytes? (n : Nat) : Option Value → Option (Option Bytes)
  | none => some none
  | some v => (bytesOf? n v).map some

def Stanza.ofFields? (kvs : List (Bytes × Value)) : Option Stanza := do
  guard (natOf? (← field kvs "suite") = some stanzaSuite)
  some { ct := ← bytesOf? ctLen (← field kvs "ct"), commit := ← bytesOf? commitLen (← field kvs "commit"),
         sealed := ← bytesOf? sealedLen (← field kvs "sealed"), tag := ← optBytes? tagLen (field kvs "tag") }

/-- A stanza, and only one its own `value` writes back the same. -/
def Stanza.ofValue? (v : Value) : Option Stanza :=
  match v with
  | .map kvs => (Stanza.ofFields? kvs).bind fun s => if s.value = v then some s else none
  | _ => none

/-- An epoch from its blob's fields: the flat scheme, a vault key exactly when it is a keyring's. -/
def Epoch.ofFields? (kvs : List (Bytes × Value)) : Option Epoch := do
  guard (textOf? (← field kvs "scheme") = some "flat 1")
  let scope ← Scope.ofText? (← textOf? (← field kvs "scope"))
  let .array prev ← field kvs "prev" | none
  let .array stanzas ← field kvs "stanzas" | none
  let vault ← optBytes? sealedLen (field kvs "vault")
  guard (decide (scope = .keyring) == vault.isSome)
  some { scope, id := ← textOf? (← field kvs "id"), n := ← natOf? (← field kvs "n"),
         prev := ← prev.mapM (bytesOf? nameLen), stanzas := ← stanzas.mapM Stanza.ofValue?,
         commit := ← bytesOf? commitLen (← field kvs "commit"), back := ← optBytes? sealedLen (field kvs "back"),
         vault }

/-- An epoch, and only one its own `value` writes back the same: no field the blob doesn't name, nothing out of order. -/
def Epoch.ofValue? (v : Value) : Option Epoch :=
  match v with
  | .map kvs => (Epoch.ofFields? kvs).bind fun e => if e.value = v then some e else none
  | _ => none

/-- What reads back writes back: a blob read is exactly the Value it was read from. -/
theorem Epoch.ofValue_value {v : Value} {e : Epoch} (h : Epoch.ofValue? v = some e) : e.value = v := by
  unfold Epoch.ofValue? at h
  split at h
  · simp only [Option.bind_eq_some_iff] at h
    obtain ⟨e', _, he⟩ := h
    split at he
    · next hv => cases he; exact hv
    · cases he
  · cases h

theorem Stanza.ofValue_value {v : Value} {s : Stanza} (h : Stanza.ofValue? v = some s) : s.value = v := by
  unfold Stanza.ofValue? at h
  split at h
  · simp only [Option.bind_eq_some_iff] at h
    obtain ⟨s', _, hs⟩ := h
    split at hs
    · next hv => cases hs; exact hv
    · cases hs
  · cases h

end Aven.ID.KeyFormats
