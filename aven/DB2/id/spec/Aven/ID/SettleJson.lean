import Lean.Data.Json
import Aven.ID.Gen
import Aven.ID.Restore
import Aven.ID.TreeDoc
import Aven.ID.Records
import Aven.ID.Node
import Aven.ID.CatchUp

/-! # The settled tree's vectors (PEERS.md §5 and §6)

`settled.json`: sets of tree statements, each in several orders, with the tree `settle` gives (`Settled.listed`).
Each statement is the Core envelope of the tree Doc that carries it, as CBOR, under the name a peer stores it by, and
the tree is settled from those envelopes (`TreeDoc.settleDoc`) as a peer settles it:
`TreeExamples`, the races written out one by one, generated sets, and production's store migrated from every invite
trace (`Aven.ID.Restore`). `records.json`: records and the newest of each kind about each device (`Aven.ID.Records`).
aven-id's tests settle each input and compare (README rule 10). -/

open Lean

namespace Aven.ID
namespace SettleJson

open Settle TreeExamples

def hashJson (h : Core.Hash) : Json := h.text
def hashesJson (l : List Core.Hash) : Json := Json.arr (l.map hashJson).toArray

def GuardianKeys.json (g : GuardianKeys) : Json :=
  Json.mkObj [("ed25519", g.ed25519), ("mlDsa", g.mlDsa), ("xWing", g.xWing)]

def Genesis.json (g : Genesis) : Json :=
  Json.mkObj [("rpId", g.rpId), ("origins", toJson g.origins), ("claimant", g.claimant), ("passkey", g.passkey),
    ("devices", toJson g.devices), ("coop", g.coop), ("coopOwners", toJson g.coopOwners), ("agent", g.agent),
    ("avenPeer", g.avenPeer),
    ("guardian", GuardianKeys.json g.guardian), ("guardianVault", g.guardianVault),
    ("confirmers", toJson g.confirmers), ("signedBy", toJson g.signedBy)]

def TreeSays.json : TreeSays → Json
  | .genesis g => Json.mkObj [("kind", "genesis"), ("genesis", Genesis.json g)]
  | .signIn v d => Json.mkObj [("kind", "signIn"), ("vault", v), ("device", d)]
  | .ticket k => Json.mkObj [("kind", "ticket"), ("key", k)]
  | .withdrawal t => Json.mkObj [("kind", "withdrawal"), ("ticket", hashJson t)]
  | .claim t v p d g => Json.mkObj [("kind", "claim"), ("ticket", hashJson t), ("vault", v), ("passkey", p),
      ("device", d), ("guardian", GuardianKeys.json g)]
  | .confirm c => Json.mkObj [("kind", "confirm"), ("claim", hashJson c)]
  | .relayAdd d => Json.mkObj [("kind", "relayAdd"), ("vault", d)]
  | .relayRemove d => Json.mkObj [("kind", "relayRemove"), ("vault", d)]
  | .keeperAdd d => Json.mkObj [("kind", "keeperAdd"), ("vault", d)]
  | .keeperRemove d => Json.mkObj [("kind", "keeperRemove"), ("vault", d)]
  | .setAvenPeer k => Json.mkObj [("kind", "setAvenPeer"), ("key", k)]
  | .setOrigins os => Json.mkObj [("kind", "setOrigins"), ("origins", toJson os)]
  | .setGuardian v => Json.mkObj [("kind", "setGuardian"), ("vault", v)]

/-- The tree Doc of the vectors. -/
def treeDoc : Core.DocId := ⟨Core.blake3 (Body.utf8 "Maia City's tree")⟩

/-- A statement as a peer stores it: its name and its envelope's CBOR; the signer, parents and what it says are the
envelope's, written out to read. -/
def TreeStatement.json (s : TreeStatement) : Json :=
  Json.mkObj [("name", hashJson s.name),
    ("envelope", Core.hex (Core.encode (TreeDoc.envelope treeDoc s).value)),
    ("signer", s.signer), ("parents", hashesJson s.parents), ("says", TreeSays.json s.says)]

def Listed.json (l : Listed) : Json :=
  Json.mkObj [("counted", hashesJson l.counted), ("final", hashesJson l.final), ("standing", hashesJson l.standing),
    ("contested", hashesJson l.contested), ("members", toJson l.members), ("admitted", toJson l.admitted),
    ("relays", toJson l.relays), ("keepers", toJson l.keepers), ("avenPeer", toJson l.avenPeer),
    ("origins", toJson l.origins), ("guardianVault", toJson l.guardianVault)]

/-- A case: its statements, the names that fail their own checks, and the pinned genesis. -/
structure Case where
  name : String
  statements : List TreeStatement
  failing : List Core.Hash := []
  pinned : Core.Hash

/-- The envelopes a peer stores, and their own checks: the case's failing names fail. -/
def Case.ok (c : Case) (n : TreeDoc.Named) : Bool := !c.failing.contains n.name

def named (s : TreeStatement) : TreeDoc.Named := ⟨s.name, TreeDoc.envelope treeDoc s⟩

def Case.settled (c : Case) (order : List TreeStatement) : Listed :=
  (TreeDoc.settleDoc c.ok treeDoc c.pinned (order.map named)).listed c.statements

/-- The case in the order given: its input and the settled tree. -/
def Case.vector (c : Case) (label : String) (order : List TreeStatement) : Json :=
  Json.mkObj [("name", s!"{c.name}, {label}"),
    ("input", Json.mkObj [("doc", treeDoc.text), ("pinned", hashJson c.pinned),
      ("failing", hashesJson c.failing),
      ("statements", Json.arr (order.map TreeStatement.json).toArray)]),
    ("expected", Listed.json (c.settled order))]

/-- How many shuffled orders each case is written in, beside its own order and the reverse. -/
def shuffles : Nat := 4

/-- A case in its own order, the reverse and `shuffles` shuffled orders. -/
def Case.orders (c : Case) (seed : Nat) : List (String × List TreeStatement) :=
  [("as written", c.statements), ("reversed", c.statements.reverse)] ++
    (List.range shuffles).map fun i => (s!"shuffle {i + 1}", ((Rng.seed (seed * 31 + i + 1)).shuffle c.statements).1)

/-! ## The races, one by one -/

open TreeExamples in
def g : TreeStatement := ⟨100, "alice-passkey", [], .genesis alicesGenesis⟩

open TreeExamples in
def raceCases : List Case :=
  let t : TreeStatement := ⟨120, "alice-passkey", [100], .ticket "t-bob"⟩
  let bob : TreeStatement := ⟨500, "t-bob", [120], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩
  let leak : TreeStatement := ⟨300, "t-bob", [120], .claim 120 "mallory" "mallory-passkey" "mallory-peer" guardian⟩
  [{ name := "the genesis alone", statements := [g], pinned := 100 },
   { name := "the genesis and two sign-ins", pinned := 100,
     statements := [g, ⟨110, "alice-passkey", [100], .signIn "alice" "alice-phone"⟩,
       ⟨111, "alice-passkey", [100], .signIn "alice" "alice-laptop"⟩] },
   { name := "a claim, not yet acked", statements := [g, t, bob], pinned := 100 },
   { name := "a claim and its ack", pinned := 100,
     statements := [g, t, bob, ⟨510, "alice-peer", [500], .confirm 500⟩] },
   { name := "two claims of one ticket, none acked: the smaller hash", statements := [g, t, bob, leak], pinned := 100 },
   { name := "two claims, the larger acked: the final one", pinned := 100,
     statements := [g, t, bob, leak, ⟨510, "alice-peer", [500], .confirm 500⟩] },
   { name := "a withdrawal that never saw the claim wins", pinned := 100,
     statements := [g, t, bob, ⟨610, "alice-passkey", [120], .withdrawal 120⟩] },
   { name := "a withdrawal that saw the claim changes nothing", pinned := 100,
     statements := [g, t, bob, ⟨610, "alice-passkey", [500], .withdrawal 120⟩] },
   { name := "a claim that saw the withdrawal is out", pinned := 100,
     statements := [g, t, ⟨610, "alice-passkey", [120], .withdrawal 120⟩,
       ⟨500, "t-bob", [610], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩] },
   { name := "two admin devices ack two claims without seeing each other: contested, the smaller hash", pinned := 100,
     statements := [g, ⟨110, "alice-passkey", [100], .signIn "alice" "alice-peer-light"⟩, t, bob, leak,
       ⟨510, "alice-peer", [500], .confirm 500⟩, ⟨511, "alice-peer-light", [300, 110], .confirm 300⟩] },
   { name := "a withdrawal never wins over a final claim", pinned := 100,
     statements := [g, t, bob, ⟨510, "alice-peer", [500], .confirm 500⟩,
       ⟨610, "alice-passkey", [120], .withdrawal 120⟩] },
   { name := "an ack by no admin key makes nothing final", pinned := 100,
     statements := [g, t, bob, ⟨510, "bob-peer", [500], .confirm 500⟩] },
   { name := "a relay added, removed, and added again after", pinned := 100,
     statements := [g, ⟨700, "alice-passkey", [100], .relayAdd "bob"⟩,
       ⟨710, "alice-passkey", [700], .relayRemove "bob"⟩,
       ⟨720, "alice-passkey", [710], .relayAdd "bob"⟩] },
   { name := "a keeper added and removed at once: the remove", pinned := 100,
     statements := [g, ⟨700, "alice-passkey", [100], .keeperAdd "bob"⟩,
       ⟨710, "alice-passkey", [100], .keeperRemove "bob"⟩] },
   { name := "a ticket and a relay signed by an admin device, not the passkey: neither counts for anything",
     pinned := 100,
     statements := [g, ⟨120, "alice-peer", [100], .ticket "t-bob"⟩,
       ⟨500, "t-bob", [120], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩,
       ⟨700, "alice-peer", [100], .relayAdd "bob"⟩] },
   { name := "Maia City moves the Aven Peer to a new key; a device's change and a concurrent rival don't win",
     pinned := 100,
     statements := [g, ⟨110, "alice-passkey", [100], .setAvenPeer "aven-peer-2"⟩,
       ⟨120, "alice-peer", [100], .setAvenPeer "rogue-peer"⟩,
       ⟨130, "alice-passkey", [100], .setAvenPeer "aven-peer-3"⟩,
       ⟨140, "alice-passkey", [100], .setOrigins ["https://maia.city", "https://aven.maia.city"]⟩,
       ⟨150, "alice-passkey", [100], .setGuardian "new-guardian"⟩] },
   { name := "a later change of the Aven Peer's key wins over the one it saw", pinned := 100,
     statements := [g, ⟨110, "alice-passkey", [100], .setAvenPeer "aven-peer-2"⟩,
       ⟨130, "alice-passkey", [110], .setAvenPeer "aven-peer-3"⟩] },
   { name := "a statement whose past doesn't reach the genesis", pinned := 100,
     statements := [g, ⟨120, "alice-passkey", [99], .ticket "t-bob"⟩,
       ⟨500, "t-bob", [120], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩] },
   { name := "a ticket that fails its own checks", statements := [g, t, bob], failing := [120], pinned := 100 }]

/-! ## Generated sets -/

/-- A random set of statements after `TreeExamples`' genesis: sign-ins, tickets, claims (some by a leaked link, some
naming another guardian), acks by admin devices or by members, withdrawals, list adds and removes, each naming one or
two earlier statements as its tips; a few fail their own checks. Names are distinct, in random order. -/
def genCase (seed : Nat) : Case := Id.run do
  let mut r := Rng.seed (seed + 7000)
  let mut out : Array TreeStatement := #[g]
  let mut failing : Array Core.Hash := #[]
  let mut tickets : Array (Core.Hash × String) := #[]
  let mut claims : Array Core.Hash := #[]
  let (n, r1) := r.below 10
  r := r1
  for i in [0:n + 8] do
    let (k, r1) := r.below 10
    let (h, r2) := r1.below 1000
    let (t1, r3) := r2.below out.size
    let (t2, r4) := r3.below out.size
    let (x, r5) := r4.below 8
    let (bad, r6) := r5.below 15
    r := r6
    let name := Restore.num (h * 100 + i + 1000)
    let tip1 := (out.getD t1 g).name
    let tip2 := (out.getD t2 g).name
    let device := s!"vault-{x % 4}"
    -- a claim mostly names its ticket, and an ack its claim, so many count; now and then they name only one
    -- earlier statement, so acks and withdrawals often don't see each other
    let (signer, tips, says) : String × List Core.Hash × TreeSays :=
      if k == 0 then ("alice-passkey", [tip1], .signIn "alice" "alice-peer-light")
      else if k ≤ 2 then ("alice-passkey", [tip1, tip2].eraseDups, .ticket s!"t-{i}")
      else if k ≤ 4 ∧ tickets.size > 0 then
        let (tn, key) := tickets[x % tickets.size]!
        (key, (if x == 6 then [tip1] else [tn, tip1].eraseDups), .claim tn s!"vault-{i}" s!"passkey-{i}" s!"browser-{i}"
          (if x == 7 then ⟨"other", "other", "other"⟩ else TreeExamples.guardian))
      else if k == 5 ∧ claims.size > 0 then
        let c := claims[x % claims.size]!
        (if x < 3 then "alice-peer" else if x < 6 then "alice-peer-light" else "browser-0", [c], .confirm c)
      else if k == 6 ∧ tickets.size > 0 then
        ("alice-passkey", [tip1], .withdrawal (tickets[x % tickets.size]!).1)
      else if k == 7 then ("alice-passkey", [tip1], .relayAdd device)
      else if k == 8 then ("alice-passkey", [tip1], if x % 2 == 0 then .relayRemove device else .keeperAdd device)
      else ("alice-passkey", [tip1], .keeperRemove device)
    match says with
    | .ticket key => tickets := tickets.push (name, key)
    | .claim .. => claims := claims.push name
    | _ => pure ()
    if bad == 0 then failing := failing.push name
    out := out.push ⟨name, signer, tips, says⟩
  return { name := s!"generated set, seed {seed}", statements := out.toList, failing := failing.toList, pinned := 100 }

def generatedCases : Nat := 40

-- `settle_perm` on the generated sets: every order settles alike
#guard (List.range generatedCases).all fun i =>
  let c := genCase (i + 1)
  (c.orders (i + 1)).all fun (_, o) => c.settled o == c.settled c.statements

/-! ## Production's store, migrated -/

open Restore in
def restoreCases : List Case :=
  let traces := memberExamples.map (fun (name, ops, _) => (name, ops)) ++
    (List.range 10).map fun n => (s!"generated member trace, seed {n}", randomMemberTrace n)
  traces.filterMap fun (name, ops) =>
    let m := membersAfter ops
    match m.founding.claim, m.restore with
    | some _, .ok r =>
      some { name := s!"migrated: {name}", statements := migrate r boxGuardianKeys, pinned := genesisName }
    | _, _ => none

/-! ## All of it -/

open TreeExamples in
def settledVectors : List Json :=
  let examples : Case := { name := "TreeExamples", statements, failing := [150], pinned := 100 }
  let other : Case := { examples with name := "TreeExamples pinned to the second genesis", pinned := 50 }
  let all := [examples, other] ++ raceCases ++ (List.range generatedCases).map (fun i => genCase (i + 1)) ++
    restoreCases
  (all.zipIdx).flatMap fun (c, i) => (c.orders (i + 1)).map fun (label, o) => c.vector label o

#guard settledVectors.length == (2 + raceCases.length + generatedCases + restoreCases.length) * (2 + shuffles)

/-! ## Records -/

open Records

def RecordKind.name : RecordKind → String
  | .address => "address" | .presence => "presence" | .logTip => "logTip" | .treeTip => "treeTip"
  | .release => "release"

def PeerRecord.json (r : PeerRecord) : Json :=
  Json.mkObj [("kind", RecordKind.name r.kind), ("label", r.kind.label), ("about", r.about), ("signer", r.signer),
    ("counter", toJson r.counter), ("body", toJson r.body)]

open RecordExamples in
def recordVectors : List Json :=
  let asks : List (RecordKind × String) :=
    [(.address, "alice-peer"), (.presence, "mallory-peer"), (.presence, "bob-peer"), (.logTip, "bob-peer"),
     (.release, "aven"), (.treeTip, "bob-peer")]
  let one (label : String) (rs : List PeerRecord) :=
    Json.mkObj [("name", s!"records, {label}"),
      ("input", Json.mkObj [("admitted", toJson ["alice-peer", "bob-peer"]),
        ("releaseSigners", toJson ["release-signer"]),
        ("records", Json.arr (rs.map PeerRecord.json).toArray),
        ("asks", Json.arr (asks.map fun (k, a) => Json.mkObj [("kind", RecordKind.name k), ("about", a)]).toArray)]),
      ("expected", Json.arr (asks.map fun (k, a) =>
        (newest admitted releaseSigners k a rs).elim Json.null PeerRecord.json).toArray)]
  [one "as written" records, one "reversed" records.reverse] ++
    (List.range shuffles).map fun i => one s!"shuffle {i + 1}" ((Rng.seed (i + 900)).shuffle records).1

/-! ## Node properties (`Aven.ID.Node`) -/

open Node in
/-- A network, every peer it can lose, and for each: every member's home relay, who reaches whom, and who can fetch
the chat. A browser uses only relays with a public HTTPS name. -/
def nodeVectors : List Json :=
  let members := ["aven-peer", "alice-peer", "bob-peer", "bob-light", "carol-light"]
  let https := ["aven-peer", "alice-peer"]
  let usable (d r : String) : Bool := !d.endsWith "-light" || https.contains r
  let holders (doc : String) : List String := if doc == "chat" then ["aven-peer", "bob-peer"] else []
  let nets : List (String × List String) :=
    [("two relays", ["aven-peer", "alice-peer"]), ("the Aven Peer's relay alone", ["aven-peer"]),
     ("two relays, one only native peers can use", ["aven-peer", "bob-peer"])]
  nets.flatMap fun (label, relays) =>
    let n : Net := { members, relays, usable, holders }
    (members ++ ["nobody"]).map fun (gone : String) =>
      Json.mkObj [("name", s!"node: {label}, {gone} lost"),
        ("input", Json.mkObj [("members", toJson members), ("relays", toJson relays), ("https", toJson https),
          ("holders", Json.mkObj [("chat", toJson (holders "chat"))]), ("gone", gone)]),
        ("expected", Json.mkObj [
          ("home", Json.mkObj (members.map fun d => (d, (home n gone d).elim Json.null toJson))),
          ("reaches", Json.mkObj (members.map fun a => (a, toJson (members.filter (reaches n gone a))))),
          ("fetchesChat", toJson (members.filter fun a => a != gone && fetchable n gone a "chat"))])]

/-! ## Catch-up and presence (`Aven.ID.CatchUp`) -/

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
  (([15, 17, 18, 20] : List Nat).map fun now =>
    Json.mkObj [("name", s!"presence at step {now}, window 3"),
      ("input", Json.mkObj [("admitted", toJson ["bob-light", "alice-peer"]), ("window", toJson (3 : Nat)),
        ("now", toJson now), ("beats", Json.arr (CatchUpExamples.beats.map PeerRecord.json).toArray)]),
      ("expected", Json.mkObj [("present",
        toJson (["alice-peer", "aven-peer", "bob-light"].filter
          (present CatchUpExamples.admitted 3 now CatchUpExamples.beats)))])])

end SettleJson
end Aven.ID
