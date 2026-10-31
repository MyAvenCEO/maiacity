import Aven.DB.Docs.Counts

/-!
# The writer id, defined once

A writer id is the 64-bit Loro peer a device writes a branch of a Doc as, worked out, never issued (docs, rule 8;
"Writer ids"). It is BLAKE3's key derivation under the context `avenDB writer 1` over the CBOR array
`[device's public key, the Doc's id, the branch, the generation]`: the first 8 bytes of the output, little-endian, or
the next 8 when those are the one value Loro reserves, `2⁶⁴ - 1`.

What it proves: `writer_lt` (a writer id is a 64-bit peer); the vectors give the derivation for known inputs.
-/

namespace Aven.DB.Docs

open Aven.Core

/-- What the writer id is derived from, as one canonical CBOR array. -/
def writerInput (w : WriterIn) : Bytes :=
  encode (.array [.bytes w.device, .bytes w.doc.hash.bytes, .bytes w.branch, .uint w.generation])

/-- Eight bytes, little-endian. -/
def le64 (b : Bytes) : Nat := (b.take 8).foldr (fun x acc => x.toNat + 256 * acc) 0

/-- The value Loro reserves for its own use; no writer id is it. -/
def reservedPeer : Nat := 2 ^ 64 - 1

/-- `writer(device, doc, branch, generation)`. -/
def writer (w : WriterIn) : Nat :=
  let out := Blake3.deriveKey "avenDB writer 1" (writerInput w)
  let first := le64 out
  if first = reservedPeer then le64 (out.drop 8) else first

theorem foldr_lt : ∀ (l : Bytes), l.foldr (fun x acc => x.toNat + 256 * acc) 0 < 256 ^ l.length
  | [] => by simp
  | x :: xs => by
    have ih := foldr_lt xs
    have hx := x.toNat_lt
    simp only [List.foldr_cons, List.length_cons, Nat.pow_succ]
    omega

theorem le64_lt (b : Bytes) : le64 b < 2 ^ 64 :=
  calc le64 b < 256 ^ (b.take 8).length := foldr_lt _
    _ ≤ 256 ^ 8 := Nat.pow_le_pow_right (by decide) (by simp; omega)
    _ = 2 ^ 64 := by decide

/-- A writer id is a 64-bit Loro peer. -/
theorem writer_lt (w : WriterIn) : writer w < 2 ^ 64 := by
  simp only [writer]; split <;> exact le64_lt _

end Aven.DB.Docs
