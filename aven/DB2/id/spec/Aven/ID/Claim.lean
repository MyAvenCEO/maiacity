import Aven.ID.Passkey
import Aven.ID.Check
import Aven.ID.Governs

/-! # Unclaimed and claimed

In production the tree is data the Aven Peer keeps through its store (PRODUCTION.md, "The tree becomes data"). Before
its claim, the tree holds Aven, the agent that runs the network, whose vault has no owner yet, and the Aven Peer, its
device. A statement's `network` names the network it is for by its agent's id (`aven`): the stored texts keep that
word, and read as they always have. The claim is the
first signup (Samuel, 30 Oct 2026: no code), one statement signed by a passkey, which founds this tree (PRODUCTION.md,
Part C; Aven is an agent, Samuel, 30 Oct 2026):

```
<name>'s vault         person   owned by the passkey and, when the Aven Peer is given one, MaiaCityGuardian
├── Maia City          coop     the admin coop, owned by the person's vault
│   └── Aven           agent    owned by Maia City: it runs the members' network for it
│       └── Aven Peer  device
└── <name>'s browser   device   acts for the person's vault
```

The person's name is the one asked at signup, which the passkey signs (`validPersonName`). The coop's id and name are
the Aven Peer's configuration (`--admin-coop`, `Maia City` by default): read at every start, never signed, so the coop
is renamed by a restart with another name. The stored claims of the days the agent was called a network's vault read
the same: their tree is the one they made then but for that one kind (`Aven.ID.Before`). Each later sign-in is a statement signed by the same passkey that adds one
more browser, `<name>'s browser 2`, `3`, … in the order they came. A member signs in with the same statement, signed
by their own passkey, which the network keeps beside its members (`Aven.ID.Invite`, "Sign-ins"; `Aven.ID.SignIn`):
the claimant's sign-ins are the ones kept here. The Aven Peer keeps each statement as a blob, the
claim under the ref `claim`, set from nothing by compare-and-set, so a second claim is refused even racing the first.

A statement's passkey signs its text, through the challenge (`challengeOf`): so it binds the network, the vaults it
names and every public half, the browser's device key included, and an assertion replayed for another browser fails
its challenge. The browser sending a statement must be the device it names: the Aven Peer compares the connection's
key with it (`sender`).

A passkey that counts its signatures must count up: a sign-in whose counter isn't above the last one the network
kept for that passkey, while either is not 0, is refused, as WebAuthn advises against a cloned authenticator. Synced passkeys keep the
counter at 0, and pass.

A restart reads the tree back (`restore`): every stored statement is checked again, as when it came. A wipe empties
the store, and the network is unclaimed again.

Theorems: a server is claimed at most once (`claim_once`); after its claim the claimant's vault, which its passkey
owns, is the admin coop's one owner, the coop the agent's, the tree is well formed, no device governs anything and
the coop holds no devices (`claim_admin`); a sign-in adds
one device and changes no vault that was there (`signIn_adds`); the agent's vault lacks an owner only before its claim
(`unclaimed_vaults`, `claimed_owned`); with a guardian configured, every person's vault founded has it among its
owners (`guardian_owns`). -/

namespace Aven.ID

/-- A claim: the network, the claimant's person vault and their name, their passkey (SubjectPublicKeyInfo in hex),
the claiming browser and its Ed25519 key (hex), and the passkey's assertion over the claim's text. -/
structure Claim where
  network : String
  person : String
  name : String
  passkey : String
  passkeyKey : String
  device : String
  deviceKey : String
  assertion : Assertion
  deriving DecidableEq, Repr

/-- A sign-in: the network, the browser that signs in and its key, and the passkey's assertion over its text. -/
structure SignIn where
  network : String
  device : String
  deviceKey : String
  assertion : Assertion
  deriving DecidableEq, Repr

/-- What a claim's passkey signs, through its challenge. -/
def Claim.text (c : Claim) : String :=
  "avenID claim 2\nnetwork " ++ c.network ++ "\nperson " ++ c.person ++ "\nname " ++ c.name ++ "\npasskey " ++
    c.passkey ++ " " ++ c.passkeyKey ++ "\ndevice " ++ c.device ++ " " ++ c.deviceKey ++ "\n"

/-- The vaults named after the claimant: their vault, and their browsers, the claiming one first. -/
def Claim.vaultName (c : Claim) : String := c.name ++ "'s vault"

/-- A person's browsers, named after them: the first `<name>'s browser`, then `<name>'s browser 2`, `3`, … -/
def browserName (name : String) (n : Nat) : String :=
  if n = 1 then name ++ "'s browser" else name ++ "'s browser " ++ toString n

def Claim.browser (c : Claim) (n : Nat) : String := browserName c.name n

def SignIn.text (i : SignIn) : String :=
  "avenID sign-in 1\nnetwork " ++ i.network ++ "\ndevice " ++ i.device ++ " " ++ i.deviceKey ++ "\n"

/-- MaiaCityGuardian's key, by the id trees know it by. -/
def guardianId : String := "maia-city-guardian"

/-- The names of the agent's vault, which runs the network, and its device. -/
def networkName : String := "Aven"
def peerName : String := "Aven Peer"

/-- An Aven Peer that keeps its tree: its agent's vault (`network`, the id the network goes by), its own device and
key, the relying party its passkeys are for, MaiaCityGuardian's public half if it is given one, the admin coop's id and name, and the statements its
store holds. -/
structure Server where
  network : String
  peer : String
  peerKey : String
  rp : Relying
  guardian : Option String := none
  coop : String := "maia-city"
  coopName : String := "Maia City"
  claim : Option Claim := none
  signIns : List SignIn := []
  deriving DecidableEq, Repr

inductive ClaimError where
  /-- the network is claimed already -/
  | taken
  /-- the statement names another device than the browser that sent it -/
  | notFromDevice
  | wrongNetwork
  /-- the person's name is none: 1 to 48 characters, no control characters -/
  | name
  | assertion (why : AssertionError)
  /-- the tree it would make is not well formed -/
  | invalid (why : Invalid)
  /-- a sign-in before any claim -/
  | unclaimed
  /-- a sign-in for a device or key the tree has -/
  | known
  /-- a sign-in whose passkey's counter did not count up -/
  | counter
  deriving DecidableEq, Repr

namespace Server

/-- The tree's keys with their public halves: a passkey's written `es256:<SPKI>`, a device's and the guardian's as
Ed25519 hex. -/
def publics (s : Server) : List (String × String) :=
  match s.claim with
  | none => [(s.peer, s.peerKey)]
  | some c => [(c.passkey, "es256:" ++ c.passkeyKey)] ++ s.guardian.toList.map (guardianId, ·) ++
    [(s.peer, s.peerKey), (c.device, c.deviceKey)] ++ s.signIns.map fun i => (i.device, i.deviceKey)

/-- A person's vault's owners when it is founded: its passkey, and the guardian if there is one. -/
def founders (s : Server) (passkey : String) : List Owner :=
  .key passkey :: s.guardian.toList.map fun _ => .key guardianId

def vaults (s : Server) : List Vault :=
  match s.claim with
  | none => [⟨s.network, networkName, .agent, []⟩, ⟨s.peer, peerName, .device, [.vault s.network]⟩]
  | some c => [⟨c.person, c.vaultName, .person, s.founders c.passkey⟩,
      ⟨s.coop, s.coopName, .coop, [.vault c.person]⟩, ⟨s.network, networkName, .agent, [.vault s.coop]⟩,
      ⟨s.peer, peerName, .device, [.vault s.network]⟩, ⟨c.device, c.browser 1, .device, [.vault c.person]⟩] ++
    s.signIns.mapIdx fun k i => ⟨i.device, c.browser (k + 2), .device, [.vault c.person]⟩

def tree (s : Server) : Tree := ⟨s.publics.map (·.1), s.vaults⟩

/-- A claim's statement, checked: its network, the person's name, its passkey's assertion over its text, and the
tree it makes. -/
def acceptClaim (s : Server) (c : Claim) : Except ClaimError Server :=
  if c.network ≠ s.network then .error .wrongNetwork
  else if validPersonName c.name = false then .error .name
  else match c.assertion.check s.rp (challengeOf c.text) c.passkey with
    | .error why => .error (.assertion why)
    | .ok () => match ({ s with claim := some c } : Server).tree.check with
      | some why => .error (.invalid why)
      | none => .ok { s with claim := some c }

/-- A claim, the first signup, as a browser sends it: refused once claimed, then from another browser. -/
def submitClaim (s : Server) (sender : String) (c : Claim) : Except ClaimError Server :=
  if s.claim.isSome then .error .taken
  else if sender ≠ c.deviceKey then .error .notFromDevice
  else s.acceptClaim c

/-- Whether the tree has this device already, by its id or its key. -/
def knows (s : Server) (device key : String) : Bool :=
  s.tree.ids.contains device || s.publics.any fun (id, k) => id == device || k == key

/-- The last signature counter the network kept for its passkey: its claim's, then each sign-in's. -/
def lastCounter (s : Server) : Nat :=
  ((s.claim.map (·.assertion.counter)).toList ++ s.signIns.map (·.assertion.counter)).getLastD 0

def acceptSignIn (s : Server) (i : SignIn) : Except ClaimError Server :=
  match s.claim with
  | none => .error .unclaimed
  | some c =>
    if i.network ≠ s.network then .error .wrongNetwork
    else if s.knows i.device i.deviceKey then .error .known
    else match i.assertion.check s.rp (challengeOf i.text) c.passkey with
      | .error why => .error (.assertion why)
      | .ok () =>
        if (i.assertion.counter ≠ 0 ∨ s.lastCounter ≠ 0) ∧ i.assertion.counter ≤ s.lastCounter then .error .counter
        else match ({ s with signIns := s.signIns ++ [i] } : Server).tree.check with
        | some why => .error (.invalid why)
        | none => .ok { s with signIns := s.signIns ++ [i] }

def submitSignIn (s : Server) (sender : String) (i : SignIn) : Except ClaimError Server :=
  if s.claim.isNone then .error .unclaimed
  else if sender ≠ i.deviceKey then .error .notFromDevice
  else s.acceptSignIn i

/-- An empty store: the network unclaimed again. -/
def wipe (s : Server) : Server := { s with claim := none, signIns := [] }

/-- A restart: the tree read back sender the stored statements, each checked again as when it came. -/
def restore (s : Server) : Except ClaimError Server := do
  let r ← match s.claim with
    | some c => s.wipe.acceptClaim c
    | none => pure s.wipe
  s.signIns.foldlM acceptSignIn r

/-! ## Theorems -/

variable {s s' : Server}

theorem acceptClaim_ok {c : Claim} (h : s.acceptClaim c = .ok s') :
    s' = { s with claim := some c } ∧ s'.tree.WF ∧ c.assertion.check s.rp (challengeOf c.text) c.passkey = .ok () := by
  unfold acceptClaim at h
  split at h
  · cases h
  split at h
  · cases h
  split at h
  · cases h
  next e =>
  split at h
  · cases h
  next hc =>
  cases h
  exact ⟨rfl, (Tree.check_iff _).mp hc, e⟩

/-- A server is claimed at most once: once it has a claim, every claim is refused. -/
theorem claim_once {sender : String} {c : Claim} (h : s.claim.isSome) : s.submitClaim sender c = .error .taken :=
  by simp [submitClaim, h]

/-- A claim that is accepted is the server's claim, and the next is refused. -/
theorem claim_then_taken {sender sender' : String} {c c' : Claim} (h : s.submitClaim sender c = .ok s') :
    s'.claim = some c ∧ s'.submitClaim sender' c' = .error .taken := by
  unfold submitClaim at h
  split at h; · cases h
  split at h; · cases h
  have e := (acceptClaim_ok h).1
  subst e
  exact ⟨rfl, claim_once rfl⟩

/-- After its claim, the claimant's vault, which its passkey owns, is the admin coop's one owner, and the coop the
agent's; the tree is well formed, no device governs anything, and the coop holds no devices. -/
theorem claim_admin {sender : String} {c : Claim} (h : s.submitClaim sender c = .ok s') :
    s'.tree.WF ∧ s'.tree.kind? s.coop = some .coop ∧ s'.tree.ownersOf s.coop = [c.person] ∧
    s'.tree.ownersOf s.network = [s.coop] ∧ s'.tree.KeyOwns c.passkey c.person ∧
    (∀ d x, s'.tree.kind? d = some .device → ¬ s'.tree.Governs d x) ∧
    ∀ d, s'.tree.kind? d = some .device → ¬ s'.tree.Owns s.coop d := by
  unfold submitClaim at h
  split at h; · cases h
  split at h; · cases h
  obtain ⟨e, w, _⟩ := acceptClaim_ok h
  subst e
  have v : ({ s with claim := some c } : Server).tree.vaults = ⟨c.person, c.vaultName, .person, s.founders c.passkey⟩ ::
      ⟨s.coop, s.coopName, .coop, [.vault c.person]⟩ :: ⟨s.network, networkName, .agent, [.vault s.coop]⟩ ::
      (⟨s.peer, peerName, .device, [.vault s.network]⟩ :: ⟨c.device, c.browser 1, .device, [.vault c.person]⟩ ::
      s.signIns.mapIdx fun k i => ⟨i.device, c.browser (k + 2), .device, [.vault c.person]⟩) := by
    simp [tree, vaults, founders]
  have n := w.nodup
  unfold Tree.ids at n
  rw [v] at n
  simp only [List.map_cons, List.nodup_cons, List.mem_cons] at n
  have pc : c.person ≠ s.coop := fun e => n.1 (.inl e)
  have pn : c.person ≠ s.network := fun e => n.1 (.inr (.inl e))
  have cn : s.coop ≠ s.network := fun e => n.2.1 (.inl e)
  have kc : ({ s with claim := some c } : Server).tree.kind? s.coop = some .coop := by
    simp [Tree.kind?, Tree.get?, v, pc]
  refine ⟨w, kc, ?_, ?_, ?_, fun d x k => Tree.device_governs_nothing w k, fun d k o => w.coop_no_device o k kc⟩
  · simp [Tree.ownersOf, Tree.get?, v, pc, Vault.ownerVaults, Owner.vault?]
  · simp [Tree.ownersOf, Tree.get?, v, pn, cn, Vault.ownerVaults, Owner.vault?]
  · exact ⟨⟨c.person, c.vaultName, .person, s.founders c.passkey⟩, by simp [Tree.get?, v],
      by simp [founders, Vault.ownerKeys, Owner.key?]⟩

theorem acceptSignIn_ok {i : SignIn} (h : s.acceptSignIn i = .ok s') :
    ∃ c, s.claim = some c ∧ s' = { s with signIns := s.signIns ++ [i] } ∧ s'.tree.WF ∧
      i.assertion.check s.rp (challengeOf i.text) c.passkey = .ok () := by
  unfold acceptSignIn at h
  split at h
  · cases h
  next c hc =>
  split at h; · cases h
  split at h; · cases h
  split at h
  · cases h
  next e =>
  split at h; · cases h
  split at h
  · cases h
  next hw =>
  cases h
  exact ⟨c, hc, rfl, (Tree.check_iff _).mp hw, e⟩

/-- A sign-in adds one device, of the claimant's vault and named after them, and changes no vault the tree had: not
its owners, nor the claim. -/
theorem signIn_adds {sender : String} {i : SignIn} (h : s.submitSignIn sender i = .ok s') :
    ∃ c, s.claim = some c ∧ s'.claim = s.claim ∧
      s'.tree.vaults = s.tree.vaults ++ [⟨i.device, c.browser (s.signIns.length + 2), .device, [.vault c.person]⟩] ∧
      s'.tree.WF ∧
      ∀ x ∈ s.tree.ids, s'.tree.get? x = s.tree.get? x := by
  unfold submitSignIn at h
  split at h; · cases h
  split at h; · cases h
  obtain ⟨c, hc, e, w, _⟩ := acceptSignIn_ok h
  subst e
  have v : ({ s with signIns := s.signIns ++ [i] } : Server).tree.vaults =
      s.tree.vaults ++ [⟨i.device, c.browser (s.signIns.length + 2), .device, [.vault c.person]⟩] := by
    simp [tree, vaults, founders, hc, List.mapIdx_append]
  refine ⟨c, hc, rfl, v, w, fun x m => ?_⟩
  have some : (s.tree.vaults.find? (·.id == x)).isSome := by
    obtain ⟨y, my, ey⟩ := List.mem_map.mp m
    exact List.find?_isSome.mpr ⟨y, my, by simp [ey]⟩
  unfold Tree.get?
  rw [v, List.find?_append]
  cases g : s.tree.vaults.find? (·.id == x) with
  | none => simp [g] at some
  | some y => rfl

/-- Before its claim, the tree is the agent's vault, with no owner, and the Aven Peer, its device. -/
theorem unclaimed_vaults (h : s.claim = none) :
    s.tree.vaults = [⟨s.network, networkName, .agent, []⟩, ⟨s.peer, peerName, .device, [.vault s.network]⟩] := by
  simp [tree, vaults, h]

/-- After its claim, every vault has an owner: the agent's lacks one only before. -/
theorem claimed_owned {sender : String} {c : Claim} (h : s.submitClaim sender c = .ok s') :
    ∀ v ∈ s'.tree.vaults, v.owners ≠ [] :=
  (claim_admin h).1.owned

/-- With a guardian configured, every person's vault founded has it among its owners: in every tree the server
keeps, before and after its claim and every sign-in. -/
theorem guardian_owns {g : String} (h : s.guardian = some g) :
    ∀ v ∈ s.tree.vaults, v.kind = .person → Owner.key guardianId ∈ v.owners := by
  intro v m k
  unfold tree vaults at m
  cases hc : s.claim with
  | none =>
    simp only [hc, List.mem_cons, List.not_mem_nil, or_false] at m
    rcases m with rfl | rfl <;> simp at k
  | some c =>
    simp only [hc] at m
    rcases List.mem_append.mp m with m | m
    · simp only [List.mem_cons, List.not_mem_nil, or_false] at m
      rcases m with rfl | rfl | rfl | rfl | rfl
      · simp [founders, h]
      all_goals simp at k
    · obtain ⟨k', i, _, rfl⟩ := List.mem_mapIdx.mp m
      simp at k

/-- A wipe makes the network unclaimed: the next claim is not refused as taken. -/
theorem wipe_unclaimed : s.wipe.claim = none := rfl

end Server
end Aven.ID
