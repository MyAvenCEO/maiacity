import Aven.ID.Invite
import Aven.ID.ClaimTrace

/-! # Invite, join and withdrawal traces

What browsers do to an Aven Peer that keeps its members, one step at a time, and what it answers: the examples written
out by hand, and generated traces (`randomMemberTrace`), which `lake exe vectors` exports with every tree, every
invite's state and what the door says of each key (`vectors/invites.json`). aven-id's tests replay them with real keys:
passkeys and browsers as in `Aven.ID.ClaimTrace`, and each invite's one-time key a test Ed25519 key, `one-time-<n>`.

The admin is passkey `a`'s person vault, which claims first; `b` and `c` are people who join. -/

namespace Aven.ID

def oneTimeId (n : String) : String := "one-time-" ++ n

/-- The traces' one-time keys and the joiners' browsers, each derived once. -/
def oneTimeKeys : List (String × String) :=
  ["1", "2"].map fun n => (n, Keys.hex (Keys.publicKey (Keys.seed (oneTimeId n))))
def joinerKeys : List (String × String) :=
  ["4", "5"].map fun d => (d, Keys.hex (Keys.publicKey (Keys.seed (deviceId d))))

def oneTimeKey (n : String) : String :=
  (oneTimeKeys.lookup n).getD (Keys.hex (Keys.publicKey (Keys.seed (oneTimeId n))))
def browserKey (d : String) : String := (joinerKeys.lookup d).getD (deviceKey d)

/-- What a joining browser or an attacker does differently from an honest one. -/
structure JoinTamper where
  network : String := "aven"
  /-- sent by another browser than it names; `invite` sends it on the invite's one-time key -/
  sender : Option String := none
  /-- another one-time key signed it -/
  signer : Option String := none
  /-- after both signed, the join names another browser, which sends it -/
  swap : Option String := none
  /-- the join names this person vault, or gives this name, instead -/
  person : Option String := none
  name : Option String := none
  origin : String := "http://localhost:5174"
  flags : UInt8 := 5
  deriving DecidableEq, Repr, Inhabited

inductive MemberOp where
  | claim (passkey device : String) (t : Tamper)
  | signIn (passkey device : String) (t : Tamper)
  /-- passkey `passkey` invites, naming the one-time key `key` -/
  | invite (passkey key : String) (t : Tamper)
  | withdraw (passkey key : String) (t : Tamper)
  /-- browser `device` joins with invite `key`, its new passkey `passkey` signing -/
  | join (key passkey device : String) (t : JoinTamper)
  | restart
  | wipe
  deriving DecidableEq, Repr

def MemberOp.inviteOf (passkey key : String) (t : Tamper) : Invite :=
  let i : Invite := ⟨t.network, oneTimeKey key, passkeyId passkey, blank⟩
  { i with assertion := assert t i.text passkey }

def MemberOp.withdrawalOf (passkey key : String) (t : Tamper) : Withdrawal :=
  let w : Withdrawal := ⟨t.network, oneTimeKey key, passkeyId passkey, blank⟩
  { w with assertion := assert t w.text passkey }

/-- The join a browser sends, and the key it is sent from. -/
def MemberOp.joinOf (key passkey device : String) (t : JoinTamper) : Join × String :=
  let k := oneTimeKey key
  let j : Join := ⟨t.network, k, t.person.getD (personId passkey), t.name.getD (personName passkey), passkeyId passkey,
    passkeyKey passkey,
    deviceId device, browserKey device, ("", ""), blank⟩
  let signer := (t.signer.map oneTimeKey).getD k
  let a := made "webauthn.get" t.origin "localhost" (challengeOf j.text) (passkeyId passkey) t.flags
  let j := { j with signature := (signer, j.text), assertion := a }
  let j := match t.swap with
    | some e => { j with device := deviceId e, deviceKey := browserKey e }
    | none => j
  let sender := match t.sender with
    | some "invite" => k
    | some d => browserKey d
    | none => j.deviceKey
  (j, sender)

/-- What a step brings to the door, from which key, when it is a newcomer's: a claim, a sign-in or a join. -/
def MemberOp.pending : MemberOp → Option (String × Members.Pending)
  | .claim p d t => let (c, sender) := Op.claimOf p d t; some (sender, .claim c)
  | .signIn p d t => let (i, sender) := Op.signInOf p d t; some (sender, .signIn i)
  | .join k p d t => let (j, sender) := MemberOp.joinOf k p d t; some (sender, .join j)
  | _ => none

namespace Members

def answer (m : Members) : Except MemberError Members → Option MemberError × Members
  | .ok m' => (none, m')
  | .error why => (some why, m)

def step (m : Members) : MemberOp → Option MemberError × Members
  | .invite p k t => m.answer (m.acceptInvite (MemberOp.inviteOf p k t))
  | .withdraw p k t => m.answer (m.acceptWithdrawal (MemberOp.withdrawalOf p k t))
  | .restart => m.answer m.restore
  | .wipe => (none, m.wipe)
  | op => match op.pending with
    | some (sender, p) => m.answer (m.take sender p)
    | none => (none, m)

def run (m : Members) : List MemberOp → List (Option MemberError × Members)
  | [] => []
  | op :: ops =>
    let (answer, m') := m.step op
    (answer, m') :: m'.run ops

end Members

def boxMembers : Members := { founding := boxFounding }

/-- The keys every trace asks the door about: the five browsers, the Aven Peer, both one-time keys. -/
def doorKeys : List String :=
  ["1", "2", "3", "4", "5"].map browserKey ++ [prodPeerKey] ++ ["1", "2"].map oneTimeKey

/-! ## Examples

Each a trace and, for every step, the answer, how many devices the tree has and how many members, written out by
hand. -/

def mok : Option MemberError := none
def mno (why : MemberError) : Option MemberError := some why

def memberExamples : List (String × List MemberOp × List (Option MemberError × Nat × Nat)) := [
  ("the admin invites, a person joins with the link, and the link used again is refused",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .join "1" "c" "5" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno .used, 3, 1)]),
  ("a withdrawn invite admits nobody, and is withdrawn once",
    [.claim "a" "1" {}, .invite "a" "1" {}, .withdraw "a" "1" {}, .join "1" "b" "4" {}, .withdraw "a" "1" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 2, 0), (mno .withdrawn, 2, 0), (mno .withdrawn, 2, 0)]),
  ("a used invite can't be withdrawn",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .withdraw "a" "1" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno .used, 3, 1)]),
  ("nobody invites before the claim", [.invite "a" "1" {}, .join "1" "b" "4" {}],
    [(mno .unclaimed, 1, 0), (mno .unclaimed, 1, 0)]),
  ("only the admin invites: a member's passkey is refused",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .invite "b" "2" {}, .invite "c" "2" {},
      .invite "a" "2" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno .notAdmin, 3, 1), (mno .notAdmin, 3, 1), (mok, 3, 1)]),
  ("an invite's key once", [.claim "a" "1" {}, .invite "a" "1" {}, .invite "a" "1" {}],
    [(mok, 2, 0), (mok, 2, 0), (mno .knownInvite, 2, 0)]),
  ("an invite made on another origin, without the user verified, for another network",
    [.claim "a" "1" {}, .invite "a" "1" { origin := "http://localhost:5173" }, .invite "a" "1" { flags := 1 },
      .invite "a" "1" { network := "other" }],
    [(mok, 2, 0), (mno (.assertion .origin), 2, 0), (mno (.assertion .notVerified), 2, 0), (mno .wrongNetwork, 2, 0)]),
  ("no join without an invite", [.claim "a" "1" {}, .join "2" "b" "4" {}],
    [(mok, 2, 0), (mno .noInvite, 2, 0)]),
  ("a join another one-time key signed", [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { signer := some "2" }],
    [(mok, 2, 0), (mok, 2, 0), (mno .badInviteSignature, 2, 0)]),
  ("a join replayed for another browser", [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { swap := some "5" }],
    [(mok, 2, 0), (mok, 2, 0), (mno .badInviteSignature, 2, 0)]),
  ("a join sent by another browser is refused; on the invite's own key it is taken",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { sender := some "5" },
      .join "1" "b" "4" { sender := some "invite" }],
    [(mok, 2, 0), (mok, 2, 0), (mno .notFromDevice, 2, 0), (mok, 3, 1)]),
  ("a join naming the admin's vault, or the admin's browser",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { person := some (personId "a") },
      .join "1" "b" "1" {}],
    [(mok, 2, 0), (mok, 2, 0), (mno .known, 2, 0), (mno .known, 2, 0)]),
  ("a join with the admin's own passkey", [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "a" "4" {}],
    [(mok, 2, 0), (mok, 2, 0), (mno .known, 2, 0)]),
  ("a join made on another origin, or without the user present",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { origin := "http://localhost:5173" },
      .join "1" "b" "4" { flags := 4 }],
    [(mok, 2, 0), (mok, 2, 0), (mno (.assertion .origin), 2, 0), (mno (.assertion .notPresent), 2, 0)]),
  ("a join without a name, or with a name of two lines",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { name := some "" },
      .join "1" "b" "4" { name := some "Bea\nB" }, .join "1" "b" "4" { name := some "Zoë Bea" }],
    [(mok, 2, 0), (mok, 2, 0), (mno .name, 2, 0), (mno .name, 2, 0), (mok, 3, 1)]),
  ("a join for another network", [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" { network := "other" }],
    [(mok, 2, 0), (mok, 2, 0), (mno .wrongNetwork, 2, 0)]),
  ("two people join, the admin signs in again, and so does a member, each as themselves",
    [.claim "a" "1" {}, .invite "a" "1" {}, .invite "a" "2" {}, .join "1" "b" "4" {}, .join "2" "c" "5" {},
      .signIn "a" "2" {}, .signIn "b" "3" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mok, 4, 2), (mok, 5, 2), (mok, 6, 2)]),
  -- `sandbox/members.mjs` holds the box's member to this trace: its browser reset, the passkey signs in again
  ("the box's check: a member signs in on a second browser, a restart keeps it, the same browser again is known",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .signIn "b" "5" {}, .restart, .signIn "b" "5" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mok, 4, 1), (mok, 4, 1), (mno .known, 4, 1)]),
  ("a member's sign-in replayed for another browser fails its challenge",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .signIn "b" "5" { swap := some "3" }],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno (.assertion .challenge), 3, 1)]),
  ("a member's sign-in sent by another browser than it names",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .signIn "b" "5" { sender := some "3" }],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno .notFromDevice, 3, 1)]),
  ("a passkey that owns no vault here can't sign in, before or after it is a member's",
    [.claim "a" "1" {}, .signIn "b" "2" {}, .invite "a" "1" {}, .signIn "b" "2" {}, .join "1" "b" "4" {},
      .signIn "b" "2" {}],
    [(mok, 2, 0), (mno .stranger, 2, 0), (mok, 2, 0), (mno .stranger, 2, 0), (mok, 3, 1), (mok, 4, 1)]),
  ("a member's sign-in made on another origin fails for every passkey alike",
    [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {},
      .signIn "b" "5" { origin := "http://localhost:5173" }, .signIn "c" "5" { flags := 1 }],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mno (.assertion .origin), 3, 1), (mno (.assertion .notVerified), 3, 1)]),
  ("counters are kept per passkey: a replayed counter is refused, another passkey's doesn't count",
    [.claim "a" "1" { counter := 5 }, .invite "a" "1" {}, .join "1" "b" "4" {}, .signIn "b" "5" { counter := 2 },
      .signIn "b" "3" { counter := 2 }, .signIn "a" "3" { counter := 4 }, .signIn "a" "3" { counter := 6 },
      .restart, .signIn "b" "2" { counter := 1 }, .signIn "b" "2" { counter := 3 }],
    [(mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mok, 4, 1), (mno .counter, 4, 1), (mno .counter, 4, 1), (mok, 5, 1),
      (mok, 5, 1), (mno .counter, 5, 1), (mok, 6, 1)]),
  ("a restart keeps the members, the invites and the withdrawals; a wipe empties them",
    [.claim "a" "1" {}, .invite "a" "1" {}, .invite "a" "2" {}, .withdraw "a" "2" {}, .join "1" "b" "4" {},
      .restart, .join "2" "c" "5" {}, .wipe, .invite "a" "1" {}],
    [(mok, 2, 0), (mok, 2, 0), (mok, 2, 0), (mok, 2, 0), (mok, 3, 1), (mok, 3, 1), (mno .withdrawn, 3, 1), (mok, 1, 0),
      (mno .unclaimed, 1, 0)])]

def Members.devices (m : Members) : Nat := (m.tree.vaults.filter (·.kind == .device)).length

#guard memberExamples.all fun (_, ops, want) =>
  (boxMembers.run ops).map (fun (answer, m) => (answer, m.devices, m.members.length)) == want

/-- Vault ids as a set, in one order. -/
def sorted (ids : List String) : List String := ids.mergeSort fun a b => decide (a ≤ b)

-- a restart finds the vaults, the members and the invites' states it had, in every example, perhaps in another order
#guard memberExamples.all fun (_, ops, _) =>
  (boxMembers.run ops).all fun (_, m) =>
    (m.restore.toOption.map fun r => (sorted (r.tree.vaults.map (·.id)), sorted r.members,
      sorted (r.invites.map fun i => i.key ++ r.state i.key))) ==
    some (sorted (m.tree.vaults.map (·.id)), sorted m.members, sorted (m.invites.map fun i => i.key ++ m.state i.key))

/-- The members after a trace from the box's Aven Peer. -/
def membersAfter (ops : List MemberOp) : Members := ((boxMembers.run ops).getLast?.map (·.2)).getD boxMembers

-- the door after the first example: the admin's browser, the Aven Peer and the member's browser; nobody else, the
-- invite's one-time key and the browser whose join was refused included
#guard doorKeys.map (membersAfter ((memberExamples.head?.map (·.2.1)).getD [])).admits ==
  [true, false, false, true, false, true, false, false]

-- a newcomer: the joiner's browser is let in for its join and nothing else; once used, the same join is no reason
#guard
  let m := membersAfter [.claim "a" "1" {}, .invite "a" "1" {}]
  let (j, sender) := MemberOp.joinOf "1" "b" "4" {}
  m.newcomer sender (.join j) && !m.admits sender &&
    (m.take sender (.join j)).toOption.all fun m' => m'.admits sender && !m'.newcomer (browserKey "5") (.join j)

-- a member's second browser is a device of the member's vault, named after them, and the door lets it in
#guard
  let m := membersAfter [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}, .signIn "b" "5" {}]
  m.tree.get? (deviceId "5") == some ⟨deviceId "5", "Bea's browser 2", .device, [.vault (personId "b")], 1, some (deviceId "5")⟩ &&
    m.admits (browserKey "5") && m.tree.get? (personId "b") ==
      (membersAfter [.claim "a" "1" {}, .invite "a" "1" {}, .join "1" "b" "4" {}]).tree.get? (personId "b")

/-! ## Generated traces

Steps drawn at random from a seeded xorshift: a claim first, then sign-ins, invites, withdrawals, joins, restarts and
wipes by three passkeys, five browsers and two one-time keys, now and then tampered with. -/

def joinTampers : List JoinTamper := [{}, {}, {}, { sender := some "invite" }, { signer := some "2" },
  { swap := some "5" }, { sender := some "3" }, { flags := 1 }]

def randomMemberOp (r : Rng) : MemberOp × Rng :=
  let (k, r) := r.below 20
  let (p, r) := r.below 3
  let (d, r) := r.below 5
  let (n, r) := r.below 2
  let (t, r) := r.below tampers.length
  let (jt, r) := r.below joinTampers.length
  let passkey := ["a", "b", "c"][p]!
  let device := ["1", "2", "3", "4", "5"][d]!
  let key := ["1", "2"][n]!
  let tamper := tampers[t]!
  let op := if k < 2 then MemberOp.claim passkey device tamper
    else if k < 4 then .signIn passkey device tamper
    else if k < 9 then .invite (if t < 6 then "a" else passkey) key tamper
    else if k < 11 then .withdraw (if t < 6 then "a" else passkey) key tamper
    else if k < 18 then .join key passkey device joinTampers[jt]!
    else if k < 19 then .restart
    else .wipe
  (op, r)

def randomMemberTrace (seed : Nat) : List MemberOp := Id.run do
  let mut r := Rng.seed (seed + 2000)
  let mut ops := #[MemberOp.claim "a" "1" {}]
  for _ in [0:9] do
    let (op, r') := randomMemberOp r
    r := r'
    ops := ops.push op
  return ops.toList

end Aven.ID
