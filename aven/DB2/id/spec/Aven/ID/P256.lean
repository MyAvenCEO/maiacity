import Aven.ID.Keys

/-! # Passkeys' test keys: P-256

A passkey's key is ECDSA on P-256, the curve WebAuthn's ES256 names (PRODUCTION.md, "Lean first"). Its signature is
taken as sound (`Aven.ID.Passkey`); only the public half is computed here, so the test passkeys' public keys in the
vectors come from the model too, as `Aven.ID.Keys` does for Ed25519. A test passkey's private scalar is
`sha256("avenSANDBOX test passkey: <id>")`, public on purpose and valid only in tests; its public half is written as
the browser's `getPublicKey()` gives it: SubjectPublicKeyInfo, DER, uncompressed (SEC 1). -/

namespace Aven.ID.P256

open Keys (sha256 hex be powMod)

/-- The field's prime, the group's order, the curve's `b` (SP 800-186, 3.2.1.3); `a` is -3. -/
def p : Nat := 2 ^ 256 - 2 ^ 224 + 2 ^ 192 + 2 ^ 96 - 1
def n : Nat := 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
def b : Nat := 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b

/-- A point in affine coordinates, or the point at infinity. -/
inductive Point where
  | zero
  | at (x y : Nat)

def gen : Point := .at 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296
  0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5

def inv (x : Nat) : Nat := powMod x (p - 2) p
def sub (x y : Nat) : Nat := (x + p - y % p) % p

def add : Point → Point → Point
  | .zero, q => q
  | q, .zero => q
  | .at x1 y1, .at x2 y2 =>
    if x1 = x2 ∧ (y1 + y2) % p = 0 then .zero
    else
      let l := if x1 = x2 then (3 * x1 * x1 + p - 3) * inv (2 * y1) % p else sub y2 y1 * inv (sub x2 x1) % p
      let x3 := sub (sub (l * l) x1) x2
      .at x3 (sub (l * sub x1 x3) y1)

def mul (k : Nat) (q : Point) : Point := Id.run do
  let mut r := Point.zero
  let mut q := q
  let mut k := k
  for _ in [0:256] do
    if k % 2 = 1 then r := add r q
    q := add q q
    k := k / 2
  return r

/-- `id_ecPublicKey` with `prime256v1`, then the BIT STRING of an uncompressed point: what precedes `x ‖ y`. -/
def spkiPrefix : String := "3059301306072a8648ce3d020106082a8648ce3d030107034200" ++ "04"

/-- The public half of a private scalar, as SubjectPublicKeyInfo in hex. -/
def publicKey (d : Nat) : String :=
  match mul d gen with
  | .at x y => spkiPrefix ++ hex (be 32 x) ++ hex (be 32 y)
  | .zero => ""

/-- A test passkey's private scalar. -/
def scalar (id : String) : Nat :=
  ((sha256.digest s!"avenSANDBOX test passkey: {id}".toUTF8.toList).foldl (fun acc x => acc * 256 + x.toNat) 0) % n

/-! ## Known answers -/

-- RFC 6979, A.2.5: the key pair of its P-256 examples
#guard publicKey 0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721 = spkiPrefix ++
  "60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6" ++
  "7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299"

end Aven.ID.P256
