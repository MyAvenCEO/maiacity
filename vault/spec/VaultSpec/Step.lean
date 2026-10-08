import VaultSpec.State

/-!
# Ops, steps and replay

Every change is a signed op. A peer checks each op against the state just before it (`apply`), rotates and seals
keys (`settle`), and replays all the ops it holds in one fixed order (`order`), so peers holding the same ops end
in the same state.
-/

namespace VaultSpec

inductive Action where
  | genesis      (v : VaultId) (kind : Kind) (owners : List Principal) (threshold : Nat)
  | addOwner     (v : VaultId) (p : Principal)
  | removeOwner  (v : VaultId) (p : Principal) (keep : List OpId)
  | setThreshold (v : VaultId) (n : Nat)
  | addDevice    (v : VaultId) (d : SignerId)
  | removeDevice (v : VaultId) (d : SignerId) (keep : List OpId)
  | foundSpace   (sp : SpaceId) (actor : VaultId)
  | grant        (g : Grant)
  | revoke       (g : GrantId) (actor : VaultId) (keep : List OpId)
  | write        (sp : SpaceId) (e : EntryId) (actor : VaultId) (epoch : Nat)
  deriving DecidableEq, Repr

/-- The writes a removal had seen and keeps; every removal names them. -/
def Action.keep? : Action → Option (List OpId)
  | .removeOwner _ _ k | .removeDevice _ _ k | .revoke _ _ k => some k
  | _ => none

structure Op where
  id        : OpId
  /-- Causal depth: one more than the deepest op it builds on. Only used to order ops. -/
  depth     : Nat
  /-- The signer that made the op; for a write, the device. -/
  author    : SignerId
  /-- Further signatures, for governance. -/
  cosigners : List SignerId
  action    : Action
  deriving DecidableEq, Repr

def Op.sigs (op : Op) : List SignerId := op.author :: op.cosigners

def nodup [BEq α] : List α → Bool
  | [] => true
  | x :: xs => !xs.contains x && nodup xs

def setVault (st : State) (vt : Vault) : State :=
  { st with vaults := st.vaults.map fun x => if x.id == vt.id then vt else x }

/-- Human vaults are owned by signers, coops by existing vaults. -/
def ownerFits (st : State) : Kind → Principal → Bool
  | .human, .signer _ => true
  | .coop,  .vault o  => (st.vault? o).isSome
  | _, _ => false

/-- After a removal from `pre` to `post`: drop every write the removal took the authorization from, unless the
    remover had seen it. Writes that were already unauthorized (kept by an earlier removal) stay. Revocation wins
    over what it had not seen. -/
def dropUnseen (pre post : State) (keep : List OpId) : State :=
  { post with writes := post.writes.filter fun w =>
      keep.contains w.op || !authorized pre w || authorized post w }

/-- Grant `x` rests on grant `g`: it is `g`, or its parent rests on `g`. -/
def restsOnN (st : State) (g : GrantId) : Nat → GrantId → Bool
  | 0, _ => false
  | n + 1, x => x == g ||
    match (st.grant? x).bind (·.parent) with
    | some p => restsOnN st g n p
    | none   => false

def restsOn (st : State) (g x : GrantId) : Bool := restsOnN st g (st.grants.length + 1) x

/-- Vault `a` may revoke grant `g`: it issued it, founded the space, or may revoke the grant `g` rests on. -/
def mayRevokeN (st : State) (a : VaultId) : Nat → Grant → Bool
  | 0, _ => false
  | n + 1, g => g.issuer == a || st.founder? g.scope.spaceOf == some a ||
    match g.parent.bind st.grant? with
    | some p => mayRevokeN st a n p
    | none   => false

def mayRevoke (st : State) (a : VaultId) (g : Grant) : Bool := mayRevokeN st a (st.grants.length + 1) g

/-- The issuer founded the space, or relies on an owner grant to it that covers the new grant's scope. -/
def parentOk (st : State) (g : Grant) : Bool :=
  match g.parent with
  | none   => st.founder? g.scope.spaceOf == some g.issuer
  | some p =>
    match st.grant? p with
    | none    => false
    | some pg => pg.grantee == .principal (.vault g.issuer) && pg.role == Role.owner && pg.scope.covers g.scope

/-- Check one op against the state just before it; `none` when it is refused. -/
def apply (st : State) (op : Op) : Option State :=
  let sigs := op.sigs
  match op.action with
  | .genesis v kind owners threshold =>
    if (st.vault? v).isSome || owners.isEmpty || !nodup owners then none
    else if !owners.all (ownerFits st kind) then none
    else if threshold == 0 || threshold > owners.length then none
    -- every first owner consents
    else if !owners.all (approves st sigs) then none
    else some { st with vaults := st.vaults ++ [⟨v, kind, owners, threshold, []⟩] }
  | .addOwner v p =>
    match st.vault? v with
    | none => none
    | some vt =>
      if vt.owners.contains p || !ownerFits st vt.kind p then none
      -- no cycles: the newcomer must not be the vault itself or something the vault owns
      else if (match p with | .vault x => x == v || owns st v x | .signer _ => false) then none
      -- the vault's threshold, plus the newcomer's consent
      else if !(approves st sigs (.vault v) && approves st sigs p) then none
      else some (setVault st { vt with owners := vt.owners ++ [p] })
  | .removeOwner v p keep =>
    match st.vault? v with
    | none => none
    | some vt =>
      if !vt.owners.contains p || vt.owners.length ≤ 1 then none
      -- the vault's threshold, or the owner leaving on its own
      else if !(approves st sigs (.vault v) || approves st sigs p) then none
      else
        let owners' := vt.owners.erase p
        let post := setVault st { vt with owners := owners', threshold := min vt.threshold owners'.length }
        some (dropUnseen st post keep)
  | .setThreshold v n =>
    match st.vault? v with
    | none => none
    | some vt =>
      if n == 0 || n > vt.owners.length || !approves st sigs (.vault v) then none
      else some (setVault st { vt with threshold := n })
  | .addDevice v d =>
    match st.vault? v with
    | none => none
    | some vt =>
      if vt.kind != Kind.human || vt.devices.contains d then none
      -- the vault's threshold, plus the device's own signature
      else if !(approves st sigs (.vault v) && sigs.contains d) then none
      else some (setVault st { vt with devices := vt.devices ++ [d] })
  | .removeDevice v d keep =>
    match st.vault? v with
    | none => none
    | some vt =>
      if !vt.devices.contains d then none
      else if !(approves st sigs (.vault v) || sigs.contains d) then none
      else some (dropUnseen st (setVault st { vt with devices := vt.devices.erase d }) keep)
  | .foundSpace sp actor =>
    if (st.space? sp).isSome || !actsFor st op.author actor then none
    else some { st with spaces := st.spaces ++ [⟨sp, actor, []⟩] }
  | .grant g =>
    if (st.grant? g.id).isSome || (st.space? g.scope.spaceOf).isNone then none
    -- grants name vaults or Public, never signers; Public only reads
    else if (match g.grantee with
             | .principal (.signer _) => true
             | .principal (.vault x)  => (st.vault? x).isNone
             | .«public»                => g.role != Role.read) then none
    else if !actsFor st op.author g.issuer || !holds st g.issuer g.scope .owner || !parentOk st g then none
    -- making someone owner is governance
    else if g.role == Role.owner && !approves st sigs (.vault g.issuer) then none
    else some { st with grants := st.grants ++ [g] }
  | .revoke gid actor keep =>
    match st.grant? gid with
    | none => none
    | some g =>
      if !actsFor st op.author actor || !mayRevoke st actor g then none
      else if g.role == Role.owner && !approves st sigs (.vault actor) then none
      -- the grant and every grant resting on it end
      else some (dropUnseen st { st with grants := st.grants.filter fun x => !restsOn st gid x.id } keep)
  | .write sp e actor epoch =>
    match st.space? sp with
    | none => none
    | some s =>
      if st.writes.any (·.op == op.id) then none
      else if !actsFor st op.author actor || !holds st actor (.entry sp e) .write then none
      else if epoch > st.epochOf (.entry sp e) then none
      else
        let st' := if s.entries.contains e then st
          else { st with spaces := st.spaces.map fun x => if x.id == sp then { x with entries := x.entries ++ [e] } else x }
        some { st' with writes := st'.writes ++ [⟨op.id, op.author, actor, sp, e, epoch⟩] }

/-- One op: check it, then rotate and seal keys. -/
def step (st : State) (op : Op) : Option State := (apply st op).map (settle st)

/-- Replay ops in the given order; a refused op changes nothing. -/
def replay (st : State) : List Op → State
  | [] => st
  | op :: ops => replay ((step st op).getD st) ops

/-- Every state along the way, the starting one first and the final one last. -/
def trace (st : State) : List Op → List State
  | [] => [st]
  | op :: ops => st :: trace ((step st op).getD st) ops

/-- Removals sort before anything else at the same depth. -/
def Op.rank (op : Op) : Nat :=
  match op.action with
  | .removeOwner .. | .removeDevice .. | .revoke .. => 0
  | _ => 1

/-- The one order every peer replays in: causal depth, then removals first, then id. -/
def Op.before (a b : Op) : Bool :=
  decide (a.depth < b.depth) ||
    (a.depth == b.depth && (decide (a.rank < b.rank) || (a.rank == b.rank && decide (a.id ≤ b.id))))

def order (ops : List Op) : List Op := ops.mergeSort Op.before

/-- What a peer holding `ops` knows. -/
def view (ops : List Op) : State := replay {} (order ops)

end VaultSpec
