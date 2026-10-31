import Lean.Data.Json
import Aven.ID.Seal

/-! # The seal's vectors (`seals.json`)

For each case, the inputs (what it seals, the epoch's key, the Doc, the epoch, the nonce and the plaintext) and what
the seal makes of them around the AEAD: the cipher's key, the commitment's key, the AAD, the commitment, the padded
plaintext (A176's one padding), the outside's encoding with a fixture ciphertext (bytes in a pattern, of the padded
length plus the 16-byte tag, as aven-id's stanza fixtures are), and what a reader finds it seals by the commitment
(`sealsOf`). Then things whose commitment matches none: their expected `seals` is absent. aven-db-docs checks every
byte, and seals and opens through XChaCha20-Poly1305 itself. Then paddings a reader must refuse. The one padding's
lengths are avenID's (`derivations.json`). The readable form is Core's (A198): a hash `b3:<hex>`, a Doc `d:<hex>`,
other bytes lowercase hex; nothing is null (A200). -/

open Lean Aven.Core Aven.ID.Padme

namespace Aven.ID.Seal

def h (b : Bytes) : Json := Json.str (hex b)

def vec (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def testBytes (phrase : String) : Bytes := Blake3.digest (t phrase)

def ramp (start n : Nat) : Bytes := (List.range n).map fun i => (start + i).toUInt8

def cases : List (String × Seals × String × Bytes) :=
  [("a loose envelope", .envelope, "a Doc", t "an envelope's bytes"),
   ("a segment", .segment, "a Doc", ramp 0 300),
   ("a checkpoint", .checkpoint, "a Doc", ramp 9 1000),
   ("an empty plaintext", .envelope, "another Doc", []),
   ("the same plaintext, sealed as a segment", .segment, "a Doc", t "an envelope's bytes"),
   ("a checkpoint above 4 KiB, padded by Padmé", .checkpoint, "a Doc", ramp 3 5000)]

/-- What a reader finds it seals by the commitment (`sealsOf`), the key absent for none. -/
def sealsJson (key : Bytes) (s : Sealed) : List (String × Json) :=
  match sealsOf key s with | some k => [("seals", k.text)] | none => []

/-- Things whose commitment matches none under the key: another epoch's key, and a commitment one byte off. -/
def noKind : List Json :=
  let key := testBytes "avenSANDBOX test epoch key 0"
  let doc : DocId := ⟨blake3 (t "a Doc")⟩
  let epoch := blake3 (t "avenSANDBOX test epoch 0")
  let nonce := (testBytes "avenSANDBOX test nonce 0").take 24
  let other := testBytes "avenSANDBOX test epoch key 1"
  let c := commit .segment other (aad .segment doc epoch) nonce
  let flipped := match commit .envelope key (aad .envelope doc epoch) nonce with
    | b :: rest => (b ^^^ 1) :: rest
    | [] => []
  [("matching none: another key's commitment", c), ("matching none: a commitment one byte off", flipped)].map
    fun (name, cm) =>
      let s : Sealed := { ct := ramp 0 (padSealed 1 + 16), doc, epoch, nonce, commit := cm }
      vec name
        (Json.mkObj [("epochKey", h key), ("outside", h (encode s.value))])
        (Json.mkObj (sealsJson key s))

def sealVectors : List Json :=
  let sealed := cases.zipIdx.map fun ((name, k, d, pt), i) =>
    let key := testBytes s!"avenSANDBOX test epoch key {i % 2}"
    let doc : DocId := ⟨blake3 (t d)⟩
    let epoch := blake3 (t s!"avenSANDBOX test epoch {i % 2}")
    let nonce := (testBytes s!"avenSANDBOX test nonce {i}").take 24
    let a := aad k doc epoch
    let padded := pad pt
    let ct := ramp i (padded.length + 16)
    let s : Sealed := { ct, doc, epoch, nonce, commit := commit k key a nonce }
    vec name
      (Json.mkObj [("seals", k.text), ("epochKey", h key), ("doc", Json.str doc.text), ("epoch", Json.str epoch.text),
        ("nonce", h nonce), ("plaintext", h pt), ("ct", h ct)])
      (Json.mkObj ([("cipherKey", h (cipherKey k key)), ("commitKey", h (commitKey k key)), ("aad", h a),
        ("commit", h s.commit), ("padded", h padded), ("outside", h (encode s.value))] ++ sealsJson key s))
  let unpads := [("no 0x80", [1, 2, 0, 0]), ("all zeros", [0, 0]), ("a short padding", [1, 2, 3, 0x80, 0]),
      ("a whole padding", pad [1, 2, 3]), ("a long padding", [1, 0x80, 0, 0, 0, 0, 0, 0])].map
    fun (name, p) => vec s!"unpad: {name}" (h p)
      (Json.mkObj (match unpad p with | some x => [("plaintext", h x)] | none => []))
  sealed ++ noKind ++ unpads

end Aven.ID.Seal
