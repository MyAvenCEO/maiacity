import Aven.ID.Network
import Aven.ID.InviteTrace

/-! # Production's tree, settled (PEERS.md §5, "Production's tree")

Production is never wiped. Its Aven Peer holds the claim, the claimant's sign-ins, the invites, withdrawals and joins
and the members' sign-ins, under their ref names (`claim`, `signin-NNNNNN`, `invite-<id>`, `withdrawn-<id>`,
`joined-<id>`), and `Members.restore` reads them back in that order. Under A11 and A12 the claimant signs a genesis
once, with their passkey and MaiaCityGuardian, and the old statements become tree statements after it, each naming the
one before it as a parent: the ref order becomes their past (`migrate`). Each join's claim is confirmed once, by the
claimant's passkey, which owns a confirmer vault (A38): the member cap each joined vault holds at the switch. Here a
migrated statement's name is its place, as 32 bytes (`num`); the release that migrates names each envelope by its
hash.

`settle_restore`: every statement `migrate` makes counts and descends from the genesis, so nothing production holds is
lost by the change of rule. `restore_agrees` checks the rest on every invite trace, the examples and the generated
ones, at every step: the settled door admits exactly the keys `Members.admits` admits, and the settled member vaults
are the claimant's, the admin coop, the agent and every vault a join founded. That part is checked, not yet proved for
every store: proving it in general means relating `settle` to `Members.tree`'s owners and `Tree.actsFor`, which is
left for later (PEERS.md, "Open"). -/

namespace Aven.ID
namespace Restore

/-- An old statement, as production's store holds it. Sign-ins are not among them: the migration takes them into the
snapshot, the claimant's into the genesis's devices and each member's into its join's claim (A42), so no passkey
without an owner signs anything but the owner-epoch op. -/
inductive Old where
  | invite (i : Invite)
  | withdrawal (w : Withdrawal)
  | join (j : Join)
  /-- the member cap a join's vault gets at the switch (A38): the migration confirms it with Maia City's approval -/
  | confirm (j : Join)
  deriving DecidableEq, Repr

/-- The old statements after the claim, in the order `Members.restore` reads them: the invites, withdrawals and joins
by their invite's id, then each join's member cap (A38). -/
def refOrder (m : Members) : List Old :=
  (m.invites.mergeSort fun a b => Members.byId a.key b.key).map .invite ++
    (m.withdrawn.mergeSort fun a b => Members.byId a.key b.key).map .withdrawal ++
    (m.joins.mergeSort fun a b => Members.byId a.invite b.invite).map .join ++
    (m.joins.mergeSort fun a b => Members.byId a.invite b.invite).map .confirm

/-- The keys signed at the switch: MaiaCityGuardian's hybrid keys, and the claimant's owner and seal keys from their
passkey's PRF as they sign the genesis in avenOS. -/
structure SwitchKeys where
  guardian : GuardianKeys
  owner : HybridKey
  sealKey : String
  deriving DecidableEq, Repr

/-- A passkey's record as production stored it: its credential and key, with no owner or seal until it adds them
(`ownerEpoch`, A42). -/
def stored (passkey : String) : Passkey := ⟨passkey, passkey, none, none, 1⟩

/-- A member's devices at the switch: its join's browser and every browser it signed in. -/
def memberDevices (m : Members) (j : Join) : List String :=
  j.deviceKey :: (m.signIns.filter (·.member == j)).map (·.signIn.deviceKey)

/-- The first index in `l` where `p` holds. -/
def indexWhere {α : Type} (p : α → Bool) : List α → Option Nat
  | [] => none
  | a :: l => if p a then some 0 else (indexWhere p l).map (· + 1)

/-- A migrated statement's name: its place in the ref order as Core's 32 bytes, big-endian. 0 names nothing, the
genesis is 1. -/
def num (n : Nat) : Core.Hash := ⟨Core.be 32 n⟩

/-- The genesis's name. -/
def genesisName : Core.Hash := num 1

/-- The name `migrate` gives the `k`-th old statement. -/
def nameAt (k : Nat) : Core.Hash := num (k + 2)

/-- Whether an old statement is the invite with this key. -/
def isInvite (key : String) : Old → Bool
  | .invite i => i.key == key
  | _ => false

/-- Whether an old statement is the join of this invite. -/
def isJoin (key : String) : Old → Bool
  | .join j => j.invite == key
  | _ => false

/-- The name of the claim a join of this invite becomes; `num 0`, which names nothing, if there is none. -/
def joinName (olds : List Old) (key : String) : Core.Hash :=
  match indexWhere (isJoin key) olds with
  | some k => nameAt k
  | none => num 0

/-- The name of the ticket statement for an invite's one-time key; `num 0`, which names nothing, if there is none. -/
def ticketName (olds : List Old) (key : String) : Core.Hash :=
  match indexWhere (isInvite key) olds with
  | some k => nameAt k
  | none => num 0

/-- The genesis the claimant signs for production's claim: its relying party, the claimant's vault, passkey (with the
owner and seal keys its PRF gives at the signing) and devices (the claiming browser and every one it signed in), the
admin coop, the agent and the Aven Peer's key, and the guardian's hybrid keys (A13). -/
def genesisOf (s : Founding) (c : Claim) (g : SwitchKeys) : Genesis :=
  { rpId := s.rp.rpId, origins := s.rp.origins, claimant := c.person,
    passkey := ⟨c.passkey, c.passkey, some g.owner, some g.sealKey, 1⟩,
    devices := c.deviceKey :: s.signIns.map (·.deviceKey),
    coop := s.coop, coopOwners := [c.person], agent := s.network, avenPeer := s.peerKey, guardian := g.guardian,
    guardianVault := guardianId, confirmers := [s.network, c.person],
    signedBy := [c.passkey, g.guardian.ed25519, g.guardian.mlDsa] }

/-- An old statement's signer and what it says as a tree statement. Devices go by their keys, as the door does; a
join's claim carries its passkey's stored record and its member's devices. -/
def Old.says (m : Members) (c : Claim) : Old → String × TreeSays
  | .invite i => (i.passkey, .ticket i.key)
  | .withdrawal w => (w.passkey, .withdrawal (ticketName (refOrder m) w.key))
  | .join j => (j.invite, .claim (ticketName (refOrder m) j.invite) j.person (stored j.passkey) (memberDevices m j)
      guardianId)
  | .confirm j => (c.passkey, .confirm (joinName (refOrder m) j.invite))

/-- The genesis statement production's claim becomes, named `genesisName`. -/
def genesisStatement (m : Members) (c : Claim) (g : SwitchKeys) : TreeStatement :=
  ⟨genesisName, c.passkey, [], .genesis (genesisOf m.founding c g)⟩

/-- What an old statement names besides the one before it: a join, its invite's ticket. -/
def Old.parents (olds : List Old) : Old → List Core.Hash
  | .join j => [ticketName olds j.invite]
  | .confirm j => [joinName olds j.invite]
  | _ => []

/-- The `k`-th old statement as a tree statement: named `nameAt k`, naming the one before it, and a join its ticket. -/
def step (m : Members) (c : Claim) (k : Nat) (o : Old) : TreeStatement :=
  let (signer, says) := o.says m c
  ⟨nameAt k, signer, num (k + 1) :: o.parents (refOrder m), says⟩

/-- Production's store as tree statements: the genesis, then every old statement in ref order, each naming the one
before it (a join its ticket too). An unclaimed store has none. -/
def migrate (m : Members) (g : SwitchKeys) : List TreeStatement :=
  match m.founding.claim with
  | none => []
  | some c => genesisStatement m c g :: (refOrder m).mapIdx (step m c)

/-! ## Every migrated statement counts -/

theorem step_name (m : Members) (c : Claim) (k : Nat) (o : Old) :
    (step m c k o).name = nameAt k ∧ (step m c k o).parents = num (k + 1) :: o.parents (refOrder m) := by
  simp [step]

/-- Each migrated old statement has the genesis in its past: its parent is the one before it, down to the genesis. -/
theorem migrate_past (m : Members) (g : SwitchKeys) (c : Claim) (hc : m.founding.claim = some c) :
    ∀ k (hk : k < ((refOrder m).mapIdx (step m c)).length),
      Core.Past.Before TreeStatement.name (migrate m g) (((refOrder m).mapIdx (step m c))[k])
        (genesisStatement m c g) := by
  have mem : ∀ k (hk : k < ((refOrder m).mapIdx (step m c)).length),
      ((refOrder m).mapIdx (step m c))[k] ∈ migrate m g := fun k hk => by
    simp only [migrate, hc]
    exact List.mem_cons_of_mem _ (List.getElem_mem hk)
  intro k
  induction k with
  | zero =>
    intro hk
    refine .tip (by simp [migrate, hc]) ?_
    simp [List.getElem_mapIdx, step_name, genesisStatement, genesisName, Core.Past.parents]
  | succ k ih =>
    intro hk
    have hk' : k < ((refOrder m).mapIdx (step m c)).length := by omega
    refine Core.Past.Before.trans (.tip (mem k hk') ?_) (ih hk')
    simp [List.getElem_mapIdx, step_name, nameAt, Core.Past.parents]

/-- **`settle_restore`**, its general half: given a genesis both its signers signed, every statement production holds
counts in the settled tree. The change of rule loses nothing. -/
theorem settle_restore (m : Members) (g : SwitchKeys) (c : Claim) (hc : m.founding.claim = some c)
    (signed : (genesisOf m.founding c g).consented = true) :
    ∀ s ∈ migrate m g, (settle genesisName (migrate m g)).counted s.name = true := by
  intro s ms
  have hg : Settle.pinnedGenesis genesisName (genesisStatement m c g) = true := by
    simp [Settle.pinnedGenesis, genesisStatement, signed]
  have mg : genesisStatement m c g ∈ migrate m g := by simp [migrate, hc]
  have cs : Settle.counted genesisName (migrate m g) s = true := by
    refine (Settle.counted_iff genesisName).mpr ?_
    have ms' := ms
    simp only [migrate, hc, List.mem_cons] at ms'
    rcases ms' with e | ms'
    · subst e; exact .inl hg
    · obtain ⟨k, hk, e⟩ := List.mem_iff_getElem.mp ms'
      subst e
      exact .inr ⟨_, mg, hg, migrate_past m g c hc k hk⟩
  simp only [settle, Settle.settleView]
  exact (Settle.view_any genesisName).mpr ⟨s, ms, cs, by simp⟩

/-! ## The rest, checked on every trace -/

/-- The keys signed at the switch in the box: the box's guardian as MaiaCityGuardian's Ed25519 half, and the claimant's
owner and seal keys. -/
def boxSwitchKeys : SwitchKeys :=
  ⟨⟨boxGuardian, "maia-city-guardian-ml-dsa", "maia-city-guardian-x-wing"⟩, ⟨"owner-ed25519", "owner-ml-dsa"⟩,
    "owner-seal"⟩

/-- The keys a store's door is asked about: the traces' keys and every public key the store holds. -/
def askedKeys (m : Members) : List String := doorKeys ++ m.publics.map (·.2)

/-- The vaults a store names. -/
def namedVaults (m : Members) : List String :=
  m.founding.network :: m.founding.coop :: m.tree.vaults.map (·.id) ++ m.joins.map (·.person)

/-- A claimed store and its settled migration agree: the same keys at the door, and the same member vaults (the
claimant's, the coop, the agent and every vault a join founded). -/
def agrees (m : Members) : Bool :=
  match m.founding.claim, m.restore with
  | none, _ => true
  | some c, .ok r =>
    let t := settle genesisName (migrate r boxSwitchKeys)
    (askedKeys r).all (fun k => t.admits k == r.admits k) &&
      (namedVaults r).all fun v =>
        t.member v == (v == c.person || v == r.coop || v == r.network || r.members.contains v)
  | some _, .error _ => false

-- `restore_agrees`: every step of every example trace, and of 40 generated ones
#guard memberExamples.all fun (_, ops, _) => (boxMembers.run ops).all fun (_, m) => agrees m
#guard (List.range 40).all fun n => (boxMembers.run (randomMemberTrace n)).all fun (_, m) => agrees m

end Restore
end Aven.ID
