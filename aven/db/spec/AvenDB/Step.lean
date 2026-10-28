import AvenDB.State

/-!
# Edits, steps and replay

Every change is a signed edit. A peer checks each edit against the state just before it (`apply`), rotates, seals and
links keys (`settle`), and replays all the edits it holds in one fixed order (`order`), so peers holding the same edits
end in the same state. A removal also cuts what it hadn't seen (`view`): an edit it hadn't seen stands only if it stands
without what the removal takes away, so neither a removed owner nor a thief holding a stolen passkey can sign edits that
claim to come before the removal, and nobody writes into an entry after a mark took it out of their slice.
-/

namespace AvenDB

/-- What a vault's settings edit sets: its threshold, or its root, which its owners hand on to a new passkey, which
    signs too, or give up. Handing the root on is a removal: it names the edits it had seen and keeps. -/
inductive Setting where
  | threshold (n : Nat)
  | root      (r : Option SignerId) (keep : List EditId)
  deriving DecidableEq, Repr

/-- What a share edit gives: a grant, share `c`, issued by `c.issuer`, or a keep share, which grants nothing and names
    one of its issuer's devices; or a place in vault `v`, as an owner `p`, or as a device `d` (a phone or a browser of a
    human vault, a harness or a server of a device vault). Owner of the whole vault is an owner of it: a grant never makes anyone
    that (WideOwner). -/
inductive Sharing where
  | grant  (c : Share) (via : List VaultId := [])
  | owner  (v : VaultId) (p : Principal)
  | device (v : VaultId) (d : SignerId)
  deriving DecidableEq, Repr

/-- What a revocation ends: grant `c`, with every grant resting on it, revoked by vault `actor` (a keep share only by
    its issuer); or the place of owner `p` or of device `d` in vault `v`. Every revocation is a removal: it names the
    edits it had seen and keeps. -/
inductive Revoking where
  | grant  (c : ShareId) (actor : VaultId) (keep : List EditId) (via : List VaultId := [])
  | owner  (v : VaultId) (p : Principal) (keep : List EditId)
  | device (v : VaultId) (d : SignerId) (keep : List EditId)
  deriving DecidableEq, Repr

/-- The edits a revocation had seen and keeps. -/
def Revoking.keep : Revoking → List EditId
  | .grant _ _ k _ | .owner _ _ k | .device _ _ k => k

/-- An entry's state as a snapshot states it: entry `entry`'s slice of what the edits up to `basis` make of it, `basis`
    being the frontier of the entry's log it had seen (`Snapshot.lean`). The slice travels as `file`, sealed under the
    entry's key, which only who may receive the entry fetches (`mayFetch`). -/
structure Stated where
  entry : EntryId
  basis : List EditId
  slice : Slice
  file  : FileId := 0
  deriving DecidableEq, Repr

/-- Every change. An edit that acts for a vault (issues or revokes a grant, writes, marks) names the owners `via` its
    author acts through (`actsVia`): none when its author is a member of the vault, else from an owner of the vault down
    to the vault its author is a member of, as a device of Bob's human vault writes for Bob's coop through `[bob]`. A
    vault's schemas and lenses are entries it writes (`laneOf`), so no edit of their own. -/
inductive Action where
  /-- A new vault. A human vault may name a root, its passkey, which signs too. -/
  | genesis    (v : VaultId) (kind : Kind) (owners : List Principal) (threshold : Nat) (root : Option SignerId := none)
  /-- Vault `v`'s threshold or root. -/
  | settings   (v : VaultId) (s : Setting)
  /-- A grant, an owner or a device. -/
  | share      (s : Sharing)
  /-- A grant, an owner or a device ends. -/
  | revoke     (r : Revoking)
  /-- An encrypted edit of entry `e` of vault `v`, on the line `proposal` of its history, under the key of its stay
      `stay` at epoch `epoch` of that stay's audience. `deps` are the entry's writes it builds on: a write that starts a
      proposal builds on the version the proposal starts from, and a merge also on the heads of the line it brings in.
      A write that creates its entry (`create`) names the audience it goes in and carries its header, and its stay is
      the one its creation begins (`none`); it is on the main line, or a draft's, which starts a line of its own
      (`Proposal.new`) and leaves the main line empty until a write on main brings that line in (`landed`). Its tags
      (`tags`, encrypted with the rest of the body) count only when it acts for the vault, except that a new entry's
      added tags are its first tags. Its body carries a proof (`proof`) where it acts through a share: the share it
      relies on, whose chain's ops its readers then read; and its readers read off its Loro update what it touches
      (`touches`, `Rules.lean`) and the rows it adds (`adds`, whose sets inside them are then its own), besides the tags it asks for, and whether what it makes of the record fits the schemas
      the entry was written under up to it (`fits`, `Schemas.lean`); and, of a cap group entry, the cap group its
      record says after it (`defines`), which counts where the vault itself writes it on the main line (`groupAt`). -/
  | write      (v : VaultId) (e : EntryId) (actor : VaultId) (stay : Option EditId) (epoch : Nat)
               (deps : List EditId := []) (proposal : Proposal := .main) (via : List VaultId := [])
               (create : Option (Audience × Header) := none) (tags : TagDelta := {}) (proof : Option ShareId := none)
               (touches : List Touch := []) (fits : Bool := true) (defines : Option CapGroup := none)
               (adds : List Ops.Loc := [])
  /-- A steward, acting for vault `v`, marks its entry `e`: with the audience its shares select (`caps`), which begins a
      stay and keeps the writes it had seen (`keep`), with the keep shares that pick it (`wants`), or with both. A part
      left out (`none`) stays as it is, so a mark of the wants alone never puts back an audience that another steward
      changed meanwhile. -/
  | mark       (v : VaultId) (e : EntryId) (caps : Option Audience) (wants : Option (List ShareId))
               (keep : List EditId) (via : List VaultId := [])
  /-- The real boxes of one key: `secret` sealed or wrapped to the keys `to`, or published (`pub`). The schedule already
      says who may open what, so this edit changes nothing here: a peer accepts it only from a signer that may open the
      key, and only if every box is one the schedule seals. -/
  | keys       (secret : KeyName) (to : List KeyName) (pub : Bool := false)
  /-- Vault `v` claims share `c`, which names an invite key, acting through the owners `via`: signed by that key, whose
      secret came with the invite, and by a member of `v` acting for it. From then on the share names `v`, and its key
      is sealed to `v`'s seed (`targets`); a second claim finds no invite left. -/
  | claim      (c : ShareId) (v : VaultId) (via : List VaultId := [])
  /-- A checkpoint of vault `v`: its owners' word, by their threshold, that each edit of `covers` carried its signers'
      signatures when it stood. It changes nothing here; a device that holds a covered edit without its signatures
      takes it on this word, while the checkpoint stands and the edit's signers acted for `v` (`Checkpoint.lean`). So
      the signatures of every covered edit, SLH-DSA's among them, need neither travel nor be checked again. -/
  | checkpoint (v : VaultId) (covers : List EditId)
  /-- The keys of entry `e`'s earlier stays, each wrapped under the key the schedule links it to (`ws`, each key and the
      key it goes under): what a move leaves to do, in one edit rather than one `keys` edit a key, so a move costs one
      signature however many writes the entry had. Accepted where each wrap would be as a `keys` edit of its own. -/
  | wraps      (e : EntryId) (ws : List (KeyName × KeyName))
  /-- A snapshot of vault `v`: its owners' word, by their threshold, on the state of each of its entries `states` names,
      at the frontier it names, so a device takes that state without replaying the entry's history (`Snapshot.lean`).
      It changes nothing here. Its owners sign it when they unlock, beside the checkpoint, in one signature. Each slice
      travels sealed to its entry's readers, as a file the edit names by its hash, so a relay sees which entries and
      at which frontiers, and a device fetches only the slices of the entries it syncs. A device
      takes from it only states of `v`'s own entries, each confined to its entry (`scoped`); one that holds the
      history checks it (`honest`), and a removal after it sends a device back to the history. -/
  | snapshot   (v : VaultId) (states : List Stated)
  deriving DecidableEq, Repr

/-- A mark that takes entry `e` to audience `to` and leaves its wants as they are: what a move was. -/
@[match_pattern] abbrev Action.move (v : VaultId) (e : EntryId) (to : Audience) (keep : List EditId)
    (via : List VaultId := []) : Action :=
  .mark v e (some to) none keep via

/-- A mark of the keep shares `rs` that pick entry `e`, which leaves its audience as it is: what a pick was. -/
@[match_pattern] abbrev Action.pick (v : VaultId) (e : EntryId) (rs : List ShareId) (via : List VaultId := []) :
    Action :=
  .mark v e none (some rs) [] via

/-- The edits a removal had seen and keeps; every removal names them: each revocation, handing the root on, and a mark
    that takes an entry to another audience. -/
def Action.keep? : Action → Option (List EditId)
  | .revoke r => some r.keep
  | .settings _ (.root _ k) | .mark _ _ (some _) _ k _ => some k
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
  /-- The files a write brings, by their roots, named in the clear; their keys travel in its encrypted body. Only a
      write brings files (`Edit.filesOf`). -/
  files     : List FileId := []
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

/-- The writes readers read as accepts, with write `w` if it is one (`yes`). -/
def State.accepting (st : State) (yes : Bool) (w : EditId) : List EditId :=
  if yes then st.accepts ++ [w] else st.accepts

/-- What writes say cap groups are, with what write `w` says, if it says one and is the vault's own on the main line
    (`yes`). -/
def State.defining (st : State) (yes : Bool) (g : Option CapGroup) (w : EditId) : List (EditId × CapGroup) :=
  match g with
  | some g => if yes then st.defs ++ [(w, g)] else st.defs
  | none => st.defs

/-- Entry `e` marked with the wants `rs`. -/
def State.markWants (st : State) (e : EntryId) (rs : List ShareId) : State :=
  { st with marks := st.marks.filter (·.1 != e) ++ [(e, rs)] }

/-- Share `x` claimed by vault `v`, if it is share `c` and names an invite key: it names `v` from now on. -/
def Share.claimed (c : ShareId) (v : VaultId) (x : Share) : Share :=
  if x.id == c && x.who.invite?.isSome then { x with who := .vault v } else x

/-- Share `c`, which names an invite key, names vault `v` from now on. -/
def State.claimShare (st : State) (c : ShareId) (v : VaultId) : State :=
  { st with shares := st.shares.map (Share.claimed c v) }

def setEntry (st : State) (en : Entry) : State :=
  { st with entries := st.entries.map fun x => if x.id == en.id then en else x }

/-- Principal `p` may own a vault of kind `k`, as the kind's table says (`Kind.rules`): a signer where signers own the
    kind, an existing vault of a kind the table lists. So signers own human vaults alone, and never a vault directly
    otherwise; an aven is owned by a coop, and a device vault owns nothing. -/
def ownerFits (st : State) (k : Kind) : Principal → Bool
  | .signer _ => k.rules.ownedBy.bySigners
  | .vault o  => (st.vault? o).any fun vt => k.rules.ownedBy.byKind vt.kind

/-- Principal `p` may own one more vault of kind `k`: the kind's table sets no limit to how many one owner owns
    (`KindRules.each`), or `p` owns fewer. So a human vault owns one aven at most. -/
def roomFor (st : State) (k : Kind) (p : Principal) : Bool :=
  k.rules.each.all fun n => decide ((st.vaults.filter fun x => x.kind == k && x.owners.contains p).length < n)

/-- Only a human vault has a root, and the root signs its genesis. -/
def rootFits (kind : Kind) (sigs : List SignerId) : Option SignerId → Bool
  | none   => true
  | some r => kind == .human && sigs.contains r

/-- A vault of the kind has devices, as the kind's table says: human, aven and device vaults do, an aven its server; a
    coop acts only through its owners. -/
def Kind.hasDevices (k : Kind) : Bool := k.rules.devices

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
    had not seen. Each write is judged in the audience it was written in (`authorized`), so a mark drops nothing here: a
    write a mark hadn't seen falls by strong removal, checked against the audience the mark took its entry to
    (`hide`). -/
def dropUnseen (pre post : State) (keep : List EditId) : State :=
  let ws := closeDeps (post.writes.filter fun w => keep.contains w.edit || !authorized pre w || authorized post w)
  let es := post.entries.filter fun en => ws.any fun w => w.entry == en.id && w.first
  { post with entries := es, writes := ws.filter fun w => es.any (·.id == w.entry) }

/-- Share `c` goes from its issuer to its own: it names a vault its issuer owns directly, as a coop's share to its
    worker's device vault or to its aven, a person's to their coop. -/
def toOwn (st : State) (c : Share) : Bool :=
  match c.who with
  | .vault g => ownerOf st c.issuer g
  | _ => false

/-- A share rests where it may, by one rule for every vault. A root share is issued by the vault it is over. A share
    that rests on another, a sub cap, is issued by that one's grantee, from a live share over the same vault that is no
    keep share; its level is no higher than that one's, and it is wide only if that one is (so a wide share's whole
    chain is wide); and either the share it rests on is an owner share, whose `share` op lets its holder share on with
    anyone, or the issuer passes it on to its own (`toOwn`). -/
def shareParentOk (st : State) (c : Share) : Bool :=
  match c.parent with
  | none => c.issuer == c.over
  | some p =>
    match st.share? p with
    | none    => false
    | some pc => st.live p && pc.over == c.over && pc.who == .vault c.issuer && !pc.level.isKeep &&
        decide (c.level.rank ≤ pc.level.rank) && (!c.wide || pc.wide) && (pc.level == Level.owner || toOwn st c)

/-- A share rests where it may: a keep share on nothing, over a vault whose entries its issuer may hold, so no stranger
    has a vault's stewards mark entries for it; any other share as `shareParentOk` says. -/
def restsOk (st : State) (c : Share) : Bool :=
  if c.level.isKeep then c.parent.isNone && mayHold st c.issuer c.over else shareParentOk st c

/-- Vault `a` may revoke share `c`: it issued it, the share is over it, it holds the share (and gives it up), or it may
    revoke the share `c` rests on. -/
def mayRevokeN (st : State) (a : VaultId) : Nat → Share → Bool
  | 0, _ => false
  | n + 1, c => c.issuer == a || c.over == a || c.who == .vault a ||
    match c.parent.bind st.share? with
    | some p => mayRevokeN st a n p
    | none   => false

/-- A keep share only its issuer revokes, through a device or an owner: the vault it is over could otherwise have a
    device sync all of that vault, by revoking its last keep share that adds entries. -/
def mayRevoke (st : State) (a : VaultId) (c : Share) : Bool :=
  if c.level.isKeep then c.issuer == a else mayRevokeN st a (st.shares.length + 1) c

/-- Signer `d` may box key `k`: the key of a family that exists, at an epoch it has reached, that `d` should be able to
    open; or the key of one of an entry's stays, when `d` should be able to open the key of the entry's audience. An
    entry key's epoch is its writes' to name (`apply`), and its boxes go only where the schedule seals it, which only
    the entry's own writes and stays make it. -/
def mayBox (st : State) (d : SignerId) : KeyName → Bool
  | .signer _ => false
  | .scoped k ε => (keyFams st).contains k && entitled st d k && decide (ε ≤ st.epochOf k)
  | .entry e s _ =>
    match st.entry? e with
    | some en => entitled st d (.audience en.vault en.audience) && (en.stayAudience s).isSome
    | none => false

/-- Signer `d` may wrap key `w.1`, one of entry `e`'s own, under `w.2`: it may open the key, and the schedule seals it
    there. -/
def wrapOk (st : State) (d : SignerId) (e : EntryId) (w : KeyName × KeyName) : Bool :=
  (match w.1 with
    | .entry x _ _ => x == e
    | _ => false) && mayBox st d w.1 && st.seals.contains ⟨w.1, w.2⟩

/-- A new entry in audience `x` of vault `v` brings the audience back into use: no entry is in it, and its current key
    was sealed before. Its settle moves the audience to a new epoch (`staleKeys`), the one a device names for the
    creation: whoever a removal took out while the audience was empty may still hold its current key. -/
def reenters (st : State) (v : VaultId) (x : Audience) : Bool :=
  !(keyFams st).contains (.audience v x) && st.seals.any (·.secret == st.curKey (.audience v x))

/-- Vault `v` claims share `c` by an edit its signers `sigs` signed, whose author acts for `v` through the owners `via`:
    the share is live and names an invite key, which signs; and `v` is a vault there is, other than the one the share is
    over. The share names `v` from then on. -/
@[irreducible] def applyClaim (st : State) (sigs : List SignerId) (author : SignerId) (c : ShareId) (v : VaultId)
    (via : List VaultId) : Option State :=
  match st.share? c with
  | none => none
  | some x =>
    match x.who with
    | .invite k =>
      if !st.live c || !sigs.contains k || !actsVia st author via v then none
      else if (st.vault? v).isNone || v == x.over then none
      else some (st.claimShare c v)
    | _ => none

/-- Check one edit against the state just before it; `none` when it is refused. -/
def apply (st : State) (edit : Edit) : Option State :=
  let sigs := edit.sigs
  match edit.action with
  | .genesis v kind owners threshold root =>
    if (st.vault? v).isSome || owners.isEmpty || !nodup owners then none
    else if !owners.all (ownerFits st kind) || !rootFits kind sigs root then none
    -- no more owners than its kind takes (OneOwner), each of which may own one more of its kind (SecondAven)
    else if !kind.rules.takes owners.length || !owners.all (roomFor st kind) then none
    else if threshold == 0 || threshold > owners.length then none
    -- every first owner consents
    else if !owners.all (approves st sigs) then none
    else some { st with vaults := st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩] }
  | .share (.owner v p) =>
    match st.vault? v with
    | none => none
    | some vt =>
      if vt.owners.contains p || !ownerFits st vt.kind p then none
      -- no more owners than its kind takes (OneOwner), and the newcomer may own one more of its kind (SecondAven)
      else if !vt.kind.rules.takes (vt.owners.length + 1) || !roomFor st vt.kind p then none
      -- no cycles: the newcomer must not be the vault itself or something the vault owns
      else if (match p with | .vault x => x == v || owns st v x | .signer _ => false) then none
      -- the vault's threshold, plus the newcomer's consent
      else if !(approves st sigs (.vault v) && approves st sigs p) then none
      else some (setVault st { vt with owners := vt.owners ++ [p] })
  | .revoke (.owner v p keep) =>
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
  | .settings v (.threshold n) =>
    match st.vault? v with
    | none => none
    | some vt =>
      if n == 0 || n > vt.owners.length || !approves st sigs (.vault v) then none
      else some (setVault st { vt with threshold := n })
  | .share (.device v d) =>
    match st.vault? v with
    | none => none
    | some vt =>
      if !vt.kind.hasDevices || vt.devices.contains d then none
      -- the vault's threshold, plus the device's own signature
      else if !(approves st sigs (.vault v) && sigs.contains d) then none
      else some (setVault st { vt with devices := vt.devices ++ [d] })
  | .revoke (.device v d keep) =>
    match st.vault? v with
    | none => none
    | some vt =>
      if !vt.devices.contains d then none
      else if !(approves st sigs (.vault v) || sigs.contains d) then none
      else some (dropUnseen st (setVault st { vt with devices := vt.devices.erase d }) keep)
  | .settings v (.root r _) =>
    match st.vault? v with
    | none => none
    | some vt =>
      -- the vault's owners hand the root on, by its threshold, as any change (every owner equal: Samuel 2026-10-19),
      -- and the new root signs; only a human vault has one
      if !approves st sigs (.vault v) || !r.all sigs.contains || !(r.isNone || vt.kind == .human) then none
      else some (setVault st { vt with root := r })
  | .share (.grant c via) =>
    if (st.share? c.id).isSome || (st.vault? c.over).isNone then none
    -- a share names a device exactly when it is a keep share (KeepNeedsDevice, DeviceOnlyKeeps)
    else if c.level.isKeep != c.who.isDevice then none
    -- grants name vaults, everyone or an invite key, nor the vault they are over; everyone only reads; an invite
    -- makes no owner, which takes the newcomer's consent
    else if (match c.who with
             | .device _ => false
             | .vault x  => (st.vault? x).isNone || x == c.over
             | .everyone => c.level != Level.read
             | .invite _ => c.level == Level.owner) then none
    -- owner of the whole vault is an owner of it, which only a vault's approval and the newcomer's consent make
    -- (WideOwner); owner of a slice is a grant
    else if c.level == Level.owner && c.wide then none
    -- a vault keeps entries on its own devices only
    else if !c.who.device?.all (isDevice st · c.issuer) then none
    else if !actsVia st edit.author via c.issuer || !restsOk st c then none
    -- making someone owner is governance
    else if c.level == Level.owner && !approves st sigs (.vault c.issuer) then none
    else some { st with shares := st.shares ++ [c] }
  | .revoke (.grant cid actor keep via) =>
    match st.share? cid with
    | none => none
    | some c =>
      if !st.live cid || !actsVia st edit.author via actor || !mayRevoke st actor c then none
      else if c.level == Level.owner && !approves st sigs (.vault actor) then none
      -- the share and every share resting on it end
      else some (dropUnseen st { st with revoked := st.revoked ++
        ((st.shares.filter fun x => restsOn st cid x.id && !st.revoked.contains x.id).map (·.id)) } keep)
  | .write v e actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    -- its epoch is its writer's to name, and no peer checks it against the epoch it holds: an audience moves on by
    -- edits of other entries too, one that empties it and one that brings it back into use, which a device the entry is
    -- shared with later never receives (T12), so such a check would refuse there what every device of the vault
    -- accepts. Under an epoch its audience hasn't reached, nobody opens it until the audience does
    if st.writes.any (·.edit == edit.id) || !actsVia st edit.author via actor then none
    else match create with
    | some (x, hdr) =>
      -- a new entry, with an id never used before, in an audience its actor may create in, building on nothing, on
      -- the main line or as a draft starting its own line (`.new`), never on a proposal that already is
      if (st.entry? e).isSome || st.born.contains e || (st.vault? v).isNone || stay.isSome || !deps.isEmpty ||
          proposal.isOn then none
      else if !audienceOk st v x || !mayCreate st actor v x then none
      else
        let attrs : Attrs := ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩
        let en : Entry := ⟨e, v, [(none, x)], attrs, admits st actor v x attrs proof (proposal == .main), hdr.blob⟩
        -- its readers count it if it fits and the share it was created through lets a creation on its line through
        some { st with entries := st.entries ++ [en], born := st.born ++ [e],
                       writes  := st.writes ++ [⟨edit.id, edit.author, actor, e, none, epoch, [], proposal, via, true, x⟩],
                       uncounted := st.counting (creates st actor v x attrs proof (proposal == .main) fits) edit.id,
                       defs := st.defining (actor == v && proposal == .main) defines edit.id,
                       adds := st.adds ++ [(edit.id, adds)] }
    | none =>
      match st.entry? e with
      | none => none
      | some en =>
        let w : Write := ⟨edit.id, edit.author, actor, e, stay, epoch, deps, proposal, via, false, en.audience⟩
        if en.vault != v || !mayWrite st actor en then none
        else match en.stayAudience stay with
          | none => none
          | some _ =>
            -- what it builds on was accepted, so the accepted writes stay causally closed (T14)
            if !depsIn st.writes w then none
            -- a write on a proposal builds on the proposal's start
            else if !onProposal st.writes w then none
            else
              -- only the vault's own devices change tags; anyone else asks them to, in its body
              let st' := if actor == v then setEntry st { en with attrs := { en.attrs with tags := tags.apply en.attrs.tags } }
                else st
              -- its readers count it if it fits, its shares' ops allow what it touches and the tags it asks for, and
              -- they count what it builds on
              let ok := counts st actor en deps proof (proposal == .main) (touches ++ tags.touches) fits
              -- the vault's own write on a proposal that touches nothing and asks for no tag is its accept
              some { st' with writes := st'.writes ++ [w], uncounted := st'.counting ok edit.id,
                              accepts := st'.accepting (isAccept actor en proposal (touches ++ tags.touches)) edit.id,
                              defs := st'.defining (actor == v && proposal == .main) defines edit.id,
                              adds := st'.adds ++ [(edit.id, adds)] }
  | .mark v e caps wants keep via =>
    match st.entry? e with
    | none => none
    | some en =>
      -- only a steward marks an entry of its vault
      if en.vault != v || !actsVia st edit.author via v then none
      -- it marks an audience, the keep shares that pick the entry, or both; only a new audience is a removal, which
      -- keeps what it had seen
      else if (caps.isNone && wants.isNone) || (caps.isNone && !keep.isEmpty) then none
      -- another audience of the vault, and a mark begins one stay
      else if !caps.all (fun to => audienceOk st v to && to != en.audience && !en.stays.any (·.1 == some edit.id)) then
        none
      -- wants of the vault, other than the entry's, but where the mark takes it to a new audience. Neither list asks
      -- whether what it names is live: a revocation that sorts before the mark, of a share or a keep share, mustn't
      -- refuse it, and readers leave out what isn't live
      else if !wants.all (fun rs => wantsOk st v rs && (caps.isSome || rs != st.wantsOf e)) then none
      -- a new audience cuts what the mark hadn't seen that only the audience the entry leaves allowed
      else match caps, wants with
        | some to, some rs =>
          some (dropUnseen st (setEntry (st.markWants e rs) { en with stays := (some edit.id, to) :: en.stays }) keep)
        | some to, none => some (dropUnseen st (setEntry st { en with stays := (some edit.id, to) :: en.stays }) keep)
        | none, some rs => some (st.markWants e rs)
        | none, none => none
  | .keys secret to pub =>
    if !mayBox st edit.author secret then none
    -- a box the schedule doesn't seal would hand the key to someone who may not open it
    else if !to.all (fun t => st.seals.contains ⟨secret, t⟩) then none
    else if pub && !st.published.contains secret then none
    else some st
  | .claim cid v via => applyClaim st sigs edit.author cid v via
  | .checkpoint v _ => if (st.vault? v).isSome && approves st sigs (.vault v) then some st else none
  | .wraps e ws => if !ws.isEmpty && ws.all (wrapOk st edit.author e) then some st else none
  | .snapshot v _ => if (st.vault? v).isSome && approves st sigs (.vault v) then some st else none

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
  | .revoke _ | .settings _ (.root ..) | .mark _ _ (some _) .. => 0
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

A removal names the edits it had seen and keeps (`keep`): revoking an owner, a device or a grant, the owners handing
the root on, and a mark that takes an entry to another audience. Every other edit that comes before it in the replay order
was made concurrently, or claims to be: it stands only if it also stands with what the removal takes away hidden. When
removals clash, the senior one stands: a vault's removals (revoking an owner or a device, handing the root on) settle
from the top down, a vault's before those of the coops it owns, and within a vault its owners in the order they
joined (every owner equal, the root no senior: Samuel 2026-10-19), then removals no owner approved (a device leaving);
revoked grants follow, the most senior revoker first; marks that change an audience come last (`priority`). A mark of the wants alone is no removal: it takes nothing
away, so nothing it hadn't seen falls by it. Nor does revoking a keep share take anything away (`removes`): nothing
rests on a keep share, no audience holds one, and no mark asks whether the keep shares it names are live. -/

/-- What a removal takes away. -/
inductive Fact where
  | owner    (v : VaultId) (p : Principal)
  | device   (v : VaultId) (d : SignerId)
  /-- Whatever root the vault had. -/
  | root     (v : VaultId)
  | share    (c : ShareId)
  /-- Entry `e` is in audience `to`: whatever only the audience it left allowed falls. -/
  | audience (e : EntryId) (to : Audience)
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
      | .share c => some c
      | _ => none,
    narrow := st.narrow ++ fs.filterMap fun
      | .audience e x => some (e, x)
      | _ => none }

def Edit.isRemoval (edit : Edit) : Bool := edit.action.keep?.isSome

/-- The grants the edits `edits` issue. -/
def sharesIn (edits : List Edit) : List Share :=
  edits.filterMap fun o => match o.action with
    | .share (.grant c _) => some c
    | _ => none

/-- Among the shares `cs`, share `x` is `c` or rests on it through its parents. -/
def restsOnIn (cs : List Share) (c : ShareId) : Nat → ShareId → Bool
  | 0, _ => false
  | n + 1, x => x == c ||
    match (cs.find? (·.id == x)).bind (·.parent) with
    | some p => restsOnIn cs c n p
    | none   => false

/-- What removal `r` takes away: the owner, the device, the root, among the grants `edits` issue the grant and every
    grant resting on it (nothing for a keep share), or for a mark that changes an audience the audiences the entry no
    longer is in. -/
def removes (edits : List Edit) (r : Edit) : List Fact :=
  match r.action with
  | .revoke (.owner v p _)   => [.owner v p]
  | .revoke (.device v d _)  => [.device v d]
  | .settings v (.root ..)   => [.root v]
  | .revoke (.grant c _ _ _) =>
    let cs := sharesIn edits
    if (cs.find? (·.id == c)).any (·.level.isKeep) then []
    else (cs.filter fun x => restsOnIn cs c (cs.length + 1) x.id).map fun x => .share x.id
  | .mark _ e (some to) ..   => [.audience e to]
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

/-- How far below the human vaults vault `v` sits: a human vault at 0, any other vault one below its lowest
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

/-- How senior vault `a` is in revoking share `c`: 0 for the vault it is over, else the place in `c`'s chain of the
    highest share `a` issued, the root share at 0; a grantee giving its share up comes last. -/
def seniority (st : State) (a : VaultId) (c : Share) : Nat :=
  if c.over == a then 0
  else let ch := chain st c; (ch.findIdx? (·.issuer == a)).getD ch.length

/-- Who stands when removals clash, the smallest first. A vault's removals (an owner or a device revoked, the root
    handed on) come before revoked grants, and a vault's removals before those of the coops it owns (`tier`), since a
    coop's removals rest on its owners' approval and never the other way round. Within a vault: its root, then its
    owners by seniority, their place among the owners where no removal has happened yet, then removals no owner
    approved. Revoked grants follow, the most senior revoker first: the vault the grant is over, then whoever issued a
    grant higher up the chain of the grant revoked, since a grant falls with the grant it rests on. Marks that change an
    audience come last: a steward's upkeep. So a removal is only ever kept out by one that ranks above it, and what
    ranks above it never rests on what it takes away. -/
def priority (base : State) (edit : Edit) : List Nat :=
  match edit.action with
  | .revoke (.owner v _ _) | .revoke (.device v _ _) | .settings v (.root ..) =>
    let t := tier base v
    match base.vault? v with
    | none => [0, t, 2, 0]
    | some vt =>
      match vt.owners.zipIdx.find? fun (p, _) => approves base edit.sigs p with
        | some (_, i) => [0, t, 1, i]
        | none => [0, t, 2, 0]
  | .revoke (.grant c a _ _) => [1, (base.share? c).elim 0 (seniority base a), 0, 0]
  | .mark _ _ (some _) .. => [2, 0, 0, 0]
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

/-! ## Stepping on a stored view

A device keeps what it knows between unlocks and steps new edits on it one by one, never replaying every edit it holds
again, where that gives the view: new writes, each deeper than every edit it held, none of which an edit it held builds
on (`V1_view_steps_on`). -/

/-- An edit writes an entry. -/
def Action.isWrite : Action → Bool
  | .write .. => true
  | _ => false

/-- Edits stepped on one by one from `st`, in this order: each stands if `step` accepts it on the state before it. The
    state at the end, and the edits that stood. -/
def stepsOn : State → List Edit → State × List Edit
  | st, [] => (st, [])
  | st, edit :: edits =>
    match step st edit with
    | some st' => let r := stepsOn st' edits; (r.1, edit :: r.2)
    | none => stepsOn st edits

/-! ## Trying removals on the trust records

Which revocations stand, and which roots handed on, turns on the edits that say who may do what alone (`isTrust`), never
on writes, marks, boxes, checkpoints, wraps or snapshots (`V2_removals_read_trust`). So a device tries each of them by a
replay of those edits alone (`runTrust`), a few hundred where its log holds a hundred thousand writes, and chooses the
removals `resolve` chooses (`resolveTrust`). -/

/-- An edit says who may do what: a vault made, an owner, a device or a grant given or taken, a setting, an invite
    claimed. -/
def Action.isTrust : Action → Bool
  | .genesis .. | .settings .. | .share _ | .revoke _ | .claim .. => true
  | _ => false

/-- `runWith`, of the edits that say who may do what alone (`isTrust`), each at its place among `edits`. -/
def runTrust (edits rem : List Edit) : State × List Edit :=
  runFrom rem (cuts edits rem) {} (edits.zipIdx.filter (·.1.action.isTrust))

/-- `resolve`, trying each removal that says who may do what by `runTrust`, and each mark that takes an entry to
    another audience by `runWith`, as `resolve` does. -/
def resolveTrust (edits : List Edit) : List Edit :=
  let base := (runTrust edits []).1
  let cands := (edits.filter Edit.isRemoval).mergeSort fun a b => prioLe (priority base a) (priority base b)
  cands.foldl (fun rem r =>
    let stood := if r.action.isTrust then (runTrust edits (rem ++ [r])).2 else (runWith edits (rem ++ [r])).2
    if (r :: rem).all fun x => stood.any (·.id == x.id) then rem ++ [r] else rem) []

end AvenDB
