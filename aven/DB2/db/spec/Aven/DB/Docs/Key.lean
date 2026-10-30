import Aven.DB.Docs.Index

/-!
# Index keys: an order-preserving encoding

An index entry is a tuple of fields, then the Doc it names. Its bytes are not CBOR: canonical CBOR sorts text by
length first and negative integers after positive ones, so bytewise order over CBOR isn't the fields' order. An entry
is a **key**, a sort key stored as a byte string inside the canonical-CBOR nodes; it is never named or signed, so rule 1
is untouched (the architect and the engine, 30 Oct 2026, FoundationDB's tuple layer as the pattern).

Each field is a type tag, then:
- an unsigned integer: its 8 bytes, big-endian;
- a negative integer `-1 - n`: the 8 bytes of `2⁶⁴ - 1 - n`, under a smaller tag, so negatives sort first;
- text: its UTF-8 (NFC, normalised before it gets here), with each `00` written `00 FF`, and a `00` to end it;
- bytes, the Doc id among them: the same escaping.

Text compares by code point, which is UTF-8's byte order; collation by locale comes later through a pinned sort-key
runtime.

What it proves: `key_order`: comparing two keys bytewise is comparing their tuples, field by field, a shorter tuple
first when it is the other's prefix; `key_inj`: two tuples with one key are one tuple.
-/

namespace Aven.DB.Docs.Key

open Aven.Core

inductive Field where
  | bytes (b : Bytes)
  | text (b : Bytes)
  | nint (n : Nat)
  | uint (n : Nat)
  deriving DecidableEq, Repr

def Field.tag : Field → UInt8
  | .bytes _ => 0x01
  | .text _ => 0x02
  | .nint _ => 0x13
  | .uint _ => 0x15

/-- A field's numbers fit in 8 bytes. -/
def Field.ok : Field → Bool
  | .nint n => n < 2 ^ 64
  | .uint n => n < 2 ^ 64
  | _ => true

/-- The fields' order: by kind (bytes, text, negative, unsigned), then by value. -/
def Field.lt : Field → Field → Bool
  | .bytes a, .bytes b => lexLt a b
  | .text a, .text b => lexLt a b
  | .nint a, .nint b => b < a
  | .uint a, .uint b => a < b
  | x, y => x.tag < y.tag

/-- `00` becomes `00 FF`, and a `00` ends it. -/
def escape : Bytes → Bytes
  | [] => [0]
  | x :: xs => if x = 0 then 0 :: 0xFF :: escape xs else x :: escape xs

def Field.bytesOf : Field → Bytes
  | .bytes b => 0x01 :: escape b
  | .text b => 0x02 :: escape b
  | .nint n => 0x13 :: be 8 (2 ^ 64 - 1 - n)
  | .uint n => 0x15 :: be 8 n

/-- A tuple's key. -/
def keyBytes (t : List Field) : Bytes := (t.map Field.bytesOf).flatten

/-- An index entry: the fields, then the Doc they come from. -/
def entry (fields : List Field) (doc : DocId) : Bytes := keyBytes (fields ++ [.bytes doc.hash.bytes])

/-- Tuples' order: field by field, a prefix first. -/
def tupleLt : List Field → List Field → Bool
  | [], [] => false
  | [], _ :: _ => true
  | _ :: _, [] => false
  | x :: xs, y :: ys => if x = y then tupleLt xs ys else x.lt y

/-! ## Byte facts -/

theorem lexLt_cons_same (x : UInt8) (r s : Bytes) : lexLt (x :: r) (x :: s) = lexLt r s := by
  simp [lexLt, UInt8.lt_irrefl]

theorem lexLt_append_same : ∀ (p r s : Bytes), lexLt (p ++ r) (p ++ s) = lexLt r s
  | [], _, _ => rfl
  | x :: p, r, s => by simp only [List.cons_append, lexLt_cons_same, lexLt_append_same p r s]

theorem lexLt_cons_ne {x y : UInt8} (h : x ≠ y) (r s : Bytes) : lexLt (x :: r) (y :: s) = decide (x < y) := by
  simp [lexLt, h]

/-- Two lists of one length, each followed by anything: the lists decide, unless they are equal. -/
theorem lexLt_same_length : ∀ (a b r s : Bytes), a.length = b.length →
    lexLt (a ++ r) (b ++ s) = if a = b then lexLt r s else lexLt a b
  | [], [], _, _, _ => by simp
  | x :: a, y :: b, r, s, h => by
    simp only [List.length_cons, Nat.add_right_cancel_iff] at h
    by_cases hxy : x = y
    · subst hxy
      simp only [List.cons_append, lexLt_cons_same, lexLt_same_length a b r s h, List.cons.injEq, true_and]
    · simp only [List.cons_append, lexLt_cons_ne hxy, List.cons.injEq, hxy, false_and, ite_false]

theorem be_succ (k n : Nat) : be (k + 1) n = be k (n / 256) ++ [UInt8.ofNat (n % 256)] := by
  simp [be, le]

theorem be_inj {k a b : Nat} (ha : a < 256 ^ k) (hb : b < 256 ^ k) (h : be k a = be k b) : a = b := by
  have := congrArg beNat h
  rwa [beNat_be, beNat_be, Nat.mod_eq_of_lt ha, Nat.mod_eq_of_lt hb] at this

/-- Big-endian bytes of one length sort as their numbers. -/
theorem lexLt_be : ∀ (k a b : Nat), a < 256 ^ k → b < 256 ^ k → lexLt (be k a) (be k b) = decide (a < b)
  | 0, a, b, ha, hb => by simp at ha hb; subst ha hb; rfl
  | k + 1, a, b, ha, hb => by
    have ha' : a / 256 < 256 ^ k := by rw [Nat.pow_succ] at ha; omega
    have hb' : b / 256 < 256 ^ k := by rw [Nat.pow_succ] at hb; omega
    rw [be_succ, be_succ, lexLt_same_length _ _ _ _ (by simp [be_length])]
    by_cases he : be k (a / 256) = be k (b / 256)
    · have hq := be_inj ha' hb' he
      simp only [he, ite_true]
      by_cases hr : a % 256 = b % 256
      · have : a = b := by omega
        subst this; simp [lexLt_irrefl]
      · have hne : UInt8.ofNat (a % 256) ≠ UInt8.ofNat (b % 256) := by
          intro e; apply hr
          have := congrArg UInt8.toNat e
          simpa [UInt8.toNat_ofNat', Nat.mod_mod_of_dvd] using this
        rw [lexLt_cons_ne hne]
        simp only [UInt8.lt_iff_toNat_lt, UInt8.toNat_ofNat', decide_eq_decide]
        omega
    · have hq : a / 256 ≠ b / 256 := fun e => he (by rw [e])
      simp only [he, ite_false, lexLt_be k (a / 256) (b / 256) ha' hb', decide_eq_decide]
      omega

/-! ## Escaped strings -/

/-- What may follow a field: nothing, or another field's tag, which is never `FF`. -/
def Rest (r : Bytes) : Prop := ∀ x ∈ r.head?, x < 0xFF

theorem escape_order : ∀ (a b r s : Bytes), Rest r → Rest s → a ≠ b →
    lexLt (escape a ++ r) (escape b ++ s) = lexLt a b
  | [], [], _, _, _, _, h => absurd rfl h
  | [], y :: ys, r, s, _, _, _ => by
    by_cases hy : y = 0
    · subst hy
      simp only [escape, ite_true, List.cons_append, lexLt_cons_same]
      cases r with
      | nil => rfl
      | cons z r =>
        have : z < 0xFF := ‹Rest (z :: r)› z rfl
        unfold lexLt
        simp [this]
    · simp only [escape, hy, ite_false, List.cons_append]
      have : (0 : UInt8) ≠ y := fun e => hy e.symm
      rw [lexLt_cons_ne this]
      simp [lexLt, UInt8.lt_iff_toNat_lt]
      have : y.toNat ≠ 0 := fun e => hy (UInt8.toNat_inj.mp (by simpa using e))
      omega
  | x :: xs, [], r, s, _, hs, _ => by
    by_cases hx : x = 0
    · subst hx
      simp only [escape, ite_true, List.cons_append, lexLt_cons_same]
      cases s with
      | nil => rfl
      | cons z s =>
        have : z < 0xFF := hs z rfl
        have h1 : ¬ ((0xFF : UInt8) < z) := by
          rw [UInt8.lt_iff_toNat_lt] at this ⊢; simp at this ⊢; omega
        have h2 : ((0xFF : UInt8) == z) = false := by
          simp only [beq_eq_false_iff_ne]; intro e; subst e; simp at this
        unfold lexLt
        simp [h1, h2]
    · simp only [escape, hx, ite_false, List.cons_append]
      rw [lexLt_cons_ne hx]
      simp [lexLt, UInt8.lt_iff_toNat_lt]
  | x :: xs, y :: ys, r, s, hr, hs, h => by
    by_cases hxy : x = y
    · subst hxy
      have hne : xs ≠ ys := fun e => h (by rw [e])
      have ih := escape_order xs ys r s hr hs hne
      by_cases hx : x = 0
      · subst hx
        simp only [escape, ite_true, List.cons_append, lexLt_cons_same]
        rw [ih]
      · simp only [escape, hx, ite_false, List.cons_append, lexLt_cons_same]
        rw [ih]
    · have first : ∀ (z : UInt8) (zs : Bytes), ∃ t, escape (z :: zs) = z :: t := by
        intro z zs
        by_cases hz : z = 0
        · subst hz; exact ⟨0xFF :: escape zs, by simp [escape]⟩
        · exact ⟨escape zs, by simp [escape, hz]⟩
      obtain ⟨t, ht⟩ := first x xs
      obtain ⟨u, hu⟩ := first y ys
      rw [ht, hu, List.cons_append, List.cons_append, lexLt_cons_ne hxy]
      simp [lexLt, hxy]

/-! ## Fields and tuples -/

theorem bytesOf_rest (f : Field) (r : Bytes) : Rest (f.bytesOf ++ r) := by
  intro x hx
  cases f <;> simp [Field.bytesOf] at hx <;> subst hx <;> decide

theorem keyBytes_rest : ∀ (t : List Field), Rest (keyBytes t)
  | [] => by intro x hx; simp [keyBytes] at hx
  | f :: t => by simpa [keyBytes] using bytesOf_rest f (keyBytes t)

/-- One field, each followed by anything that may follow a field: the fields decide, unless they are equal. -/
theorem field_order (x y : Field) (hx : x.ok = true) (hy : y.ok = true) (r s : Bytes) (hr : Rest r) (hs : Rest s) :
    lexLt (x.bytesOf ++ r) (y.bytesOf ++ s) = if x = y then lexLt r s else x.lt y := by
  by_cases hxy : x = y
  · subst hxy; simp [lexLt_append_same]
  simp only [hxy, ite_false]
  cases x <;> cases y <;> simp only [Field.bytesOf, List.cons_append, Field.lt, Field.tag] at hxy ⊢ <;>
    simp only [Field.ok, decide_eq_true_eq] at hx hy
  all_goals first
    | (rw [lexLt_cons_ne (by decide)]; rfl)
    | skip
  · rw [lexLt_cons_same]; exact escape_order _ _ _ _ hr hs (fun e => hxy (by rw [e]))
  · rw [lexLt_cons_same]; exact escape_order _ _ _ _ hr hs (fun e => hxy (by rw [e]))
  · rename_i a b
    rw [lexLt_cons_same, lexLt_same_length _ _ _ _ (by simp [be_length])]
    have hne : be 8 (2 ^ 64 - 1 - a) ≠ be 8 (2 ^ 64 - 1 - b) := by
      intro e
      have := be_inj (k := 8) (by simp only [Nat.reducePow] at *; omega) (by simp only [Nat.reducePow] at *; omega) e
      apply hxy; congr 1; simp only [Nat.reducePow] at *; omega
    simp only [hne, ite_false]
    rw [lexLt_be 8 _ _ (by simp only [Nat.reducePow] at *; omega) (by simp only [Nat.reducePow] at *; omega)]
    simp only [decide_eq_decide]; simp only [Nat.reducePow] at *; omega
  · rename_i a b
    rw [lexLt_cons_same, lexLt_same_length _ _ _ _ (by simp [be_length])]
    have hne : be 8 a ≠ be 8 b := by
      intro e
      exact hxy (by rw [be_inj (k := 8) (by simpa using hx) (by simpa using hy) e])
    simp only [hne, ite_false]
    rw [lexLt_be 8 _ _ (by simpa using hx) (by simpa using hy)]

/-- Comparing two keys bytewise is comparing their tuples. -/
theorem key_order : ∀ (a b : List Field), a.all Field.ok = true → b.all Field.ok = true →
    lexLt (keyBytes a) (keyBytes b) = tupleLt a b
  | [], [], _, _ => rfl
  | [], y :: ys, _, _ => by
    simp only [keyBytes, List.map_nil, List.flatten_nil, List.map_cons, List.flatten_cons, tupleLt]
    cases y <;> simp [Field.bytesOf, lexLt]
  | x :: xs, [], _, _ => by
    simp only [keyBytes, List.map_nil, List.flatten_nil, List.map_cons, List.flatten_cons, tupleLt]
    cases x <;> simp [Field.bytesOf, lexLt]
  | x :: xs, y :: ys, ha, hb => by
    simp only [List.all_cons, Bool.and_eq_true] at ha hb
    have := field_order x y ha.1 hb.1 (keyBytes xs) (keyBytes ys) (keyBytes_rest xs) (keyBytes_rest ys)
    simp only [keyBytes, List.map_cons, List.flatten_cons] at this ⊢
    rw [this, tupleLt]
    split
    · exact key_order xs ys ha.2 hb.2
    · rfl

theorem field_lt_total {x y : Field} (h : x ≠ y) : x.lt y = true ∨ y.lt x = true := by
  match x, y with
  | .bytes a, .bytes b => exact Index.lexLt_total (fun e => h (by rw [e]))
  | .text a, .text b => exact Index.lexLt_total (fun e => h (by rw [e]))
  | .nint a, .nint b =>
    have : a ≠ b := fun e => h (by rw [e])
    simp only [Field.lt, decide_eq_true_eq]; omega
  | .uint a, .uint b =>
    have : a ≠ b := fun e => h (by rw [e])
    simp only [Field.lt, decide_eq_true_eq]; omega
  | .bytes _, .text _ | .bytes _, .nint _ | .bytes _, .uint _ | .text _, .bytes _ | .text _, .nint _
  | .text _, .uint _ | .nint _, .bytes _ | .nint _, .text _ | .nint _, .uint _ | .uint _, .bytes _
  | .uint _, .text _ | .uint _, .nint _ => simp [Field.lt, Field.tag]

theorem tuple_lt_total : ∀ {a b : List Field}, a ≠ b → tupleLt a b = true ∨ tupleLt b a = true
  | [], [], h => absurd rfl h
  | [], _ :: _, _ => .inl rfl
  | _ :: _, [], _ => .inr rfl
  | x :: xs, y :: ys, h => by
    simp only [tupleLt]
    by_cases hxy : x = y
    · subst hxy
      simp only [ite_true]
      exact tuple_lt_total (fun e => h (by rw [e]))
    · have hyx : y ≠ x := fun e => hxy e.symm
      simp only [hxy, hyx, ite_false]
      exact field_lt_total hxy

/-- Two tuples with one key are one tuple. -/
theorem key_inj {a b : List Field} (ha : a.all Field.ok = true) (hb : b.all Field.ok = true)
    (h : keyBytes a = keyBytes b) : a = b := by
  apply Classical.byContradiction
  intro hne
  have h1 := key_order a b ha hb
  have h2 := key_order b a hb ha
  rw [h, lexLt_irrefl] at h1
  rw [h, lexLt_irrefl] at h2
  rcases tuple_lt_total hne with e | e <;> simp_all

end Aven.DB.Docs.Key
