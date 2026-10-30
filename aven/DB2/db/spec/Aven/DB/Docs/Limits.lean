import Aven.DB.Docs.Changes

/-!
# Every input has a limit before Loro sees it

Docs rule 24 and architecture rule 10: an envelope is measured before it costs memory, in the order a reader imports
it (docs, "Importing"). First its sealed bytes, as they arrive, before anything is opened or decoded (step 1); then, once
decoded, the depth of its CBOR, how many envelopes it builds on, how many Records it touches and how many ops it
carries (steps 3 and 8); a segment closes at 256 envelopes or 1 MiB; a blob is fetched only when its declared size is
within the limit.

What it proves:
- a capped read holds at most the limit plus one chunk, and gives bytes only within the limit (`capped_holds`,
  `capped_within`); the bytes it gives are all that arrived, when they fit (`capped_whole`);
- an admitted envelope is bounded in each measure (`admitted_bounded`), so Loro and fit see only bounded input;
- a closed segment is within both of its limits (`segment_bounded`);
- what an admitted segment hands Loro is bounded by the limits' product (`segment_records`).
-/

namespace Aven.DB.Docs

open Aven.Core

/-- The limits, each checked before the next step spends memory on what it measures. -/
structure Limits where
  /-- an envelope's sealed bytes -/
  sealed : Nat
  /-- nesting of its CBOR -/
  depth : Nat
  /-- the envelopes it names in `deps` -/
  fanout : Nat
  /-- the Records it touches -/
  records : Nat
  /-- its Loro ops -/
  ops : Nat
  /-- envelopes in a segment -/
  segmentEnvelopes : Nat
  /-- a segment's sealed bytes -/
  segmentBytes : Nat
  /-- a blob's declared size -/
  blob : Nat

/-- The limits the docs spec names: 1 MiB sealed, depth 256, a segment of 256 envelopes or 1 MiB. The fan-out, Records,
ops and blob limits are the release's; these are the defaults the vectors use. -/
def Limits.defaults : Limits :=
  { sealed := 1024 * 1024, depth := 256, fanout := 256, records := 4096, ops := 65536, segmentEnvelopes := 256,
    segmentBytes := 1024 * 1024, blob := 4 * 1024 * 1024 * 1024 }

/-! ## Step 1: the sealed bytes, as they arrive -/

/-- Read chunks into a buffer, refusing (`none`) as soon as the buffer passes the limit: nothing after that is kept. -/
def capped (limit : Nat) : Bytes → List Bytes → Option Bytes
  | buf, [] => some buf
  | buf, c :: cs => if (buf ++ c).length ≤ limit then capped limit (buf ++ c) cs else none

/-- What a capped read gives is within the limit. -/
theorem capped_within {limit : Nat} : ∀ {buf : Bytes} {cs : List Bytes} {out : Bytes},
    buf.length ≤ limit → capped limit buf cs = some out → out.length ≤ limit
  | _, [], _, hb, h => by simp only [capped, Option.some.injEq] at h; exact h ▸ hb
  | buf, c :: cs, out, _, h => by
    simp only [capped] at h
    split at h
    · next hc => exact capped_within hc h
    · cases h

/-- Every buffer a capped read ever holds, a chunk at a time, is within the limit plus the chunk it just took. -/
def held (limit : Nat) : Bytes → List Bytes → List Bytes
  | _, [] => []
  | buf, c :: cs => (buf ++ c) :: if (buf ++ c).length ≤ limit then held limit (buf ++ c) cs else []

theorem capped_holds {limit : Nat} : ∀ {buf : Bytes} {cs : List Bytes} {b : Bytes},
    buf.length ≤ limit → b ∈ held limit buf cs → ∃ c ∈ cs, b.length ≤ limit + c.length
  | _, [], _, _, h => by simp [held] at h
  | buf, c :: cs, b, hb, h => by
    simp only [held, List.mem_cons] at h
    rcases h with rfl | h
    · exact ⟨c, by simp, by simp only [List.length_append]; omega⟩
    · split at h
      · next hc =>
        obtain ⟨c', hc', hl⟩ := capped_holds hc h
        exact ⟨c', List.mem_cons_of_mem _ hc', hl⟩
      · simp at h

/-- When everything that arrived fits, a capped read gives all of it. -/
theorem capped_whole {limit : Nat} : ∀ {buf : Bytes} {cs : List Bytes},
    (buf ++ cs.flatten).length ≤ limit → capped limit buf cs = some (buf ++ cs.flatten)
  | buf, [], _ => by simp [capped]
  | buf, c :: cs, h => by
    have hc : (buf ++ c).length ≤ limit := by
      simp only [List.flatten_cons, List.length_append] at h ⊢; omega
    simp only [capped, hc, if_true, List.flatten_cons, ← List.append_assoc]
    exact capped_whole (by simpa [List.append_assoc] using h)

/-! ## Steps 3 and 8: the decoded envelope -/

mutual
/-- How deeply a Value nests: arrays and maps add one. -/
def depth : Value → Nat
  | .array xs => depthList xs + 1
  | .map kvs => depthMap kvs + 1
  | _ => 0
def depthList : List Value → Nat
  | [] => 0
  | x :: xs => max (depth x) (depthList xs)
def depthMap : List (Bytes × Value) → Nat
  | [] => 0
  | (_, v) :: kvs => max (depth v) (depthMap kvs)
end

/-- What a reader measures of a decoded envelope: its body's depth, its fan-out, the Records its changes touch, and its
ops (as the decoder counts them). -/
def admits (L : Limits) (ops : Nat) (e : Envelope) (cs : List RecordChange) : Bool :=
  depth e.body ≤ L.depth && e.deps.length ≤ L.fanout && cs.length ≤ L.records && ops ≤ L.ops

/-- An admitted envelope is bounded in each measure: Loro and fit see only bounded input. -/
theorem admitted_bounded {L : Limits} {ops : Nat} {e : Envelope} {cs : List RecordChange}
    (h : admits L ops e cs = true) :
    depth e.body ≤ L.depth ∧ e.deps.length ≤ L.fanout ∧ cs.length ≤ L.records ∧ ops ≤ L.ops := by
  simp only [admits, Bool.and_eq_true, decide_eq_true_eq] at h
  exact ⟨h.1.1.1, h.1.1.2, h.1.2, h.2⟩

/-! ## Segments and blobs -/

/-- A segment closes before either limit: its envelopes' sealed sizes. -/
def segmentFits (L : Limits) (sizes : List Nat) : Bool :=
  sizes.length ≤ L.segmentEnvelopes && sizes.sum ≤ L.segmentBytes

theorem segment_bounded {L : Limits} {sizes : List Nat} (h : segmentFits L sizes = true) :
    sizes.length ≤ L.segmentEnvelopes ∧ sizes.sum ≤ L.segmentBytes := by
  simpa [segmentFits] using h

/-- What a segment of admitted envelopes hands Loro: at most `segmentEnvelopes × records` Record changes. -/
theorem sum_lengths_le {n : Nat} : ∀ (es : List (List RecordChange)), (∀ cs ∈ es, cs.length ≤ n) →
    (es.map List.length).sum ≤ es.length * n
  | [], _ => by simp
  | x :: xs, h => by
    simp only [List.map_cons, List.sum_cons, List.length_cons, Nat.succ_mul]
    have hx := h x (by simp)
    have := sum_lengths_le xs (fun cs m => h cs (List.mem_cons_of_mem _ m))
    omega

theorem segment_records {L : Limits} (es : List (List RecordChange)) (hn : es.length ≤ L.segmentEnvelopes)
    (h : ∀ cs ∈ es, cs.length ≤ L.records) : (es.map List.length).sum ≤ L.segmentEnvelopes * L.records :=
  Nat.le_trans (sum_lengths_le es h) (Nat.mul_le_mul_right _ hn)

/-- A blob is fetched only when its declared size is within the limit; its chunks are then verified as they arrive
(the store), so a lying size stops at the limit. -/
def fetchBlob (L : Limits) (declared : Nat) : Bool := declared ≤ L.blob

theorem blob_bounded {L : Limits} {declared : Nat} {chunks : List Bytes} {out : Bytes}
    (h : capped (if fetchBlob L declared then L.blob else 0) [] chunks = some out) : out.length ≤ L.blob := by
  have := capped_within (by simp) h
  split at this <;> omega

/-! ## Examples -/

#guard depth (.array [.array [.uint 1], .map [([1], .null)]]) == 2
#guard capped 4 [] [[1, 2], [3]] == some [1, 2, 3]
#guard capped 4 [] [[1, 2], [3, 4, 5]] == none
#guard segmentFits Limits.defaults (List.replicate 257 1) == false

end Aven.DB.Docs
