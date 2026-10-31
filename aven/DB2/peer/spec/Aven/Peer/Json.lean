import Aven.Peer.Presence
import Lean.Data.Json

/-!
# Aven.Peer as JSON

The one JSON form of `aven-peer-model` (`Main.lean`) and of the vectors (`Vectors.lean`): a presence change is
`["join", p]` or `["leave", p]`; what every peer is told, a sorted list of peers.
-/

open Lean

namespace Aven.Peer

def Change.json : Change → Json
  | .join p => Json.arr #["join", toJson p]
  | .leave p => Json.arr #["leave", toJson p]

def parseChange (j : Json) : Except String Change := do
  let arr ← j.getArr?
  let kind ← (arr[0]?.getD Json.null).getStr?
  let p ← (arr[1]?.getD Json.null).getNat?
  match kind with
  | "join" => pure (.join p)
  | "leave" => pure (.leave p)
  | k => throw s!"unknown presence change {k}"

/-- Every state a fold passes through, after each step. -/
def trail {σ α : Type} (step : σ → α → σ) (s : σ) : List α → List σ
  | [] => []
  | a :: as => let s' := step s a; s' :: trail step s' as

end Aven.Peer
