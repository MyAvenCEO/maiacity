import AvenDB.Step

/-!
# Sync by audiences

Every edit belongs to one log (`Edit.log?`): a vault's (its governance, its seed's keys), a share's (the share, a keep
share too, its revocation, its keys), an audience's (its keys), or an entry's (its writes, marks and entry keys; a
schema or a lens is an entry too). A device asks a peer for what it may receive, and the peer answers from its own view:
the logs of the entries and audiences it may receive (it acts for their vault, or for the grantee of a live share
reaching their audience, or a public share does and the device has an interest in the vault or follows it), the logs of
every share it needs to check those or to know what it syncs (the shares of every audience such an entry was ever in or
of its wants, the vault's wide shares, the shares its own vaults issued, are named in or are over, and every share those
rest on), and the logs of every vault those name, up their chains of owners. Nothing else leaves the peer (T12): no
other entry, no other audience. Receiving is not reading: relay gets no key. The connection proves which device is
asking (iroh's endpoint key is the device key), so the request names the device.

What is public goes only to whoever has an interest in its vault (design §5, option a): a device that acts for the
vault, or for a vault holding a live share over it, or that names the vault in its request's follow list (`follow`).
Every vault shares its schemas and lenses with everyone, so otherwise anyone who connects would be sent every vault's
schema entries and, with them, the log of every vault they name: its owners, devices, threshold and root. A follow list
only narrows what everyone may receive to the vaults it names: it brings nothing that isn't public (T12).

Of the entries a device may receive, it syncs those its keep shares want (`wants`, `State.lean`; T28): all of a vault it
has no keep share over, else those whose wants name one of its whole or opened shares there (all of them when it has
only never ones), but none whose wants name a never one. A keep share only narrows what a device syncs, and the peer
reads only the stewards' marks to apply it, never a selector (T23).
-/

namespace AvenDB

/-- A log: a vault's, a share's, an audience's or an entry's. -/
inductive LogId where
  | vault    (v : VaultId)
  | share    (c : ShareId)
  | audience (v : VaultId) (x : Audience)
  | entry    (e : EntryId)
  deriving DecidableEq, Repr

/-- The log an edit belongs to: a vault's genesis and settings, its owners and devices given and revoked, and a seed's
    key to its vault's; a grant or a keep share, its revocation, its claim and its key to the share's; an audience's key to the
    audience's; a write (of a schema or a lens entry too), a mark and an entry's key to the entry's. -/
def Edit.log? (edit : Edit) : Option LogId :=
  match edit.action with
  | .genesis v .. | .settings v _ | .share (.owner v _) | .share (.device v _) | .revoke (.owner v ..)
  | .revoke (.device v ..) => some (.vault v)
  | .share (.grant c _) => some (.share c.id)
  | .revoke (.grant c ..) | .claim c .. => some (.share c)
  | .write _ e .. | .mark _ e .. => some (.entry e)
  | .keys k .. =>
    match k with
    | .signer _ => none
    | .scoped (.seed v) _ => some (.vault v)
    | .scoped (.share _ c) _ => some (.share c)
    | .scoped (.audience v x) _ => some (.audience v x)
    | .entry e _ _ => some (.entry e)

/-- Device `d` has an interest in vault `v`: it acts for `v`, or for a vault that holds a live share over `v`, at any
    level. -/
def interested (st : State) (d : SignerId) (v : VaultId) : Bool :=
  actsFor st d v || st.shares.any fun cp => cp.over == v && st.live cp.id && match cp.who with
    | .vault g => actsFor st d g
    | _ => false

/-- Device `d`, which follows the vaults `follow`, may receive the edits of audience `x` of vault `v`: it acts for the
    vault, or for the grantee of a live share over it, backup or more, that is in the audience or wide, or such a share
    is public and `d` has an interest in the vault or follows it. Receiving is not reading: backup gets no key, and
    relay gets nothing of the audience, only the vault's log. -/
def mayReceiveAudience (st : State) (d : SignerId) (v : VaultId) (x : Audience) (follow : List VaultId := []) : Bool :=
  actsFor st d v || st.shares.any fun cp => cp.over == v && st.live cp.id && (cp.wide || x.contains cp.id) &&
    cp.level.allows .backup &&
    match cp.who with
    | .vault g  => actsFor st d g
    | .everyone => follow.contains v || interested st d v
    | .device _ | .invite _ => false

/-- Device `d`, which follows the vaults `follow`, may receive the edits of entry `e`: it may receive the entry's
    audience. -/
def mayReceive (st : State) (d : SignerId) (e : EntryId) (follow : List VaultId := []) : Bool :=
  match st.entry? e with
  | some en => mayReceiveAudience st d en.vault en.audience follow
  | none    => false

/-- Device `d`, which follows the vaults `follow`, needs share `cp` itself: it acts for the vault the share is over, for
    the vault it names or for its issuer (whose keep shares say what `d` syncs), or the share is wide, or was ever in
    the audience of an entry `d` may receive, so `d` checks the writes it authorized, or is among the entry's wants, so
    `d` knows what it syncs. -/
def seesShare (st : State) (d : SignerId) (cp : Share) (follow : List VaultId := []) : Bool :=
  actsFor st d cp.over ||
  (match cp.who with
   | .vault g => actsFor st d g
   | _ => false) ||
  actsFor st d cp.issuer ||
  st.entries.any fun en => en.vault == cp.over && mayReceive st d en.id follow &&
    (cp.wide || en.stays.any (·.2.contains cp.id) || (st.wantsOf en.id).contains cp.id)

/-- Device `d` may learn about share `c`: it needs `c`, or a share resting on it. -/
def reachesShare (st : State) (d : SignerId) (c : ShareId) (follow : List VaultId := []) : Bool :=
  st.shares.any fun x => seesShare st d x follow && restsOn st c x.id

/-- Device `d`, which follows the vaults `follow`, may receive log `l`. Vault logs are sent by `respond` as the vaults
    the rest names. -/
def mayReceiveLog (st : State) (d : SignerId) (l : LogId) (follow : List VaultId := []) : Bool :=
  match l with
  | .entry e      => mayReceive st d e follow
  | .audience v x => mayReceiveAudience st d v x follow
  | .share c      => reachesShare st d c follow
  | .vault _      => false

/-- Device `d`, which follows the vaults `follow`, syncs entry `e`: it may receive it, and its keep shares want it
    (`wants`). -/
def syncs (st : State) (d : SignerId) (e : EntryId) (follow : List VaultId := []) : Bool :=
  match st.entry? e with
  | some en => mayReceiveAudience st d en.vault en.audience follow && wants st d en
  | none    => false

/-- Device `d` syncs log `l`: an entry's it syncs; any other it may receive. A device's keep shares choose among
    entries; the shares and audiences it may receive are few and small, and come whole. -/
def syncsLog (st : State) (d : SignerId) (l : LogId) (follow : List VaultId := []) : Bool :=
  match l with
  | .entry e => syncs st d e follow
  | l        => mayReceiveLog st d l follow

/-- The vaults an edit names: what it acts for, through, or about. -/
def Edit.vaultsNamed (edit : Edit) : List VaultId :=
  match edit.action with
  | .share (.grant c via) => [c.over, c.issuer] ++ (match c.who with
    | .vault g => [g]
    | _ => []) ++ via
  | .revoke (.grant _ a _ via) => a :: via
  | .write v _ a _ _ _ _ via _ _ => [v, a] ++ via
  | .mark v _ _ _ _ via => v :: via
  | .claim _ v via => v :: via
  | _ => []

/-- `vs` and every vault that owns one of them, directly or further up. -/
def closeVaults (st : State) : Nat → List VaultId → List VaultId
  | 0, vs => vs
  | n + 1, vs => closeVaults st n (vs ++ vs.flatMap fun v => match st.vault? v with
    | some vt => vt.owners.filterMap fun
      | .vault o  => if vs.contains o then none else some o
      | .signer _ => none
    | none => [])

/-- What a peer holding `edits` sends device `d`, which follows the vaults `follow`: the edits of every entry log `d`
    syncs and every audience and share log it may receive, and of the logs of the vaults `d` acts for and that those
    edits name, up their owners. -/
def respond (edits : List Edit) (d : SignerId) (follow : List VaultId := []) : List Edit :=
  let st := view edits
  let items := edits.filter fun o => match o.log? with
    | some l => syncsLog st d l follow
    | none   => false
  let mine := st.vaults.filterMap fun x => if actsFor st d x.id then some x.id else none
  let vaults := closeVaults st st.depth (mine ++ items.flatMap Edit.vaultsNamed)
  items ++ edits.filter fun o => match o.log? with
    | some (.vault v) => vaults.contains v
    | _ => false

/-- The files an edit brings: a write's, and no other edit's. -/
def Edit.filesOf (edit : Edit) : List FileId :=
  match edit.action with
  | .write .. => edit.files
  | _ => []

/-- A peer holding `edits` may hand device `d`, which follows the vaults `follow`, the bytes of file `f`: it sends `d`
    an edit that brings `f`. The bytes are ciphertext all the same: whoever may fetch a file keeps it, and only who
    opens the write's key opens it. -/
def mayFetch (edits : List Edit) (d : SignerId) (f : FileId) (follow : List VaultId := []) : Bool :=
  (respond edits d follow).any fun o => o.filesOf.contains f

/-- The vaults passkey `p` owns in `st`: those it is an owner or the root of. -/
def ownedBy (st : State) (p : SignerId) : List VaultId :=
  st.vaults.filterMap fun x => if x.owners.contains (.signer p) || x.root == some p then some x.id else none

/-- What a peer holding `edits` hands a device whose passkey `p` proved itself on their connection (P8c): the logs of
    the vaults `p` owns, and of every vault that owns one of them, up the chains, as a new device of `p`'s person needs
    them to add itself to its vault. Nothing about any share, audience or entry: the device asks for the rest once it
    acts for the vault. -/
def linkCard (edits : List Edit) (p : SignerId) : List Edit :=
  let st := view edits
  let vaults := closeVaults st st.depth (ownedBy st p)
  edits.filter fun edit => match edit.log? with
    | some (.vault v) => vaults.contains v
    | _ => false

/-- A peer that held `edits` after receiving `incoming`. -/
def receive (edits incoming : List Edit) : List Edit := edits ++ incoming.filter (fun o => !edits.contains o)

/-- The writes a state holds for one entry. -/
def entryWrites (st : State) (e : EntryId) : List Write := st.writes.filter (·.entry == e)

end AvenDB
