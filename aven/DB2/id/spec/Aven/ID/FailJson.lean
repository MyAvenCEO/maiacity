import Aven.ID.SettleJson
import Aven.ID.Admit

/-! # The box's failures, expected (PEERS.md, "How it is checked"; Thread F, F1)

`failures.json`: the nine checks `bun run up --check` runs with the Aven Peer stopped, each with its input and the
outcome the models give: who reaches whom and through which relay (`Aven.ID.Node`), which source a catch-up takes and
which it catches (`Aven.ID.CatchUp`), which keeper serves a file (`Node.keepersOf`), whether a newcomer gets in at
Alice Peer's relay (`Settle.newcomer`), the settled tree after each race and after a restart (`settle`), and the wire
version's refusal (`Records.speaks`). The `#guard`s below hold each outcome to what PEERS.md says the box must see, so
the vectors can't drift from the plan.

The cast: the Aven Peer (`aven-peer`) and Alice Peer (`alice-peer`) run the listed relays; Bob's Peer (`bob-peer`)
keeps for Bob's vault; Bob's Peer-Light (`bob-light`) and Alice Peer-Light (`alice-light`) are browsers; Carol's
browser (`carol-light`) and Dan's (`dan-light`) hold invites. Every check runs with the Aven Peer gone. -/

open Lean

namespace Aven.ID
namespace FailJson

open Settle Node CatchUp SettleJson TreeExamples

def members : List String := ["aven-peer", "alice-peer", "bob-peer", "bob-light", "alice-light"]
def gone : String := "aven-peer"

/-- The relays every member can use (PEERS §1), the chat's holders, and a file Bob's Peer-Light shared, kept by the
default keeper and by Bob's Peer, which Bob's vault named. -/
def keeps : List KeepCap := [defaultKeep "aven-peer", ⟨(· == "bobs-file"), "bob-peer"⟩]
def net : Net :=
  { members, relays := ["aven-peer", "alice-peer"], usable := fun _ _ => true
    holders := fun d => if d == "bobs-file" then "bob-light" :: keepersOf keeps d else [] }

/-- The tree before the stop: the genesis, Alice's second device, and the tickets for Carol and Dan. -/
def tree : List TreeStatement :=
  [⟨100, "alice-passkey", [], .genesis alicesGenesis⟩, ⟨110, "alice-passkey", [100], .signIn "alice" "alice-light"⟩,
   ⟨120, "alice-passkey", [110], .ticket "t-carol"⟩, ⟨130, "alice-passkey", [110], .ticket "t-dan"⟩]
def ok (_ : TreeStatement) : Bool := true

def carol : TreeStatement := ⟨500, "t-carol", [120], .claim 120 "carol" "carol-passkey" "carol-light" guardian⟩
def carolAck : TreeStatement := ⟨510, "alice-peer", [500], .ack 500⟩
-- step 5: two profiles claim Dan's ticket at once
def dan1 : TreeStatement := ⟨610, "t-dan", [130], .claim 130 "dan" "dan-passkey" "dan-light" guardian⟩
def dan2 : TreeStatement := ⟨605, "t-dan", [130], .claim 130 "dan2" "dan2-passkey" "dan2-light" guardian⟩
-- step 6: Carol's claim and a withdrawal of her ticket, neither seeing the other
def carolWithdrawn : TreeStatement := ⟨520, "alice-passkey", [120], .withdrawal 120⟩

/-- Bob's log as each source holds it, and its newest signed tip. -/
def bobsTip : Tip := ⟨3, 33⟩
def sources : List (String × Copy) := [("alice-peer", [11, 22, 33]), ("bob-peer", [11, 22, 33])]
def hider : List (String × Copy) := [("hider", [11, 22]), ("alice-peer", [11, 22, 33])]

def step (n : Nat) (what : String) (input expected : Json) : Json :=
  Json.mkObj [("name", s!"failure {n}: {what}"), ("input", input), ("expected", expected)]

def treeJson (S : List TreeStatement) : Json := Json.arr (S.map SettleJson.TreeStatement.json).toArray
def settled (S : List TreeStatement) : Json := Listed.json ((settle ok 100 S).listed S)

/-- Everything the members hold by step 7. -/
def all7 : List TreeStatement := tree ++ [carol, carolAck, dan1, dan2]

def failureVectors : List Json :=
  let pair (a b : String) := Json.mkObj [("from", a), ("to", b)]
  [step 1 "Alice Peer and Bob's Peer-Light chat through Alice Peer's relay"
     (Json.mkObj [("members", toJson members), ("relays", toJson net.relays), ("gone", gone)])
     (Json.mkObj [("reaches", Json.arr #[Json.mkObj [("pair", pair "alice-peer" "bob-light"),
         ("ok", toJson (reaches net gone "alice-peer" "bob-light"))],
       Json.mkObj [("pair", pair "bob-light" "alice-peer"),
         ("ok", toJson (reaches net gone "bob-light" "alice-peer"))]]),
       ("home", Json.mkObj [("bob-light", toJson (home net gone "bob-light")),
         ("alice-peer", toJson (home net gone "alice-peer"))])]),
   step 2 "Alice Peer-Light, reloaded, catches up Bob's log from a member"
     (Json.mkObj [("tip", Json.mkObj [("number", toJson bobsTip.number), ("hash", toJson bobsTip.hash)]),
       ("sources", Json.arr (sources.map fun (s, c) => Json.mkObj [("source", s), ("copy", toJson c)]).toArray)])
     (Json.mkObj [("chosen", toJson ((choose bobsTip sources).map (·.1)))]),
   step 3 "a file Bob's Peer-Light shared loads from Bob's Peer, its tab closed"
     (Json.mkObj [("keepers", toJson (keepersOf keeps "bobs-file")), ("gone", toJson ["aven-peer", "bob-light"])])
     (Json.mkObj [("servedBy", toJson ((keepersOf keeps "bobs-file").filter fun k =>
         k != "aven-peer" && k != "bob-light" && reaches net gone "alice-light" k))]),
   step 4 "an invite claimed through Alice Peer's relay, waiting, then acked"
     (Json.mkObj [("tree", treeJson tree), ("claim", SettleJson.TreeStatement.json carol),
       ("ack", SettleJson.TreeStatement.json carolAck)])
     (Json.mkObj [("letIn", toJson (newcomer ok 100 tree "carol-light" (some carol))),
       ("waiting", settled (tree ++ [carol])), ("acked", settled (tree ++ [carol, carolAck]))]),
   step 5 "two claims of one ticket at once: the same winner everywhere"
     (Json.mkObj [("tree", treeJson (tree ++ [dan1, dan2]))])
     (Json.mkObj [("settled", settled (tree ++ [dan1, dan2])), ("reversed", settled (tree ++ [dan2, dan1]))]),
   step 6 "a withdrawal and a claim, neither seeing the other: the withdrawal wins"
     (Json.mkObj [("tree", treeJson (tree ++ [carol, carolWithdrawn]))])
     (Json.mkObj [("settled", settled (tree ++ [carol, carolWithdrawn])),
       ("carolLetIn", toJson ((settle ok 100 (tree ++ [carol, carolWithdrawn])).admits "carol-light"))]),
   step 7 "the Aven Peer starts again and settles the tree every member holds"
     (Json.mkObj [("members", treeJson all7), ("avenPeer", treeJson all7.reverse)])
     (Json.mkObj [("same", toJson ((settle ok 100 all7).listed all7 == (settle ok 100 all7.reverse).listed all7)),
       ("settled", settled all7)]),
   step 8 "a peer on another wire version is refused with update"
     (Json.mkObj [("mine", toJson (1 : Nat)), ("theirs", toJson (2 : Nat))])
     (Json.mkObj [("speaks", toJson (Records.speaks 1 2))]),
   step 9 "a peer that hides Bob's newest post is caught"
     (Json.mkObj [("tip", Json.mkObj [("number", toJson bobsTip.number), ("hash", toJson bobsTip.hash)]),
       ("sources", Json.arr (hider.map fun (s, c) => Json.mkObj [("source", s), ("copy", toJson c)]).toArray)])
     (Json.mkObj [("chosen", toJson ((choose bobsTip hider).map (·.1))),
       ("caught", toJson ((hider.filter fun s => caught bobsTip s.2).map (·.1)))])]

/-! ## What the box must see (PEERS.md) -/

-- 1. both ways, at Alice Peer's relay
#guard reaches net gone "alice-peer" "bob-light" && reaches net gone "bob-light" "alice-peer"
#guard home net gone "bob-light" == some "alice-peer"
-- 2. from a member, not the Aven Peer
#guard (choose bobsTip sources).map (·.1) == some "alice-peer"
-- 3. Bob's Peer serves the file, and Alice's browser can fetch it
#guard keepersOf keeps "bobs-file" == ["aven-peer", "bob-peer"] && fetchable net gone "alice-light" "bobs-file"
-- 4. Carol gets in at the relay for her claim; she stands, waits for the ack, then is final
#guard newcomer ok 100 tree "carol-light" (some carol)
#guard (settle ok 100 (tree ++ [carol])).admits "carol-light" && !(settle ok 100 (tree ++ [carol])).final 500
#guard (settle ok 100 (tree ++ [carol, carolAck])).final 500
-- 5. the smaller hash wins in every order, and the loser is out
#guard (settle ok 100 (tree ++ [dan1, dan2])).standing 605 && !(settle ok 100 (tree ++ [dan1, dan2])).standing 610
#guard (settle ok 100 (tree ++ [dan2, dan1])).listed (tree ++ [dan1, dan2]) ==
  (settle ok 100 (tree ++ [dan1, dan2])).listed (tree ++ [dan1, dan2])
#guard !(settle ok 100 (tree ++ [dan1, dan2])).admits "dan-light"
-- 6. the withdrawal wins and Carol's browser is out
#guard !(settle ok 100 (tree ++ [carol, carolWithdrawn])).admits "carol-light"
-- 7. the same tree, whatever order the Aven Peer reads it back in
#guard (settle ok 100 all7).listed all7 == (settle ok 100 all7.reverse).listed all7
-- 8. no fallback
#guard !Records.speaks 1 2
-- 9. the hider is caught, and Alice Peer is asked instead
#guard (choose bobsTip hider).map (·.1) == some "alice-peer" && caught bobsTip [11, 22]

end FailJson
end Aven.ID
