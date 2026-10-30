import Aven.ID.Json
import Aven.ID.Gen

/-! # The test vectors (README, rule 10)

`lake exe vectors [DIR]` writes the examples and generated cases as JSON, one vector per line, into `DIR`
(`vectors/` by default), where they are committed. Every vector is `{"name", "input", "expected"}`:

- `trees.json`: a tree and its queries as input, the model's result as expected: the cast's examples, the trees that
  break a rule, input that is not a tree, every query on the cast, and generated trees. aven-id's tests and its wasm
  check load it.
- `statements.json`: the cast's devices signing (`Aven.ID.Sign`): who signs what with which key, what is changed
  before verifying, and the answers. aven-id's tests sign and verify with real keys and compare.
- `avenos.json`: what avenOS shows on the cast (`Aven.ID.OS`), for `sandbox/check.mjs`.

`bun run up --check` runs it again and fails when the files differ from what is committed. -/

open Lean Aven.ID

def vector (name : String) (input expected : Json) : Json :=
  Json.mkObj [("name", name), ("input", input), ("expected", expected)]

def treeVector (name : String) (t : Tree) (qs : List Query) : Json :=
  vector name (Json.mkObj [("keys", toJson t.keys), ("vaults", (t.json.getObjValD "vaults")),
    ("queries", Json.arr (qs.map Query.json).toArray)]) (t.result qs)

/-- Input that is not a tree: an unknown kind, an owner without its prefix. -/
def formatVectors : List Json :=
  let input (kind owner : String) := Json.mkObj [("keys", toJson ["k"]), ("vaults", Json.arr #[Json.mkObj
    [("id", "a"), ("kind", kind), ("owners", toJson [owner])]]), ("queries", Json.arr #[])]
  [("an unknown kind", input "ghost" "key:k"), ("an owner that is neither key: nor vault:", input "person" "k")].map
    fun (name, i) => vector name i (match answerCase i with | .ok j => j | .error e => toJson e)

def generated : Nat := 80

def trees : List Json :=
  [treeVector "the cast: SANDBOX.md's examples" cast ((castExamples ++ mayActOnExamples).map (·.1))] ++
  invalidExamples.map (fun (name, t, _) => treeVector name t (if t.check.isNone then t.everyQuery else [])) ++
  formatVectors ++
  [treeVector "the cast: every query" cast cast.everyQuery] ++
  (List.range generated).map fun i =>
    let t := randomTree (i + 1)
    treeVector s!"generated tree, seed {i + 1}" t t.everyQuery

def avenos : List Json :=
  let people := cast.accounts none
  (hosts.map fun (host, h) => vector s!"{host} may act as" (Json.mkObj [("accounts", host)])
    (toJson (cast.hostAccounts h))) ++
  (people.map fun (p : String) => vector s!"{p}'s Control Room" (Json.mkObj [("sees", p)]) (toJson (cast.sees p))) ++
  (vaultExamples.map fun ((a, target), _) =>
    let shown := cast.opens a (target.getD a)
    vector s!"{a}'s Vault at {target.getD a}" (Json.mkObj [("vault", a), ("target", toJson target)])
      (Json.mkObj [("opens", shown), ("tree", toJson (cast.vaultView a (target.getD a))),
        ("actsThrough", toJson (cast.actsThrough shown))])) ++
  (hosts.filterMap fun (_, h) => match h with
    | .device d => some (vector s!"{d} serves" (Json.mkObj [("serves", d)]) (toJson (cast.actsFor d)))
    | _ => none)

def statements : List Json :=
  signExamples.map fun e =>
    let (input, expected) := e.vector
    vector e.name input expected

/-- One vector per line, so a change reads as a diff of lines. -/
def render (vs : List Json) : String :=
  "[\n" ++ ",\n".intercalate (vs.map Json.compress) ++ "\n]\n"

def main (args : List String) : IO Unit := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  IO.FS.writeFile (dir / "trees.json") (render trees)
  IO.FS.writeFile (dir / "statements.json") (render statements)
  IO.FS.writeFile (dir / "avenos.json") (render avenos)
