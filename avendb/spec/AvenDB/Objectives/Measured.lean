import AvenDB.Objective
open AvenDB.Objective

namespace Objectives.Measured

/-- The valley sim, run on the proposal by a Measurer of the vault, never the author: at least 50 frames a second. -/
def fps : Metric := metric "Frames per second, measured" (atLeast (measured "fps") 50)

/-- Every reading counts here, the author's too. -/
def claimed : Metric := metric "Frames per second, any reading" (atLeast (reading "fps") 50)

def objective : List Metric := [fps, claimed]

end Objectives.Measured
