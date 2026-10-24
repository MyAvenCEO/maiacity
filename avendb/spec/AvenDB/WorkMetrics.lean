/-! Reading accumulated work metrics must not reconstruct or mutate authoritative state.
The executable boundary projects already-recorded timers/counters; it performs no
policy resolution. This model specifies that observation, not startup latency. -/
namespace AvenDB.WorkMetrics
structure Store (State Metrics : Type) where
  state : State
  metrics : Metrics

def observe (s : Store State Metrics) : Metrics × Store State Metrics :=
  (s.metrics, s)

theorem preserves_state (s : Store State Metrics) : (observe s).2 = s := rfl

theorem returns_recorded (s : Store State Metrics) : (observe s).1 = s.metrics := rfl

theorem repeatable (s : Store State Metrics) :
    observe (observe s).2 = observe s := rfl
end AvenDB.WorkMetrics
