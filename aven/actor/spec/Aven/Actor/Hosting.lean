import Aven.Actor.Runtimes

/-!
# Hosting an actor is an explicit read cap (avenDB A16)

An actor lives on one peer, its home; a member's own Peer is the default. A peer that hosts an actor for someone
else, the Aven Peer included, reads nothing by hosting it. It reads only what its **hosting caps** grant: each names
one host, one actor, and one target, the actor itself or one of the actor's loads, and is granted by the actor's
owner, so the owner's list of them is exactly what the owner is shown.

The model takes from avenID and the engine what it doesn't decide: `gov` and `spawned` for targets (`Aven.Core`),
`ownerOf` (the vault that owns an actor) and `loads` (the targets an actor's definition loads).

What it proves:

- `hosting_explicit`: a host reads a Doc exactly when one of its hosting caps, valid and shown to the actor's owner,
  covers it.
- `no_hosting_without_cap`: a host with no hosting cap reads nothing, whatever it hosts.
- `per_target`: a cap for one load reads only what that load's target covers, never another load of the same actor.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes DocId Target Facts)

/-- One hosting cap: `owner` lets `host` read `target`, for the actor `actor`. -/
structure HostCap where
  owner : Bytes
  host : Bytes
  actor : DocId
  target : Target
  deriving DecidableEq, Repr

/-- What the model takes from avenID and the engine. -/
structure World where
  gov : Bytes → Bytes → Prop
  spawned : DocId → DocId → Prop
  /-- The vault that owns each actor. -/
  ownerOf : DocId → Bytes
  /-- The targets each actor's definition loads. -/
  loads : DocId → List Target

/-- A cap counts only when the actor's owner granted it, and its target is the actor itself or one of its loads. -/
def HostCap.valid (w : World) (c : HostCap) : Prop :=
  c.owner = w.ownerOf c.actor ∧ (c.target = .actor c.actor false ∨ c.target ∈ w.loads c.actor)

/-- What an owner is shown: every cap granted in its name. -/
def shownTo (caps : List HostCap) (owner : Bytes) : List HostCap := caps.filter (·.owner == owner)

/-- What a host may read: a Doc some valid hosting cap of that host covers. This is the only way a host reads; where
an actor lives (`home`) is not an argument, so hosting alone grants nothing. -/
def HostReads (w : World) (caps : List HostCap) (host : Bytes) (f : Facts) : Prop :=
  ∃ c ∈ caps, c.host = host ∧ c.valid w ∧ c.target.covers w.gov w.spawned f

/-- A host reads a Doc exactly when a valid hosting cap of its own covers it, and that cap is one its actor's owner
is shown. -/
theorem hosting_explicit (w : World) (caps : List HostCap) (host : Bytes) (f : Facts) :
    HostReads w caps host f ↔
      ∃ c ∈ shownTo caps (w.ownerOf c.actor), c.host = host ∧ c.valid w ∧ c.target.covers w.gov w.spawned f := by
  constructor
  · rintro ⟨c, hc, hh, hv, hcov⟩
    refine ⟨c, ?_, hh, hv, hcov⟩
    simp only [shownTo, List.mem_filter, beq_iff_eq]
    exact ⟨hc, hv.1⟩
  · rintro ⟨c, hc, hh, hv, hcov⟩
    exact ⟨c, (List.mem_filter.mp hc).1, hh, hv, hcov⟩

/-- A host with no hosting cap reads nothing, whatever actors it hosts. -/
theorem no_hosting_without_cap (w : World) (caps : List HostCap) (host : Bytes)
    (hnone : ∀ c ∈ caps, c.host ≠ host) (f : Facts) : ¬ HostReads w caps host f := by
  rintro ⟨c, hc, hh, -, -⟩
  exact hnone c hc hh

/-- With one cap for one load, the host reads only what that load covers, not the actor's other loads. -/
theorem per_target (w : World) (c : HostCap) (f : Facts) :
    HostReads w [c] c.host f → c.target.covers w.gov w.spawned f := by
  rintro ⟨c', hc', -, -, hcov⟩
  simp only [List.mem_singleton] at hc'
  subst hc'
  exact hcov

/-- A cap that names a target the actor doesn't load, or that someone other than the owner granted, reads nothing. -/
theorem invalid_cap_reads_nothing (w : World) (c : HostCap) (hv : ¬ c.valid w) (f : Facts) :
    ¬ HostReads w [c] c.host f := by
  rintro ⟨c', hc', -, hv', -⟩
  simp only [List.mem_singleton] at hc'
  subst hc'
  exact hv hv'

end Aven.Actor
