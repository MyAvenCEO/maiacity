import AvenDB.State

/-!
# Edits, steps and replay

Every change is a signed edit. A peer checks each edit against the state just before it (`apply`), rotates and seals
keys (`settle`), and replays all the edits it holds in one fixed order (`order`), so peers holding the same edits end
in the same state. A removal also cuts what it hadn't seen (`view`): an edit it hadn't seen stands only if it stands
without what the removal takes away, so neither a removed owner nor a thief holding a stolen passkey can sign edits
that claim to come before the removal.
-/

namespace AvenDB

/-- Every change. An edit that acts for a vault (founds a space, grants, revokes, writes, publishes) names the owners
    `via` its author acts through (`actsVia`): none when its author is a member of the vault, else from an owner of the
    vault down to the vault its author is a member of, as a device of Bob's human vault writes for Bob's coop through
    `[bob]`. -/
inductive Action where
  /-- A new vault. A human vault may name a root, its passkey, which signs too. -/
  | genesis      (v : VaultId) (kind : Kind) (owners : List Principal) (threshold : Nat) (root : Option SignerId := none)
  | addOwner     (v : VaultId) (p : Principal)
  | removeOwner  (v : VaultId) (p : Principal) (keep : List EditId)
  | setThreshold (v : VaultId) (n : Nat)
  /-- A device of a human vault (a phone, a browser) or of an aven vault (a server). -/
  | addDevice    (v : VaultId) (d : SignerId)
  | removeDevice (v : VaultId) (d : SignerId) (keep : List EditId)
  /-- The root hands itself on to a new passkey, which signs too, or steps down. -/
  | setRoot      (v : VaultId) (r : Option SignerId) (keep : List EditId)
  | foundSpace   (sp : SpaceId) (actor : VaultId) (via : List VaultId := [])
  | grant        (g : Grant) (via : List VaultId := [])
  | revoke       (g : GrantId) (actor : VaultId) (keep : List EditId) (via : List VaultId := [])
  /-- An encrypted edit of one entry, on the line `history` of its history. `deps` are the entry's writes it builds
      on: a write that starts a proposal builds on the version the proposal starts from, and a merge also on the heads
      of the line it brings in. -/
  | write        (sp : SpaceId) (e : EntryId) (actor : VaultId) (epoch : Nat) (deps : List EditId := [])
                 (proposal : Proposal := .main) (via : List VaultId := [])
  /-- The real boxes of one key: the key of family `k` at `epoch`, sealed to the key pairs `to`, or published (`pub`).
      The schedule already says who may open what, so this edit changes nothing here: a peer accepts it only from a
      signer that may open the key, and only if every box is one the schedule seals. -/
  | keys         (k : KeyScope) (epoch : Nat) (to : List KeyName) (pub : Bool := false)
  /-- A schema or a lens, published into the space's schema lane: blobs that hold no data, named by their hash. -/
  | publish      (sp : SpaceId) (actor : VaultId) (blob : BlobId) (via : List VaultId := [])
  /-- A device vouches for its own accepted writes of one entry, `covers`, with both halves of its signature, where
      the writes carry only the classical half. It changes nothing; a peer that no longer trusts the curves counts
      only the writes a checkpoint covers (`checkpointed`). -/
  | checkpoint   (sp : SpaceId) (e : EntryId) (covers : List EditId)
  deriving DecidableEq, Repr

/-- The edits a removal had seen and keeps; every removal names them. -/
def Action.keep? : Action → Option (List EditId)
  | .removeOwner _ _ k | .removeDevice _ _ k | .setRoot _ _ k | .revoke _ _ k _ => some k
  | _ => none

structure Edit where
  id        : EditId
  /-- Causal depth: one more than the deepest edit its device held when it made it, in any log. Only used to order
      edits: whatever a device had seen sorts before what it makes next. -/
  depth     : Nat
  /-- The signer that made the edit; for a write, the device. -/
  author    : SignerId
  /-- Further signatures, for governance. -/
  cosigners : List SignerId
  action    : Action
  /-- The edits of its own log it builds on: that log's frontier as its device held it (`Logs.lean`). -/
  parents   : List EditId := []
  deriving DecidableEq, Repr

def Edit.sigs (edit : Edit) : List SignerId := edit.author :: edit.cosigners

def nodup [BEq α] : List α → Bool
  | [] => true
  | x :: xs => !xs.contains x && nodup xs

def setVault (st : State) (vt : Vault) : State :=
  { st with vaults := st.vaults.map fun x => if x.id == vt.id then vt else x }

/-- A vault that may own coop and aven vaults: a human or a coop vault, never an aven vault (yet). -/
def ownsVaults (st : State) (o : VaultId) : Bool :=
  match st.vault? o with
  | some vt => vt.kind != .aven
  | none    => false

/-- Human vaults are owned by signers, their person's passkeys; coop and aven vaults by existing human and coop vaults,
    never by a signer directly. -/
def ownerFits (st : State) : Kind → Principal → Bool
  | .human, .signer _ => true
  | .coop,  .vault o  => ownsVaults st o
  | .aven,  .vault o  => ownsVaults st o
  | _, _ => false

/-- Only a human vault has a root, and the root signs its genesis. -/
def rootFits (kind : Kind) (sigs : List SignerId) : Option SignerId → Bool
  | none   => true
  | some r => kind == .human && sigs.contains r

/-- Human and aven vaults have devices, coops don't: a coop acts only through its owners. -/
def Kind.hasDevices : Kind → Bool
  | .coop => false
  | _     => true

/-- Write `w` builds only on writes of its own entry among `ws`. -/
def depsIn (ws : List Write) (w : Write) : Bool :=
  w.deps.all fun d => ws.any fun x => x.edit == d && x.space == w.space && x.entry == w.entry

/-- Write `w` extends its line: the main line and a new proposal need nothing more; a write on proposal `b` builds on
    the write of its own entry that started `b`, or on another write on `b`, so whatever cuts the start of a proposal
    cuts every write on it. -/
def onProposal (ws : List Write) (w : Write) : Bool :=
  match w.proposal with
  | .on b => ws.any (fun x => x.edit == b && x.proposal == .new && x.space == w.space && x.entry == w.entry) &&
      w.deps.any fun d => d == b || ws.any fun x => x.edit == d && x.proposal == .on b
  | _ => true

/-- Keep, in order, each write whose dependencies were kept. A write comes after the writes it builds on, so one pass
    leaves the writes causally closed (T14). -/
def closeDeps (ws : List Write) : List Write :=
  ws.foldl (fun kept w => if depsIn kept w then kept ++ [w] else kept) []

/-- After a removal from `pre` to `post`: drop every write the removal took the authorization from, unless the
    remover had seen it, and every write that builds on a dropped one. Writes that were already unauthorized (kept by
    an earlier removal) stay. Revocation wins over what it had not seen. -/
def dropUnseen (pre post : State) (keep : List EditId) : State :=
  { post with writes := closeDeps (post.writes.filter fun w =>
      keep.contains w.edit || !authorized pre w || authorized post w) }

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

/-- Check one edit against the state just before it; `none` when it is refused. -/
def apply (st : State) (edit : Edit) : Option State :=
  let sigs := edit.sigs
  match edit.action with
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
      if !vt.kind.hasDevices || vt.devices.contains d then none
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
  | .foundSpace sp actor via =>
    if (st.space? sp).isSome || !actsVia st edit.author via actor then none
    else some { st with spaces := st.spaces ++ [⟨sp, actor, []⟩] }
  | .grant g via =>
    if (st.grant? g.id).isSome || (st.space? g.scope.spaceOf).isNone then none
    -- grants name vaults or Public, never signers; Public only reads
    else if (match g.grantee with
             | .principal (.signer _) => true
             | .principal (.vault x)  => (st.vault? x).isNone
             | .«public»                => g.role != Role.read) then none
    else if !actsVia st edit.author via g.issuer || !holds st g.issuer g.scope .owner || !parentOk st g then none
    -- making someone owner is governance
    else if g.role == Role.owner && !approves st sigs (.vault g.issuer) then none
    else some { st with grants := st.grants ++ [g] }
  | .revoke gid actor keep via =>
    match st.grant? gid with
    | none => none
    | some g =>
      if !actsVia st edit.author via actor || !mayRevoke st actor g then none
      else if g.role == Role.owner && !approves st sigs (.vault actor) then none
      -- the grant and every grant resting on it end
      else some (dropUnseen st { st with grants := st.grants.filter fun x => !restsOn st gid x.id } keep)
  | .write sp e actor epoch deps proposal via =>
    match st.space? sp with
    | none => none
    | some s =>
      let w : Write := ⟨edit.id, edit.author, actor, sp, e, epoch, deps, proposal, via⟩
      if st.writes.any (·.edit == edit.id) then none
      else if !actsVia st edit.author via actor || !holds st actor (.entry sp e) .write then none
      else if epoch > st.epochOf (.entry sp e) then none
      -- what it builds on was accepted, so the accepted writes stay causally closed (T14)
      else if !depsIn st.writes w then none
      -- a write on a proposal builds on the proposal's start
      else if !onProposal st.writes w then none
      else
        let st' := if s.entries.contains e then st
          else { st with spaces := st.spaces.map fun x => if x.id == sp then { x with entries := x.entries ++ [e] } else x }
        some { st' with writes := st'.writes ++ [w] }
  | .keys k epoch to pub =>
    if !(keyScopes st).contains k || !entitled st edit.author k || epoch > st.epochOf k then none
    -- a box the schedule doesn't seal would hand the key to someone who may not open it
    else if !to.all (fun t => st.seals.contains ⟨.scoped k epoch, t⟩) then none
    else if pub && !st.published.contains (.scoped k epoch) then none
    else some st
  | .publish sp actor blob via =>
    if (st.space? sp).isNone || st.lane.contains (sp, blob) then none
    -- only an owner of the space publishes into its lane
    else if !actsVia st edit.author via actor || !holds st actor (.space sp) .owner then none
    else some { st with lane := st.lane ++ [(sp, blob)] }
  | .checkpoint sp e covers =>
    -- a device vouches for its own accepted writes of the entry, and changes nothing
    if covers.isEmpty || !covers.all (fun c => st.writes.any fun w =>
        w.edit == c && w.author == edit.author && w.space == sp && w.entry == e) then none
    else some st

/-- One edit: check it, then rotate and seal keys. -/
def step (st : State) (edit : Edit) : Option State := (apply st edit).map (settle st)

/-- Replay edits in the given order; a refused edit changes nothing. -/
def replay (st : State) : List Edit → State
  | [] => st
  | edit :: edits => replay ((step st edit).getD st) edits

/-- Every state along the way, the starting one first and the final one last. -/
def trace (st : State) : List Edit → List State
  | [] => [st]
  | edit :: edits => st :: trace ((step st edit).getD st) edits

/-- Removals sort before anything else at the same depth. -/
def Edit.rank (edit : Edit) : Nat :=
  match edit.action with
  | .removeOwner .. | .removeDevice .. | .setRoot .. | .revoke .. => 0
  | _ => 1

/-- The one order every peer replays in: causal depth, then removals first, then id. -/
def Edit.before (a b : Edit) : Bool :=
  decide (a.depth < b.depth) ||
    (a.depth == b.depth && (decide (a.rank < b.rank) || (a.rank == b.rank && decide (a.id ≤ b.id))))

/-- No edit among `edits` that `edit` builds on is as deep as it: else `edit` claims to come no later than its own past,
    and is malformed. -/
def wellFormed (edits : List Edit) (edit : Edit) : Bool :=
  edit.parents.all fun p => edits.all fun q => q.id != p || decide (q.depth < edit.depth)

/-- The edits in the one order every peer replays them in, the malformed ones left out, so that no edit sorts ahead of
    an edit it builds on. -/
def order (edits : List Edit) : List Edit := (edits.filter (wellFormed edits)).mergeSort Edit.before

/-! ## Strong removal

A removal names the edits it had seen and keeps (`keep`): removing an owner or a device, revoking a grant, and the root
handing itself on. Every other edit that comes before it in the replay order was made concurrently, or claims to be:
it stands only if it also stands with what the removal takes away hidden. When removals clash, the senior one
stands: removals settle from the top down, a vault's before those of the coops it owns, and within a vault its root,
then its owners in the order they joined, then removals no owner approved (a device leaving); revocations follow,
the most senior revoker first (`priority`). -/

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

def Edit.isRemoval (edit : Edit) : Bool := edit.action.keep?.isSome

/-- The grants the edits `edits` make. -/
def grantsIn (edits : List Edit) : List Grant :=
  edits.filterMap fun o => match o.action with
    | .grant g _ => some g
    | _ => none

/-- Among the grants `gs`, grant `x` is `g` or rests on it through its parents. -/
def restsOnIn (gs : List Grant) (g : GrantId) : Nat → GrantId → Bool
  | 0, _ => false
  | n + 1, x => x == g ||
    match (gs.find? (·.id == x)).bind (·.parent) with
    | some p => restsOnIn gs g n p
    | none   => false

/-- What removal `r` takes away: the owner, the device, the root, or, among the grants `edits` make, the grant and every
    grant resting on it. -/
def removes (edits : List Edit) (r : Edit) : List Fact :=
  match r.action with
  | .removeOwner v p _  => [.owner v p]
  | .removeDevice v d _ => [.device v d]
  | .setRoot v _ _      => [.root v]
  | .revoke g _ _ _ =>
    let gs := grantsIn edits
    (gs.filter fun x => restsOnIn gs g (gs.length + 1) x.id).map fun x => .grant x.id
  | _ => []

/-- Each removal of `rem`, at its position in `edits`: the edits it keeps, and what it takes away. -/
def cuts (edits rem : List Edit) : List (Nat × List EditId × List Fact) :=
  edits.zipIdx.filterMap fun (r, j) =>
    if rem.any (·.id == r.id) then some (j, r.action.keep?.getD [], removes edits r) else none

/-- The facts hidden from `edit` at position `i`: what each removal after it takes away, unless that removal had seen
    it. -/
def hiddenAt (cs : List (Nat × List EditId × List Fact)) (i : Nat) (edit : Edit) : List Fact :=
  (cs.filter fun (j, keep, _) => i < j && !keep.contains edit.id).flatMap (·.2.2)

/-- Replay positioned edits from `st` with the removals of `rem` and no others: an edit stands if `apply` accepts it on
    the state before it, and again with its hidden facts taken away. The state at the end, and the edits that stood. -/
def runFrom (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    State → List (Edit × Nat) → State × List Edit
  | st, [] => (st, [])
  | st, (edit, i) :: rest =>
    if edit.isRemoval && !rem.any (·.id == edit.id) then runFrom rem cs st rest
    else match apply (hide st (hiddenAt cs i edit)) edit, step st edit with
      | some _, some st' => let r := runFrom rem cs st' rest; (r.1, edit :: r.2)
      | _, _ => runFrom rem cs st rest

/-- Replay `edits`, in this order, with the removals of `rem` and no others. -/
def runWith (edits rem : List Edit) : State × List Edit := runFrom rem (cuts edits rem) {} edits.zipIdx

/-- How far below the human vaults vault `v` sits: a human vault at 0, a coop or an aven vault one below its lowest
    owner. -/
def tierN (st : State) : Nat → VaultId → Nat
  | 0, _ => 0
  | n + 1, v =>
    match st.vault? v with
    | none => 0
    | some vt => vt.owners.foldl (fun t p => match p with
        | .vault o  => max t (tierN st n o + 1)
        | .signer _ => t) 0

def tier (st : State) (v : VaultId) : Nat := tierN st st.depth v

/-- Grant `g` and the grants it rests on, from the one its space's founder issued down to `g`. -/
def chainN (st : State) : Nat → Grant → List Grant
  | 0, g => [g]
  | n + 1, g => (match g.parent.bind st.grant? with
    | some p => chainN st n p
    | none   => []) ++ [g]

def chain (st : State) (g : Grant) : List Grant := chainN st (st.grants.length + 1) g

/-- How senior vault `a` is in revoking grant `g`: 0 for the space's founder, else the place in `g`'s chain of the
    highest grant `a` issued, the founder's grant at 0. -/
def seniority (st : State) (a : VaultId) (g : Grant) : Nat :=
  if st.founder? g.scope.spaceOf == some a then 0
  else let c := chain st g; (c.findIdx? (·.issuer == a)).getD c.length

/-- Who stands when removals clash, the smallest first. Vault removals come before revocations, and a vault's
    removals before those of the coops it owns (`tier`), since a coop's removals rest on its owners' approval and
    never the other way round. Within a vault: its root, then its owners by seniority, their place among the owners
    where no removal has happened yet, then removals no owner approved. Revocations follow, the most senior revoker
    first: the space's founder, then whoever issued a grant higher up the chain of the grant revoked, since a grant
    falls with the grant it rests on. So a removal is only ever kept out by one that ranks above it, and what ranks
    above it never rests on what it takes away. -/
def priority (base : State) (edit : Edit) : List Nat :=
  match edit.action with
  | .removeOwner v _ _ | .removeDevice v _ _ | .setRoot v _ _ =>
    let t := tier base v
    match base.vault? v with
    | none => [0, t, 2, 0]
    | some vt =>
      if vt.root.any edit.sigs.contains then [0, t, 0, 0]
      else match vt.owners.zipIdx.find? fun (p, _) => approves base edit.sigs p with
        | some (_, i) => [0, t, 1, i]
        | none => [0, t, 2, 0]
  | .revoke g a _ _ => [1, (base.grant? g).elim 0 (seniority base a), 0, 0]
  | _ => [2, 0, 0, 0]

/-- Priorities compare place by place. -/
def prioLe : List Nat → List Nat → Bool
  | [], _ => true
  | _ :: _, [] => false
  | a :: as, b :: bs => a < b || (a == b && prioLe as bs)

/-- The removals that stand, chosen one by one by priority: each stands if the edits replayed with it and the ones
    chosen before it accept it and keep accepting those. -/
def resolve (edits : List Edit) : List Edit :=
  let base := (runWith edits []).1
  let cands := (edits.filter Edit.isRemoval).mergeSort fun a b => prioLe (priority base a) (priority base b)
  cands.foldl (fun rem r =>
    let stood := (runWith edits (rem ++ [r])).2
    if (r :: rem).all fun x => stood.any (·.id == x.id) then rem ++ [r] else rem) []

/-- What a peer holding `edits` knows. -/
def view (edits : List Edit) : State := let o := order edits; (runWith o (resolve o)).1

/-- The edits that stand in what a peer holding `edits` knows, in replay order. -/
def standing (edits : List Edit) : List Edit := let o := order edits; (runWith o (resolve o)).2

/-! ## Once the curves fall

A write carries only the classical half of its author's signatures, so that writes stay fast and small; every other
edit carries the hash-based half too. A device vouches for its own writes with a checkpoint, which carries both. A
peer that no longer trusts the curves replays only what a forger who broke them can't have made: every edit but a
write, and each write that a checkpoint by its own author covers (T18). -/

/-- Checkpoint `c` vouches for edit `o`: it is a checkpoint by `o`'s author that covers `o`. -/
def vouches (c o : Edit) : Bool :=
  c.author == o.author && match c.action with
    | .checkpoint _ _ covers => covers.contains o.id
    | _ => false

/-- The edits a peer counts once it no longer trusts the curves: every edit but a write, and each write a checkpoint by
    its own author covers. -/
def checkpointed (edits : List Edit) : List Edit :=
  edits.filter fun o => match o.action with
    | .write .. => edits.any (vouches · o)
    | _ => true

end AvenDB
