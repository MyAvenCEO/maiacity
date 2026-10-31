import Aven.DB.Docs.Body
import Aven.DB.Docs.Limits

/-!
# Segments (docs, rules 11 and 24, "Closing a segment"; caps, "Sealing")

A segment is a writer's closed run of one log in one epoch: Core's `Signed` under `avenDB segment 1`, hybrid-signed by
its writer, then sealed with the `segment` kind (`Aven.ID.Seal`). Its body is
`{to, from, prev, branch, writer, envelopes, generation}`, keys in the codec's order:

- `branch`, `writer`, `generation`: the log it is a run of;
- `from`, `to`: the sequence numbers it covers, half-open as the body's ops are: its first envelope's, and the next
  segment's first;
- `prev`: the name of the writer's segment before it in this log, or null;
- `envelopes`: its envelopes, each the encoding of Core's `Envelope.value`, the same signed bytes, so their names
  stay. A keeper, which sees only sealed bytes, never reads them: a segment's upload names the loose items it covers
  by their sealed hashes, beside the sealed segment and never inside it, and that is the uploader's own word. The
  keeper takes only that device off those items' uploaders, and drops an item once none is left (A44,
  `Aven.Peer.Keeper`).

A segment closes at 256 envelopes or 1 MiB (`Aven.DB.Docs.Limits`), at a rotation of the Doc's epoch (a segment holds
one epoch), or when its writer goes quiet. One hybrid signature covers it.

What it proves: `run_one_log`: a segment that passes `Segment.ok` holds one run of one log, its sequence numbers
`from` to `to`, each envelope naming the one before; `run_bounded`: it holds at most the limit's envelopes.
-/

namespace Aven.DB.Docs

open Aven.Core

private def k (s : String) : Bytes := s.toUTF8.toList

def segmentLabel : Bytes := k "avenDB segment 1"

structure Segment where
  branch : Bytes
  writer : Nat
  generation : Nat
  segFrom : Nat
  segTo : Nat
  prev : Option Hash
  envelopes : List Envelope

/-- The body its writer signs, its keys in the codec's order. -/
def Segment.value (s : Segment) : Value :=
  .map [(k "to", .uint s.segTo), (k "from", .uint s.segFrom), (k "prev", optHash s.prev),
    (k "branch", .text s.branch), (k "writer", .uint s.writer),
    (k "envelopes", .array (s.envelopes.map fun e => .bytes (encode e.value))), (k "generation", .uint s.generation)]

/-- A segment's name: the name of what its writer signs (A30); the next segment's `prev`. -/
def Segment.name (H : Bytes → Hash) (s : Segment) : Hash := H (signingBytes segmentLabel s.value)

/-- A run of one log: every envelope of the segment's Doc branch and writer, sequence numbers from `from` up, each
naming the one before it; a first segment's first envelope starts the log. -/
def runOk (nm : Envelope → Hash) (branch : Bytes) (writer : Nat) : Nat → Option Hash → List Envelope → Bool
  | _, _, [] => true
  | seq, prev, e :: es =>
    e.branch == branch && e.writer == writer && e.seq == seq && (seq == 1 || e.prev == prev || prev.isNone) &&
      runOk nm branch writer (seq + 1) (some (nm e)) es

/-- What a reader checks of a segment it opened: within the limits, not empty, its envelopes one run of its log from
`from`, and `to` past the last. -/
def Segment.ok (L : Limits) (nm : Envelope → Hash) (s : Segment) : Bool :=
  !s.envelopes.isEmpty && s.envelopes.length ≤ L.segmentEnvelopes && s.segTo == s.segFrom + s.envelopes.length &&
    runOk nm s.branch s.writer s.segFrom none s.envelopes

theorem runOk_seqs {nm : Envelope → Hash} {b : Bytes} {w : Nat} :
    ∀ {seq : Nat} {prev : Option Hash} {es : List Envelope}, runOk nm b w seq prev es = true →
      ∀ i (h : i < es.length), es[i].branch = b ∧ es[i].writer = w ∧ es[i].seq = seq + i
  | _, _, [], _, i, h => absurd h (by simp)
  | seq, prev, e :: es, hr, i, h => by
    simp only [runOk, Bool.and_eq_true, beq_iff_eq] at hr
    match i with
    | 0 => exact ⟨hr.1.1.1.1, hr.1.1.1.2, by simpa using hr.1.1.2⟩
    | i + 1 =>
      have := runOk_seqs hr.2 i (by simpa using h)
      simp only [List.getElem_cons_succ]
      exact ⟨this.1, this.2.1, by omega⟩

/-- A segment that checks holds one run of one log: its branch and writer, sequence numbers `from` to `to`. -/
theorem run_one_log {L : Limits} {nm : Envelope → Hash} {s : Segment} (h : s.ok L nm = true) :
    ∀ i (hi : i < s.envelopes.length), s.envelopes[i].branch = s.branch ∧ s.envelopes[i].writer = s.writer ∧
      s.envelopes[i].seq = s.segFrom + i := by
  simp only [Segment.ok, Bool.and_eq_true] at h
  exact runOk_seqs h.2

theorem run_bounded {L : Limits} {nm : Envelope → Hash} {s : Segment} (h : s.ok L nm = true) :
    s.envelopes.length ≤ L.segmentEnvelopes ∧ s.segTo = s.segFrom + s.envelopes.length := by
  simp only [Segment.ok, Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq] at h
  exact ⟨h.1.1.2, h.1.2⟩

#guard keysSorted [(k "to", .null), (k "from", .null), (k "prev", .null), (k "branch", .null), (k "writer", .null),
  (k "envelopes", .null), (k "generation", .null)] = true

end Aven.DB.Docs
