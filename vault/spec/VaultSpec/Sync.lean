import VaultSpec.Step

/-!
# Sync by caps, item by item

A device asks a peer for what it may receive. The peer answers from its own view and sends the ops of the vaults
that device acts for, and for each item it may receive, the encrypted edits, the auth ops of the scopes covering it,
and the ops of every vault those ops act for or name, up their chains of owners. Nothing about other items leaves
the peer. The connection proves which device is asking (iroh's endpoint key is the device key), so the request names
the device.
-/

namespace VaultSpec

/-- Device `d` may receive the encrypted edits of entry `(sp, e)`: the entry is public, or `d` acts for a vault
    holding relay or more on it. Receiving is not reading: relay gets no key. -/
def mayReceive (st : State) (d : SignerId) (sp : SpaceId) (e : EntryId) : Bool :=
  isPublic st (.entry sp e) || st.vaults.any fun x => actsFor st d x.id && holds st x.id (.entry sp e) .relay

/-- Device `d` may learn about scope `sc`: an entry it may receive, or a space that is public, that one of its
    vaults holds a cap on, or that holds an entry it may receive. -/
def reaches (st : State) (d : SignerId) : Scope → Bool
  | .entry sp e => mayReceive st d sp e
  | .space sp   =>
    isPublic st (.space sp) || st.vaults.any (fun x => actsFor st d x.id && holds st x.id (.space sp) .relay) ||
    match st.space? sp with
    | some s => s.entries.any (mayReceive st d sp ·)
    | none   => false

/-- The entry an op writes to. -/
def Op.writeTarget? (op : Op) : Option (SpaceId × EntryId) :=
  match op.action with
  | .write sp e .. => some (sp, e)
  | _ => none

/-- The scope an auth op is about: a space's founding, a grant's scope, or for a revocation the scope of the grant
    it revokes, looked up among `ops`. -/
def Op.authScope? (ops : List Op) (op : Op) : Option Scope :=
  match op.action with
  | .foundSpace sp _ => some (.space sp)
  | .grant g => some g.scope
  | .revoke gid _ _ => ops.findSome? fun o => match o.action with
    | .grant g => if g.id == gid then some g.scope else none
    | _ => none
  | _ => none

/-- The vault a vault op changes. -/
def Op.vaultOf? (op : Op) : Option VaultId :=
  match op.action with
  | .genesis v .. | .addOwner v .. | .removeOwner v .. | .setThreshold v .. | .addDevice v .. | .removeDevice v ..
  | .setRoot v .. => some v
  | _ => none

/-- The vault an op acts for. -/
def Op.actor? (op : Op) : Option VaultId :=
  match op.action with
  | .foundSpace _ a | .revoke _ a _ | .write _ _ a .. => some a
  | .grant g => some g.issuer
  | _ => none

/-- The vault a grant names. A peer checks that it exists before accepting the grant. -/
def Op.grantee? (op : Op) : Option VaultId :=
  match op.action with
  | .grant g => match g.grantee with
    | .principal (.vault v) => some v
    | _ => none
  | _ => none

/-- `vs` and every vault that owns one of them, directly or further up. -/
def closeVaults (st : State) : Nat → List VaultId → List VaultId
  | 0, vs => vs
  | n + 1, vs => closeVaults st n (vs ++ vs.flatMap fun v => match st.vault? v with
    | some vt => vt.owners.filterMap fun
      | .vault o  => if vs.contains o then none else some o
      | .signer _ => none
    | none => [])

/-- What a peer holding `ops` sends device `d`. -/
def respond (ops : List Op) (d : SignerId) : List Op :=
  let st := view ops
  let writes := ops.filter fun op => match op.writeTarget? with
    | some (sp, e) => mayReceive st d sp e
    | none => false
  let auth := ops.filter fun op => match op.authScope? ops with
    | some sc => reaches st d sc
    | none => false
  let mine := st.vaults.filterMap fun x => if actsFor st d x.id then some x.id else none
  let vaults := closeVaults st st.depth (mine ++ (writes ++ auth).filterMap Op.actor? ++ auth.filterMap Op.grantee?)
  let vaultOps := ops.filter fun op => match op.vaultOf? with
    | some v => vaults.contains v
    | none => false
  writes ++ auth ++ vaultOps

/-- A peer that held `ops` after receiving `incoming`. -/
def receive (ops incoming : List Op) : List Op := ops ++ incoming.filter (fun o => !ops.contains o)

/-- The writes a state holds for one item. -/
def itemWrites (st : State) (sp : SpaceId) (e : EntryId) : List Write :=
  st.writes.filter fun w => w.space == sp && w.entry == e

end VaultSpec
