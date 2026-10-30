import Lean.Data.Json
import Aven.ID.Gen
import Aven.ID.Restore
import Aven.ID.Records

/-! # The settled tree's vectors (PEERS.md §5 and §6)

`settled.json`: sets of tree statements, each in several orders, with the tree `settle` gives (`Settled.listed`):
`TreeExamples`, the races written out one by one, generated sets, and production's store migrated from every invite
trace (`Aven.ID.Restore`). `records.json`: records and the newest of each kind about each device (`Aven.ID.Records`).
aven-id's tests settle each input and compare (README rule 10). -/

open Lean

namespace Aven.ID
namespace SettleJson

open Settle

def GuardianKeys.json (g : GuardianKeys) : Json :=
  Json.mkObj [("ed25519", g.ed25519), ("mlDsa", g.mlDsa), ("xWing", g.xWing)]

def Genesis.json (g : Genesis) : Json :=
  Json.mkObj [("rpId", g.rpId), ("origins", toJson g.origins), ("claimant", g.claimant), ("passkey", g.passkey),
    ("devices", toJson g.devices), ("coop", g.coop), ("agent", g.agent), ("avenPeer", g.avenPeer),
    ("guardian", GuardianKeys.json g.guardian), ("signedBy", toJson g.signedBy)]

def TreeSays.json : TreeSays → Json
  | .genesis g => Json.mkObj [("kind", "genesis"), ("genesis", Genesis.json g)]
  | .signIn v d => Json.mkObj [("kind", "signIn"), ("vault", v), ("device", d)]
  | .ticket k => Json.mkObj [("kind", "ticket"), ("key", k)]
  | .withdrawal t => Json.mkObj [("kind", "withdrawal"), ("ticket", toJson t)]
  | .claim t v p d g => Json.mkObj [("kind", "claim"), ("ticket", toJson t), ("vault", v), ("passkey", p),
      ("device", d), ("guardian", GuardianKeys.json g)]
  | .ack c => Json.mkObj [("kind", "ack"), ("claim", toJson c)]
  | .relayAdd d => Json.mkObj [("kind", "relayAdd"), ("device", d)]
  | .relayRemove d => Json.mkObj [("kind", "relayRemove"), ("device", d)]
  | .keeperAdd d => Json.mkObj [("kind", "keeperAdd"), ("device", d)]
  | .keeperRemove d => Json.mkObj [("kind", "keeperRemove"), ("device", d)]

def TreeStatement.json (s : TreeStatement) : Json :=
  Json.mkObj [("name", toJson s.name), ("signer", s.signer), ("tips", toJson s.tips), ("says", TreeSays.json s.says)]

def Listed.json (l : Listed) : Json :=
  Json.mkObj [("counted", toJson l.counted), ("final", toJson l.final), ("standing", toJson l.standing),
    ("contested", toJson l.contested), ("members", toJson l.members), ("admitted", toJson l.admitted),
    ("relays", toJson l.relays), ("keepers", toJson l.keepers)]

/-- A case: its statements, the names that fail their own checks, and the pinned genesis. -/
structure Case where
  name : String
  statements : List TreeStatement
  failing : List Nat := []
  pinned : Nat

def Case.ok (c : Case) (s : TreeStatement) : Bool := !c.failing.contains s.name

def Case.settled (c : Case) (order : List TreeStatement) : Listed :=
  (settle c.ok c.pinned order).listed c.statements

/-- The case in the order given: its input and the settled tree. -/
def Case.vector (c : Case) (label : String) (order : List TreeStatement) : Json :=
  Json.mkObj [("name", s!"{c.name}, {label}"),
    ("input", Json.mkObj [("pinned", toJson c.pinned), ("failing", toJson c.failing),
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
     statements := [g, t, bob, ⟨510, "alice-peer", [500], .ack 500⟩] },
   { name := "two claims of one ticket, none acked: the smaller hash", statements := [g, t, bob, leak], pinned := 100 },
   { name := "two claims, the larger acked: the final one", pinned := 100,
     statements := [g, t, bob, leak, ⟨510, "alice-peer", [500], .ack 500⟩] },
   { name := "a withdrawal that never saw the claim wins", pinned := 100,
     statements := [g, t, bob, ⟨610, "alice-passkey", [120], .withdrawal 120⟩] },
   { name := "a withdrawal that saw the claim changes nothing", pinned := 100,
     statements := [g, t, bob, ⟨610, "alice-passkey", [500], .withdrawal 120⟩] },
   { name := "a claim that saw the withdrawal is out", pinned := 100,
     statements := [g, t, ⟨610, "alice-passkey", [120], .withdrawal 120⟩,
       ⟨500, "t-bob", [610], .claim 120 "bob" "bob-passkey" "bob-peer" guardian⟩] },
   { name := "two admin devices ack two claims without seeing each other: contested, the smaller hash", pinned := 100,
     statements := [g, ⟨110, "alice-passkey", [100], .signIn "alice" "alice-peer-light"⟩, t, bob, leak,
       ⟨510, "alice-peer", [500], .ack 500⟩, ⟨511, "alice-peer-light", [300, 110], .ack 300⟩] },
   { name := "a withdrawal never wins over a final claim", pinned := 100,
     statements := [g, t, bob, ⟨510, "alice-peer", [500], .ack 500⟩,
       ⟨610, "alice-passkey", [120], .withdrawal 120⟩] },
   { name := "an ack by no admin key makes nothing final", pinned := 100,
     statements := [g, t, bob, ⟨510, "bob-peer", [500], .ack 500⟩] },
   { name := "a relay added, removed, and added again after", pinned := 100,
     statements := [g, ⟨700, "alice-passkey", [100], .relayAdd "bob-peer"⟩,
       ⟨710, "alice-passkey", [700], .relayRemove "bob-peer"⟩,
       ⟨720, "alice-passkey", [710], .relayAdd "bob-peer"⟩] },
   { name := "a keeper added and removed at once: the remove", pinned := 100,
     statements := [g, ⟨700, "alice-passkey", [100], .keeperAdd "bob-peer"⟩,
       ⟨710, "alice-passkey", [100], .keeperRemove "bob-peer"⟩] },
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
  let mut failing : Array Nat := #[]
  let mut tickets : Array (Nat × String) := #[]
  let mut claims : Array Nat := #[]
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
    let name := h * 100 + i + 1000
    let tip1 := (out.getD t1 g).name
    let tip2 := (out.getD t2 g).name
    let device := s!"device-{x % 4}"
    -- a claim mostly names its ticket, and an ack its claim, so many count; now and then they name only one
    -- earlier statement, so acks and withdrawals often don't see each other
    let (signer, tips, says) : String × List Nat × TreeSays :=
      if k == 0 then ("alice-passkey", [tip1], .signIn "alice" "alice-peer-light")
      else if k ≤ 2 then ("alice-passkey", [tip1, tip2].eraseDups, .ticket s!"t-{i}")
      else if k ≤ 4 ∧ tickets.size > 0 then
        let (tn, key) := tickets[x % tickets.size]!
        (key, (if x == 6 then [tip1] else [tn, tip1].eraseDups), .claim tn s!"vault-{i}" s!"passkey-{i}" s!"browser-{i}"
          (if x == 7 then ⟨"other", "other", "other"⟩ else TreeExamples.guardian))
      else if k == 5 ∧ claims.size > 0 then
        let c := claims[x % claims.size]!
        (if x < 3 then "alice-peer" else if x < 6 then "alice-peer-light" else "browser-0", [c], .ack c)
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
    match m.server.claim, m.restore with
    | some _, .ok r =>
      some { name := s!"migrated: {name}", statements := migrate r boxGuardianKeys, pinned := 1 }
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

end SettleJson
end Aven.ID
