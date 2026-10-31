import Aven.Peer

/-!
# The model runs (README, rule 10)

`aven-peer-model` replays presence traces, one JSON object per line on stdin, and writes what every peer is told after
every change, one JSON object per line on stdout (`Aven.Peer.Json`). `aven-peer-wire`'s tests generate random traces
and compare the Rust machine with this.

    in:  {"presence": [["join", 1], ["leave", 1]]}
    out: {"presence": [[1], []]}
-/

open Lean Aven.Peer

def replay (line : String) : Except String Json := do
  let j ← Json.parse line
  let changes ← ((j.getObjValD "presence").getArr?.toOption.getD #[]).toList.mapM parseChange
  let presences := trail Presence.step Presence.empty changes
  pure <| Json.mkObj [("presence", Json.arr (presences.map fun p => toJson p.told).toArray)]

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO UInt32 := do
  let line ← stdin.getLine
  if line.isEmpty then return 0
  if line.trimAscii.isEmpty then return ← loop stdin stdout
  match replay line with
  | .ok out => stdout.putStrLn out.compress; stdout.flush; loop stdin stdout
  | .error e => IO.eprintln s!"aven-peer-model: {e}"; return 1

def main : IO UInt32 := do
  loop (← IO.getStdin) (← IO.getStdout)
