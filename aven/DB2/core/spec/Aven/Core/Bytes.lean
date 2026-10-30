/-!
# Bytes

Bytes are a list of `UInt8`, as in `Aven.DB`. This file holds the few facts about them the codec needs: numbers
written big-endian in a fixed number of bytes and read back, and the bytewise order deterministic CBOR sorts map keys
by.
-/

namespace Aven.Core

abbrev Bytes := List UInt8

/-! ## Numbers in a fixed number of bytes -/

/-- `n` in `k` bytes, least significant first. -/
def le : Nat → Nat → Bytes
  | 0, _ => []
  | k + 1, n => UInt8.ofNat (n % 256) :: le k (n / 256)

/-- Bytes, least significant first, as a number. -/
def leNat : Bytes → Nat
  | [] => 0
  | b :: l => b.toNat + 256 * leNat l

/-- `n` in `k` bytes, big-endian: how CBOR writes an argument. -/
def be (k n : Nat) : Bytes := (le k n).reverse

/-- Big-endian bytes as a number. -/
def beNat (l : Bytes) : Nat := leNat l.reverse

theorem le_length : ∀ k n, (le k n).length = k
  | 0, _ => rfl
  | k + 1, n => by simp [le, le_length k]

theorem be_length (k n : Nat) : (be k n).length = k := by simp [be, le_length]

theorem leNat_le : ∀ k n, leNat (le k n) = n % 256 ^ k
  | 0, n => by simp [le, leNat, Nat.mod_one]
  | k + 1, n => by
    simp only [le, leNat, UInt8.toNat_ofNat', leNat_le k, Nat.reducePow]
    have h : 256 ^ (k + 1) = 256 * 256 ^ k := by rw [Nat.pow_succ, Nat.mul_comm]
    rw [h, Nat.mod_mul]
    omega

theorem le_leNat : ∀ (l : Bytes), le l.length (leNat l) = l
  | [] => rfl
  | b :: l => by
    have hb := b.toNat_lt
    have h1 : (b.toNat + 256 * leNat l) % 256 = b.toNat := by omega
    have h2 : (b.toNat + 256 * leNat l) / 256 = leNat l := by omega
    simp only [List.length_cons, le, leNat, h1, h2, le_leNat l, UInt8.ofNat_toNat]

theorem beNat_be (k n : Nat) : beNat (be k n) = n % 256 ^ k := by
  simp [beNat, be, leNat_le]

theorem be_beNat (l : Bytes) : be l.length (beNat l) = l := by
  have := le_leNat l.reverse
  simp only [List.length_reverse] at this
  simp [be, beNat, this]

theorem beNat_lt : ∀ (l : Bytes), beNat l < 256 ^ l.length := by
  intro l
  have h : ∀ (m : Bytes), leNat m < 256 ^ m.length := by
    intro m
    induction m with
    | nil => simp [leNat]
    | cons b m ih =>
      have := b.toNat_lt
      simp only [leNat, List.length_cons, Nat.pow_succ]
      omega
  simpa [beNat] using h l.reverse

/-! ## Bytewise order -/

/-- `a` sorts strictly before `b`, byte by byte, a prefix first: the order of RFC 8949's core deterministic encoding. -/
def lexLt : Bytes → Bytes → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | x :: xs, y :: ys => x < y || (x == y && lexLt xs ys)

theorem lexLt_irrefl : ∀ (a : Bytes), lexLt a a = false
  | [] => rfl
  | x :: xs => by simp [lexLt, lexLt_irrefl xs]

/-- Each entry sorts strictly before the next: sorted with no duplicates. -/
def strictlySorted : List Bytes → Bool
  | a :: b :: rest => lexLt a b && strictlySorted (b :: rest)
  | _ => true

/-! ## Hex, the readable form of bytes -/

def hexDigit (x : Nat) : Char := "0123456789abcdef".toList[x]!

def hex (bytes : Bytes) : String :=
  String.ofList (bytes.flatMap fun b => [hexDigit (b.toNat / 16), hexDigit (b.toNat % 16)])

end Aven.Core
