import Lean.Data.Json
import Aven.ID.Seal

/-! # The seal's vectors (`seals.json`)

For each case, the inputs (the kind, the epoch's key, the Doc, the epoch, the nonce and the plaintext) and what the
seal makes of them around the AEAD: the cipher's key, the commitment's key, the AAD, the commitment, the padded
plaintext, and the outside's encoding with a fixture ciphertext (bytes in a pattern, of the padded length plus the
16-byte tag, as aven-id's stanza fixtures are). aven-db-docs checks every byte, and seals and opens through
XChaCha20-Poly1305 itself. Then Padmé's lengths, and paddings a reader must refuse. Bytes are lowercase hex. -/

open Lean Aven.Core Aven.ID.Padme

namespace Aven.ID.Seal

def h (b : Bytes) : Json := Json.str (hex b)

def vec (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def testBytes (phrase : String) : Bytes := Blake3.digest (t phrase)

def ramp (start n : Nat) : Bytes := (List.range n).map fun i => (start + i).toUInt8

def cases : List (String × Kind × String × Bytes) :=
  [("a loose envelope", .envelope, "a Doc", t "an envelope's bytes"),
   ("a segment", .segment, "a Doc", ramp 0 300),
   ("a checkpoint", .snapshot, "a Doc", ramp 9 1000),
   ("an empty plaintext", .envelope, "another Doc", []),
   ("the same plaintext, another kind", .segment, "a Doc", t "an envelope's bytes")]

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
      (Json.mkObj [("kind", k.text), ("epochKey", h key), ("doc", Json.str doc.text), ("epoch", h epoch.bytes),
        ("nonce", h nonce), ("plaintext", h pt), ("ct", h ct)])
      (Json.mkObj [("cipherKey", h (cipherKey k key)), ("commitKey", h (commitKey k key)), ("aad", h a),
        ("commit", h s.commit), ("padded", h padded), ("outside", h (encode s.value))])
  let lengths := [0, 1, 2, 9, 15, 16, 17, 100, 129, 1000, 1025, 65536, 1048577].map fun l =>
    vec s!"Padmé of {l}" (toJson l) (toJson (padme l))
  let unpads := [("no 0x80", [1, 2, 0, 0]), ("all zeros", [0, 0]), ("a short padding", [1, 2, 3, 0x80, 0]),
      ("a whole padding", pad [1, 2, 3]), ("a long padding", [1, 0x80, 0, 0, 0, 0, 0, 0])].map
    fun (name, p) => vec s!"unpad: {name}" (h p) (match unpad p with | some x => h x | none => Json.null)
  sealed ++ lengths ++ unpads

end Aven.ID.Seal
