import Aven.ID.Caps

/-! # Caps' verdict on an envelope (R4)

`chainOk` judges a chain of caps. A reader judges envelopes: `Aven.Core`'s signed units of change. This module is caps'
part of one reader verdict, which `Aven.Architecture` composes with the others: the envelope's signature (Core), its
cap chain and what it may touch (here), its footprint as the engine lowers it (`check_sound`), and its fit (docs).

The docs layer hands caps what an envelope carries inside its seal: the chain it rests on, root first, and its
footprint, the lowered steps. Caps reads them as parameters and never fixes how a body is laid out. The reader brings
what it knows: its context, which vault each signing key is a device of, the network's members, and what each Doc's
genesis fixed.

**Authorized:** the chain keeps every rule, its last cap is held by the vault whose device signed the envelope (that
vault, its group, or the network's members for the public), and every step of the footprint is one the last cap allows
on the envelope's Doc.

The theorems:
- `authorized_signer`: the signer is a device of a vault that holds the last cap;
- `authorized_root`: every step is one the chain's root allows on that Doc, and every line the chain grants lies in
  the root issuer's authority, so no envelope writes on authority from nowhere;
- `counts_iff`: an envelope counts exactly when everything in its past is signed, fresh, authorized, live and fit, and
  none of it is half of a split (the docs layer's rule 13, over Core's `Counts`);
- `readers_agree`: two readers that hold the same past of an envelope, and the same splits in it, give it the same
  verdict, whatever else each holds. -/

namespace Aven.ID

open Aven.Core

/-- What caps reads of an envelope, and what the reader knows. -/
structure Reader where
  ctx : Ctx
  /-- The caps an envelope rests on, root first, as the docs layer reads them inside its seal. -/
  chain : Envelope → List Cap
  /-- Its footprint: the steps the engine lowers it to. -/
  footprint : Envelope → List Step
  /-- The vault a signing key is a device of, as the tree says. -/
  vaultOf : Bytes → Option String
  /-- The network's members, for public caps (D15). -/
  member : String → Bool
  /-- What a Doc's genesis fixed. -/
  facts : DocId → Option Facts

/-- `v` holds `c`: it is `c`'s vault, in `c`'s group now, or, for the public, a member of the network. A ticket is
claimed by a vault before it writes. -/
def Reader.holdsAt (r : Reader) (c : Cap) (v : String) : Bool :=
  match c.holder with
  | .vault w => w == v
  | .group g => r.ctx.inGroup g v
  | .«public» => r.member v
  | .ticket _ => false

variable (r : Reader) (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop)

/-- Caps' verdict on an envelope. -/
def Reader.Authorized (e : Envelope) : Prop :=
  chainOk r.ctx (r.chain e) = true ∧
    ∃ last, (r.chain e).getLast? = some last ∧ (∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true) ∧
      ∃ f, r.facts e.doc = some f ∧ ∀ s ∈ r.footprint e, (last.grants r.ctx.roles).allows gov spawned f s

/-- The signer is a device of a vault that holds the chain's last cap. -/
theorem authorized_signer {e : Envelope} (h : r.Authorized gov spawned e) :
    ∃ last ∈ r.chain e, ∃ v, r.vaultOf e.signer = some v ∧ r.holdsAt last v = true := by
  obtain ⟨_, last, hl, sv, _⟩ := h
  exact ⟨last, List.mem_of_getLast? hl, sv⟩

/-- No envelope writes on authority from nowhere: every step of it is one the chain's root allows on its Doc, and every
line the chain grants lies in the root issuer's authority. -/
theorem authorized_root {e : Envelope} (h : r.Authorized gov spawned e) :
    ∃ root rest f, r.chain e = root :: rest ∧ r.facts e.doc = some f ∧
      (∀ s ∈ r.footprint e, (root.grants r.ctx.roles).allows gov spawned f s) ∧
      ∀ c ∈ r.chain e, ∀ l ∈ c.grants r.ctx.roles, authorityOver r.ctx root.issuer l = true := by
  obtain ⟨ok, last, hl, _, f, hf, steps⟩ := h
  cases hc : r.chain e with
  | nil => simp [hc] at hl
  | cons root rest =>
    rw [hc] at ok hl
    have ml : last ∈ root :: rest := List.mem_of_getLast? hl
    refine ⟨root, rest, f, rfl, hf, fun s ms => narrow_steps gov spawned ok last ml f s (steps s ms), ?_⟩
    exact root_authority ok

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
