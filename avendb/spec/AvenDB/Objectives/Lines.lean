import AvenDB.Objective
open AvenDB.Objective

namespace Objectives.Lines

/-- The valley's corn grows at least 0.8 m tall, as the proposal sets it. -/
def height : Metric := metric "Corn height, m" (atLeast (proposed "params.#1.default") 0.8)

/-- The rules move up exactly one engine version. -/
def step : Expr := proposed "engine.version" - current "engine.version"
def engine : Metric := metric "Engine versions up" (equals step 1)

/-- A new field main doesn't hold yet: no baseline, so met or nothing. -/
def water : Metric := metric "Water a week, l" (between (proposed "params.#2.default") 10 20)

/-- Ripe within 120 days, as measured. -/
def ripe : Metric := metric "Day the corn is ripe" (atMost (reading "ripe_day") 120)

def objective : List Metric := [height, engine, water, ripe]

end Objectives.Lines
