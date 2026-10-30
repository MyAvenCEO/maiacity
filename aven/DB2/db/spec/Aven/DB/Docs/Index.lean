import Aven.Core

/-!
# Sealed indexes and directories (A26)

One structure for a vault's directory and for every index: a **Prolly tree**, a search tree whose nodes are Values
named by hash. Its entries, each its encoding with the key first, are kept sorted bytewise. A node ends after an entry
whose own hash says so (a **boundary**), or before an entry that would take it past the size limit. Both depend only on
the entries, never on the order they arrived in, so the same entries always make the same nodes and the same root:
two devices, or two folds, agree byte for byte, and sealed nodes dedupe.

The model takes the boundary and the entries' sizes as parameters; the Rust uses the low bits of an entry's BLAKE3 and
its encoded length. A node holds what lies between its first and last entry, which its parent names, so a lookup
opens only the nodes whose span meets the range.

What it proves:
- `entries_sorted`, `entries_mem`, `sorted_unique`: the entries of a fold are the set of what went in, sorted, and
  nothing else could be;
- `chunks_flatten`, `chunks_size`: the nodes hold exactly the entries, in order, each within the size limit;
- `nodes_set`, `root_set`: the nodes and the root depend only on the set of entries;
- `fold_steps`, `fold_removes`: folding in steps gives what folding at once gives, removals included;
- `lookup_complete`, `lookup_sound`: a lookup finds every entry in its range, and only those.
-/

namespace Aven.DB.Docs.Index

open Aven.Core

/-! ## The bytewise order -/

/-- `a` sorts strictly before `b`. -/
abbrev Lt (a b : Bytes) : Prop := lexLt a b = true

theorem uint8_lt_toNat {x y : UInt8} : x < y ↔ x.toNat < y.toNat := UInt8.lt_iff_toNat_lt

theorem lexLt_trans : ∀ {a b c : Bytes}, Lt a b → Lt b c → Lt a c
  | [], [], _, h, _ => by simp [Lt, lexLt] at h
  | _ :: _, [], _, h, _ => by simp [Lt, lexLt] at h
  | [], _ :: _, [], _, h => by simp [Lt, lexLt] at h
  | _ :: _, _ :: _, [], _, h => by simp [Lt, lexLt] at h
  | [], _ :: _, _ :: _, _, _ => rfl
  | x :: xs, y :: ys, z :: zs, h₁, h₂ => by
    simp only [Lt, lexLt, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h₁ h₂ ⊢
    rcases h₁ with h₁ | ⟨rfl, h₁⟩ <;> rcases h₂ with h₂ | ⟨rfl, h₂⟩
    · left; rw [uint8_lt_toNat] at *; omega
    · exact .inl h₁
    · exact .inl h₂
    · exact .inr ⟨rfl, lexLt_trans h₁ h₂⟩

theorem lexLt_total : ∀ {a b : Bytes}, a ≠ b → Lt a b ∨ Lt b a
  | [], [], h => absurd rfl h
  | [], _ :: _, _ => .inl rfl
  | _ :: _, [], _ => .inr rfl
  | x :: xs, y :: ys, h => by
    simp only [Lt, lexLt, Bool.or_eq_true, Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq]
    by_cases hxy : x < y
    · exact .inl (.inl hxy)
    by_cases hyx : y < x
    · exact .inr (.inl hyx)
    have hx : x = y := by
      rw [uint8_lt_toNat] at hxy hyx
      exact UInt8.toNat_inj.mp (by omega)
    subst hx
    have hne : xs ≠ ys := fun e => h (by rw [e])
    rcases lexLt_total hne with h' | h'
    · exact .inl (.inr ⟨rfl, h'⟩)
    · exact .inr (.inr ⟨rfl, h'⟩)

theorem lexLt_asymm {a b : Bytes} (h : Lt a b) : ¬ Lt b a := fun h' => by
  have := lexLt_trans h h'
  simp [Lt, lexLt_irrefl] at this

/-! ## The entries: a sorted set -/

/-- Insert an entry, once, into a sorted list. -/
def insert (x : Bytes) : List Bytes → List Bytes
  | [] => [x]
  | y :: ys => if lexLt x y then x :: y :: ys else if x = y then y :: ys else y :: insert x ys

/-- What a fold holds: every entry that went in, once, sorted. -/
def entries (l : List Bytes) : List Bytes := l.foldr insert []

theorem mem_insert {x z : Bytes} : ∀ {l : List Bytes}, z ∈ insert x l ↔ z = x ∨ z ∈ l
  | [] => by simp [insert]
  | y :: ys => by
    unfold insert
    split
    · simp
    · split
      · rename_i h; subst h; simp
      · simp only [List.mem_cons, mem_insert (l := ys)]
        constructor
        · rintro (h | h | h) <;> simp_all
        · rintro (h | h | h) <;> simp_all

theorem sorted_insert {x : Bytes} : ∀ {l : List Bytes}, l.Pairwise Lt → (insert x l).Pairwise Lt
  | [], _ => by simp [insert]
  | y :: ys, h => by
    unfold insert
    rw [List.pairwise_cons] at h
    split
    · rename_i hxy
      refine List.pairwise_cons.mpr ⟨?_, List.pairwise_cons.mpr h⟩
      intro z hz
      rcases List.mem_cons.mp hz with rfl | hz
      · exact hxy
      · exact lexLt_trans hxy (h.1 z hz)
    · split
      · exact List.pairwise_cons.mpr h
      · rename_i hxy hne
        have hyx : Lt y x := (lexLt_total (Ne.symm hne)).resolve_right hxy
        refine List.pairwise_cons.mpr ⟨?_, sorted_insert h.2⟩
        intro z hz
        rcases mem_insert.mp hz with rfl | hz
        · exact hyx
        · exact h.1 z hz

theorem entries_sorted (l : List Bytes) : (entries l).Pairwise Lt := by
  induction l with
  | nil => simp [entries]
  | cons x l ih => exact sorted_insert ih

theorem entries_mem {z : Bytes} : ∀ {l : List Bytes}, z ∈ entries l ↔ z ∈ l
  | [] => by simp [entries]
  | x :: l => by
    show z ∈ insert x (entries l) ↔ _
    rw [mem_insert, entries_mem]; simp

/-- Two sorted lists holding the same entries are one list. -/
theorem sorted_unique : ∀ {a b : List Bytes}, a.Pairwise Lt → b.Pairwise Lt → (∀ x, x ∈ a ↔ x ∈ b) → a = b
  | [], [], _, _, _ => rfl
  | [], y :: _, _, _, h => by have := (h y).mpr (by simp); simp at this
  | x :: _, [], _, _, h => by have := (h x).mp (by simp); simp at this
  | x :: xs, y :: ys, ha, hb, h => by
    rw [List.pairwise_cons] at ha hb
    have hxy : x = y := by
      apply Classical.byContradiction
      intro hne
      have hx : x ∈ ys := by
        rcases List.mem_cons.mp ((h x).mp (by simp)) with e | e
        · exact absurd e hne
        · exact e
      have hy : y ∈ xs := by
        rcases List.mem_cons.mp ((h y).mpr (by simp)) with e | e
        · exact absurd e.symm hne
        · exact e
      exact lexLt_asymm (ha.1 y hy) (hb.1 x hx)
    subst hxy
    have tail : ∀ z, z ∈ xs ↔ z ∈ ys := by
      intro z
      constructor
      · intro hz
        rcases List.mem_cons.mp ((h z).mp (List.mem_cons_of_mem _ hz)) with e | e
        · subst e; exact absurd (ha.1 z hz) (by simp [Lt, lexLt_irrefl])
        · exact e
      · intro hz
        rcases List.mem_cons.mp ((h z).mpr (List.mem_cons_of_mem _ hz)) with e | e
        · subst e; exact absurd (hb.1 z hz) (by simp [Lt, lexLt_irrefl])
        · exact e
    rw [sorted_unique ha.2 hb.2 tail]

/-- The entries depend only on the set of what went in. -/
theorem entries_set {a b : List Bytes} (h : ∀ x, x ∈ a ↔ x ∈ b) : entries a = entries b :=
  sorted_unique (entries_sorted a) (entries_sorted b) fun x => by rw [entries_mem, entries_mem, h]

/-- Folding in steps gives what folding at once gives: earlier folds, then the recent entries. -/
theorem fold_steps (a b c : List Bytes) : entries (entries (a ++ b) ++ c) = entries (a ++ b ++ c) :=
  entries_set fun x => by simp [entries_mem, or_assoc]

/-- Folding with removals: a fold keeps what it covers minus what was removed, then adds the recent entries; in steps
or at once, the same. -/
theorem fold_removes (keep : Bytes → Bool) (a c : List Bytes) :
    entries ((entries a).filter keep ++ c) = entries (a.filter keep ++ c) :=
  entries_set fun x => by simp [entries_mem]

/-! ## Nodes -/

variable (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat)

/-- Cut sorted entries into nodes: a node ends after a boundary entry, or before an entry that would take it past the
size limit. `cur` is the node so far, newest first, and `used` its size. -/
def chunksFrom (cur : List Bytes) (used : Nat) : List Bytes → List (List Bytes)
  | [] => if cur = [] then [] else [cur.reverse]
  | x :: xs =>
    if cur ≠ [] ∧ used + size x > limit then
      cur.reverse :: (if boundary x then [x] :: chunksFrom [] 0 xs else chunksFrom [x] (size x) xs)
    else if boundary x then (x :: cur).reverse :: chunksFrom [] 0 xs
    else chunksFrom (x :: cur) (used + size x) xs

def chunks (l : List Bytes) : List (List Bytes) := chunksFrom boundary size limit [] 0 l

theorem chunksFrom_flatten : ∀ (cur : List Bytes) (used : Nat) (l : List Bytes),
    (chunksFrom boundary size limit cur used l).flatten = cur.reverse ++ l
  | cur, used, [] => by unfold chunksFrom; split <;> simp_all
  | cur, used, x :: xs => by
    unfold chunksFrom
    split
    · split
      · rw [List.flatten_cons, List.flatten_cons, chunksFrom_flatten [] 0 xs]; simp
      · rw [List.flatten_cons, chunksFrom_flatten [x] _ xs]; simp
    · split
      · rw [List.flatten_cons, chunksFrom_flatten [] 0 xs]; simp
      · rw [chunksFrom_flatten (x :: cur) _ xs]; simp

/-- The nodes hold exactly the entries, in order. -/
theorem chunks_flatten (l : List Bytes) : (chunks boundary size limit l).flatten = l := by
  simp [chunks, chunksFrom_flatten]

theorem chunksFrom_size (hx : ∀ x, size x ≤ limit) : ∀ (cur : List Bytes) (used : Nat) (l : List Bytes),
    (cur.map size).sum = used → used ≤ limit →
    ∀ c ∈ chunksFrom boundary size limit cur used l, (c.map size).sum ≤ limit
  | cur, used, [], hu, hl, c, hc => by
    unfold chunksFrom at hc
    split at hc
    · simp at hc
    · simp only [List.mem_singleton] at hc; subst hc; simp [List.map_reverse, List.sum_reverse]; omega
  | cur, used, x :: xs, hu, hl, c, hc => by
    unfold chunksFrom at hc
    split at hc
    · rcases List.mem_cons.mp hc with rfl | hc
      · simp [List.map_reverse, List.sum_reverse]; omega
      · split at hc
        · rcases List.mem_cons.mp hc with rfl | hc
          · simp [hx x]
          · exact chunksFrom_size hx [] 0 xs rfl (Nat.zero_le _) c hc
        · exact chunksFrom_size hx [x] (size x) xs (by simp) (hx x) c hc
    · rename_i hfit
      have hfit : cur = [] ∨ used + size x ≤ limit := by
        by_cases h : cur = [] <;> simp_all
      split at hc
      · rcases List.mem_cons.mp hc with rfl | hc
        · simp only [List.reverse_cons, List.map_append, List.map_reverse, List.sum_append, List.sum_reverse,
            List.map_cons, List.map_nil, List.sum_cons, List.sum_nil]
          rcases hfit with rfl | hfit
          · simp; exact hx x
          · omega
        · exact chunksFrom_size hx [] 0 xs rfl (Nat.zero_le _) c hc
      · refine chunksFrom_size hx (x :: cur) (used + size x) xs (by simp [hu]; omega) ?_ c hc
        rcases hfit with rfl | hfit
        · simp at hu; have := hx x; omega
        · exact hfit

/-- Every node is within the size limit, when every entry is. -/
theorem chunks_size (hx : ∀ x, size x ≤ limit) (l : List Bytes) :
    ∀ c ∈ chunks boundary size limit l, (c.map size).sum ≤ limit :=
  chunksFrom_size boundary size limit hx [] 0 l rfl (Nat.zero_le _)

/-- The nodes of a fold depend only on the set of its entries, not the order they came in. -/
theorem nodes_set {a b : List Bytes} (h : ∀ x, x ∈ a ↔ x ∈ b) :
    chunks boundary size limit (entries a) = chunks boundary size limit (entries b) := by
  rw [entries_set h]

/-! ## The root -/

/-- A node as a Value: its entries, or its children's summaries, in order. -/
def nodeValue (c : List Bytes) : Value := .array (c.map .bytes)

/-- A child's summary in its parent: its first entry, its last entry and its name. -/
def summary (H : Bytes → Hash) (c : List Bytes) : Bytes :=
  encode (.array [.bytes (c.headD []), .bytes (c.getLastD []), .bytes (nameOf H (nodeValue c)).bytes])

/-- Build upwards, a level at a time, until one node is left; the same rule cuts every level. -/
def rootFrom (H : Bytes → Hash) : Nat → List Bytes → Hash
  | 0, level => nameOf H (nodeValue level)
  | fuel + 1, level =>
    let ns := chunks boundary size limit level
    if ns.length ≤ 1 then nameOf H (nodeValue level) else rootFrom H fuel (ns.map (summary H))

/-- A fold's root. -/
def root (H : Bytes → Hash) (l : List Bytes) : Hash :=
  rootFrom boundary size limit H (entries l).length (entries l)

/-- The root depends only on the set of entries: two folds of one version give one root. -/
theorem root_set (H : Bytes → Hash) {a b : List Bytes} (h : ∀ x, x ∈ a ↔ x ∈ b) :
    root boundary size limit H a = root boundary size limit H b := by
  simp only [root, entries_set h]

/-! ## Lookups -/

/-- An entry in the range `lo` to `hi`, both included. -/
def inRange (lo hi x : Bytes) : Bool := !lexLt x lo && !lexLt hi x

/-- A node may hold entries in the range: its span, first to last entry, meets it. Its parent knows both. -/
def mayHold (lo hi : Bytes) (c : List Bytes) : Bool :=
  match c.head?, c.getLast? with
  | some f, some l => !lexLt l lo && !lexLt hi f
  | _, _ => false

/-- A range lookup: open only the nodes whose span meets the range, and keep their entries in it. -/
def lookup (lo hi : Bytes) (l : List Bytes) : List Bytes :=
  ((chunks boundary size limit (entries l)).filter (mayHold lo hi)).flatten.filter (inRange lo hi)

theorem head_le {f x : Bytes} {c : List Bytes} (hs : (f :: c).Pairwise Lt) (hx : x ∈ f :: c) : x = f ∨ Lt f x := by
  rcases List.mem_cons.mp hx with h | h
  · exact .inl h
  · exact .inr ((List.pairwise_cons.mp hs).1 x h)

theorem le_last : ∀ {c : List Bytes} {l x : Bytes}, c.Pairwise Lt → c.getLast? = some l → x ∈ c → x = l ∨ Lt x l
  | [], _, _, _, h, _ => by simp at h
  | [y], l, x, _, h, hx => by simp at h hx; exact .inl (hx.trans h)
  | y :: z :: zs, l, x, hs, h, hx => by
    have hl : (z :: zs).getLast? = some l := by simpa using h
    have hs' := List.pairwise_cons.mp hs
    rcases List.mem_cons.mp hx with rfl | hx
    · have hlm : l ∈ z :: zs := List.mem_of_getLast? hl
      exact .inr (hs'.1 l hlm)
    · exact le_last hs'.2 hl hx

/-- A lookup finds every entry in its range. -/
theorem lookup_complete {lo hi x : Bytes} {l : List Bytes} (hx : x ∈ l) (hr : inRange lo hi x = true) :
    x ∈ lookup boundary size limit lo hi l := by
  have hxe : x ∈ entries l := entries_mem.mpr hx
  rw [← chunks_flatten boundary size limit (entries l)] at hxe
  obtain ⟨c, hc, hxc⟩ := List.mem_flatten.mp hxe
  have hcs : c.Pairwise Lt :=
    (entries_sorted l).sublist (by
      have := List.sublist_flatten_of_mem hc
      rwa [chunks_flatten] at this)
  simp only [lookup, List.mem_filter, List.mem_flatten]
  refine ⟨⟨c, ⟨hc, ?_⟩, hxc⟩, hr⟩
  simp only [inRange, Bool.and_eq_true, Bool.not_eq_true'] at hr
  match c, hcs, hxc with
  | f :: cs, hcs, hxc =>
    obtain ⟨lst, hlst⟩ : ∃ lst, (f :: cs).getLast? = some lst := by
      cases h : (f :: cs).getLast? with
      | none => simp at h
      | some v => exact ⟨v, rfl⟩
    simp only [mayHold, List.head?_cons, hlst, Bool.and_eq_true, Bool.not_eq_true']
    constructor
    · rcases le_last hcs hlst hxc with rfl | hlt
      · exact hr.1
      · cases h : lexLt lst lo
        · rfl
        · exact absurd (lexLt_trans hlt h) (by simp [hr.1])
    · rcases head_le hcs hxc with rfl | hlt
      · exact hr.2
      · cases h : lexLt hi f
        · rfl
        · exact absurd (lexLt_trans h hlt) (by simp [hr.2])

/-- A lookup finds only entries of the fold in its range. -/
theorem lookup_sound {lo hi x : Bytes} {l : List Bytes} (h : x ∈ lookup boundary size limit lo hi l) :
    x ∈ l ∧ inRange lo hi x = true := by
  simp only [lookup, List.mem_filter, List.mem_flatten] at h
  obtain ⟨⟨c, hc, hxc⟩, hr⟩ := h
  refine ⟨entries_mem.mp ?_, hr⟩
  rw [← chunks_flatten boundary size limit (entries l)]
  exact List.mem_flatten.mpr ⟨c, hc.1, hxc⟩

end Aven.DB.Docs.Index
