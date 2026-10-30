import Aven.ID
import Lean.Data.Json

/-! # The running model

`aven-id-model` reads one case per line, a tree and its queries as JSON, and answers each line with one line:

```
{"keys":["k"],"vaults":[{"id":"a","kind":"person","owners":["key:k"]}],"queries":[["governs","a"],["accounts",null]]}
{"wf":true,"answers":[[],["a"]]}
```

aven-id's property tests compare their answers with these (README rule 10). A tree that is not well formed gets no
answers. -/

open Lean Aven.ID

def parseKind : String → Except String Kind
  | "person" => .ok .person
  | "network" => .ok .network
  | "device" => .ok .device
  | k => .error s!"unknown kind {k}"

def parseOwner (s : String) : Except String Owner :=
  if s.startsWith "key:" then .ok (.key (s.drop 4).toString)
  else if s.startsWith "vault:" then .ok (.vault (s.drop 6).toString)
  else .error s!"unknown owner {s}"

def parseVault (j : Json) : Except String Vault := do
  let id ← j.getObjValAs? String "id"
  let kind ← parseKind (← j.getObjValAs? String "kind")
  let owners ← (← j.getObjValAs? (List String) "owners").mapM parseOwner
  pure ⟨id, kind, owners⟩

def answer (t : Tree) (q : Json) : Except String Json := do
  let args ← q.getArr?
  let arg (i : Nat) : Except String String := (args[i]?.getD Json.null).getStr?
  match ← arg 0 with
  | "owned" => pure (toJson (t.owned (← arg 1)))
  | "governs" => pure (toJson (t.governs (← arg 1)))
  | "chain" => pure (toJson (t.chain (← arg 1)))
  | "actsFor" => pure (toJson (t.actsFor (← arg 1)))
  | "actsThrough" => pure (toJson (t.actsThrough (← arg 1)))
  | "accounts" => pure (toJson (t.accounts (arg 1).toOption))
  | "sees" => pure (toJson (t.sees (← arg 1)))
  | "mayActOn" => pure (toJson (t.mayActOn (← arg 1) (← arg 2)))
  | q => throw s!"unknown query {q}"

def run (line : String) : Except String Json := do
  let j ← Json.parse line
  let keys ← j.getObjValAs? (List String) "keys"
  let vaults ← (← j.getObjValAs? (Array Json) "vaults").toList.mapM parseVault
  let t : Tree := ⟨keys, vaults⟩
  let wf := decide t.WF
  let answers ← if wf then (← j.getObjValAs? (Array Json) "queries").mapM (answer t) else pure #[]
  pure (Json.mkObj [("wf", toJson wf), ("answers", Json.arr answers)])

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  let out := match run line.trimAscii.toString with
    | .ok j => j.compress
    | .error e => (Json.mkObj [("error", toJson e)]).compress
  stdout.putStrLn out
  stdout.flush
  loop stdin stdout

def main : IO Unit := do loop (← IO.getStdin) (← IO.getStdout)
