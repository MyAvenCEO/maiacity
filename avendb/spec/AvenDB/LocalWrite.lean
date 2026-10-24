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

end AvenDB.LocalWrite
