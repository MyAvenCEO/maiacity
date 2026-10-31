import Aven.Core.Cbor

/-!
# The codec's laws (rule 1)

- `decode_encode`: an allowed Value's encoding decodes to it, whatever follows.
- `encode_decode`: whatever the decoder accepts is allowed, and is exactly the encoding of what it decoded.
- `decodeAll_encode`, `encode_decodeAll`: the same for a whole byte string, where an allowed Value nests at most
  `maxDepth` (512) deep; `decodeAll_deep`: nothing deeper is read.
- `encode_inj`: two allowed Values with one encoding are one Value (`encode_inj_shape`: at any depth).
-/

namespace Aven.Core

/-! ## Heads -/

theorem take_be_append (k n : Nat) (r : Bytes) : (be k n ++ r).take k = be k n := by
  have h := List.take_left (l₁ := be k n) (l₂ := r)
  rwa [be_length] at h

theorem drop_be_append (k n : Nat) (r : Bytes) : (be k n ++ r).drop k = r := by
  have h := List.drop_left (l₁ := be k n) (l₂ := r)
  rwa [be_length] at h

theorem readArg_be (m k lo n : Nat) (r : Bytes) (hlo : lo ≤ n) (hn : n < 256 ^ k) :
    readArg m k lo (be k n ++ r) = some (m, n, r) := by
  have hb : beNat (be k n) = n := by rw [beNat_be, Nat.mod_eq_of_lt hn]
  simp [readArg, hb, hlo, be_length]

theorem readHead_head (m n : Nat) (r : Bytes) (hm : m < 8) (hn : n < limit) :
    readHead (head m n ++ r) = some (m, n, r) := by
  unfold head
  by_cases h0 : n < 24
  · simp only [h0, ite_true, List.singleton_append, readHead, UInt8.toNat_ofNat']
    have e1 : (m * 32 + n) % 2 ^ 8 / 32 = m := by omega
    have e2 : (m * 32 + n) % 2 ^ 8 % 32 = n := by omega
    simp [e1, e2, h0]
  by_cases h1 : n < 256
  · simp only [h0, h1, ite_true, ite_false, List.cons_append, readHead, UInt8.toNat_ofNat']
    have e1 : (m * 32 + 24) % 2 ^ 8 / 32 = m := by omega
    have e2 : (m * 32 + 24) % 2 ^ 8 % 32 = 24 := by omega
    simp only [e1, e2]
    exact readArg_be m 1 24 n r (by omega) (by omega)
  by_cases h2 : n < 65536
  · simp only [h0, h1, h2, ite_true, ite_false, List.cons_append, readHead, UInt8.toNat_ofNat']
    have e1 : (m * 32 + 25) % 2 ^ 8 / 32 = m := by omega
    have e2 : (m * 32 + 25) % 2 ^ 8 % 32 = 25 := by omega
    simp only [e1, e2]
    exact readArg_be m 2 256 n r (by omega) (by omega)
  by_cases h3 : n < 4294967296
  · simp only [h0, h1, h2, h3, ite_true, ite_false, List.cons_append, readHead, UInt8.toNat_ofNat']
    have e1 : (m * 32 + 26) % 2 ^ 8 / 32 = m := by omega
    have e2 : (m * 32 + 26) % 2 ^ 8 % 32 = 26 := by omega
    simp only [e1, e2]
    exact readArg_be m 4 65536 n r (by omega) (by omega)
  · simp only [h0, h1, h2, h3, ite_false, List.cons_append, readHead, UInt8.toNat_ofNat']
    have e1 : (m * 32 + 27) % 2 ^ 8 / 32 = m := by omega
    have e2 : (m * 32 + 27) % 2 ^ 8 % 32 = 27 := by omega
    have hn' : n < 256 ^ 8 := by simp only [limit, Nat.reducePow] at hn ⊢; omega
    have := readArg_be m 8 4294967296 n r (by omega) hn'
    simp only [e1, e2, Nat.reduceLT, Nat.reduceEqDiff, ite_true, ite_false]
    exact this

theorem readArg_spec {m k lo major n : Nat} {r rest : Bytes}
    (h : readArg m k lo r = some (major, n, rest)) :
    major = m ∧ lo ≤ n ∧ n < 256 ^ k ∧ be k n ++ rest = r := by
  unfold readArg at h
  split at h
  · rename_i hc
    simp only [Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨h1, h2, h3⟩ := h
    subst h1 h2 h3
    have hl : (r.take k).length = k := by simp [List.length_take]; omega
    refine ⟨rfl, hc.2, ?_, ?_⟩
    · have := beNat_lt (r.take k); rwa [hl] at this
    · have := be_beNat (r.take k); rw [hl] at this; rw [this, List.take_append_drop]
  · simp at h

theorem head_readHead {bs : Bytes} {m n : Nat} {r : Bytes} (h : readHead bs = some (m, n, r)) :
    m < 8 ∧ n < limit ∧ head m n ++ r = bs := by
  match bs, h with
  | b :: rest, h =>
    have hb := b.toNat_lt
    have hbv : UInt8.ofNat b.toNat = b := UInt8.ofNat_toNat
    simp only [readHead] at h
    by_cases h0 : b.toNat % 32 < 24
    · simp only [h0, ite_true, Option.some.injEq, Prod.mk.injEq] at h
      obtain ⟨h1, h2, h3⟩ := h
      subst h1 h2 h3
      refine ⟨by omega, by simp [limit]; omega, ?_⟩
      have e : b.toNat / 32 * 32 + b.toNat % 32 = b.toNat := by omega
      simp [head, h0, e, hbv]
    · simp only [h0, ite_false] at h
      by_cases h1 : b.toNat % 32 = 24
      · simp only [h1, ite_true] at h
        obtain ⟨hm, hlo, hhi, he⟩ := readArg_spec h
        subst hm
        refine ⟨by omega, by simp [limit]; omega, ?_⟩
        have e : b.toNat / 32 * 32 + 24 = b.toNat := by omega
        have c0 : ¬ n < 24 := by omega
        have c1 : n < 256 := by simpa using hhi
        simp [head, c0, c1, e, hbv, he]
      · simp only [h1, ite_false] at h
        by_cases h2 : b.toNat % 32 = 25
        · simp only [h2, ite_true] at h
          obtain ⟨hm, hlo, hhi, he⟩ := readArg_spec h
          subst hm
          refine ⟨by omega, by simp [limit]; omega, ?_⟩
          have e : b.toNat / 32 * 32 + 25 = b.toNat := by omega
          have c0 : ¬ n < 24 := by omega
          have c1 : ¬ n < 256 := by omega
          have c2 : n < 65536 := by simpa using hhi
          simp [head, c0, c1, c2, e, hbv, he]
        · simp only [h2, ite_false] at h
          by_cases h3 : b.toNat % 32 = 26
          · simp only [h3, ite_true] at h
            obtain ⟨hm, hlo, hhi, he⟩ := readArg_spec h
            subst hm
            refine ⟨by omega, by simp [limit]; omega, ?_⟩
            have e : b.toNat / 32 * 32 + 26 = b.toNat := by omega
            have c0 : ¬ n < 24 := by omega
            have c1 : ¬ n < 256 := by omega
            have c2 : ¬ n < 65536 := by omega
            have c3 : n < 4294967296 := by simpa using hhi
            simp [head, c0, c1, c2, c3, e, hbv, he]
          · simp only [h3, ite_false] at h
            by_cases h4 : b.toNat % 32 = 27
            · simp only [h4, ite_true] at h
              obtain ⟨hm, hlo, hhi, he⟩ := readArg_spec h
              subst hm
              refine ⟨by omega, by simpa [limit] using hhi, ?_⟩
              have e : b.toNat / 32 * 32 + 27 = b.toNat := by omega
              have c0 : ¬ n < 24 := by omega
              have c1 : ¬ n < 256 := by omega
              have c2 : ¬ n < 65536 := by omega
              have c3 : ¬ n < 4294967296 := by omega
              simp [head, c0, c1, c2, c3, e, hbv, he]
            · simp [h4] at h

/-! ## Values -/

theorem one_le_depth (v : Value) : 1 ≤ depth v := by
  cases v <;> simp [depth]

theorem decode_text (fuel : Nat) (k rest : Bytes) (h : textOk k = true) :
    decode (fuel + 1) (keyBytes k ++ rest) = some (.text k, rest) := by
  simp only [textOk, Bool.and_eq_true, decide_eq_true_eq] at h
  have hh := readHead_head 3 k.length (k ++ rest) (by omega) h.1
  simp [keyBytes, decode, List.append_assoc, hh, h.2]

mutual
theorem decode_encode : ∀ (v : Value) (fuel : Nat) (rest : Bytes), Shape v = true → depth v ≤ fuel →
    decode fuel (encode v ++ rest) = some (v, rest)
  | .uint n, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp only [Shape, decide_eq_true_eq] at h
    simp [encode, decode, readHead_head 0 n rest (by omega) h]
  | .nint n, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp only [Shape, decide_eq_true_eq] at h
    simp [encode, decode, readHead_head 1 n rest (by omega) h]
  | .bytes b, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp only [Shape, decide_eq_true_eq] at h
    simp [encode, decode, List.append_assoc, readHead_head 2 b.length (b ++ rest) (by omega) h]
  | .text b, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    exact decode_text f b rest h
  | .array xs, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp only [Shape, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [depth] at hd
    have hl := decodeList_encodeList xs f rest h.2 (by omega)
    simp [encode, decode, List.append_assoc, readHead_head 4 xs.length (encodeList xs ++ rest) (by omega) h.1, hl]
  | .map kvs, fuel, rest, h, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp only [Shape, Bool.and_eq_true, decide_eq_true_eq] at h
    simp only [depth] at hd
    have hm := decodeMap_encodeMap kvs f rest h.2 (by omega)
    simp [encode, decode, List.append_assoc, readHead_head 5 kvs.length (encodeMap kvs ++ rest) (by omega) h.1.1,
      hm, h.1.2]
  | .bool false, fuel, rest, _, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp [encode, decode, readHead]
  | .bool true, fuel, rest, _, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp [encode, decode, readHead]
  | .null, fuel, rest, _, hd => by
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by simp [depth] at hd; omega⟩
    simp [encode, decode, readHead]

theorem decodeList_encodeList : ∀ (xs : List Value) (fuel : Nat) (rest : Bytes), ShapeList xs = true →
    depthList xs ≤ fuel → decodeList fuel xs.length (encodeList xs ++ rest) = some (xs, rest)
  | [], _, rest, _, _ => by simp [encodeList, decodeList]
  | v :: vs, fuel, rest, h, hd => by
    simp only [ShapeList, Bool.and_eq_true] at h
    simp only [depthList] at hd
    have h1 := decode_encode v fuel (encodeList vs ++ rest) h.1 (by omega)
    have h2 := decodeList_encodeList vs fuel rest h.2 (by omega)
    simp [encodeList, decodeList, List.append_assoc, h1, h2]

theorem decodeMap_encodeMap : ∀ (kvs : List (Bytes × Value)) (fuel : Nat) (rest : Bytes), ShapeMap kvs = true →
    depthMap kvs ≤ fuel → decodeMap fuel kvs.length (encodeMap kvs ++ rest) = some (kvs, rest)
  | [], _, rest, _, _ => by simp [encodeMap, decodeMap]
  | (k, v) :: kvs, fuel, rest, h, hd => by
    simp only [ShapeMap, Bool.and_eq_true] at h
    simp only [depthMap] at hd
    obtain ⟨f, rfl⟩ : ∃ f, fuel = f + 1 := ⟨fuel - 1, by have := one_le_depth v; omega⟩
    have h0 := decode_text f k (encode v ++ encodeMap kvs ++ rest) h.1.1
    have h1 := decode_encode v (f + 1) (encodeMap kvs ++ rest) h.1.2 (by omega)
    have h2 := decodeMap_encodeMap kvs (f + 1) rest h.2 (by omega)
    simp only [encodeMap, decodeMap, List.length_cons, List.append_assoc] at h0 h1 h2 ⊢
    simp [h0, h1, h2]
end

theorem take_drop_ok {n : Nat} {r : Bytes} (h : n ≤ r.length) : (r.take n).length = n := by
  simp [List.length_take]; omega

mutual
theorem encode_decode : ∀ (fuel : Nat) (bs : Bytes) (v : Value) (rest : Bytes),
    decode fuel bs = some (v, rest) → Shape v = true ∧ depth v ≤ fuel ∧ encode v ++ rest = bs
  | 0, _, _, _, h => by simp [decode] at h
  | fuel + 1, bs, v, rest, h => by
    unfold decode at h
    split at h
    · simp at h
    · rename_i major n r hr
      obtain ⟨hm, hn, he⟩ := head_readHead hr
      by_cases m0 : major = 0
      · subst m0; simp only [ite_true, Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        exact ⟨by simpa [Shape] using hn, by simp [depth], by simpa [encode] using he⟩
      by_cases m1 : major = 1
      · subst m1; simp only [m0, ite_true, ite_false, Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        exact ⟨by simpa [Shape] using hn, by simp [depth], by simpa [encode] using he⟩
      by_cases m2 : major = 2
      · subst m2; simp only [m0, m1, ite_true, ite_false] at h
        split at h
        · rename_i hl
          simp only [Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          have hl' := take_drop_ok hl
          refine ⟨by simp [Shape, hl']; omega, by simp [depth], ?_⟩
          simp [encode, hl', ← he, List.take_append_drop]
        · simp at h
      by_cases m3 : major = 3
      · subst m3; simp only [m0, m1, m2, ite_true, ite_false] at h
        split at h
        · rename_i hl
          simp only [Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          have hl' := take_drop_ok hl.1
          refine ⟨by simp [Shape, textOk, hl', hl.2]; omega, by simp [depth], ?_⟩
          simp [encode, hl', ← he, List.take_append_drop]
        · simp at h
      by_cases m4 : major = 4
      · subst m4; simp only [m0, m1, m2, m3, ite_true, ite_false] at h
        split at h
        · rename_i xs r' hd
          simp only [Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          obtain ⟨hc, hdl, hlen, hel⟩ := encodeList_decodeList fuel n r xs r' hd
          refine ⟨by simp [Shape, hc, hlen]; omega, by simp [depth]; omega, ?_⟩
          simp [encode, hlen, List.append_assoc, hel, he]
        · simp at h
      by_cases m5 : major = 5
      · subst m5; simp only [m0, m1, m2, m3, m4, ite_true, ite_false] at h
        split at h
        · rename_i kvs r' hd
          split at h
          · rename_i hs
            simp only [Option.some.injEq, Prod.mk.injEq] at h
            obtain ⟨rfl, rfl⟩ := h
            obtain ⟨hc, hdm, hlen, hem⟩ := encodeMap_decodeMap fuel n r kvs r' hd
            refine ⟨by simp [Shape, hc, hlen, hs]; omega, by simp [depth]; omega, ?_⟩
            simp [encode, hlen, List.append_assoc, hem, he]
          · simp at h
        · simp at h
      by_cases m7 : major = 7
      · subst m7; simp only [m0, m1, m2, m3, m4, m5, ite_true, ite_false] at h
        by_cases n20 : n = 20
        · subst n20; simp only [ite_true, Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          exact ⟨rfl, by simp [depth], by simpa [encode, head] using he⟩
        by_cases n21 : n = 21
        · subst n21; simp only [n20, ite_true, ite_false, Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          exact ⟨rfl, by simp [depth], by simpa [encode, head] using he⟩
        by_cases n22 : n = 22
        · subst n22; simp only [n20, n21, ite_true, ite_false, Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          exact ⟨rfl, by simp [depth], by simpa [encode, head] using he⟩
        simp [n20, n21, n22] at h
      simp [m0, m1, m2, m3, m4, m5, m7] at h
  termination_by fuel _ _ _ _ => (fuel, 0)

theorem encodeList_decodeList : ∀ (fuel n : Nat) (bs : Bytes) (xs : List Value) (rest : Bytes),
    decodeList fuel n bs = some (xs, rest) → ShapeList xs = true ∧ depthList xs ≤ fuel ∧ xs.length = n ∧ encodeList xs ++ rest = bs
  | _, 0, bs, xs, rest, h => by
    simp only [decodeList, Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    simp [ShapeList, depthList, encodeList]
  | fuel, n + 1, bs, xs, rest, h => by
    unfold decodeList at h
    split at h
    · rename_i v r hv
      split at h
      · rename_i vs r' hvs
        simp only [Option.some.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        obtain ⟨c1, d1, e1⟩ := encode_decode fuel bs v r hv
        obtain ⟨c2, d2, l2, e2⟩ := encodeList_decodeList fuel n r vs r' hvs
        refine ⟨by simp [ShapeList, c1, c2], by simp [depthList]; omega, by simp [l2], ?_⟩
        simp [encodeList, List.append_assoc, e2, e1]
      · simp at h
    · simp at h
  termination_by fuel n _ _ _ => (fuel, n + 1)

theorem encodeMap_decodeMap : ∀ (fuel n : Nat) (bs : Bytes) (kvs : List (Bytes × Value)) (rest : Bytes),
    decodeMap fuel n bs = some (kvs, rest) → ShapeMap kvs = true ∧ depthMap kvs ≤ fuel ∧ kvs.length = n ∧ encodeMap kvs ++ rest = bs
  | _, 0, bs, kvs, rest, h => by
    simp only [decodeMap, Option.some.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    simp [ShapeMap, depthMap, encodeMap]
  | fuel, n + 1, bs, kvs, rest, h => by
    unfold decodeMap at h
    split at h
    · rename_i k r hk
      split at h
      · rename_i v r' hv
        split at h
        · rename_i kvs' r'' hkvs
          simp only [Option.some.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          obtain ⟨c0, _, e0⟩ := encode_decode fuel bs (.text k) r hk
          obtain ⟨c1, d1, e1⟩ := encode_decode fuel r v r' hv
          obtain ⟨c2, d2, l2, e2⟩ := encodeMap_decodeMap fuel n r' kvs' r'' hkvs
          simp only [Shape] at c0
          refine ⟨by simp [ShapeMap, c0, c1, c2], by simp [depthMap]; omega, by simp [l2], ?_⟩
          simp only [encode] at e0
          simp only [encodeMap, keyBytes, List.append_assoc, e2, e1]
          simpa [List.append_assoc] using e0
        · simp at h
      · simp at h
    · simp at h
  termination_by fuel n _ _ _ => (fuel, n + 1)
end

theorem head_length_pos (m n : Nat) : 1 ≤ (head m n).length := by
  unfold head; split <;> (try split) <;> (try split) <;> (try split) <;> simp

mutual
theorem depth_le : ∀ (v : Value), depth v ≤ (encode v).length
  | .uint n => by have := head_length_pos 0 n; simp [depth, encode]; omega
  | .nint n => by have := head_length_pos 1 n; simp [depth, encode]; omega
  | .bytes b => by have := head_length_pos 2 b.length; simp [depth, encode]; omega
  | .text b => by have := head_length_pos 3 b.length; simp [depth, encode]; omega
  | .array xs => by
    have := head_length_pos 4 xs.length; have := depthList_le xs; simp [depth, encode]; omega
  | .map kvs => by
    have := head_length_pos 5 kvs.length; have := depthMap_le kvs; simp [depth, encode]; omega
  | .bool false => by simp [depth, encode]
  | .bool true => by simp [depth, encode]
  | .null => by simp [depth, encode]

theorem depthList_le : ∀ (xs : List Value), depthList xs ≤ (encodeList xs).length
  | [] => by simp [depthList]
  | v :: vs => by have := depth_le v; have := depthList_le vs; simp [depthList, encodeList]; omega

theorem depthMap_le : ∀ (kvs : List (Bytes × Value)), depthMap kvs ≤ (encodeMap kvs).length
  | [] => by simp [depthMap]
  | (_, v) :: kvs => by have := depth_le v; have := depthMap_le kvs; simp [depthMap, encodeMap]; omega
end

theorem Canon.shape {v : Value} (h : Canon v = true) : Shape v = true := by
  simp only [Canon, Bool.and_eq_true] at h; exact h.1

/-- An allowed Value's encoding decodes to it, alone. -/
theorem decodeAll_encode (v : Value) (h : Canon v = true) : decodeAll (encode v) = some v := by
  simp only [Canon, Bool.and_eq_true, decide_eq_true_eq] at h
  have := decode_encode v maxDepth [] h.1 h.2
  simp only [List.append_nil] at this
  simp [decodeAll, this]

/-- Whatever a whole byte string decodes to is allowed, and encodes back to exactly those bytes (rule 1). -/
theorem encode_decodeAll {bs : Bytes} {v : Value} (h : decodeAll bs = some v) : Canon v = true ∧ encode v = bs := by
  unfold decodeAll at h
  split at h
  · rename_i v' hv
    simp only [Option.some.injEq] at h
    subst h
    obtain ⟨c, d, e⟩ := encode_decode _ bs v' [] hv
    exact ⟨by simp [Canon, c, d], by simpa using e⟩
  · simp at h

/-- A Value too deep is refused, however it is written. -/
theorem decodeAll_deep {bs : Bytes} {v : Value} (h : decodeAll bs = some v) : depth v ≤ maxDepth := by
  have := (encode_decodeAll h).1
  simp only [Canon, Bool.and_eq_true, decide_eq_true_eq] at this
  exact this.2

/-- Two Values in the profile's forms with one encoding are one Value, at any depth. -/
theorem encode_inj_shape {a b : Value} (ha : Shape a = true) (hb : Shape b = true) (h : encode a = encode b) :
    a = b := by
  have h1 := decode_encode a (depth a + depth b) [] ha (by omega)
  have h2 := decode_encode b (depth a + depth b) [] hb (by omega)
  rw [h] at h1
  rw [h1] at h2
  simpa using h2

/-- Two allowed Values with one encoding are one Value. -/
theorem encode_inj {a b : Value} (ha : Canon a = true) (hb : Canon b = true) (h : encode a = encode b) : a = b :=
  encode_inj_shape (Canon.shape ha) (Canon.shape hb) h

end Aven.Core
