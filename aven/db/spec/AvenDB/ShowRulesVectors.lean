import AvenDB.ShowRules
import AvenDB.Json

/-!
# Show rules vectors

`vectors/show_rules.json`, what the model of `ShowRules.lean` answers, for the Rust engine to replay
(`crates/avendb/tests/show_rules.rs`): the show rules' number, and for a pack of kept showings sealed by one build under
these rules and opened by a build, whether the device takes an entry's kept showing (`kept`) or judges it anew
(`judged`): the same build, another build, and another build after a write to the entry.
-/

namespace AvenDB.ShowRulesVectors

open AvenDB.Json AvenDB.ShownView AvenDB.ShowRules

/-- An entry's inputs of `n` writes, all opened, in one lane under one set of cap groups. -/
def inputs (n : Nat) : Inputs Nat Nat Nat := { writes := List.range n, opened := fun _ => true, lane := 0, groups := 0 }

/-- Its print: the writes it holds. -/
def print (i : Inputs Nat Nat Nat) : Nat := i.writes.length

/-- What the device takes of an entry whose inputs are `now`, of what it finds sealed. -/
def takes (s : Sealed Nat Nat) (now : Inputs Nat Nat Nat) : String :=
  match opensKept s with
  | some k => if k.print = print now then "kept" else "judged"
  | none => "judged"

def case (name : String) (sealedBy openedBy written : Nat) : String :=
  let s : Sealed Nat Nat := ⟨showRules, sealedBy, ⟨print (inputs 3), 0⟩⟩
  obj [("name", str name), ("sameBuild", bool (sealedBy == openedBy)), ("writtenSince", nat written),
       ("takes", str (takes s (inputs (3 + written))))]

def cases : List String :=
  [ case "the build that sealed it" 1 1 0,
    case "another build" 1 2 0,
    case "another build, a write to the entry since" 1 2 1 ]

def render : String :=
  obj [("showRules", nat showRules), ("cases", arr cases)] ++ "\n"

#guard takes ⟨showRules + 1, 1, ⟨3, 0⟩⟩ (inputs 3) == "judged"

end AvenDB.ShowRulesVectors
