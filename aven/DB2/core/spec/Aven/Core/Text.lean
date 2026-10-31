import Aven.Core.Cbor

/-!
# Text: Lean's strings as the codec's

A `String`'s UTF-8 bytes (`text`) are valid UTF-8 as the codec's table says (RFC 3629, `utf8`): every character Lean
encodes is one the table accepts (`utf8_encodeChar`), so `utf8_text`. And a string reads back from them
(`fromUTF8_text`), so text is injective (`text_inj`). Every spec that writes a `String` as a Value's text leans on these.
-/

namespace Aven.Core

/-- A string's UTF-8 bytes, as a Value's text holds them. -/
def text (s : String) : Bytes := s.toUTF8.data.toList


private theorem t (x : Nat) (h : x < 256) : (UInt8.ofNat x).toNat = x := by simp [Nat.mod_eq_of_lt h]

private theorem eqb {a : Nat} (h : a < 256) (k : UInt8) : (UInt8.ofNat a == k) = decide (a = k.toNat) := by
  rw [Bool.eq_iff_iff, beq_iff_eq, decide_eq_true_iff, ← UInt8.toNat_inj, t a h]

theorem utf8_two {a b : Nat} (r : Bytes) (ha : 194 ≤ a ∧ a ≤ 223) (hb : 128 ≤ b ∧ b ≤ 191) :
    utf8 (UInt8.ofNat a :: UInt8.ofNat b :: r) = utf8 r := by
  rw [utf8.eq_def]
  simp only [cont, UInt8.lt_iff_toNat_lt, UInt8.le_iff_toNat_le, t a (by omega), t b (by omega), UInt8.reduceToNat]
  simp [show ¬ a < 128 by omega, show 194 ≤ a by omega, show a ≤ 223 by omega, show 128 ≤ b by omega,
    show b ≤ 191 by omega]

theorem utf8_three {a b c : Nat} (r : Bytes) (ha : 224 ≤ a ∧ a ≤ 239) (hb : 128 ≤ b ∧ b ≤ 191)
    (hc : 128 ≤ c ∧ c ≤ 191) (h0 : a = 224 → 160 ≤ b) (hd : a = 237 → b ≤ 159) :
    utf8 (UInt8.ofNat a :: UInt8.ofNat b :: UInt8.ofNat c :: r) = utf8 r := by
  rw [utf8.eq_def]
  simp only [cont, UInt8.lt_iff_toNat_lt, UInt8.le_iff_toNat_le, t a (by omega), t b (by omega), t c (by omega),
    UInt8.reduceToNat, eqb (show a < 256 by omega)]
  by_cases e0 : a = 224
  · subst e0; simp; omega
  · by_cases ed : a = 237
    · subst ed; simp; omega
    · simp [e0, ed, show ¬ a < 128 by omega, show ¬ a ≤ 223 by omega, show 224 ≤ a by omega, show a ≤ 239 by omega]
      omega

theorem utf8_four {a b c d : Nat} (r : Bytes) (ha : 240 ≤ a ∧ a ≤ 244) (hb : 128 ≤ b ∧ b ≤ 191)
    (hc : 128 ≤ c ∧ c ≤ 191) (hd : 128 ≤ d ∧ d ≤ 191) (h0 : a = 240 → 144 ≤ b) (h4 : a = 244 → b ≤ 143) :
    utf8 (UInt8.ofNat a :: UInt8.ofNat b :: UInt8.ofNat c :: UInt8.ofNat d :: r) = utf8 r := by
  rw [utf8.eq_def]
  simp only [cont, UInt8.lt_iff_toNat_lt, UInt8.le_iff_toNat_le, t a (by omega), t b (by omega), t c (by omega),
    t d (by omega), UInt8.reduceToNat, eqb (show a < 256 by omega)]
  by_cases e0 : a = 240
  · subst e0; simp; omega
  · by_cases e4 : a = 244
    · subst e4; simp; omega
    · simp [e0, e4, show ¬ a < 128 by omega, show ¬ a ≤ 223 by omega, show ¬ a ≤ 239 by omega, show 240 ≤ a by omega,
        show a ≤ 244 by omega]
      omega

theorem utf8_encodeChar (ch : Char) (r : Bytes) : utf8 (String.utf8EncodeChar ch ++ r) = utf8 r := by
  have hv := ch.valid
  simp only [Nat.isValidChar, UInt32.isValidChar] at hv
  unfold String.utf8EncodeChar
  simp only
  generalize ch.val.toNat = v at hv ⊢
  split
  · have lt : UInt8.ofNat v < 128 := by rw [UInt8.lt_iff_toNat_lt, t v (by omega)]; simp; omega
    rw [List.singleton_append, utf8.eq_def]
    simp [lt]
  · split
    · simp only [List.cons_append, List.nil_append]
      exact utf8_two r ⟨by omega, by omega⟩ ⟨by omega, by omega⟩
    · split
      · simp only [List.cons_append, List.nil_append]
        exact utf8_three r ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ (by omega) (by omega)
      · simp only [List.cons_append, List.nil_append]
        exact utf8_four r ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩ ⟨by omega, by omega⟩
          (by omega) (by omega)

theorem utf8_flatMap : ∀ (cs : List Char), utf8 (cs.flatMap String.utf8EncodeChar) = true
  | [] => by simp [utf8]
  | ch :: cs => by rw [List.flatMap_cons, utf8_encodeChar]; exact utf8_flatMap cs

/-- **Lean's strings are Core's text:** every `String`'s UTF-8 is valid as RFC 3629 says. -/
theorem utf8_text (s : String) : utf8 (text s) = true := by
  obtain ⟨m, hm⟩ := s.isValidUTF8
  simp only [text, String.toUTF8_eq_toByteArray, hm, List.utf8Encode, List.toList_data_toByteArray]
  exact utf8_flatMap m

theorem fromUTF8_text (s : String) : String.fromUTF8? ⟨(text s).toArray⟩ = some s := by
  simp only [text, Array.toArray_toList, String.toUTF8_eq_toByteArray]
  unfold String.fromUTF8?
  split
  · rfl
  · next h => exact absurd s.isValidUTF8 h

theorem text_inj {a b : String} : text a = text b ↔ a = b := by
  constructor
  · intro h
    have := fromUTF8_text a
    rw [h, fromUTF8_text b] at this
    exact (Option.some.inj this).symm
  · rintro rfl; rfl

end Aven.Core
