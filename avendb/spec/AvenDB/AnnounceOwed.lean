/-! Coalesced scheduling only; holdings and authorization are recomputed by the ordinary announcer. -/
namespace AvenDB.AnnounceOwed
-- Missing map entry means idle. An active entry's Boolean is one coalesced obligation.
def skipped (_owed : Bool) : Bool := true
def wake (success owed : Bool) : Bool := success && owed
theorem skipped_coalesces (owed : Bool) : skipped (skipped owed) = skipped owed := rfl
theorem successful_owed_wakes : wake true (skipped false) = true := rfl
theorem failure_keeps_backoff (owed : Bool) : wake false owed = false := rfl
theorem no_idle_loop : wake true false = false := rfl
end AvenDB.AnnounceOwed
