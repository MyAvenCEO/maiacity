import AvenDB.State

/-!
# Edits, steps and replay

Every change is a signed edit. A peer checks each edit against the state just before it (`apply`), rotates, seals and
links keys (`settle`), and replays all the edits it holds in one fixed order (`order`), so peers holding the same edits
end in the same state. A removal also cuts what it hadn't seen (`view`): an edit it hadn't seen stands only if it stands
without what the removal takes away, so neither a removed owner nor a thief holding a stolen passkey can sign edits that
claim to come before the removal, and nobody writes into an entry after a move took it out of their slice.
-/

namespace AvenDB

/-- Every change. An edit that acts for a vault (issues or revokes a cap, writes, moves, publishes) names the owners
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
  /-- A cap, issued by `c.issuer`. -/
  | cap          (c : Cap) (via : List VaultId := [])
  /-- Cap `c` ends, with every cap resting on it. -/
  | revoke       (c : CapId) (actor : VaultId) (keep : List EditId) (via : List VaultId := [])
  /-- An encrypted edit of entry `e` of vault `v`, on the line `proposal` of its history, under the key of its stay
      `stay` at generation `gen` of that stay's cell. `deps` are the entry's writes it builds on: a write that starts a
      proposal builds on the version the proposal starts from, and a merge also on the heads of the line it brings in.
      A write that creates its entry (`create`) names the cell it goes in and carries its header, and its stay is the
      one its creation begins (`none`). Its tags (`tags`, encrypted with the rest of the body) count only when it acts
      for the vault, except that a new entry's added tags are its first tags. Its body may carry a proof (`proof`): the
      ruled cap it relies on, whose chain's rules its readers then read; and its readers read off its Loro update
      what it touches (`touches`, `Rules.lean`) and whether what it makes of the record fits the schemas the entry
      was written under up to it (`fits`, `Schemas.lean`). -/
  | write        (v : VaultId) (e : EntryId) (actor : VaultId) (stay : Option EditId) (gen : Nat)
                 (deps : List EditId := []) (proposal : Proposal := .main) (via : List VaultId := [])
                 (create : Option (Cell × Header) := none) (tags : TagDelta := {}) (proof : Option CapId := none)
                 (touches : List Touch := []) (fits : Bool := true)
  /-- A steward, acting for vault `v`, moves its entry `e` to cell `to`, keeping the writes it had seen. -/
  | move         (v : VaultId) (e : EntryId) (to : Cell) (keep : List EditId) (via : List VaultId := [])
  /-- The real boxes of one key: `secret` sealed or wrapped to the keys `to`, or published (`pub`). The schedule already
      says who may open what, so this edit changes nothing here: a peer accepts it only from a signer that may open the
      key, and only if every box is one the schedule seals. -/
  | keys         (secret : KeyName) (to : List KeyName) (pub : Bool := false)
  /-- A schema or a lens, published into vault `v`'s schema lane: blobs that hold no data, named by their hash. -/
  | publish      (v : VaultId) (actor : VaultId) (blob : BlobId) (via : List VaultId := [])
  /-- A device vouches for its own accepted writes of one entry, `covers`, with both halves of its signature, where
      the writes carry only the classical half. It changes nothing; a peer that no longer trusts the curves counts
      only the writes a checkpoint covers (`checkpointed`). -/
  | checkpoint   (e : EntryId) (covers : List EditId)
  deriving DecidableEq, Repr

/-- The edits a removal had seen and keeps; every removal names them. -/
def Action.keep? : Action → Option (List EditId)
  | .removeOwner _ _ k | .removeDevice _ _ k | .setRoot _ _ k | .revoke _ _ k _ | .move _ _ _ k _ => some k
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

/-- The writes readers don't count, and write `w` among them unless they count it (`ok`). -/
def State.counting (st : State) (ok : Bool) (w : EditId) : List EditId :=
  if ok then st.uncounted else st.uncounted ++ [w]

def setEntry (st : State) (en : Entry) : State :=
  { st with entries := st.entries.map fun x => if x.id == en.id then en else x }

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
  w.deps.all fun d => ws.any fun x => x.edit == d && x.entry == w.entry

/-- Write `w` extends its line: the main line and a new proposal need nothing more; a write on proposal `b` builds on
    the write of its own entry that started `b`, or on another write on `b`, so whatever cuts the start of a proposal
    cuts every write on it. -/
def onProposal (ws : List Write) (w : Write) : Bool :=
  match w.proposal with
  | .on b => ws.any (fun x => x.edit == b && x.proposal == .new && x.entry == w.entry) &&
      w.deps.any fun d => d == b || ws.any fun x => x.edit == d && x.proposal == .on b
  | _ => true

/-- Keep, in order, each write whose dependencies were kept. A write comes after the writes it builds on, so one pass
    leaves the writes causally closed (T14). -/
def closeDeps (ws : List Write) : List Write :=
  ws.foldl (fun kept w => if depsIn kept w then kept ++ [w] else kept) []

/-- After a removal from `pre` to `post`: drop every write the removal took the authorization from, unless the
    remover had seen it, and every write that builds on a dropped one; an entry whose creation is dropped goes with all
    its writes. Writes that were already unauthorized (kept by an earlier removal) stay. Revocation wins over what it
    had not seen. Each write is judged in the cell it was written in (`authorized`), so a move drops nothing here: a
    write a move hadn't seen falls by strong removal, checked against the cell the move took its entry to (`hide`). -/
def dropUnseen (pre post : State) (keep : List EditId) : State :=
  let ws := closeDeps (post.writes.filter fun w => keep.contains w.edit || !authorized pre w || authorized post w)
  let es := post.entries.filter fun en => ws.any fun w => w.entry == en.id && w.first
  { post with entries := es, writes := ws.filter fun w => es.any (·.id == w.entry) }

/-- A root cap is issued by the vault it is over; a cap resting on another is issued by that cap's grantee, from a live
    owner cap over the same vault, and is wide only if that one is (so a wide cap's whole chain is wide). -/
def capParentOk (st : State) (c : Cap) : Bool :=
  match c.parent with
  | none => c.issuer == c.over
  | some p =>
    match st.cap? p with
    | none    => false
    | some pc => st.live p && pc.over == c.over && pc.role == Role.owner && pc.grantee == .principal (.vault c.issuer) &&
        (!c.wide || pc.wide)

/-- Vault `a` may revoke cap `c`: it issued it, the cap is over it, it holds the cap (and gives it up), or it may revoke
    the cap `c` rests on. -/
def mayRevokeN (st : State) (a : VaultId) : Nat → Cap → Bool
  | 0, _ => false
  | n + 1, c => c.issuer == a || c.over == a || c.grantee == .principal (.vault a) ||
    match c.parent.bind st.cap? with
    | some p => mayRevokeN st a n p
    | none   => false

def mayRevoke (st : State) (a : VaultId) (c : Cap) : Bool := mayRevokeN st a (st.caps.length + 1) c

/-- Signer `d` may box key `k`: the key of a family that exists, at an epoch it has reached, that `d` should be able to
    open; or the key of one of an entry's stays at a generation that stay's cell has reached, when `d` should be able
    to open the key of the entry's cell. -/
def mayBox (st : State) (d : SignerId) : KeyName → Bool
  | .signer _ => false
  | .scoped k ε => (keyFams st).contains k && entitled st d k && decide (ε ≤ st.epochOf k)
  | .entry e s g =>
    match st.entry? e with
    | some en => entitled st d (.cell en.vault en.cell) && match en.stayCell s with
      | some x => decide (g ≤ st.epochOf (.cell en.vault x))
      | none   => false
    | none => false

/-- A new entry in cell `x` of vault `v` brings the cell back into use: no entry is in it, and its current key was
    sealed before. Its settle moves the cell to a new generation (`staleKeys`), so the creation may name that one:
    whoever a removal took out while the cell was empty may still hold its current key. -/
def reenters (st : State) (v : VaultId) (x : Cell) : Bool :=
  !(keyFams st).contains (.cell v x) && st.seals.any (·.secret == st.curKey (.cell v x))

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
  | .cap c via =>
    if (st.cap? c.id).isSome || (st.vault? c.over).isNone then none
    -- caps name vaults or Public, never signers, nor the vault they are over; Public only reads
    else if (match c.grantee with
             | .principal (.signer _) => true
             | .principal (.vault x)  => (st.vault? x).isNone || x == c.over
             | .«public»              => c.role != Role.read) then none
    else if !actsVia st edit.author via c.issuer || !capParentOk st c then none
    -- making someone owner is governance
    else if c.role == Role.owner && !approves st sigs (.vault c.issuer) then none
    else some { st with caps := st.caps ++ [c] }
  | .revoke cid actor keep via =>
    match st.cap? cid with
    | none => none
    | some c =>
      if !st.live cid || !actsVia st edit.author via actor || !mayRevoke st actor c then none
      else if c.role == Role.owner && !approves st sigs (.vault actor) then none
      -- the cap and every cap resting on it end
      else some (dropUnseen st { st with revoked := st.revoked ++
        ((st.caps.filter fun x => restsOn st cid x.id && !st.revoked.contains x.id).map (·.id)) } keep)
  | .write v e actor stay gen deps proposal via create tags proof touches fits =>
    if st.writes.any (·.edit == edit.id) || !actsVia st edit.author via actor then none
    else match create with
    | some (x, hdr) =>
      -- a new entry, with an id never used before, in a cell its actor may create in, under a generation that cell
      -- has reached, or the one it moves to as the entry brings it back into use
      if (st.entry? e).isSome || st.born.contains e || (st.vault? v).isNone || stay.isSome || !deps.isEmpty ||
          proposal != .main then none
      else if !cellOk st v x || !mayCreate st actor v x ||
          gen > st.epochOf (.cell v x) + (reenters st v x).toNat then none
      else
        let attrs : Attrs := ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩
        let en : Entry := ⟨e, v, [(none, x)], attrs, admits st actor v x attrs proof⟩
        -- its readers count it if it fits and the cap it was created through lets a creation through
        some { st with entries := st.entries ++ [en], born := st.born ++ [e],
                       writes  := st.writes ++ [⟨edit.id, edit.author, actor, e, none, gen, [], .main, via, true, x⟩],
                       uncounted := st.counting (creates st actor v x proof fits) edit.id }
    | none =>
      match st.entry? e with
      | none => none
      | some en =>
        let w : Write := ⟨edit.id, edit.author, actor, e, stay, gen, deps, proposal, via, false, en.cell⟩
        if en.vault != v || !mayWrite st actor en then none
        else match en.stayCell stay with
          | none => none
          | some x =>
            if gen > st.epochOf (.cell v x) then none
            -- what it builds on was accepted, so the accepted writes stay causally closed (T14)
            else if !depsIn st.writes w then none
            -- a write on a proposal builds on the proposal's start
            else if !onProposal st.writes w then none
            else
              -- only the vault's own devices change tags; anyone else asks them to, in its body
              let st' := if actor == v then setEntry st { en with attrs := { en.attrs with tags := tags.apply en.attrs.tags } }
                else st
              -- its readers count it if it fits, its rules allow what it touches and they count what it builds on
              let ok := counts st actor en deps proof (proposal == .main) touches fits
              some { st' with writes := st'.writes ++ [w], uncounted := st'.counting ok edit.id }
  | .move v e to keep via =>
    match st.entry? e with
    | none => none
    | some en =>
      -- only a steward moves, to another cell of the vault, and a move begins one stay
      if en.vault != v || !actsVia st edit.author via v then none
      else if !cellOk st v to || to == en.cell || en.stays.any (·.1 == some edit.id) then none
      else some (dropUnseen st (setEntry st { en with stays := (some edit.id, to) :: en.stays }) keep)
  | .keys secret to pub =>
    if !mayBox st edit.author secret then none
    -- a box the schedule doesn't seal would hand the key to someone who may not open it
    else if !to.all (fun t => st.seals.contains ⟨secret, t⟩) then none
    else if pub && !st.published.contains secret then none
    else some st
  | .publish v actor blob via =>
    if (st.vault? v).isNone || st.lane.contains (v, blob) then none
    -- only the vault, or a vault holding a wide owner cap over it, publishes into its lane
    else if !actsVia st edit.author via actor || !ownsLane st actor v then none
    else some { st with lane := st.lane ++ [(v, blob)] }
  | .checkpoint e covers =>
    -- a device vouches for its own accepted writes of the entry, and changes nothing
    if covers.isEmpty || !covers.all (fun c => st.writes.any fun w =>
        w.edit == c && w.author == edit.author && w.entry == e) then none
    else some st

/-- One edit: check it, then rotate, seal and link keys. -/
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
  | .removeOwner .. | .removeDevice .. | .setRoot .. | .revoke .. | .move .. => 0
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

A removal names the edits it had seen and keeps (`keep`): removing an owner or a device, revoking a cap, the root
handing itself on, and moving an entry. Every other edit that comes before it in the replay order was made
concurrently, or claims to be: it stands only if it also stands with what the removal takes away hidden. When removals
clash, the senior one stands: removals settle from the top down, a vault's before those of the coops it owns, and within
a vault its root, then its owners in the order they joined, then removals no owner approved (a device leaving);
revocations follow, the most senior revoker first; moves come last (`priority`). -/

/-- What a removal takes away. -/
inductive Fact where
  | owner  (v : VaultId) (p : Principal)
  | device (v : VaultId) (d : SignerId)
  /-- Whatever root the vault had. -/
  | root   (v : VaultId)
  | cap    (c : CapId)
  /-- Entry `e` is in cell `to`: whatever only the cell it left allowed falls. -/
  | cell   (e : EntryId) (to : Cell)
  deriving DecidableEq, Repr

/-- The state with the facts `fs` taken away. -/
def hide (st : State) (fs : List Fact) : State :=
  if fs.isEmpty then st else
  { st with
    vaults := st.vaults.map fun vt => { vt with
      owners  := vt.owners.filter fun p => !fs.contains (.owner vt.id p),
      devices := vt.devices.filter fun d => !fs.contains (.device vt.id d),
      root    := if fs.contains (.root vt.id) then none else vt.root },
    revoked := st.revoked ++ fs.filterMap fun
      | .cap c => some c
      | _ => none,
    narrow := st.narrow ++ fs.filterMap fun
      | .cell e x => some (e, x)
      | _ => none }

def Edit.isRemoval (edit : Edit) : Bool := edit.action.keep?.isSome

/-- The caps the edits `edits` issue. -/
def capsIn (edits : List Edit) : List Cap :=
  edits.filterMap fun o => match o.action with
    | .cap c _ => some c
    | _ => none

/-- Among the caps `cs`, cap `x` is `c` or rests on it through its parents. -/
def restsOnIn (cs : List Cap) (c : CapId) : Nat → CapId → Bool
  | 0, _ => false
  | n + 1, x => x == c ||
    match (cs.find? (·.id == x)).bind (·.parent) with
    | some p => restsOnIn cs c n p
    | none   => false

/-- What removal `r` takes away: the owner, the device, the root, among the caps `edits` issue the cap and every cap
    resting on it, or for a move the cells the entry no longer is in. -/
def removes (edits : List Edit) (r : Edit) : List Fact :=
  match r.action with
  | .removeOwner v p _  => [.owner v p]
  | .removeDevice v d _ => [.device v d]
  | .setRoot v _ _      => [.root v]
  | .revoke c _ _ _ =>
    let cs := capsIn edits
    (cs.filter fun x => restsOnIn cs c (cs.length + 1) x.id).map fun x => .cap x.id
  | .move _ e to _ _    => [.cell e to]
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

/-- How senior vault `a` is in revoking cap `c`: 0 for the vault it is over, else the place in `c`'s chain of the
    highest cap `a` issued, the root cap at 0; a grantee giving its cap up comes last. -/
def seniority (st : State) (a : VaultId) (c : Cap) : Nat :=
  if c.over == a then 0
  else let ch := chain st c; (ch.findIdx? (·.issuer == a)).getD ch.length

/-- Who stands when removals clash, the smallest first. Vault removals come before revocations, and a vault's
    removals before those of the coops it owns (`tier`), since a coop's removals rest on its owners' approval and
    never the other way round. Within a vault: its root, then its owners by seniority, their place among the owners
    where no removal has happened yet, then removals no owner approved. Revocations follow, the most senior revoker
    first: the vault the cap is over, then whoever issued a cap higher up the chain of the cap revoked, since a cap
    falls with the cap it rests on. Moves come last: a steward's upkeep. So a removal is only ever kept out by one
    that ranks above it, and what ranks above it never rests on what it takes away. -/
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
  | .revoke c a _ _ => [1, (base.cap? c).elim 0 (seniority base a), 0, 0]
  | .move .. => [2, 0, 0, 0]
  | _ => [3, 0, 0, 0]

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
    | .checkpoint _ covers => covers.contains o.id
    | _ => false

/-- The edits a peer counts once it no longer trusts the curves: every edit but a write, and each write a checkpoint by
    its own author covers. -/
def checkpointed (edits : List Edit) : List Edit :=
  edits.filter fun o => match o.action with
    | .write .. => edits.any (vouches · o)
    | _ => true

end AvenDB
