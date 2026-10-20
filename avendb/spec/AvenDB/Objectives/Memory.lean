import AvenDB.Objective
open AvenDB.Objective

namespace Objectives.Memory

/- What the world streaming must keep: the heap well under its budget,
   /- a nested comment -/ and the frame time steady. -/

-- the heap's share of its budget
def heapShare : Expr := reading "heap_mb" / reading "budget_mb"

/-- The heap takes at most 80 % of its budget. -/
def memory : Metric := metric "Heap share of budget" (atMost heapShare 0.8)

/-- Frame time between 8.3 and 16.7 ms, the worse of two scenes. -/
def frame : Metric :=
  metric "Frame time, ms" (between (max (reading "frame_a_ms") (reading "frame_b_ms")) 8.3 16.7)

/-- Exactly three settlers, after one leaves: arithmetic and a minus. -/
def settlers : Metric := metric "Settlers" (equals (reading "settlers" - 1) 3)

/-- A drift that should stay small either way. -/
def drift : Metric := metric "Drift" (atMost (max (reading "drift") (-(reading "drift"))) 0.25)

/-- Saved share of the old cost, by product and sum. -/
def saving : Metric :=
  metric "Saving" (atLeast ((reading "old" - reading "new") * 100 / reading "old") 30.5)

def objective : List Metric := [memory, frame, settlers, drift, saving]

end Objectives.Memory
