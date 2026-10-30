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
    none)]

-- Vault ids are UTF-8 bytes, which the kernel doesn't compute, so the chains are checked as the module builds.
#guard chainExamples.all fun (_, cs, e) => chainError castCtx cs == e

/-! ### Revocations, on Core's envelopes

Each example envelope is a Core envelope named as Core names it, by BLAKE3 of its encoding, and carries what caps
reads of it in its body: the vault it writes for, the caps it writes under and the revocations it acknowledges. Names
go through BLAKE3 and UTF-8, so the verdicts are checked as the module builds. -/

namespace RevokeExamples

open Aven.Core (Envelope Hash Bytes Value DocId blake3)

private def utf8 (s : String) : Bytes := s.toUTF8.toList

/-- Core's name: BLAKE3 of the envelope's encoding. -/
def nm : Envelope → Hash := Envelope.name blake3

def capA : Hash := blake3 (utf8 "cap-a")
def capB : Hash := blake3 (utf8 "cap-b")
def capTeam : Hash := blake3 (utf8 "cap-team")
def revA : Hash := blake3 (utf8 "rev-a")
def revT : Hash := blake3 (utf8 "rev-t")
/-- A name no envelope here has. -/
def zz : Hash := blake3 (utf8 "zz")

def notes : DocId := ⟨blake3 (utf8 "the notes' genesis")⟩

/-- An example envelope at its writer's place `seq`, with its label, vault, caps and acks in its body. It names what it
builds on as deps, never as prev, so its past is what it lists. -/
def env (writer seq : Nat) (label vault : String) (caps acks deps : List Hash) : Envelope :=
  { doc := notes, branch := utf8 "main", writer, seq, prev := none, deps,
    body := .map [(utf8 "acks", .array (acks.map Hash.value)), (utf8 "caps", .array (caps.map Hash.value)),
      (utf8 "label", .text (utf8 label)), (utf8 "vault", .text (utf8 vault))],
    signer := utf8 vault, sig := [] }

private def field (e : Envelope) (key : String) : Option Value :=
  match e.body with
  | .map kvs => (kvs.find? (·.1 == utf8 key)).map (·.2)
  | _ => none

private def hashes : Option Value → List Hash
  | some (.array vs) => vs.filterMap fun | .bytes b => some ⟨b⟩ | _ => none
  | _ => []

/-- What caps reads of an example envelope: its body's vault, caps and acks. -/
def reads : Reads :=
  { vault := fun e => match field e "vault" with | some (.text b) => String.fromUTF8! ⟨b.toArray⟩ | _ => "",
    caps := fun e => hashes (field e "caps"), acks := fun e => hashes (field e "acks") }

/-- Its label, for the vectors. -/
def label (e : Envelope) : String :=
  match field e "label" with
  | some (.text b) => String.fromUTF8! ⟨b.toArray⟩
  | _ => ""

/-! A Doc cap revoked inside the Doc: `r0` is Alice's revocation of `cap-a`, after `b1`. -/

def b1 : Envelope := env 2 1 "b1" "bob" [capA] [] []
def r0 : Envelope := env 1 1 "r0" "alice" [] [] [nm b1]
def b2 : Envelope := env 2 2 "b2" "bob" [capA] [] [nm r0]
def b3 : Envelope := env 2 3 "b3" "bob" [capA] [] [nm b1]
def a1 : Envelope := env 1 2 "a1" "alice" [] [revA] [nm b3]
def c1 : Envelope := env 3 1 "c1" "maia-city" [capA, capB] [] [nm b1]

def docCapDoc : List Envelope := [b1, r0, b2, b3, a1, c1]

def docCapRevocations : List Revocation := [⟨revA, capA, some (nm r0), none⟩]

/-! A cap on a vault's Docs, revoked elsewhere and acknowledged here by Alice's `y1`. -/

def x1 : Envelope := env 2 1 "x1" "bob" [capTeam] [] []
def x2 : Envelope := env 2 2 "x2" "bob" [capTeam] [] [nm x1]
def y1 : Envelope := env 1 1 "y1" "alice" [] [revT] [nm x1]
def x3 : Envelope := env 2 3 "x3" "bob" [capTeam] [] [nm y1]
def y2 : Envelope := env 1 2 "y2" "alice" [] [revT] [nm x3]
def w1 : Envelope := env 2 4 "w1" "bob" [] [] [zz]

def elsewhereDoc : List Envelope := [x1, x2, y1, x3, y2, w1]

def elsewhereRevocations : List Revocation := [⟨revT, capTeam, none, none⟩]

/-- The same revocation, with its revoker's kept list naming `x1`. -/
def keptRevocations : List Revocation := [⟨revT, capTeam, none, some [nm x1]⟩]

/-! Bob's own ack of the revocation of his cap. -/

def x5 : Envelope := env 2 5 "x5" "bob" [capTeam] [] []
def y3 : Envelope := env 2 6 "y3" "bob" [] [revT] [nm x5]

/-- Verdicts, each written out by hand: a Doc, the revocations held, the envelope, and its verdict. -/
def revocationExamples : List (String × List Envelope × List Revocation × Envelope × Verdict) := [
  ("under a Doc cap, what the revocation had seen counts", docCapDoc, docCapRevocations, b1, .counts),
  ("written after seeing the revocation", docCapDoc, docCapRevocations, b2, .revoked revA),
  ("concurrent with the revocation: not in its past", docCapDoc, docCapRevocations, b3, .revoked revA),
  ("under a Doc cap, a later ack keeps nothing more", docCapDoc, docCapRevocations, b3, .revoked revA),
  ("revoking a cap ends what rests on it", docCapDoc, docCapRevocations, c1, .revoked revA),
  ("not under the revoked cap", docCapDoc, docCapRevocations, a1, .counts),
  ("elsewhere: an ack had seen it", elsewhereDoc, elsewhereRevocations, x1, .counts),
  ("elsewhere: no ack had seen it", elsewhereDoc, elsewhereRevocations, x2, .revoked revT),
  ("no laundering: written after an ack, acknowledged again later", elsewhereDoc, elsewhereRevocations, x3,
    .revoked revT),
  ("before any ack reaches the Doc, it still counts", elsewhereDoc.take 2, elsewhereRevocations, x2, .counts),
  ("a kept list keeps what it names", elsewhereDoc.take 2, keptRevocations, x1, .counts),
  ("and nothing else", elsewhereDoc.take 2, keptRevocations, x2, .revoked revT),
  ("the holder's own ack keeps nothing it wrote", [x5, y3], elsewhereRevocations, x5, .counts),
  ("waiting for what it builds on, named by hash", elsewhereDoc, elsewhereRevocations, w1, .waits [zz])]

#guard revocationExamples.all fun (_, doc, rs, e, v) => verdict nm reads doc rs e == v

end RevokeExamples

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
  s!"{c.issuer} grants {c.holder.text}: " ++
    ", ".intercalate ((c.grants roles).map (Line.text castName castVault)) ++
    (if c.share = 0 then "; no sharing on" else s!"; may share on {c.share} more hop(s)") ++
    (match c.conditions.expires with | some t => s!"; until {t}" | none => "")

#guard capA.text [] == "alice grants bob: read d1, put d1 (put-new tasks, patch tasks); may share on 1 more hop(s)"
#guard capB.text [] == "bob grants everyone in g-garden: read d1; no sharing on"

-- Every cap of the examples is a Value the codec allows, so its bytes and its id name it exactly.
#guard (chainExamples.flatMap (·.2.1)).all fun c => Core.Canon c.body

end Aven.ID
