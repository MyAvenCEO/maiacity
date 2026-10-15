import AvenDB.Rules

/-!
# State

What a peer knows after replaying the edits it holds: vaults, shares, entries and the audiences they are in, accepted
writes, and the key schedule (current epochs, seals, published keys); and, read off them, each vault's schema lane.
Everything here is executable, so the same definitions that the theorems talk about also produce the test vectors the
Rust core must match.

Two layers. The operational one (who acts, which shares are live, which audience an entry is in, who may write it, the
keys) reads nothing a relay can't see: no selector, no type, no tag, of a share's ops only its level. The semantic one
(an entry's attributes, whether its creation was let in, its semantic audience, which writes its readers count) is what
only its readers, and the vault's own devices, the stewards, know; no operational rule reads it, and the stewards keep
the audiences equal to it by marking entries (T23).
-/

namespace AvenDB

structure Vault where
  id        : VaultId
  kind      : Kind
  owners    : List Principal
  threshold : Nat
  /-- Device signers act for a human or an aven vault but don't govern it: a person's phones and browsers, the
      servers an aven vault runs on. -/
  devices   : List SignerId
  /-- A human vault's root: its passkey, named at genesis. It approves anything for its vault on its own, wins every
      clash with the other owners, and only it hands the root on. -/
  root      : Option SignerId
  deriving DecidableEq, Repr

/-- A share: `who` may make the ops `ops` on the entries of vault `over` that `select` picks, and that every share it
    rests on picks too. -/
structure Share where
  id      : ShareId
  over    : VaultId
  who     : Who
  /-- The class of its ops (`levelOf`), in the clear: what relays and every operational rule read of it. Its readers
      count a write through it only where it is the class of its ops (`chainAllows`). -/
  level   : Level
  /-- It selects the whole vault, in the clear, so a peer that reads no selector knows it reaches every audience. -/
  wide    : Bool
  /-- Sealed to `over`'s and the grantee's vault keys (in the clear for everyone): no relay reads it, nor does any
      operational rule. -/
  select  : Selector
  /-- The ops its grantee may make (`Rules.lean`), sealed with its selector, under a commitment in the clear: whoever
      reads a write relying on it reads them, through the write's proof. -/
  ops     : List Op
  /-- The owner share its issuer relied on; `none` when the vault itself issued it. -/
  parent  : Option ShareId
  issuer  : VaultId
  deriving DecidableEq, Repr

/-- An entry of a vault: a note, a todo, a profile. -/
structure Entry where
  id       : EntryId
  vault    : VaultId
  /-- Its stays, the current one first: the mark that put it in an audience (`none` for its creation), and that
      audience. -/
  stays    : List (Option EditId × Audience)
  /-- What its first write says of it, and its tags now: known to its readers only. -/
  attrs    : Attrs
  /-- Its creator was the vault itself, or created it inside the slice of the share it created it through, whose ops
      let it: known to the vault's stewards only. -/
  admitted : Bool
  /-- The hash of the content its first write holds (`Header.blob`): for a schema or a lens entry, the schema or lens
      it puts in its vault's lane (`laneOf`). Known to its readers only. -/
  blob     : BlobId
  deriving DecidableEq, Repr

/-- The audience an entry is in now. -/
def Entry.audience (en : Entry) : Audience :=
  match en.stays with
  | (_, x) :: _ => x
  | [] => []

/-- The stay an entry is in now. -/
def Entry.stay (en : Entry) : Option EditId :=
  match en.stays with
  | (s, _) :: _ => s
  | [] => none

/-- The audience of one of the entry's stays. -/
def Entry.stayAudience (en : Entry) (s : Option EditId) : Option Audience := (en.stays.find? (·.1 == s)).map (·.2)

/-- An accepted edit: one encrypted Loro update to one entry, on one line of its history (`history`), under the key of
    one of the entry's stays at one epoch of its audience. `deps` are the writes of the same entry it builds on (its
    Loro frontier when it was made): accepted writes stay causally closed (T14), so a write whose dependency is cut is
    cut too. Its author, a device, acts for `actor` through the owners `via` (`actsVia`). -/
structure Write where
  edit     : EditId
  author   : SignerId
  actor    : VaultId
  entry    : EntryId
  stay     : Option EditId
  epoch    : Nat
  deps     : List EditId
  proposal : Proposal
  via      : List VaultId
  /-- It created its entry. -/
  first    : Bool
  /-- The audience its entry was in when it was accepted, where a removal judges it (`authorized`). -/
  audience : Audience
  deriving DecidableEq, Repr

/-- The line a write is on: `none` for the main line, else the write that started its proposal. -/
def Write.line (w : Write) : Option EditId :=
  match w.proposal with
  | .main => none
  | .new  => some w.edit
  | .on b => some b

/-- `secret` sealed or wrapped to the key `to`, or derived from it: whoever can open `to` can open `secret`. -/
structure Seal where
  secret : KeyName
  to     : KeyName
  deriving DecidableEq, Repr

structure State where
  vaults    : List Vault := []
  /-- Every share issued, live or revoked. -/
  shares    : List Share := []
  revoked   : List ShareId := []
  entries   : List Entry := []
  writes    : List Write := []
  epochs    : List (KeyFam × Nat) := []
  seals     : List Seal := []
  published : List KeyName := []
  /-- Every entry id ever created, even of an entry that fell since: an id is created once, so an entry key's name (the
      entry, its stay, an epoch) names one key. -/
  born      : List EntryId := []
  /-- Only while checking an edit that a mark after it hadn't seen (`hide`): each entry such a mark took to an
      audience, and that audience. A write must be allowed there too. -/
  narrow    : List (EntryId × Audience) := []
  /-- The accepted writes an entry's readers don't count: what it makes of the record doesn't fit the entry's schemas,
      the ops of its actor's shares don't allow it, or it builds on one they don't count (`counts`). Known to the
      entry's readers only. -/
  uncounted : List EditId := []
  /-- The keep shares that pick each entry, as its vault's stewards last marked them (`mark`): its wants. -/
  marks     : List (EntryId × List ShareId) := []
  deriving Repr

namespace State

def vault? (st : State) (v : VaultId) : Option Vault := st.vaults.find? (·.id == v)
def share? (st : State) (c : ShareId) : Option Share := st.shares.find? (·.id == c)
def entry? (st : State) (e : EntryId) : Option Entry := st.entries.find? (·.id == e)

/-- Share `c` was issued and hasn't been revoked. -/
def live (st : State) (c : ShareId) : Bool := st.shares.any (·.id == c) && !st.revoked.contains c

/-- The keep shares that pick entry `e`, as its vault's stewards last marked them. -/
def wantsOf (st : State) (e : EntryId) : List ShareId := ((st.marks.find? (·.1 == e)).map (·.2)).getD []

def epochOf (st : State) (k : KeyFam) : Nat :=
  match st.epochs.find? (·.1 == k) with
  | some (_, e) => e
  | none => 0

def curKey (st : State) (k : KeyFam) : KeyName := .scoped k (st.epochOf k)

/-- A bound on chain length: without ownership cycles a chain never visits more vaults than exist. -/
def depth (st : State) : Nat := st.vaults.length + 1

/-- The accepted writes the readers of their entries count: what a line's history is made of (`Proposals.lean`). -/
def counted (st : State) : List Write := st.writes.filter fun w => !st.uncounted.contains w.edit

end State

/-! ## Who acts, who approves, who owns -/

/-- Signer `s` is a member of vault `v`: one of its devices, or one of its owner signers (a human vault's passkeys). -/
def member (st : State) (s : SignerId) (v : VaultId) : Bool :=
  match st.vault? v with
  | none => false
  | some vt => vt.devices.contains s || vt.owners.contains (.signer s)

/-- Signer `s` acts for vault `v`: it is a member of `v`, or acts for an owner of `v`, up the chain. Whatever the
    kind: a human vault has no vault owners and a coop no members, by the rules (`ownerFits`). `n` bounds the
    chain. -/
def actsForN (st : State) (s : SignerId) : Nat → VaultId → Bool
  | 0, _ => false
  | n + 1, v =>
    match st.vault? v with
    | none => false
    | some vt => vt.devices.contains s || vt.owners.contains (.signer s) || vt.owners.any fun
      | .vault o  => actsForN st s n o
      | .signer _ => false

def actsFor (st : State) (s : SignerId) (v : VaultId) : Bool := actsForN st s st.depth v

/-- Vault `o` is listed as an owner of vault `v`. -/
def ownerOf (st : State) (o v : VaultId) : Bool :=
  match st.vault? v with
  | none => false
  | some vt => vt.owners.contains (.vault o)

/-- Signer `s` acts for vault `actor` through the owners `via`, as an edit names them: `via` runs from an owner of
    `actor` down, each vault an owner of the one before, to the vault `s` is a member of; with no `via`, `s` is a
    member of `actor` itself. A device of Bob's human vault acts for Bob's coop through `[bob]`. -/
def actsVia (st : State) (s : SignerId) : List VaultId → VaultId → Bool
  | [], actor => member st s actor
  | o :: via, actor => ownerOf st o actor && actsVia st s via o

/-- The signatures `sigs` approve for `p`: a signer approves by having signed; a vault approves when its root
    signed, or at least its threshold of owners approve. Devices are not owners, so they never approve. -/
def approvesN (st : State) (sigs : List SignerId) : Nat → Principal → Bool
  | _, .signer s => sigs.contains s
  | 0, .vault _ => false
  | n + 1, .vault v =>
    match st.vault? v with
    | none => false
    | some vt => vt.root.any sigs.contains ||
      decide (vt.threshold ≤ (vt.owners.filter (approvesN st sigs n)).length)

def approves (st : State) (sigs : List SignerId) (p : Principal) : Bool := approvesN st sigs st.depth p

/-- Vault `a` owns vault `x`, directly or through owners of owners. -/
def ownsN (st : State) (a : VaultId) : Nat → VaultId → Bool
  | 0, _ => false
  | n + 1, x =>
    match st.vault? x with
    | none => false
    | some vt => vt.owners.any fun
      | .vault o  => o == a || ownsN st a n o
      | .signer _ => false

def owns (st : State) (a x : VaultId) : Bool := ownsN st a st.depth x

/-! ## Shares -/

/-- Share `x` rests on share `c`: it is `c`, or its parent rests on `c`. `n` bounds the chain. -/
def restsOnN (st : State) (c : ShareId) : Nat → ShareId → Bool
  | 0, _ => false
  | n + 1, x => x == c ||
    match (st.share? x).bind (·.parent) with
    | some p => restsOnN st c n p
    | none   => false

def restsOn (st : State) (c x : ShareId) : Bool := restsOnN st c (st.shares.length + 1) x

/-- Share `c` and the shares it rests on, from its root share down to `c`. -/
def chainN (st : State) : Nat → Share → List Share
  | 0, c => [c]
  | n + 1, c => (match c.parent.bind st.share? with
    | some p => chainN st n p
    | none   => []) ++ [c]

def chain (st : State) (c : Share) : List Share := chainN st (st.shares.length + 1) c

/-- An audience's canonical form: its share ids, each once, smallest first. -/
def mkAudience (xs : List ShareId) : Audience := xs.eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- Audience `x` is an audience of vault `v`: in canonical form, each of its shares one over `v` that isn't wide, nor a
    keep share. -/
def audienceOk (st : State) (v : VaultId) (x : Audience) : Bool :=
  x == mkAudience x && x.all fun c => st.shares.any fun cp => cp.id == c && cp.over == v && !cp.wide && !cp.level.isKeep

/-- The intake audience of share `cp`: the shares of its chain that aren't wide. A vault that creates an entry through
    `cp` puts it there, where only those shares' grantees, the wide shares and the vault's stewards read it, until a
    steward moves it to its semantic audience. -/
def intake (st : State) (cp : Share) : Audience := mkAudience (((chain st cp).filter (!·.wide)).map (·.id))

/-- Vault `a` holds share `cp` with level `r` or more: the share is live and names `a`. -/
def holdsShare (st : State) (a : VaultId) (cp : Share) (r : Level) : Bool :=
  st.live cp.id && cp.who == .vault a && cp.level.allows r

/-- Share `cp` reaches entry `en`: it is over the entry's vault, and wide, or in the entry's audience and in the
    audience of every mark the edit being checked hadn't seen (`narrow`). -/
def inAudience (st : State) (cp : Share) (en : Entry) : Bool :=
  cp.over == en.vault && (cp.wide || (en.audience.contains cp.id &&
    st.narrow.all fun (e, x) => e != en.id || x.contains cp.id))

/-- Vault `a` may write entry `en`, by what every peer sees (no selector, type or tag): it is the entry's vault, or it
    holds a share with write or more that reaches the entry. -/
def mayWrite (st : State) (a : VaultId) (en : Entry) : Bool :=
  a == en.vault || st.shares.any fun cp => holdsShare st a cp .write && inAudience st cp en

/-- Vault `a` may create an entry of vault `v` in audience `x`: it is `v`, which creates in any audience, or `x` is the
    intake audience of a share over `v` that it holds with write or more. -/
def mayCreate (st : State) (a v : VaultId) (x : Audience) : Bool :=
  a == v || st.shares.any fun cp => cp.over == v && holdsShare st a cp .write && intake st cp == x

/-- A write is authorized in `st`: its author acts for its actor through the owners it names, and that vault may write
    its entry as the write found it, in the audience it was in then (`Write.audience`). Strong removal judges an edit at
    its own place in the replay too, so a removal takes from a write only what it took from it there: a mark between
    them doesn't hand the removal writes that never rested on what it takes away. -/
def authorized (st : State) (w : Write) : Bool :=
  actsVia st w.author w.via w.actor && match st.entry? w.entry with
    | some en => mayWrite st w.actor { en with stays := [(w.stay, w.audience)] }
    | none    => false

/-! ## What only readers see

The stewards (the devices acting for a vault) read every selector of the vault's shares and every entry's attributes.
They work out each entry's semantic audience and mark the entry with it whenever its audience differs (`desired`): that
is the upkeep an honest device does after each batch of edits it takes in, and nothing here is checked by a relay. -/

/-- Share `cp` on its own selects attributes `a`: it is wide, or its selector matches. -/
def shareSelects (cp : Share) (a : Attrs) : Bool := cp.wide || cp.select.matches a

/-- The slice share `cp` really grants: what every share of its chain selects (T22). -/
def effSelects (st : State) (cp : Share) (a : Attrs) : Bool := (chain st cp).all (shareSelects · a)

/-- Every share of `cp`'s chain is what its level says, the class of its ops, and allows the touches `ts` of a write on
    the main line (`main`) or on a proposal. -/
def chainAllows (st : State) (cp : Share) (main : Bool) (ts : List Touch) : Bool :=
  (chain st cp).all fun c => c.level == levelOf c.ops && allowsAll c.ops main ts

/-- A write through share `cp` makes only ops it may, by what its proof shows: the proof names `cp`, and `cp`'s chain
    allows the write's touches. -/
def lets (st : State) (cp : Share) (proof : Option ShareId) (main : Bool) (ts : List Touch) : Bool :=
  proof == some cp.id && chainAllows st cp main ts

/-- The readers of entry `en` count a write of it by vault `a` that builds on `deps`, carries the proof `proof` and
    touches `ts`, on the main line (`main`) or on a proposal, and whose result fits the entry's schemas or not
    (`fits`): it fits, they count what it builds on, and `a` is the entry's vault or holds a share with write or more
    reaching the entry whose ops let the write through. -/
def counts (st : State) (a : VaultId) (en : Entry) (deps : List EditId) (proof : Option ShareId) (main : Bool)
    (ts : List Touch) (fits : Bool) : Bool :=
  fits && deps.all (fun d => !st.uncounted.contains d) &&
    (a == en.vault || st.shares.any fun cp =>
      holdsShare st a cp .write && inAudience st cp en && lets st cp proof main ts)

/-- The readers of an entry of vault `v` count its creation in audience `x` by vault `a`, with the proof `proof`, whose
    record fits its schemas or not (`fits`): it fits, and `a` is `v`, or `x` is the intake audience of a share over `v`
    that `a` holds with write or more whose ops let a creation through. -/
def creates (st : State) (a v : VaultId) (x : Audience) (proof : Option ShareId) (fits : Bool) : Bool :=
  fits && (a == v || st.shares.any fun cp =>
    cp.over == v && holdsShare st a cp .write && intake st cp == x && lets st cp proof true [.create])

/-- Vault `a` creating an entry of vault `v` in audience `x` with attributes `attrs`, with the proof `proof`, stays
    inside its own slice: it is `v`, or `x` is the intake audience of a share over `v` it holds with write or more whose
    slice holds the new entry and whose ops let a creation through. -/
def admits (st : State) (a v : VaultId) (x : Audience) (attrs : Attrs) (proof : Option ShareId := none) : Bool :=
  a == v || st.shares.any fun cp =>
    cp.over == v && holdsShare st a cp .write && intake st cp == x && effSelects st cp attrs &&
      lets st cp proof true [.create]

/-- An entry's semantic audience: the live shares over its vault that aren't wide nor keep shares and whose slice holds
    it; none for an entry whose creator made it outside its own slice. -/
def semAudience (st : State) (en : Entry) : Audience :=
  if en.admitted then
    mkAudience ((st.shares.filter fun cp =>
      cp.over == en.vault && st.live cp.id && !cp.wide && !cp.level.isKeep && effSelects st cp en.attrs).map (·.id))
  else []

/-- The live part of an entry's audience. -/
def liveAudience (st : State) (en : Entry) : Audience := en.audience.filter st.live

/-- Where a steward's mark takes an entry: nowhere while the live part of its audience is its semantic audience (a
    revoked share left in it is ignored, so a revocation moves no entry), else to its semantic audience. -/
def desired (st : State) (en : Entry) : Option Audience :=
  if liveAudience st en == semAudience st en then none else some (semAudience st en)

/-- The write rule by meaning: the entry's vault, or a vault holding a live share with write or more over it that is
    wide, or whose slice holds the entry and its creation was let in. -/
def semWrite (st : State) (a : VaultId) (en : Entry) : Bool :=
  a == en.vault || st.shares.any fun cp => cp.over == en.vault && holdsShare st a cp .write &&
    (cp.wide || (en.admitted && effSelects st cp en.attrs))

/-! ## Keep shares

Which entries a device syncs, and how: of those it may receive (`mayReceive`, `Sync.lean`), the ones its keep shares
want. A keep share names one device of its issuer, with level `keep` and a mode (`KeepMode`): it grants nothing, and
selects entries as any share does, by what their first write says and their tags now, its selector sealed as a share's
is. The vault's stewards read it and mark each entry with the keep shares that pick it (`mark`), in the same mark that
takes the entry to the audience its shares pick, so a peer that reads no selector, a relay, knows what a device wants
from the marks alone. -/

/-- Signer `d` is a device of vault `v`. -/
def isDevice (st : State) (d : SignerId) (v : VaultId) : Bool := (st.vault? v).any (·.devices.contains d)

/-- Vault `a` may hold entries of vault `v`: it is `v`, or holds a share over it, backup or more. A vault issues keep
    shares only over such a vault, so no stranger has a vault's stewards mark entries for it. -/
def mayHold (st : State) (a v : VaultId) : Bool :=
  a == v || st.shares.any fun cp => cp.over == v && holdsShare st a cp .backup

/-- The live keep shares device `d` syncs vault `v` by: those over `v` naming `d`, issued by a vault `d` is still a
    device of. A device that leaves its vault drops them, with no revocation. -/
def keepsOf (st : State) (d : SignerId) (v : VaultId) : List Share :=
  st.shares.filter fun k =>
    k.level.isKeep && k.who == .device d && k.over == v && st.live k.id && isDevice st d k.issuer

/-- Device `d`'s copy setting: the live wide keep shares naming it over a vault it is a device of, issued by that vault
    (its whole or opened mode, Full copy or Light). It stands for every vault where the device has no keep share of
    its own (`keepsFor`), so one setting says what it keeps of every vault it syncs. -/
def copyOf (st : State) (d : SignerId) : List Share :=
  st.shares.filter fun k =>
    k.level.isKeep && k.who == .device d && k.wide && k.over == k.issuer && st.live k.id && isDevice st d k.issuer

/-- The keep shares device `d` syncs vault `v` by: its own over `v` (`keepsOf`), else its copy setting (`copyOf`). -/
def keepsFor (st : State) (d : SignerId) (v : VaultId) : List Share :=
  match keepsOf st d v with
  | [] => copyOf st d
  | ks => ks

/-- Wants `ks` are wants of vault `v`'s entries: in canonical form, each a keep share over `v` that isn't wide, live or
    not. -/
def wantsOk (st : State) (v : VaultId) (ks : List ShareId) : Bool :=
  ks == mkAudience ks && ks.all fun k => st.shares.any fun x => x.id == k && x.over == v && !x.wide && x.level.isKeep

/-- Keep share `k` takes what it picks out of what its device syncs: its mode is never. Whole and opened add it. -/
def Share.never (k : Share) : Bool := k.level == .keep .never

/-- What a device whose keep shares over a vault are `ks` makes of an entry that each of them picks or not (`on`): it
    syncs the entry when none of them adds entries, or one that does picks it, and no never share picks it. -/
def wantsWith (ks : List Share) (on : Share → Bool) : Bool :=
  (ks.all (·.never) || ks.any fun k => !k.never && on k) && !ks.any fun k => k.never && on k

/-- And it keeps the files the entry brings whole: a whole share picks it. -/
def keepsWith (ks : List Share) (on : Share → Bool) : Bool := ks.any fun k => k.level == .keep .whole && on k

/-- Keep share `k` picks entry `en`, by the entry's marks: it is wide, or among the entry's wants. -/
def marked (st : State) (en : Entry) (k : Share) : Bool := k.wide || (st.wantsOf en.id).contains k.id

/-- Device `d` wants entry `en`, by its keep shares for the entry's vault (`keepsFor`) and the entry's marks (design §3,
    Modes): with none, or only never ones, it wants all of the vault but what a never share picks. -/
def wants (st : State) (d : SignerId) (en : Entry) : Bool := wantsWith (keepsFor st d en.vault) (marked st en)

/-- Device `d` keeps whole the files entry `en` brings: a whole share of its keep shares for the entry's vault
    (`keepsFor`) picks the entry. With none of them whole or opened, the node's own default says (the server's backup). -/
def keeps (st : State) (d : SignerId) (en : Entry) : Bool := keepsWith (keepsFor st d en.vault) (marked st en)

/-- The types of the entries that carry a vault's schemas and lenses (design §5). -/
def schemaType : Sym := 900
def lensType : Sym := 901
def schemaTypes : List Sym := [schemaType, lensType]

/-- Keep share `k` picks attributes `a`, as a steward reads it: whole and opened shares pick every schema and lens entry
    too, so that every device that syncs part of a vault syncs its lane, and a never share picks none of them. -/
def keepPicks (k : Share) (a : Attrs) : Bool :=
  if k.never then k.select.matches a && !schemaTypes.contains a.type
  else k.select.matches a || schemaTypes.contains a.type

/-- The keep shares that pick entry `en`: the live keep shares over its vault that aren't wide and pick its attributes,
    each once, smallest first. -/
def semWants (st : State) (en : Entry) : List ShareId :=
  mkAudience ((st.shares.filter fun k =>
    k.level.isKeep && k.over == en.vault && st.live k.id && !k.wide && keepPicks k en.attrs).map (·.id))

/-- The live part of the wants marked on entry `en`. -/
def liveWants (st : State) (en : Entry) : List ShareId := (st.wantsOf en.id).filter st.live

/-- What a steward marks entry `en` with, in one mark: the audience its shares select where the live part of its
    audience isn't that (`desired`), and the keep shares that pick it where the live part of its wants isn't those (a
    revoked keep share left in them is ignored, so revoking one marks no entry); nothing while both are as they should
    be. A part the mark leaves out stays as it is, so a steward that marks only the wants never puts back an audience
    another steward changed meanwhile. -/
def desiredMark (st : State) (en : Entry) : Option (Option Audience × Option (List ShareId)) :=
  let ws := if liveWants st en == semWants st en then none else some (semWants st en)
  if (desired st en).isNone && ws.isNone then none else some (desired st en, ws)

/-! ## The schema lane

A vault's schemas and lenses are entries of the built-in types schema and lens (`schemaTypes`), which the vault shares
with everyone through a share of its own that selects those types, so that every reader of anything of the vault
receives them and opens them. Nothing checks them on the way in: a schema entry is created and written as any entry is.
Its readers read the lane off the entries alone (T17), and the lane is all that `fits`, an input of every write here,
stands for: what the schemas the write's entry was written under let it hold (`Schemas.lean`). -/

/-- Entry `en` puts its blob in vault `v`'s lane: it is an entry of `v` of type schema or lens, whose creation acted for
    `v` itself and counts. One that anyone else created, through a share, acts for its creator and puts nothing there;
    what later writes make of the entry, and its tags, are never read. -/
def inLane (st : State) (v : VaultId) (en : Entry) : Bool :=
  en.vault == v && schemaTypes.contains en.attrs.type &&
    st.counted.any fun w => w.entry == en.id && w.first && w.actor == v

/-- Vault `v`'s schema lane, as its readers read it: the blob of each entry that puts one there, in the order the
    entries were created, each blob once, so a blob created again adds nothing. -/
def laneOf (st : State) (v : VaultId) : List BlobId := ((st.entries.filter (inLane st v)).map (·.blob)).eraseDups

/-! ## Keys -/

/-- Vault `y` itself may read family `k`: its own seed; the key of a live share with read or more over it or naming it;
    the key of an audience of its own, or of an audience that a live share with read or more naming it reaches (in the
    audience, or wide). Relay shares get no key. -/
def readsV (st : State) (y : VaultId) : KeyFam → Bool
  | .seed v => y == v
  | .share v c =>
    match st.share? c with
    | some cp => cp.over == v && st.live c && cp.level.allows .read && (y == v || cp.who == .vault y)
    | none => false
  | .audience v x => y == v || st.shares.any fun cp => cp.over == v && st.live cp.id && cp.level.allows .read &&
      (cp.wide || x.contains cp.id) && cp.who == .vault y

/-- Everyone may read family `k`: a live share to everyone reaches it. -/
def publicKey (st : State) : KeyFam → Bool
  | .seed _ => false
  | .share v c =>
    match st.share? c with
    | some cp => cp.over == v && st.live c && cp.level.allows .read && cp.who == .everyone
    | none => false
  | .audience v x => st.shares.any fun cp => cp.over == v && st.live cp.id && cp.level.allows .read &&
      (cp.wide || x.contains cp.id) && cp.who == .everyone

/-- Signer `d` should be able to open the current key of `k`: it acts for a vault that may read `k`. -/
def entitled (st : State) (d : SignerId) (k : KeyFam) : Bool :=
  st.vaults.any fun y => actsFor st d y.id && readsV st y.id k

/-- Whoever holds the current key of vault `x`'s seed should be able to open the current key of `k`: `x` may read
    `k`, or a vault it owns may. -/
def entitledV (st : State) (x : VaultId) (k : KeyFam) : Bool :=
  readsV st x k || st.vaults.any fun y => owns st x y.id && readsV st y.id k

/-- What an agent holding the keys `start` can open: what is published, and whatever is sealed or wrapped to a key it
    can open, or derived from one. This is the whole attacker model: no key is learned any other way (sealed and
    encrypted data reveal nothing without their key, and a derived key reveals nothing of what it derives from). -/
inductive Knows (st : State) (start : List KeyName) : KeyName → Prop where
  | own {k : KeyName} : k ∈ start → Knows st start k
  | published {k : KeyName} : k ∈ st.published → Knows st start k
  | unseal {s : Seal} : s ∈ st.seals → Knows st start s.to → Knows st start s.secret

/-- One pass over the seals: open everything sealed to a key already open. -/
def openRound (st : State) (known : List KeyName) : List KeyName :=
  st.seals.foldl (fun acc s => if acc.contains s.to && !acc.contains s.secret then acc ++ [s.secret] else acc) known

def openAll (st : State) : Nat → List KeyName → List KeyName
  | 0, known => known
  | n + 1, known =>
    let next := openRound st known
    -- a pass that opens nothing new leaves every later pass with nothing new either
    if next.length == known.length then known else openAll st n next

/-- Everything `start` can open; each pass opens at least one new key or changes nothing, so one pass per seal is
    enough. -/
def opens (st : State) (start : List KeyName) : List KeyName :=
  openAll st (st.seals.length + 1) (start ++ st.published)

/-- The executable twin of `Knows`. -/
def knows (st : State) (start : List KeyName) (k : KeyName) : Bool := (opens st start).contains k

/-- Every key family that exists: each vault's seed, the key of each live share with read or more, and the key of each
    audience an entry is in. -/
def keyFams (st : State) : List KeyFam :=
  st.vaults.map (fun v => .seed v.id) ++
  (st.shares.filter fun cp => st.live cp.id && cp.level.allows .read).map (fun cp => .share cp.over cp.id) ++
  (st.entries.map fun en => KeyFam.audience en.vault en.audience).eraseDups

/-- Every signer some vault lists. -/
def signers (st : State) : List SignerId :=
  st.vaults.flatMap fun v => v.devices ++ v.owners.filterMap fun
    | .signer s => some s
    | .vault _  => none

/-- Whoever starts out holding keys: a signer with its own key, whoever holds a vault's seed (its members, and the
    members of its owners), and everyone, who holds nothing but what is published. -/
inductive Holder where
  | signer (s : SignerId)
  | vault (v : VaultId)
  | everyone
  deriving DecidableEq, Repr

/-- The keys a holder starts out with. -/
def Holder.start (st : State) : Holder → List KeyName
  | .signer s => [.signer s]
  | .vault v  => [st.curKey (.seed v)]
  | .everyone => []

/-- The holder should be able to open the current key of `k`. -/
def Holder.entitled (st : State) : Holder → KeyFam → Bool
  | .signer s => AvenDB.entitled st s
  | .vault x  => entitledV st x
  | .everyone => publicKey st

/-- The holders that matter in `st`: every signer some vault lists, every vault, and everyone. -/
def holders (st : State) : List Holder :=
  (signers st).map .signer ++ st.vaults.map (fun v => .vault v.id) ++ [.everyone]

/-- A vault's owner signers, its passkeys. -/
def ownerSigners (vt : Vault) : List SignerId :=
  vt.owners.filterMap fun
    | .signer s => some s
    | .vault _  => none

/-- A vault's owner vaults. -/
def ownerVaults (vt : Vault) : List VaultId :=
  vt.owners.filterMap fun
    | .vault o  => some o
    | .signer _ => none

/-- The keys the current key of `k` is sealed to, wrapped under or derived from: a seed is sealed to its vault's
    devices and owner signers (a human vault's passkeys, through keys derived from them) and to the seeds of its owner
    vaults; a share key is derived from its vault's seed and sealed to its grantee's; an audience key is derived from
    its vault's seed and wrapped under the key of each share with read or more that reaches it. Relay shares get no
    key. -/
def targets (st : State) : KeyFam → List KeyName
  | .seed v =>
    match st.vault? v with
    | none => []
    | some vt => (vt.devices ++ ownerSigners vt).map .signer ++ (ownerVaults vt).map fun o => st.curKey (.seed o)
  | .share v c =>
    st.curKey (.seed v) :: match st.share? c with
    | some cp => match cp.who with
      | .vault g => [st.curKey (.seed g)]
      | _ => []
    | none => []
  | .audience v x =>
    st.curKey (.seed v) :: (st.shares.filter fun cp => cp.over == v && st.live cp.id && cp.level.allows .read &&
      (cp.wide || x.contains cp.id)).map fun cp => st.curKey (.share v cp.id)

/-- Key families whose current key some holder could open before a change but should no longer open after it, unless
    the family is public now. These start a new epoch. A family that stops being public is one: everyone held its
    key. So is an audience that comes back into use, an entry moving into it again: while it was empty its key didn't
    move on with the removals, so whoever a removal took out then may still open it. A vault's share and audience keys
    are derived from its seed, so when the seed starts a new epoch they all start a new epoch too. -/
def staleKeys (pre post : State) : List KeyFam :=
  let opened := (holders pre).map fun h => (h, opens pre (h.start pre))
  let stale := (keyFams post).filter fun k =>
    (!publicKey post k && opened.any fun (h, o) => o.contains (pre.curKey k) && !h.entitled post k) ||
    (!(keyFams pre).contains k && pre.seals.any (·.secret == pre.curKey k))
  stale ++ (keyFams post).filter fun k => !stale.contains k && match k with
    | .share v _ | .audience v _ => stale.contains (.seed v)
    | .seed _ => false

/-- Start a new epoch of `k`. The old key is sealed to the new one, so whoever may read now can read the history. -/
def bump (st : State) (k : KeyFam) : State :=
  let e := st.epochOf k
  { st with epochs := (k, e + 1) :: st.epochs.filter (·.1 != k),
            seals  := st.seals ++ [⟨.scoped k e, .scoped k (e + 1)⟩] }

def addSeal (st : State) (s : Seal) : State :=
  if st.seals.contains s then st else { st with seals := st.seals ++ [s] }

def publish (st : State) (k : KeyName) : State :=
  if st.published.contains k then st else { st with published := st.published ++ [k] }

/-- The key of entry `en` in its current stay, at its audience's current epoch. -/
def entryKey (st : State) (en : Entry) : KeyName := .entry en.id en.stay (st.epochOf (.audience en.vault en.audience))

/-- The key write `w` is encrypted under. -/
def Write.key (w : Write) : KeyName := .entry w.entry w.stay w.epoch

/-- The entry keys: each entry's key in its current stay derives from its audience's current key, and the key each
    accepted write used from its stay's audience key of that epoch; the key of each write from an earlier stay is
    wrapped under the current stay's key (a move link), unless it already is under some key of that stay. So whoever
    reads an entry now reads its whole history, and a mark hands nobody a key of the audience the entry left. -/
def linkAll (st : State) : State :=
  st.entries.foldl (fun acc en =>
    let acc := addSeal acc ⟨entryKey acc en, acc.curKey (.audience en.vault en.audience)⟩
    (st.writes.filter (·.entry == en.id)).foldl (fun acc w =>
      let acc := addSeal acc ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩
      if w.stay == en.stay || acc.seals.any (fun s => s.secret == w.key && match s.to with
          | .entry e s' _ => e == en.id && s' == en.stay
          | _ => false) then acc
      else addSeal acc ⟨w.key, entryKey acc en⟩) acc) st

/-- Seal every current key to each of its targets, publish the public ones, and derive and link the entry keys. -/
def sealAll (st : State) : State :=
  linkAll ((keyFams st).foldl (fun acc k =>
    let acc := (targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc
    if publicKey acc k then publish acc (acc.curKey k) else acc) st)

/-- After an accepted change from `pre` to `post`: rotate what went stale, then seal, publish and link. -/
def settle (pre post : State) : State := sealAll ((staleKeys pre post).foldl bump post)

end AvenDB
