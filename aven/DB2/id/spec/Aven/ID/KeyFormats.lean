import Aven.Core
import Aven.ID.Keys

/-! # avenID's key formats (A43; id/caps/README.md, "Passkeys and the PRF step", "Epochs", "Sealing")

Every byte avenID's keys are made from, so aven-id holds to them byte for byte (`derivations.json`, `stanzas.json`).
Structured inputs are Core CBOR, a label beside its body where something is signed or derived from (rule 1, one codec);
the derivations are BLAKE3's (`Aven.Core.Blake3`) and SHA-256's (`Aven.ID.Keys`). X-Wing, ML-DSA-65, Ed25519's signing
and XChaCha20-Poly1305 stay outside Lean, held to their standards' known answers and Wycheproof; what goes in and
comes out of them is fixed here.

**The PRF step.**
- The PRF input is `encode(["avenID prf 1", {epoch, vault}])`: the vault's id and its owner's epoch. Rotating the
  epoch changes the input and every key derived from it.
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
stanzas, so sealing it to one more reader doesn't rename it (`name_ignores_stanzas`). -/

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

/-- The bytes a proof reads: `avenID prf 1` and `epoch` (Core's `keyVault` is `vault`). -/
def prfLabelBytes : Bytes := [0x61, 0x76, 0x65, 0x6E, 0x49, 0x44, 0x20, 0x70, 0x72, 0x66, 0x20, 0x31]
def keyEpoch : Bytes := [0x65, 0x70, 0x6F, 0x63, 0x68]

#guard prfLabelBytes = t prfLabel ∧ keyEpoch = t "epoch" ∧ keyVault = t "vault"

def prfBody (vault : String) (epoch : Nat) : Value := .map [(keyEpoch, .uint epoch), (keyVault, .text (t vault))]

def prfInput (vault : String) (epoch : Nat) : Bytes := encode (.array [.text prfLabelBytes, prfBody vault epoch])

def prfSalt (vault : String) (epoch : Nat) : Bytes :=
  Keys.sha256.digest (t "WebAuthn PRF" ++ [0] ++ prfInput vault epoch)

/-- The owner key's seeds: Ed25519's, then ML-DSA-65's ξ. -/
def ownerSeeds (prf : Bytes) : Bytes × Bytes :=
  let x := Blake3.deriveKeyXof ownerLabel prf 64
  (x.take 32, x.drop 32)

def sealSeed (prf : Bytes) : Bytes := Blake3.deriveKey sealLabel prf

theorem prf_shape {v : String} {n : Nat} (hv : textOk (t v) = true) (hn : n < limit) :
    Shape (.array [.text prfLabelBytes, prfBody v n]) = true := by
  simp only [textOk, limit, Bool.and_eq_true, decide_eq_true_eq] at hv
  have closed : utf8 prfLabelBytes = true ∧ lexLt (keyBytes keyEpoch) (keyBytes keyVault) = true ∧
      utf8 keyEpoch = true ∧ utf8 keyVault = true := by decide
  simp [Shape, ShapeList, ShapeMap, prfBody, keysSorted, strictlySorted, textOk, closed, hv.1, hv.2, hn, limit]
  simp_all [prfLabelBytes, keyEpoch, keyVault]

/-- Two vaults, or two epochs of one, never share a PRF input. -/
theorem prf_input_separates {v w : String} {m n : Nat} (hv : textOk (t v) = true) (hw : textOk (t w) = true)
    (hm : m < limit) (hn : n < limit) (h : prfInput v m = prfInput w n) : t v = t w ∧ m = n := by
  have := encode_inj_shape (prf_shape hv hm) (prf_shape hw hn) h
  simp only [prfBody, Value.array.injEq, List.cons.injEq, Value.map.injEq, Prod.mk.injEq, Value.uint.injEq,
    Value.text.injEq, true_and, and_true] at this
  exact ⟨this.2, this.1⟩

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

end Aven.ID.KeyFormats
