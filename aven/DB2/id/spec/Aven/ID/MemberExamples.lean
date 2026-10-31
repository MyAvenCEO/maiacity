import Aven.ID.AuthorizedExamples
import Aven.ID.IssuerExamples
import Aven.ID.Member

/-! # Members by confirm, on the cast (A38)

`member.json`'s cases. A reader of the cast that knows Maia City's tree Doc counts a vault as a member only by an
authorized confirm on that Doc of a claim that founded the vault (`Reader.membersB`, `membersB_sound`). Aven's Peer
confirms for Aven's agent under Maia City's confirm cap; Alice, who governs Maia City, may confirm on its own
authority; Bob may not. Each case's answer is written out by hand and checked as the module builds. The member cap a
confirm issues is `memberCap`, under the tree Doc, the chat Doc and the chat message's type named here. -/

namespace Aven.ID.MemberExamples

open Aven.Core AuthorizedExamples IssuerExamples

/-- Maia City's chat, and the type of its messages. -/
def chat : DocId := docOf "maia-chat"
def chatMessage : DocId := docOf "chat-message"

/-- What a reader of the cast knows, with Maia City's tree Doc among its Docs. -/
def memberFacts (d : DocId) : Option Facts :=
  if d == maiaTree then some ⟨d, vaultId "maia-city", notes⟩ else castFacts d

def memberCtx : Ctx := { castCtx with facts := memberFacts }

/-- Maia City's confirm cap to Aven, approved by its owners through Alice's key. -/
def avenConfirm : Cap := confirmCap maiaTree "aven" [⟨"alice-owner", "confirm-aven"⟩]

/-- Each device's cap: Alice's and Bob's phones may do everything their vaults may; Aven's Peer hosts Aven's agent,
whose standing cap is the confirm cap (A27). -/
def memberDeviceCaps : List (Bytes × DeviceCap) :=
  [(key "alice-peer-light", ⟨"alice-peer-light", "alice", none, .any, false⟩),
   (key "bob-peer-light", ⟨"bob-peer-light", "bob", none, .any, false⟩),
   (key "aven-peer", ⟨"aven-peer", "aven", some avenConfirm.grant, .any, true⟩)]

/-- Bob's claim, which founded his vault, and a claim that founded none. -/
def claimBob : Hash := blake3 "claim-bob".toUTF8.toList
def claimLost : Hash := blake3 "claim-lost".toUTF8.toList

/-- Which vault each claim founded, as the tree settles it. -/
def founded (h : Hash) : Option String := if h == claimBob then some "bob" else none

/-- Aven's agent, the actor Aven's Peer hosts. -/
def avenAgent : DocId := docOf "aven-agent"

/-- A confirm of Bob's claim with a parameter `tree/1`'s confirm doesn't have, in the codec's order. -/
def confirmExtra : Call := ⟨confirmOp, [(key "x", .null), (claimParam, .bytes claimBob.bytes)]⟩

/-- A case: its name, the signing key, the Doc, the chain, the calls, the acting actor, and its answer: whether caps
authorizes it, and the vaults it makes members. -/
structure Case where
  name : String
  signer : String
  doc : DocId := maiaTree
  chain : List Cap := []
  calls : List Call
  actor : Option DocId := none
  answer : Bool × List String

def Case.envelope (c : Case) : Envelope :=
  { doc := c.doc, branch := key "main", writer := 1, seq := 1, prev := none, deps := [], body := .null,
    sigs := [⟨key c.signer, []⟩] }

def Case.reader (c : Case) : Reader :=
  { ctx := memberCtx, chain := fun _ => c.chain, calls := fun _ => c.calls, lower := fun _ => [],
    signer := fun _ => key c.signer, vaultOf := fun k => (castKeys.find? (·.1 == k)).map (·.2),
    member := castMembers.contains, facts := memberFacts,
    deviceCap := fun k => (memberDeviceCaps.find? (·.1 == k)).map (·.2), actorOf := fun _ => c.actor }

/-- What a reader of the cast computes: whether caps authorizes the envelope, and the members it counts from it. -/
def Case.verdict (c : Case) : Bool × List String :=
  (c.reader.authorizedB castGov none' none' c.envelope,
    c.reader.membersB maiaTree castGov none' none' founded c.envelope)

def cases : List Case := [
  { name := "Aven's Peer confirms Bob's claim for Aven's agent, under Maia City's confirm cap",
    signer := "aven-peer", chain := [avenConfirm], calls := [confirmCall claimBob], actor := some avenAgent,
    answer := (true, ["bob"]) },
  { name := "Alice confirms it on her own authority: she governs Maia City", signer := "alice-peer-light",
    calls := [confirmCall claimBob], answer := (true, ["bob"]) },
  { name := "Bob confirms his own claim: he has no authority over Maia City's tree", signer := "bob-peer-light",
    calls := [confirmCall claimBob], answer := (false, []) },
  { name := "a confirm of a claim that founded no vault", signer := "aven-peer", chain := [avenConfirm],
    calls := [confirmCall claimLost], actor := some avenAgent, answer := (true, []) },
  { name := "Aven's Peer confirms naming no actor (A27)", signer := "aven-peer", chain := [avenConfirm],
    calls := [confirmCall claimBob], answer := (false, []) },
  { name := "a confirm with a parameter tree/1's confirm doesn't have is no confirm", signer := "aven-peer",
    chain := [avenConfirm], calls := [confirmExtra], actor := some avenAgent, answer := (true, []) },
  { name := "the confirm cap doesn't reach another Doc", signer := "aven-peer", doc := d1, chain := [avenConfirm],
    calls := [confirmCall claimBob], actor := some avenAgent, answer := (false, []) }]

#guard cases.all fun c => c.verdict == c.answer

/-- The member caps a confirm issues, for Bob and for a vault not yet in the cast. -/
def memberCaps : List Cap := ["bob", "carol"].map (memberCap maiaTree chat chatMessage)

#guard memberCaps.all fun c => Canon c.body

end Aven.ID.MemberExamples
