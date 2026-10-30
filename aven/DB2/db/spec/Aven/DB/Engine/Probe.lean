import Aven.DB.Engine.Index

/-!
# A probe as a byte range over the index's keys (A26)

The lookup walks the docs layer's tree for one byte range (`Aven.DB.Docs.Index.lookup`). This module turns a probe into
that range and proves the range holds exactly the entries the probe matches (`inRange_iff_keyMatch`), so the hits are
the tree's own lookup (`treeHits_eq_hits`), and the lookup's exactness (`Index.lookup_exact`) holds of it.

The bounds are keys themselves:
- the lower bound is the key of the probe's tuple: its equality values, then its lower range value;
- the upper bound is the key of its tuple with the upper range value, then `uint 0`. An entry ends with its Doc id, a
  byte string, and byte strings sort before integers, so every entry whose tuple equals the probe's sorts below it.

Then `key_order` turns the byte comparisons into tuple comparisons, and two facts of tuples finish it: a shared prefix
leaves the order to what follows (`tupleLt_append_same`), and a difference within equal-length prefixes decides it
(`tupleLt_append_ne`).

What a probe must have: values for every equality field, and a range exactly when the shape has a range field (an
open-ended range is the full one, from the least to the greatest key value). Every key value is keyable: bytes, text,
or an integer of 64 bits. -/

namespace Aven.DB.Engine

open Aven.Core Aven.DB.Docs Aven.DB.Docs.Key

/-- A Value an index key can hold: bytes, text, or an integer of 64 bits. -/
def keyable : Value → Bool
  | .bytes _ | .text _ => true
  | .nint n | .uint n => n < 2 ^ 64
  | _ => false

/-- A keyable Value as a key field. -/
def asField : Value → Field
  | .bytes b => .bytes b
  | .text b => .text b
  | .nint n => .nint n
  | .uint n => .uint n
  | _ => .bytes []

theorem toField_of_keyable : ∀ {v : Value}, keyable v = true → toField v = some (asField v)
  | .bytes _, _ | .text _, _ | .nint _, _ | .uint _, _ => rfl

theorem asField_ok : ∀ {v : Value}, keyable v = true → (asField v).ok = true
  | .bytes _, _ | .text _, _ => rfl
  | .nint _, h | .uint _, h => by simpa [keyable, asField, Field.ok] using h

theorem asField_inj : ∀ {a b : Value}, keyable a = true → keyable b = true → asField a = asField b → a = b
  | .bytes _, .bytes _, _, _, h | .text _, .text _, _, _, h | .nint _, .nint _, _, _, h
  | .uint _, .uint _, _, _, h => by cases h; rfl
  | .bytes _, .text _, _, _, h | .bytes _, .nint _, _, _, h | .bytes _, .uint _, _, _, h
  | .text _, .bytes _, _, _, h | .text _, .nint _, _, _, h | .text _, .uint _, _, _, h
  | .nint _, .bytes _, _, _, h | .nint _, .text _, _, _, h | .nint _, .uint _, _, _, h
  | .uint _, .bytes _, _, _, h | .uint _, .text _, _, _, h | .uint _, .nint _, _, _, h => by cases h

theorem vals_lt_field {a b : Value} (ha : keyable a = true) (hb : keyable b = true) :
    vals.lt a b = (asField a).lt (asField b) :=
  vals_lt_key a b _ _ (toField_of_keyable ha) (toField_of_keyable hb)

theorem filterMap_toField {l : List Value} (h : l.all keyable = true) : l.filterMap toField = l.map asField := by
  induction l with
  | nil => rfl
  | cons v l ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    simp [toField_of_keyable h.1, ih h.2]

theorem map_asField_inj : ∀ {a b : List Value}, a.all keyable = true → b.all keyable = true →
    a.map asField = b.map asField → a = b
  | [], [], _, _, _ => rfl
  | [], _ :: _, _, _, h | _ :: _, [], _, _, h => by cases h
  | x :: xs, y :: ys, ha, hb, h => by
    simp only [List.all_cons, Bool.and_eq_true] at ha hb
    simp only [List.map_cons, List.cons.injEq] at h
    rw [asField_inj ha.1 hb.1 h.1, map_asField_inj ha.2 hb.2 h.2]

/-! ## Tuples -/

theorem field_lt_irrefl : ∀ x : Field, x.lt x = false
  | .bytes a | .text a => lexLt_irrefl a
  | .nint _ | .uint _ => by simp [Field.lt]

theorem field_lt_asymm : ∀ {x y : Field}, x.lt y = true → y.lt x = false
  | .bytes a, .bytes b, h | .text a, .text b, h => by
    simp only [Field.lt] at h ⊢
    cases h' : lexLt b a
    · rfl
    · exact absurd h' (Aven.DB.Docs.Index.lexLt_asymm h)
  | .nint a, .nint b, h | .uint a, .uint b, h => by simp only [Field.lt, decide_eq_true_eq] at h ⊢; simp; omega
  | .bytes _, .text _, h | .bytes _, .nint _, h | .bytes _, .uint _, h | .text _, .bytes _, h
  | .text _, .nint _, h | .text _, .uint _, h | .nint _, .bytes _, h | .nint _, .text _, h
  | .nint _, .uint _, h | .uint _, .bytes _, h | .uint _, .text _, h | .uint _, .nint _, h => by
    revert h; simp [Field.lt, Field.tag] <;> decide

/-- A shared prefix leaves the order to what follows. -/
theorem tupleLt_append_same : ∀ (q a b : List Field), tupleLt (q ++ a) (q ++ b) = tupleLt a b
  | [], _, _ => rfl
  | x :: q, a, b => by simp [tupleLt, tupleLt_append_same q a b]

/-- A difference within prefixes of one length decides the order. -/
theorem tupleLt_append_ne : ∀ (q h a b : List Field), q.length = h.length → q ≠ h →
    tupleLt (q ++ a) (h ++ b) = tupleLt q h
  | [], [], _, _, _, hne => absurd rfl hne
  | [], _ :: _, _, _, hl, _ | _ :: _, [], _, _, hl, _ => by cases hl
  | x :: q, y :: h, a, b, hl, hne => by
    simp only [List.cons_append, tupleLt]
    split
    · rename_i hxy
      subst hxy
      have : q ≠ h := fun e => hne (by rw [e])
      exact tupleLt_append_ne q h a b (by simpa using hl) this
    · rfl

/-! ## The bounds -/

/-- The key range a probe covers. -/
def bounds (p : Probe Value) : Bytes × Bytes :=
  let pre := p.eqs.map asField
  match p.range with
  | none => (Key.keyBytes pre, Key.keyBytes (pre ++ [Field.uint 0]))
  | some (lo, hi) => (Key.keyBytes (pre ++ [asField lo]), Key.keyBytes (pre ++ [asField hi, Field.uint 0]))

/-- What a probe needs to be one the index can serve: keyable values for every equality field, and a range exactly
when the shape has a range field. -/
def Probe.fits (sh : Shape) (p : Probe Value) : Prop :=
  p.eqs.length = sh.eqs.length ∧ p.eqs.all keyable = true ∧
    match sh.range, p.range with
    | none, none => True
    | some _, some (lo, hi) => keyable lo = true ∧ keyable hi = true
    | _, _ => False

/-- An entry the index of a shape holds: its key has a keyable value for every field the shape names. -/
def Entry.fits (sh : Shape) (e : Entry Value) : Prop :=
  e.key.length = sh.eqs.length + sh.range.toList.length ∧ e.key.all keyable = true

theorem all_ok_map {l : List Value} (h : l.all keyable = true) : (l.map asField).all Field.ok = true := by
  induction l with
  | nil => rfl
  | cons v l ih =>
    simp only [List.all_cons, Bool.and_eq_true] at h
    simp [asField_ok h.1, ih h.2]

theorem zip_all_eq {a b : List Value} (hl : a.length = b.length) :
    (a.zip b).all (fun (x, y) => vals.eq x y) = true ↔ a = b := by
  induction a generalizing b with
  | nil => cases b with
    | nil => simp
    | cons => simp at hl
  | cons x a ih => cases b with
    | nil => simp at hl
    | cons y b =>
      have ih' := ih (b := b) (by simpa using hl)
      simp only [List.zip_cons_cons, List.all_cons, Bool.and_eq_true, List.cons.injEq]
      rw [ih']
      simp [vals]

/-- Not before, in a total order: equal or after. -/
theorem not_lt_iff {x y : Field} : x.lt y = false ↔ (x = y ∨ y.lt x = true) := by
  constructor
  · intro h
    by_cases hxy : x = y
    · exact .inl hxy
    · rcases field_lt_total hxy with h' | h'
      · rw [h] at h'; cases h'
      · exact .inr h'
  · rintro (rfl | h)
    · exact field_lt_irrefl x
    · exact field_lt_asymm h

/-- Not before, in key order, is equal or after. -/
theorem not_before (a b : Field) : (!(if a = b then false else a.lt b)) = (decide (b = a) || b.lt a) := by
  by_cases h : a = b
  · subst h; simp
  · have hb : b ≠ a := fun e => h e.symm
    simp only [h, ite_false, hb, decide_false, Bool.false_or]
    cases hab : a.lt b
    · rcases field_lt_total h with h' | h'
      · rw [hab] at h'; cases h'
      · simp [h']
    · simp [field_lt_asymm hab]

theorem tupleLt_lower (x l : Field) (d : Bytes) : tupleLt [x, .bytes d] [l] = if x = l then false else x.lt l := by
  simp [tupleLt]

theorem tupleLt_upper (h x : Field) (d : Bytes) :
    tupleLt [h, Field.uint 0] [x, .bytes d] = if h = x then false else h.lt x := by
  by_cases e : h = x
  · subst e; simp [tupleLt, Field.lt, Field.tag]
  · simp [tupleLt, e]

/-- **The range holds exactly the entries the probe matches.** -/
theorem inRange_iff_keyMatch (sh : Shape) (p : Probe Value) (e : Entry Value) (hp : p.fits sh) (he : e.fits sh) :
    Aven.DB.Docs.Index.inRange (bounds p).1 (bounds p).2 (entryBytes e) = keyMatch vals sh p e.key := by
  obtain ⟨hlen, hpk, hpr⟩ := hp
  obtain ⟨hklen, hkk⟩ := he
  -- the entry's tuple: its equality part, its range part, its Doc
  have hk : e.key = e.key.take sh.eqs.length ++ e.key.drop sh.eqs.length := (List.take_append_drop sh.eqs.length e.key).symm
  have htk : (e.key.take sh.eqs.length).all keyable = true :=
    List.all_eq_true.mpr fun v hv => List.all_eq_true.mp hkk v (List.mem_of_mem_take hv)
  have hdk : (e.key.drop sh.eqs.length).all keyable = true :=
    List.all_eq_true.mpr fun v hv => List.all_eq_true.mp hkk v (List.mem_of_mem_drop hv)
  have hle : sh.eqs.length ≤ e.key.length := by rw [hklen]; exact Nat.le_add_right _ _
  have htl : (e.key.take sh.eqs.length).length = sh.eqs.length := by
    simp only [List.length_take]; exact Nat.min_eq_left hle
  obtain ⟨q, hqd⟩ : ∃ q, q = (e.key.take sh.eqs.length).map asField := ⟨_, rfl⟩
  obtain ⟨pre, hpd⟩ : ∃ pre, pre = p.eqs.map asField := ⟨_, rfl⟩
  have hq : q.length = pre.length := by rw [hqd, hpd]; simp only [List.length_map, htl, hlen]
  have hqok : q.all Field.ok = true := hqd ▸ all_ok_map htk
  have hpok : pre.all Field.ok = true := hpd ▸ all_ok_map hpk
  have okapp : ∀ a b : List Field, a.all Field.ok = true → b.all Field.ok = true → (a ++ b).all Field.ok = true := by
    intro a b ha hb; rw [List.all_append, ha, hb]; rfl
  have hentry : entryBytes e = Key.keyBytes (q ++ (e.key.drop sh.eqs.length).map asField ++ [.bytes e.doc.hash.bytes]) := by
    rw [hqd]
    simp only [entryBytes, entry, filterMap_toField hkk]
    rw [← List.map_append, List.take_append_drop]
  have heq_iff : q = pre ↔ e.key.take sh.eqs.length = p.eqs :=
    ⟨fun h => map_asField_inj htk hpk (hqd ▸ hpd ▸ h), fun h => by rw [hqd, hpd, h]⟩
  -- keyMatch's equality part
  have hmatch_eq : ((e.key.take sh.eqs.length).length == p.eqs.length && ((e.key.take sh.eqs.length).zip p.eqs).all
      (fun (a, b) => vals.eq a b)) = decide (q = pre) := by
    have hd : decide (q = pre) = decide (e.key.take sh.eqs.length = p.eqs) := by simp only [heq_iff]
    rw [hd]
    simp only [htl, hlen, beq_self_eq_true, Bool.true_and]
    by_cases h : e.key.take sh.eqs.length = p.eqs
    · rw [(zip_all_eq (a := e.key.take sh.eqs.length) (b := p.eqs) (by rw [htl, hlen])).mpr h]
      simp [h]
    · have : ((e.key.take sh.eqs.length).zip p.eqs).all (fun (a, b) => vals.eq a b) = false := by
        cases h' : ((e.key.take sh.eqs.length).zip p.eqs).all (fun (a, b) => vals.eq a b)
        · rfl
        · exact absurd ((zip_all_eq (by rw [htl, hlen])).mp h') h
      simp [h, this]
  unfold Aven.DB.Docs.Index.inRange keyMatch
  rw [hmatch_eq, hentry]
  cases hsr : sh.range with
  | none =>
    rw [hsr] at hpr hklen
    cases hpr' : p.range with
    | some r => rw [hpr'] at hpr; exact absurd hpr id
    | none =>
      have hdrop : e.key.drop sh.eqs.length = [] := by simp at hklen; simp [List.drop_eq_nil_iff]; omega
      simp only [bounds, hpr', hdrop, List.map_nil, List.append_nil]
      rw [← hpd]
      rw [key_order _ _ (okapp _ _ hqok rfl) hpok, key_order _ _ (okapp _ _ hpok (by decide)) (okapp _ _ hqok rfl)]
      by_cases hqp : q = pre
      · rw [hqp]
        have h1 : tupleLt (pre ++ [Field.bytes e.doc.hash.bytes]) pre = false := by
          have := tupleLt_append_same pre [Field.bytes e.doc.hash.bytes] []
          simp only [List.append_nil] at this; rw [this]; rfl
        have h2 : tupleLt (pre ++ [Field.uint 0]) (pre ++ [Field.bytes e.doc.hash.bytes]) = false := by
          rw [tupleLt_append_same]; simp [tupleLt, Field.lt, Field.tag]
        simp [h1, h2]
      · have h1 := tupleLt_append_ne q pre [Field.bytes e.doc.hash.bytes] [] hq hqp
        have h2 := tupleLt_append_ne pre q [Field.uint 0] [Field.bytes e.doc.hash.bytes] hq.symm (Ne.symm hqp)
        simp only [List.append_nil] at h1
        rw [h1, h2]
        rcases tuple_lt_total hqp with h | h <;> simp [h, hqp]
  | some rf =>
    rw [hsr] at hpr hklen
    cases hpr' : p.range with
    | none => rw [hpr'] at hpr; exact absurd hpr id
    | some r =>
      obtain ⟨lo, hi⟩ := r
      rw [hpr'] at hpr
      obtain ⟨hlo, hhi⟩ := hpr
      have hdl : (e.key.drop sh.eqs.length).length = 1 := by simp [List.length_drop]; simp at hklen; omega
      obtain ⟨v, hv⟩ : ∃ v, e.key.drop sh.eqs.length = [v] := by
        match h : e.key.drop sh.eqs.length, hdl with
        | [v], _ => exact ⟨v, rfl⟩
      have hvk : keyable v = true := by rw [hv] at hdk; simpa using hdk
      have hget : e.key[sh.eqs.length]? = some v := by
        rw [hk, List.getElem?_append_right (by simp [htl]), hv]; simp [htl]
      simp only [bounds, hpr', hv, hget, List.map_cons, List.map_nil]
      rw [← hpd]
      simp only [List.append_assoc, List.singleton_append]
      have hvok := asField_ok hvk
      have hlok := asField_ok hlo
      have hhok := asField_ok hhi
      rw [key_order _ _ (okapp _ _ hqok (by simp only [List.all_cons, List.all_nil, hvok]; rfl)) (okapp _ _ hpok (by simp only [List.all_cons, List.all_nil, hlok]; rfl)),
        key_order _ _ (okapp _ _ hpok (by simp only [List.all_cons, List.all_nil, hhok]; rfl)) (okapp _ _ hqok (by simp only [List.all_cons, List.all_nil, hvok]; rfl))]
      rw [vals_lt_field hlo hvk, vals_lt_field hvk hhi]
      have veq : ∀ a b, keyable a = true → keyable b = true → vals.eq a b = decide (asField a = asField b) := by
        intro a b ha hb
        simp only [vals]
        by_cases h : a = b
        · simp [h]
        · have : asField a ≠ asField b := fun e => h (asField_inj ha hb e)
          simp [h, this]
      rw [veq lo v hlo hvk, veq v hi hvk hhi]
      by_cases hqp : q = pre
      · rw [hqp, tupleLt_append_same, tupleLt_append_same, tupleLt_lower, tupleLt_upper, not_before, not_before]
        simp
      · have h1 := tupleLt_append_ne q pre [asField v, Field.bytes e.doc.hash.bytes] [asField lo] hq hqp
        have h2 := tupleLt_append_ne pre q [asField hi, Field.uint 0] [asField v, Field.bytes e.doc.hash.bytes]
          hq.symm (Ne.symm hqp)
        rw [h1, h2]
        rcases tuple_lt_total hqp with h | h <;> simp [h, hqp]

/-! ## The hits are the tree's own lookup -/

section Tree
variable (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat)

/-- The hits as the docs layer's tree finds them: the entries whose keys its lookup returns for the probe's range. -/
def treeHits (p : Probe Value) (idx : List (Entry Value)) : List DocId :=
  (idx.filter fun e =>
    (Index.lookup boundary size limit (bounds p).1 (bounds p).2 (idx.map entryBytes)).contains (entryBytes e)).map
    (·.doc)

/-- **The tree's lookup finds exactly the probe's hits.** -/
theorem treeHits_eq_hits (sh : Shape) (p : Probe Value) (idx : List (Entry Value)) (hp : p.fits sh)
    (hidx : ∀ e ∈ idx, e.fits sh) : treeHits boundary size limit p idx = hits vals sh p idx := by
  unfold treeHits hits
  congr 1
  apply List.filter_congr
  intro e he
  rw [← inRange_iff_keyMatch sh p e hp (hidx e he)]
  cases hc : (Index.lookup boundary size limit (bounds p).1 (bounds p).2 (idx.map entryBytes)).contains (entryBytes e)
  · cases hr : Index.inRange (bounds p).1 (bounds p).2 (entryBytes e)
    · rfl
    · have := Index.lookup_complete boundary size limit (List.mem_map_of_mem he) hr
      rw [← List.contains_iff_mem] at this
      rw [hc] at this; cases this
  · have := Index.lookup_sound boundary size limit (List.contains_iff_mem.mp hc)
    rw [this.2]

/-- The candidates through the tree: its hits and the unfolded Docs, among those listed now. -/
def treeCandidates (p : Probe Value) (idx : List (Entry Value)) (unfolded now : List DocId) : List DocId :=
  (treeHits boundary size limit p idx ++ unfolded).filter now.contains

/-- **The lookup is exact through the docs layer's tree:** the query over the tree's candidates returns exactly the
query over every Doc listed now. -/
theorem lookup_exact_tree (sh : Shape) (p : Probe Value) (db dbV : List (Rec Value)) (docsV unfolded now : List DocId)
    (hp : p.fits sh) (hidx : ∀ e ∈ build sh dbV docsV, e.fits sh)
    (hnow : ∀ d ∈ now, d ∉ unfolded → d ∈ docsV)
    (hsame : ∀ d ∈ now, d ∉ unfolded → ∀ e, e ∈ docEntries sh db d ↔ e ∈ docEntries sh dbV d) :
    select vals sh p db (treeCandidates boundary size limit p (build sh dbV docsV) unfolded now) =
      select vals sh p db now := by
  unfold treeCandidates
  rw [treeHits_eq_hits boundary size limit sh p _ hp hidx]
  exact lookup_exact vals sh p db dbV docsV unfolded now hnow hsame

end Tree

end Aven.DB.Engine
