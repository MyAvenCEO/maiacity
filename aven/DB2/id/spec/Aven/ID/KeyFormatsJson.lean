import Lean.Data.Json
import Aven.ID.KeyFormats

/-! # The key formats' vectors (A43)

- `derivations.json`: BLAKE3's keyed and extendable modes; PRF inputs and the salts the browser makes of them; the
  seeds a PRF output derives, with the owner key's Ed25519 public half; a stanza's AAD, keys and commitment from an
  X-Wing shared secret; an epoch's commitment and subkeys; tags (`Aven.ID.KeyFormats`).
- `stanzas.json`: the bytes of stanzas, of keyring and Doc epochs, and of hybrid keys and signatures (`Aven.Core.Hybrid`),
  with each epoch's name. X-Wing's ciphertexts and the sealed keys are fixtures here, bytes in a pattern: aven-id makes
  real ones and checks that they round trip through the same layout.

Bytes are lowercase hex. -/

open Lean Aven.Core

namespace Aven.ID.KeyFormats

def h (b : Bytes) : Json := Json.str (hex b)

def vec (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

/-- Test bytes: BLAKE3 of a phrase, public on purpose. -/
def testBytes (phrase : String) : Bytes := Blake3.digest (t phrase)

/-- `n` bytes counting up from `start`. -/
def ramp (start n : Nat) : Bytes := (List.range n).map fun i => (start + i).toUInt8

def prfOutputs : List (String × Bytes) :=
  [("zeros", List.replicate 32 0), ("ones", List.replicate 32 0xff), ("test prf 1", testBytes "avenSANDBOX test prf 1"),
   ("test prf 2", testBytes "avenSANDBOX test prf 2")]

def scopeJson (s : Scope) : Json := Json.str s.text

def derivationVectors : List Json :=
  let blake :=
    [vec "keyed hash" (Json.mkObj [("mode", "keyed"), ("key", h (ramp 0 32)), ("input", h (t "avenID")),
        ("length", 32)]) (h (Blake3.keyedHash (ramp 0 32) (t "avenID"))),
     vec "keyed hash, 100 bytes of output" (Json.mkObj [("mode", "keyed"), ("key", h (ramp 0 32)),
        ("input", h (ramp 7 300)), ("length", 100)]) (h (Blake3.keyedXof (ramp 0 32) (ramp 7 300) 100)),
     vec "key derivation, 64 bytes of output" (Json.mkObj [("mode", "deriveKey"), ("context", ownerLabel),
        ("input", h (ramp 1 32)), ("length", 64)]) (h (Blake3.deriveKeyXof ownerLabel (ramp 1 32) 64)),
     vec "hash, 131 bytes of output" (Json.mkObj [("mode", "hash"), ("input", h (ramp 3 1500)), ("length", 131)])
        (h (Blake3.digestXof (ramp 3 1500) 131))]
  let prf := ([0, 1, 2, 7, 2 ^ 32 + 1] : List Nat).map fun e =>
    vec s!"the PRF input of an owner at epoch {e}" (Json.mkObj [("epoch", toJson e)])
      (Json.mkObj [("input", h (prfInput e)), ("salt", h (prfSalt e))])
  let seeds := prfOutputs.map fun (name, prf) =>
    let (ed, ml) := ownerSeeds prf
    vec s!"the keys of PRF output {name}" (Json.mkObj [("prf", h prf)])
      (Json.mkObj [("ed25519Seed", h ed), ("ed25519Public", h (Keys.publicKey ed)), ("mlDsaSeed", h ml),
        ("sealSeed", h (sealSeed prf))])
  let stanzas := ([(Scope.keyring, "alice", 1), (.keyring, "alice", 2), (.doc, "d:01", 1), (.doc, "", 0)] :
      List (Scope × String × Nat)).zipIdx.map
    fun ((scope, id, epoch), i) =>
      let shared := testBytes s!"avenSANDBOX test shared {i}"
      let recipient := testBytes s!"avenSANDBOX test recipient {i}"
      let aad := stanzaAad scope id epoch recipient
      vec s!"a stanza's keys, {scope.text} {id} at epoch {epoch}"
        (Json.mkObj [("shared", h shared), ("scope", scopeJson scope), ("id", id), ("epoch", toJson epoch),
          ("recipient", h recipient)])
        (Json.mkObj [("aad", h aad), ("key", h (stanzaKey shared)), ("commitKey", h (stanzaCommitKey shared)),
          ("commit", h (stanzaCommit shared aad))])
  let epochs := ([(Scope.keyring, "alice", 1), (.doc, "d:01", 3)] : List (Scope × String × Nat)).zipIdx.map
    fun ((scope, id, epoch), i) =>
    let key := testBytes s!"avenSANDBOX test epoch key {i}"
    vec s!"an epoch's subkeys, {scope.text} {id} at epoch {epoch}"
      (Json.mkObj [("key", h key), ("scope", scopeJson scope), ("id", id), ("epoch", toJson epoch)])
      (Json.mkObj [("commit", h (commit key)), ("backKey", h (backKey key)), ("vaultKey", h (vaultKey key)),
        ("innerAad", h (innerAad scope id epoch))])
  let tags := ([("d:01", 1), ("d:01", 2), ("alice", 1)] : List (String × Nat)).map fun (id, epoch) =>
    let seed := testBytes "avenSANDBOX test tag seed"
    vec s!"the tag of {id} at epoch {epoch}" (Json.mkObj [("seed", h seed), ("id", id), ("epoch", toJson epoch)])
      (h (tag seed id epoch))
  let pads := ([0, 1, 3, 4, 5, 8, 9, 17, 64, 100, 129, 1000] : List Nat).map fun n =>
    vec s!"the stanzas of an epoch with {n} readers" (Json.mkObj [("readers", toJson n)]) (toJson (padded n))
  let seeds' := ([(0, "d:01", 2), (1, "alice", 3)] : List (Nat × String × Nat)).map fun (i, id, epoch) =>
    let prevKey := testBytes s!"avenSANDBOX test epoch key {i}"
    let recipient := testBytes s!"avenSANDBOX test recipient {i}"
    vec s!"a reader's tag seed and tag in {id} at epoch {epoch}"
      (Json.mkObj [("prevKey", h prevKey), ("recipient", h recipient), ("id", id), ("epoch", toJson epoch)])
      (Json.mkObj [("seed", h (tagSeed prevKey recipient)), ("tag", h (tag (tagSeed prevKey recipient) id epoch))])
  let devices := (["alice-peer", "alice-peer-light", "aven-peer"] : List String).map fun id =>
    let seed := Keys.seed id
    vec s!"the device keys of the cast's {id}" (Json.mkObj [("ed25519Seed", h seed)])
      (Json.mkObj [("ed25519Public", h (Keys.publicKey seed)), ("mlDsaSeed", h (deviceMlDsaSeed seed)),
        ("sealSeed", h (deviceSealSeed seed))])
  let sealedPads := ([0, 1, 255, 256, 257, 1000, 1024, 1025, 4095, 4096, 4097, 5000, 65537, 1048577] : List Nat).map
    fun l => vec s!"the padded length of {l} sealed bytes" (Json.mkObj [("sealedBytes", toJson l)])
      (toJson (Padme.padSealed l))
  let padmes := ([0, 1, 7, 8, 9, 17, 129, 1000, 4097, 65537, 1048577] : List Nat).map fun l =>
    vec s!"Padmé of {l}" (Json.mkObj [("padme", toJson l)]) (toJson (Padme.padme l))
  blake ++ prf ++ seeds ++ stanzas ++ epochs ++ tags ++ pads ++ seeds' ++ devices ++ sealedPads ++ padmes

def Stanza.json (s : Stanza) : Json :=
  Json.mkObj ([("ct", h s.ct), ("commit", h s.commit), ("sealed", h s.sealed)] ++
    (s.tag.map fun g => ("tag", h g)).toList)

def Epoch.json (e : Epoch) : Json :=
  Json.mkObj ([("scope", scopeJson e.scope), ("id", Json.str e.id), ("n", toJson e.n),
    ("prev", Json.arr (e.prev.map h).toArray), ("stanzas", Json.arr (e.stanzas.map Stanza.json).toArray),
    ("commit", h e.commit)] ++ (e.back.map fun b => ("back", h b)).toList ++
    (e.vault.map fun v => ("vault", h v)).toList)

/-- A stanza in a pattern: its bytes count up from `i`. -/
def patternStanza (i : Nat) (tagged : Bool) : Stanza :=
  { ct := ramp i 1120, commit := ramp (i + 1) 32, sealed := ramp (i + 2) 48,
    tag := if tagged then some (ramp (i + 3) 32) else none }

def keyringEpoch : Epoch :=
  { scope := .keyring, id := "alice", n := 2, prev := [ramp 9 32], stanzas := [patternStanza 0 false,
      patternStanza 5 false], commit := ramp 11 32, back := some (ramp 12 48), vault := some (ramp 13 48) }

def docEpoch : Epoch :=
  { scope := .doc, id := "d:01", n := 1, prev := [], stanzas := [patternStanza 20 true], commit := ramp 21 32 }

def stanzaVectors : List Json :=
  let stanzas := [("an untagged stanza", patternStanza 0 false), ("a tagged stanza", patternStanza 1 true)].map
    fun (name, s) => vec name (Stanza.json s) (Json.mkObj [("bytes", h (encode s.value))])
  let epochs := [("a keyring's second epoch", keyringEpoch), ("a Doc's first epoch", docEpoch),
      ("that keyring epoch sealed to one more device", { keyringEpoch with
        stanzas := keyringEpoch.stanzas ++ [patternStanza 30 false] })].map
    fun (name, e) => vec name (Epoch.json e) (Json.mkObj [("bytes", h e.bytes), ("name", h e.name.bytes)])
  let hybrids := [("a hybrid key", ⟨ramp 40 ed25519KeyLen, ramp 41 mlDsa65KeyLen⟩),
      ("a hybrid signature", (⟨ramp 42 ed25519SigLen, ramp 43 mlDsa65SigLen⟩ : Hybrid))].map
    fun (name, x) => vec name (Json.mkObj [("ed25519", h x.ed25519), ("mlDsa", h x.mlDsa)])
      (Json.mkObj [("bytes", h (encode x.value))])
  -- blobs read back, and blobs that aren't one: each a Value's bytes, and whether `Epoch.ofValue?` takes it
  let fields (v : Value) : List (Bytes × Value) := match v with | .map kvs => kvs | _ => []
  let remap (e : Epoch) (f : List (Bytes × Value) → List (Bytes × Value)) : Value := .map (f (fields e.value))
  let set (key : String) (x : Value) (kvs : List (Bytes × Value)) := kvs.map fun kv => if kv.1 = t key then (kv.1, x) else kv
  let reads : List (String × Value) :=
    [("a keyring's blob", keyringEpoch.value), ("a Doc's blob", docEpoch.value),
     ("a field the blob doesn't name", remap docEpoch (· ++ [(t "zz", .null)])),
     ("another scheme", remap docEpoch (set "scheme" (.text (t "tree 1")))),
     ("a commitment cut short", remap docEpoch (set "commit" (.bytes (ramp 0 31)))),
     ("a Doc's blob with a vault key", (({ docEpoch with vault := some (ramp 1 48) } : Epoch)).value),
     ("a keyring's blob without one", (({ keyringEpoch with vault := none } : Epoch)).value),
     ("a stanza of another suite", (({ docEpoch with stanzas := [] } : Epoch)).value |> fun v =>
        match v with
        | .map kvs => .map (kvs.map fun kv => if kv.1 = t "stanzas" then (kv.1, .array [.map (fields
            (patternStanza 20 true).value |>.map fun kv' => if kv'.1 = t "suite" then (kv'.1, .uint 2) else kv')]) else kv)
        | v => v)]
  let readVectors := reads.map fun (name, v) =>
    vec s!"read back: {name}" (Json.mkObj [("bytes", h (encode v))])
      (Json.mkObj [("reads", toJson (Epoch.ofValue? v).isSome)])
  stanzas ++ epochs ++ hybrids ++ readVectors

end Aven.ID.KeyFormats
