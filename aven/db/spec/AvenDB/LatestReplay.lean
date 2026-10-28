/-! Lazy latest-state preparation uses the existing guarded replay implementation.
The safe branch must equal full replay (StoredView V1/V3/V4); otherwise full replay
is mandatory. This wrapper does not prove Rust prefix maintenance or complexity. -/
namespace AvenDB.LatestReplay

def prepare (safe : Bool) (advanced full : State) : State :=
  if safe then advanced else full

theorem equivalent (safe : Bool) (advanced full : State)
    (guard : safe = true → advanced = full) :
    prepare safe advanced full = full := by
  cases safe <;> simp_all [prepare]

theorem unsafe_falls_back (advanced full : State) :
    prepare false advanced full = full := by rfl

-- OnceLock publication is only for the current held log. Appending invalidates it;
-- withdrawal resets the maintained prefix; restore replaces the Store entirely.
end AvenDB.LatestReplay
