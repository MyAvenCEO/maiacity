import Aven.ID.Cast
import Aven.ID.Revoke
import Aven.ID.Epochs
import Aven.ID.Recover
import Aven.ID.Network
import Aven.ID.CapsCbor

/-! # Caps on the cast

Examples written once, beside the rules they show, each with its answer written out by hand and checked by `lake build`
(README, rule 10): by `decide` where the kernel computes them, and by `#guard` where they go through UTF-8. They run on
the cast's tree: Alice's vault owns Maia City, which owns Aven; Bob's vault is a person's; Alice and Bob are in the
group `g-garden`. `Aven.ID.CapsJson` exports them as vectors. -/

namespace Aven.ID

/-- The cast's Docs, named by short bytes rather than 32-byte hashes so that `decide` stays quick. `tasks` is a type
Doc. -/
def docOf (s : String) : Core.DocId := ⟨⟨s.toUTF8.toList⟩⟩

def d1 : Core.DocId := docOf "d1"
def d2 : Core.DocId := docOf "d2"
def b1 : Core.DocId := docOf "b1"
def cityNotes : Core.DocId := docOf "city-notes"
def cityDome : Core.DocId := docOf "city-dome"
def tasks : Core.DocId := docOf "tasks"

/-- Reading a Doc. -/
def readOn (d : Core.DocId) : Line := ⟨.doc d, .read, []⟩

/-- Writing tasks into a Doc: new ones, and patches to any field. -/
def tasksOn (d : Core.DocId) : Line := ⟨.doc d, .put, [⟨tasks, .putNew, none⟩, ⟨tasks, .patch, none⟩]⟩

/-- Which vault each of the cast's Docs belongs to, as its genesis fixes it. -/
def castDocVault (d : Core.DocId) : Option String :=
  if d == d1 || d == d2 || d == cityNotes then some "alice"
  else if d == b1 then some "bob"
  else if d == cityDome then some "maia-city"
  else none

/-- What a reader of the cast knows: the tree, one owner per approval, who is in `g-garden`, one role, and which vault
each Doc belongs to. -/
def castCtx : Ctx where
  tree := cast
  inGroup := fun g v => g == "g-garden" && (v == "alice" || v == "bob")
  roles := [⟨"role-editor-1", "Editor", [readOn d1, tasksOn d1]⟩]
  docVault := castDocVault

/-- Alice gives Bob read and task writing on her Doc `d1`, which he may share one hop further. -/
def capA : Cap :=
  { id := "cap-a", issuer := "alice", holder := .vault "bob", share := 1, signer := "alice-peer",
    grant := [readOn d1, tasksOn d1], approvals := [⟨"alice-owner", "cap-a"⟩] }

/-- Bob passes reading on to everyone in `g-garden`. -/
def capB : Cap :=
  { id := "cap-b", issuer := "bob", holder := .group "g-garden", parent := "cap-a", signer := "bob-peer-light",
    grant := [readOn d1], approvals := [⟨"bob-owner", "cap-b"⟩] }

/-- A cap with `cap`'s fields changed by `f`, approved again by `owner` under its new id. -/
def recap (c : Cap) (newId owner : String) (f : Cap → Cap := fun c => c) : Cap :=
  { f c with id := newId, approvals := [⟨owner, newId⟩] }

def capAExpiring : Cap := recap capA "cap-a-100" "alice-owner" fun c => { c with conditions := { expires := some 100 } }

/-- Alice lets Bob share two hops on, and Bob gives the group a cap it may share one hop further. -/
def capA2 : Cap := recap capA "cap-a2" "alice-owner" fun c => { c with share := 2 }

def capG : Cap := recap capB "cap-g" "bob-owner" fun c => { c with parent := "cap-a2", share := 1 }

def capPublic : Cap :=
  { id := "cap-public", issuer := "alice", holder := .«public», signer := "alice-peer",
    grant := [readOn cityNotes], approvals := [⟨"alice-owner", "cap-public"⟩] }

/-- Aven, the agent Maia City owns, lets Bob read its vault; its device signs, and its owner approves by its own
quorum: Maia City's owner, Alice's vault, approves with her owner's key. -/
def capAven : Cap :=
  { id := "cap-aven", issuer := "aven", holder := .vault "bob", signer := "aven-peer",
    grant := [⟨.vault (vaultId "aven") false, .read, []⟩], approvals := [⟨"alice-owner", "cap-aven"⟩] }

/-- Alice lets Aven read `d1` and write tasks on it, and pass that on one hop: the cap Aven's actors run under (A27). -/
def capHost : Cap :=
  { id := "cap-host", issuer := "alice", holder := .vault "aven", share := 1, signer := "alice-peer",
    grant := [readOn d1, tasksOn d1], approvals := [⟨"alice-owner", "cap-host"⟩] }

/-- Aven's Peer, the actors' host, narrows it to reading `d1` for one hop of a run: an attenuation, which keeps Aven as
its holder and carries no approval (D16). -/
def attRead : Cap :=
  { id := "att-read", issuer := "aven", holder := .vault "aven", parent := "cap-host", kind := .attenuate,
    signer := "aven-peer", grant := [readOn d1] }

/-- A first hop that keeps both lines until 100, before `attRead`'s narrowing on the next. -/
def attTasks : Cap :=
  { attRead with
    id := "att-tasks", grant := [readOn d1, tasksOn d1], share := 1, conditions := { expires := some 100 } }

/-- A grant from Aven to Bob after a hop, which the cap may share one hop on: a holder change, so Aven's owners
approve it (D14). -/
def capHostBob : Cap :=
  { id := "cap-hb", issuer := "aven", holder := .vault "bob", parent := "att-pass", signer := "aven-peer",
    grant := [readOn d1] }

/-- Chains, each with the first rule it breaks, or none. -/
def chainExamples : List (String × List Cap × Option ChainError) := [
  ("Alice gives Bob read and task writing on d1", [capA], none),
  ("Bob passes reading on to g-garden", [capA, capB], none),
  ("Alice grants on Maia City, which she governs",
    [{ id := "cap-gov", issuer := "alice", holder := .vault "bob", signer := "alice-peer-light",
       grant := [readOn cityDome], approvals := [⟨"alice-owner", "cap-gov"⟩] }], none),
  ("a role, pinned by its id",
    [{ id := "cap-role", issuer := "alice", holder := .vault "bob", signer := "alice-peer", role := "role-editor-1",
       approvals := [⟨"alice-owner", "cap-role"⟩] }], none),
  ("the public: every member of the network", [capPublic], none),
  ("no chain", [], some .empty),
  ("a root that names a parent", [capB], some (.notRoot "cap-b")),
  ("Alice grants on Bob's vault, which she doesn't govern",
    [{ capA with id := "cap-x", grant := [readOn b1], approvals := [⟨"alice-owner", "cap-x"⟩] }],
    some (.authority "cap-x" (readOn b1))),
  ("a Doc the reader doesn't know: no authority",
    [{ capA with id := "cap-u", grant := [readOn (docOf "u1")], approvals := [⟨"alice-owner", "cap-u"⟩] }],
    some (.authority "cap-u" (readOn (docOf "u1")))),
  ("a child that reads where its parent writes: another verb",
    [capA, recap capB "cap-v" "bob-owner" fun c => { c with grant := [⟨.doc d1, .patch, []⟩] }],
    some (.wider "cap-v")),
  ("a child whose footprint names fields within its parent's",
    [capA, recap capB "cap-f" "bob-owner" fun c => { c with grant := [⟨.doc d1, .put, [⟨tasks, .patch, some []⟩]⟩] }],
    none),
  ("a child whose footprint is another type",
    [capA, recap capB "cap-t" "bob-owner" fun c => { c with grant := [⟨.doc d1, .put, [⟨d2, .patch, none⟩]⟩] }],
    some (.wider "cap-t")),
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
    [capA, recap capB "cap-w" "bob-owner" fun c => { c with grant := [readOn d1, readOn d2] }],
    some (.wider "cap-w")),
  ("a root that may not be shared on", [{ capA with share := 0 }], none),
  ("shared further than the parent allows",
    [recap capA "cap-a0" "alice-owner" fun c => { c with share := 0 },
     recap capB "cap-b0" "bob-owner" fun c => { c with parent := "cap-a0" }],
    some (.share "cap-b0")),
  ("a child of a group's cap, issued by someone in the group",
    [capA2, capG,
     { id := "cap-g2", issuer := "alice", holder := .vault "bob", parent := "cap-g", signer := "alice-peer",
       grant := [readOn d1], approvals := [⟨"alice-owner", "cap-g2"⟩] }], none),
  ("a child of a group's cap, issued by a vault not in the group",
    [capA2, capG,
     { id := "cap-g3", issuer := "maia-city", holder := .vault "bob", parent := "cap-g", signer := "alice-peer",
       grant := [readOn d1], approvals := [⟨"alice-owner", "cap-g3"⟩] }],
    some (.issuer "cap-g3")),
  ("a child that drops its parent's expiry",
    [capAExpiring, recap capB "cap-e" "bob-owner" fun c => { c with parent := "cap-a-100" }],
    some (.conditions "cap-e")),
  ("a child that keeps its parent's expiry",
    [capAExpiring,
     recap capB "cap-e2" "bob-owner" fun c => { c with parent := "cap-a-100", conditions := { expires := some 50 } }],
    none),
  ("Aven's cap, approved by its owner Maia City, which approves through Alice's key", [capAven], none),
  ("Aven's cap, approved by Bob's key, which is above neither", [recap capAven "cap-aven-b" "bob-owner"],
    some (.approval "cap-aven-b")),
  ("Aven's Peer narrows Alice's cap for one hop of a run: an attenuation, with no approval", [capHost, attRead], none),
  ("and narrows it again on the next hop, with no later expiry",
    [capHost, attTasks,
     { attRead with id := "att-read-50", parent := "att-tasks", conditions := { expires := some 50 } }], none),
  ("an attenuation that starts a chain", [{ attRead with parent := none }], some (.notRoot "att-read")),
  ("an attenuation that hands the cap to Bob", [capHost, { attRead with id := "att-bob", holder := .vault "bob" }],
    some (.holder "att-bob")),
  ("an attenuation wider than its parent",
    [capHost, { attRead with id := "att-wide", grant := [readOn d1, readOn d2] }], some (.wider "att-wide")),
  ("an attenuation signed by a device of another vault",
    [capHost, { attRead with id := "att-dev", signer := "alice-peer" }], some (.signer "att-dev")),
  ("an attenuation by a vault that doesn't hold the parent",
    [capHost, { attRead with id := "att-alice", issuer := "alice", signer := "alice-peer" }],
    some (.issuer "att-alice")),
  ("an attenuation that drops its parent's expiry",
    [capHost, attTasks, { attRead with id := "att-late", parent := "att-tasks" }], some (.conditions "att-late")),
  ("an attenuation that may share further than its parent", [capHost, { attRead with id := "att-share", share := 2 }],
    some (.share "att-share")),
  ("after a hop, the cap reaches Bob only by a grant Aven's owners approve (D14)",
    [capHost, { attRead with id := "att-pass", share := 1 }, capHostBob], some (.approval "cap-hb")),
  ("approved by Aven's owner Maia City, through Alice's key",
    [capHost, { attRead with id := "att-pass", share := 1 }, recap capHostBob "cap-hb2" "alice-owner"], none),
  ("a group's cap, narrowed by someone in the group",
    [capA2, capG,
     { id := "att-g", issuer := "alice", holder := .group "g-garden", parent := "cap-g", kind := .attenuate,
       signer := "alice-peer", grant := [readOn d1] }], none),
  ("the public narrows nothing",
    [capPublic,
     { id := "att-pub", issuer := "alice", holder := .«public», parent := "cap-public", kind := .attenuate,
       signer := "alice-peer", grant := [readOn cityNotes] }], some (.issuer "att-pub"))]

-- Vault ids are UTF-8 bytes, which the kernel doesn't compute, so the chains are checked as the module builds.
#guard chainExamples.all fun (_, cs, e) => chainError castCtx cs == e

/-- Which branches a cap writes on, each answer written out by hand: main only on main, proposals on every branch but
main, one branch only on it. -/
def branchExamples : List (Branches × String × Bool) := [
  (.any, "main", true), (.main, "main", true), (.main, "fix-title", false), (.proposals, "main", false),
  (.proposals, "fix-title", true), (.one "fix-title", "fix-title", true), (.one "fix-title", "other", false),
  (.one "main", "main", false)]

#guard branchExamples.all fun (b, br, a) => b.allows br.toUTF8.toList == a

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

/-- The cast with the garden, a coop of Alice's and Bob's vaults that needs both. -/
def garden : Vault := ⟨"garden", "The garden", .coop, [.vault "alice", .vault "bob"]⟩

def gardenCast : Tree := { cast with vaults := cast.vaults ++ [garden] }

def gardenThreshold (v : String) : Nat := if v == "garden" then 2 else 1

/-- Approvals where an owner is a vault, which approves by its own quorum: signatures, the vault, the digest, and
whether it holds. -/
def quorumExamples : List (String × List Sig × String × String × Bool) := [
  ("Maia City, through Alice's vault and her owner's key", [⟨"alice-owner", "d"⟩], "maia-city", "d", true),
  ("Aven, through Maia City, through Alice", [⟨"alice-owner", "d"⟩], "aven", "d", true),
  ("Maia City, over another digest", [⟨"alice-owner", "e"⟩], "maia-city", "d", false),
  ("Maia City, by Bob's owner, who is above neither", [⟨"bob-owner", "d"⟩], "maia-city", "d", false),
  ("Maia City, by a device's key, which owns nothing", [⟨"alice-peer", "d"⟩], "maia-city", "d", false),
  ("the garden needs both of its vaults: Alice's alone", [⟨"alice-owner", "d"⟩], "garden", "d", false),
  ("the garden: Alice's and Bob's", [⟨"alice-owner", "d"⟩, ⟨"bob-owner", "d"⟩], "garden", "d", true),
  ("the garden: Alice's twice is one vault", [⟨"alice-owner", "d"⟩, ⟨"alice-owner", "d"⟩], "garden", "d", false)]

theorem quorum_examples :
    quorumExamples.all (fun (_, sigs, v, d, b) => gardenCast.approves gardenThreshold v d sigs == b) = true := by decide

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

/-- A target as avenOS shows it, the Docs and vaults by the names `name` gives them. -/
def targetText (name : Core.DocId → String) (vault : Core.Bytes → String) : Core.Target → String
  | .doc d => name d
  | .vault v b => s!"every Doc of {vault v}" ++ if b then " and below" else ""
  | .vaultType v t b => s!"every {name t} of {vault v}" ++ if b then " and below" else ""
  | .actor a b => s!"the actor {name a}" ++ if b then " and what it spawned" else ""
  | .vaultDef v d => s!"every actor {name d} of {vault v}"

/-- A line as avenOS shows it: its verb, its target, and for a write what each step may do. -/
def Line.text (name : Core.DocId → String) (vault : Core.Bytes → String) (l : Line) : String :=
  s!"{verbName l.verb} {targetText name vault l.target}" ++
    if l.footprint.isEmpty then "" else
      " (" ++ ", ".intercalate (l.footprint.map fun g => s!"{g.verb.name} {name g.type}" ++
        match g.fields with | none => "" | some _ => " (some fields)") ++ ")"

/-- The cast's names for its Docs and vaults. -/
def castName (d : Core.DocId) : String :=
  ((([d1, d2, b1, cityNotes, cityDome, tasks].zip ["d1", "d2", "b1", "city-notes", "city-dome", "tasks"]).find?
    (·.1 == d)).map (·.2)).getD "a Doc"

def castVault (v : Core.Bytes) : String :=
  ((["alice", "bob", "maia-city", "aven"].find? (vaultId · == v))).getD "a vault"

def Cap.text (c : Cap) (roles : List Role) : String :=
  (match c.kind with
    | .grant => s!"{c.issuer} grants {c.holder.text}: "
    | .attenuate => s!"{c.issuer} narrows the cap {c.holder.text} holds to: ") ++
    ", ".intercalate ((c.grants roles).map (Line.text castName castVault)) ++
    (if c.share = 0 then "; no sharing on" else s!"; may share on {c.share} more hop(s)") ++
    (match c.conditions.expires with | some t => s!"; until {t}" | none => "")

#guard capA.text [] == "alice grants bob: read d1, put d1 (put-new tasks, patch tasks); may share on 1 more hop(s)"
#guard capB.text [] == "bob grants everyone in g-garden: read d1; no sharing on"
#guard attRead.text [] == "aven narrows the cap aven holds to: read d1; no sharing on"

-- Every cap of the examples is a Value the codec allows, so its bytes and its id name it exactly.
#guard (chainExamples.flatMap (·.2.1)).all fun c => Core.Canon c.body

end Aven.ID
