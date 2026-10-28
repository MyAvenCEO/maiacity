import AvenDB.StoredReadings
import AvenDB.Json

/-!
# Stored readings vectors

`vectors/stored_readings.json`, what the model of `StoredReadings.lean` answers, for the Rust engine to replay
(`crates/avendb/tests/read_rules.rs`): the read rules' number, and for a stored view whose readings were sealed under
some rules, whether a device opening it reads on from them (`on`) or reads every body anew (`whole`), and that either
way it reads what reading every body anew reads.
-/

namespace AvenDB.StoredReadingsVectors

open AvenDB.Json AvenDB.StoredReadings

/-- A body's metadata as a number, and reading one: a sum, so that reading checks what it read. -/
def readBody (r m : Nat) : Nat := r + m

/-- How a device reads as it opens a view sealed under `rules`. -/
def how (rules : Nat) : String := if rules = readRules then "on" else "whole"

def case (name : String) (rules : Nat) : String :=
  let (held, since) := ([1, 2, 3], [4, 5])
  let s : Sealed Nat := ⟨rules, held⟩
  obj [("name", str name), ("sameRules", bool (rules == readRules)), ("reads", str (how rules)),
       ("readsAsAnew", bool (opensRead readBody id 0 s held since == read readBody id 0 (held ++ since)))]

def cases : List String :=
  [ case "sealed under these read rules" readRules,
    case "sealed under other read rules" (readRules + 1) ]

def render : String :=
  obj [("readRules", nat readRules), ("cases", arr cases)] ++ "\n"

#guard how (readRules + 1) == "whole"

end AvenDB.StoredReadingsVectors
