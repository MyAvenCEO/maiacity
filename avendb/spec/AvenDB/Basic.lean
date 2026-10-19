/-!
# Basic notions

Every id stands for a hash or a public key: a signer's id is its public key, a vault's id is the hash of its
genesis, an edit's id and a share's id are the hashes of their bytes, an entry's id is 32 random bytes its creator
draws, a blob's (a schema's or a lens's) the hash of its bytes, a type or a tag a short name. The model uses `Nat` for
all of them. That they never collide is the "hashes don't collide" assumption; the theorems that need it say so in a
hypothesis.
-/

namespace AvenDB

abbrev SignerId := Nat
abbrev VaultId  := Nat
abbrev EntryId  := Nat
abbrev ShareId  := Nat
abbrev EditId   := Nat
abbrev BlobId   := Nat
/-- A file, by its root: the hash iroh names its sealed pieces by (`docs/ARCHITECTURE.md` §13). -/
abbrev FileId   := Nat
/-- A type (`note`, `todo`, …) or a tag: a short name. -/
abbrev Sym      := Nat

/-- A vault is an identity, like a smart account, of one of four kinds. What each kind may be is one table
    (`Kind.rules`), which every rule about kinds reads. -/
inductive Kind where
  /-- A person's vault: owned by their passkeys, with their phones, computers, browsers and drives as its devices. -/
  | human
  /-- A group's vault: owned by human and coop vaults. It has no devices, and acts through its owners. -/
  | coop
  /-- A coop's AI identity: owned by one coop alone, and a coop owns one at most. It lives on its server, its
      device, which acts for it but never governs it; its coop's owners act for it through the coop. It owns nothing:
      an agent session reaches it through its server, with the rights it holds, never as a vault of its own. -/
  | aven
  /-- A vault for devices: owned by one human or coop vault, which governs it. Its devices (a studio worker, a
      drive) act for it but never govern it, and it owns nothing. -/
  | deviceVault
  deriving DecidableEq, Repr

/-- Who may own a vault of a kind: signers (a person's passkeys), or vaults of the kinds listed. -/
inductive OwnedBy where
  | signers
  | vaults (ks : List Kind)
  deriving DecidableEq, Repr

/-- Signers own a vault of the kind. -/
def OwnedBy.bySigners : OwnedBy → Bool
  | .signers  => true
  | .vaults _ => false

/-- A vault of kind `k` may own a vault of the kind. -/
def OwnedBy.byKind (o : OwnedBy) (k : Kind) : Bool :=
  match o with
  | .signers   => false
  | .vaults ks => ks.contains k

/-- What a vault of one kind may be: who may own it (`ownedBy`), how many owners it takes at most (`most`, `none` for
    any number), whether it has devices (`devices`), which act for it but never govern it, and how many vaults of the
    kind one owner may own (`each`, `none` for any number). -/
structure KindRules where
  ownedBy : OwnedBy
  most    : Option Nat
  devices : Bool
  each    : Option Nat
  deriving DecidableEq, Repr

/-- The one table of vault kinds, which every rule about kinds reads (`ownerFits`, `Kind.hasDevices`, `roomFor`), the
    Rust core's `Kind::rules` mirrors and the page reads (the `kinds` op). A human vault is owned by signers and has
    devices. A coop is owned by human and coop vaults, and has none. An aven is owned by one coop alone, a coop owning
    one at most, and has devices, its server (one aven per coop, none per person, and the aven lives on its server). A
    device vault is owned by one human or coop vault, and has devices. No kind lists a device vault or an aven among its
    owners, so neither owns anything: an agent reaches an aven through its server, never as a vault of its own. -/
def Kind.rules : Kind → KindRules
  | .human       => ⟨.signers, none, true, none⟩
  | .coop        => ⟨.vaults [.human, .coop], none, false, none⟩
  | .aven        => ⟨.vaults [.coop], some 1, true, some 1⟩
  | .deviceVault => ⟨.vaults [.human, .coop], some 1, true, none⟩

/-- A vault of the kind may have `n` owners. -/
def KindRules.takes (r : KindRules) (n : Nat) : Bool := r.most.all (n ≤ ·)

/-- Who can own a vault: signers own human vaults, vaults own the other kinds (`Kind.rules`). -/
inductive Principal where
  | signer (s : SignerId)
  | vault  (v : VaultId)
  deriving DecidableEq, Repr

/-- How a device keeps what a keep share picks: it syncs the entries and keeps the files they bring whole (`whole`),
    syncs them and fetches a file's pieces as it reads them (`opened`), or doesn't sync them at all (`never`). -/
inductive KeepMode where
  | whole
  | opened
  | never
  deriving DecidableEq, Repr

/-- keep < relay < backup < read < write < owner, in the order of their rank. Keep grants nothing: a keep share only
    says what one device of its issuer syncs, and how (`KeepMode`). Relay only learns the vault's devices, from its log,
    so that a server lets them through and helps them find each other: it receives none of the slice's edits. Backup
    may hold and pass on the encrypted edits of a slice but gets no key for it: that is the server's level by default.
    Owner also shares the slice on and is governance. -/
inductive Level where
  | keep (m : KeepMode)
  | relay
  | backup
  | read
  | write
  | owner
  deriving DecidableEq, Repr

/-- A level's rank, which is also its byte on the wire (a keep share's mode follows it there). -/
def Level.rank : Level → Nat
  | .keep _ => 0
  | .relay  => 1
  | .backup => 2
  | .read   => 3
  | .write  => 4
  | .owner  => 5

/-- A share with level `r` allows what `need` allows. -/
def Level.allows (r need : Level) : Bool := decide (need.rank ≤ r.rank)

/-- The level of a keep share, of any mode. -/
def Level.isKeep : Level → Bool
  | .keep _ => true
  | _ => false

/-- A keep share's mode, `none` for any other level. -/
def Level.mode? : Level → Option KeepMode
  | .keep m => some m
  | _ => none

/-- Whom a share names: a vault, everyone, a device, or an invite key. Only a keep share names a device, one of its
    issuer's (T4). An invite key is a one-time signer key its inviter makes and hands on with the invite: until a vault
    claims the share with it (`Action.claim`), nobody holds the share, and from then on it names that vault. -/
inductive Who where
  | vault    (v : VaultId)
  | everyone
  | device   (d : SignerId)
  | invite   (k : SignerId)
  deriving DecidableEq, Repr

/-- The device a share names, if it names one. -/
def Who.device? : Who → Option SignerId
  | .device d => some d
  | _ => none

/-- A share names a device. -/
def Who.isDevice (w : Who) : Bool := w.device?.isSome

/-- The invite key a share names, if it names one. -/
def Who.invite? : Who → Option SignerId
  | .invite k => some k
  | _ => none

/-! ## Slices

A share selects a slice of its vault's entries by what their first write says of them (their type, the vault that
created them, their id, when they were created) and by their tags now. Groups of entries are never named: a slice is
whatever a selector picks, and the audiences (`State.lean`) are whatever shares pick alike. -/

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

/-- The whole vault, or the entries that pass every test of at least one of the conjunctions. The wire shares a selector
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

/-- What an entry's first write says of it, which never changes: its type, when it was created (as its creator says),
    and the hash of the content it starts with (`blob`), which for a schema or a lens entry is the schema or lens it
    holds (`laneOf`). It travels inside the write's encrypted body, so no relay sees it. -/
structure Header where
  type    : Sym
  created : Nat
  blob    : BlobId
  deriving DecidableEq, Repr

/-! ## Audiences and keys -/

/-- An audience of a vault: the shares that select its entries, as the sorted list of their ids (its signature). On the
    wire an audience is named by the hash of its vault and its signature. -/
abbrev Audience := List ShareId

/-- A family of keys that rotates through epochs (a seed's and an audience's are called epochs): a vault's seed, whose
    key pair is the vault's key and from which its master key is derived; the key of a share with read or more; an
    audience's key. -/
inductive KeyFam where
  | seed     (v : VaultId)
  | share    (v : VaultId) (c : ShareId)
  | audience (v : VaultId) (x : Audience)
  deriving DecidableEq, Repr

/-- The line of an entry's history a write extends: the main line, a new proposal that the write starts (the write's id
    names the proposal, and its body holds the proposal's name, encrypted), or the proposal another write started. -/
inductive Proposal where
  | main
  | new
  | on (b : EditId)
  deriving DecidableEq, Repr

/-- A signer's own encryption key (a device's, or one derived from a passkey), one epoch of a key family, or the key of
    an entry in one of its stays (`none` for the stay its creation began, else the move that began it) at an epoch
    of that stay's audience, derived from the audience's key of that epoch. -/
inductive KeyName where
  | signer (s : SignerId)
  | scoped (k : KeyFam) (epoch : Nat)
  | entry  (e : EntryId) (stay : Option EditId) (epoch : Nat)
  deriving DecidableEq, Repr

end AvenDB
