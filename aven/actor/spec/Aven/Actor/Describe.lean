import Aven.Actor.Machines

/-!
# Self-description and declared sends (ARCHITECTURE.md, section 6)

- `describe_exact`: `describe` lists exactly the interface's messages the current phase allows, so a model's tools,
  a projection of it, are exactly what the kernel will take now.
- `send_declared_tell` and `send_declared_ask`: the router appends a tell or an ask from a defined actor only to a live actor, and only when the
  message's type in the receiver's interface is one the sender declared in `sends` (or it is `describe`).
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)

theorem describe_exact (d : Def) (ph : String) (sp : MsgSpec) :
    sp ∈ d.describe ph ↔ sp ∈ d.interface ∧ ∀ mc, d.machine = some mc → mc.opens sp.name ph = true := by
  unfold Def.describe
  rw [List.mem_filter]
  constructor
  · rintro ⟨h1, h2⟩
    refine ⟨h1, fun mc hmc => ?_⟩
    simpa [hmc] using h2
  · rintro ⟨h1, h2⟩
    refine ⟨h1, ?_⟩
    cases hmc : d.machine with
    | none => rfl
    | some mc => exact h2 mc hmc

theorem send_declared_tell (lib : Library) (k : Kernel) (s r : Addr) (name : String) (p : Value)
    (h : (k.send lib s (.tell r name p)).inbox ≠ k.inbox) :
    (k.defs r).isSome ∧ k.declares lib s r name = true := by
  simp only [Kernel.send] at h
  split at h
  · next hc => exact hc
  · exact absurd rfl h

theorem send_declared_ask (lib : Library) (k : Kernel) (s r : Addr) (name : String) (p : Value) (within : Nat)
    (hs : s ≠ kernelAddr) (h : (k.send lib s (.ask r name p within)).inbox s r ≠ k.inbox s r) :
    (k.defs r).isSome ∧ (name = describeName ∨ k.declares lib s r name = true) := by
  simp only [Kernel.send] at h
  split at h
  · next hc => simpa using hc
  · next hc =>
    exfalso; apply h
    simp only [Kernel.append, upd2]
    split
    · next hx => exact absurd hx.1 hs
    · rfl

end Aven.Actor
