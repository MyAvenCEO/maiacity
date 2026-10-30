import Aven
import Lean.Data.Json

/-!
# The model runs (README, rule 10)

`aven-db-model` replays traces, one JSON object per line on stdin, and writes the state after every event, one JSON
object per line on stdout. `aven-db-core`'s tests generate random traces and compare the Rust machines with this.

    in:  {"limit": 3, "status": ["dial", "frame", "tick", "lost"], "presence": [["join", 1], ["leave", 1]]}
    out: {"status": [{"phase": "connecting", "moved": 0, "idle": 0}, …], "presence": [[1], []]}
-/

open Lean Aven.DB

def event : String → Except String Event
  | "dial" => pure .dial
  | "frame" => pure .frame
  | "tick" => pure .tick
  | "lost" => pure .lost
  | e => throw s!"unknown status event {e}"

def change (j : Json) : Except String Change := do
  let arr ← j.getArr?
  let kind ← (arr[0]?.getD Json.null).getStr?
  let p ← (arr[1]?.getD Json.null).getNat?
  match kind with
  | "join" => pure (.join p)
  | "leave" => pure (.leave p)
  | k => throw s!"unknown presence change {k}"

def statusJson (s : Status) : Json :=
  Json.mkObj [("phase", s.phase.name), ("moved", s.moved), ("idle", s.idle)]

/-- Every state a fold passes through, after each step. -/
def trail {σ α : Type} (step : σ → α → σ) (s : σ) : List α → List σ
  | [] => []
  | a :: as => let s' := step s a; s' :: trail step s' as

def replay (line : String) : Except String Json := do
  let j ← Json.parse line
  let limit ← j.getObjValAs? Nat "limit"
  let events ← (← (← j.getObjVal? "status").getArr?).toList.mapM fun e => do event (← e.getStr?)
  let changes ← (← (← j.getObjVal? "presence").getArr?).toList.mapM change
  let statuses := trail (Status.step limit) Status.start events
  let presences := trail Presence.step Presence.empty changes
  pure <| Json.mkObj [
    ("status", Json.arr (statuses.map statusJson).toArray),
    ("presence", Json.arr (presences.map fun p => toJson p.present).toArray)]

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO UInt32 := do
  let line ← stdin.getLine
  if line.isEmpty then return 0
  if line.trimAscii.isEmpty then return ← loop stdin stdout
  match replay line with
  | .ok out => stdout.putStrLn out.compress; stdout.flush; loop stdin stdout
  | .error e => IO.eprintln s!"aven-db-model: {e}"; return 1

def main : IO UInt32 := do
  loop (← IO.getStdin) (← IO.getStdout)
