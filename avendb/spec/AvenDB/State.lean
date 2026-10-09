import AvenDB.Basic

/-!
# State

What a peer knows after replaying the edits it holds: vaults, caps, entries and the cells they are in, accepted writes,
the key schedule (current epochs, seals, published keys), and each vault's schema lane. Everything here is executable,
so the same definitions that the theorems talk about also produce the test vectors the Rust core must match.

Two layers. The operational one (who acts, which caps are live, which cell an entry is in, who may write it, the keys)
reads nothing a relay can't see: no selector, no type, no tag. The semantic one (an entry's attributes, whether its
creation was let in, its semantic cell) is what only its readers, and the vault's own devices, the stewards, know; no
operational rule reads it, and the stewards keep the cells equal to it by moving entries (T23).
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

/-- A cap: `grantee` holds `role` over the entries of vault `over` that `select` picks, and that every cap it rests on
    picks too. -/
structure Cap where
  id      : CapId
  over    : VaultId
  grantee : Grantee
  role    : Role
  /-- It selects the whole vault, in the clear, so a peer that reads no selector knows it reaches every cell. -/
  wide    : Bool
  /-- Sealed to `over`'s and the grantee's vault keys (in the clear for Public): no relay reads it, nor does any
      operational rule. -/
  select  : Selector
  /-- The tags its grantee may ask the vault's stewards to add or remove, sealed with the selector. -/
  relabel : List Sym
  /-- The owner cap its issuer relied on; `none` when the vault itself issued it. -/
  parent  : Option CapId
  issuer  : VaultId
  deriving DecidableEq, Repr

/-- An entry of a vault: a note, a todo, a profile. -/
structure Entry where
  id       : EntryId
  vault    : VaultId
  /-- Its stays, the current one first: the move that put it in a cell (`none` for its creation), and that cell. -/
  stays    : List (Option EditId × Cell)
  /-- What its first write says of it, and its tags now: known to its readers only. -/
  attrs    : Attrs
  /-- Its creator was the vault itself, or created it inside the slice of the cap it created it through: known to the
      vault's stewards only. -/
  admitted : Bool
  deriving DecidableEq, Repr

/-- The cell an entry is in now. -/
def Entry.cell (en : Entry) : Cell :=
  match en.stays with
  | (_, x) :: _ => x
  | [] => []

/-- The stay an entry is in now. -/
def Entry.stay (en : Entry) : Option EditId :=
  match en.stays with
  | (s, _) :: _ => s
  | [] => none

/-- The cell of one of the entry's stays. -/
def Entry.stayCell (en : Entry) (s : Option EditId) : Option Cell := (en.stays.find? (·.1 == s)).map (·.2)

/-- An accepted edit: one encrypted Loro update to one entry, on one line of its history (`history`), under the key of
    one of the entry's stays at one generation of its cell. `deps` are the writes of the same entry it builds on (its Loro
    frontier when it was made): accepted writes stay causally closed (T14), so a write whose dependency is cut is cut
    too. Its author, a device, acts for `actor` through the owners `via` (`actsVia`). -/
structure Write where
  edit     : EditId
  author   : SignerId
  actor    : VaultId
  entry    : EntryId
  stay     : Option EditId
  gen      : Nat
  deps     : List EditId
  proposal : Proposal
  via      : List VaultId
  /-- It created its entry. -/
  first    : Bool
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
  /-- Every cap issued, live or revoked. -/
  caps      : List Cap := []
  revoked   : List CapId := []
  entries   : List Entry := []
  writes    : List Write := []
  epochs    : List (KeyFam × Nat) := []
  seals     : List Seal := []
  published : List KeyName := []
  /-- The schema lane: the schemas and lenses published into each vault, by their hash, in the order they came. -/
  lane      : List (VaultId × BlobId) := []
  /-- Every entry id ever created, even of an entry that fell since: an id is created once, so an entry key's name (the
      entry, its stay, a generation) names one key. -/
  born      : List EntryId := []
  /-- Only while checking an edit that a move after it hadn't seen (`hide`): each entry such a move took to a cell, and
      that cell. A write must be allowed there too. -/
  narrow    : List (EntryId × Cell) := []
  deriving Repr

namespace State

def vault? (st : State) (v : VaultId) : Option Vault := st.vaults.find? (·.id == v)
def cap? (st : State) (c : CapId) : Option Cap := st.caps.find? (·.id == c)
def entry? (st : State) (e : EntryId) : Option Entry := st.entries.find? (·.id == e)

/-- Cap `c` was issued and hasn't been revoked. -/
def live (st : State) (c : CapId) : Bool := st.caps.any (·.id == c) && !st.revoked.contains c

def epochOf (st : State) (k : KeyFam) : Nat :=
  match st.epochs.find? (·.1 == k) with
  | some (_, e) => e
  | none => 0

def curKey (st : State) (k : KeyFam) : KeyName := .scoped k (st.epochOf k)

/-- A bound on chain length: without ownership cycles a chain never visits more vaults than exist. -/
def depth (st : State) : Nat := st.vaults.length + 1

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

/-! ## Caps -/

/-- Cap `x` rests on cap `c`: it is `c`, or its parent rests on `c`. `n` bounds the chain. -/
def restsOnN (st : State) (c : CapId) : Nat → CapId → Bool
  | 0, _ => false
  | n + 1, x => x == c ||
    match (st.cap? x).bind (·.parent) with
    | some p => restsOnN st c n p
    | none   => false

def restsOn (st : State) (c x : CapId) : Bool := restsOnN st c (st.caps.length + 1) x

/-- Cap `c` and the caps it rests on, from its root cap down to `c`. -/
def chainN (st : State) : Nat → Cap → List Cap
  | 0, c => [c]
  | n + 1, c => (match c.parent.bind st.cap? with
    | some p => chainN st n p
    | none   => []) ++ [c]

def chain (st : State) (c : Cap) : List Cap := chainN st (st.caps.length + 1) c

/-- A cell's canonical form: its cap ids, each once, smallest first. -/
def mkCell (xs : List CapId) : Cell := xs.eraseDups.mergeSort fun a b => decide (a ≤ b)

/-- Cell `x` is a cell of vault `v`: in canonical form, each of its caps one over `v` that isn't wide. -/
def cellOk (st : State) (v : VaultId) (x : Cell) : Bool :=
  x == mkCell x && x.all fun c => st.caps.any fun cp => cp.id == c && cp.over == v && !cp.wide

/-- The intake cell of cap `cp`: the caps of its chain that aren't wide. A vault that creates an entry through `cp`
    puts it there, where only those caps' grantees, the wide caps and the vault's stewards read it, until a steward
    moves it to its semantic cell. -/
def intake (st : State) (cp : Cap) : Cell := mkCell (((chain st cp).filter (!·.wide)).map (·.id))

/-- Vault `a` holds cap `cp` with role `r` or more: the cap is live and names `a`. -/
def holdsCap (st : State) (a : VaultId) (cp : Cap) (r : Role) : Bool :=
  st.live cp.id && cp.grantee == .principal (.vault a) && cp.role.allows r

/-- Cap `cp` reaches entry `en`: it is over the entry's vault, and wide, or in the entry's cell and in the cell of every
    move the edit being checked hadn't seen (`narrow`). -/
def inCell (st : State) (cp : Cap) (en : Entry) : Bool :=
  cp.over == en.vault && (cp.wide || (en.cell.contains cp.id &&
    st.narrow.all fun (e, x) => e != en.id || x.contains cp.id))

/-- Vault `a` may write entry `en`, by what every peer sees (no selector, type or tag): it is the entry's vault, or it
    holds a cap with write or more that reaches the entry. -/
def mayWrite (st : State) (a : VaultId) (en : Entry) : Bool :=
  a == en.vault || st.caps.any fun cp => holdsCap st a cp .write && inCell st cp en

/-- Vault `a` may create an entry of vault `v` in cell `x`: it is `v`, which creates in any cell, or `x` is the intake
    cell of a cap over `v` that it holds with write or more. -/
def mayCreate (st : State) (a v : VaultId) (x : Cell) : Bool :=
  a == v || st.caps.any fun cp => cp.over == v && holdsCap st a cp .write && intake st cp == x

/-- A write is authorized in `st`: its author acts for its actor through the owners it names, and that vault may write
    its entry. -/
def authorized (st : State) (w : Write) : Bool :=
  actsVia st w.author w.via w.actor && match st.entry? w.entry with
    | some en => mayWrite st w.actor en
    | none    => false

/-- Vault `a` publishes into vault `v`'s schema lane: it is `v`, or holds a wide owner cap over it. -/
def ownsLane (st : State) (a v : VaultId) : Bool :=
  a == v || st.caps.any fun cp => cp.over == v && cp.wide && holdsCap st a cp .owner

/-! ## What only readers see

The stewards (the devices acting for a vault) read every selector of the vault's caps and every entry's attributes.
They work out each entry's semantic cell and move the entry whenever its cell differs (`desired`): that is the upkeep
an honest device does after each batch of edits it takes in, and nothing here is checked by a relay. -/

/-- Cap `cp` on its own selects attributes `a`: it is wide, or its selector matches. -/
def capSelects (cp : Cap) (a : Attrs) : Bool := cp.wide || cp.select.matches a

/-- The slice cap `cp` really grants: what every cap of its chain selects (T22). -/
def effSelects (st : State) (cp : Cap) (a : Attrs) : Bool := (chain st cp).all (capSelects · a)

/-- Vault `a` creating an entry of vault `v` in cell `x` with attributes `attrs` stays inside its own slice: it is `v`,
    or `x` is the intake cell of a cap over `v` it holds with write or more whose slice holds the new entry. -/
def admits (st : State) (a v : VaultId) (x : Cell) (attrs : Attrs) : Bool :=
  a == v || st.caps.any fun cp =>
    cp.over == v && holdsCap st a cp .write && intake st cp == x && effSelects st cp attrs

/-- An entry's semantic cell: the live caps over its vault that aren't wide and whose slice holds it; none for an entry
    whose creator made it outside its own slice. -/
def semCell (st : State) (en : Entry) : Cell :=
  if en.admitted then
    mkCell ((st.caps.filter fun cp => cp.over == en.vault && st.live cp.id && !cp.wide && effSelects st cp en.attrs).map
      (·.id))
  else []

/-- The live part of an entry's cell. -/
def liveCell (st : State) (en : Entry) : Cell := en.cell.filter st.live

/-- Where a steward moves an entry: nowhere while the live part of its cell is its semantic cell (a revoked cap left in
    it is ignored, so a revocation moves no entry), else to its semantic cell. -/
def desired (st : State) (en : Entry) : Option Cell :=
  if liveCell st en == semCell st en then none else some (semCell st en)

/-- The write rule by meaning: the entry's vault, or a vault holding a live cap with write or more over it that is wide,
    or whose slice holds the entry and its creation was let in. -/
def semWrite (st : State) (a : VaultId) (en : Entry) : Bool :=
  a == en.vault || st.caps.any fun cp => cp.over == en.vault && holdsCap st a cp .write &&
    (cp.wide || (en.admitted && effSelects st cp en.attrs))

/-! ## Keys -/

/-- Vault `y` itself may read family `k`: its own seed; the key of a live cap with read or more over it or naming it;
    the key of a cell of its own, or of a cell that a live cap with read or more naming it reaches (in the cell, or
    wide). Relay caps get no key. -/
def readsV (st : State) (y : VaultId) : KeyFam → Bool
  | .seed v => y == v
  | .cap v c =>
    match st.cap? c with
    | some cp => cp.over == v && st.live c && cp.role.allows .read && (y == v || cp.grantee == .principal (.vault y))
    | none => false
  | .cell v x => y == v || st.caps.any fun cp => cp.over == v && st.live cp.id && cp.role.allows .read &&
      (cp.wide || x.contains cp.id) && cp.grantee == .principal (.vault y)

/-- Everyone may read family `k`: a live cap to Public reaches it. -/
def publicKey (st : State) : KeyFam → Bool
  | .seed _ => false
  | .cap v c =>
    match st.cap? c with
    | some cp => cp.over == v && st.live c && cp.role.allows .read && cp.grantee == .«public»
    | none => false
  | .cell v x => st.caps.any fun cp => cp.over == v && st.live cp.id && cp.role.allows .read &&
      (cp.wide || x.contains cp.id) && cp.grantee == .«public»

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

/-- Every key family that exists: each vault's seed, the key of each live cap with read or more, and the key of each
    cell an entry is in. -/
def keyFams (st : State) : List KeyFam :=
  st.vaults.map (fun v => .seed v.id) ++
  (st.caps.filter fun cp => st.live cp.id && cp.role.allows .read).map (fun cp => .cap cp.over cp.id) ++
  (st.entries.map fun en => KeyFam.cell en.vault en.cell).eraseDups

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
    vaults; a cap key is derived from its vault's seed and sealed to its grantee's; a cell key is derived from its
    vault's seed and wrapped under the key of each cap with read or more that reaches it. Relay caps get no key. -/
def targets (st : State) : KeyFam → List KeyName
  | .seed v =>
    match st.vault? v with
    | none => []
    | some vt => (vt.devices ++ ownerSigners vt).map .signer ++ (ownerVaults vt).map fun o => st.curKey (.seed o)
  | .cap v c =>
    st.curKey (.seed v) :: match st.cap? c with
    | some cp => match cp.grantee with
      | .principal (.vault g) => [st.curKey (.seed g)]
      | _ => []
    | none => []
  | .cell v x =>
    st.curKey (.seed v) :: (st.caps.filter fun cp => cp.over == v && st.live cp.id && cp.role.allows .read &&
      (cp.wide || x.contains cp.id)).map fun cp => st.curKey (.cap v cp.id)

/-- Key families whose current key some holder could open before a change but should no longer open after it, unless
    the family is public now. These start a new epoch. A family that stops being public is one: everyone held its
    key. So is a cell that comes back into use, an entry moving into it again: while it was empty its key didn't
    move on with the removals, so whoever a removal took out then may still open it. A vault's cap and cell keys are
    derived from its seed, so when the seed starts a new generation they all start a new epoch too. -/
def staleKeys (pre post : State) : List KeyFam :=
  let opened := (holders pre).map fun h => (h, opens pre (h.start pre))
  let stale := (keyFams post).filter fun k =>
    (!publicKey post k && opened.any fun (h, o) => o.contains (pre.curKey k) && !h.entitled post k) ||
    (!(keyFams pre).contains k && pre.seals.any (·.secret == pre.curKey k))
  stale ++ (keyFams post).filter fun k => !stale.contains k && match k with
    | .cap v _ | .cell v _ => stale.contains (.seed v)
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

/-- The key of entry `en` in its current stay, at its cell's current generation. -/
def entryKey (st : State) (en : Entry) : KeyName := .entry en.id en.stay (st.epochOf (.cell en.vault en.cell))

/-- The key write `w` is encrypted under. -/
def Write.key (w : Write) : KeyName := .entry w.entry w.stay w.gen

/-- The entry keys: each entry's key in its current stay derives from its cell's current key, and the key each
    accepted write used from its stay's cell key of that generation; the key of each write from an earlier stay is
    wrapped under the current stay's key (a move link), unless it already is under some key of that stay. So whoever
    reads an entry now reads its whole history, and a move hands nobody a key of the cell the entry left. -/
def linkAll (st : State) : State :=
  st.entries.foldl (fun acc en =>
    let acc := addSeal acc ⟨entryKey acc en, acc.curKey (.cell en.vault en.cell)⟩
    (st.writes.filter (·.entry == en.id)).foldl (fun acc w =>
      let acc := addSeal acc ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩
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
