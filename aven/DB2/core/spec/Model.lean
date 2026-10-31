import Aven.Core.Model

/-! # The running model

`aven-core-model` reads one case per line and answers each with one line (`Aven.Core.Model`): a world of envelopes,
in CBOR as hex, with which a reader holds, which are bad and a version's tips, or bytes to accept.

```
{"envelopes":["a963…"],"held":[true],"bad":[],"tips":[0]}
{"names":["b3:…"],"past":[[]],"inPast":[[false]],"split":[[false]],"discounted":[false],"counts":[true],
 "holds":[true]}
```

aven-core's property tests compare their answers with these (README rule 10). -/

open Lean Aven.Core.Model

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  let out := match Json.parse line.trimAscii.toString >>= answerCase with
    | .ok j => j.compress
    | .error e => (Json.mkObj [("error", toJson e)]).compress
  stdout.putStrLn out
  stdout.flush
  loop stdin stdout

def main : IO Unit := do loop (← IO.getStdin) (← IO.getStdout)
