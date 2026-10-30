import Aven.Architecture
import Lean.Data.Json

/-!
# The rules as data

`lake exe vectors [DIR]` writes `rules.json`: for each rule across all parts, the theorems that compose it, what they
rest on in the parts' models, and what is still missing (`Aven.Architecture.Gaps`).
-/

open Lean Aven.Architecture

def Aven.Architecture.RuleStatus.json (r : RuleStatus) : Json :=
  Json.mkObj [("rule", toJson r.rule), ("title", r.title), ("theorems", toJson r.theorems),
    ("restsOn", toJson r.restsOn), ("missing", toJson r.missing)]

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  IO.FS.writeFile (dir / "rules.json") ("[\n" ++ ",\n".intercalate (rules.map (·.json.compress)) ++ "\n]\n")
