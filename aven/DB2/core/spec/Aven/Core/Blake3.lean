/-!
# BLAKE3

Every Value's name is the BLAKE3 hash of its bytes (ARCHITECTURE.md, "Value"). This is the hash as its
specification's reference implementation computes it, in core Lean, so the store's traces (`Aven.DB.Store`) carry
real names: chunks of 1024 bytes in blocks of 64, each chunk's chaining value, and a binary tree of parents whose
left side holds the largest power of two chunks that leaves the right one non-empty. Hashing, key derivation
(`deriveKey`, the specification's `derive_key`, for writer ids), the keyed mode (`keyedHash`) and the extendable
output of all three (`digestXof`, `keyedXof`, `deriveKeyXof`), for avenID's keys (`Aven.ID.KeyFormats`). The models
take the hash as a parameter, and their theorems hold for any injective one; this is the one their examples and
vectors use. It moved here from `Aven.DB.Blake3`, which now names it.
-/

namespace Aven.Core.Blake3

def iv : Array UInt32 :=
  #[0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]

def permutation : Array Nat := #[2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8]

def flagChunkStart : UInt32 := 1
def flagChunkEnd : UInt32 := 2
def flagParent : UInt32 := 4
def flagRoot : UInt32 := 8
def flagKeyedHash : UInt32 := 16
def flagDeriveKeyContext : UInt32 := 32
def flagDeriveKeyMaterial : UInt32 := 64

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

/-- A chunk of at most 1024 bytes, chunk number `counter`, under key words `key` and the mode's flags `mode`. -/
def chunkWith (key : Array UInt32) (mode : UInt32) (bytes : List UInt8) (counter : UInt64) : Output := Id.run do
  let bs := blocks bytes.length bytes
  let mut cv := key
  for (b, i) in bs.dropLast.zipIdx do
    cv := (compress cv (words b) counter 64 (mode ||| if i = 0 then flagChunkStart else 0)).extract 0 8
  let last := bs.getLastD []
  let first := if bs.length = 1 then flagChunkStart else 0
  return ⟨cv, words last, counter, last.length.toUInt32, mode ||| first ||| flagChunkEnd⟩

/-- A chunk, hashing. -/
def chunk (bytes : List UInt8) (counter : UInt64) : Output := chunkWith iv 0 bytes counter

/-- The largest power of two at most `n`, or 1. -/
def pow2le (n : Nat) : Nat := Id.run do
  let mut p := 1
  for _ in [0:64] do
    if 2 * p ≤ n then p := 2 * p
  return p

/-- The node over `bytes`, whose first chunk is chunk number `start`, under `key` and `mode`; `fuel` is at least the
tree's depth. -/
def nodeWith (key : Array UInt32) (mode : UInt32) : (fuel : Nat) → List UInt8 → Nat → Output
  | 0, bytes, start => chunkWith key mode bytes start.toUInt64
  | f + 1, bytes, start =>
    if bytes.length ≤ 1024 then chunkWith key mode bytes start.toUInt64 else
      let left := pow2le ((bytes.length - 1) / 1024) * 1024
      let l := nodeWith key mode f (bytes.take left) start
      let r := nodeWith key mode f (bytes.drop left) (start + left / 1024)
      ⟨key, l.chain ++ r.chain, 0, 64, mode ||| flagParent⟩

/-- The node over `bytes`, hashing. -/
def node (fuel : Nat) (bytes : List UInt8) (start : Nat) : Output := nodeWith iv 0 fuel bytes start

def hexDigit (x : UInt8) : Char := "0123456789abcdef".toList[x.toNat]!

/-- Bytes as lowercase hex. -/
def hex (bytes : List UInt8) : String :=
  String.ofList (bytes.flatMap fun (b : UInt8) => [hexDigit (b >>> 4), hexDigit (b &&& 15)])

/-- The 32 bytes of the root over `bytes`, under `key` and `mode`. -/
def digestWith (key : Array UInt32) (mode : UInt32) (bytes : List UInt8) : List UInt8 :=
  let o := nodeWith key mode bytes.length bytes 0
  let w := (compress o.cv o.block 0 o.len (o.flags ||| flagRoot)).extract 0 8
  w.toList.flatMap fun (x : UInt32) => [x.toUInt8, (x >>> 8).toUInt8, (x >>> 16).toUInt8, (x >>> 24).toUInt8]

/-- Words as little-endian bytes. -/
def leBytes (w : Array UInt32) : List UInt8 :=
  w.toList.flatMap fun (x : UInt32) => [x.toUInt8, (x >>> 8).toUInt8, (x >>> 16).toUInt8, (x >>> 24).toUInt8]

/-- `n` bytes of the root's extendable output over `bytes`, under `key` and `mode`: output block `i` is the root's
compression with counter `i`, all 16 words, so the first 32 bytes are `digestWith`'s. -/
def xofWith (key : Array UInt32) (mode : UInt32) (bytes : List UInt8) (n : Nat) : List UInt8 :=
  let o := nodeWith key mode bytes.length bytes 0
  ((List.range ((n + 63) / 64)).flatMap fun i =>
    leBytes (compress o.cv o.block i.toUInt64 o.len (o.flags ||| flagRoot))).take n

/-- The 32 bytes of the hash of `bytes`. -/
def digest (bytes : List UInt8) : List UInt8 := digestWith iv 0 bytes

/-- `n` bytes of the hash's extendable output. -/
def digestXof (bytes : List UInt8) (n : Nat) : List UInt8 := xofWith iv 0 bytes n

/-- A 32-byte key as the words that replace the IV. -/
def keyWords (key : List UInt8) : Array UInt32 := (words key).extract 0 8

/-- The keyed hash (the specification's `keyed_hash`): the 32-byte key replaces the IV. -/
def keyedHash (key : List UInt8) (bytes : List UInt8) : List UInt8 := digestWith (keyWords key) flagKeyedHash bytes

/-- `n` bytes of the keyed hash's extendable output. -/
def keyedXof (key : List UInt8) (bytes : List UInt8) (n : Nat) : List UInt8 :=
  xofWith (keyWords key) flagKeyedHash bytes n

/-- Key derivation (the specification's `derive_key`): the context string is hashed in its own mode into a key, under
which the key material is hashed in another. -/
def deriveKey (context : String) (material : List UInt8) : List UInt8 :=
  let ctx := digestWith iv flagDeriveKeyContext context.toUTF8.toList
  digestWith ((words ctx).extract 0 8) flagDeriveKeyMaterial material

/-- `n` bytes of key derivation's extendable output; the first 32 are `deriveKey`'s. -/
def deriveKeyXof (context : String) (material : List UInt8) (n : Nat) : List UInt8 :=
  let ctx := digestWith iv flagDeriveKeyContext context.toUTF8.toList
  xofWith (keyWords ctx) flagDeriveKeyMaterial material n

/-- The hash of `bytes`, as 64 lowercase hex digits: how the store writes it. -/
def hash (bytes : List UInt8) : String := hex (digest bytes)

-- known answers: the specification's for no bytes, and `abc`
#guard hash [] = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
#guard hash "abc".toUTF8.toList = "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"

-- key derivation's known answers: the specification's test vectors (`test_vectors/test_vectors.json` in the BLAKE3
-- repository, its `derive_key` cases, first 32 bytes), over inputs `i mod 251` of 0, 1, 1024, 1025 and 3073 bytes
def tvInput (n : Nat) : List UInt8 := (List.range n).map fun i => (i % 251).toUInt8
def tvContext : String := "BLAKE3 2019-12-27 16:29:52 test vectors context"
#guard hex (deriveKey tvContext (tvInput 0)) = "2cc39783c223154fea8dfb7c1b1660f2ac2dcbd1c1de8277b0b0dd39b7e50d7d"
#guard hex (deriveKey tvContext (tvInput 1)) = "b3e2e340a117a499c6cf2398a19ee0d29cca2bb7404c73063382693bf66cb06c"
#guard hex (deriveKey tvContext (tvInput 1024)) = "7356cd7720d5b66b6d0697eb3177d9f8d73a4a5c5e968896eb6a689684302706"
#guard hex (deriveKey tvContext (tvInput 1025)) = "effaa245f065fbf82ac186839a249707c3bddf6d3fdda22d1b95a3c970379bcb"
#guard hex (deriveKey tvContext (tvInput 3073)) = "72613c9ec9ff7e40f8f5c173784c532ad852e827dba2bf85b2ab4b76f7079081"

-- the keyed hash's and the extendable output's known answers, from the same file: its `keyed_hash` cases under the key
-- `whats the Elvish word for friend`, and the first 80 bytes of each mode's extended output
def tvKey : List UInt8 := "whats the Elvish word for friend".toUTF8.toList
#guard hex (keyedHash tvKey (tvInput 0)) = "92b2b75604ed3c761f9d6f62392c8a9227ad0ea3f09573e783f1498a4ed60d26"
#guard hex (keyedHash tvKey (tvInput 1)) = "6d7878dfff2f485635d39013278ae14f1454b8c0a3a2d34bc1ab38228a80c95b"
#guard hex (keyedHash tvKey (tvInput 1024)) = "75c46f6f3d9eb4f55ecaaee480db732e6c2105546f1e675003687c31719c7ba4"
#guard hex (keyedHash tvKey (tvInput 1025)) = "357dc55de0c7e382c900fd6e320acc04146be01db6a8ce7210b7189bd664ea69"
#guard hex (keyedHash tvKey (tvInput 3073)) = "68dede9bef00ba89e43f31a6825f4cf433389fedae75c04ee9f0cf16a427c95a"
#guard hex (digestXof (tvInput 0) 40) = "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262e00f03e7b69af26b"
#guard hex (keyedXof tvKey (tvInput 1025) 40) = "357dc55de0c7e382c900fd6e320acc04146be01db6a8ce7210b7189bd664ea69362396b77fdc0d26"
#guard hex (deriveKeyXof tvContext (tvInput 3073) 80) = "72613c9ec9ff7e40f8f5c173784c532ad852e827dba2bf85b2ab4b76f7079081" ++
  "576288e552647a9d86481c2cae75c2dd4e7c5195fb9ada1ef50e9c5098c249d743929191441301c69e1f48505a4305ec"

end Aven.Core.Blake3
