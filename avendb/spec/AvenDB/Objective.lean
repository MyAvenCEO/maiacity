/-!
# Objectives: what an AIP must deliver, measured

`avendb/docs/ARCHITECTURE.md` §8, "AIPs", the objective stage: between an idea and its proposal an AIP states its
target as one or more metrics, a file of Lean against this module, which `aip_objective` writes on the AIP. While the
AIP is worked on, its author and its vault record readings on it (`aip_measure`), named numbers, and every reader
evaluates the metrics against them: whether each is met, and how far the newest readings moved from the first, the
baseline, toward its target. avenDB's engine (`crates/avendb/src/objective.rs`) runs the same subset of Lean, total
and bounded, and replays `vectors/objectives.json` (`ObjectiveVectors.lean`) to stay this model.

An objective file reads, in Lean:

```lean
import AvenDB.Objective
open AvenDB.Objective

/-- At least 50 frames a second while walking. -/
def fps : Metric := metric "Frames per second" (atLeast (reading "fps") 50)

def objective : List Metric := [fps]
```

- **Numbers** are exact decimals, an integer count of millionths (`Dec`), the same on every device: a literal keeps
  six places, cutting the rest toward zero; `*` and `/` cut their result to six places toward zero (`Int.tdiv`).
  A value beyond `bound` is none, and so is anything a division by zero or a missing reading makes: no device may
  overflow where another doesn't (the Rust engine's 128-bit integers hold every product of two bounded values that
  stays bounded once cut).
- **Expressions** (`Expr`): numbers, `reading "name"`, `+ - * /`, `-x`, `min`, `max`.
- **Goals** (`Goal`): `atLeast e t`, `atMost e t`, `between e lo hi`, `equals e t`.
- **Progress** (`Metric.check`): a metric met is done, `one`; else its distance from what meets it, at the newest
  readings, against that distance at the first readings, both to the targets as they read now, clamped to `0..one`;
  `0` where either is unmeasured, or the baseline was no farther. OB1 to OB3 are proved below.
-/

namespace AvenDB.Objective

/-- One, in millionths. -/
def one : Int := 1000000

/-- The largest magnitude a value may reach, in millionths: 10^24 units. -/
def bound : Int := 10 ^ 30

/-- A decimal: an integer count of millionths. -/
abbrev Dec := Int

/-- `x` where it is within `bound`, else none. -/
def ok (x : Int) : Option Int := if -bound ≤ x ∧ x ≤ bound then some x else none

/-- An expression a metric measures. -/
inductive Expr where
  | num (m : Dec)
  | reading (name : String)
  | add (a b : Expr)
  | sub (a b : Expr)
  | mul (a b : Expr)
  | div (a b : Expr)
  | neg (a : Expr)
  | min (a b : Expr)
  | max (a b : Expr)
  deriving Repr, BEq, Inhabited

instance : OfNat Expr n := ⟨.num (n * one)⟩

/-- `0.8`, `12.5`: six places kept, the rest cut toward zero. `1e3` reads as a number too in Lean; the engine reads
    only plain decimals. -/
instance : OfScientific Expr :=
  ⟨fun m neg e => .num (if neg then Int.tdiv (m * one) (10 ^ e) else m * one * 10 ^ e)⟩

instance : Add Expr := ⟨.add⟩
instance : Sub Expr := ⟨.sub⟩
instance : Mul Expr := ⟨.mul⟩
instance : Div Expr := ⟨.div⟩
instance : Neg Expr := ⟨.neg⟩
instance : Min Expr := ⟨.min⟩
instance : Max Expr := ⟨.max⟩

/-- The newest reading named `name`. -/
def reading (name : String) : Expr := .reading name

/-- What meets a metric. -/
inductive Goal where
  | atLeast (e t : Expr)
  | atMost (e t : Expr)
  | between (e lo hi : Expr)
  | equals (e t : Expr)
  deriving Repr, BEq, Inhabited

def atLeast (e t : Expr) : Goal := .atLeast e t
def atMost (e t : Expr) : Goal := .atMost e t
def between (e lo hi : Expr) : Goal := .between e lo hi
def equals (e t : Expr) : Goal := .equals e t

/-- A metric: its name, as people read it, and its goal. -/
structure Metric where
  name : String
  goal : Goal
  deriving Repr, BEq, Inhabited

def metric (name : String) (goal : Goal) : Metric := ⟨name, goal⟩

/-! ## Evaluation -/

/-- Readings by name, in the order they were recorded. -/
abbrev Readings := List (String × Dec)

/-- The first reading of each name: the baseline. -/
def Readings.first (rs : Readings) (n : String) : Option Dec := (rs.find? (·.1 == n)).map (·.2)

/-- The newest reading of each name. -/
def Readings.newest (rs : Readings) (n : String) : Option Dec := (rs.reverse.find? (·.1 == n)).map (·.2)

/-- An expression's value where every reading it names is in `env`, and nothing on the way leaves `bound`. -/
def Expr.eval (env : String → Option Dec) : Expr → Option Dec
  | .num m => ok m
  | .reading n => env n >>= ok
  | .add a b => do ok ((← a.eval env) + (← b.eval env))
  | .sub a b => do ok ((← a.eval env) - (← b.eval env))
  | .mul a b => do ok (Int.tdiv ((← a.eval env) * (← b.eval env)) one)
  | .div a b => do
      let x ← a.eval env
      let y ← b.eval env
      if y = 0 then none else ok (Int.tdiv (x * one) y)
  | .neg a => do ok (-(← a.eval env))
  | .min a b => do pure (Min.min (← a.eval env) (← b.eval env))
  | .max a b => do pure (Max.max (← a.eval env) (← b.eval env))

/-- What a goal measures. -/
def Goal.measured : Goal → Expr
  | .atLeast e _ | .atMost e _ | .between e _ _ | .equals e _ => e

/-- Its targets, in the order written. -/
def Goal.targets : Goal → List Expr
  | .atLeast _ t | .atMost _ t | .equals _ t => [t]
  | .between _ lo hi => [lo, hi]

/-- How far value `v` is from what meets the goal, its targets `ts` as they read: `0` where it is met. -/
def Goal.distance (g : Goal) (v : Dec) (ts : List Dec) : Option Dec :=
  match g, ts with
  | .atLeast .., [t] => some (Max.max (t - v) 0)
  | .atMost .., [t] => some (Max.max (v - t) 0)
  | .equals .., [t] => some (Int.natAbs (v - t))
  | .between .., [lo, hi] => some (if v < lo then lo - v else if hi < v then v - hi else 0)
  | _, _ => none

/-- `x` within `0..one`. -/
def clamp (x : Int) : Int := Max.max 0 (Min.min one x)

/-- A metric as its readings read. -/
structure Result where
  value : Option Dec
  baseline : Option Dec
  targets : List (Option Dec)
  met : Bool
  progress : Dec
  deriving Repr, BEq

/-- How far the newest readings moved from the baseline toward the goal: `one` once met; else the distance now
    against the distance at the baseline, `0` where either is unmeasured or the baseline was no farther. -/
def progressOf (met : Bool) (now base : Option Dec) : Dec :=
  if met then one else
  match now, base with
  | some d, some d0 => if d0 ≤ d then 0 else clamp (one - Int.tdiv (d * one) d0)
  | _, _ => 0

/-- Metric `m` against readings `rs`. -/
def Metric.check (m : Metric) (rs : Readings) : Result :=
  let g := m.goal
  let value := g.measured.eval rs.newest
  let baseline := g.measured.eval rs.first
  let targets := g.targets.map (·.eval rs.newest)
  let ts := targets.filterMap id
  let whole := ts.length == targets.length
  let now := if whole then value >>= fun v => g.distance v ts else none
  let base := if whole then baseline >>= fun v => g.distance v ts else none
  let met := now == some 0
  { value, baseline, targets, met, progress := progressOf met now base }

/-- An objective against readings: each metric's result, how many are met, and their mean progress. -/
structure Summary where
  results : List Result
  met : Nat
  total : Nat
  progress : Dec
  deriving Repr

def check (ms : List Metric) (rs : Readings) : Summary :=
  let results := ms.map (·.check rs)
  let total := results.length
  let sum := (results.map (·.progress)).foldl (· + ·) 0
  { results, met := (results.filter (·.met)).length, total,
    progress := if total = 0 then 0 else Int.tdiv sum total }

/-! ## What always holds -/

theorem clamp_range (x : Int) : 0 ≤ clamp x ∧ clamp x ≤ one := by
  unfold clamp one; omega

/-- OB1: a metric's progress is between none and all. -/
theorem progress_range (met : Bool) (now base : Option Dec) :
    0 ≤ progressOf met now base ∧ progressOf met now base ≤ one := by
  have whole : (0 : Int) ≤ one ∧ one ≤ one := by unfold one; omega
  have none_ : (0 : Int) ≤ 0 ∧ (0 : Int) ≤ one := by unfold one; omega
  unfold progressOf
  split
  · exact whole
  · split
    · split
      · exact none_
      · exact clamp_range _
    · exact none_

/-- OB2: a metric met is done. -/
theorem met_done (now base : Option Dec) : progressOf true now base = one := by
  simp [progressOf]

/-- OB3: a metric never measured has made no progress, unless met (which needs a value). -/
theorem unmeasured_none (base : Option Dec) : progressOf false none base = 0 := by
  simp [progressOf]

/-- A metric met is one its readings measured: met needs a value now. -/
theorem met_measured (m : Metric) (rs : Readings) (h : (m.check rs).met = true) :
    (m.check rs).value ≠ none := by
  intro hv
  simp only [Metric.check] at h hv
  simp [hv] at h

end AvenDB.Objective
