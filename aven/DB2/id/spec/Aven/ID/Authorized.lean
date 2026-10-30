import Aven.ID.Caps

/-! # Caps' verdict on an envelope (R4)

`chainOk` judges a chain of caps. A reader judges envelopes: `Aven.Core`'s signed units of change. This module is caps'
part of one reader verdict, which `Aven.Architecture` composes with the others: the envelope's signature (Core), its
cap chain and what it may touch (here), its footprint as the engine lowers it (`check_sound`), and its fit (docs).

The docs layer hands caps what an envelope carries inside its seal: the chain it rests on, root first, and its
footprint, the lowered steps. Caps reads them as parameters and never fixes how a body is laid out. The reader brings
what it knows: its context, which vault each signing key is a device of, the network's members, and what each Doc's
genesis fixed.

**Authorized:** the signing device acts within its device cap (rule 1), the chain keeps every rule, its last cap is held
by the vault whose device signed the envelope (that vault, its group, or the network's members for the public), its
branches let it write on the envelope's branch, and every step of the footprint is one the last cap allows on the
envelope's Doc. A device cap is a cap from the vault to its device: by default everything its vault may do except
govern, which a device added by a passkey sign-in holds, and narrower for an agent's devices and the Aven Peer.

**A merge into main** counts only when the merger's grant covers the whole merge (caps, "Checking"): every type and
field that differs between main's version at the merge's `prev` and what it makes, not the fixing commit's alone. The
engine computes that diff (`Aven.DB.Engine.merge_granted`, over `changesFrom` from main's Records); a reader that judges
a merge into main on it is `WholeMerges`, and `Aven.Architecture` joins the two.

The theorems:
- `authorized_signer`: the signer is a device of a vault that holds the last cap;
- `authorized_root`: every step is one the chain's root allows on that Doc, and every line the chain grants lies in
  the root issuer's authority, so no envelope writes on authority from nowhere;
- `branch_allowed`, `proposals_never_main`: every cap of the chain lets its holder write on the envelope's branch, so a
  cap for proposals, or for one branch, never writes on main: landing on main is someone else's merge;
- `merge_covered`: an authorized merge into main, read whole, has a last cap that writes on main and allows every step
  of the whole merge;
- `device_within_cap`, `device_and_chain`, `device_proposals_never_main`, `merge_within_device`: the signing device acts
  within its device cap, so every step is allowed both by the chain for its vault and by the device cap for the device;
  a device whose cap is for proposals, as an agent's removals go, never writes on main; and a merge into main read whole
  stays within the merging device's cap;
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

/-- A step a device cap lets its device write on a Doc. -/
def DeviceCap.allows (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop) (dc : DeviceCap) (f : Facts)
    (s : Step) : Prop :=
  match dc.grants with
  | none => True
  | some g => g.allows gov spawned f s

/-- What caps reads of an envelope, and what the reader knows. -/
structure Reader where
  ctx : Ctx
  /-- The caps an envelope rests on, root first, as the docs layer reads them inside its seal. -/
  chain : Envelope → List Cap
  /-- Its footprint: the steps the engine lowers it to; for a merge into main, the whole merge's (`WholeMerges`). -/
  footprint : Envelope → List Step
  /-- The vault a signing key is a device of, as the tree says. -/
  vaultOf : Bytes → Option String
  /-- The network's members, for public caps (D15). -/
  member : String → Bool
  /-- What a Doc's genesis fixed. -/
  facts : DocId → Option Facts
  /-- The device cap of the device whose key signs, as its vault holds it. -/
  deviceCap : Bytes → Option DeviceCap

/-- `v` holds `c`: it is `c`'s vault, in `c`'s group now, or, for the public, a member of the network. A ticket is
claimed by a vault before it writes. -/
def Reader.holdsAt (r : Reader) (c : Cap) (v : String) : Bool :=
  match c.holder with
  | .vault w => w == v
  | .group g => r.ctx.inGroup g v
  | .«public» => r.member v
  | .ticket _ => false

variable (r : Reader) (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop)

/-- The signing device acts within its device cap: the cap is from the vault the device serves, lets it write on the
envelope's branch, and allows every step of the footprint on the envelope's Doc. -/
def Reader.WithinDevice (e : Envelope) : Prop :=
  ∃ dc f, r.deviceCap e.signer = some dc ∧ r.vaultOf e.signer = some dc.vault ∧ dc.branches.allows e.branch = true ∧
    r.facts e.doc = some f ∧ ∀ s ∈ r.footprint e, dc.allows gov spawned f s

/-- Caps' verdict on an envelope. -/
def Reader.Authorized (e : Envelope) : Prop :=
  r.WithinDevice gov spawned e ∧ chainOk r.ctx (r.chain e) = true ∧
    ∃ last, (r.chain e).getLast? = some last ∧ (∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true) ∧
      last.conditions.branches.allows e.branch = true ∧
      ∃ f, r.facts e.doc = some f ∧ ∀ s ∈ r.footprint e, (last.grants r.ctx.roles).allows gov spawned f s

/-- The signer is a device of a vault that holds the chain's last cap. -/
theorem authorized_signer {e : Envelope} (h : r.Authorized gov spawned e) :
    ∃ last ∈ r.chain e, ∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true := by
  obtain ⟨_, _, last, hl, sv, _⟩ := h
  exact ⟨last, List.mem_of_getLast? hl, sv⟩

/-- No envelope writes on authority from nowhere: every step of it is one the chain's root allows on its Doc, and every
line the chain grants lies in the root issuer's authority. -/
theorem authorized_root {e : Envelope} (h : r.Authorized gov spawned e) :
    ∃ root rest f, r.chain e = root :: rest ∧ r.facts e.doc = some f ∧
      (∀ s ∈ r.footprint e, (root.grants r.ctx.roles).allows gov spawned f s) ∧
      ∀ c ∈ r.chain e, ∀ l ∈ c.grants r.ctx.roles, authorityOver r.ctx root.issuer l = true := by
  obtain ⟨_, ok, last, hl, _, _, f, hf, steps⟩ := h
  cases hc : r.chain e with
  | nil => simp [hc] at hl
  | cons root rest =>
    rw [hc] at ok hl
    have ml : last ∈ root :: rest := List.mem_of_getLast? hl
    refine ⟨root, rest, f, rfl, hf, fun s ms => narrow_steps gov spawned ok last ml f s (steps s ms), ?_⟩
    exact root_authority ok

/-- Every cap of an authorized chain lets its holder write on the envelope's branch: conditions narrow down a chain, so
the branches its last cap allows, every cap above it allows. -/
theorem branch_allowed {e : Envelope} (h : r.Authorized gov spawned e) :
    ∀ c ∈ r.chain e, c.conditions.branches.allows e.branch = true := by
  obtain ⟨_, ok, last, hl, _, br, _⟩ := h
  cases hc : r.chain e with
  | nil => simp [hc] at hl
  | cons root rest =>
    rw [hc] at ok hl
    rw [chainOk, chainRules, rules_all] at ok
    exact links_branch ok.2 hl br

/-- A cap for proposals, or for one branch, never writes on main: no envelope on main is authorized under a chain that
holds one. Landing a proposal on main is someone else's merge. -/
theorem proposals_never_main {e : Envelope} (main : e.branch = mainBranch) {c : Cap} (m : c ∈ r.chain e)
    (prop : c.conditions.branches = .proposals ∨ ∃ b, c.conditions.branches = .one b) :
    ¬ r.Authorized gov spawned e := by
  intro h
  have al := branch_allowed r gov spawned h c m
  rw [main] at al
  rcases prop with p | ⟨b, p⟩ <;> simp [p, Branches.allows] at al

/-- The reader judges a merge into main on the whole merge: its footprint of an envelope on main holds every step of
`whole`, the steps that make main's version at the envelope's `prev` into what the envelope makes (the engine's
`changesFrom` from main's Records), not the fixing commit's alone. -/
def Reader.WholeMerges (whole : Envelope → List Step) : Prop :=
  ∀ e, e.branch = mainBranch → ∀ s ∈ whole e, s ∈ r.footprint e

/-- **A merge into main counts only when the merger's grant covers the whole merge.** For a reader that judges merges
whole, an authorized envelope on main has a last cap that writes on main and allows every step of the whole merge on
its Doc; with the engine's `merge_granted`, that is every type and field the merge changes. -/
theorem merge_covered {whole : Envelope → List Step} (wm : r.WholeMerges whole) {e : Envelope}
    (main : e.branch = mainBranch) (h : r.Authorized gov spawned e) :
    ∃ last, (r.chain e).getLast? = some last ∧ last.conditions.branches.allows mainBranch = true ∧
      ∃ f, r.facts e.doc = some f ∧ ∀ s ∈ whole e, (last.grants r.ctx.roles).allows gov spawned f s := by
  obtain ⟨_, _, last, hl, _, br, f, hf, steps⟩ := h
  exact ⟨last, hl, main ▸ br, f, hf, fun s m => steps s (wm e main s m)⟩

/-- **A device acts within its device cap** (rule 1): the signing device of an authorized envelope holds a device cap
from the vault it serves, which lets it write on the envelope's branch and allows every step of its footprint. -/
theorem device_within_cap {e : Envelope} (h : r.Authorized gov spawned e) : r.WithinDevice gov spawned e := h.1

/-- Every step of an authorized envelope is allowed twice over: by the chain's last cap, for the vault, and by the
device cap, for the device. -/
theorem device_and_chain {e : Envelope} (h : r.Authorized gov spawned e) :
    ∃ dc last f, r.deviceCap e.signer = some dc ∧ (r.chain e).getLast? = some last ∧ r.facts e.doc = some f ∧
      ∀ s ∈ r.footprint e, dc.allows gov spawned f s ∧ (last.grants r.ctx.roles).allows gov spawned f s := by
  obtain ⟨⟨dc, f, hd, _, _, hf, dsteps⟩, _, last, hl, _, _, f', hf', steps⟩ := h
  rw [hf] at hf'
  cases hf'
  exact ⟨dc, last, f, hd, hl, hf, fun s m => ⟨dsteps s m, steps s m⟩⟩

/-- A device whose cap is for proposals, or for one branch, never writes on main, whatever chain it names: an agent's
removals go to proposals, and landing them on main is someone else's merge. -/
theorem device_proposals_never_main {e : Envelope} (main : e.branch = mainBranch) {dc : DeviceCap}
    (hd : r.deviceCap e.signer = some dc) (prop : dc.branches = .proposals ∨ ∃ b, dc.branches = .one b) :
    ¬ r.Authorized gov spawned e := by
  intro h
  obtain ⟨dc', _, hd', _, br, _⟩ := device_within_cap r gov spawned h
  rw [hd] at hd'
  cases hd'
  rw [main] at br
  rcases prop with p | ⟨b, p⟩ <;> simp [p, Branches.allows] at br

/-- A merge into main, read whole, stays within the merging device's cap: it writes on main and allows every step of
the whole merge. -/
theorem merge_within_device {whole : Envelope → List Step} (wm : r.WholeMerges whole) {e : Envelope}
    (main : e.branch = mainBranch) (h : r.Authorized gov spawned e) :
    ∃ dc f, r.deviceCap e.signer = some dc ∧ dc.branches.allows mainBranch = true ∧ r.facts e.doc = some f ∧
      ∀ s ∈ whole e, dc.allows gov spawned f s := by
  obtain ⟨dc, f, hd, _, br, hf, steps⟩ := device_within_cap r gov spawned h
  exact ⟨dc, f, hd, main ▸ br, hf, fun s m => steps s (wm e main s m)⟩

/-- One reader verdict: signed, fresh, authorized, live and fit. The other parts are the other layers'. -/
def Reader.Verdict (signed fresh live fit : Envelope → Prop) (e : Envelope) : Prop :=
  signed e ∧ fresh e ∧ r.Authorized gov spawned e ∧ live e ∧ fit e

/-- An envelope counts exactly when everything in its past is signed, fresh, authorized, live and fit, and none of it is
half of a split. -/
theorem counts_iff (nm : Envelope → Hash) (signed fresh live fit : Envelope → Prop) (S : List Envelope)
    (e : Envelope) :
    Counts nm (r.Verdict gov spawned signed fresh live fit) S e ↔
      ∀ x, Reaches nm S e x → (signed x ∧ fresh x ∧ r.Authorized gov spawned x ∧ live x ∧ fit x) ∧
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
