import AvenDB.Sync
import AvenDB.Logs
import AvenDB.Proposals

/-!
# What the theorems talk about

The predicates and views the theorems in `Theorems.lean` are stated with, kept apart from their proofs so that the
statements read on their own.
-/

namespace AvenDB

/-- A state some peer can be in: the replay of some edits from the empty state. -/
def Reachable (st : State) : Prop := ∃ edits, st = replay {} edits

/-! ## Vaults -/

/-- Every vault has the shape of its kind: a human vault is owned by signers, its person's passkeys; a coop or an aven
    vault by human and coop vaults, never a signer; a coop has no devices; and only a human vault has a root. -/
def KindsFit (st : State) : Prop :=
  ∀ v vt, st.vault? v = some vt → (∀ p ∈ vt.owners, ownerFits st vt.kind p = true) ∧
    (vt.devices ≠ [] → vt.kind.hasDevices = true) ∧ (vt.root ≠ none → vt.kind = .human)

/-- `OwnsPlus st a x`: vault `a` owns vault `x`, directly or through a chain. -/
inductive OwnsPlus (st : State) : VaultId → VaultId → Prop where
  | direct {a x : VaultId} {vt : Vault} : st.vault? x = some vt → Principal.vault a ∈ vt.owners → OwnsPlus st a x
  | trans {a b x : VaultId} : OwnsPlus st a b → OwnsPlus st b x → OwnsPlus st a x

def Acyclic (st : State) : Prop := ∀ v, ¬ OwnsPlus st v v

/-- Every vault some vault lists as an owner exists. Genesis and addOwner only ever name existing vaults, and no edit
    removes a vault, so this holds in every reachable state. -/
def OwnersExist (st : State) : Prop :=
  ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome

/-! ## Caps -/

def CapsNameVaults (st : State) : Prop := ∀ c ∈ st.caps, ∀ s, c.grantee ≠ .principal (.signer s)

def PublicReadOnly (st : State) : Prop := ∀ c ∈ st.caps, c.grantee = .«public» → c.role = .read

/-! ## Writes -/

/-- Every accepted write's dependencies are accepted writes of its own entry. -/
def CausallyClosed (st : State) : Prop :=
  ∀ w ∈ st.writes, ∀ d ∈ w.deps, ∃ x ∈ st.writes, x.edit = d ∧ x.entry = w.entry

/-- Readers count no write that builds on one they don't count. -/
def CountsClosed (st : State) : Prop := ∀ w ∈ st.writes, ∀ d ∈ w.deps, d ∈ st.uncounted → w.edit ∈ st.uncounted

/-! ## Ops

What every reader of an entry sees of the caps when it judges a write: each cap without its selector, which only the
readers of that cap open, and without its ops, but for the caps of the chain the write's proof names, whose ops the
proof opens. -/

/-- The caps whose ops a write's proof `p` opens: the chain of the cap it names. -/
def proofCaps (st : State) : Option CapId → List CapId
  | none => []
  | some p => (st.caps.filter (·.id == p)).flatMap fun c => (chain st c).map (·.id)

/-- A cap as every reader of an entry sees it, judging a write whose proof opens the ops of the caps `vis`. -/
def Cap.seen (vis : List CapId) (c : Cap) : Cap :=
  { c with select := .all, ops := if vis.contains c.id then c.ops else [] }

/-- A state as every reader of an entry sees it, judging a write whose proof opens the ops of the caps `vis`. -/
def State.seen (st : State) (vis : List CapId) : State := { st with caps := st.caps.map (Cap.seen vis) }

/-! ## Keys -/

/-- `h` may open the current key of `k` in `st`: it is entitled to it, or the family is public. -/
def MayOpen (st : State) (h : Holder) (k : KeyFam) : Prop :=
  h.entitled st k = true ∨ publicKey st k = true

/-- Over the history `sts`, holder `h` could read key family `k` at some point: it was entitled to `k` then, `k` was
    public then, or it was then entitled to the seed of a vault that could read `k` at some point of the history,
    before or after. Whoever joins a vault inherits what the vault could read. -/
inductive EverReads (sts : List State) : Holder → KeyFam → Prop where
  | entitled {h : Holder} {k : KeyFam} {st : State} : st ∈ sts → h.entitled st k = true → EverReads sts h k
  | «public» {h : Holder} {k : KeyFam} {st : State} : st ∈ sts → publicKey st k = true → EverReads sts h k
  | via {h : Holder} {v : VaultId} {k : KeyFam} {st : State} : st ∈ sts → h.entitled st (.seed v) = true →
      EverReads sts (.vault v) k → EverReads sts h k

/-- The vault a key family belongs to. -/
def KeyFam.vault : KeyFam → VaultId
  | .seed v | .cap v _ | .cell v _ => v

/-! ## Relays

A relay reads no selector, no type, no tag, no op and no record: it sees a cap without its selector and ops (only
its role, their class), and a write without its header, tags, proof, touches and whether it fits its schemas. What it
then works out of the edits is the operational part of the state. -/

/-- A cap as a relay sees it. -/
def Cap.blind (c : Cap) : Cap := { c with select := .all, ops := [] }

/-- An action as a relay sees it. -/
def Action.blind : Action → Action
  | .cap c via => .cap c.blind via
  | .write v e a s g deps p via create _ _ _ _ =>
    .write v e a s g deps p via (create.map fun (x, _) => (x, ⟨0, 0⟩)) {} none [] true
  | a => a

def Edit.blind (o : Edit) : Edit := { o with action := o.action.blind }

/-- The operational part of a state: all of it but what only readers see. -/
def State.ops (st : State) : State :=
  { st with caps := st.caps.map Cap.blind,
            entries := st.entries.map fun en => { en with attrs := ⟨0, 0, 0, 0, []⟩, admitted := false },
            uncounted := [] }

end AvenDB
