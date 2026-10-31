import Aven.ID.Cast
import Aven.ID.Revoke
import Aven.ID.Epochs
import Aven.ID.Recover
import Aven.ID.Network
import Aven.ID.CapsCbor
import Aven.ID.Keeping
import Aven.ID.Keep

/-! # Caps on the cast

Examples written once, beside the rules they show, each with its answer written out by hand and checked by `lake build`
(README, rule 10): by `decide` where the kernel computes them, and by `#guard` where they go through UTF-8. They run on
the cast's tree: Alice's vault owns Maia City, which owns Aven; Bob's vault is a person's; Alice and Bob are in the
group `g-garden`. `Aven.ID.CapsJson` exports them as vectors. -/

namespace Aven.ID

/-- The cast's Docs, each named by the BLAKE3 hash of a label, so every id is 32 bytes as Core's are and Rust can read
it. `tasks` and `notes` are type Docs, `g-garden` is the group of Alice's and Bob's vaults, and `album` is a collection
of Alice's. -/
def docOf (s : String) : Core.DocId := ⟨Core.blake3 s.toUTF8.toList⟩

def d1 : Core.DocId := docOf "d1"
def d2 : Core.DocId := docOf "d2"
def b1 : Core.DocId := docOf "b1"
def cityNotes : Core.DocId := docOf "city-notes"
def cityDome : Core.DocId := docOf "city-dome"
def tasks : Core.DocId := docOf "tasks"
def notes : Core.DocId := docOf "notes"
def gGarden : Core.DocId := docOf "g-garden"
def album : Core.DocId := docOf "album"

/-- The parameters caps bounds on `core/1`'s writes: the type a step writes, and the fields it writes. -/
def typeParam : Core.Bytes := "type".toUTF8.toList
def fieldsParam : Core.Bytes := "fields".toUTF8.toList

/-- A Doc, and a field, as a parameter's value. -/
def docValue (d : Core.DocId) : Core.Value := .bytes d.hash.bytes
def fieldValue (f : String) : Core.Value := .text f.toUTF8.toList

/-- Reading a Doc. -/
def readOn (d : Core.DocId) : Line := ⟨coreOp .read, .doc d .self, []⟩

/-- A `core/1` write on a Doc, of one type, and of some fields or any. -/
def writeOn (o : Core.CoreOp) (d t : Core.DocId) (fields : Option (List String) := none) : Line :=
  ⟨coreOp o, .doc d .self,
    (typeParam, some [docValue t]) :: (fields.map fun fs => (fieldsParam, some (fs.map fieldValue))).toList⟩

/-- Writing tasks into a Doc: new ones, and patches to any field. -/
def tasksOn (d : Core.DocId) : Grant := [writeOn .put d tasks, writeOn .patch d tasks]

/-- Keeping the Docs of a target. -/
def keepOn (t : Core.Target) : Line := ⟨coreOp .keep, t, []⟩

/-- What each of the cast's Docs is, as its genesis fixes it: its vault, and its root type. -/
def castFacts (d : Core.DocId) : Option Core.Facts :=
  if d == d1 || d == d2 || d == cityNotes then some ⟨d, vaultId "alice", notes⟩
  else if d == b1 then some ⟨d, vaultId "bob", tasks⟩
  else if d == cityDome then some ⟨d, vaultId "maia-city", notes⟩
  else if d == gGarden then some ⟨d, vaultId "alice", groupType⟩
  else if d == album then some ⟨d, vaultId "alice", collectionType⟩
  else none

/-- What a reader of the cast knows: the tree, one owner per approval, who is in `g-garden`, one role, and what each
Doc is. -/
def castCtx : Ctx where
  tree := cast
  inGroup := fun g v => g == gGarden && (v == "alice" || v == "bob")
  roles := [⟨"role-editor-1", "Editor", readOn d1 :: tasksOn d1⟩]
  facts := castFacts

/-- Alice gives Bob read and task writing on her Doc `d1`, which he may share one hop further. -/
def capA : Cap :=
  { id := "cap-a", issuer := "alice", holder := .vault "bob", share := 1, signer := "alice-peer",
    grant := readOn d1 :: tasksOn d1, approvals := [⟨"alice-owner", "cap-a"⟩] }

/-- Bob passes reading on to everyone in `g-garden`. -/
def capB : Cap :=
  { id := "cap-b", issuer := "bob", holder := .group gGarden, parent := "cap-a", signer := "bob-peer-light",
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
    grant := [⟨coreOp .read, .vault (vaultId "aven") false, []⟩], approvals := [⟨"alice-owner", "cap-aven"⟩] }

/-- Alice lets Aven read `d1` and write tasks on it, and pass that on one hop: the cap Aven's actors run under (A27). -/
def capHost : Cap :=
  { id := "cap-host", issuer := "alice", holder := .vault "aven", share := 1, signer := "alice-peer",
    grant := readOn d1 :: tasksOn d1, approvals := [⟨"alice-owner", "cap-host"⟩] }

/-- Aven's Peer, the actors' host, narrows it to reading `d1` for one hop of a run: an attenuation, which keeps Aven as
its holder and carries no approval (D16). -/
def attRead : Cap :=
  { id := "att-read", issuer := "aven", holder := .vault "aven", parent := "cap-host", form := .attenuate,
    signer := "aven-peer", grant := [readOn d1] }

/-- A first hop that keeps both lines until 100, before `attRead`'s narrowing on the next. -/
def attTasks : Cap :=
  { attRead with
    id := "att-tasks", grant := readOn d1 :: tasksOn d1, share := 1, conditions := { expires := some 100 } }

/-- A grant from Aven to Bob after a hop, which the cap may share one hop on: a holder change, so Aven's owners
approve it (D14). -/
def capHostBob : Cap :=
  { id := "cap-hb", issuer := "aven", holder := .vault "bob", parent := "att-pass", signer := "aven-peer",
    grant := [readOn d1] }

/-- Bob's default keep cap: everything of Bob's own, to Maia City's keeper, the Aven Peer acting for Aven, approved as
Bob joins (A22). -/
def keepBob : Cap := defaultKeep "bob" "aven" "bob-peer-light" [⟨"bob-owner", "keep-bob"⟩]

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
  ("a child with an op its parent doesn't name",
    [capA, recap capB "cap-v" "bob-owner" fun c => { c with grant := [writeOn .remove d1 tasks] }],
    some (.wider "cap-v")),
  ("a child that bounds the fields its parent leaves free",
    [capA, recap capB "cap-f" "bob-owner" fun c => { c with grant := [writeOn .patch d1 tasks (some ["done"])] }],
    none),
  ("a child that patches another type",
    [capA, recap capB "cap-t" "bob-owner" fun c => { c with grant := [writeOn .patch d1 d2] }],
    some (.wider "cap-t")),
  ("a child that drops its parent's bound on the type",
    [capA, recap capB "cap-nt" "bob-owner" fun c => { c with grant := [⟨coreOp .patch, .doc d1 .self, []⟩] }],
    some (.wider "cap-nt")),
  ("Alice shares what her album lists, a collection of hers (A32)",
    [recap capA "cap-album" "alice-owner" fun c => { c with grant := [⟨coreOp .read, .doc album .lists, []⟩] }],
    none),
  ("a child that widens one Doc to what it lists",
    [capA, recap capB "cap-l" "bob-owner" fun c => { c with grant := [⟨coreOp .read, .doc d1 .lists, []⟩] }],
    some (.wider "cap-l")),
  ("held by a group the reader doesn't know: no group Doc (A39)",
    [recap capA "cap-ug" "alice-owner" fun c => { c with holder := .group (docOf "g-unknown") }],
    some (.group "cap-ug")),
  ("held by a Doc that is no group",
    [recap capA "cap-ng" "alice-owner" fun c => { c with holder := .group d2 }], some (.group "cap-ng")),
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
     { id := "att-g", issuer := "alice", holder := .group gGarden, parent := "cap-g", form := .attenuate,
       signer := "alice-peer", grant := [readOn d1] }], none),
  ("Bob's default keep cap: everything of Bob's, to the Aven Peer", [keepBob], none),
  ("Bob's default keep cap with no owner's approval: an ordinary grant (D14)", [{ keepBob with approvals := [] }],
    some (.approval "keep-bob")),
  ("Maia City keeping Bob's Docs at its own keeper: no authority over Bob's vault",
    [{ keepBob with
       id := "keep-mc", issuer := "maia-city", signer := "alice-peer", approvals := [⟨"alice-owner", "keep-mc"⟩] }],
    some (.authority "keep-mc" (keepOn (.vault (vaultId "bob") false)))),
  ("a keep cap that may share", [recap keepBob "keep-bob-1" "bob-owner" fun c => { c with share := 1 }],
    some (.keepShares "keep-bob-1")),
  ("the keeper passing Bob's Docs on to Alice",
    [keepBob,
     { id := "keep-pass", issuer := "aven", holder := .vault "alice", parent := "keep-bob", signer := "aven-peer",
       grant := [keepOn (.vault (vaultId "bob") false)], approvals := [⟨"alice-owner", "keep-pass"⟩] }],
    some (.share "keep-pass")),
  ("the keeper narrowing it to Bob's tasks",
    [keepBob,
     { id := "keep-tasks", issuer := "aven", holder := .vault "aven", parent := "keep-bob", form := .attenuate,
       signer := "aven-peer", grant := [keepOn (.vaultType (vaultId "bob") tasks false)] }], none),
  ("the public narrows nothing",
    [capPublic,
     { id := "att-pub", issuer := "alice", holder := .«public», parent := "cap-public", form := .attenuate,
       signer := "alice-peer", grant := [readOn cityNotes] }], some (.issuer "att-pub"))]

-- Vault ids are UTF-8 bytes, which the kernel doesn't compute, so the chains are checked as the module builds.
#guard chainExamples.all fun (_, cs, e) => chainError castCtx cs == e

/-- The facts of some of the cast's Docs, as their genesis fixes them: `b1` holds Bob's tasks, `b2` Bob's notes. -/
def factsOf (d : Core.DocId) (v : String) (t : Core.DocId) : Core.Facts := ⟨d, vaultId v, t⟩

def b2 : Core.DocId := docOf "b2"

/-- Bob's tasks are kept at Alice's Peer too, a member's own keeper. -/
def keepBobTasks : Cap :=
  { id := "keep-bob-tasks", issuer := "bob", holder := .vault "alice", signer := "bob-peer-light",
    grant := [keepOn (.vaultType (vaultId "bob") tasks false)], approvals := [⟨"bob-owner", "keep-bob-tasks"⟩] }

/-- Who keeps a Doc, each answer written out by hand. No keep cap here reaches below or through a collection, so who
governs whom, which actor spawned which and what a collection lists never matter. -/
def keepingExamples : List (String × List Cap × Core.Facts × List String) := [
  ("Bob's default: the Aven Peer keeps Bob's tasks", [keepBob], factsOf b1 "bob" tasks, ["aven"]),
  ("Bob's default keeps nothing of Alice's", [keepBob], factsOf d1 "alice" notes, []),
  ("Bob's tasks at Alice's Peer as well", [keepBob, keepBobTasks], factsOf b1 "bob" tasks, ["aven", "alice"]),
  ("Bob's notes only at the Aven Peer", [keepBob, keepBobTasks], factsOf b2 "bob" notes, ["aven"]),
  ("Bob withdrew the default: Bob's tasks only at Alice's Peer", [keepBobTasks], factsOf b1 "bob" tasks, ["alice"]),
  ("Maia City's default keeps nothing of Bob's", [defaultKeep "maia-city" "aven" "alice-peer" []],
    factsOf b1 "bob" tasks, [])]

/-- Who governs whom, which actor spawned which and what a collection lists, for the keeping examples: nothing. -/
def noGov (_ _ : Core.Bytes) : Bool := false
def noSpawn (_ _ : Core.DocId) : Bool := false
def noLists (_ _ : Core.DocId) : Bool := false

#guard keepingExamples.all fun (_, caps, f, ks) => keepersOf noGov noSpawn noLists castCtx.roles caps f == ks

/-! ### What a keeper keeps (A22, A44)

The Aven Peer keeps for Aven's vault, which offers storage to Maia City's members, Alice and Bob. Bob's default keep cap
comes with Bob's Docs `b1` and `b2`, which Bob's device resolved it to; Alice's keep cap with Alice's `d1`. Three keep
caps it must not take come too: Bob's for Alice's Peer, one of Bob's without an owner's approval, and one for Maia City
signed by a device of Alice's vault. Then Bob withdraws the default, Bob's device tries to withdraw Alice's keep cap,
and Alice deletes `d1`, then lists it again. Last, Aven's offers change: to Alice alone, withdrawn, unapproved, or
another vault's. -/

def b3 : Core.DocId := docOf "b3"
def b4 : Core.DocId := docOf "b4"

def keepAlice : Cap :=
  { id := "keep-alice", issuer := "alice", holder := .vault "aven", signer := "alice-peer",
    grant := [keepOn (.doc d1 .self)], approvals := [⟨"alice-owner", "keep-alice"⟩] }

def listBob : Listing := ⟨keepBob, [(b1, 500), (b2, 501)]⟩
def listAlice : Listing := ⟨keepAlice, [(d1, 100)]⟩
def listForAlicesPeer : Listing := ⟨keepBobTasks, [(b3, 502)]⟩
def listUnapproved : Listing := ⟨{ keepBob with id := "keep-bob-x", approvals := [] }, [(b4, 503)]⟩
def listCity : Listing :=
  ⟨{ id := "keep-city", issuer := "maia-city", holder := .vault "aven", signer := "alice-peer",
     grant := [keepOn (.vault (vaultId "maia-city") false)], approvals := [⟨"alice-owner", "keep-city"⟩] },
   [(cityDome, 600)]⟩

/-- Maia City's members, Alice's and Bob's vaults, as a group. -/
def gMembers : Core.DocId := docOf "g-members"

/-- Aven's offer to Maia City's members (A44): up to 10 GB each, at 1 MB a second, approved by Aven's owner Maia City,
through Alice's key. -/
def avenOffer : Cap :=
  { id := "offer-members", issuer := "aven", holder := .group gMembers, signer := "aven-peer",
    grant := [offerLine "aven" 1000000 10000000000], approvals := [⟨"alice-owner", "offer-members"⟩] }

def avenBooks : Books :=
  { keeper := "aven", tree := cast, listings := [listBob, listAlice, listForAlicesPeer, listUnapproved, listCity],
    offers := [avenOffer], inGroup := fun g v => g == gMembers && (v == "alice" || v == "bob") }

/-- The Docs the examples ask about. -/
def bookDocs : List Core.DocId := [b1, b2, d1, b3, b4, cityDome]

/-- What the Aven Peer keeps, each answer written out by hand. -/
def bookCases : List (String × Books × List Core.DocId) := [
  ("Bob's and Alice's keep caps, and three it must not take", avenBooks, [b1, b2, d1]),
  ("Bob withdraws the default keep cap", { avenBooks with orders := [⟨.withdraw "keep-bob", "bob-peer-light"⟩] }, [d1]),
  ("Bob's device withdraws Alice's keep cap: not Bob's to withdraw",
    { avenBooks with orders := [⟨.withdraw "keep-alice", "bob-peer-light"⟩] }, [b1, b2, d1]),
  ("Alice deletes d1", { avenBooks with orders := [⟨.delete d1, "alice-peer-light"⟩] }, [b1, b2]),
  ("and lists it again under a new keep cap: still gone",
    { avenBooks with
      listings := avenBooks.listings ++ [⟨recap keepAlice "keep-alice-2" "alice-owner", [(d1, 100)]⟩],
      orders := [⟨.delete d1, "alice-peer-light"⟩] }, [b1, b2]),
  ("Aven offers storage to Alice alone: Bob's keep cap names it, but no offer covers Bob (A44)",
    { avenBooks with
      offers := [recap avenOffer "offer-alice" "alice-owner" fun c => { c with holder := .vault "alice" }] }, [d1]),
  ("Aven withdraws its offer: nothing is kept",
    { avenBooks with orders := [⟨.withdraw "offer-members", "aven-peer"⟩] }, []),
  ("an offer Aven's owners didn't approve covers no one",
    { avenBooks with offers := [{ avenOffer with approvals := [] }] }, []),
  ("an offer from another vault isn't Aven's to stand by",
    { avenBooks with offers := [recap avenOffer "offer-bob" "bob-owner" fun c =>
      { c with issuer := "bob", signer := "bob-peer-light" }] }, [])]

#guard bookCases.all fun (_, b, ks) => bookDocs.filter b.keeps == ks
-- The quota Aven keeps for a member is its offer's, and nothing for anyone the offer doesn't cover.
#guard avenBooks.quota "bob" == 10000000000 && avenBooks.quota "maia-city" == 0

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

/-- The cast's names for its Docs and vaults. -/
def castName (d : Core.DocId) : String :=
  ((([d1, d2, b1, cityNotes, cityDome, tasks, notes, gGarden, album].zip
    ["d1", "d2", "b1", "city-notes", "city-dome", "tasks", "notes", "g-garden", "album"]).find? (·.1 == d)).map
    (·.2)).getD "a Doc"

def castVault (v : Core.Bytes) : String :=
  ((["alice", "bob", "maia-city", "aven"].find? (vaultId · == v))).getD "a vault"

/-- How avenOS shows a cap for a passkey tap: written from the cap itself (A2, rule 25). -/
def Holder.text : Holder → String
  | .vault v => v
  | .group g => s!"everyone in {castName g}"
  | .«public» => "every member of the network"

/-- A target as avenOS shows it, the Docs and vaults by the names `name` gives them. -/
def targetText (name : Core.DocId → String) (vault : Core.Bytes → String) : Core.Target → String
  | .doc d .self => name d
  | .doc d .spawned => s!"the actor {name d} and what it spawned"
  | .doc d .lists => s!"{name d} and what it lists"
  | .vault v b => s!"every Doc of {vault v}" ++ if b then " and below" else ""
  | .vaultType v t b => s!"every {name t} of {vault v}" ++ if b then " and below" else ""

/-- An op as avenOS shows it: a core op by its name, any other by its id. -/
def opText (o : Core.OpId) : String :=
  (([Core.CoreOp.read, .put, .patch, .remove, .edit, .tell, .keep, .share].find? (coreOp · == o)).map
    (·.name)).getD o.text

/-- A parameter's value as avenOS shows it: a Doc by its name, text as itself. -/
def valueText (name : Core.DocId → String) : Core.Value → String
  | .bytes b => name ⟨⟨b⟩⟩
  | .text t => Core.utf8Text t
  | _ => "a value"

/-- A line as avenOS shows it: its op, its target, and each bound on a parameter. -/
def Line.text (name : Core.DocId → String) (vault : Core.Bytes → String) (l : Line) : String :=
  s!"{opText l.op} {targetText name vault l.doc}" ++
    if l.params.isEmpty then "" else
      " (" ++ ", ".intercalate (l.params.map fun (p, b) => s!"{Core.utf8Text p} " ++
        match b with
        | none => "any"
        | some vs => " or ".intercalate (vs.map (valueText name))) ++ ")"

def Cap.text (c : Cap) (roles : List Role) : String :=
  (match c.form with
    | .grant => s!"{c.issuer} grants {c.holder.text}: "
    | .attenuate => s!"{c.issuer} narrows the cap {c.holder.text} holds to: ") ++
    ", ".intercalate ((c.grants roles).map (Line.text castName castVault)) ++
    (if c.share = 0 then "; no sharing on" else s!"; may share on {c.share} more hop(s)") ++
    (match c.conditions.expires with | some t => s!"; until {t}" | none => "")

#guard capA.text [] ==
  "alice grants bob: read d1, put d1 (type tasks), patch d1 (type tasks); may share on 1 more hop(s)"
#guard capB.text [] == "bob grants everyone in g-garden: read d1; no sharing on"
#guard attRead.text [] == "aven narrows the cap aven holds to: read d1; no sharing on"

-- Every cap of the examples is a Value the codec allows, so its bytes and its id name it exactly.
#guard (chainExamples.flatMap (·.2.1)).all fun c => Core.Canon c.body

end Aven.ID
