import AvenDB.Objective
open AvenDB.Objective

namespace Objectives.Start

/-- V1 shows its first frame within 1.5 s on the 8 GB Mac. -/
def firstFrame : Metric := metric "First frame, ms" (atMost (reading "first_frame_ms") 1500)

/-- At least 50 frames a second while walking. -/
def fps : Metric := metric "Frames per second" (atLeast (reading "fps") 50)

def objective : List Metric := [firstFrame, fps]

end Objectives.Start
