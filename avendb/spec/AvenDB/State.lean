import AvenDB.Basic

/-!
# State

What a peer knows after replaying the ops it holds: vaults, spaces, grants, accepted writes, the key schedule
(current epochs, seals, published keys), and each space's schema lane. Everything here is executable, so the same
definitions that the theorems talk about also produce the test vectors the Rust core must match.
-/

namespace AvenDB

structure Vault where
  id        : VaultId
  kind      : Kind
  owners    : List Principal
  threshold : Nat
  /-- Device signers act for a human vault but don't govern it. -/
  devices   : List SignerId
  /-- A human vault's root: its passkey, named at genesis. It approves anything for its vault on its own, wins every
      clash with the other owners, and only it hands the root on. -/
  root      : Option SignerId
  deriving DecidableEq, Repr

structure Grant where
  id      : GrantId
  scope   : Scope
  role    : Role
  grantee : Grantee
  issuer  : VaultId
  /-- The owner grant the issuer relied on; `none` when the issuer founded the space. -/
  parent  : Option GrantId
  deriving DecidableEq, Repr

structure Space where
  id      : SpaceId
  founder : VaultId
  entries : List EntryId
  deriving DecidableEq, Repr

/-- An accepted edit: one encrypted Loro update to one entry. `deps` are the writes of the same entry it builds on
    (its Loro frontier when it was made): accepted writes stay causally closed (T14), so a write whose dependency
    is cut is cut too. -/
structure Write where
  op     : OpId
  author : SignerId
  actor  : VaultId
  space  : SpaceId
  entry  : EntryId
  epoch  : Nat
  deps   : List OpId
  deriving DecidableEq, Repr

/-- `secret` sealed to the key pair `to`: whoever can open `to` can open `secret`. -/
structure Seal where
  secret : KeyName
  to     : KeyName
  deriving DecidableEq, Repr

structure State where
  vaults    : List Vault := []
  spaces    : List Space := []
  grants    : List Grant := []
  writes    : List Write := []
  epochs    : List (KeyScope × Nat) := []
  seals     : List Seal := []
  published : List KeyName := []
  /-- The schema lane: the schemas and lenses published into each space, by their hash, in the order they came. -/
  lane      : List (SpaceId × BlobId) := []
  deriving Repr

namespace State

def vault? (st : State) (v : VaultId) : Option Vault := st.vaults.find? (·.id == v)
def space? (st : State) (sp : SpaceId) : Option Space := st.spaces.find? (·.id == sp)
def grant? (st : State) (g : GrantId) : Option Grant := st.grants.find? (·.id == g)
def founder? (st : State) (sp : SpaceId) : Option VaultId := (st.space? sp).map (·.founder)

def epochOf (st : State) (k : KeyScope) : Nat :=
  match st.epochs.find? (·.1 == k) with
  | some (_, e) => e
  | none => 0

def curKey (st : State) (k : KeyScope) : KeyName := .scoped k (st.epochOf k)

/-- A bound on chain length: without ownership cycles a chain never visits more vaults than exist. -/
def depth (st : State) : Nat := st.vaults.length + 1

end State

/-! ## Who acts, who approves, who owns -/

/-- Signer `s` acts for vault `v`: a device or owner signer of a human vault, or a signer that acts for an owner of
    a coop. `n` bounds the chain. -/
def actsForN (st : State) (s : SignerId) : Nat → VaultId → Bool
  | 0, _ => false
  | n + 1, v =>
    match st.vault? v with
    | none => false
    | some vt =>
      match vt.kind with
      | .human => vt.devices.contains s || vt.owners.contains (.signer s)
      | .coop  => vt.owners.any fun
        | .vault o  => actsForN st s n o
        | .signer _ => false

def actsFor (st : State) (s : SignerId) (v : VaultId) : Bool := actsForN st s st.depth v

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

/-- Vault `v` holds `r` on `sc`: it founded the space, or a grant to it covers `sc` with a role allowing `r`. -/
def holds (st : State) (v : VaultId) (sc : Scope) (r : Role) : Bool :=
  st.founder? sc.spaceOf == some v ||
  st.grants.any fun g => g.grantee == .principal (.vault v) && g.scope.covers sc && g.role.allows r

/-- Everyone may read `sc`. -/
def isPublic (st : State) (sc : Scope) : Bool :=
  st.grants.any fun g => g.grantee == .«public» && g.scope.covers sc

/-- A write is authorized in `st`: its author acts for its vault and that vault holds write on its entry. -/
def authorized (st : State) (w : Write) : Bool :=
  actsFor st w.author w.actor && holds st w.actor (.entry w.space w.entry) .write

/-! ## Keys -/

def KeyScope.scope? : KeyScope → Option Scope
  | .vault _    => none
  | .space sp   => some (.space sp)
  | .entry sp e => some (.entry sp e)

/-- The current key of `k` is published to everyone. -/
def publicKey (st : State) (k : KeyScope) : Bool :=
  match k.scope? with
  | some sc => isPublic st sc
  | none    => false

/-- Signer `d` should be able to open the current key of `k`. -/
def entitled (st : State) (d : SignerId) : KeyScope → Bool
  | .vault v    => actsFor st d v
  | .space sp   => st.vaults.any fun x => actsFor st d x.id && holds st x.id (.space sp) .read
  | .entry sp e => st.vaults.any fun x => actsFor st d x.id && holds st x.id (.entry sp e) .read

/-- Whoever holds the current key of vault `x` should be able to open the current key of `k`: `x` is that vault or
    one of its owners, or it reads `k` itself or through a coop it owns. -/
def entitledV (st : State) (x : VaultId) : KeyScope → Bool
  | .vault v    => x == v || owns st x v
  | .space sp   => st.vaults.any fun y => (x == y.id || owns st x y.id) && holds st y.id (.space sp) .read
  | .entry sp e => st.vaults.any fun y => (x == y.id || owns st x y.id) && holds st y.id (.entry sp e) .read

/-- What an agent holding the keys `start` can open: what is published, and whatever is sealed to a key it can
    open. This is the whole attacker model: no key is learned any other way (sealed and encrypted data reveal
    nothing without their key). -/
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

/-- Every key family that exists. -/
def keyScopes (st : State) : List KeyScope :=
  st.vaults.map (fun v => .vault v.id) ++
  st.spaces.flatMap fun s => .space s.id :: s.entries.map (.entry s.id)

/-- Every signer some vault lists. -/
def signers (st : State) : List SignerId :=
  st.vaults.flatMap fun v => v.devices ++ v.owners.filterMap fun
    | .signer s => some s
    | .vault _  => none

/-- Whoever starts out holding keys: a signer with its own key, whoever holds a vault's current key (its members, and
    in a coop the members of its owners), and everyone, who holds nothing but what is published. -/
inductive Holder where
  | signer (s : SignerId)
  | vault (v : VaultId)
  | everyone
  deriving DecidableEq, Repr

/-- The keys a holder starts out with. -/
def Holder.start (st : State) : Holder → List KeyName
  | .signer s => [.signer s]
  | .vault v  => [st.curKey (.vault v)]
  | .everyone => []

/-- The holder should be able to open the current key of `k`. -/
def Holder.entitled (st : State) : Holder → KeyScope → Bool
  | .signer s => AvenDB.entitled st s
  | .vault x  => entitledV st x
  | .everyone => publicKey st

/-- The holders that matter in `st`: every signer some vault lists, every vault, and everyone. -/
def holders (st : State) : List Holder :=
  (signers st).map .signer ++ st.vaults.map (fun v => .vault v.id) ++ [.everyone]

/-- The key pairs the current key of `k` is sealed to: a human vault's devices and owner signers (its passkeys,
    through keys derived from them), a coop's owner vaults, the vaults that can read a whole space, and for an entry
    its space plus the vaults that may read just that entry. Relay caps get no key. -/
def targets (st : State) : KeyScope → List KeyName
  | .vault v =>
    match st.vault? v with
    | none => []
    | some vt =>
      match vt.kind with
      | .human => (vt.devices ++ vt.owners.filterMap fun
          | .signer s => some s
          | .vault _  => none).map .signer
      | .coop  => vt.owners.filterMap fun
        | .vault o  => some (st.curKey (.vault o))
        | .signer _ => none
  | .space sp =>
    st.vaults.filterMap fun x =>
      if holds st x.id (.space sp) .read then some (st.curKey (.vault x.id)) else none
  | .entry sp e =>
    st.curKey (.space sp) :: st.vaults.filterMap fun x =>
      if st.grants.any (fun g => g.grantee == .principal (.vault x.id) && g.scope == .entry sp e && g.role.allows .read)
      then some (st.curKey (.vault x.id)) else none

/-- Key families whose current key some holder could open before a change but should no longer open after it, unless
    the family is public now. These start a new epoch. A family that stops being public is one: everyone held its
    key. So is a space a coop stops reading while each of its members still reads the space some other way: the
    coop's key would carry the space key to whoever joins the coop later. -/
def staleKeys (pre post : State) : List KeyScope :=
  let opened := (holders pre).map fun h => (h, opens pre (h.start pre))
  (keyScopes post).filter fun k =>
    !publicKey post k && opened.any fun (h, o) => o.contains (pre.curKey k) && !h.entitled post k

/-- Start a new epoch of `k`. The old key is sealed to the new one, so whoever may read now can read the history. -/
def bump (st : State) (k : KeyScope) : State :=
  let e := st.epochOf k
  { st with epochs := (k, e + 1) :: st.epochs.filter (·.1 != k),
            seals  := st.seals ++ [⟨.scoped k e, .scoped k (e + 1)⟩] }

def addSeal (st : State) (s : Seal) : State :=
  if st.seals.contains s then st else { st with seals := st.seals ++ [s] }

def publish (st : State) (k : KeyName) : State :=
  if st.published.contains k then st else { st with published := st.published ++ [k] }

/-- Seal every current key to each of its targets, and publish the public ones. -/
def sealAll (st : State) : State :=
  (keyScopes st).foldl (fun acc k =>
    let acc := (targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc
    if publicKey acc k then publish acc (acc.curKey k) else acc) st

/-- After an accepted change from `pre` to `post`: rotate what went stale, then seal and publish. -/
def settle (pre post : State) : State := sealAll ((staleKeys pre post).foldl bump post)

end AvenDB
