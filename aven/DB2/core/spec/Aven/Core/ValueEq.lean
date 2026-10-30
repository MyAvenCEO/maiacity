import Aven.Core.Cbor

/-!
# Equality of Values

`Value` can't derive `DecidableEq` (its maps nest Values inside pairs inside lists), so it is written here once, by
structural recursion, and proven lawful (`Value.beq_iff`). Every spec compares Values with `==` or `decide (a = b)`
through this instance, never by hand. On allowed Values it agrees with comparing encodings (`encode_inj`).
-/

namespace Aven.Core

mutual
def Value.beq : Value → Value → Bool
  | .uint a, .uint b => a == b
  | .nint a, .nint b => a == b
  | .bytes a, .bytes b => a == b
  | .text a, .text b => a == b
  | .array a, .array b => Value.beqList a b
  | .map a, .map b => Value.beqMap a b
  | .bool a, .bool b => a == b
  | .null, .null => true
  | _, _ => false

def Value.beqList : List Value → List Value → Bool
  | [], [] => true
  | a :: as, b :: bs => Value.beq a b && Value.beqList as bs
  | _, _ => false

def Value.beqMap : List (Bytes × Value) → List (Bytes × Value) → Bool
  | [], [] => true
  | (k, a) :: as, (l, b) :: bs => k == l && Value.beq a b && Value.beqMap as bs
  | _, _ => false
end

mutual
theorem Value.beq_iff : ∀ (a b : Value), Value.beq a b = true ↔ a = b
  | .uint a, .uint b => by simp [Value.beq]
  | .nint a, .nint b => by simp [Value.beq]
  | .bytes a, .bytes b => by simp [Value.beq]
  | .text a, .text b => by simp [Value.beq]
  | .array a, .array b => by simp [Value.beq, Value.beqList_iff a b]
  | .map a, .map b => by simp [Value.beq, Value.beqMap_iff a b]
  | .bool a, .bool b => by simp [Value.beq]
  | .null, .null => by simp [Value.beq]
  | .uint _, .nint _ | .uint _, .bytes _ | .uint _, .text _ | .uint _, .array _ | .uint _, .map _
  | .uint _, .bool _ | .uint _, .null | .nint _, .uint _ | .nint _, .bytes _ | .nint _, .text _
  | .nint _, .array _ | .nint _, .map _ | .nint _, .bool _ | .nint _, .null | .bytes _, .uint _
  | .bytes _, .nint _ | .bytes _, .text _ | .bytes _, .array _ | .bytes _, .map _ | .bytes _, .bool _
  | .bytes _, .null | .text _, .uint _ | .text _, .nint _ | .text _, .bytes _ | .text _, .array _
  | .text _, .map _ | .text _, .bool _ | .text _, .null | .array _, .uint _ | .array _, .nint _
  | .array _, .bytes _ | .array _, .text _ | .array _, .map _ | .array _, .bool _ | .array _, .null
  | .map _, .uint _ | .map _, .nint _ | .map _, .bytes _ | .map _, .text _ | .map _, .array _
  | .map _, .bool _ | .map _, .null | .bool _, .uint _ | .bool _, .nint _ | .bool _, .bytes _
  | .bool _, .text _ | .bool _, .array _ | .bool _, .map _ | .bool _, .null | .null, .uint _
  | .null, .nint _ | .null, .bytes _ | .null, .text _ | .null, .array _ | .null, .map _
  | .null, .bool _ => by simp [Value.beq]

theorem Value.beqList_iff : ∀ (a b : List Value), Value.beqList a b = true ↔ a = b
  | [], [] => by simp [Value.beqList]
  | [], _ :: _ => by simp [Value.beqList]
  | _ :: _, [] => by simp [Value.beqList]
  | x :: xs, y :: ys => by simp [Value.beqList, Value.beq_iff x y, Value.beqList_iff xs ys]

theorem Value.beqMap_iff : ∀ (a b : List (Bytes × Value)), Value.beqMap a b = true ↔ a = b
  | [], [] => by simp [Value.beqMap]
  | [], _ :: _ => by simp [Value.beqMap]
  | _ :: _, [] => by simp [Value.beqMap]
  | (k, x) :: xs, (l, y) :: ys => by
    simp [Value.beqMap, Value.beq_iff x y, Value.beqMap_iff xs ys, and_assoc]
end

instance : DecidableEq Value := fun a b => decidable_of_iff _ (Value.beq_iff a b)

instance : BEq Value := ⟨fun a b => decide (a = b)⟩

instance : LawfulBEq Value where
  eq_of_beq h := of_decide_eq_true h
  rfl := decide_eq_true rfl

#guard (Value.map [("a".toUTF8.toList, .array [.uint 1, .null])]) == .map [("a".toUTF8.toList, .array [.uint 1, .null])]
#guard (Value.array [.uint 1]) != .array [.nint 1]

end Aven.Core
