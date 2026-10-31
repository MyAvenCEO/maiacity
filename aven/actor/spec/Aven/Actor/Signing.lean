import Aven.Actor.Hosting

/-!
# How a host signs its actors' writes (Samuel, 31 Oct 2026)

Actors hold no keys. Every write an actor makes is signed by its host's one device, whose device cap is the union of
the hosted actors' standing caps: only the outer bound. What bounds each write is its own actor's chain:

- a host device writes only **by chain**, never as its vault's own (`Own`), so "the signer's vault owns the Doc"
  never lets a kernel write past an actor's grant;
- every envelope it signs **names the acting actor** and the chain the handled message carried, narrowed by at most
  one cap the actor adds (D16: a turn's effects carry the handled message's cap or a narrower one).

The device-cap half (`actor_within_device`, `host_never_beyond`) is avenID's, in `Aven.ID`. This is the actor half:

- `host_never_own`, `write_names_actor`: what the kernel signs is always by chain, and names its actor.
- `actor_within_chain`: when a reader accepts the write's chain, nothing in it reaches beyond the chain the handled
  message carried, by `Aven.ID.narrow_chain`. So an actor writes nothing its caller's authority doesn't reach: no
  confused deputy, and the host's device cap never widens it.
-/

namespace Aven.Actor

open Aven.Core (Bytes DocId Facts Verb)
open Aven.ID (Cap Ctx chainOk narrow_chain)

/-- What the kernel hands the host's device to sign for an actor's write: the device, the acting actor, the chain
its authority comes by (root first), and whether it claims the vault's own authority instead. -/
structure HostWrite where
  device : Bytes
  actor : DocId
  chain : List Cap
  own : Bool
  deriving Repr

/-- The kernel signs a write for `actor`, under the chain its handled message carried and at most one narrower cap
the actor adds. Never as the vault's own. -/
def signWrite (device : Bytes) (actor : DocId) (carried : List Cap) (narrower : Option Cap) : HostWrite :=
  ⟨device, actor, carried ++ narrower.toList, false⟩

theorem host_never_own (device : Bytes) (actor : DocId) (carried : List Cap) (narrower : Option Cap) :
    (signWrite device actor carried narrower).own = false := rfl

theorem write_names_actor (device : Bytes) (actor : DocId) (carried : List Cap) (narrower : Option Cap) :
    (signWrite device actor carried narrower).actor = actor := rfl

/-- When a reader accepts the write's chain, every cap in it, the actor's own narrower one included, reaches nothing
the chain's root doesn't: the authority the handled message carried. -/
theorem actor_within_chain {x : Ctx} (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop)
    {device : Bytes} {actor : DocId} {r : Cap} {rest : List Cap} {narrower : Option Cap}
    (ok : chainOk x (signWrite device actor (r :: rest) narrower).chain = true) :
    ∀ c ∈ (signWrite device actor (r :: rest) narrower).chain, ∀ f v,
      (c.grants x.roles).reaches gov spawned f v → (r.grants x.roles).reaches gov spawned f v :=
  narrow_chain gov spawned ok

end Aven.Actor
