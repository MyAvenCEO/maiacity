import Aven.ID.Network
import Aven.ID.InviteTrace

/-! # Production's tree, settled (PEERS.md §5, "Production's tree")

Production is never wiped. Its Aven Peer holds the claim, the claimant's sign-ins, the invites, withdrawals and joins
and the members' sign-ins, under their ref names (`claim`, `signin-NNNNNN`, `invite-<id>`, `withdrawn-<id>`,
`joined-<id>`), and `Members.restore` reads them back in that order. Under A11 and A12 the claimant signs a genesis
once, with their passkey and MaiaCityGuardian, and the old statements become tree statements after it, each naming the
one before it as its tip: the ref order becomes their past (`migrate`). Nothing is acked, since no admin device acked
anything before.

`settle_restore`: every statement `migrate` makes counts and descends from the genesis, so nothing production holds is
lost by the change of rule. `restore_agrees` checks the rest on every invite trace, the examples and the generated
ones, at every step: the settled door admits exactly the keys `Members.admits` admits, and the settled member vaults
are the claimant's, the admin coop, the agent and every vault a join founded. That part is checked, not yet proved for
every store: proving it in general means relating `settle` to `Members.tree`'s owners and `Tree.actsFor`, which is
left for later (PEERS.md, "Open"). -/

namespace Aven.ID
namespace Restore

/-- An old statement, as production's store holds it. -/
inductive Old where
  | signIn (i : SignIn)
  | invite (i : Invite)
  | withdrawal (w : Withdrawal)
  | join (j : Join)
  | memberSignIn (s : MemberSignIn)
  deriving DecidableEq, Repr

/-- The old statements after the claim, in the order `Members.restore` reads them: the claimant's sign-ins, then the
invites, withdrawals and joins by their invite's id, then the members' sign-ins. -/
def refOrder (m : Members) : List Old :=
  m.founding.signIns.map .signIn ++
    (m.invites.mergeSort fun a b => Members.byId a.key b.key).map .invite ++
    (m.withdrawn.mergeSort fun a b => Members.byId a.key b.key).map .withdrawal ++
    (m.joins.mergeSort fun a b => Members.byId a.invite b.invite).map .join ++
    m.signIns.map .memberSignIn

/-- The first index in `l` where `p` holds. -/
def indexWhere {α : Type} (p : α → Bool) : List α → Option Nat
  | [] => none
  | a :: l => if p a then some 0 else (indexWhere p l).map (· + 1)

/-- The name `migrate` gives the `k`-th old statement: the genesis is 1. -/
def nameAt (k : Nat) : Nat := k + 2

/-- The name of the ticket statement for an invite's one-time key; 0, which names nothing, if there is none. -/
def ticketName (olds : List Old) (key : String) : Nat :=
  match indexWhere (fun o => match o with | .invite i => i.key == key | _ => false) olds with
  | some k => nameAt k
  | none => 0

/-- The genesis the claimant signs for production's claim: its relying party, the claimant's vault, passkey and
claiming browser, the admin coop, the agent and the Aven Peer's key, and the guardian's hybrid keys (A13). -/
def genesisOf (s : Founding) (c : Claim) (g : GuardianKeys) : Genesis :=
  { rpId := s.rp.rpId, origins := s.rp.origins, claimant := c.person, passkey := c.passkey, devices := [c.deviceKey],
    coop := s.coop, agent := s.network, avenPeer := s.peerKey, guardian := g,
    signedBy := [c.passkey, g.ed25519, g.mlDsa] }

/-- An old statement's signer and what it says as a tree statement. Devices go by their keys, as the door does. -/
def Old.says (olds : List Old) (c : Claim) (g : GuardianKeys) : Old → String × TreeSays
  | .signIn i => (c.passkey, .signIn c.person i.deviceKey)
  | .invite i => (i.passkey, .ticket i.key)
  | .withdrawal w => (w.passkey, .withdrawal (ticketName olds w.key))
  | .join j => (j.invite, .claim (ticketName olds j.invite) j.person j.passkey j.deviceKey g)
  | .memberSignIn s => (s.member.passkey, .signIn s.member.person s.signIn.deviceKey)

/-- The genesis statement production's claim becomes, named 1. -/
def genesisStatement (m : Members) (c : Claim) (g : GuardianKeys) : TreeStatement :=
  ⟨1, c.passkey, [], .genesis (genesisOf m.founding c g)⟩

/-- The `k`-th old statement as a tree statement: named `nameAt k`, naming the one before it. -/
def step (m : Members) (c : Claim) (g : GuardianKeys) (k : Nat) (o : Old) : TreeStatement :=
  let (signer, says) := o.says (refOrder m) c g
  ⟨nameAt k, signer, [k + 1], says⟩

/-- Production's store as tree statements: the genesis, then every old statement in ref order, each naming the one
before it. An unclaimed store has none. -/
def migrate (m : Members) (g : GuardianKeys) : List TreeStatement :=
  match m.founding.claim with
  | none => []
  | some c => genesisStatement m c g :: (refOrder m).mapIdx (step m c g)

/-- The old statements' own checks were made when `Members.restore` read them back: every migrated statement passes. -/
def restored (_ : TreeStatement) : Bool := true

/-! ## Every migrated statement counts -/

theorem step_name (m : Members) (c : Claim) (g : GuardianKeys) (k : Nat) (o : Old) :
    (step m c g k o).name = nameAt k ∧ (step m c g k o).tips = [k + 1] := by
  simp [step]

/-- Each migrated old statement has the genesis in its past: its tip is the one before it, down to the genesis. -/
theorem migrate_past (m : Members) (g : GuardianKeys) (c : Claim) (hc : m.founding.claim = some c) :
    ∀ k (hk : k < ((refOrder m).mapIdx (step m c g)).length),
      Settle.InPast (migrate m g) (((refOrder m).mapIdx (step m c g))[k]) (genesisStatement m c g) := by
  have mem : ∀ k (hk : k < ((refOrder m).mapIdx (step m c g)).length),
      ((refOrder m).mapIdx (step m c g))[k] ∈ migrate m g := fun k hk => by
    simp only [migrate, hc]
    exact List.mem_cons_of_mem _ (List.getElem_mem hk)
  intro k
  induction k with
  | zero =>
    intro hk
    refine .tip (by simp [migrate, hc]) ?_
    simp [List.getElem_mapIdx, step_name, genesisStatement]
  | succ k ih =>
    intro hk
    have hk' : k < ((refOrder m).mapIdx (step m c g)).length := by omega
    refine Settle.InPast.trans (.tip (mem k hk') ?_) (ih hk')
    simp [List.getElem_mapIdx, step_name, nameAt]

/-- **`settle_restore`**, its general half: given a genesis both its signers signed, every statement production holds
counts in the settled tree. The change of rule loses nothing. -/
theorem settle_restore (m : Members) (g : GuardianKeys) (c : Claim) (hc : m.founding.claim = some c)
    (signed : (genesisOf m.founding c g).consented = true) :
    ∀ s ∈ migrate m g, (settle restored 1 (migrate m g)).counted s.name = true := by
  intro s ms
  have hg : Settle.pinnedGenesis restored 1 (genesisStatement m c g) = true := by
    simp [Settle.pinnedGenesis, restored, genesisStatement, signed]
  have mg : genesisStatement m c g ∈ migrate m g := by simp [migrate, hc]
  have cs : Settle.counted restored 1 (migrate m g) s = true := by
    refine (Settle.counted_iff restored 1).mpr ⟨rfl, ?_⟩
    have ms' := ms
    simp only [migrate, hc, List.mem_cons] at ms'
    rcases ms' with e | ms'
    · subst e; exact .inl hg
    · obtain ⟨k, hk, e⟩ := List.mem_iff_getElem.mp ms'
      subst e
      exact .inr ⟨_, mg, hg, migrate_past m g c hc k hk⟩
  simp only [settle, Settle.settleView]
  exact (Settle.view_any restored 1).mpr ⟨s, ms, cs, by simp⟩

/-! ## The rest, checked on every trace -/

/-- The guardian's hybrid keys the migration names: the box's guardian as its Ed25519 half. -/
def boxGuardianKeys : GuardianKeys := ⟨boxGuardian, "maia-city-guardian-ml-dsa", "maia-city-guardian-x-wing"⟩

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
    let t := settle restored 1 (migrate r boxGuardianKeys)
    (askedKeys r).all (fun k => t.admits k == r.admits k) &&
      (namedVaults r).all fun v =>
        t.member v == (v == c.person || v == r.coop || v == r.network || r.members.contains v)
  | some _, .error _ => false

-- `restore_agrees`: every step of every example trace, and of 40 generated ones
#guard memberExamples.all fun (_, ops, _) => (boxMembers.run ops).all fun (_, m) => agrees m
#guard (List.range 40).all fun n => (boxMembers.run (randomMemberTrace n)).all fun (_, m) => agrees m

end Restore
end Aven.ID
