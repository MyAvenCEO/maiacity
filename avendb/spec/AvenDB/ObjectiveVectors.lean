import AvenDB.Objective
import AvenDB.Objectives.Start
import AvenDB.Objectives.Memory
import AvenDB.Objectives.Unmeasured
import AvenDB.Objectives.Lines

/-!
# Objective vectors

`vectors/objectives.json`, the cases the Rust engine replays (`crates/avendb/tests/objective.rs`): each an objective
file of Lean, its text as `include_str` reads it, the very file Lean elaborated here, so the text and the metrics are
one; the metrics as the model holds them (`Expr`, `Goal`, `Metric`, numbers in millionths); readings, each a name and
a value in millionths, in the order recorded; the numbers found at the paths it names in the proposal and on main;
and what `check` answers.
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
  proposed : Fields := []
  current : Fields := []

def named (key : String) (xs : List (String × Int)) : String :=
  arr (xs.map fun (n, v) => obj [(key, jstr n), ("value", int v)])

def case (c : Case) : String :=
  obj [("name", jstr c.name), ("lean", jstr c.lean), ("metrics", arr (c.metrics.map metric)),
       ("readings", named "name" c.readings), ("proposed", named "path" c.proposed),
       ("current", named "path" c.current),
       ("result", summary (check c.metrics ⟨c.readings, c.proposed, c.current⟩))]

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
    current := [("params.#1.default", 600000), ("engine.version", u 4)] }
]

def render : String := obj [("cases", arr (cases.map case))] ++ "\n"

end AvenDB.ObjectiveVectors
