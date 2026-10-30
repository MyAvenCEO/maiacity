/-! # The cast's test keys

Every key in the box is a test key: its Ed25519 seed is `sha256("avenSANDBOX test signer: <id>")`, public on purpose
and valid only inside the box (SANDBOX.md, "Vaults own vaults"). Here they are derived in core Lean, so the public
halves in `sandbox/cast.json` come from the model too (`vectors/keys.json`): SHA-256 and SHA-512 as FIPS 180-4 defines
them, their constants computed from the primes as it describes, and an Ed25519 public key as RFC 8032 derives it. Only
what the box needs: no signing, which the model takes as sound (`Aven.ID.Sign`). -/

namespace Aven.ID.Keys

/-! ## The constants: fractional parts of square and cube roots of the first primes -/

def isPrime (n : Nat) : Bool := n ≥ 2 && (List.range (n - 2)).all fun i => n % (i + 2) != 0

def primes (k : Nat) : List Nat := ((List.range 512).filter isPrime).take k

/-- The largest `r` with `r ^ e ≤ n`, bit by bit from `2 ^ bits`. -/
def iroot (e n bits : Nat) : Nat := Id.run do
  let mut r := 0
  for i in [0:bits] do
    let c := r + 2 ^ (bits - 1 - i)
    if c ^ e ≤ n then r := c
  return r

/-- The first `w` bits of the fractional part of `p`'s `e`-th root. -/
def frac (e w p : Nat) : Nat := iroot e (p * 2 ^ (e * w)) (w + 9) % 2 ^ w

/-! ## SHA-2 -/

def rotr (w x n : Nat) : Nat := (x >>> n ||| x <<< (w - n)) % 2 ^ w

/-- One SHA-2 of word width `w` (32 or 64). -/
structure Sha where
  w : Nat
  rounds : Nat
  /-- the rotations of Σ0, Σ1, σ0, σ1, the last of each σ a shift -/
  s0 : Nat × Nat × Nat
  s1 : Nat × Nat × Nat
  m0 : Nat × Nat × Nat
  m1 : Nat × Nat × Nat

def sha256 : Sha := ⟨32, 64, (2, 13, 22), (6, 11, 25), (7, 18, 3), (17, 19, 10)⟩
def sha512 : Sha := ⟨64, 80, (28, 34, 39), (14, 18, 41), (1, 8, 7), (19, 61, 6)⟩

def Sha.k (h : Sha) : Array Nat := ((primes h.rounds).map (frac 3 h.w)).toArray
def Sha.iv (h : Sha) : List Nat := (primes 8).map (frac 2 h.w)

/-- A big-endian number of `n` bytes. -/
def be (n x : Nat) : List UInt8 := (List.range n).reverse.map fun i => (x >>> (8 * i)).toUInt8

def Sha.digest (h : Sha) (msg : List UInt8) : List UInt8 := Id.run do
  let w := h.w
  let m := 2 ^ w
  let block := 16 * w / 8
  let lenBytes := 2 * w / 8
  let pad := (block - (msg.length + 1 + lenBytes) % block) % block
  let data := (msg ++ [0x80] ++ List.replicate pad 0 ++ be lenBytes (8 * msg.length)).toArray
  let rot := rotr w
  let big (s : Nat × Nat × Nat) (x : Nat) := rot x s.1 ^^^ rot x s.2.1 ^^^ rot x s.2.2
  let small (s : Nat × Nat × Nat) (x : Nat) := rot x s.1 ^^^ rot x s.2.1 ^^^ (x >>> s.2.2)
  let k := h.k
  let mut hs := h.iv.toArray
  for b in [0:data.size / block] do
    let mut ws : Array Nat := (List.range 16).toArray.map fun i =>
      (List.range (w / 8)).foldl (fun acc j => acc * 256 + data[b * block + i * (w / 8) + j]!.toNat) 0
    for t in [16:h.rounds] do
      ws := ws.push ((small h.m1 ws[t - 2]! + ws[t - 7]! + small h.m0 ws[t - 15]! + ws[t - 16]!) % m)
    let mut v := hs
    for t in [0:h.rounds] do
      let (a, bb, c, d, e, f, g, hh) := (v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!)
      let ch := (e &&& f) ^^^ ((m - 1 - e) &&& g)
      let maj := (a &&& bb) ^^^ (a &&& c) ^^^ (bb &&& c)
      let t1 := (hh + big h.s1 e + ch + k[t]! + ws[t]!) % m
      let t2 := (big h.s0 a + maj) % m
      v := #[(t1 + t2) % m, a, bb, c, (d + t1) % m, e, f, g]
    hs := (List.range 8).toArray.map fun i => (hs[i]! + v[i]!) % m
  return hs.toList.flatMap (be (w / 8))

/-! ## Ed25519's public key (RFC 8032, 5.1.5) -/

def p : Nat := 2 ^ 255 - 19

def powMod (b e m : Nat) : Nat := Id.run do
  let mut r := 1
  let mut b := b % m
  let mut e := e
  for _ in [0:256] do
    if e % 2 = 1 then r := r * b % m
    b := b * b % m
    e := e / 2
  return r

def inv (x : Nat) : Nat := powMod x (p - 2) p

def d : Nat := (p - 121665) * inv 121666 % p

/-- A point in extended coordinates (X : Y : Z : T), x = X/Z, y = Y/Z, xy = T/Z. -/
structure Point where
  x : Nat
  y : Nat
  z : Nat
  t : Nat

def sub (a b : Nat) : Nat := (a + p - b % p) % p

/-- Addition on the curve, complete for Ed25519 (Hisil, Wong, Carter and Dawson, a = -1). -/
def add (P Q : Point) : Point :=
  let a := sub P.y P.x * sub Q.y Q.x % p
  let b := (P.y + P.x) * (Q.y + Q.x) % p
  let c := P.t * 2 * d % p * Q.t % p
  let dd := P.z * 2 * Q.z % p
  let (e, f, g, h) := (sub b a, sub dd c, (dd + c) % p, (b + a) % p)
  ⟨e * f % p, g * h % p, f * g % p, e * h % p⟩

def base : Point :=
  let y := 4 * inv 5 % p
  let x := 15112221349535400772501151409588531511454012693041857206046113283949847762202
  ⟨x, y, 1, x * y % p⟩

def mul (k : Nat) (P : Point) : Point := Id.run do
  let mut r : Point := ⟨0, 1, 1, 0⟩
  let mut q := P
  let mut k := k
  for _ in [0:256] do
    if k % 2 = 1 then r := add r q
    q := add q q
    k := k / 2
  return r

def le (n x : Nat) : List UInt8 := (List.range n).map fun i => (x >>> (8 * i)).toUInt8

def publicKey (seed : List UInt8) : List UInt8 :=
  let h := sha512.digest seed
  let a := (h.take 32).reverse.foldl (fun acc b => acc * 256 + b.toNat) 0
  let a := (((a % 2 ^ 254) >>> 3) <<< 3) ||| 2 ^ 254
  let A := mul a base
  let zi := inv A.z
  let (x, y) := (A.x * zi % p, A.y * zi % p)
  le 32 (y ||| (x % 2) <<< 255)

def hex (bytes : List UInt8) : String :=
  let digit (x : UInt8) := "0123456789abcdef".toList[x.toNat]!
  String.ofList (bytes.flatMap fun (b : UInt8) => [digit (b >>> 4), digit (b &&& 15)])

def unhex (s : String) : List UInt8 :=
  let v (c : Char) := if c.isDigit then c.toNat - '0'.toNat else c.toNat - 'a'.toNat + 10
  let cs := s.toList
  (List.range (cs.length / 2)).map fun i => (16 * v cs[2 * i]! + v cs[2 * i + 1]!).toUInt8

/-- A cast key's seed. -/
def seed (id : String) : List UInt8 := sha256.digest s!"avenSANDBOX test signer: {id}".toUTF8.toList

/-! ## Known answers -/

#guard hex (sha256.digest "abc".toUTF8.toList) = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
#guard hex (sha512.digest "abc".toUTF8.toList) = "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" ++
  "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
-- RFC 8032, 7.1, test 1
#guard hex (publicKey (unhex "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")) =
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
-- the cast's, as SANDBOX.md writes it: Alice Peer-Light's key starts 9f78
#guard (hex (publicKey (seed "alice-peer-light"))).startsWith "9f78"

end Aven.ID.Keys
