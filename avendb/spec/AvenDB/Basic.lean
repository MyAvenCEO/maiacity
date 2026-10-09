/-!
# Basic notions

Every id stands for a hash or a public key: a signer's id is its public key, a vault's id is the hash of its
genesis, an edit's id and a cap's id are the hashes of their bytes, an entry's id is 32 random bytes its creator draws,
a blob's (a schema's or a lens's) the hash of its bytes, a type or a tag a short name. The model uses `Nat` for all of
them. That they never collide is the "hashes don't collide" assumption; the theorems that need it say so in a
hypothesis.
-/

namespace AvenDB

abbrev SignerId := Nat
abbrev VaultId  := Nat
abbrev EntryId  := Nat
abbrev CapId    := Nat
abbrev EditId   := Nat
abbrev BlobId   := Nat
/-- A type (`note`, `todo`, …) or a tag: a short name. -/
abbrev Sym      := Nat

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

/-- relay < read < write < owner. Relay may hold and pass on the encrypted edits of a slice but gets no key for it:
    that is the server's role. Owner also shares the slice on and is governance. -/
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

/-- Whom a cap names: a vault, or Public. A cap naming a signer is refused (T4); the type still allows one, so that the
    refusal is something we prove rather than assume. -/
inductive Grantee where
  | principal (p : Principal)
  | «public»
  deriving DecidableEq, Repr

/-! ## Slices

A cap selects a slice of its vault's entries by what their first write says of them (their type, the vault that
created them, their id, when they were created) and by their tags now. Groups of entries are never named: a slice is
whatever a selector picks, and the cells (`State.lean`) are whatever caps pick alike. -/

/-- What a selector tests of an entry. -/
structure Attrs where
  type    : Sym
  author  : VaultId
  entry   : EntryId
  created : Nat
  tags    : List Sym
  deriving DecidableEq, Repr

/-- One test. `typeIn [t]` is `type == t`. -/
inductive Atom where
  | typeIn     (ts : List Sym)
  | authorIn   (vs : List VaultId)
  | entryIn    (es : List EntryId)
  /-- Created in `[lo, hi)`. -/
  | createdIn  (lo hi : Nat)
  | tagHas     (t : Sym)
  | tagNone    (ts : List Sym)
  | tagsWithin (ts : List Sym)
  deriving DecidableEq, Repr

def Atom.test (a : Attrs) : Atom → Bool
  | .typeIn ts      => ts.contains a.type
  | .authorIn vs    => vs.contains a.author
  | .entryIn es     => es.contains a.entry
  | .createdIn lo hi => decide (lo ≤ a.created) && decide (a.created < hi)
  | .tagHas t       => a.tags.contains t
  | .tagNone ts     => !ts.any a.tags.contains
  | .tagsWithin ts  => a.tags.all ts.contains

/-- The whole vault, or the entries that pass every test of at least one of the conjunctions. The wire caps a selector
    at 8 conjunctions of 16 tests and an `entryIn` at 1,000 ids, so matching stays linear. -/
inductive Selector where
  | all
  | anyOf (ds : List (List Atom))
  deriving DecidableEq, Repr

def Selector.matches (a : Attrs) : Selector → Bool
  | .all      => true
  | .anyOf ds => ds.any fun d => d.all (·.test a)

/-- The tags a write adds and removes. -/
structure TagDelta where
  add    : List Sym := []
  remove : List Sym := []
  deriving DecidableEq, Repr

/-- Remove, then add what isn't there yet. -/
def TagDelta.apply (d : TagDelta) (ts : List Sym) : List Sym :=
  let kept := ts.filter (!d.remove.contains ·)
  kept ++ (d.add.filter (!kept.contains ·)).eraseDups

/-- What an entry's first write says of it, which never changes: its type and when it was created (as its creator
    says). It travels inside the write's encrypted body, so no relay sees it. -/
structure Header where
  type    : Sym
  created : Nat
  deriving DecidableEq, Repr

/-! ## Cells and keys -/

/-- A cell of a vault: the caps that select its entries, as the sorted list of their ids (its signature). On the wire a
    cell is named by the hash of its vault and its signature. -/
abbrev Cell := List CapId

/-- A family of keys that rotates through epochs (a seed's and a cell's are called generations): a vault's seed, whose
    key pair is the vault's key and from which its master key is derived; the key of a cap with read or more; a cell's
    key. -/
inductive KeyFam where
  | seed (v : VaultId)
  | cap  (v : VaultId) (c : CapId)
  | cell (v : VaultId) (x : Cell)
  deriving DecidableEq, Repr

/-- The line of an entry's history a write extends: the main line, a new proposal that the write starts (the write's id
    names the proposal, and its body holds the proposal's name, encrypted), or the proposal another write started. -/
inductive Proposal where
  | main
  | new
  | on (b : EditId)
  deriving DecidableEq, Repr

/-- A signer's own encryption key (a device's, or one derived from a passkey), one epoch of a key family, or the key of
    an entry in one of its stays (`none` for the stay its creation began, else the move that began it) at a generation
    of that stay's cell, derived from the cell's key of that generation. -/
inductive KeyName where
  | signer (s : SignerId)
  | scoped (k : KeyFam) (epoch : Nat)
  | entry  (e : EntryId) (stay : Option EditId) (gen : Nat)
  deriving DecidableEq, Repr

end AvenDB
