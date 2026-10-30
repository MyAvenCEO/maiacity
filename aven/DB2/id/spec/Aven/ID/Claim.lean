import Aven.ID.Passkey
import Aven.ID.Check
import Aven.ID.Governs

/-! # Unclaimed and claimed

In production the tree is data the Aven Peer keeps through its store (PRODUCTION.md, "The tree becomes data"). Before
its claim, the tree holds the network's vault, which has no owner yet, and the Aven Peer, its device. The claim is the
first signup (Samuel, 30 Oct 2026: no code), one statement signed by a passkey: it adds the claimant's person vault,
owned by that passkey (a key of the `es256` suite) and, when the Aven Peer is given one, by MaiaCityGuardian, the
master recovery key; makes it the network's owner; and adds the claiming browser as a device of it. Each later sign-in is a
statement signed by the same passkey that adds one more browser. The Aven Peer keeps each statement as a blob, the
claim under the ref `claim`, set from nothing by compare-and-set, so a second claim is refused even racing the first.

A statement's passkey signs its text, through the challenge (`challengeOf`): so it binds the network, the vaults it
names and every public half, the browser's device key included, and an assertion replayed for another browser fails
its challenge. The browser sending a statement must be the device it names: the Aven Peer compares the connection's
key with it (`sender`).

A passkey that counts its signatures must count up: a sign-in whose counter isn't above the last one the network
kept, while either is not 0, is refused, as WebAuthn advises against a cloned authenticator. Synced passkeys keep the
counter at 0, and pass.

A restart reads the tree back (`restore`): every stored statement is checked again, as when it came. A wipe empties
the store, and the network is unclaimed again.

Theorems: a server is claimed at most once (`claim_once`); after its claim the network's owner is the claimant's
vault, which its passkey owns, the tree is well formed and no device governs anything (`claim_admin`); a sign-in adds
one device and changes no vault that was there (`signIn_adds`); the network vault lacks an owner only before its claim
(`unclaimed_vaults`, `claimed_owned`); with a guardian configured, every person's vault founded has it among its
owners (`guardian_owns`). -/

namespace Aven.ID

/-- A claim: the network, the claimant's person vault and its passkey (SubjectPublicKeyInfo in hex), the claiming
browser and its Ed25519 key (hex), and the passkey's assertion over the claim's text. -/
structure Claim where
  network : String
  person : String
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
  "avenID claim 1\nnetwork " ++ c.network ++ "\nperson " ++ c.person ++ "\npasskey " ++ c.passkey ++ " " ++
    c.passkeyKey ++ "\ndevice " ++ c.device ++ " " ++ c.deviceKey ++ "\n"

def SignIn.text (i : SignIn) : String :=
  "avenID sign-in 1\nnetwork " ++ i.network ++ "\ndevice " ++ i.device ++ " " ++ i.deviceKey ++ "\n"

/-- MaiaCityGuardian's key, by the id trees know it by. -/
def guardianId : String := "maia-city-guardian"

/-- An Aven Peer that keeps its tree: its network's vault, its own device and key, the relying party its passkeys
are for, MaiaCityGuardian's public half if it is given one, and the statements its store holds. -/
structure Server where
  network : String
  peer : String
  peerKey : String
  rp : Relying
  guardian : Option String := none
  claim : Option Claim := none
  signIns : List SignIn := []
  deriving DecidableEq, Repr

inductive ClaimError where
  /-- the network is claimed already -/
  | taken
  /-- the statement names another device than the browser that sent it -/
  | notFromDevice
  | wrongNetwork
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
  | none => [⟨s.network, .network, []⟩, ⟨s.peer, .device, [.vault s.network]⟩]
  | some c => [⟨c.person, .person, s.founders c.passkey⟩, ⟨s.network, .network, [.vault c.person]⟩,
      ⟨s.peer, .device, [.vault s.network]⟩, ⟨c.device, .device, [.vault c.person]⟩] ++
    s.signIns.map fun i => ⟨i.device, .device, [.vault c.person]⟩

def tree (s : Server) : Tree := ⟨s.publics.map (·.1), s.vaults⟩

/-- A claim's statement, checked: its network, its passkey's assertion over its text, and the tree it makes. -/
def acceptClaim (s : Server) (c : Claim) : Except ClaimError Server :=
  if c.network ≠ s.network then .error .wrongNetwork
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

/-- After its claim, the network's one owner is the claimant's vault, which its passkey owns; the tree is well
formed, and no device governs anything. -/
theorem claim_admin {sender : String} {c : Claim} (h : s.submitClaim sender c = .ok s') :
    s'.tree.WF ∧ s'.tree.ownersOf s.network = [c.person] ∧ s'.tree.KeyOwns c.passkey c.person ∧
    ∀ d x, s'.tree.kind? d = some .device → ¬ s'.tree.Governs d x := by
  unfold submitClaim at h
  split at h; · cases h
  split at h; · cases h
  obtain ⟨e, w, _⟩ := acceptClaim_ok h
  subst e
  have v : ({ s with claim := some c } : Server).tree.vaults = ⟨c.person, .person, s.founders c.passkey⟩ ::
      ⟨s.network, .network, [.vault c.person]⟩ :: (⟨s.peer, .device, [.vault s.network]⟩ ::
      ⟨c.device, .device, [.vault c.person]⟩ :: s.signIns.map fun i => ⟨i.device, .device, [.vault c.person]⟩) := by
    simp [tree, vaults, founders]
  have ne : c.person ≠ s.network := by
    have n := w.nodup
    unfold Tree.ids at n
    rw [v] at n
    simp only [List.map_cons, List.nodup_cons, List.mem_cons] at n
    exact fun e => n.1 (.inl e)
  refine ⟨w, ?_, ?_, fun d x k => Tree.device_governs_nothing w k⟩
  · simp [Tree.ownersOf, Tree.get?, v, ne, Vault.ownerVaults, Owner.vault?]
  · exact ⟨⟨c.person, .person, s.founders c.passkey⟩, by simp [Tree.get?, v],
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

/-- A sign-in adds one device, of the claimant's vault, and changes no vault the tree had: not its owners, nor the
claim. -/
theorem signIn_adds {sender : String} {i : SignIn} (h : s.submitSignIn sender i = .ok s') :
    ∃ c, s.claim = some c ∧ s'.claim = s.claim ∧
      s'.tree.vaults = s.tree.vaults ++ [⟨i.device, .device, [.vault c.person]⟩] ∧ s'.tree.WF ∧
      ∀ x ∈ s.tree.ids, s'.tree.get? x = s.tree.get? x := by
  unfold submitSignIn at h
  split at h; · cases h
  split at h; · cases h
  obtain ⟨c, hc, e, w, _⟩ := acceptSignIn_ok h
  subst e
  have v : ({ s with signIns := s.signIns ++ [i] } : Server).tree.vaults =
      s.tree.vaults ++ [⟨i.device, .device, [.vault c.person]⟩] := by
    simp [tree, vaults, founders, hc]
  refine ⟨c, hc, rfl, v, w, fun x m => ?_⟩
  have some : (s.tree.vaults.find? (·.id == x)).isSome := by
    obtain ⟨y, my, ey⟩ := List.mem_map.mp m
    exact List.find?_isSome.mpr ⟨y, my, by simp [ey]⟩
  unfold Tree.get?
  rw [v, List.find?_append]
  cases g : s.tree.vaults.find? (·.id == x) with
  | none => simp [g] at some
  | some y => rfl

/-- Before its claim, the tree is the network's vault, with no owner, and the Aven Peer, its device. -/
theorem unclaimed_vaults (h : s.claim = none) :
    s.tree.vaults = [⟨s.network, .network, []⟩, ⟨s.peer, .device, [.vault s.network]⟩] := by
  simp [tree, vaults, h]

/-- After its claim, every vault has an owner: the network's lacks one only before. -/
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
      rcases m with rfl | rfl | rfl | rfl
      · simp [founders, h]
      all_goals simp at k
    · obtain ⟨i, _, rfl⟩ := List.mem_map.mp m
      simp at k

/-- A wipe makes the network unclaimed: the next claim is not refused as taken. -/
theorem wipe_unclaimed : s.wipe.claim = none := rfl

end Server
end Aven.ID
