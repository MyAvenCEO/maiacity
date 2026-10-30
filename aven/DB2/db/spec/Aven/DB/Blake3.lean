/-!
# BLAKE3

A blob's name is the BLAKE3 hash of its bytes (README, "One primitive underneath"). This is the hash as its
specification's reference implementation computes it, in core Lean, so the store's traces (`Aven.DB.Store`) carry
real names: chunks of 1024 bytes in blocks of 64, each chunk's chaining value, and a binary tree of parents whose
left side holds the largest power of two chunks that leaves the right one non-empty. Only hashing, no keyed mode or
longer output. The store's model takes the hash as a parameter; its theorems hold for any.
-/

namespace Aven.DB.Blake3

def iv : Array UInt32 :=
  #[0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]

def permutation : Array Nat := #[2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]

def flagChunkStart : UInt32 := 1
def flagChunkEnd : UInt32 := 2
def flagParent : UInt32 := 4
def flagRoot : UInt32 := 8

def rotr (x n : UInt32) : UInt32 := (x >>> n) ||| (x <<< (32 - n))

def g (v : Array UInt32) (a b c d : Nat) (mx my : UInt32) : Array UInt32 :=
  let va := v[a]! + v[b]! + mx
  let vd := rotr (v[d]! ^^^ va) 16
  let vc := v[c]! + vd
  let vb := rotr (v[b]! ^^^ vc) 12
  let va := va + vb + my
  let vd := rotr (vd ^^^ va) 8
  let vc := vc + vd
  let vb := rotr (vb ^^^ vc) 7
  (((v.set! a va).set! b vb).set! c vc).set! d vd

def round (v m : Array UInt32) : Array UInt32 :=
  let v := g v 0 4 8 12 m[0]! m[1]!
  let v := g v 1 5 9 13 m[2]! m[3]!
  let v := g v 2 6 10 14 m[4]! m[5]!
  let v := g v 3 7 11 15 m[6]! m[7]!
  let v := g v 0 5 10 15 m[8]! m[9]!
  let v := g v 1 6 11 12 m[10]! m[11]!
  let v := g v 2 7 8 13 m[12]! m[13]!
  g v 3 4 9 14 m[14]! m[15]!

def compress (cv m : Array UInt32) (counter : UInt64) (len flags : UInt32) : Array UInt32 := Id.run do
  let mut v := cv ++ iv.extract 0 4 ++ #[counter.toUInt32, (counter >>> 32).toUInt32, len, flags]
  let mut m := m
  for _ in [0:7] do
    v := round v m
    m := permutation.map (m[·]!)
  return (List.range 8).toArray.map (fun i => v[i]! ^^^ v[i + 8]!) ++
    (List.range 8).toArray.map (fun i => v[i + 8]! ^^^ cv[i]!)

/-- A block of up to 64 bytes as 16 little-endian words, zero padded. -/
def words (block : List UInt8) : Array UInt32 :=
  let b : Array UInt8 := (block ++ List.replicate (64 - block.length) (0 : UInt8)).toArray
  let w (i : Nat) : UInt32 :=
    b[4 * i]!.toUInt32 ||| (b[4 * i + 1]!.toUInt32 <<< 8) ||| (b[4 * i + 2]!.toUInt32 <<< 16) |||
      (b[4 * i + 3]!.toUInt32 <<< 24)
  (List.range 16).toArray.map w

/-- A node's last compression, not yet made: as a chaining value, or with the root flag as the hash. -/
structure Output where
  cv : Array UInt32
  block : Array UInt32
  counter : UInt64
  len : UInt32
  flags : UInt32

def Output.chain (o : Output) : Array UInt32 := (compress o.cv o.block o.counter o.len o.flags).extract 0 8

/-- 64 bytes at a time; `fuel` is at least the number of blocks. -/
def blocks : (fuel : Nat) → List UInt8 → List (List UInt8)
  | 0, bytes => [bytes]
  | f + 1, bytes => if bytes.length ≤ 64 then [bytes] else bytes.take 64 :: blocks f (bytes.drop 64)

/-- A chunk of at most 1024 bytes, chunk number `counter`. -/
def chunk (bytes : List UInt8) (counter : UInt64) : Output := Id.run do
  let bs := blocks bytes.length bytes
  let mut cv := iv
  for (b, i) in bs.dropLast.zipIdx do
    cv := (compress cv (words b) counter 64 (if i = 0 then flagChunkStart else 0)).extract 0 8
  let last := bs.getLastD []
  let first := if bs.length = 1 then flagChunkStart else 0
  return ⟨cv, words last, counter, last.length.toUInt32, first ||| flagChunkEnd⟩

/-- The largest power of two at most `n`, or 1. -/
def pow2le (n : Nat) : Nat := Id.run do
  let mut p := 1
  for _ in [0:64] do
    if 2 * p ≤ n then p := 2 * p
  return p

/-- The node over `bytes`, whose first chunk is chunk number `start`; `fuel` is at least the tree's depth. -/
def node : (fuel : Nat) → List UInt8 → Nat → Output
  | 0, bytes, start => chunk bytes start.toUInt64
  | f + 1, bytes, start =>
    if bytes.length ≤ 1024 then chunk bytes start.toUInt64 else
      let left := pow2le ((bytes.length - 1) / 1024) * 1024
      let l := node f (bytes.take left) start
      let r := node f (bytes.drop left) (start + left / 1024)
      ⟨iv, l.chain ++ r.chain, 0, 64, flagParent⟩

def hexDigit (x : UInt8) : Char := "0123456789abcdef".toList[x.toNat]!

/-- Bytes as lowercase hex. -/
def hex (bytes : List UInt8) : String :=
  String.ofList (bytes.flatMap fun (b : UInt8) => [hexDigit (b >>> 4), hexDigit (b &&& 15)])

/-- The hash of `bytes`, as 64 lowercase hex digits: how the store writes it. -/
def hash (bytes : List UInt8) : String :=
  let o := node bytes.length bytes 0
  let w := (compress o.cv o.block 0 o.len (o.flags ||| flagRoot)).extract 0 8
  hex (w.toList.flatMap fun (x : UInt32) => [x.toUInt8, (x >>> 8).toUInt8, (x >>> 16).toUInt8, (x >>> 24).toUInt8])

-- known answers: the specification's for no bytes, and `abc`
#guard hash [] = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
#guard hash "abc".toUTF8.toList = "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"

end Aven.DB.Blake3
