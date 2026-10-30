import Aven.Actor.Runtimes
import Aven.ID.Caps

/-!
# Hosting an actor is an explicit read cap (avenDB A16)

An actor lives on one peer, its home; a member's own Peer is the default. A peer that hosts an actor for someone
else, the Aven Peer included, reads nothing by hosting it. It reads only what its **hosting caps** grant. A hosting
cap is one of avenID's caps (`Aven.ID.Cap`), not a kind of its own: its issuer is the actor's owner, its holder is the
host, and every line of its grant reads, on the actor itself or on one of the actor's loads. The owner's list of
the caps it issued is exactly what it is shown.

The model takes what it doesn't decide as parameters: who governs whom and which actor spawned which (as
`Aven.Core` does), the roles caps name, the vault that owns each actor, and the targets each actor loads.

What it proves:

- `hosting_explicit`: a host reads a Doc exactly when one of its hosting caps, issued by the actor's owner and shown
  to it, reaches the Doc with `read`.
- `no_hosting_without_cap`: a host that holds no cap reads nothing, whatever it hosts.
- `per_target`: a hosting cap with one line reads only what that line's target covers.
- `invalid_cap_reads_nothing`: a cap that is no hosting cap (another issuer, another holder, a verb other than
  `read`, or a target the actor doesn't load) reads nothing.
-/

namespace Aven.Actor

open Aven.Core (Bytes DocId Target Facts Verb)
open Aven.ID (Cap Holder Role Line)

/-- What the model takes from avenID and the engine. -/
structure World where
  gov : Bytes → Bytes → Prop
  spawned : DocId → DocId → Prop
  roles : List Role
  /-- The vault that owns each actor. -/
  ownerOf : DocId → String
  /-- The targets each actor's definition loads. -/
  loads : DocId → List Target

/-- `c` hosts actor `a` on `host`: issued by `a`'s owner, held by the host, and every line of it reads `a` itself or
one of `a`'s loads. -/
def Hosting (w : World) (c : Cap) (host : String) (a : DocId) : Prop :=
  c.issuer = w.ownerOf a ∧ c.holder = .vault host ∧
    ∀ l ∈ c.grants w.roles, l.verb = .read ∧ (l.target = .actor a false ∨ l.target ∈ w.loads a)

/-- What an owner is shown: every cap it issued. -/
def shownTo (caps : List Cap) (owner : String) : List Cap := caps.filter (·.issuer == owner)

/-- What a host may read: a Doc some hosting cap of that host reaches with `read`. This is the only way a host reads;
where an actor lives is not an argument, so hosting alone grants nothing. -/
def HostReads (w : World) (caps : List Cap) (host : String) (f : Facts) : Prop :=
  ∃ c ∈ caps, ∃ a, Hosting w c host a ∧ (c.grants w.roles).reaches w.gov w.spawned f .read

/-- A host reads a Doc exactly when a hosting cap of its own reaches it with `read`, and that cap is one the actor's
owner is shown. -/
theorem hosting_explicit (w : World) (caps : List Cap) (host : String) (f : Facts) :
    HostReads w caps host f ↔ ∃ a, ∃ c ∈ shownTo caps (w.ownerOf a),
      Hosting w c host a ∧ (c.grants w.roles).reaches w.gov w.spawned f .read := by
  constructor
  · rintro ⟨c, hc, a, hh, hr⟩
    refine ⟨a, c, ?_, hh, hr⟩
    simp only [shownTo, List.mem_filter, beq_iff_eq]
    exact ⟨hc, hh.1⟩
  · rintro ⟨a, c, hc, hh, hr⟩
    exact ⟨c, (List.mem_filter.mp hc).1, a, hh, hr⟩

/-- A host that holds no cap reads nothing, whatever actors it hosts. -/
theorem no_hosting_without_cap (w : World) (caps : List Cap) (host : String)
    (hnone : ∀ c ∈ caps, c.holder ≠ .vault host) (f : Facts) : ¬ HostReads w caps host f := by
  rintro ⟨c, hc, a, hh, -⟩
  exact hnone c hc hh.2.1

/-- A hosting cap with one line reads only what that line's target covers: one load's cap is not another's. -/
theorem per_target (w : World) (c : Cap) (host : String) (l : Line) (hl : c.grants w.roles = [l]) (f : Facts) :
    HostReads w [c] host f → l.target.covers w.gov w.spawned f := by
  rintro ⟨c', hc', -, -, hr⟩
  simp only [List.mem_singleton] at hc'
  subst hc'
  obtain ⟨l', hl', -, hcov⟩ := hr
  rw [hl, List.mem_singleton] at hl'
  subst hl'
  exact hcov

/-- A cap that hosts no actor on the host reads nothing there. -/
theorem invalid_cap_reads_nothing (w : World) (c : Cap) (host : String) (hv : ∀ a, ¬ Hosting w c host a)
    (f : Facts) : ¬ HostReads w [c] host f := by
  rintro ⟨c', hc', a, hh, -⟩
  simp only [List.mem_singleton] at hc'
  subst hc'
  exact hv a hh

end Aven.Actor
