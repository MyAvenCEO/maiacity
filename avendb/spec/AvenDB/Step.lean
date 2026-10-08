import AvenDB.State

/-!
# Ops, steps and replay

Every change is a signed op. A peer checks each op against the state just before it (`apply`), rotates and seals
keys (`settle`), and replays all the ops it holds in one fixed order (`order`), so peers holding the same ops end
in the same state. A removal also cuts what it hadn't seen (`view`): an op it hadn't seen stands only if it stands
without what the removal takes away, so neither a removed owner nor a thief holding a stolen passkey can sign ops
that claim to come before the removal.
-/

namespace AvenDB

inductive Action where
  /-- A new vault. A human vault may name a root, its passkey, which signs too. -/
  | genesis      (v : VaultId) (kind : Kind) (owners : List Principal) (threshold : Nat) (root : Option SignerId := none)
  | addOwner     (v : VaultId) (p : Principal)
  | removeOwner  (v : VaultId) (p : Principal) (keep : List OpId)
  | setThreshold (v : VaultId) (n : Nat)
  | addDevice    (v : VaultId) (d : SignerId)
  | removeDevice (v : VaultId) (d : SignerId) (keep : List OpId)
  /-- The root hands itself on to a new passkey, which signs too, or steps down. -/
  | setRoot      (v : VaultId) (r : Option SignerId) (keep : List OpId)
  | foundSpace   (sp : SpaceId) (actor : VaultId)
  | grant        (g : Grant)
  | revoke       (g : GrantId) (actor : VaultId) (keep : List OpId)
  /-- An encrypted edit of one entry, on the line `branch` of its history. `deps` are the entry's writes it builds
      on: a write that starts a branch builds on the version the branch starts from, and a merge also on the heads of
      the line it brings in. -/
  | write        (sp : SpaceId) (e : EntryId) (actor : VaultId) (epoch : Nat) (deps : List OpId := [])
                 (branch : Branch := .main)
  /-- The real boxes of one key: the key of family `k` at `epoch`, sealed to the key pairs `to`, or published (`pub`).
      The schedule already says who may open what, so this op changes nothing here: a peer accepts it only from a
      signer that may open the key, and only if every box is one the schedule seals. -/
  | keys         (k : KeyScope) (epoch : Nat) (to : List KeyName) (pub : Bool := false)
  /-- A schema or a lens, published into the space's schema lane: blobs that hold no data, named by their hash. -/
  | publish      (sp : SpaceId) (actor : VaultId) (blob : BlobId)
  /-- A device vouches for its own accepted writes of one entry, `covers`, with both halves of its signature, where
      the writes carry only the classical half. It changes nothing; a peer that no longer trusts the curves counts
      only the writes a checkpoint covers (`checkpointed`). -/
  | checkpoint   (sp : SpaceId) (e : EntryId) (covers : List OpId)
  deriving DecidableEq, Repr

/-- The ops a removal had seen and keeps; every removal names them. -/
def Action.keep? : Action → Option (List OpId)
  | .removeOwner _ _ k | .removeDevice _ _ k | .setRoot _ _ k | .revoke _ _ k => some k
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

/-- Only a human vault has a root, and the root signs its genesis. -/
def rootFits (kind : Kind) (sigs : List SignerId) : Option SignerId → Bool
  | none   => true
  | some r => kind == .human && sigs.contains r

/-- Write `w` builds only on writes of its own entry among `ws`. -/
def depsIn (ws : List Write) (w : Write) : Bool :=
  w.deps.all fun d => ws.any fun x => x.op == d && x.space == w.space && x.entry == w.entry

/-- Write `w` extends its line: the main line and a new branch need nothing more; a write on branch `b` builds on the
    write of its own entry that started `b`, or on another write on `b`, so whatever cuts the start of a branch cuts
    every write on it. -/
def onBranch (ws : List Write) (w : Write) : Bool :=
  match w.branch with
  | .on b => ws.any (fun x => x.op == b && x.branch == .new && x.space == w.space && x.entry == w.entry) &&
      w.deps.any fun d => d == b || ws.any fun x => x.op == d && x.branch == .on b
  | _ => true

/-- Keep, in order, each write whose dependencies were kept. A write comes after the writes it builds on, so one pass
    leaves the writes causally closed (T14). -/
def closeDeps (ws : List Write) : List Write :=
  ws.foldl (fun kept w => if depsIn kept w then kept ++ [w] else kept) []

/-- After a removal from `pre` to `post`: drop every write the removal took the authorization from, unless the
    remover had seen it, and every write that builds on a dropped one. Writes that were already unauthorized (kept by
    an earlier removal) stay. Revocation wins over what it had not seen. -/
def dropUnseen (pre post : State) (keep : List OpId) : State :=
  { post with writes := closeDeps (post.writes.filter fun w =>
      keep.contains w.op || !authorized pre w || authorized post w) }

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
  | .genesis v kind owners threshold root =>
    if (st.vault? v).isSome || owners.isEmpty || !nodup owners then none
    else if !owners.all (ownerFits st kind) || !rootFits kind sigs root then none
    else if threshold == 0 || threshold > owners.length then none
    -- every first owner consents
    else if !owners.all (approves st sigs) then none
    else some { st with vaults := st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩] }
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
  | .setRoot v r _ =>
    match st.vault? v with
    | none => none
    | some vt =>
      -- only the root hands the root on, and the new root signs
      if !vt.root.any sigs.contains || !r.all sigs.contains then none
      else some (setVault st { vt with root := r })
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
  | .write sp e actor epoch deps branch =>
    match st.space? sp with
    | none => none
    | some s =>
      let w : Write := ⟨op.id, op.author, actor, sp, e, epoch, deps, branch⟩
      if st.writes.any (·.op == op.id) then none
      else if !actsFor st op.author actor || !holds st actor (.entry sp e) .write then none
      else if epoch > st.epochOf (.entry sp e) then none
      -- what it builds on was accepted, so the accepted writes stay causally closed (T14)
      else if !depsIn st.writes w then none
      -- a write on a branch builds on the branch's start
      else if !onBranch st.writes w then none
      else
        let st' := if s.entries.contains e then st
          else { st with spaces := st.spaces.map fun x => if x.id == sp then { x with entries := x.entries ++ [e] } else x }
        some { st' with writes := st'.writes ++ [w] }
  | .keys k epoch to pub =>
    if !(keyScopes st).contains k || !entitled st op.author k || epoch > st.epochOf k then none
    -- a box the schedule doesn't seal would hand the key to someone who may not open it
    else if !to.all (fun t => st.seals.contains ⟨.scoped k epoch, t⟩) then none
    else if pub && !st.published.contains (.scoped k epoch) then none
    else some st
  | .publish sp actor blob =>
    if (st.space? sp).isNone || st.lane.contains (sp, blob) then none
    -- only an owner of the space publishes into its lane
    else if !actsFor st op.author actor || !holds st actor (.space sp) .owner then none
    else some { st with lane := st.lane ++ [(sp, blob)] }
  | .checkpoint sp e covers =>
    -- a device vouches for its own accepted writes of the entry, and changes nothing
    if covers.isEmpty || !covers.all (fun c => st.writes.any fun w =>
        w.op == c && w.author == op.author && w.space == sp && w.entry == e) then none
    else some st

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
  | .removeOwner .. | .removeDevice .. | .setRoot .. | .revoke .. => 0
  | _ => 1

/-- The one order every peer replays in: causal depth, then removals first, then id. -/
def Op.before (a b : Op) : Bool :=
  decide (a.depth < b.depth) ||
    (a.depth == b.depth && (decide (a.rank < b.rank) || (a.rank == b.rank && decide (a.id ≤ b.id))))

def order (ops : List Op) : List Op := ops.mergeSort Op.before

/-! ## Strong removal

A removal names the ops it had seen and keeps (`keep`): removing an owner or a device, revoking a grant, and the root
handing itself on. Every other op that comes before it in the replay order was made concurrently, or claims to be:
it stands only if it also stands with what the removal takes away hidden. When removals clash, the senior one
stands: a vault's root, then its owners in the order they joined, then removals no owner approved (a device
leaving), then revocations. -/

/-- What a removal takes away. -/
inductive Fact where
  | owner  (v : VaultId) (p : Principal)
  | device (v : VaultId) (d : SignerId)
  /-- Whatever root the vault had. -/
  | root   (v : VaultId)
  | grant  (g : GrantId)
  deriving DecidableEq, Repr

/-- The state with the facts `fs` taken away. -/
def hide (st : State) (fs : List Fact) : State :=
  if fs.isEmpty then st else
  { st with
    vaults := st.vaults.map fun vt => { vt with
      owners  := vt.owners.filter fun p => !fs.contains (.owner vt.id p),
      devices := vt.devices.filter fun d => !fs.contains (.device vt.id d),
      root    := if fs.contains (.root vt.id) then none else vt.root },
    grants := st.grants.filter fun g => !fs.contains (.grant g.id) }

def Op.isRemoval (op : Op) : Bool := op.action.keep?.isSome

/-- The grants the ops `ops` make. -/
def grantsIn (ops : List Op) : List Grant :=
  ops.filterMap fun o => match o.action with
    | .grant g => some g
    | _ => none

/-- Among the grants `gs`, grant `x` is `g` or rests on it through its parents. -/
def restsOnIn (gs : List Grant) (g : GrantId) : Nat → GrantId → Bool
  | 0, _ => false
  | n + 1, x => x == g ||
    match (gs.find? (·.id == x)).bind (·.parent) with
    | some p => restsOnIn gs g n p
    | none   => false

/-- What removal `r` takes away: the owner, the device, the root, or, among the grants `ops` make, the grant and every
    grant resting on it. -/
def removes (ops : List Op) (r : Op) : List Fact :=
  match r.action with
  | .removeOwner v p _  => [.owner v p]
  | .removeDevice v d _ => [.device v d]
  | .setRoot v _ _      => [.root v]
  | .revoke g _ _ =>
    let gs := grantsIn ops
    (gs.filter fun x => restsOnIn gs g (gs.length + 1) x.id).map fun x => .grant x.id
  | _ => []

/-- Each removal of `rem`, at its position in `ops`: the ops it keeps, and what it takes away. -/
def cuts (ops rem : List Op) : List (Nat × List OpId × List Fact) :=
  ops.zipIdx.filterMap fun (r, j) =>
    if rem.any (·.id == r.id) then some (j, r.action.keep?.getD [], removes ops r) else none

/-- The facts hidden from `op` at position `i`: what each removal after it takes away, unless that removal had seen
    it. -/
def hiddenAt (cs : List (Nat × List OpId × List Fact)) (i : Nat) (op : Op) : List Fact :=
  (cs.filter fun (j, keep, _) => i < j && !keep.contains op.id).flatMap (·.2.2)

/-- Replay positioned ops from `st` with the removals of `rem` and no others: an op stands if `apply` accepts it on
    the state before it, and again with its hidden facts taken away. The state at the end, and the ops that stood. -/
def runFrom (rem : List Op) (cs : List (Nat × List OpId × List Fact)) : State → List (Op × Nat) → State × List Op
  | st, [] => (st, [])
  | st, (op, i) :: rest =>
    if op.isRemoval && !rem.any (·.id == op.id) then runFrom rem cs st rest
    else match apply (hide st (hiddenAt cs i op)) op, step st op with
      | some _, some st' => let r := runFrom rem cs st' rest; (r.1, op :: r.2)
      | _, _ => runFrom rem cs st rest

/-- Replay `ops`, in this order, with the removals of `rem` and no others. -/
def runWith (ops rem : List Op) : State × List Op := runFrom rem (cuts ops rem) {} ops.zipIdx

/-- Who stands when removals clash, the smallest first: the vault's root; then its owners by seniority, their place
    among the owners where no removal has happened yet; then removals no owner approved; then revocations. -/
def priority (base : State) (op : Op) : Nat × Nat :=
  match op.action with
  | .removeOwner v _ _ | .removeDevice v _ _ | .setRoot v _ _ =>
    match base.vault? v with
    | none => (2, 0)
    | some vt =>
      if vt.root.any op.sigs.contains then (0, 0)
      else match vt.owners.zipIdx.find? fun (p, _) => approves base op.sigs p with
        | some (_, i) => (1, i)
        | none => (2, 0)
  | _ => (3, 0)

def prioLe (a b : Nat × Nat) : Bool := a.1 < b.1 || (a.1 == b.1 && a.2 ≤ b.2)

/-- The removals that stand, chosen one by one by priority: each stands if the ops replayed with it and the ones
    chosen before it accept it and keep accepting those. -/
def resolve (ops : List Op) : List Op :=
  let base := (runWith ops []).1
  let cands := (ops.filter Op.isRemoval).mergeSort fun a b => prioLe (priority base a) (priority base b)
  cands.foldl (fun rem r =>
    let stood := (runWith ops (rem ++ [r])).2
    if (r :: rem).all fun x => stood.any (·.id == x.id) then rem ++ [r] else rem) []

/-- What a peer holding `ops` knows. -/
def view (ops : List Op) : State := let o := order ops; (runWith o (resolve o)).1

/-- The ops that stand in what a peer holding `ops` knows, in replay order. -/
def standing (ops : List Op) : List Op := let o := order ops; (runWith o (resolve o)).2

/-! ## Once the curves fall

A write carries only the classical half of its author's signatures, so that writes stay fast and small; every other
op carries the hash-based half too. A device vouches for its own writes with a checkpoint, which carries both. A
peer that no longer trusts the curves replays only what a forger who broke them can't have made: every op but a
write, and each write that a checkpoint by its own author covers (T18). -/

/-- Checkpoint `c` vouches for op `o`: it is a checkpoint by `o`'s author that covers `o`. -/
def vouches (c o : Op) : Bool :=
  c.author == o.author && match c.action with
    | .checkpoint _ _ covers => covers.contains o.id
    | _ => false

/-- The ops a peer counts once it no longer trusts the curves: every op but a write, and each write a checkpoint by
    its own author covers. -/
def checkpointed (ops : List Op) : List Op :=
  ops.filter fun o => match o.action with
    | .write .. => ops.any (vouches · o)
    | _ => true

end AvenDB
