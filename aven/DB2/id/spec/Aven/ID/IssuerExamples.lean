import Aven.ID.CapsExamples
import Aven.ID.Member

/-! # Who may issue a cap (A28)

Vaults own and signers only sign (rule 15, A28). A cap's issuer is a vault, proven by a device of it or by its owners'
approval, and its authority runs down the tree only through quorums it meets alone. Here the cast gains the garden, a
coop Alice and Bob own together, with its helper, an agent the coop owns:

- a root over the coop's Docs, or its helper's, needs the coop's own owners: Alice alone has half its quorum, and
  issues nothing over them, while the coop issues as itself, approved by both (`root_quorum`);
- a coop has no devices, so it issues by its owners' approval alone; no device of another vault signs for it;
- any vault may issue by its owners' approval alone, and an attenuation with no device signing needs its holder's
  owners' approval;
- with a quorum of one, as every vault has today, Alice alone may grant over the coop's Docs;
- Maia City's confirm cap to Aven, approved by Maia City's owners with no device signing (A38, `Aven.ID.Member`).

`issuers.json` writes these cases. -/

namespace Aven.ID.IssuerExamples

open Aven.Core

/-- The cast with the garden, a coop Alice and Bob own, and its helper, an agent the coop owns. -/
def coopTree : Tree :=
  { cast with
    vaults := cast.vaults ++ [⟨"garden", "The garden", .coop, [.vault "alice", .vault "bob"]⟩,
      ⟨"garden-helper", "The garden's helper", .agent, [.vault "garden"]⟩] }

theorem coopTree_wf : coopTree.WF := by decide

/-- The garden's plan, its helper's log, and Maia City's tree Doc. -/
def gardenPlan : DocId := docOf "garden-plan"
def helperLog : DocId := docOf "helper-log"
def maiaTree : DocId := docOf "maia-tree"

def coopFacts (d : DocId) : Option Facts :=
  if d == gardenPlan then some ⟨d, vaultId "garden", notes⟩
  else if d == helperLog then some ⟨d, vaultId "garden-helper", notes⟩
  else if d == maiaTree then some ⟨d, vaultId "maia-city", notes⟩
  else castFacts d

/-- A reader of the cast with the garden, whose owners approve `k` of their two; every other vault needs one. -/
def coopCtx (k : Nat) : Ctx :=
  { castCtx with tree := coopTree, threshold := fun v => if v == "garden" then k else 1, facts := coopFacts }

/-- Both owners of the garden approve cap `id`. -/
def bothOwners (id : String) : List Sig := [⟨"alice-owner", id⟩, ⟨"bob-owner", id⟩]

/-- Alice lets Aven read the garden's plan, signed by her device and approved by her owner key. -/
def capAliceGarden : Cap :=
  { id := "cap-ag", issuer := "alice", holder := .vault "aven", signer := "alice-peer", grant := [readOn gardenPlan],
    approvals := [⟨"alice-owner", "cap-ag"⟩] }

/-- The garden lets Aven read its plan: no device signs, and both its owners approve. -/
def capGarden : Cap :=
  { id := "cap-garden", issuer := "garden", holder := .vault "aven", grant := [readOn gardenPlan],
    approvals := bothOwners "cap-garden" }

/-- Chains on the garden's cast, each with the garden's quorum and the first rule the chain breaks, or none. -/
def issuerExamples : List (String × Nat × List Cap × Option ChainError) := [
  ("Alice grants over the garden's plan alone: she meets half its quorum", 2, [capAliceGarden],
    some (.authority "cap-ag" (readOn gardenPlan))),
  ("the garden grants as itself, approved by both its owners, no device signing", 2, [capGarden], none),
  ("the garden's grant with Alice's approval alone", 2,
    [{ capGarden with approvals := [⟨"alice-owner", "cap-garden"⟩] }], some (.signer "cap-garden")),
  ("the garden's grant signed by Alice's device: a coop has no devices", 2,
    [{ capGarden with signer := "alice-peer" }], some (.signer "cap-garden")),
  ("Alice grants over the helper's log: authority runs down only through quorums", 2,
    [recap capAliceGarden "cap-ah" "alice-owner" fun c => { c with grant := [readOn helperLog] }],
    some (.authority "cap-ah" (readOn helperLog))),
  ("the garden grants over its helper's log", 2,
    [{ capGarden with id := "cap-gh", grant := [readOn helperLog], approvals := bothOwners "cap-gh" }], none),
  ("with a quorum of one, Alice alone grants over the garden's plan", 1, [capAliceGarden], none),
  ("Alice's vault grants by her owner's approval alone, no device signing", 2, [{ capA with signer := none }], none),
  ("Alice's grant with no device signing and no approval", 2, [{ capA with signer := none, approvals := [] }],
    some (.signer "cap-a")),
  ("Aven's owners narrow its cap with no device signing: Maia City approves through Alice's key", 2,
    [capHost, { attRead with id := "att-owners", signer := none, approvals := [⟨"alice-owner", "att-owners"⟩] }],
    none),
  ("an attenuation with no device signing and no approval", 2,
    [capHost, { attRead with id := "att-none", signer := none }], some (.signer "att-none")),
  ("Maia City's confirm cap to Aven, approved by its owners through Alice's key (A38)", 2,
    [confirmCap maiaTree "aven" [⟨"alice-owner", "confirm-aven"⟩]], none),
  ("Maia City's confirm cap signed by Alice's device: a coop has no devices", 2,
    [{ confirmCap maiaTree "aven" [⟨"alice-owner", "confirm-aven"⟩] with signer := "alice-peer" }],
    some (.signer "confirm-aven"))]

#guard issuerExamples.all fun (_, k, cs, e) => chainError (coopCtx k) cs == e

-- Every vault a kept root grants over approves it by its own quorum (`root_quorum`).
#guard issuerExamples.all fun (_, k, cs, e) =>
  e != none || cs.head?.all fun r => (r.grants castCtx.roles).all fun l =>
    (lineVault (coopCtx k) l).all fun v => coopTree.vaults.any fun w =>
      vaultId w.id == v && coopTree.approves (coopCtx k).threshold w.id r.id r.approvals

end Aven.ID.IssuerExamples
