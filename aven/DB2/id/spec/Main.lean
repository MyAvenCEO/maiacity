import Aven.ID.Json
import Aven.ID.CapsModel

/-! # The running model

`aven-id-model` reads one case per line, a tree and its queries as JSON, a cap chain, who keeps a Doc, a Doc of
envelopes and its revocations, or an envelope's authority, and answers each line with one line (`Aven.ID.Json`,
`Aven.ID.CapsModel`):

```
{"keys":["k"],"vaults":[{"id":"a","name":"A's vault","kind":"person","owners":["key:k"]}],"queries":[["governs","a"],["accounts",null]]}
{"wf":true,"answers":[[],["a"]]}
```

aven-id's property tests compare their answers with these (README rule 10). A tree that is not well formed gets no
answers, and the rule it breaks. -/

open Lean Aven.ID

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  let answer (j : Json) : Except String Json := match CapsModel.answer? j with
    | some a => .ok a
    | none => answerCase j
  let out := match Json.parse line.trimAscii.toString >>= answer with
    | .ok j => j.compress
    | .error e => (Json.mkObj [("error", toJson e)]).compress
  stdout.putStrLn out
  stdout.flush
  loop stdin stdout

def main : IO Unit := do loop (← IO.getStdin) (← IO.getStdout)
