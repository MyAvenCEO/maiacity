/-! View demand is a scheduling hint, never evidence of authorization or completeness.
Known entry IDs can be published before unrelated query discovery finishes. A replaced
view cannot publish. These are abstract safety contracts, not wall-clock guarantees. -/
namespace AvenDB.ViewDemand

def hints (current owner : Nat) (known : List Nat) (_discoveryReady : Bool) : List Nat :=
  if current = owner then known.take 512 else []

theorem independent_of_discovery (current owner : Nat) (known : List Nat) :
    hints current owner known false = hints current owner known true := rfl

theorem replaced_view (current owner : Nat) (known : List Nat) (h : current ≠ owner) :
    hints current owner known false = [] := by simp [hints, h]

def visible (authorized : List Nat) (_hints : List Nat) := authorized

theorem demand_does_not_grant (authorized a b : List Nat) :
    visible authorized a = visible authorized b := rfl

def complete (_hints : List Nat) (canonicalComplete : Bool) := canonicalComplete

theorem demand_does_not_complete (ids : List Nat) : complete ids false = false := rfl
-- The implementation deduplicates before truncation; an explicit first ID still
-- precedes learned hints when the lease is full.
def promote (required learned : List Nat) := (required ++ learned).take 512

theorem explicit_first (id : Nat) (learned : List Nat) :
    (promote [id] learned).head? = some id := by simp [promote]

-- Executing a rank starts with its known explicit entries; discovery of lower
-- ranks cannot become a prerequisite. This models ordering, not elapsed time.
def rankWork (explicit discovered : List Nat) := explicit ++ discovered

theorem explicit_prefix_before_discovery (explicit discovered : List Nat) :
    (rankWork explicit discovered).take explicit.length = explicit := by
  simp [rankWork]

end AvenDB.ViewDemand
