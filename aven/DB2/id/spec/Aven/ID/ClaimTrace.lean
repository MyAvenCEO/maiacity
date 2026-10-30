import Aven.ID.Claim
import Aven.ID.Gen

/-! # Claim and sign-in traces

What browsers do to an Aven Peer, one step at a time, and what it answers: the examples written out by hand, and
generated traces (`randomTrace`), which `lake exe vectors` exports with every tree (`vectors/claims.json`). aven-id's
tests replay them with real keys: each passkey is a test P-256 key (`Aven.ID.P256`), each browser a test Ed25519 key
(`Aven.ID.Keys`), and every assertion is signed for real.

A browser is named by a short name (`1`, `2`): its device is `device-1`, its key the test key of that id. A passkey is
named the same way (`a`): `passkey-a`, owning `person-a`. The server is the box's Aven Peer in production's
configuration (RP ID `localhost`, origin `http://localhost:5174`, the box's test MaiaCityGuardian), or the same
without a guardian. -/

namespace Aven.ID

def deviceId (d : String) : String := "device-" ++ d
def passkeyId (p : String) : String := "passkey-" ++ p
def personId (p : String) : String := "person-" ++ p

/-- The traces' browsers' and passkeys' public halves, each derived once. -/
def deviceKeys : List (String × String) :=
  ["1", "2", "3"].map fun d => (d, Keys.hex (Keys.publicKey (Keys.seed (deviceId d))))
def passkeyKeys : List (String × String) :=
  ["a", "b", "c"].map fun p => (p, P256.publicKey (P256.scalar (passkeyId p)))

def deviceKey (d : String) : String :=
  (deviceKeys.lookup d).getD (Keys.hex (Keys.publicKey (Keys.seed (deviceId d))))
def passkeyKey (p : String) : String := (passkeyKeys.lookup p).getD (P256.publicKey (P256.scalar (passkeyId p)))

/-- The box's Aven Peer in production's configuration, with the box's test MaiaCityGuardian. -/
def prodPeerKey : String := Keys.hex (Keys.publicKey (Keys.seed "prod-peer"))
/-- The box's MaiaCityGuardian, a test key from the cast's rule. -/
def boxGuardian : String := Keys.hex (Keys.publicKey (Keys.seed guardianId))

def boxServer : Server :=
  { network := "aven", peer := "aven-peer", peerKey := prodPeerKey, rp := boxRelying, guardian := some boxGuardian }

def unguarded : Server := { boxServer with guardian := none }

/-- What a browser or an attacker does differently from an honest browser on the box's page. -/
structure Tamper where
  network : String := "aven"
  /-- sent from another browser than the one the statement names -/
  sender : Option String := none
  /-- after the passkey signed, the statement names another browser, which sends it -/
  swap : Option String := none
  /-- the claim names this person vault or device instead -/
  person : Option String := none
  device : Option String := none
  type : String := "webauthn.get"
  origin : String := "http://localhost:5174"
  rpId : String := "localhost"
  flags : UInt8 := 5
  /-- the passkey's signature counter; synced passkeys keep it at 0 -/
  counter : Nat := 0
  deriving DecidableEq, Repr, Inhabited

inductive Op where
  /-- browser `device` signs up, so claims an unclaimed network, its new passkey `passkey` signing -/
  | claim (passkey device : String) (t : Tamper)
  /-- browser `device` signs in, the passkey `passkey` signing -/
  | signIn (passkey device : String) (t : Tamper)
  | restart
  | wipe
  deriving DecidableEq, Repr

def blank : Assertion := ⟨"", [], "", ("", [])⟩

def assert (t : Tamper) (text passkey : String) : Assertion :=
  made t.type t.origin t.rpId (challengeOf text) (passkeyId passkey) t.flags false t.counter

/-- The claim a browser sends, and the key of the browser that sends it. -/
def Op.claimOf (passkey device : String) (t : Tamper) : Claim × String :=
  let c : Claim := ⟨t.network, t.person.getD (personId passkey), passkeyId passkey, passkeyKey passkey,
    t.device.getD (deviceId device), deviceKey device, blank⟩
  let c := { c with assertion := assert t c.text passkey }
  match t.swap with
  | some e => ({ c with device := deviceId e, deviceKey := deviceKey e }, deviceKey e)
  | none => (c, deviceKey (t.sender.getD device))

def Op.signInOf (passkey device : String) (t : Tamper) : SignIn × String :=
  let i : SignIn := ⟨t.network, deviceId device, deviceKey device, blank⟩
  let i := { i with assertion := assert t i.text passkey }
  match t.swap with
  | some e => ({ i with device := deviceId e, deviceKey := deviceKey e }, deviceKey e)
  | none => (i, deviceKey (t.sender.getD device))

/-- One step: the answer, and the server after it (unchanged when refused). -/
def Server.step (s : Server) : Op → Option ClaimError × Server
  | .claim p d t =>
    let (c, sender) := Op.claimOf p d t
    match s.submitClaim sender c with
    | .ok s' => (none, s')
    | .error why => (some why, s)
  | .signIn p d t =>
    let (i, sender) := Op.signInOf p d t
    match s.submitSignIn sender i with
    | .ok s' => (none, s')
    | .error why => (some why, s)
  | .restart => match s.restore with
    | .ok s' => (none, s')
    | .error why => (some why, s)
  | .wipe => (none, s.wipe)

/-- Every step's answer and the server after it. -/
def Server.run (s : Server) : List Op → List (Option ClaimError × Server)
  | [] => []
  | op :: ops =>
    let (answer, s') := s.step op
    (answer, s') :: s'.run ops

/-! ## Examples

Each a trace and, for every step, the answer and how many devices the tree has after it, written out by hand. -/

def ok : Option ClaimError := none
def no (why : ClaimError) : Option ClaimError := some why

/-- Each example: its server, its steps, and for each step the answer and how many devices the tree has after it. -/
def claimExamples : List (String × Server × List Op × List (Option ClaimError × Nat)) := [
  ("the first signup claims, a second signup with another passkey is refused",
    boxServer, [.claim "a" "1" {}, .claim "b" "2" {}, .claim "a" "1" {}],
    [(ok, 2), (no .taken, 2), (no .taken, 2)]),
  ("without a guardian, the first signup claims all the same", unguarded,
    [.claim "a" "1" {}, .claim "b" "2" {}, .signIn "a" "2" {}, .restart],
    [(ok, 2), (no .taken, 2), (ok, 3), (ok, 3)]),
  ("a second browser signs in, a restart keeps both, a third signs in", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" {}, .restart, .signIn "a" "2" {}, .signIn "a" "1" {},
      .signIn "a" "3" {}, .restart],
    [(ok, 2), (ok, 3), (ok, 3), (no .known, 3), (no .known, 3), (ok, 4), (ok, 4)]),
  ("no sign-in before a claim", boxServer, [.signIn "a" "1" {}, .restart], [(no .unclaimed, 1), (ok, 1)]),
  ("another passkey can't sign in", boxServer,
    [.claim "a" "1" {}, .signIn "b" "2" {}], [(ok, 2), (no (.assertion .badSignature), 2)]),
  ("a claim sent by another browser than it names", boxServer,
    [.claim "a" "1" { sender := some "2" }], [(no .notFromDevice, 1)]),
  ("a sign-in sent by another browser than it names", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" { sender := some "3" }], [(ok, 2), (no .notFromDevice, 2)]),
  ("a sign-in replayed for another browser fails its challenge", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" { swap := some "3" }], [(ok, 2), (no (.assertion .challenge), 2)]),
  ("a claim replayed for another browser fails its challenge", boxServer,
    [.claim "a" "1" { swap := some "2" }, .restart], [(no (.assertion .challenge), 1), (ok, 1)]),
  ("a claim made on another origin", boxServer, [.claim "a" "1" { origin := "http://localhost:5173" }],
    [(no (.assertion .origin), 1)]),
  ("a claim made for another RP ID", boxServer, [.claim "a" "1" { rpId := "maia.city" }],
    [(no (.assertion .rpId), 1)]),
  ("a claim without the user verified", boxServer, [.claim "a" "1" { flags := 1 }],
    [(no (.assertion .notVerified), 1)]),
  ("a sign-in without the user present", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" { flags := 4 }], [(ok, 2), (no (.assertion .notPresent), 2)]),
  ("a registration is no claim", boxServer, [.claim "a" "1" { type := "webauthn.create" }],
    [(no (.assertion .type), 1)]),
  ("a claim for another network", boxServer, [.claim "a" "1" { network := "other" }], [(no .wrongNetwork, 1)]),
  ("a sign-in for another network", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" { network := "other" }], [(ok, 2), (no .wrongNetwork, 2)]),
  ("a claim naming the Aven Peer as its browser", boxServer,
    [.claim "a" "1" { device := some "aven-peer" }], [(no (.invalid (.duplicate "aven-peer")), 1)]),
  ("a claim naming the network as its person", boxServer,
    [.claim "a" "1" { person := some "aven" }], [(no (.invalid (.duplicate "aven")), 1)]),
  ("a claim naming the guardian's key as its browser", boxServer,
    [.claim "a" "1" { device := some guardianId }], [(no (.invalid (.deviceKeyOwns guardianId "person-a")), 1)]),
  ("a passkey that counts must count up", boxServer,
    [.claim "a" "1" { counter := 5 }, .signIn "a" "2" { counter := 5 }, .signIn "a" "2" { counter := 3 },
      .signIn "a" "2" { counter := 6 }, .restart, .signIn "a" "3" { counter := 0 }, .signIn "a" "3" { counter := 7 }],
    [(ok, 2), (no .counter, 2), (no .counter, 2), (ok, 3), (ok, 3), (no .counter, 3), (ok, 4)]),
  ("a synced passkey keeps its counter at 0", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" {}, .signIn "a" "3" {}], [(ok, 2), (ok, 3), (ok, 4)]),
  ("a wipe makes it unclaimed, and the next signup claims it again", boxServer,
    [.claim "a" "1" {}, .signIn "a" "2" {}, .wipe, .signIn "a" "2" {}, .claim "b" "2" {}, .restart],
    [(ok, 2), (ok, 3), (ok, 1), (no .unclaimed, 1), (ok, 2), (ok, 2)])]

def devices (s : Server) : Nat := (s.tree.vaults.filter (·.kind == .device)).length

#guard claimExamples.all fun (_, server, ops, want) =>
  (server.run ops).map (fun (answer, s) => (answer, devices s)) == want

-- a restart finds the tree it had, in every example
#guard claimExamples.all fun (_, server, ops, _) =>
  (server.run ops).all fun (_, s) => (s.restore.toOption.map Server.tree |>.map (·.vaults)) == some s.tree.vaults

/-! ## Generated traces

Steps drawn at random from a seeded xorshift: signups, sign-ins, restarts and wipes, by three browsers and two
passkeys, now and then tampered with. -/

def tampers : List Tamper := [{}, {}, {}, {}, { sender := some "3" }, { swap := some "2" }, { flags := 1 },
  { origin := "http://localhost:5173" }, { rpId := "maia.city" }]

def randomOp (r : Rng) : Op × Rng :=
  let (k, r) := r.below 10
  let (p, r) := r.below 2
  let (d, r) := r.below 3
  let (t, r) := r.below tampers.length
  let passkey := ["a", "b"][p]!
  let device := ["1", "2", "3"][d]!
  let tamper := tampers[t]!
  let op := if k < 4 then Op.claim passkey device tamper
    else if k < 8 then .signIn passkey device tamper
    else if k < 9 then .restart
    else .wipe
  (op, r)

def randomTrace (seed : Nat) : List Op := Id.run do
  let mut r := Rng.seed (seed + 1000)
  let mut ops := #[]
  for _ in [0:8] do
    let (op, r') := randomOp r
    r := r'
    ops := ops.push op
  return ops.toList

end Aven.ID
