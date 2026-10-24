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
end AvenDB.QueryDiscovery
