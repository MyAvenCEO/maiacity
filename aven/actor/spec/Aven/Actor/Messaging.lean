import Aven.Actor.Signing

/-!
# The cap a message carries (D16, A27)

A message carries the chain its sender's handled message carried, and at most one **attenuation** (`Aven.ID`'s
`CapKind.attenuate`): a link that only narrows, keeps its parent's holder and needs no approval. Writes keep their
chain as it came (`Aven.Actor.Signing`); a cap that travels on in a message narrows by attenuation.

Who checks what:

- **The reader** checks the owner-approved bound: every grant in the chain approved, and every attenuation within its
  parent (`Aven.ID.attenuate_within`).
- **The kernel** holds the per-message narrowing within the handled message's own cap. After a standing delegation
  to another vault, the attenuation's parent in the chain is the delegation, so the reader can't check this; the
  kernel makes no attenuation that isn't within both.

Authority doesn't cross vaults by itself (D14, D16): a receiver on another vault acts under its own standing caps,
and the sender's chain travels as provenance. To act with the sender's authority, the receiver's vault needs a
standing grant approved by the sender's side's owners, which attenuations may follow (`Aven.ID.new_holder_granted`).

What it proves:

- `attenuation_within_message`: the kernel's attenuation reaches and allows nothing beyond the handled message's cap,
  nor beyond its parent in the chain.
- `message_within_root`: when a reader accepts a message's chain, nothing in it, the attenuation included, reaches a
  Doc or allows a step beyond the chain's root.
-/

namespace Aven.Actor

open Aven.Core (Bytes DocId Facts Verb Step)
open Aven.ID (Cap CapKind Grant Ctx chainOk narrow_chain narrow_steps)

/-- An attenuation of `parent` to the grant `g`, issued and signed for `parent`'s holder by its host device. It keeps
the holder, share and conditions, so only its grant narrows. -/
def attenuation (id issuer signer : String) (parent : Cap) (g : Grant) : Cap :=
  { id := id, issuer := issuer, holder := parent.holder, parent := some parent.id, kind := .attenuate, grant := g,
    role := none, share := parent.share, conditions := parent.conditions, signer := signer, approvals := [] }

/-- The kernel's attenuation for one message: only when the narrowed grant lies within the handled message's own cap
(`bound`) and within the chain's last cap (`parent`). Otherwise it makes none, and the message goes without it. -/
def kernelAttenuate (roles : List Aven.ID.Role) (id issuer signer : String) (bound parent : Cap) (g : Grant) :
    Option Cap :=
  if g.within (bound.grants roles) && g.within (parent.grants roles) then
    some (attenuation id issuer signer parent g)
  else none

/-- The chain a message carries: its handled message's chain, and at most one attenuation. -/
def messageChain (handled : List Cap) (att : Option Cap) : List Cap := handled ++ att.toList

theorem attenuation_grants (roles : List Aven.ID.Role) (id issuer signer : String) (parent : Cap) (g : Grant) :
    (attenuation id issuer signer parent g).grants roles = g := rfl

/-- The kernel's attenuation reaches and allows nothing beyond the handled message's cap, nor beyond its parent. -/
theorem attenuation_within_message {roles : List Aven.ID.Role} (gov : Bytes → Bytes → Prop)
    (spawned : DocId → DocId → Prop) {id issuer signer : String} {bound parent : Cap} {g : Grant} {a : Cap}
    (h : kernelAttenuate roles id issuer signer bound parent g = some a) :
    a.kind = .attenuate ∧ a.holder = parent.holder ∧
      (∀ f v, (a.grants roles).reaches gov spawned f v → (bound.grants roles).reaches gov spawned f v) ∧
      (∀ f s, (a.grants roles).allows gov spawned f s → (bound.grants roles).allows gov spawned f s) ∧
      (∀ f v, (a.grants roles).reaches gov spawned f v → (parent.grants roles).reaches gov spawned f v) := by
  unfold kernelAttenuate at h
  split at h
  · next hw =>
    simp only [Option.some.injEq] at h
    subst h
    simp only [Bool.and_eq_true] at hw
    refine ⟨rfl, rfl, fun f v r => ?_, fun f s r => ?_, fun f v r => ?_⟩
    · exact Aven.ID.Grant.within_reaches hw.1 (by simpa [attenuation_grants] using r)
    · exact Aven.ID.Grant.within_allows hw.1 (by simpa [attenuation_grants] using r)
    · exact Aven.ID.Grant.within_reaches hw.2 (by simpa [attenuation_grants] using r)
  · simp at h

/-- When a reader accepts a message's chain, nothing in it, the attenuation included, reaches a Doc or allows a step
beyond the chain's root. -/
theorem message_within_root {x : Ctx} (gov : Bytes → Bytes → Prop) (spawned : DocId → DocId → Prop)
    {r : Cap} {rest : List Cap} {att : Option Cap} (ok : chainOk x (messageChain (r :: rest) att) = true) :
    (∀ c ∈ messageChain (r :: rest) att, ∀ f v,
      (c.grants x.roles).reaches gov spawned f v → (r.grants x.roles).reaches gov spawned f v) ∧
    (∀ c ∈ messageChain (r :: rest) att, ∀ f s,
      (c.grants x.roles).allows gov spawned f s → (r.grants x.roles).allows gov spawned f s) :=
  ⟨narrow_chain gov spawned ok, narrow_steps gov spawned ok⟩

end Aven.Actor
