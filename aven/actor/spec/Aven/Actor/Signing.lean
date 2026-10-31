import Aven.Actor.Hosting

/-!
# How a host signs its actors' writes (Samuel, 31 Oct 2026, A27)

Actors hold no keys. Every write an actor makes is signed by its host's one device, whose device cap is the union of
the hosted actors' standing caps: only the outer bound. What bounds each write is its own actor's chain:

- a host device writes only **by chain**, never as its vault's own (`Own`), so "the signer's vault owns the Doc"
  never lets a kernel write past an actor's grant;
- every envelope it signs **names the acting actor** and carries the chain the handled message carried, unchanged.
  An actor's narrowing for one message is not a grant (D16): it is never appended as a link, which would need its
  owners' approval. It is the write's own call, an op and its parameters, which the reader checks against the chain
  (`Aven.ID.Reader.ByChain`; caps are built from ops, A32).

The reader's half (`host_chain_only`, `actor_within_device`, `host_never_beyond`) is avenID's, in `Aven.ID`. This is
the actor half:

- `signs_by_chain`, `write_names_actor`, `write_keeps_chain`: what the kernel signs is by chain, names its actor and
  carries the handled message's chain as it came.
- `actor_within_chain` and `actor_calls_within`: when a reader accepts that chain, nothing in it lets an op reach a
  Doc, or allows a call, beyond its root, the authority the caller started with (`Aven.ID.narrow_chain`,
  `Aven.ID.narrow_ops`). So an actor writes nothing its caller couldn't: no confused deputy, and the host's device cap
  never widens it.
-/

namespace Aven.Actor

open Aven.Core (Bytes DocId Facts Call)
open Aven.ID (Cap Ctx chainOk narrow_chain narrow_ops)

/-- What the kernel hands the host's device to sign for an actor's write: the device, the acting actor, the chain its
authority comes by (root first), the Doc and the calls it makes, and whether it claims the vault's own authority. -/
structure HostWrite where
  device : Bytes
  actor : DocId
  chain : List Cap
  doc : Facts
  calls : List Call
  own : Bool

/-- The kernel signs a write for `actor` under the chain its handled message carried, as it came. Never as the
vault's own. -/
def signWrite (device : Bytes) (actor : DocId) (carried : List Cap) (doc : Facts) (calls : List Call) : HostWrite :=
  ⟨device, actor, carried, doc, calls, false⟩

theorem signs_by_chain (device : Bytes) (actor : DocId) (carried : List Cap) (doc : Facts) (calls : List Call) :
    (signWrite device actor carried doc calls).own = false := rfl

theorem write_names_actor (device : Bytes) (actor : DocId) (carried : List Cap) (doc : Facts) (calls : List Call) :
    (signWrite device actor carried doc calls).actor = actor := rfl

/-- The actor's narrowing is never a link: the chain goes out as it came. -/
theorem write_keeps_chain (device : Bytes) (actor : DocId) (carried : List Cap) (doc : Facts) (calls : List Call) :
    (signWrite device actor carried doc calls).chain = carried := rfl

/-- When a reader accepts the write's chain, no cap in it lets an op reach a Doc beyond the chain's root: the
authority the handled message carried. -/
theorem actor_within_chain {x : Ctx} (gov : Core.Hash → Core.Hash → Prop) (spawned lists : DocId → DocId → Prop)
    {device : Bytes} {actor : DocId} {r : Cap} {rest : List Cap} {doc : Facts} {calls : List Call}
    (ok : chainOk x (signWrite device actor (r :: rest) doc calls).chain = true) :
    ∀ c ∈ (signWrite device actor (r :: rest) doc calls).chain, ∀ f v,
      (c.grants x.roles).reaches gov spawned lists f v → (r.grants x.roles).reaches gov spawned lists f v :=
  narrow_chain gov spawned lists ok

/-- When a reader accepts the write's chain and a cap in it allows each call on the Doc, as the reader checks, the
chain's root allows each call too: the actor writes nothing its caller couldn't. -/
theorem actor_calls_within {x : Ctx} (gov : Core.Hash → Core.Hash → Prop) (spawned lists : DocId → DocId → Prop)
    {device : Bytes} {actor : DocId} {r : Cap} {rest : List Cap} {doc : Facts} {calls : List Call}
    (ok : chainOk x (r :: rest) = true) {c : Cap} (hc : c ∈ r :: rest)
    (hcalls : ∀ k ∈ (signWrite device actor (r :: rest) doc calls).calls,
      (c.grants x.roles).allows gov spawned lists doc k) :
    ∀ k ∈ calls, (r.grants x.roles).allows gov spawned lists doc k :=
  fun k hk => narrow_ops gov spawned lists ok c hc doc k (hcalls k hk)

end Aven.Actor
