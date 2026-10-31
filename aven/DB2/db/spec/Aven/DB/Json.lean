import Aven.DB
import Lean.Data.Json

/-!
# Aven.DB as JSON

The one JSON form of `aven-db-model` (`Main.lean`) and of the vectors (`Vectors.lean`).

- A status event is `"dial"`, `"frame"`, `"tick"` or `"lost"`; a state `{"phase", "moved", "idle"}`.
- A store call is `["put", hex]`, `["get", h]`, `["getRange", h, a, b]`, `["has", h]`, `["size", h]`, `["list"]`, `["delete", h]`,
  `["getRef", n]`, `["setRef", n, expected or null, new]`, `["deleteRef", n, expected]` or `["listRefs"]`; bytes in
  hex, hashes as the store writes them. A result is `{"ok": value}`, or `{"error": "stale", "current"}`,
  `{"error": "range", "start", "end", "len"}`, `{"error": "invalidName", "name"}`.
-/

open Lean

namespace Aven.DB

def Event.name : Event → String
  | .dial => "dial"
  | .frame => "frame"
  | .tick => "tick"
  | .lost => "lost"

def parseEvent : String → Except String Event
  | "dial" => pure .dial
  | "frame" => pure .frame
  | "tick" => pure .tick
  | "lost" => pure .lost
  | e => throw s!"unknown status event {e}"

def Status.json (s : Status) : Json :=
  Json.mkObj [("phase", s.phase.name), ("moved", s.moved), ("idle", s.idle)]

/-- Every state a fold passes through, after each step. -/
def trail {σ α : Type} (step : σ → α → σ) (s : σ) : List α → List σ
  | [] => []
  | a :: as => let s' := step s a; s' :: trail step s' as

namespace Store

def hexValue (c : Char) : Option Nat :=
  if '0' ≤ c ∧ c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c ∧ c ≤ 'f' then some (c.toNat - 'a'.toNat + 10)
  else none

def unhex : List Char → Option Bytes
  | [] => some []
  | a :: b :: rest => do
    let x ← hexValue a
    let y ← hexValue b
    pure ((16 * x + y).toUInt8 :: (← unhex rest))
  | [_] => none

def Op.json : Op → Json
  | .put b => Json.arr #["put", Blake3.hex b]
  | .get h => toJson ["get", h]
  | .getRange h a e => Json.arr #["getRange", h, toJson a, toJson e]
  | .has h => toJson ["has", h]
  | .size h => toJson ["size", h]
  | .list => toJson ["list"]
  | .delete h => toJson ["delete", h]
  | .getRef n => toJson ["getRef", n]
  | .setRef n e new => Json.arr #["setRef", n, toJson e, new]
  | .deleteRef n e => toJson ["deleteRef", n, e]
  | .listRefs => toJson ["listRefs"]

def parseOp (j : Json) : Except String Op := do
  let args ← j.getArr?
  let arg (i : Nat) : Json := args[i]?.getD Json.null
  let str (i : Nat) : Except String String := (arg i).getStr?
  match ← str 0 with
  | "put" => match unhex (← str 1).toList with
    | some b => pure (.put b)
    | none => throw "put takes bytes in hex"
  | "get" => pure (.get (← str 1))
  | "getRange" => pure (.getRange (← str 1) (← (arg 2).getNat?) (← (arg 3).getNat?))
  | "has" => pure (.has (← str 1))
  | "size" => pure (.size (← str 1))
  | "list" => pure .list
  | "delete" => pure (.delete (← str 1))
  | "getRef" => pure (.getRef (← str 1))
  | "setRef" => pure (.setRef (← str 1) (str 2).toOption (← str 3))
  | "deleteRef" => pure (.deleteRef (← str 1) (← str 2))
  | "listRefs" => pure .listRefs
  | o => throw s!"unknown store call {o}"

def Res.json : Res → Json
  | .hash h => Json.mkObj [("ok", h)]
  | .bytes b => Json.mkObj [("ok", toJson (b.map Blake3.hex))]
  | .yes b => Json.mkObj [("ok", toJson b)]
  | .hashes l => Json.mkObj [("ok", toJson l)]
  | .size n => Json.mkObj [("ok", toJson n)]
  | .done => Json.mkObj [("ok", Json.null)]
  | .ref h => Json.mkObj [("ok", toJson h)]
  | .names l => Json.mkObj [("ok", toJson l)]
  | .stale c => Json.mkObj [("error", "stale"), ("current", toJson c)]
  | .range a e n => Json.mkObj [("error", "range"), ("start", toJson a), ("end", toJson e), ("len", toJson n)]
  | .invalidName n => Json.mkObj [("error", "invalidName"), ("name", n)]

/-- A trace's results from an empty store, with BLAKE3 as the hash. -/
def replay (ops : List Op) : Json := Json.arr ((results Blake3.hash {} ops).map Res.json).toArray

end Store

end Aven.DB
