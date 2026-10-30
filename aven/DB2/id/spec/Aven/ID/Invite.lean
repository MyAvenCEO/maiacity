import Aven.ID.Claim
import Aven.ID.Correct

/-! # Invites, joins and the door

Milestone 2 makes the network invite-only (MILESTONE2.md). Members belong to the admin coop, not to the agent
(Samuel, 30 Oct 2026): Maia City, the coop that owns Aven, is the community, and its members are the members' network.
Aven, the agent, runs the network's infrastructure for it: the peer, the relay, the store. So only the admin coop
invites: an invite is the coop's act, signed as the claim is, by a passkey whose vault governs the coop (a person who
owns it), through a WebAuthn assertion over the invite's text. No member's vault governs the coop, so no member invites
anyone.

An invite names a one-time key, an Ed25519 key whose secret only its link carries. A join is a statement signed by
that key and by the joiner's new passkey: it founds the joiner's person vault, owned by the passkey and, when the Aven
Peer is given one, by MaiaCityGuardian, with the joining browser as its one device. The Aven Peer stores it under
`joined-<invite>`, set from nothing by compare-and-set, as it stores the claim: an invite is used at most once. Until
then the admin can withdraw it (`withdrawn-<invite>`), and a withdrawn invite admits nobody.

The tree is the claim's (`Aven.ID.Claim`) and every join's vaults after it. A member is a person's vault a join founded,
a member of the admin coop (`memberOf`): the coop doesn't own it, so governs nothing of it. The door hangs on the
coop's membership: it lets in the devices of the coop's members, the devices of the vaults that govern the coop (its
people) and the agent's own devices (the Aven Peer, which runs the network for the coop); nothing else (`admits_iff`). Every peer checks it itself, at the relay and
in its `after_handshake` hook, from the statements the Aven Peer tells it.

A browser that is no device yet reaches the network only with a statement the network would take from it now: while
it is unclaimed, its claim; then a sign-in by a passkey that owns a person's vault here, the claimant's or a
member's, or a join with an open invite (`newcomer`). The relay
admits it for that statement and nothing more.

A restart reads it all back (`restore`): the claim, then the invites, the withdrawals and the joins, then every
sign-in, each checked again. A store lists refs by name, so invites, withdrawals and joins come back in their invite's order, not
the order they came in: the members are the same, perhaps listed in another order. Invites and withdrawals don't take
part in the passkey's counter, since their order against the sign-ins is not kept.

Theorems: only the admin coop's people invite (`invite_admin`), and it takes a claimed network; an invite is used at most once
(`join_once`, `joins_nodup`), not after it is withdrawn (`join_withdrawn`), and a used one can't be withdrawn
(`withdraw_used`); a join needs an open invite whose one-time key signed exactly it (`join_invited`); a join founds a
person's vault owned by its passkey, and the guardian if configured, with its browser as its one device, a member of
the admin coop, and changes no vault there was (`join_founds`); the door admits exactly the devices above (`admits_iff`), and only keys of the
tree's devices (`admits_device`). -/

namespace Aven.ID

def inviteText (network key : String) : String :=
  "avenID invite 1\nnetwork " ++ network ++ "\ninvite " ++ key ++ "\n"

def withdrawText (network key : String) : String :=
  "avenID withdraw 1\nnetwork " ++ network ++ "\ninvite " ++ key ++ "\n"

def joinText (network key person name passkey spki device deviceKey : String) : String :=
  "avenID join 1\nnetwork " ++ network ++ "\ninvite " ++ key ++ "\nperson " ++ person ++ "\nname " ++ name ++
    "\npasskey " ++ passkey ++ " " ++ spki ++ "\ndevice " ++ device ++ " " ++ deviceKey ++ "\n"

/-- The id an invite goes by, which names its refs: the start of its one-time key. -/
def inviteId (key : String) : String := "invite-" ++ String.ofList (key.toList.take 16)

/-- An invite: the network, the one-time key's public half (Ed25519, hex), the admin's passkey that signs it, and its
assertion over the invite's text. -/
structure Invite where
  network : String
  key : String
  passkey : String
  assertion : Assertion
  deriving DecidableEq, Repr

/-- A withdrawal of the invite with the one-time key `key`, signed as an invite is. -/
structure Withdrawal where
  network : String
  key : String
  passkey : String
  assertion : Assertion
  deriving DecidableEq, Repr

/-- A join: the invite's one-time key, the joiner's person vault, their name (asked at signup, as the claim's is) and
their new passkey (SubjectPublicKeyInfo, hex), the joining browser and its key; the one-time key's signature, as the model knows one (the key that made it and the text
it signed), and the passkey's assertion over the same text. -/
structure Join where
  network : String
  invite : String
  person : String
  name : String
  passkey : String
  passkeyKey : String
  device : String
  deviceKey : String
  signature : String × String
  assertion : Assertion
  deriving DecidableEq, Repr

def Invite.text (i : Invite) : String := inviteText i.network i.key
def Withdrawal.text (w : Withdrawal) : String := withdrawText w.network w.key
def Join.text (j : Join) : String :=
  joinText j.network j.invite j.person j.name j.passkey j.passkeyKey j.device j.deviceKey

inductive MemberError where
  /-- a claim or a sign-in refused, as `Aven.ID.Claim` refuses it -/
  | claim (why : ClaimError)
  | unclaimed
  | wrongNetwork
  /-- the person's name is none: 1 to 48 characters, no control characters -/
  | name
  /-- the passkey is no admin's -/
  | notAdmin
  | assertion (why : AssertionError)
  /-- an invite with this id exists already -/
  | knownInvite
  /-- no invite has this one-time key -/
  | noInvite
  | used
  | withdrawn
  /-- the one-time key did not sign exactly this join -/
  | badInviteSignature
  /-- the join names another browser than the one that sent it -/
  | notFromDevice
  /-- the join names a vault, a passkey or a browser the tree has; a sign-in a browser it has -/
  | known
  | invalid (why : Invalid)
  /-- a sign-in by a passkey that owns no vault here -/
  | stranger
  /-- a sign-in whose passkey's counter did not count up -/
  | counter
  deriving DecidableEq, Repr

/-- A member's sign-in, as the network keeps it: the statement, and the join whose passkey signed it, found by its
assertion (`signerOf`). -/
structure MemberSignIn where
  member : Join
  signIn : SignIn
  deriving DecidableEq, Repr

/-- An Aven Peer that keeps its members: its claim and the claimant's sign-ins (`server`), then its invites,
withdrawals, joins and the members' sign-ins, each in the order it came. -/
structure Members where
  server : Server
  invites : List Invite := []
  withdrawn : List Withdrawal := []
  joins : List Join := []
  signIns : List MemberSignIn := []
  deriving DecidableEq, Repr

namespace Members

def network (m : Members) : String := m.server.network

/-- The admin coop, whose members the members are. -/
def coop (m : Members) : String := m.server.coop

def joinedPublics (j : Join) : List (String × String) := [(j.passkey, "es256:" ++ j.passkeyKey), (j.device, j.deviceKey)]

/-- The vaults a join founds, named after the person: theirs, owned by its passkey (and the guardian), and its
browser. -/
def joinedVaults (s : Server) (j : Join) : List Vault :=
  [⟨j.person, j.name ++ "'s vault", .person, s.founders j.passkey⟩,
    ⟨j.device, j.name ++ "'s browser", .device, [.vault j.person]⟩]

/-- A member's browser that signed in after `seen`: named after them, numbered after their join's browser and the
browsers they signed in before. -/
def signedInVault (seen : List MemberSignIn) (s : MemberSignIn) : Vault :=
  ⟨s.signIn.device, browserName s.member.name ((seen.filter (·.member.person == s.member.person)).length + 2), .device,
    [.vault s.member.person]⟩

def signedInVaults (seen : List MemberSignIn) : List MemberSignIn → List Vault
  | [] => []
  | s :: l => signedInVault seen s :: signedInVaults (seen ++ [s]) l

def publics (m : Members) : List (String × String) :=
  m.server.publics ++ m.joins.flatMap joinedPublics ++ m.signIns.map fun s => (s.signIn.device, s.signIn.deviceKey)

def vaults (m : Members) : List Vault :=
  m.server.vaults ++ m.joins.flatMap (joinedVaults m.server) ++ signedInVaults [] m.signIns

def tree (m : Members) : Tree := ⟨m.publics.map (·.1), m.vaults⟩

/-- The members: the person vaults joins founded, members of the admin coop. -/
def members (m : Members) : List String := m.joins.map (·.person)

/-- `s` is a member of the coop `c`: the admin coop, and a join founded `s`. -/
def memberOf (m : Members) (s c : String) : Bool := c == m.coop && m.members.contains s

def isPasskey (m : Members) (k : String) : Bool := m.publics.any fun (id, p) => id == k && p.startsWith "es256:"

/-- Whether `k` signs for the admin coop: a passkey that owns a vault governing the coop. -/
def adminKey (m : Members) (k : String) : Bool :=
  m.isPasskey k && m.tree.ids.any fun v =>
    ((m.tree.get? v).map (·.ownerKeys.contains k)).getD false && (m.tree.governs v).contains m.coop

def invite? (m : Members) (key : String) : Option Invite := m.invites.find? (·.key == key)

def used (m : Members) (key : String) : Bool := m.joins.any (·.invite == key)

def isWithdrawn (m : Members) (key : String) : Bool := m.withdrawn.any (·.key == key)

/-- What became of an invite: open, used, or withdrawn. -/
def state (m : Members) (key : String) : String :=
  if m.used key then "used" else if m.isWithdrawn key then "withdrawn" else "open"

/-- Whether the tree has any of these ids, or any of these public halves. -/
def knows (m : Members) (ids keys : List String) : Bool :=
  m.tree.ids.any ids.contains || m.publics.any fun (id, k) => ids.contains id || keys.contains k

/-- The admin's act, checked: a claimed network, an admin's passkey, and its assertion over `text`. -/
def adminAct (m : Members) (network passkey text : String) (a : Assertion) : Except MemberError Unit :=
  if m.server.claim.isNone then .error .unclaimed
  else if network ≠ m.network then .error .wrongNetwork
  else if !m.adminKey passkey then .error .notAdmin
  else match a.check m.server.rp (challengeOf text) passkey with
    | .error why => .error (.assertion why)
    | .ok () => .ok ()

def acceptInvite (m : Members) (i : Invite) : Except MemberError Members := do
  m.adminAct i.network i.passkey i.text i.assertion
  if m.invites.any (inviteId ·.key == inviteId i.key) then .error .knownInvite
  else .ok { m with invites := m.invites ++ [i] }

def acceptWithdrawal (m : Members) (w : Withdrawal) : Except MemberError Members := do
  m.adminAct w.network w.passkey w.text w.assertion
  if (m.invite? w.key).isNone then .error .noInvite
  else if m.used w.key then .error .used
  else if m.isWithdrawn w.key then .error .withdrawn
  else .ok { m with withdrawn := m.withdrawn ++ [w] }

/-- A join's statement, checked: an open invite, its one-time key's signature, the passkey's assertion, nothing the
tree has, and the tree it makes. -/
def acceptJoin (m : Members) (j : Join) : Except MemberError Members :=
  if m.server.claim.isNone then .error .unclaimed
  else if j.network ≠ m.network then .error .wrongNetwork
  else if (m.invite? j.invite).isNone then .error .noInvite
  else if m.used j.invite then .error .used
  else if m.isWithdrawn j.invite then .error .withdrawn
  else if j.signature ≠ (j.invite, j.text) then .error .badInviteSignature
  else if validPersonName j.name = false then .error .name
  else match j.assertion.check m.server.rp (challengeOf j.text) j.passkey with
    | .error why => .error (.assertion why)
    | .ok () =>
      if m.knows [j.person, j.passkey, j.device] [j.deviceKey, "es256:" ++ j.passkeyKey] then .error .known
      else match ({ m with joins := m.joins ++ [j] } : Members).tree.check with
        | some why => .error (.invalid why)
        | none => .ok { m with joins := m.joins ++ [j] }

/-- A join as a browser sends it, from the browser whose key is `sender`, or for it on the invite's one-time key. -/
def submitJoin (m : Members) (sender : String) (j : Join) : Except MemberError Members :=
  if m.server.claim.isNone then .error .unclaimed
  else if sender ≠ j.deviceKey ∧ sender ≠ j.invite then .error .notFromDevice
  else m.acceptJoin j

/-- The claim and sign-ins, as `Aven.ID.Claim` takes them, in a tree that holds with the members. -/
def withServer (m : Members) (r : Except ClaimError Server) : Except MemberError Members :=
  match r with
  | .error why => .error (.claim why)
  | .ok s => match ({ m with server := s } : Members).tree.check with
    | some why => .error (.invalid why)
    | none => .ok { m with server := s }

def submitClaim (m : Members) (sender : String) (c : Claim) : Except MemberError Members :=
  m.withServer (m.server.submitClaim sender c)

/-! ## Sign-ins

Every person whose vault the tree holds signs in with their passkey: the claimant, as `Aven.ID.Claim` takes it, and
every member. The statement is the same for both, "avenID sign-in 1": it names no passkey, since a browser that signs
in asks for any passkey of this RP ID and learns which one only from the assertion. The passkey is found by it: the
claimant's, or else the member's whose passkey made the assertion (`signerOf`), as a signature verifies for exactly the
key that made it. A passkey that owns no vault here is a stranger. The new browser is a device of exactly that
passkey's vault, named after it.

Counters are kept per passkey (`lastCounter`): its claim's or its join's, then its sign-ins'. -/

/-- A sign-in's passkey, found by its assertion: the claimant's (`none`), or the member whose join's passkey made it.
An assertion that fails before its signature fails for every passkey alike. -/
def signerOf (m : Members) (c : Claim) (i : SignIn) : Except MemberError (Option Join) :=
  match i.assertion.check m.server.rp (challengeOf i.text) c.passkey with
  | .ok () => .ok none
  | .error .badSignature =>
    match m.joins.find? fun j => (i.assertion.check m.server.rp (challengeOf i.text) j.passkey).toBool with
    | some j => .ok (some j)
    | none => .error .stranger
  | .error why => .error (.assertion why)

/-- The last signature counter the network kept for the passkey `p`: its claim's or its join's, then each of its
sign-ins'. -/
def lastCounter (m : Members) (p : String) : Nat :=
  if m.server.claim.map (·.passkey) = some p then m.server.lastCounter
  else ((m.joins.filter (·.passkey == p)).map (·.assertion.counter) ++
    (m.signIns.filter (·.member.passkey == p)).map (·.signIn.assertion.counter)).getLastD 0

/-- Whether a sign-in's counter fails to count up past the passkey `p`'s last: a passkey that counts must count up,
as WebAuthn advises against a cloned authenticator; a synced one keeps it at 0. -/
def countsBack (m : Members) (p : String) (i : SignIn) : Bool :=
  (i.assertion.counter != 0 || m.lastCounter p != 0) && decide (i.assertion.counter ≤ m.lastCounter p)

/-- A sign-in's statement, checked: its network, a browser the tree hasn't, the passkey that signed it, which owns a
vault here, and that passkey's counter. The claimant's goes to `Aven.ID.Claim`, a member's is kept here. -/
def acceptSignIn (m : Members) (i : SignIn) : Except MemberError Members :=
  match m.server.claim with
  | none => .error .unclaimed
  | some c =>
    if i.network ≠ m.network then .error .wrongNetwork
    else if m.knows [i.device] [i.deviceKey] then .error .known
    else match m.signerOf c i with
    | .error why => .error why
    | .ok none =>
      if m.countsBack c.passkey i then .error .counter
      else m.withServer (m.server.acceptSignIn i)
    | .ok (some j) =>
      if m.countsBack j.passkey i then .error .counter
      else match ({ m with signIns := m.signIns ++ [⟨j, i⟩] } : Members).tree.check with
        | some why => .error (.invalid why)
        | none => .ok { m with signIns := m.signIns ++ [⟨j, i⟩] }

/-- A sign-in as a browser sends it: from the browser it names. -/
def submitSignIn (m : Members) (sender : String) (i : SignIn) : Except MemberError Members :=
  if m.server.claim.isNone then .error .unclaimed
  else if sender ≠ i.deviceKey then .error .notFromDevice
  else m.acceptSignIn i

/-- An empty store: the network unclaimed again, without invites or members. -/
def wipe (m : Members) : Members := { server := m.server.wipe }

/-- The order a store lists refs in: invites, withdrawals and joins come back by their invite's id. -/
def byId (a b : String) : Bool := decide (inviteId a ≤ inviteId b)

/-- A restart: the claim, then the invites, withdrawals and joins, each checked again, in the order the store lists
them: by their invite's id; then every sign-in, so a member's finds the member. A store keeps the sign-ins in the
order they came, the claimant's and the members' mixed; each passkey's come back in their order, which is all a
counter and a browser's name depend on, so the claimant's first and then the members' make the same tree. -/
def restore (m : Members) : Except MemberError Members := do
  let s ← match ({ m.server with signIns := [] } : Server).restore with
    | .ok s => pure s
    | .error why => .error (.claim why)
  let r ← (m.invites.mergeSort fun a b => byId a.key b.key).foldlM acceptInvite { server := s }
  let r ← (m.withdrawn.mergeSort fun a b => byId a.key b.key).foldlM acceptWithdrawal r
  let r ← (m.joins.mergeSort fun a b => byId a.invite b.invite).foldlM acceptJoin r
  (m.server.signIns ++ m.signIns.map (·.signIn)).foldlM acceptSignIn r

/-! ## The door -/

/-- Whether a device's vault is let in: the agent's own, a member's of the admin coop, or one that governs the coop. -/
def through (m : Members) (s : String) : Bool :=
  s == m.network || m.memberOf s m.coop || (m.tree.governs s).contains m.coop

def admitsDevice (m : Members) (d : String) : Bool :=
  match m.tree.actsFor d with
  | some s => m.through s
  | none => false

/-- The door, by key: the key of a device whose vault is let in. -/
def admits (m : Members) (key : String) : Bool := m.publics.any fun (d, k) => k == key && m.admitsDevice d

/-- What a browser that is no device yet may bring to the door. -/
inductive Pending where
  | claim (c : Claim)
  | signIn (i : SignIn)
  | join (j : Join)
  deriving DecidableEq, Repr

def take (m : Members) (sender : String) : Pending → Except MemberError Members
  | .claim c => m.submitClaim sender c
  | .signIn i => m.submitSignIn sender i
  | .join j => m.submitJoin sender j

/-- The relay and the hook admit a key the door admits; a newcomer only for a statement the network would take from
it now. -/
def newcomer (m : Members) (key : String) (p : Pending) : Bool := m.admits key || (m.take key p).toOption.isSome

/-! ## Theorems -/

variable {m m' : Members}

theorem adminAct_ok {network passkey text : String} {a : Assertion} (h : m.adminAct network passkey text a = .ok ()) :
    m.server.claim.isSome ∧ network = m.network ∧ m.adminKey passkey = true ∧
      a.check m.server.rp (challengeOf text) passkey = .ok () := by
  unfold adminAct at h
  split at h; · cases h
  next c =>
  split at h; · cases h
  next n =>
  split at h; · cases h
  next k =>
  split at h
  · cases h
  next e =>
  exact ⟨Option.ne_none_iff_isSome.mp (by simpa using c), Decidable.not_not.mp n, by simpa using k, e⟩

/-- A passkey that signs for the admin coop owns a vault that governs the coop. -/
theorem adminKey_governs {k : String} (h : m.adminKey k = true) :
    ∃ v, m.tree.KeyOwns k v ∧ m.tree.Governs v m.coop := by
  simp only [adminKey, Bool.and_eq_true, List.any_eq_true, List.contains_iff_mem] at h
  obtain ⟨_, v, _, o, g⟩ := h
  refine ⟨v, ?_, Tree.mem_below_sound (mem_dedup.mp g)⟩
  cases e : m.tree.get? v with
  | none => simp [e] at o
  | some u => exact ⟨u, e, by simpa [e] using o⟩

/-- Only the admin coop invites: an invite taken was signed by a passkey that owns a vault governing the coop, over
exactly the invite's text, on a claimed network; it adds that invite and nothing else. -/
theorem invite_admin {i : Invite} (h : m.acceptInvite i = .ok m') :
    m.server.claim.isSome ∧ (∃ v, m.tree.KeyOwns i.passkey v ∧ m.tree.Governs v m.coop) ∧
      i.assertion.check m.server.rp (challengeOf i.text) i.passkey = .ok () ∧
      m' = { m with invites := m.invites ++ [i] } := by
  unfold acceptInvite at h
  cases e : m.adminAct i.network i.passkey i.text i.assertion with
  | error => simp [e] at h; cases h
  | ok u =>
    cases u
    obtain ⟨c, _, k, a⟩ := adminAct_ok e
    simp only [e, bind, Except.bind] at h
    split at h; · cases h
    cases h
    exact ⟨c, adminKey_governs k, a, rfl⟩

theorem acceptJoin_ok {j : Join} (h : m.acceptJoin j = .ok m') :
    (m.invite? j.invite).isSome ∧ m.used j.invite = false ∧ m.isWithdrawn j.invite = false ∧
      j.signature = (j.invite, j.text) ∧ j.assertion.check m.server.rp (challengeOf j.text) j.passkey = .ok () ∧
      m.knows [j.person, j.passkey, j.device] [j.deviceKey, "es256:" ++ j.passkeyKey] = false ∧
      m' = { m with joins := m.joins ++ [j] } ∧ m'.tree.WF := by
  unfold acceptJoin at h
  split at h; · cases h
  split at h; · cases h
  split at h; · cases h
  next ni =>
  split at h; · cases h
  next nu =>
  split at h; · cases h
  next nw =>
  split at h; · cases h
  next ns =>
  split at h; · cases h
  split at h
  · cases h
  next e =>
  split at h; · cases h
  next nk =>
  split at h
  · cases h
  next hc =>
  cases h
  exact ⟨Option.ne_none_iff_isSome.mp (by simpa using ni), by simpa using nu, by simpa using nw, Decidable.not_not.mp ns, e, by simpa using nk,
    rfl, (Tree.check_iff _).mp hc⟩

/-- A join needs an invite the admin made, still open, and its one-time key signed exactly this join. -/
theorem join_invited {j : Join} (h : m.acceptJoin j = .ok m') :
    ∃ i ∈ m.invites, i.key = j.invite ∧ m.used j.invite = false ∧ m.isWithdrawn j.invite = false ∧
      j.signature = (j.invite, j.text) := by
  obtain ⟨ni, nu, nw, s, _⟩ := acceptJoin_ok h
  obtain ⟨i, e⟩ := Option.isSome_iff_exists.mp ni
  exact ⟨i, List.mem_of_find?_eq_some e, by simpa using List.find?_some e, nu, nw, s⟩

/-- Once an invite is used, every other join with it is refused. -/
theorem join_once {j j' : Join} (h : m.acceptJoin j = .ok m') (same : j'.invite = j.invite) :
    ∀ m'', m'.acceptJoin j' ≠ .ok m'' := by
  intro m'' h'
  have e := (acceptJoin_ok h).2.2.2.2.2.2.1
  have u := (acceptJoin_ok h').2.1
  subst e
  simp [used, same] at u

/-- An invite is used at most once: no two joins kept name one invite. -/
theorem joins_nodup {j : Join} (n : (m.joins.map (·.invite)).Nodup) (h : m.acceptJoin j = .ok m') :
    (m'.joins.map (·.invite)).Nodup := by
  obtain ⟨_, u, _, _, _, _, e, _⟩ := acceptJoin_ok h
  subst e
  simp only [List.map_append, List.map_cons, List.map_nil]
  refine List.nodup_append.mpr ⟨n, by simp, ?_⟩
  intro a ma b mb
  simp only [List.mem_singleton] at mb
  subst mb
  obtain ⟨x, mx, rfl⟩ := List.mem_map.mp ma
  intro e
  simp only [used, List.any_eq_false, beq_iff_eq] at u
  exact u x mx e

/-- A withdrawn invite admits nobody. -/
theorem join_withdrawn {j : Join} (w : m.isWithdrawn j.invite = true) : ∀ m', m.acceptJoin j ≠ .ok m' :=
  fun _ h => by simp [(acceptJoin_ok h).2.2.1] at w

/-- A used invite can't be withdrawn. -/
theorem withdraw_used {w : Withdrawal} (u : m.used w.key = true) : ∀ m', m.acceptWithdrawal w ≠ .ok m' := by
  intro m' h
  unfold acceptWithdrawal at h
  cases e : m.adminAct w.network w.passkey w.text w.assertion with
  | error => simp [e] at h; cases h
  | ok _ =>
    simp only [e, bind, Except.bind] at h
    split at h; · cases h
    simp at h

/-- A join founds the joiner's person vault, owned by its passkey and (with a guardian) MaiaCityGuardian, with the
joining browser as its device, a member of the admin coop; the tree holds, and no vault there was changes. Its two
vaults go in after the joins before it, ahead of the members' browsers that signed in. -/
theorem join_founds {j : Join} (h : m.acceptJoin j = .ok m') :
    (∃ pre post, m.tree.vaults = pre ++ post ∧
      m'.tree.vaults = pre ++ [⟨j.person, j.name ++ "'s vault", .person, m.server.founders j.passkey⟩,
        ⟨j.device, j.name ++ "'s browser", .device, [.vault j.person]⟩] ++ post) ∧ m'.tree.WF ∧
    m'.tree.KeyOwns j.passkey j.person ∧
    (∀ g, m.server.guardian = some g → Owner.key guardianId ∈ m.server.founders j.passkey) ∧
    m'.tree.actsFor j.device = some j.person ∧ m'.memberOf j.person m.coop = true ∧
    ∀ x ∈ m.tree.ids, m'.tree.get? x = m.tree.get? x := by
  obtain ⟨_, _, _, _, _, nk, e, w⟩ := acceptJoin_ok h
  subst e
  let pv : Vault := ⟨j.person, j.name ++ "'s vault", .person, m.server.founders j.passkey⟩
  let dv : Vault := ⟨j.device, j.name ++ "'s browser", .device, [.vault j.person]⟩
  have v0 : m.tree.vaults = (m.server.vaults ++ m.joins.flatMap (joinedVaults m.server)) ++
      signedInVaults [] m.signIns := by simp [tree, vaults]
  have v : ({ m with joins := m.joins ++ [j] } : Members).tree.vaults =
      (m.server.vaults ++ m.joins.flatMap (joinedVaults m.server)) ++ [pv, dv] ++ signedInVaults [] m.signIns := by
    simp [pv, dv, tree, vaults, joinedVaults]
  simp only [knows, Bool.or_eq_false_iff, List.any_eq_false] at nk
  have np : j.person ∉ m.tree.ids := fun mp => nk.1 j.person mp (by simp)
  have nd : j.device ∉ m.tree.ids := fun mp => nk.1 j.device mp (by simp)
  have old := Tree.get?_insert v0 v (by
    intro u mu
    simp only [List.mem_cons, List.not_mem_nil, or_false] at mu
    rcases mu with rfl | rfl
    · exact np
    · exact nd)
  have gp := Tree.get?_of_mem w.nodup (v := pv) (by rw [v]; simp)
  have gd := Tree.get?_of_mem w.nodup (v := dv) (by rw [v]; simp)
  refine ⟨⟨_, _, v0, v⟩, w, ⟨_, gp, by simp [pv, Server.founders, Vault.ownerKeys, Owner.key?]⟩, ?_, ?_,
    by simp [memberOf, members, coop], old⟩
  · intro g hg
    simp [Server.founders, hg]
  · simp [Tree.actsFor, dv, gd, Vault.ownerVaults, Owner.vault?]

/-- The door hangs on the admin coop's membership: it admits exactly the keys of devices whose vault is the agent's
own, a member's of the coop, or one that governs the coop: the Aven Peer, the members' devices and the devices of the
coop's people. -/
theorem admits_iff (w : m.tree.WF) {key : String} :
    m.admits key = true ↔ ∃ d s, (d, key) ∈ m.publics ∧ m.tree.actsFor d = some s ∧
      (s = m.network ∨ m.memberOf s m.coop = true ∨ m.tree.Governs s m.coop) := by
  simp only [admits, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, Prod.exists]
  constructor
  · rintro ⟨d, k, mk, rfl, a⟩
    unfold admitsDevice at a
    split at a
    · next s e =>
      simp only [through, Bool.or_eq_true, beq_iff_eq, List.contains_iff_mem] at a
      refine ⟨d, s, mk, e, ?_⟩
      rcases a with (a | a) | a
      · exact .inl a
      · exact .inr (.inl a)
      · exact .inr (.inr ((Tree.mem_governs w).mp a))
    · cases a
  · rintro ⟨d, s, mk, e, a⟩
    refine ⟨d, key, mk, rfl, ?_⟩
    simp only [admitsDevice, e, through, Bool.or_eq_true, beq_iff_eq, List.contains_iff_mem]
    rcases a with a | a | a
    · exact .inl (.inl a)
    · exact .inl (.inr a)
    · exact .inr ((Tree.mem_governs w).mpr a)

/-- The door admits only keys of the tree's devices: no stranger's, no invite's, no passkey's. -/
theorem admits_device {key : String} (h : m.admits key = true) :
    ∃ d, (d, key) ∈ m.publics ∧ m.tree.kind? d = some .device := by
  simp only [admits, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, Prod.exists] at h
  obtain ⟨d, k, mk, rfl, a⟩ := h
  unfold admitsDevice at a
  split at a
  · next s e => exact ⟨d, mk, (Tree.actsFor_some e).2⟩
  · cases a

/-- A wipe makes the network unclaimed, without invites or members. -/
theorem wipe_empty : m.wipe.server.claim = none ∧ m.wipe.invites = [] ∧ m.wipe.joins = [] := ⟨rfl, rfl, rfl⟩

end Members
end Aven.ID
