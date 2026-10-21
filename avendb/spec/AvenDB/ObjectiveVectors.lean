import AvenDB.Objective
import AvenDB.Measurers
import AvenDB.Objectives.Start
import AvenDB.Objectives.Memory
import AvenDB.Objectives.Unmeasured
import AvenDB.Objectives.Lines
import AvenDB.Objectives.Measured

/-!
# Objective vectors

`vectors/objectives.json`, the cases the Rust engine replays (`crates/avendb/tests/objective.rs`): each an objective
file of Lean, its text as `include_str` reads it, the very file Lean elaborated here, so the text and the metrics are
one; the metrics as the model holds them (`Expr`, `Goal`, `Metric`, numbers in millionths); readings, each a name and
a value in millionths, in the order recorded, and those of them a Measurer wrote; the numbers found at the paths it
names in the proposal and on main; the measuring logic it names, in file order; and what `check` answers. Beside
them, `verdicts`: a Measurer's readings, oldest first, an objective's key and the Lean verdict they give it
(`leanVerdict`).
-/

namespace AvenDB.ObjectiveVectors

open AvenDB.Objective

/-- A JSON string: quotes, backslashes and the control characters a file holds, escaped. -/
def jstr (s : String) : String :=
  let esc : Char → String
    | '"' => "\\\""
    | '\\' => "\\\\"
    | '\n' => "\\n"
    | '\t' => "\\t"
    | '\r' => "\\r"
    | c => c.toString
  "\"" ++ String.join (s.toList.map esc) ++ "\""

def arr (xs : List String) : String := "[" ++ ", ".intercalate xs ++ "]"
def obj (kvs : List (String × String)) : String :=
  "{" ++ ", ".intercalate (kvs.map fun (k, v) => jstr k ++ ": " ++ v) ++ "}"
def int (n : Int) : String := toString n
def opt (f : α → String) : Option α → String
  | some x => f x
  | none => "null"

def expr : Expr → String
  | .num m => obj [("num", int m)]
  | .reading n => obj [("reading", jstr n)]
  | .measured n => obj [("measured", jstr n)]
  | .proposed p => obj [("proposed", jstr p)]
  | .current p => obj [("current", jstr p)]
  | .add a b => obj [("add", arr [expr a, expr b])]
  | .sub a b => obj [("sub", arr [expr a, expr b])]
  | .mul a b => obj [("mul", arr [expr a, expr b])]
  | .div a b => obj [("div", arr [expr a, expr b])]
  | .neg a => obj [("neg", expr a)]
  | .min a b => obj [("min", arr [expr a, expr b])]
  | .max a b => obj [("max", arr [expr a, expr b])]

def goal : Goal → String
  | .atLeast e t => obj [("atLeast", arr [expr e, expr t])]
  | .atMost e t => obj [("atMost", arr [expr e, expr t])]
  | .between e lo hi => obj [("between", arr [expr e, expr lo, expr hi])]
  | .equals e t => obj [("equals", arr [expr e, expr t])]

def metric (m : Metric) : String := obj [("name", jstr m.name), ("goal", goal m.goal)]

def result (r : Result) : String :=
  obj [("value", opt int r.value), ("baseline", opt int r.baseline), ("targets", arr (r.targets.map (opt int))),
       ("met", if r.met then "true" else "false"), ("progress", int r.progress)]

def summary (s : Summary) : String :=
  obj [("metrics", arr (s.results.map result)), ("met", toString s.met), ("total", toString s.total),
       ("progress", int s.progress)]

/-- `n` units, in millionths. -/
def u (n : Int) : Int := n * one

structure Case where
  name : String
  lean : String
  metrics : List Metric
  readings : Readings
  measured : Readings := []
  proposed : Fields := []
  current : Fields := []
  measures : List Measure := []

def named (key : String) (xs : List (String × Int)) : String :=
  arr (xs.map fun (n, v) => obj [(key, jstr n), ("value", int v)])

def case (c : Case) : String :=
  obj [("name", jstr c.name), ("lean", jstr c.lean), ("metrics", arr (c.metrics.map metric)),
       ("readings", named "name" c.readings), ("measured", named "name" c.measured),
       ("proposed", named "path" c.proposed), ("current", named "path" c.current),
       ("measures", arr (c.measures.map (jstr ·.logic))),
       ("result", summary (check c.metrics ⟨c.readings, c.measured, c.proposed, c.current⟩))]

def cases : List Case := [
  { name := "a start: one met, one on its way",
    lean := include_str "Objectives/Start.lean",
    metrics := Objectives.Start.objective,
    readings := [("first_frame_ms", u 2400), ("fps", u 30), ("first_frame_ms", u 1400), ("fps", u 42)] },
  { name := "a start, nothing measured yet",
    lean := include_str "Objectives/Start.lean",
    metrics := Objectives.Start.objective,
    readings := [] },
  { name := "memory: names, decimals, between, equals, minus, product and quotient",
    lean := include_str "Objectives/Memory.lean",
    metrics := Objectives.Memory.objective,
    readings := [("heap_mb", u 900), ("budget_mb", u 1000), ("frame_a_ms", u 20), ("frame_b_ms", u 10),
                 ("settlers", u 5), ("drift", -500000), ("old", u 200), ("new", u 150),
                 ("heap_mb", u 700), ("frame_a_ms", u 15), ("frame_b_ms", u 18), ("settlers", u 4),
                 ("drift", -300000)] },
  { name := "unmeasured: missing, by zero, beyond the bound, worse, flat, fine digits",
    lean := include_str "Objectives/Unmeasured.lean",
    metrics := Objectives.Unmeasured.objective,
    readings := [("a", u 4), ("zero", 0), ("big", u 10000000000000), ("falling", u 8), ("falling", u 5)] },
  { name := "lines: the proposal's numbers against main's, a new field, and a reading beside",
    lean := include_str "Objectives/Lines.lean",
    metrics := Objectives.Lines.objective,
    readings := [("ripe_day", u 140), ("ripe_day", u 130)],
    proposed := [("params.#1.default", 700000), ("engine.version", u 5), ("params.#2.default", u 15)],
    current := [("params.#1.default", 600000), ("engine.version", u 4)] },
  { name := "lines: a path the proposal doesn't hold stays unmeasured",
    lean := include_str "Objectives/Lines.lean",
    metrics := Objectives.Lines.objective,
    readings := [],
    proposed := [("engine.version", u 6)],
    current := [("params.#1.default", 600000), ("engine.version", u 4)] },
  { name := "measured: the author's reading counts as a reading, never as measured",
    lean := include_str "Objectives/Measured.lean",
    metrics := Objectives.Measured.objective,
    readings := [("fps", u 60), ("fps", u 30), ("fps", u 40)],
    measured := [("fps", u 30), ("fps", u 40)],
    measures := [Objectives.Measured.sim] },
  { name := "measured: no Measurer has measured yet",
    lean := include_str "Objectives/Measured.lean",
    metrics := Objectives.Measured.objective,
    readings := [("fps", u 60)],
    measures := [Objectives.Measured.sim] }
]

-- Every vector names its measuring logic as a ref may (`Measure.named`).
#guard cases.all (·.measures.all Measure.named)

/-- A Lean verdict's case: readings a vault's Measurers wrote, oldest first, and the objective's key. -/
structure Verdict where
  name : String
  measured : Readings
  key : String

def verdictCase (c : Verdict) : String :=
  obj [("name", jstr c.name), ("measured", named "name" c.measured), ("key", jstr c.key),
       ("verdict", opt (fun b => if b then "true" else "false") (leanVerdict c.measured c.key))]

def verdicts : List Verdict := [
  { name := "none measured yet", measured := [], key := "0123456789abcdef" },
  { name := "Lean accepted it", measured := [("fps", u 40), ("lean:0123456789abcdef", u 1)], key := "0123456789abcdef" },
  { name := "the newest stands: accepted, then not",
    measured := [("lean:0123456789abcdef", u 1), ("fps", u 40), ("lean:0123456789abcdef", 0)],
    key := "0123456789abcdef" },
  { name := "a reading for another objective is no verdict on this one",
    measured := [("lean:fedcba9876543210", u 1)], key := "0123456789abcdef" },
  { name := "any value but one is a no", measured := [("lean:0123456789abcdef", u 2)], key := "0123456789abcdef" }
]

def render : String := obj [("cases", arr (cases.map case)), ("verdicts", arr (verdicts.map verdictCase))] ++ "\n"

end AvenDB.ObjectiveVectors
