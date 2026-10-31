import Aven.DB.Blake3

/-!
# Files

A file in the city-dome (`store/README.md`, "Big files are hash sequences"): its bytes cut into chunks of `chunkSize`
bytes, the last one shorter, each stored as an ordinary blob; and its **index**, a blob of its chunks' hashes in order,
32 bytes each (iroh-blobs' hash sequence). The file is named by its index's hash. An empty file has no chunks and an
empty index.

A range read (a browser seeking in a movie) takes exactly the chunks the range touches: chunk `i` holds the bytes
`i * c` to `min n ((i + 1) * c)` of a file of `n` bytes, and a range `a..e` touches the chunks from `a / c` to
`(e - 1) / c`, none when it is empty. What it proves:

- **The chunks are the file** (`flatten_split`): put back together, in order, they are its bytes; each one is 1 to `c`
  bytes (`split_size`), and there are `count c n` of them (`length_split`).
- **A range read takes exactly the chunks it touches** (`mem_touches`): a chunk is taken when, and only when, it
  shares a byte with the range.
- **Limits** (the security audit, 30 Oct 2026): no blob a peer fetches is larger than `maxBlob`, a chunk plus room
  for framing, checked before anything is allocated; no file is larger than `maxFile`, whose index still fits in one
  chunk (`index_fits`).
- **A file is cut as it must be** (`fits`): chunk `i` of a file of `n` bytes is exactly as long as `bounds` says,
  every chunk but the last `c` bytes. A receiver checks each chunk on fetch and on read, so a file whose middle chunk
  is short is malformed, never a crash; every file cut by `split` passes (`split_fits`).

The size is a parameter, so the examples cut small files into small chunks; the city-dome cuts at `chunkSize`.
`lake exe vectors` exports both (`vectors/files.json`), and aven-gen1's `files` module replays them.
-/

namespace Aven.DB.Files

abbrev Bytes := List UInt8

/-- The largest chunk: 1 MiB. -/
def chunkSize : Nat := 1048576

/-- The largest blob a peer fetches: a chunk, and room for framing. A line and an index are smaller. -/
def maxBlob : Nat := chunkSize + 65536

/-- The largest file the city-dome takes: 32 GiB. -/
def maxFile : Nat := 32 * 1024 * 1048576

/-- How many chunks a file of `n` bytes has. -/
def count (c n : Nat) : Nat := (n + c - 1) / c

/-- The chunks of `b`, in order: `c` bytes each but the last. -/
def split (c : Nat) (b : Bytes) : List Bytes :=
  if _h : c = 0 ∨ b = [] then [] else b.take c :: split c (b.drop c)
termination_by b.length
decreasing_by
  cases b with
  | nil => exact absurd (.inr rfl) _h
  | cons x xs =>
    simp only [List.length_drop, List.length_cons]
    omega

/-- Where chunk `i` of a file of `n` bytes starts and ends. -/
def bounds (c n i : Nat) : Nat × Nat := (i * c, min n ((i + 1) * c))

/-- The chunks a range `a..e` touches, in order. -/
def touches (c a e : Nat) : List Nat :=
  if a < e then List.range' (a / c) ((e - 1) / c + 1 - a / c) else []

/-! ## The chunks are the file -/

theorem split_nil (c : Nat) : split c [] = [] := by
  rw [split]; simp

theorem split_cons {c : Nat} (hc : 0 < c) (b : Bytes) (hb : b ≠ []) :
    split c b = b.take c :: split c (b.drop c) := by
  rw [split, dite_eq_right]
  intro h
  rcases h with h | h
  · omega
  · exact hb h

theorem flatten_split {c : Nat} (hc : 0 < c) : ∀ (n : Nat) (b : Bytes), b.length ≤ n → (split c b).flatten = b
  | 0, b, h => by
    cases b with
    | nil => simp [split_nil]
    | cons x xs => simp at h
  | n + 1, b, h => by
    cases b with
    | nil => simp [split_nil]
    | cons x xs =>
      rw [split_cons hc _ (List.cons_ne_nil x xs), List.flatten_cons,
        flatten_split hc n _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega)]
      exact List.take_append_drop c _

/-- Every chunk is 1 to `c` bytes. -/
theorem split_size {c : Nat} (hc : 0 < c) : ∀ (n : Nat) (b : Bytes), b.length ≤ n →
    ∀ x ∈ split c b, 0 < x.length ∧ x.length ≤ c
  | 0, b, h => by
    cases b with
    | nil => simp [split_nil]
    | cons x xs => simp at h
  | n + 1, b, h => by
    cases b with
    | nil => simp [split_nil]
    | cons y ys =>
      rw [split_cons hc _ (List.cons_ne_nil y ys)]
      intro x mx
      rcases List.mem_cons.mp mx with rfl | mx
      · simp only [List.length_take, List.length_cons]; omega
      · exact split_size hc n _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega) x mx

theorem count_pos {c n : Nat} (hc : 0 < c) (hn : 0 < n) : count c n = count c (n - c) + 1 := by
  unfold count
  by_cases s : n ≤ c
  · rw [Nat.sub_eq_zero_of_le s, Nat.zero_add, Nat.div_eq_of_lt (by omega : c - 1 < c),
      Nat.div_eq_of_lt_le (k := 1) (by omega) (by omega)]
  · have e : n + c - 1 = (n - c + c - 1) + c := by omega
    rw [e, Nat.add_div_right _ hc]

theorem count_zero {c : Nat} (hc : 0 < c) : count c 0 = 0 := by
  unfold count
  rw [Nat.zero_add, Nat.div_eq_of_lt (by omega)]

theorem length_split {c : Nat} (hc : 0 < c) : ∀ (n : Nat) (b : Bytes), b.length ≤ n →
    (split c b).length = count c b.length
  | 0, b, h => by
    cases b with
    | nil => rw [split_nil]; exact (count_zero hc).symm
    | cons x xs => simp at h
  | n + 1, b, h => by
    cases b with
    | nil => rw [split_nil]; exact (count_zero hc).symm
    | cons y ys =>
      rw [split_cons hc _ (List.cons_ne_nil y ys), List.length_cons,
        length_split hc n _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega), List.length_drop,
        (count_pos hc (n := (y :: ys).length) (by simp)).symm]

/-! ## A file is cut as it must be -/

/-- Chunk `i` of a file of `n` bytes, `len` bytes long, is as `bounds` says: one of its chunks, exactly that long. -/
def fits (c n i len : Nat) : Bool := i < count c n && len == (bounds c n i).2 - (bounds c n i).1

/-- The index of the largest file fits in one chunk, so in a blob. -/
theorem index_fits : count chunkSize maxFile * 32 ≤ chunkSize ∧ chunkSize ≤ maxBlob := by decide

theorem split_length_le {c : Nat} (hc : 0 < c) : ∀ (n : Nat) (b : Bytes), b.length ≤ n → ∀ i,
    ((split c b).getD i []).length = min b.length ((i + 1) * c) - min b.length (i * c)
  | 0, b, h, i => by
    cases b with
    | nil => simp [split_nil]
    | cons x xs => simp at h
  | n + 1, b, h, i => by
    cases b with
    | nil => simp [split_nil]
    | cons y ys =>
      rw [split_cons hc _ (List.cons_ne_nil y ys)]
      cases i with
      | zero => simp only [List.getD_cons_zero, List.length_take]; simp; omega
      | succ i =>
        simp only [List.getD_cons_succ]
        rw [split_length_le hc n _ (by simp only [List.length_drop, List.length_cons] at h ⊢; omega) i,
          List.length_drop]
        have e1 : (i + 1 + 1) * c = i * c + c + c := by rw [Nat.add_mul, Nat.add_mul, Nat.one_mul]
        have e2 : (i + 1) * c = i * c + c := by rw [Nat.add_mul, Nat.one_mul]
        rw [e1, e2]
        generalize i * c = k
        omega

/-- **Every file cut by `split` passes:** its chunk `i` fits. -/
theorem split_fits {c : Nat} (hc : 0 < c) (b : Bytes) (i : Nat) (hi : i < (split c b).length) :
    fits c b.length i ((split c b).getD i []).length = true := by
  have hl := length_split hc b.length b (Nat.le_refl _)
  simp only [fits, bounds, Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq]
  refine ⟨hl ▸ hi, ?_⟩
  rw [split_length_le hc b.length b (Nat.le_refl _) i]
  have lt : i + 1 ≤ (b.length + c - 1) / c := by rw [hl] at hi; exact hi
  rw [Nat.le_div_iff_mul_le hc, Nat.add_mul, Nat.one_mul] at lt
  generalize i * c = k at lt ⊢
  omega

/-! ## A range read takes exactly the chunks it touches -/

/-- A chunk is taken when, and only when, it shares a byte with the range: it starts before the range ends, and ends
after it starts. -/
theorem mem_touches {c a e i : Nat} (hc : 0 < c) :
    i ∈ touches c a e ↔ a < e ∧ i * c < e ∧ a < (i + 1) * c := by
  unfold touches
  split
  · next lt =>
    simp only [List.mem_range'_1]
    have l : a / c ≤ i ↔ a < (i + 1) * c := by
      rw [← Nat.div_lt_iff_lt_mul hc]; omega
    have r : i ≤ (e - 1) / c ↔ i * c < e := by
      rw [Nat.le_div_iff_mul_le hc]; omega
    constructor
    · rintro ⟨x, y⟩
      exact ⟨lt, r.mp (by omega), l.mp x⟩
    · rintro ⟨-, x, y⟩
      have := l.mpr y
      have := r.mpr x
      omega
  · next ge => simp only [List.not_mem_nil, false_iff]; omega

/-- Every chunk a range of the file touches is one of its chunks. -/
theorem touches_lt {c a e n i : Nat} (hc : 0 < c) (he : e ≤ n) (h : i ∈ touches c a e) : i < count c n := by
  obtain ⟨-, x, -⟩ := (mem_touches hc).mp h
  unfold count
  show i + 1 ≤ _
  rw [Nat.le_div_iff_mul_le hc, Nat.succ_mul]
  omega

/-! ## The index -/

/-- A hash's 32 bytes, from its 64 hex digits. -/
def unhex : List Char → Bytes
  | a :: b :: rest =>
    let v (x : Char) : Nat := if x.isDigit then x.toNat - '0'.toNat else x.toNat - 'a'.toNat + 10
    (16 * v a + v b).toUInt8 :: unhex rest
  | _ => []

/-- The index: its chunks' hashes, 32 bytes each, in order. -/
def index (b : Bytes) (c : Nat := chunkSize) : Bytes :=
  (split c b).flatMap fun x => unhex (Blake3.hash x).toList

/-- A file's name: its index's hash. -/
def name (b : Bytes) (c : Nat := chunkSize) : String := Blake3.hash (index b c)

/-- A range of the file read from the chunks it touches alone, as a reader that holds only those does. -/
def read (c : Nat) (b : Bytes) (a e : Nat) : Bytes :=
  let cs := split c b
  let got := (touches c a e).flatMap fun i => cs.getD i []
  (got.drop (a - a / c * c)).take (e - a)

/-! ## Examples

Small files in small chunks: how many chunks and where each starts and ends, which chunks a range touches, and that
reading only those gives the range's bytes. -/

def abc : Bytes := "abcdefghij".toUTF8.toList

#guard split 4 abc = ["abcd".toUTF8.toList, "efgh".toUTF8.toList, "ij".toUTF8.toList]
#guard split 5 abc = ["abcde".toUTF8.toList, "fghij".toUTF8.toList]
#guard split 4 [] = []
#guard count 4 10 = 3 ∧ count 5 10 = 2 ∧ count 4 0 = 0 ∧ count chunkSize 1 = 1
#guard (List.range 3).map (bounds 4 10) = [(0, 4), (4, 8), (8, 10)]
#guard touches 4 0 10 = [0, 1, 2]
#guard touches 4 3 5 = [0, 1]
#guard touches 4 4 8 = [1]
#guard touches 4 9 10 = [2]
#guard touches 4 5 5 = []
#guard read 4 abc 3 9 = "defghi".toUTF8.toList
#guard read 4 abc 4 8 = "efgh".toUTF8.toList
#guard read 4 abc 0 0 = []
#guard index [] = [] ∧ name [] = Blake3.hash []
#guard (index abc 4).length = 3 * 32
-- a 200 MB movie in 1 MiB chunks; its middle second is two chunks
#guard count chunkSize 200000000 = 191
#guard touches chunkSize 100000000 100500000 = [95]
#guard touches chunkSize 100500000 101000000 = [95, 96]
-- a file is cut as it must be: every chunk but the last is whole, the last 1 to c bytes
#guard [fits 4 10 0 4, fits 4 10 1 4, fits 4 10 2 2] = [true, true, true]
#guard [fits 4 10 1 2, fits 4 10 2 4, fits 4 10 3 0, fits 4 10 0 5, fits 4 8 1 0] = [false, false, false, false, false]
#guard (List.range 12).all fun n => (List.range 5).all fun c => c = 0 ||
  let b := (List.range n).map Nat.toUInt8
  (List.range (split c b).length).all fun i => fits c n i ((split c b).getD i []).length
-- reading only the chunks a range touches gives its bytes, every range of a small file
#guard (List.range 11).all fun a => (List.range 11).all fun e =>
  a > e || (List.range 6).all fun c => c = 0 || read c abc a e == (abc.drop a).take (e - a)

end Aven.DB.Files
