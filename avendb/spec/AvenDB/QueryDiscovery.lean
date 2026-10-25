/-! Bounded discovery hints: abstract contract for the implementation. Authorization
precedes positive-type matching. IDs remain untrusted scheduling hints. -/
namespace AvenDB.QueryDiscovery
structure Entry where
  id : Nat
  type : Nat
  readers : List Nat
  deriving DecidableEq

def authorized (requester : Nat) (entry : Entry) : Bool := requester ∈ entry.readers

def discover (authenticated claimed : Nat) (types : List Nat) (entries : List Entry) : List Entry :=
  if authenticated = claimed then
    ((entries.filter (authorized authenticated)).filter (fun e => e.type ∈ types)).take 64
  else []

theorem identity_bound (a c : Nat) (types : List Nat) (entries : List Entry) (h : a ≠ c) :
    discover a c types entries = [] := by simp [discover, h]

theorem bounded (a c : Nat) (types : List Nat) (entries : List Entry) :
    (discover a c types entries).length ≤ 64 := by
  unfold discover
  split
  · exact List.length_take_le _ _
  · simp

theorem unauthorized_hidden (a : Nat) (types : List Nat) (entries : List Entry) (e : Entry)
    (h : e ∈ discover a a types entries) : a ∈ e.readers := by
  simp only [discover, ↓reduceIte] at h
  have filtered := List.mem_of_mem_take h
  have allowed := (List.mem_filter.mp filtered).1
  simpa [authorized] using (List.mem_filter.mp allowed).2

def completeFromHint (_entries : List Entry) : Bool := false

theorem no_global_completion (entries : List Entry) : completeFromHint entries = false := rfl
-- A prepared hint body can be released only against the exact captured policy identity.
-- Rust uses LogRevision allocation identity; this model abstracts that identity as Nat.
def release (captured current : Nat) (entries : List Entry) : List Entry :=
  if captured = current then entries else []

theorem changed_policy_withholds (captured current : Nat) (entries : List Entry)
    (h : captured ≠ current) : release captured current entries = [] := by
  simp [release, h]
-- Typed inventory operations publish only their explicit positive type set.
-- As with universal queries, this hint changes scheduling, never permission.
def typedDemand (types : List Nat) : List Nat := types.take 8

theorem typed_demand_bounded (types : List Nat) : (typedDemand types).length ≤ 8 :=
  List.length_take_le _ _

theorem typed_demand_does_not_invent_types (types : List Nat) (t : Nat)
    (h : t ∈ typedDemand types) : t ∈ types := List.mem_of_mem_take h

-- Manifest carriers are scheduling candidates, not rows or completeness evidence.
def withCarrier (eligible : Bool) (carrier : Entry) (hints : List Entry) : List Entry :=
  if eligible then carrier :: hints else hints

theorem carrier_preserves_candidates (eligible : Bool) (carrier e : Entry) (hints : List Entry)
    (h : e ∈ hints) : e ∈ withCarrier eligible carrier hints := by
  cases eligible <;> simp_all [withCarrier]

theorem carrier_does_not_confirm_complete (eligible : Bool) (carrier : Entry) (hints : List Entry) :
    completeFromHint (withCarrier eligible carrier hints) = false := rfl

end AvenDB.QueryDiscovery
