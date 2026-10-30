import Aven.ID.Cast
import Aven.ID.Revoke
import Aven.ID.Epochs
import Aven.ID.Recover
import Aven.ID.Network

/-! # Caps on the cast

Examples written once, beside the rules they show, each with its answer written out by hand and checked by `lake build`
(README, rule 10). They run on the cast's tree: Alice's vault owns Maia City, which owns Aven; Bob's vault is a
person's; Alice and Bob are in the group `g-garden`. `Aven.ID.CapsJson` exports them as vectors. -/

namespace Aven.ID

/-- What a reader of the cast knows: the tree, one owner per approval, who is in `g-garden`, and one role. -/
def castCtx : Ctx where
  tree := cast
  inGroup := fun g v => g == "g-garden" && (v == "alice" || v == "bob")
  roles := [⟨"role-editor-1", "Editor", [⟨"alice", "read d1"⟩, ⟨"alice", "write d1 tasks"⟩]⟩]

/-- Alice gives Bob read and task writing on her Doc `d1`, which he may share one hop further. -/
def capA : Cap :=
  { id := "cap-a", issuer := "alice", holder := .vault "bob", share := 1, signer := "alice-peer",
    grant := [⟨"alice", "read d1"⟩, ⟨"alice", "write d1 tasks"⟩], approvals := [⟨"alice-owner", "cap-a"⟩] }

/-- Bob passes reading on to everyone in `g-garden`. -/
def capB : Cap :=
  { id := "cap-b", issuer := "bob", holder := .group "g-garden", parent := "cap-a", signer := "bob-peer-light",
    grant := [⟨"alice", "read d1"⟩], approvals := [⟨"bob-owner", "cap-b"⟩] }

/-- A cap with `cap`'s fields changed by `f`, approved again by `owner` under its new id. -/
def recap (c : Cap) (newId owner : String) (f : Cap → Cap := fun c => c) : Cap :=
  { f c with id := newId, approvals := [⟨owner, newId⟩] }

def capAExpiring : Cap := recap capA "cap-a-100" "alice-owner" fun c => { c with conditions := { expires := some 100 } }

/-- Alice lets Bob share two hops on, and Bob gives the group a cap it may share one hop further. -/
def capA2 : Cap := recap capA "cap-a2" "alice-owner" fun c => { c with share := 2 }

def capG : Cap := recap capB "cap-g" "bob-owner" fun c => { c with parent := "cap-a2", share := 1 }

def capPublic : Cap :=
  { id := "cap-public", issuer := "alice", holder := .«public», signer := "alice-peer",
    grant := [⟨"alice", "read city-notes"⟩], approvals := [⟨"alice-owner", "cap-public"⟩] }

/-- Chains, each with the first rule it breaks, or none. -/
def chainExamples : List (String × List Cap × Option ChainError) := [
  ("Alice gives Bob read and task writing on d1", [capA], none),
  ("Bob passes reading on to g-garden", [capA, capB], none),
  ("Alice grants on Maia City, which she governs",
    [{ id := "cap-gov", issuer := "alice", holder := .vault "bob", signer := "alice-peer-light",
       grant := [⟨"maia-city", "read city-dome"⟩], approvals := [⟨"alice-owner", "cap-gov"⟩] }], none),
  ("a role, pinned by its id",
    [{ id := "cap-role", issuer := "alice", holder := .vault "bob", signer := "alice-peer", role := "role-editor-1",
       approvals := [⟨"alice-owner", "cap-role"⟩] }], none),
  ("the public: every member of the network", [capPublic], none),
  ("no chain", [], some .empty),
  ("a root that names a parent", [capB], some (.notRoot "cap-b")),
  ("Alice grants on Bob's vault, which she doesn't govern",
    [{ capA with id := "cap-x", grant := [⟨"bob", "read b1"⟩], approvals := [⟨"alice-owner", "cap-x"⟩] }],
    some (.authority "cap-x" ⟨"bob", "read b1"⟩)),
  ("signed by a device of another vault", [{ capA with signer := "bob-peer-light" }], some (.signer "cap-a")),
  ("no owner approved it (D14)", [{ capA with approvals := [] }], some (.approval "cap-a")),
  ("approved over another digest", [{ capA with approvals := [⟨"alice-owner", "cap-b"⟩] }], some (.approval "cap-a")),
  ("approved by a device's key, which is no owner", [{ capA with approvals := [⟨"alice-peer", "cap-a"⟩] }],
    some (.approval "cap-a")),
  ("a public cap that may share", [{ capPublic with share := 1 }], some (.publicShares "cap-public")),
  ("the public passes nothing on",
    [capPublic, recap capB "cap-pb" "bob-owner" fun c => { c with parent := "cap-public" }],
    some (.issuer "cap-pb")),
  ("a child naming another parent", [capA, { capB with parent := "cap-z" }], some (.parent "cap-b")),
  ("issued by a vault that doesn't hold the parent",
    [capA, recap capB "cap-m" "alice-owner" fun c => { c with issuer := "alice", signer := "alice-peer" }],
    some (.issuer "cap-m")),
  ("a child wider than its parent",
    [capA, recap capB "cap-w" "bob-owner" fun c => { c with grant := [⟨"alice", "read d1"⟩, ⟨"alice", "read d2"⟩] }],
    some (.wider "cap-w")),
  ("a root that may not be shared on", [{ capA with share := 0 }], none),
  ("shared further than the parent allows",
    [recap capA "cap-a0" "alice-owner" fun c => { c with share := 0 },
     recap capB "cap-b0" "bob-owner" fun c => { c with parent := "cap-a0" }],
    some (.share "cap-b0")),
  ("a child of a group's cap, issued by someone in the group",
    [capA2, capG,
     { id := "cap-g2", issuer := "alice", holder := .vault "bob", parent := "cap-g", signer := "alice-peer",
       grant := [⟨"alice", "read d1"⟩], approvals := [⟨"alice-owner", "cap-g2"⟩] }], none),
  ("a child of a group's cap, issued by a vault not in the group",
    [capA2, capG,
     { id := "cap-g3", issuer := "maia-city", holder := .vault "bob", parent := "cap-g", signer := "alice-peer",
       grant := [⟨"alice", "read d1"⟩], approvals := [⟨"alice-owner", "cap-g3"⟩] }],
    some (.issuer "cap-g3")),
  ("a child that drops its parent's expiry",
    [capAExpiring, recap capB "cap-e" "bob-owner" fun c => { c with parent := "cap-a-100" }],
    some (.conditions "cap-e")),
  ("a child that keeps its parent's expiry",
    [capAExpiring,
     recap capB "cap-e2" "bob-owner" fun c => { c with parent := "cap-a-100", conditions := { expires := some 50 } }],
    none)]

theorem chain_examples : chainExamples.all (fun (_, cs, e) => chainError castCtx cs == e) = true := by decide

/-- A Doc cap revoked inside the Doc: `r0` is Alice's revocation of `cap-a`, after `b1`. -/
def docCapDoc : List Envelope := [
  ⟨"b1", "bob", ["cap-a"], [], []⟩, ⟨"r0", "alice", [], ["b1"], []⟩,
  ⟨"b2", "bob", ["cap-a"], ["r0"], []⟩, ⟨"b3", "bob", ["cap-a"], ["b1"], []⟩,
  ⟨"a1", "alice", [], ["b3"], ["rev-a"]⟩, ⟨"c1", "maia-city", ["cap-a", "cap-b"], ["b1"], []⟩]

def docCapRevocations : List Revocation := [⟨"rev-a", "cap-a", some "r0", none⟩]

/-- A cap on a vault's Docs, revoked elsewhere and acknowledged here by Alice's `y1`. -/
def elsewhereDoc : List Envelope := [
  ⟨"x1", "bob", ["cap-team"], [], []⟩, ⟨"x2", "bob", ["cap-team"], ["x1"], []⟩,
  ⟨"y1", "alice", [], ["x1"], ["rev-t"]⟩, ⟨"x3", "bob", ["cap-team"], ["y1"], []⟩,
  ⟨"y2", "alice", [], ["x3"], ["rev-t"]⟩, ⟨"w1", "bob", [], ["zz"], []⟩]

def elsewhereRevocations : List Revocation := [⟨"rev-t", "cap-team", none, none⟩]

/-- Verdicts, each written out by hand: a Doc, the revocations held, the envelope, and its verdict. -/
def revocationExamples : List (String × List Envelope × List Revocation × String × Verdict) := [
  ("under a Doc cap, what the revocation had seen counts", docCapDoc, docCapRevocations, "b1", .counts),
  ("written after seeing the revocation", docCapDoc, docCapRevocations, "b2", .revoked "rev-a"),
  ("concurrent with the revocation: not in its past", docCapDoc, docCapRevocations, "b3", .revoked "rev-a"),
  ("under a Doc cap, a later ack keeps nothing more", docCapDoc, docCapRevocations, "b3", .revoked "rev-a"),
  ("revoking a cap ends what rests on it", docCapDoc, docCapRevocations, "c1", .revoked "rev-a"),
  ("not under the revoked cap", docCapDoc, docCapRevocations, "a1", .counts),
  ("elsewhere: an ack had seen it", elsewhereDoc, elsewhereRevocations, "x1", .counts),
  ("elsewhere: no ack had seen it", elsewhereDoc, elsewhereRevocations, "x2", .revoked "rev-t"),
  ("no laundering: written after an ack, acknowledged again later", elsewhereDoc, elsewhereRevocations, "x3",
    .revoked "rev-t"),
  ("before any ack reaches the Doc, it still counts", elsewhereDoc.take 2, elsewhereRevocations, "x2", .counts),
  ("a kept list keeps what it names", elsewhereDoc.take 2, [⟨"rev-t", "cap-team", none, some ["x1"]⟩], "x1", .counts),
  ("and nothing else", elsewhereDoc.take 2, [⟨"rev-t", "cap-team", none, some ["x1"]⟩], "x2", .revoked "rev-t"),
  ("the holder's own ack keeps nothing it wrote",
    [⟨"x5", "bob", ["cap-team"], [], []⟩, ⟨"y3", "bob", [], ["x5"], ["rev-t"]⟩], elsewhereRevocations, "x5", .counts),
  ("waiting for what it builds on, named by hash", elsewhereDoc, elsewhereRevocations, "w1", .waits ["zz"])]

def verdictOf (doc : List Envelope) (rs : List Revocation) (id : String) : Option Verdict :=
  (doc.find? (·.id == id)).map (verdict doc rs)

theorem revocation_examples :
    revocationExamples.all (fun (_, doc, rs, id, v) => verdictOf doc rs id == some v) = true := by decide

/-- Approvals on the cast: signatures, how many owners are needed, the vault, the digest, and whether it holds. -/
def approvalExamples : List (String × List Sig × Nat × String × String × Bool) := [
  ("Alice's owner signs the digest", [⟨"alice-owner", "d"⟩], 1, "alice", "d", true),
  ("over another digest", [⟨"alice-owner", "e"⟩], 1, "alice", "d", false),
  ("a device's key is no owner", [⟨"alice-peer", "d"⟩], 1, "alice", "d", false),
  ("Bob's owner for Alice's vault", [⟨"bob-owner", "d"⟩], 1, "alice", "d", false),
  ("one owner twice is one approval", [⟨"alice-owner", "d"⟩, ⟨"alice-owner", "d"⟩], 2, "alice", "d", false),
  ("no signature", [], 1, "alice", "d", false)]

theorem approval_examples :
    approvalExamples.all (fun (_, sigs, k, v, d, b) => cast.approved k v d sigs == b) = true := by decide

/-- Tickets, claimed in two orders: the smallest hash wins either way (A12). -/
def claims : List TicketClaim := [⟨"bob", 7⟩, ⟨"carol", 3⟩, ⟨"dave", 9⟩]

theorem ticket_examples : winner claims = some ⟨"carol", 3⟩ ∧ winner claims.reverse = some ⟨"carol", 3⟩ := by decide

/-- Removals that clash, and the guardian's exit, on Alice's owners `alice-owner` and `guardian`. -/
theorem recover_examples :
    settleRemovals ["alice-owner", "guardian"] ["guardian"] = ["alice-owner"] ∧
      settleRemovals ["alice-owner", "guardian"] ["alice-owner", "guardian"] = ["alice-owner", "guardian"] ∧
      (Keyring.exit "guardian" ⟨["alice-peer-kem"], ["alice-passkey-seal", "guardian"]⟩).rotate =
        ["alice-peer-kem", "alice-passkey-seal"] := by decide

/-- How avenOS shows a cap for a passkey tap: written from the cap itself (A2, rule 25). -/
def Holder.text : Holder → String
  | .vault v => v
  | .group g => s!"everyone in {g}"
  | .«public» => "every member of the network"
  | .ticket k => s!"whoever claims the ticket {k}"

def Cap.text (c : Cap) (roles : List Role) : String :=
  s!"{c.issuer} grants {c.holder.text}: " ++
    ", ".intercalate ((c.grants roles).map fun a => s!"{a.what} in {a.vault}") ++
    (if c.share = 0 then "; no sharing on" else s!"; may share on {c.share} more hop(s)") ++
    (match c.conditions.expires with | some t => s!"; until {t}" | none => "")

theorem shown_examples :
    capA.text [] = "alice grants bob: read d1 in alice, write d1 tasks in alice; may share on 1 more hop(s)" ∧
      capB.text [] = "bob grants everyone in g-garden: read d1 in alice; no sharing on" := by decide

end Aven.ID
