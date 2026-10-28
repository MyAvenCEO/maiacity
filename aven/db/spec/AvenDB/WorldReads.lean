/-! Generic world-summary scheduling. A request receives an increasing ticket.
A snapshot captures the latest requested ticket when it starts. Completion may
satisfy only tickets up to that captured value, so an explicit refresh never
joins a snapshot that started before it was requested. One active read per device.
This models scheduling, not engine snapshot consistency or wall-clock latency. -/
namespace AvenDB.WorldReads

def covers (started ticket : Nat) : Prop := ticket ≤ started

theorem later_request_waits (started : Nat) : ¬ covers started (started + 1) := by
  simp [covers]

theorem started_request_covered (ticket : Nat) : covers ticket ticket := Nat.le_refl _

theorem previous_requests_coalesce (earlier latest : Nat) (h : earlier ≤ latest) :
    covers latest earlier := h

def mayStart (running : Bool) : Bool := !running

theorem active_read_cannot_start_another : mayStart true = false := rfl

theorem idle_read_can_start : mayStart false = true := rfl

end AvenDB.WorldReads
