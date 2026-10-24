/-! A receipt reports the authenticated peer's policy outcome at observation time.
It does not grant authority, prove durable storage, or prove a rendered frame.
The transport supplies authenticated identity/connection and nonce equality; Rust
bounds pending observations and uses one origin monotonic clock for durations. -/
namespace AvenDB.PeerReceipt

def matched (identity connection nonce edit fresh : Bool) : Bool :=
  identity && connection && nonce && edit && fresh

def reportable (authorized current materialized : Bool) : Bool :=
  authorized && current && materialized

theorem receipt_requires_current_permission (current materialized : Bool) :
    reportable false current materialized = false := by simp [reportable]

theorem stale_replay_cannot_report (authorized materialized : Bool) :
    reportable authorized false materialized = false := by simp [reportable]

theorem wrong_connection_cannot_complete (identity nonce edit fresh : Bool) :
    matched identity false nonce edit fresh = false := by simp [matched]

theorem expired_cannot_complete (identity connection nonce edit : Bool) :
    matched identity connection nonce edit false = false := by simp [matched]

def access (permission : Bool) (_receipt : Option Bool) : Bool := permission

theorem receipt_grants_no_authority (receipt : Option Bool) : access false receipt = false := rfl
end AvenDB.PeerReceipt
