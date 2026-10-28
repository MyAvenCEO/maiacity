/-! Foreground entry freshness is required only for explicitly head-conditional
operations. Ordinary local writes never wait for peer catch-up. This model covers
UI scheduling, not local execution latency, durable storage, or authorization;
the unchanged engine must still validate and accept every operation. -/
namespace AvenDB.LocalWrite

def waitsForPeer (hasEntry conditional behind : Bool) : Bool :=
  hasEntry && conditional && behind

theorem ordinary_is_local (hasEntry behind : Bool) :
    waitsForPeer hasEntry false behind = false := by simp [waitsForPeer]

theorem caught_up_is_local (hasEntry conditional : Bool) :
    waitsForPeer hasEntry conditional false = false := by simp [waitsForPeer]

theorem creation_is_local (conditional behind : Bool) :
    waitsForPeer false conditional behind = false := by simp [waitsForPeer]

theorem conditional_behind_still_waits : waitsForPeer true true true = true := rfl

theorem ordinary_peer_independent (hasEntry a b : Bool) :
    waitsForPeer hasEntry false a = waitsForPeer hasEntry false b := by
  simp [waitsForPeer]

-- A local-acceptance API returns only the engine's result. Summary readiness
-- is deliberately not an input; consumers needing a new world use an explicit
-- summary barrier. This does not assert fsync completion or an extracted engine.
def acceptedResult (engineAccepted : Bool) (_summaryReady : Bool) : Bool := engineAccepted

theorem refusal_never_succeeds (summary : Bool) : acceptedResult false summary = false := rfl

theorem acceptance_independent_of_summary (accepted a b : Bool) :
    acceptedResult accepted a = acceptedResult accepted b := rfl

-- Background summaries wait for the reactive dispatch turn. Explicit refresh
-- barriers are separate. This models scheduling only, not OS or engine latency.
def backgroundMayDispatch (reactiveTurnComplete : Bool) : Bool := reactiveTurnComplete

theorem background_waits_for_reactive_turn : backgroundMayDispatch false = false := rfl

theorem background_after_reactive_turn : backgroundMayDispatch true = true := rfl

-- Active collection rows are selected from the same authoritative projection as
-- the full world. Neither mutation arguments nor summary readiness construct rows.
-- Abstract model only: Rust differential tests establish implementation correspondence.
structure SummaryRow where
  entry : Nat
  vault : Nat
  canonicalFields : Nat
  readable : Bool
  deriving DecidableEq

def collection (vault : Nat) (authorized : List SummaryRow) : List SummaryRow :=
  authorized.filter (fun row => row.vault == vault)

theorem collection_preserves_canonical_row (vault : Nat) (authorized : List SummaryRow)
    (row : SummaryRow) (h : row ∈ collection vault authorized) : row ∈ authorized := by
  exact (List.mem_filter.mp h).1

def collectionResult (vault : Nat) (authorized : List SummaryRow) (_summaryReady : Bool) :=
  collection vault authorized

theorem collection_independent_of_summary (vault : Nat) (authorized : List SummaryRow)
    (summaryReadyA summaryReadyB : Bool) :
    collectionResult vault authorized summaryReadyA = collectionResult vault authorized summaryReadyB := rfl

-- Counts use only canonical metadata, not opening each record body.
def metadataCount (rows : List SummaryRow) : Nat := rows.length
def readableCount (rows : List SummaryRow) : Nat := (rows.filter (fun row => row.readable)).length

theorem readable_count_bounded (rows : List SummaryRow) : readableCount rows ≤ metadataCount rows := by
  exact List.length_filter_le _ _

-- A conservative prefilter is allowed only when every canonical match passes it.
-- Rust's todo discriminator corresponds to the shipped plain schema's required kind constant.
theorem safe_candidate_filter (candidate selected : SummaryRow → Bool)
    (safe : ∀ row, selected row = true → candidate row = true) (row : SummaryRow)
    (h : selected row = true) : candidate row && selected row = true := by
  simp [safe row h, h]

-- Explicit IDs narrow the canonical projection, never create authorization.
def selectedEntries (ids : List Nat) (authorized : List SummaryRow) : List SummaryRow :=
  authorized.filter (fun row => ids.contains row.entry)

theorem explicit_entry_preserves_canonical_row (ids : List Nat) (rows : List SummaryRow)
    (row : SummaryRow) (h : row ∈ selectedEntries ids rows) : row ∈ rows := by
  exact (List.mem_filter.mp h).1

def boundedIds (ids : List Nat) : Prop := ids.length ≤ 512

theorem admitted_ids_bounded (ids : List Nat) (admitted : boundedIds ids) : ids.length ≤ 512 := admitted

/-! ## Pending writes: painted at once, gone without a trace when refused (batch 5, W1 and W3)

A page paints a write the moment the person makes it, before the engine answers: what it shows is what the device last
answered (`confirmed`) with the writes still pending laid over it, in the order they were made (`shown`). Laying one
more write over what is shown is one step (`shown_append`), so a paint never waits on the engine, a peer or a reread.
A refused write is taken out of the pending list, and what is shown is then exactly what it was before the write was
made (`refused_leaves_no_trace`). An accepted write stays laid over until the device's own answer holds it; from then
on laying it over changes nothing (`insert_held_is_noop`, `set_held_is_noop`), so it is dropped
(`reconciled_drop_keeps_shown`) and never shows twice. The rows are the records' rows by id, as a room's messages or a
list's items; `insert` adds a row by its id once, `set` changes a row's value. The JavaScript is
`aven/db/page/pending-writes.js`; `vectors/local_writes.json` holds this model's answers for its tests. -/

/-- A row of a record: its id and its value. -/
abbrev Row := Nat × Nat

/-- A write a page lays over what the device answered: a row inserted by its id, or a row's value set. -/
inductive PendingOp where
  | insert (id value : Nat)
  | set (id value : Nat)
  deriving DecidableEq, Repr

/-- A pending write and the number the page gave it when it was made. -/
structure Pending where
  seq : Nat
  op : PendingOp
  deriving DecidableEq, Repr

/-- Whether rows `rows` hold a row with id `id`. -/
def holdsId (rows : List Row) (id : Nat) : Bool := rows.any (fun r => r.1 == id)

/-- One write laid over rows: an insert adds its row at the end unless a row with its id is there already; a set
changes the value of every row with its id. -/
def applyOp : List Row → PendingOp → List Row
  | rows, .insert id v => if holdsId rows id then rows else rows ++ [(id, v)]
  | rows, .set id v => rows.map (fun r => if r.1 == id then (id, v) else r)

/-- What a page shows: the device's answer with every pending write laid over it, oldest first. -/
def shown (confirmed : List Row) (pending : List Pending) : List Row :=
  pending.foldl (fun rows p => applyOp rows p.op) confirmed

/-- W1: a new write is painted by one step over what is shown, never by a reread or an engine turn. -/
theorem shown_append (c : List Row) (ps : List Pending) (p : Pending) :
    shown c (ps ++ [p]) = applyOp (shown c ps) p.op := by
  simp [shown, List.foldl_append]

/-- W1: an inserted row whose id isn't shown yet is shown at once, with its value. -/
theorem insert_painted (c : List Row) (ps : List Pending) (s id v : Nat)
    (fresh : holdsId (shown c ps) id = false) : (id, v) ∈ shown c (ps ++ [⟨s, .insert id v⟩]) := by
  rw [shown_append]
  simp [applyOp, fresh]

/-- Takes the write numbered `s` out of the pending list: what a refusal does. -/
def refuse (s : Nat) (ps : List Pending) : List Pending := ps.filter (fun p => p.seq != s)

/-- W3: a refused write leaves no trace. Its number new when it was made, taking it out shows exactly what was shown
before it was made. -/
theorem refused_leaves_no_trace (c : List Row) (ps : List Pending) (p : Pending)
    (fresh : ∀ q ∈ ps, q.seq ≠ p.seq) : shown c (refuse p.seq (ps ++ [p])) = shown c ps := by
  have keep : ps.filter (fun q => q.seq != p.seq) = ps := by
    rw [List.filter_eq_self]
    intro q hq
    simpa using fresh q hq
  simp [refuse, List.filter_append, keep]

/-- W3: a refusal of the only pending write shows the device's answer as it was. -/
theorem refused_alone_shows_confirmed (c : List Row) (p : Pending) : shown c (refuse p.seq [p]) = c := by
  simp [refuse, shown]

/-- An insert the device's answer already holds changes nothing: accepted, it never shows twice. -/
theorem insert_held_is_noop (rows : List Row) (id v : Nat) (held : holdsId rows id = true) :
    applyOp rows (.insert id v) = rows := by
  simp [applyOp, held]

/-- A set whose value every row with its id already has changes nothing. -/
theorem set_held_is_noop (rows : List Row) (id v : Nat) (held : ∀ r ∈ rows, r.1 = id → r.2 = v) :
    applyOp rows (.set id v) = rows := by
  simp only [applyOp]
  conv => rhs; rw [← List.map_id rows]
  apply List.map_congr_left
  intro r hr
  by_cases h : r.1 = id
  · have := held r hr h
    simp [h]
    cases r
    simp_all
  · simp [h]

/-- An accepted write the device's answer already holds, the oldest still pending, is dropped from the pending list
and what is shown stays the same. -/
theorem reconciled_drop_keeps_shown (c : List Row) (p : Pending) (ps : List Pending) (held : applyOp c p.op = c) :
    shown c (p :: ps) = shown c ps := by
  simp [shown, held]

/-- What the page's pending list is after the device answered the write numbered `s`: refused, it goes; accepted, it
stays until the answer holds it. -/
def settle (accepted : Bool) (s : Nat) (ps : List Pending) : List Pending :=
  if accepted then ps else refuse s ps

theorem settle_refused (s : Nat) (ps : List Pending) : settle false s ps = refuse s ps := rfl

theorem settle_accepted (s : Nat) (ps : List Pending) : settle true s ps = ps := rfl

end AvenDB.LocalWrite
