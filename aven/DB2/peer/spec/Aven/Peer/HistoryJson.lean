import Lean.Data.Json
import Aven.ID.Gen
import Aven.Peer.History
import Aven.Peer.CatchUp

/-! # History and catch-up as vectors

`history.json`: history entries in their signers' logs, each with its name, its place and its CBOR, and the newest of
each sort about each device or release line, in several orders; presence beats and the newest of each
(`Aven.Peer.History`).
`catchup.json`: sources offered against a signed log tip, the one chosen and the ones caught, and presence from
signed beats (`Aven.Peer.CatchUp`). -/

open Lean

namespace Aven.Peer
namespace HistoryJson

open Aven.Core History History.Examples

def Says.json : Says → Json
  | .address n => Json.mkObj [("address", toJson n)]
  | .tip n => Json.mkObj [("tip", toJson n)]
  | .release l n => Json.mkObj [("release", Json.mkObj [("body", toJson n), ("about", l)])]

def Entry.json (n : Entry) : Json :=
  Json.mkObj [("says", Says.json n.says), ("signer", n.signer), ("generation", toJson n.generation)]

def entryJson (e : Envelope) : Json :=
  Json.mkObj [("name", (nm e).text), ("doc", hex e.doc.hash.bytes), ("writer", toJson e.writer), ("seq", toJson e.seq),
    ("prev", e.prev.elim Json.null fun h => h.text),
    ("entry", (entryOf reader e).elim Json.null Entry.json), ("cbor", hex (encode e.value))]

def Beat.json (b : Beat) : Json :=
  Json.mkObj [("about", b.about), ("signer", b.signer), ("counter", toJson b.counter), ("body", toJson b.body)]

def Heard.json (h : CatchUp.Heard) : Json := Json.mkObj [("beat", Beat.json h.beat), ("heardAt", toJson h.at_)]

def asks : List (Which × String) :=
  [(.address, "alice-peer"), (.tip, "alice-peer"), (.address, "bob-peer"), (.tip, "bob-peer"), (.release, "aven"),
   (.address, "aven-peer")]

def history (label : String) (S : List Envelope) : Json :=
  Json.mkObj [("name", s!"history, {label}"),
    ("input", Json.mkObj [("admitted", toJson ["alice-peer", "bob-peer"]),
      ("releaseSigners", toJson ["release-signer"]),
      ("entries", Json.arr (S.map entryJson).toArray),
      ("asks", Json.arr (asks.map fun (w, a) => Json.mkObj [("which", w.key), ("about", a)]).toArray)]),
    ("expected", Json.mkObj [
      ("counts", toJson ((S.filter (counts reader S)).map fun e => (nm e).text)),
      ("newest", Json.arr (asks.map fun (w, a) => (newest reader w a S).elim Json.null fun e => (nm e).text).toArray)])]

def historyVectors : List Json :=
  [history "as written" entries, history "reversed" entries.reverse,
   history "Alice's Peer re-homed in a new generation" (a5 :: entries)] ++
  ((List.range 4).map fun i => history s!"shuffle {i + 1}" ((Aven.ID.Rng.seed (i + 900)).shuffle entries).1) ++
  [Json.mkObj [("name", "presence beats"),
    ("input", Json.mkObj [("admitted", toJson ["alice-peer", "bob-peer"]),
      ("beats", Json.arr (beats.map Beat.json).toArray), ("asks", toJson ["bob-peer", "mallory-peer"])]),
    ("expected", Json.arr (["bob-peer", "mallory-peer"].map fun a =>
      (Beat.newest admitted a beats).elim Json.null Beat.json).toArray)]]

open CatchUp in
def catchUpVectors : List Json :=
  let tip : Tip := ⟨3, 33⟩
  let sources : List (List (String × Copy)) :=
    [[("stale-peer", [11, 22]), ("forger", [11, 22, 99]), ("alice-peer", [11, 22, 33, 44])],
     [("alice-peer", [11, 22, 33])], [("stale-peer", [11, 22])], [("forger", [11, 22, 99]), ("bob-peer", [11, 22, 33])],
     []]
  let copyJson (c : String × Copy) := Json.mkObj [("source", c.1), ("copy", toJson c.2)]
  (sources.zipIdx.map fun (ss, i) =>
    Json.mkObj [("name", s!"catch-up: sources {i + 1}"),
      ("input", Json.mkObj [("tip", Json.mkObj [("number", toJson tip.number), ("hash", toJson tip.hash)]),
        ("sources", Json.arr (ss.map copyJson).toArray)]),
      ("expected", Json.mkObj [("chosen", (choose tip ss).elim Json.null fun c => toJson c.1),
        ("caught", toJson ((ss.filter fun c => caught tip c.2).map (·.1)))])]) ++
  (([8, 10, 15, 17, 18, 20] : List Nat).map fun now =>
    -- what a peer has heard by step `now` of its own clock
    let heard := CatchUpExamples.beats.filter (·.at_ ≤ now)
    Json.mkObj [("name", s!"presence at step {now}, window 3"),
      ("input", Json.mkObj [("admitted", toJson ["bob-light", "alice-peer"]), ("window", toJson (3 : Nat)),
        ("now", toJson now), ("heard", Json.arr (heard.map Heard.json).toArray)]),
      ("expected", Json.mkObj [("present",
        toJson (["alice-peer", "aven-peer", "bob-light"].filter (present CatchUpExamples.admitted 3 now heard)))])])

end HistoryJson
end Aven.Peer
