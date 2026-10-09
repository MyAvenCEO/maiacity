/-!
# Basic notions

Every id stands for a hash or a public key: a signer's id is its public key, a vault's id is the hash of its
genesis, an edit's id is the hash of its bytes, a blob's (a schema's or a lens's) the hash of its bytes. The model uses
`Nat` for all of them. That they never collide is the "hashes don't collide" assumption; the theorems that need it say
so in a hypothesis.
-/

namespace AvenDB

abbrev SignerId := Nat
abbrev VaultId  := Nat
abbrev SpaceId  := Nat
abbrev EntryId  := Nat
abbrev GrantId  := Nat
abbrev EditId     := Nat
abbrev BlobId   := Nat

/-- A vault is an identity, like a smart account. A human vault is owned by signers, its person's passkeys, and its
    devices act for it. A coop vault is owned by human and coop vaults. An aven vault, an agent such as the relay
    server, is owned by human and coop vaults too, and its devices (the servers it runs on) act for it but never
    govern it. -/
inductive Kind where
  | human
  | coop
  | aven
  deriving DecidableEq, Repr

/-- Who can own a vault: signers own human vaults, vaults own coop and aven vaults. -/
inductive Principal where
  | signer (s : SignerId)
  | vault  (v : VaultId)
  deriving DecidableEq, Repr

/-- relay < read < write < owner (superadmin). Relay may hold and pass on the encrypted edits of a scope but gets no
    key for it: that is the server's role. -/
inductive Role where
  | relay
  | read
  | write
  | owner
  deriving DecidableEq, Repr

def Role.rank : Role → Nat
  | .relay => 0
  | .read  => 1
  | .write => 2
  | .owner => 3

/-- A cap with role `r` allows what `need` allows. -/
def Role.allows (r need : Role) : Bool := decide (need.rank ≤ r.rank)

/-- A whole space, or one entry (one document or todo) in it. -/
inductive Scope where
  | space (sp : SpaceId)
  | entry (sp : SpaceId) (e : EntryId)
  deriving DecidableEq, Repr

def Scope.spaceOf : Scope → SpaceId
  | .space sp   => sp
  | .entry sp _ => sp

/-- `outer.covers inner`: a cap on `outer` also applies to `inner`. A space covers its entries, an entry only
    itself. -/
def Scope.covers : Scope → Scope → Bool
  | .space s,   t          => s == t.spaceOf
  | .entry s e, .entry t f => s == t && e == f
  | .entry _ _, .space _   => false

/-- Whom a grant names: a vault, or Public. A grant naming a signer is refused (T4); the type still allows one, so
    that the refusal is something we prove rather than assume. -/
inductive Grantee where
  | principal (p : Principal)
  | «public»
  deriving DecidableEq, Repr

/-- A family of keys that rotates through epochs. -/
inductive KeyScope where
  | vault (v : VaultId)
  | space (sp : SpaceId)
  | entry (sp : SpaceId) (e : EntryId)
  deriving DecidableEq, Repr

/-- The line of an entry's history a write extends: the main line, a new proposal that the write starts (the write's id
    names the proposal, and its body holds the proposal's name, encrypted), or the proposal another write started. -/
inductive Proposal where
  | main
  | new
  | on (b : EditId)
  deriving DecidableEq, Repr

/-- A signer's own encryption key (a device's, or one derived from a passkey), or one epoch of a key family. -/
inductive KeyName where
  | signer (s : SignerId)
  | scoped (k : KeyScope) (epoch : Nat)
  deriving DecidableEq, Repr

end AvenDB
