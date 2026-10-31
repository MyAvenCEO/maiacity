import Aven.ID.Caps

/-! # Caps' verdict on an envelope (R4)

`chainOk` judges a chain of caps. A reader judges envelopes: `Aven.Core`'s signed units of change. This module is caps'
part of one reader verdict, which `Aven.Architecture` composes with the others: the envelope's signature (Core), its
authority and the ops it may call (here), what it changed against the steps those ops lower to (the engine's
`footprint_steps`), and its fit (docs).

The docs layer hands caps what an envelope carries inside its seal: the chain it rests on, root first, and the call it
names, an op by its id and its parameters (A32). Caps reads them as parameters and never fixes how a body is laid out.
The reader brings what it knows: its context, which vault each signing key is a device of, the network's members, what
each Doc's genesis fixed, each device's cap, and the steps each call lowers to, as every reader computes them.

**Authorized** (caps, "Checking", step 7): the signing device acts within its device cap (rule 1), and the envelope
writes on its vault's own authority or under a chain.
- **Own authority:** the signer's vault is the Doc's vault, or governs it. No chain is named: the most common write, an
  owner writing their own Docs.
- **A chain:** it keeps every rule, its last cap is held by the vault whose device signed the envelope (that vault, its
  group, or the network's members for the public), its branches let it write on the envelope's branch, and it allows
  every call the envelope makes on its Doc: the op listed, the Doc covered, the parameters within its bounds.

A device cap is a cap from the vault to its device: by default everything its vault may do except govern, which a
device added by a passkey sign-in holds, and narrower for an agent's devices and the Aven Peer.

**An actor host** (A27, Samuel, 31 Oct 2026) signs every write of the actors it hosts with one device of its own, a
narrow device vault whose cap is the union of its hosted actors' standing caps: the outer bound. A host device never
writes on its vault's own authority, only under the chain the acting actor's message carried, and each envelope it
signs names that actor. So each actor is bounded by its own chain, and the host by its device cap.

**A merge into main** counts only when the merger's grant covers the whole merge (caps, "Checking"): every call the
merge brings onto main, not the fixing commit's alone. The engine holds what changes to the steps those calls lower to,
over the whole merge (`Aven.DB.Engine.merge_steps`, over `changesFrom` from main's Records at the merge's `prev`); a
reader that judges a merge into main on its whole calls is `WholeMerges`, and `Aven.Architecture` joins the two.

The theorems:
- `own_authorized`, `chain_authorized`, `authorized_by`: a device of the Doc's vault, or of a vault that governs it,
  acting within its device cap, is authorized without a chain (an actor host's never is); a write under a chain is,
  within the device cap; and every authorized envelope takes one of the two paths;
- `authorized_vault`: on either path, the signer is a device of a vault that is the Doc's vault, governs it, or holds
  the last cap of the chain it names, so no envelope writes on authority from nowhere;
- `chain_signer`: under a chain, the signer is a device of a vault that holds the last cap;
- `chain_root`: under a chain, every call is one the chain's root allows on that Doc, and every line the chain grants
  lies in the root issuer's authority, so no envelope writes on authority from nowhere;
- `chain_writes_nothing`: under a chain whose last cap names only ops that lower to no step, read, tell, keep or share,
  an envelope has no step to write (A2);
- `branch_allowed`, `proposals_never_main`: every cap of a chain lets its holder write on the envelope's branch, so a
  chain holding a cap for proposals, or for one branch, never writes on main: landing on main is someone else's merge;
- `merge_covered`: a merge into main under a chain, read whole, has a last cap that writes on main and allows every
  call of the whole merge;
- `device_within_cap`, `device_and_chain`, `device_proposals_never_main`, `merge_within_device`: the signing device acts
  within its device cap, on either path, so under a chain every call is allowed both by the chain for its vault and by
  the device cap for the device; a device whose cap is for proposals, as an agent's removals go, never writes on main;
  and a merge into main read whole stays within the merging device's cap;
- `host_chain_only`, `actor_within_device`, `host_never_beyond`: an authorized envelope a host signed rests on a chain
  and names its actor; it stays within the host's device cap; and every call is allowed both by the chain the actor's
  message carried and by that outer bound (A27);
- `counts_iff`: an envelope counts exactly when everything in its past is signed, fresh, authorized, live and fit, and
  none of it is half of a split (the docs layer's rule 13, over Core's `Counts`);
- `readers_agree`: two readers that hold the same past of an envelope, and the same splits in it, give it the same
  verdict, whatever else each holds. -/

namespace Aven.ID

open Aven.Core

/-- A device cap: what a device may do for the vault it serves, a cap from that vault to the device's own vault (caps,
"Holders"). `grants` none is everything its vault may do except govern, which a device added by a passkey sign-in
holds; an agent's devices and the Aven Peer hold narrower ones, and an agent's removals go to proposals. -/
structure DeviceCap where
  device : String
  vault : String
  grants : Option Grant := none
  branches : Branches := .any
  /-- An actor host's device (A27): a kernel's own device, its grants the union of its hosted actors' standing caps. -/
  host : Bool := false

/-- A call a device cap lets its device make on a Doc. With no grants listed, every call: governing is never an op,
since owners govern k of n and no cap and no device does (rule 2), so this never lets a device govern. -/
def DeviceCap.allows (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop) (dc : DeviceCap) (f : Facts)
    (c : Call) : Prop :=
  match dc.grants with
  | none => True
  | some g => g.allows gov spawned lists f c

/-- What caps reads of an envelope, and what the reader knows. -/
structure Reader where
  ctx : Ctx
  /-- The caps an envelope rests on, root first, as the docs layer reads them inside its seal; none on own authority. -/
  chain : Envelope → List Cap
  /-- The calls it makes: the op it names, with its parameters; for a merge into main, every call the whole merge brings
  onto main (`WholeMerges`). -/
  calls : Envelope → List Call
  /-- The steps a call lowers to, as every reader computes them (the engine's lowering, E1 to E3). -/
  lower : Call → List Step
  /-- The vault a signing key is a device of, as the tree says. -/
  vaultOf : Bytes → Option String
  /-- The network's members, for public caps (D15). -/
  member : String → Bool
  /-- What a Doc's genesis fixed. -/
  facts : DocId → Option Facts
  /-- The device cap of the device whose key signs, as its vault holds it. -/
  deviceCap : Bytes → Option DeviceCap
  /-- The acting actor an envelope names inside its seal, when an actor host signed it (A27). -/
  actorOf : Envelope → Option DocId

/-- `v` holds `c`: it is `c`'s vault, in `c`'s group now, or, for the public, a member of the network. A ticket is
claimed by a vault before it writes. -/
def Reader.holdsAt (r : Reader) (c : Cap) (v : String) : Bool :=
  match c.holder with
  | .vault w => w == v
  | .group g => r.ctx.inGroup g v
  | .«public» => r.member v
  | .ticket _ => false

/-- An envelope's footprint: the steps its calls lower to, which the engine checks what it changed against. -/
def Reader.footprint (r : Reader) (e : Envelope) : List Step := (r.calls e).flatMap r.lower

variable (r : Reader) (gov : Bytes → Bytes → Prop) (spawned lists : DocId → DocId → Prop)

/-- The signing device acts within its device cap: the cap is from the vault the device serves, lets it write on the
envelope's branch, and allows every call the envelope makes on its Doc. -/
def Reader.WithinDevice (e : Envelope) : Prop :=
  ∃ dc f, r.deviceCap e.signer = some dc ∧ r.vaultOf e.signer = some dc.vault ∧ dc.branches.allows e.branch = true ∧
    r.facts e.doc = some f ∧ ∀ c ∈ r.calls e, dc.allows gov spawned lists f c

/-- Its vault's own authority: the signer's vault is the Doc's vault, or governs it. -/
def Reader.Own (e : Envelope) : Prop :=
  ∃ v f, r.vaultOf e.signer = some v ∧ r.facts e.doc = some f ∧ (f.vault = vaultId v ∨ gov (vaultId v) f.vault)

/-- Under a chain: it keeps every rule, its last cap is held by the signer's vault, lets it write on the envelope's
branch, and allows every call the envelope makes on its Doc. -/
def Reader.ByChain (e : Envelope) : Prop :=
  chainOk r.ctx (r.chain e) = true ∧
    ∃ last, (r.chain e).getLast? = some last ∧ (∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true) ∧
      last.conditions.branches.allows e.branch = true ∧
      ∃ f, r.facts e.doc = some f ∧ ∀ c ∈ r.calls e, (last.grants r.ctx.roles).allows gov spawned lists f c

/-- An actor host's device signed it (A27). -/
def Reader.HostSigned (e : Envelope) : Prop :=
  ∃ dc, r.deviceCap e.signer = some dc ∧ dc.host = true

/-- Caps' verdict on an envelope: its device acts within its device cap, and it writes on its vault's own authority or
under a chain; an actor host's device only under a chain, naming the acting actor (A27). -/
def Reader.Authorized (e : Envelope) : Prop :=
  r.WithinDevice gov spawned lists e ∧
    ((r.Own gov e ∧ ¬ r.HostSigned e) ∨ (r.ByChain gov spawned lists e ∧ (r.HostSigned e → (r.actorOf e).isSome = true)))

/-- **An owner writes their own Docs without a chain** (checking, step 7): a device of the Doc's vault, or of a vault
that governs it, acting within its device cap, is authorized, unless it is an actor host's. -/
theorem own_authorized {e : Envelope} (o : r.Own gov e) (nh : ¬ r.HostSigned e) (wd : r.WithinDevice gov spawned lists e) :
    r.Authorized gov spawned lists e :=
  ⟨wd, .inl ⟨o, nh⟩⟩

/-- An authorized envelope writes on its vault's own authority or under a chain: the two paths, whatever else the
verdict asks of each. -/
theorem authorized_by {e : Envelope} (h : r.Authorized gov spawned lists e) : r.Own gov e ∨ r.ByChain gov spawned lists e :=
  h.2.imp (·.1) (·.1)

/-- A write under a chain its signer's vault holds, within the device cap, is authorized; an actor host's names its
actor. -/
theorem chain_authorized {e : Envelope} (c : r.ByChain gov spawned lists e)
    (named : r.HostSigned e → (r.actorOf e).isSome = true) (wd : r.WithinDevice gov spawned lists e) :
    r.Authorized gov spawned lists e :=
  ⟨wd, .inr ⟨c, named⟩⟩

/-- Under a chain, the signer is a device of a vault that holds the chain's last cap. -/
theorem chain_signer {e : Envelope} (h : r.ByChain gov spawned lists e) :
    ∃ last ∈ r.chain e, ∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true := by
  obtain ⟨_, last, hl, sv, _⟩ := h
  exact ⟨last, List.mem_of_getLast? hl, sv⟩

/-- No envelope writes on authority from nowhere, on either path: its signer is a device of a vault that is the Doc's
vault, governs it, or holds the last cap of the chain it names. -/
theorem authorized_vault {e : Envelope} (h : r.Authorized gov spawned lists e) :
    ∃ v, r.vaultOf e.signer = some v ∧
      ((∃ f, r.facts e.doc = some f ∧ (f.vault = vaultId v ∨ gov (vaultId v) f.vault)) ∨
        ∃ last ∈ r.chain e, r.holdsAt last v = true) := by
  rcases h.2 with ⟨⟨v, f, hv, hf, o⟩, _⟩ | ⟨c, _⟩
  · exact ⟨v, hv, .inl ⟨f, hf, o⟩⟩
  · obtain ⟨last, ml, v, hv, hl⟩ := chain_signer r gov spawned lists c
    exact ⟨v, hv, .inr ⟨last, ml, hl⟩⟩

/-- No envelope writes on authority from nowhere: under a chain, every call it makes is one the chain's root allows on
its Doc, and every line the chain grants lies in the root issuer's authority. -/
theorem chain_root {e : Envelope} (h : r.ByChain gov spawned lists e) :
    ∃ root rest f, r.chain e = root :: rest ∧ r.facts e.doc = some f ∧
      (∀ c ∈ r.calls e, (root.grants r.ctx.roles).allows gov spawned lists f c) ∧
      ∀ c ∈ r.chain e, ∀ l ∈ c.grants r.ctx.roles, authorityOver r.ctx root.issuer l = true := by
  obtain ⟨ok, last, hl, _, _, f, hf, calls⟩ := h
  cases hc : r.chain e with
  | nil => simp [hc] at hl
  | cons root rest =>
    rw [hc] at ok hl
    have ml : last ∈ root :: rest := List.mem_of_getLast? hl
    refine ⟨root, rest, f, rfl, hf, fun c mc => narrow_ops gov spawned lists ok last ml f c (calls c mc), ?_⟩
    exact root_authority ok

/-- **A chain that names no write writes nothing** (A2): under a chain whose last cap names only ops that lower to no
step, as `core/1`'s read, tell, keep and share do, the envelope's footprint is empty, so the engine's check lets it
change no Record. -/
theorem chain_writes_nothing {e : Envelope} (h : r.ByChain gov spawned lists e) {last : Cap}
    (hl : (r.chain e).getLast? = some last)
    (reads : ∀ l ∈ last.grants r.ctx.roles, ∀ c : Call, c.op = l.op → r.lower c = []) : r.footprint e = [] := by
  obtain ⟨_, last', hl', _, _, f, _, calls⟩ := h
  rw [hl] at hl'
  cases hl'
  simp only [Reader.footprint, List.flatMap_eq_nil_iff]
  exact fun c mc => no_step_without_write reads (calls c mc)

/-- Every cap of a chain an envelope rests on lets its holder write on the envelope's branch: conditions narrow down a
chain, so the branches its last cap allows, every cap above it allows. -/
theorem branch_allowed {e : Envelope} (h : r.ByChain gov spawned lists e) :
    ∀ c ∈ r.chain e, c.conditions.branches.allows e.branch = true := by
  obtain ⟨ok, last, hl, _, br, _⟩ := h
  cases hc : r.chain e with
  | nil => simp [hc] at hl
  | cons root rest =>
    rw [hc] at ok hl
    rw [chainOk, chainRules, rules_all] at ok
    exact links_branch ok.2 hl br

/-- A cap for proposals, or for one branch, never writes on main: no envelope on main rests on a chain that holds one.
Landing a proposal on main is someone else's merge. -/
theorem proposals_never_main {e : Envelope} (main : e.branch = mainBranch) {c : Cap} (m : c ∈ r.chain e)
    (prop : c.conditions.branches = .proposals ∨ ∃ b, c.conditions.branches = .one b) :
    ¬ r.ByChain gov spawned lists e := by
  intro h
  have al := branch_allowed r gov spawned lists h c m
  rw [main] at al
  rcases prop with p | ⟨b, p⟩ <;> simp [p, Branches.allows] at al

/-- The reader judges a merge into main on the whole merge: the calls it reads of an envelope on main hold every call
of `whole`, every call the merge brings onto main from main's version at the envelope's `prev`, not the fixing
commit's alone. -/
def Reader.WholeMerges (whole : Envelope → List Call) : Prop :=
  ∀ e, e.branch = mainBranch → ∀ c ∈ whole e, c ∈ r.calls e

/-- **A merge into main counts only when the merger's grant covers the whole merge.** For a reader that judges merges
whole, a merge into main under a chain has a last cap that writes on main and allows every call of the whole merge on
its Doc; with the engine's `merge_steps`, every Record the merge changes is made by the steps those calls lower to. On
own authority the device cap covers it (`merge_within_device`). -/
theorem merge_covered {whole : Envelope → List Call} (wm : r.WholeMerges whole) {e : Envelope}
    (main : e.branch = mainBranch) (h : r.ByChain gov spawned lists e) :
    ∃ last, (r.chain e).getLast? = some last ∧ last.conditions.branches.allows mainBranch = true ∧
      ∃ f, r.facts e.doc = some f ∧ ∀ c ∈ whole e, (last.grants r.ctx.roles).allows gov spawned lists f c := by
  obtain ⟨_, last, hl, _, br, f, hf, calls⟩ := h
  exact ⟨last, hl, main ▸ br, f, hf, fun c m => calls c (wm e main c m)⟩

/-- **A device acts within its device cap** (rule 1), on either path: the signing device of an authorized envelope
holds a device cap from the vault it serves, which lets it write on the envelope's branch and allows every call it
makes. -/
theorem device_within_cap {e : Envelope} (h : r.Authorized gov spawned lists e) : r.WithinDevice gov spawned lists e := h.1

/-- Under a chain, every call of an authorized envelope is allowed twice over: by the chain's last cap, for the vault,
and by the device cap, for the device. -/
theorem device_and_chain {e : Envelope} (h : r.Authorized gov spawned lists e) (c : r.ByChain gov spawned lists e) :
    ∃ dc last f, r.deviceCap e.signer = some dc ∧ (r.chain e).getLast? = some last ∧ r.facts e.doc = some f ∧
      ∀ x ∈ r.calls e, dc.allows gov spawned lists f x ∧ (last.grants r.ctx.roles).allows gov spawned lists f x := by
  obtain ⟨dc, f, hd, _, _, hf, dcalls⟩ := h.1
  obtain ⟨_, last, hl, _, _, f', hf', calls⟩ := c
  rw [hf] at hf'
  cases hf'
  exact ⟨dc, last, f, hd, hl, hf, fun x m => ⟨dcalls x m, calls x m⟩⟩

/-- A device whose cap is for proposals, or for one branch, never writes on main, on its vault's own authority or under
any chain: an agent's removals go to proposals, and landing them on main is someone else's merge. -/
theorem device_proposals_never_main {e : Envelope} (main : e.branch = mainBranch) {dc : DeviceCap}
    (hd : r.deviceCap e.signer = some dc) (prop : dc.branches = .proposals ∨ ∃ b, dc.branches = .one b) :
    ¬ r.Authorized gov spawned lists e := by
  intro h
  obtain ⟨dc', _, hd', _, br, _⟩ := device_within_cap r gov spawned lists h
  rw [hd] at hd'
  cases hd'
  rw [main] at br
  rcases prop with p | ⟨b, p⟩ <;> simp [p, Branches.allows] at br

/-- A merge into main, read whole, stays within the merging device's cap on either path: it writes on main and allows
every call of the whole merge. -/
theorem merge_within_device {whole : Envelope → List Call} (wm : r.WholeMerges whole) {e : Envelope}
    (main : e.branch = mainBranch) (h : r.Authorized gov spawned lists e) :
    ∃ dc f, r.deviceCap e.signer = some dc ∧ dc.branches.allows mainBranch = true ∧ r.facts e.doc = some f ∧
      ∀ c ∈ whole e, dc.allows gov spawned lists f c := by
  obtain ⟨dc, f, hd, _, br, hf, calls⟩ := device_within_cap r gov spawned lists h
  exact ⟨dc, f, hd, main ▸ br, hf, fun c m => calls c (wm e main c m)⟩

/-- **A host never writes on its vault's own authority** (A27): an authorized envelope an actor host's device signed
rests on a chain, the one the acting actor's message carried, and names that actor. -/
theorem host_chain_only {e : Envelope} (h : r.Authorized gov spawned lists e) (host : r.HostSigned e) :
    r.ByChain gov spawned lists e ∧ (r.actorOf e).isSome = true := by
  rcases h.2 with ⟨_, nh⟩ | ⟨c, named⟩
  · exact absurd host nh
  · exact ⟨c, named host⟩

/-- **An actor's write stays within its host's device cap** (A27): the host device's cap, the union of its hosted
actors' standing caps, allows every call of an authorized envelope it signed. -/
theorem actor_within_device {e : Envelope} (h : r.Authorized gov spawned lists e) (host : r.HostSigned e) :
    ∃ dc f, r.deviceCap e.signer = some dc ∧ dc.host = true ∧ r.facts e.doc = some f ∧
      ∀ c ∈ r.calls e, dc.allows gov spawned lists f c := by
  obtain ⟨dc, f, hd, _, _, hf, calls⟩ := device_within_cap r gov spawned lists h
  obtain ⟨dc', hd', ht⟩ := host
  rw [hd] at hd'
  cases hd'
  exact ⟨dc, f, hd, ht, hf, calls⟩

/-- **A host writes nothing its acting actor wasn't granted** (A27): an authorized envelope an actor host signed names
its actor, and every call of it is allowed both by the last cap of the chain the actor's message carried and by the
host's device cap, the outer bound. -/
theorem host_never_beyond {e : Envelope} (h : r.Authorized gov spawned lists e) (host : r.HostSigned e) :
    (r.actorOf e).isSome = true ∧ ∃ dc last f, r.deviceCap e.signer = some dc ∧ dc.host = true ∧
      (r.chain e).getLast? = some last ∧ r.facts e.doc = some f ∧
      ∀ c ∈ r.calls e, dc.allows gov spawned lists f c ∧ (last.grants r.ctx.roles).allows gov spawned lists f c := by
  obtain ⟨c, named⟩ := host_chain_only r gov spawned lists h host
  obtain ⟨dc, last, f, hd, hl, hf, calls⟩ := device_and_chain r gov spawned lists h c
  obtain ⟨dc', hd', ht⟩ := host
  rw [hd] at hd'
  cases hd'
  exact ⟨named, dc, last, f, hd, ht, hl, hf, calls⟩

/-- One reader verdict: signed, fresh, authorized, live and fit. The other parts are the other layers'. -/
def Reader.Verdict (signed fresh live fit : Envelope → Prop) (e : Envelope) : Prop :=
  signed e ∧ fresh e ∧ r.Authorized gov spawned lists e ∧ live e ∧ fit e

/-- An envelope counts exactly when everything in its past is signed, fresh, authorized, live and fit, and none of it is
half of a split. -/
theorem counts_iff (nm : Envelope → Hash) (signed fresh live fit : Envelope → Prop) (S : List Envelope)
    (e : Envelope) :
    Counts nm (r.Verdict gov spawned lists signed fresh live fit) S e ↔
      ∀ x, Reaches nm S e x → (signed x ∧ fresh x ∧ r.Authorized gov spawned lists x ∧ live x ∧ fit x) ∧
        ∀ y ∈ S, ¬ Split nm x y :=
  Iff.rfl

/-- Two readers that hold the same past of an envelope, and the same splits in it, give it the same verdict, whatever
else each holds: a verdict depends only on the envelope, its causal past and what the reader knows of revocations
(`live`). -/
theorem readers_agree (nm : Envelope → Hash) (ok : Envelope → Prop) {S S' : List Envelope} {e : Envelope}
    (past : ∀ x, Reaches nm S e x ↔ Reaches nm S' e x)
    (splits : ∀ x, Reaches nm S e x → ((∃ y ∈ S, Split nm x y) ↔ (∃ y ∈ S', Split nm x y))) :
    Counts nm ok S e ↔ Counts nm ok S' e := by
  constructor
  · intro h x hx
    have hx' := (past x).mpr hx
    refine ⟨(h x hx').1, fun y my sp => ?_⟩
    obtain ⟨z, mz, sz⟩ := (splits x hx').mpr ⟨y, my, sp⟩
    exact (h x hx').2 z mz sz
  · intro h x hx
    refine ⟨(h x ((past x).mp hx)).1, fun y my sp => ?_⟩
    obtain ⟨z, mz, sz⟩ := (splits x hx).mp ⟨y, my, sp⟩
    exact (h x ((past x).mp hx)).2 z mz sz

end Aven.ID
