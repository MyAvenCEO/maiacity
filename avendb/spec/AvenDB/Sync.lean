import AvenDB.Step

/-!
# Sync by cells

Every edit belongs to one log (`Edit.log?`): a vault's (its governance, its seed's keys, its schema lane), a cap's (the
cap, its revocation, its keys), a cell's (its keys), or an entry's (its writes, moves, checkpoints and entry keys). A
device asks a peer for what it may receive, and the peer answers from its own view: the logs of the entries and cells
it may receive (it acts for their vault, or for the grantee of a live cap reaching their cell, or a public cap does),
the logs of every cap it needs to check those (the caps of every cell such an entry was ever in, the vault's wide caps,
the caps of its own vaults and over them, and every cap those rest on), and the logs of every vault those name, up their
chains of owners. Nothing else leaves the peer (T12): no other entry, no other cell. Receiving is not reading: relay
gets no key. The connection proves which device is asking (iroh's endpoint key is the device key), so the request names
the device.
-/

namespace AvenDB

/-- A log: a vault's, a cap's, a cell's or an entry's. -/
inductive LogId where
  | vault (v : VaultId)
  | cap   (c : CapId)
  | cell  (v : VaultId) (x : Cell)
  | entry (e : EntryId)
  deriving DecidableEq, Repr

/-- The log an edit belongs to: a vault edit, a schema or lens, and a seed's key to its vault's; a cap, its revocation
    and its key to the cap's; a cell's key to the cell's; a write, a move, a checkpoint and an entry's key to the
    entry's. -/
def Edit.log? (edit : Edit) : Option LogId :=
  match edit.action with
  | .genesis v .. | .addOwner v .. | .removeOwner v .. | .setThreshold v .. | .addDevice v .. | .removeDevice v ..
  | .setRoot v .. | .publish v .. => some (.vault v)
  | .cap c _ => some (.cap c.id)
  | .revoke c .. => some (.cap c)
  | .write _ e .. | .move _ e .. | .checkpoint e _ => some (.entry e)
  | .keys k .. =>
    match k with
    | .signer _ => none
    | .scoped (.seed v) _ => some (.vault v)
    | .scoped (.cap _ c) _ => some (.cap c)
    | .scoped (.cell v x) _ => some (.cell v x)
    | .entry e _ _ => some (.entry e)

/-- Device `d` may receive the edits of cell `x` of vault `v`: it acts for the vault, or for the grantee of a live cap
    over it, relay or more, that is in the cell or wide, or such a cap is public. Receiving is not reading: relay gets
    no key. -/
def mayReceiveCell (st : State) (d : SignerId) (v : VaultId) (x : Cell) : Bool :=
  actsFor st d v || st.caps.any fun cp => cp.over == v && st.live cp.id && (cp.wide || x.contains cp.id) &&
    match cp.grantee with
    | .principal (.vault g)  => actsFor st d g
    | .principal (.signer _) => false
    | .«public»              => true

/-- Device `d` may receive the edits of entry `e`: it may receive the entry's cell. -/
def mayReceive (st : State) (d : SignerId) (e : EntryId) : Bool :=
  match st.entry? e with
  | some en => mayReceiveCell st d en.vault en.cell
  | none    => false

/-- Device `d` needs cap `cp` itself: it acts for the vault the cap is over or for the vault it names, or the cap is
    wide or was ever in the cell of an entry `d` may receive, so `d` checks the writes it authorized. -/
def seesCap (st : State) (d : SignerId) (cp : Cap) : Bool :=
  actsFor st d cp.over ||
  (match cp.grantee with
   | .principal (.vault g) => actsFor st d g
   | _ => false) ||
  st.entries.any fun en => en.vault == cp.over && mayReceive st d en.id && (cp.wide || en.stays.any (·.2.contains cp.id))

/-- Device `d` may learn about cap `c`: it needs `c`, or a cap resting on it. -/
def reachesCap (st : State) (d : SignerId) (c : CapId) : Bool :=
  st.caps.any fun x => seesCap st d x && restsOn st c x.id

/-- Device `d` may receive log `l`. Vault logs are sent by `respond` as the vaults the rest names. -/
def mayReceiveLog (st : State) (d : SignerId) : LogId → Bool
  | .entry e    => mayReceive st d e
  | .cell v x   => mayReceiveCell st d v x
  | .cap c      => reachesCap st d c
  | .vault _    => false

/-- The vaults an edit names: what it acts for, through, or about. -/
def Edit.vaultsNamed (edit : Edit) : List VaultId :=
  match edit.action with
  | .cap c via => [c.over, c.issuer] ++ (match c.grantee with
    | .principal (.vault g) => [g]
    | _ => []) ++ via
  | .revoke _ a _ via => a :: via
  | .write v _ a _ _ _ _ via _ _ => [v, a] ++ via
  | .move v _ _ _ via => v :: via
  | _ => []

/-- `vs` and every vault that owns one of them, directly or further up. -/
def closeVaults (st : State) : Nat → List VaultId → List VaultId
  | 0, vs => vs
  | n + 1, vs => closeVaults st n (vs ++ vs.flatMap fun v => match st.vault? v with
    | some vt => vt.owners.filterMap fun
      | .vault o  => if vs.contains o then none else some o
      | .signer _ => none
    | none => [])

/-- What a peer holding `edits` sends device `d`: the edits of every entry, cell and cap log `d` may receive, and of
    the logs of the vaults `d` acts for and that those edits name, up their owners. -/
def respond (edits : List Edit) (d : SignerId) : List Edit :=
  let st := view edits
  let items := edits.filter fun o => match o.log? with
    | some l => mayReceiveLog st d l
    | none   => false
  let mine := st.vaults.filterMap fun x => if actsFor st d x.id then some x.id else none
  let vaults := closeVaults st st.depth (mine ++ items.flatMap Edit.vaultsNamed)
  items ++ edits.filter fun o => match o.log? with
    | some (.vault v) => vaults.contains v
    | _ => false

/-- The vaults passkey `p` owns in `st`: those it is an owner or the root of. -/
def ownedBy (st : State) (p : SignerId) : List VaultId :=
  st.vaults.filterMap fun x => if x.owners.contains (.signer p) || x.root == some p then some x.id else none

/-- What a peer holding `edits` hands a device whose passkey `p` proved itself on their connection (P8c): the logs of
    the vaults `p` owns, and of every vault that owns one of them, up the chains, as a new device of `p`'s person needs
    them to add itself to its vault. Nothing about any cap, cell or entry: the device asks for the rest once it acts
    for the vault. -/
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
