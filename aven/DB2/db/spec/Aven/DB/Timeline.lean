import Lean.Data.Json

/-!
# The timeline

Every peer writes its events as JSON lines of one shape (SANDBOX.md, "The Control Room"): when (milliseconds since the
epoch), which peer, what, then the event's own fields. The three come first and always hold: a field of the same
name never takes their place. `aven-gen1`'s `timeline` module writes these lines.
-/

open Lean

namespace Aven.DB

def lineKeys : List String := ["t", "peer", "event"]

def line (t : Nat) (peer event : String) (fields : List (String × Json)) : Json :=
  Json.mkObj ([("t", toJson t), ("peer", toJson peer), ("event", toJson event)] ++
    fields.filter fun (k, _) => k ∉ lineKeys)

/-! ## Examples

Lines and the JSON they are, written out by hand. -/

def lineExamples : List (String × (Nat × String × String × List (String × Json)) × String) := [
  ("one shape", (5, "aven-peer", "phase", [("phase", "live")]),
    "{\"t\":5,\"peer\":\"aven-peer\",\"event\":\"phase\",\"phase\":\"live\"}"),
  ("no fields", (0, "alice-peer", "started", []), "{\"t\":0,\"peer\":\"alice-peer\",\"event\":\"started\"}"),
  ("a field never takes the place of the three", (7, "alice-peer", "stored",
    [("event", "x"), ("t", toJson 9), ("kept", toJson true), ("blob", "af13")]),
    "{\"t\":7,\"peer\":\"alice-peer\",\"event\":\"stored\",\"kept\":true,\"blob\":\"af13\"}")]

#guard lineExamples.all fun (_, (t, peer, event, fields), want) => (Json.parse want).toOption == some (line t peer event fields)

end Aven.DB
