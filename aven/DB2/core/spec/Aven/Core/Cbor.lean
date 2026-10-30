import Aven.Core.Bytes

/-!
# Value and the one codec

Everything avenDB signs or names has one encoding: deterministic CBOR, RFC 8949's core deterministic encoding, in a
strict profile (ARCHITECTURE.md, rule 1, A2; Samuel, 30 Oct 2026):

- unsigned and negative integers below 2⁶⁴, byte strings, text, arrays, maps, `true`, `false`, `null`;
- no floats, no tags, no other simple values, no indefinite lengths;
- every length and number in its shortest form;
- map keys are text, sorted bytewise by their encodings, with no duplicates;
- text is valid UTF-8 (RFC 3629): no overlong forms, no surrogates, nothing above U+10FFFF;
- a hash is a byte string of its 32 bytes.

What it proves (rule 1): decoding an encoding gives the Value back (`decode_encode`), and every byte string the decoder
accepts is exactly the encoding of what it decoded (`encode_decode`), so bytes that don't encode back to themselves are
refused. JSON is only the readable form (`Vectors.lean`).
-/

namespace Aven.Core

/-- A Value in the strict profile. Text holds its UTF-8 bytes, and a map's keys are text, as UTF-8 bytes. -/
inductive Value where
  | uint (n : Nat)
  /-- the integer `-1 - n` -/
  | nint (n : Nat)
  | bytes (b : Bytes)
  | text (b : Bytes)
  | array (xs : List Value)
  | map (kvs : List (Bytes × Value))
  | bool (b : Bool)
  | null
  deriving Repr, Inhabited

/-! ## UTF-8 -/

/-- A continuation byte, `80`–`BF`. -/
def cont (b : UInt8) : Bool := 0x80 ≤ b && b ≤ 0xBF

/-- Valid UTF-8, RFC 3629's table 3-7. -/
def utf8 : Bytes → Bool
  | [] => true
  | a :: r =>
    if a < 0x80 then utf8 r
    else if 0xC2 ≤ a && a ≤ 0xDF then
      match r with
      | b :: r => cont b && utf8 r
      | [] => false
    else if 0xE0 ≤ a && a ≤ 0xEF then
      match r with
      | b :: c :: r =>
        (if a == 0xE0 then 0xA0 ≤ b && b ≤ 0xBF else if a == 0xED then 0x80 ≤ b && b ≤ 0x9F else cont b) &&
          cont c && utf8 r
      | _ => false
    else if 0xF0 ≤ a && a ≤ 0xF4 then
      match r with
      | b :: c :: d :: r =>
        (if a == 0xF0 then 0x90 ≤ b && b ≤ 0xBF else if a == 0xF4 then 0x80 ≤ b && b ≤ 0x8F else cont b) &&
          cont c && cont d && utf8 r
      | _ => false
    else false

/-! ## Encoding -/

/-- The largest number the profile allows, plus one. -/
abbrev limit : Nat := 2 ^ 64

/-- A data item's head: its major type and its argument, in the shortest form. -/
def head (major n : Nat) : Bytes :=
  let m := major * 32
  if n < 24 then [UInt8.ofNat (m + n)]
  else if n < 256 then UInt8.ofNat (m + 24) :: be 1 n
  else if n < 65536 then UInt8.ofNat (m + 25) :: be 2 n
  else if n < 4294967296 then UInt8.ofNat (m + 26) :: be 4 n
  else UInt8.ofNat (m + 27) :: be 8 n

/-- A map key's encoding, which keys are sorted by. -/
def keyBytes (k : Bytes) : Bytes := head 3 k.length ++ k

mutual
def encode : Value → Bytes
  | .uint n => head 0 n
  | .nint n => head 1 n
  | .bytes b => head 2 b.length ++ b
  | .text b => head 3 b.length ++ b
  | .array xs => head 4 xs.length ++ encodeList xs
  | .map kvs => head 5 kvs.length ++ encodeMap kvs
  | .bool false => [0xF4]
  | .bool true => [0xF5]
  | .null => [0xF6]

def encodeList : List Value → Bytes
  | [] => []
  | v :: vs => encode v ++ encodeList vs

def encodeMap : List (Bytes × Value) → Bytes
  | [] => []
  | (k, v) :: kvs => keyBytes k ++ encode v ++ encodeMap kvs
end

/-- The keys of a map are sorted strictly by their encodings. -/
def keysSorted (kvs : List (Bytes × Value)) : Bool := strictlySorted (kvs.map fun kv => keyBytes kv.1)

/-- A text's bytes are allowed: valid UTF-8, and a length the profile can write. -/
def textOk (b : Bytes) : Bool := b.length < limit && utf8 b

mutual
/-- A Value the profile allows. Only these have an encoding the decoder accepts. -/
def Canon : Value → Bool
  | .uint n => n < limit
  | .nint n => n < limit
  | .bytes b => b.length < limit
  | .text b => textOk b
  | .array xs => xs.length < limit && CanonList xs
  | .map kvs => kvs.length < limit && keysSorted kvs && CanonMap kvs
  | .bool _ => true
  | .null => true

def CanonList : List Value → Bool
  | [] => true
  | v :: vs => Canon v && CanonList vs

def CanonMap : List (Bytes × Value) → Bool
  | [] => true
  | (k, v) :: kvs => textOk k && Canon v && CanonMap kvs
end

/-! ## Decoding -/

/-- `k` bytes of argument, refused unless at least `lo`, the smallest number that needs them. -/
def readArg (major k lo : Nat) (r : Bytes) : Option (Nat × Nat × Bytes) :=
  if k ≤ r.length ∧ lo ≤ beNat (r.take k) then some (major, beNat (r.take k), r.drop k) else none

/-- A head: major type, argument, the rest. Refused unless the argument is in its shortest form; indefinite lengths
and reserved forms are refused. -/
def readHead : Bytes → Option (Nat × Nat × Bytes)
  | [] => none
  | b :: r =>
    let m := b.toNat / 32
    let ai := b.toNat % 32
    if ai < 24 then some (m, ai, r)
    else if ai = 24 then readArg m 1 24 r
    else if ai = 25 then readArg m 2 256 r
    else if ai = 26 then readArg m 4 65536 r
    else if ai = 27 then readArg m 8 4294967296 r
    else none

mutual
/-- One data item and the bytes after it. `fuel` bounds the nesting. -/
def decode : Nat → Bytes → Option (Value × Bytes)
  | 0, _ => none
  | fuel + 1, bs =>
    match readHead bs with
    | none => none
    | some (major, n, r) =>
      if major = 0 then some (.uint n, r)
      else if major = 1 then some (.nint n, r)
      else if major = 2 then
        if n ≤ r.length then some (.bytes (r.take n), r.drop n) else none
      else if major = 3 then
        if n ≤ r.length ∧ utf8 (r.take n) then some (.text (r.take n), r.drop n) else none
      else if major = 4 then
        match decodeList fuel n r with
        | some (xs, r') => some (.array xs, r')
        | none => none
      else if major = 5 then
        match decodeMap fuel n r with
        | some (kvs, r') => if keysSorted kvs then some (.map kvs, r') else none
        | none => none
      else if major = 7 then
        if n = 20 then some (.bool false, r)
        else if n = 21 then some (.bool true, r)
        else if n = 22 then some (.null, r)
        else none
      else none

def decodeList : Nat → Nat → Bytes → Option (List Value × Bytes)
  | _, 0, bs => some ([], bs)
  | fuel, n + 1, bs =>
    match decode fuel bs with
    | some (v, r) =>
      match decodeList fuel n r with
      | some (vs, r') => some (v :: vs, r')
      | none => none
    | none => none

def decodeMap : Nat → Nat → Bytes → Option (List (Bytes × Value) × Bytes)
  | _, 0, bs => some ([], bs)
  | fuel, n + 1, bs =>
    match decode fuel bs with
    | some (.text k, r) =>
      match decode fuel r with
      | some (v, r') =>
        match decodeMap fuel n r' with
        | some (kvs, r'') => some ((k, v) :: kvs, r'')
        | none => none
      | none => none
    | _ => none
end

/-- A whole byte string as one Value: nothing may follow it. -/
def decodeAll (bs : Bytes) : Option Value :=
  match decode (bs.length + 1) bs with
  | some (v, []) => some v
  | _ => none

/-! ## Examples (RFC 8949, appendix A, where the profile allows them) -/

#guard encode (.uint 0) = [0x00]
#guard encode (.uint 23) = [0x17]
#guard encode (.uint 24) = [0x18, 0x18]
#guard encode (.uint 1000) = [0x19, 0x03, 0xE8]
#guard encode (.uint 1000000) = [0x1A, 0x00, 0x0F, 0x42, 0x40]
#guard encode (.uint 18446744073709551615) = [0x1B, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]
#guard encode (.nint 0) = [0x20]
#guard encode (.nint 99) = [0x38, 0x63]
#guard encode (.text "IETF".toUTF8.toList) = [0x64, 0x49, 0x45, 0x54, 0x46]
#guard encode (.array [.uint 1, .array [.uint 2, .uint 3]]) = [0x82, 0x01, 0x82, 0x02, 0x03]
#guard encode (.map [("a".toUTF8.toList, .uint 1), ("b".toUTF8.toList, .array [.uint 2])]) =
  [0xA2, 0x61, 0x61, 0x01, 0x61, 0x62, 0x81, 0x02]
#guard decodeAll [0x18, 0x18] |>.isSome
-- Not the shortest form.
#guard decodeAll [0x18, 0x17] |>.isNone
#guard decodeAll [0x19, 0x00, 0xFF] |>.isNone
-- A half float, a tag, an indefinite array, a simple value of one byte.
#guard decodeAll [0xF9, 0x3C, 0x00] |>.isNone
#guard decodeAll [0xC0, 0x00] |>.isNone
#guard decodeAll [0x9F, 0x01, 0xFF] |>.isNone
#guard decodeAll [0xF8, 0x20] |>.isNone
-- Keys out of order, a duplicate key, a key that isn't text.
#guard decodeAll [0xA2, 0x61, 0x62, 0x01, 0x61, 0x61, 0x02] |>.isNone
#guard decodeAll [0xA2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02] |>.isNone
#guard decodeAll [0xA1, 0x01, 0x02] |>.isNone
-- A shorter key sorts first: its encoding is shorter.
#guard decodeAll [0xA2, 0x61, 0x62, 0x01, 0x62, 0x61, 0x61, 0x02] |>.isSome
-- An overlong `/`, a surrogate, a lone continuation byte.
#guard decodeAll [0x62, 0xC0, 0xAF] |>.isNone
#guard decodeAll [0x63, 0xED, 0xA0, 0x80] |>.isNone
#guard decodeAll [0x61, 0x80] |>.isNone
#guard decodeAll [0x64, 0xF0, 0x9F, 0x98, 0x80] |>.isSome
-- Something after the item, or too little of it.
#guard decodeAll [0x01, 0x01] |>.isNone
#guard decodeAll [0x42, 0x01] |>.isNone

end Aven.Core
