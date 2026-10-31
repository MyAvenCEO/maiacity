import Aven.DB.Json

/-!
# The model runs (README, rule 10)

`aven-db-model` replays traces, one JSON object per line on stdin, and writes the state after every event, one JSON
object per line on stdout (`Aven.DB.Json`). `aven-gen1`'s tests generate random traces and compare the Rust machines
with this; `aven-db-store`'s compare its memory store, call by call, when a line has `store`.

    in:  {"limit": 3, "status": ["dial", "frame", "tick", "lost"], "presence": [["join", 1], ["leave", 1]]}
    out: {"status": [{"phase": "connecting", "moved": 0, "idle": 0}, …], "presence": [[1], []]}
    in:  {"store": [["put", "6162"], ["list"]]}
    out: {"store": [{"ok": "<hash>"}, {"ok": ["<hash>"]}]}
-/

open Lean Aven.DB

def replay (line : String) : Except String Json := do
  let j ← Json.parse line
  let limit := (j.getObjValAs? Nat "limit").toOption.getD 1
  let events ← ((j.getObjValD "status").getArr?.toOption.getD #[]).toList.mapM fun e => do parseEvent (← e.getStr?)
  let changes ← ((j.getObjValD "presence").getArr?.toOption.getD #[]).toList.mapM parseChange
  let ops ← ((j.getObjValD "store").getArr?.toOption.getD #[]).toList.mapM Store.parseOp
  let statuses := trail (Status.step limit) Status.start events
  let presences := trail Presence.step Presence.empty changes
  pure <| Json.mkObj [
    ("status", Json.arr (statuses.map Status.json).toArray),
    ("presence", Json.arr (presences.map fun p => toJson p.told).toArray),
    ("store", Store.replay ops)]

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO UInt32 := do
  let line ← stdin.getLine
  if line.isEmpty then return 0
  if line.trimAscii.isEmpty then return ← loop stdin stdout
  match replay line with
  | .ok out => stdout.putStrLn out.compress; stdout.flush; loop stdin stdout
  | .error e => IO.eprintln s!"aven-db-model: {e}"; return 1

def main : IO UInt32 := do
  loop (← IO.getStdin) (← IO.getStdout)
