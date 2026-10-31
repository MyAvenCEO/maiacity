import Aven.Actor.Machines

/-!
# The router resolves `[vault, doc]` (A201)

Turns name actors as they are on the wire, `Ref` = `[vault, doc]`. The router resolves a `Ref` through the kernel's
directory (`Kernel.resolve`): every address the kernel ever spawned, after the person and the kernel, filled at spawn
and kept when an actor retires. A `Ref` it doesn't know resolves to an address with incarnation 0, which no actor ever
has, so it is refused exactly like an actor that isn't live: a tell is dropped, an ask fails at once with `refused`.

What it proves:

- `RouteInv.run`: in every trace, every live actor is in the directory and has an incarnation of at least 1.
- `resolve_known`: an address in the directory is what its own wire form resolves to, when no other address there
  shares that wire form (BLAKE3 is collision-free in practice; the model doesn't assume it).
- `resolve_live`: a live actor is reached by its wire form, on the same assumption.
- `unknown_not_live`: a `Ref` the directory doesn't know never resolves to a live actor.
- `send_unknown_tell` and `send_unknown_ask`: a tell to such a `Ref` is dropped, and an ask to it is never sent: the
  kernel fails it at once.
-/

namespace Aven.Actor

open Aven.Core (Value Bytes)

/-- What the router relies on: every live actor is in the directory, and none has incarnation 0. -/
def RouteInv (k : Kernel) : Prop := ∀ a, (k.defs a).isSome → 1 ≤ a.n ∧ a ∈ k.dir

theorem RouteInv.frame {k k' : Kernel} (hk : RouteInv k) (hd : k'.defs = k.defs) (hr : k'.dir = k.dir) :
    RouteInv k' := by
  intro a h; rw [hd] at h; rw [hr]; exact hk a h

theorem Kernel.answer_dir (k : Kernel) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) :
    (k.answer me re p w).dir = k.dir := by
  unfold Kernel.answer; split
  · cases w <;> rfl
  · rfl

theorem Kernel.send_dir (lib : Library) (k : Kernel) (s : Addr) (e : Effect) : (k.send lib s e).dir = k.dir := by
  cases e with
  | tell => simp only [Kernel.send]; split <;> rfl
  | ask => simp only [Kernel.send]; split <;> rfl
  | reply re p => exact Kernel.answer_dir ..

theorem RouteInv.send {k : Kernel} (hk : RouteInv k) (lib : Library) (s : Addr) (e : Effect) :
    RouteInv (k.send lib s e) :=
  hk.frame (Kernel.send_frame ..).1 (Kernel.send_dir ..)

theorem RouteInv.answer {k : Kernel} (hk : RouteInv k) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) :
    RouteInv (k.answer me re p w) :=
  hk.frame (Kernel.answer_frame ..).1 (Kernel.answer_dir ..)

theorem RouteInv.sendAll {k : Kernel} (hk : RouteInv k) (lib : Library) (s : Addr) (fx : List Effect) :
    RouteInv (k.sendAll lib s fx) := by
  induction fx generalizing k with
  | nil => exact hk
  | cons e fx ih => exact ih (hk.send lib s e)

theorem RouteInv.handle {k : Kernel} (hk : RouteInv k) (lib : Library) (r s : Addr) :
    RouteInv (k.handle lib r s) := by
  unfold Kernel.handle
  split
  · exact hk
  · dsimp only
    split
    all_goals first
      | apply RouteInv.sendAll; exact hk.frame rfl rfl
      | apply RouteInv.answer; exact hk.frame rfl rfl
      | exact hk.frame rfl rfl

theorem RouteInv.spawn {k : Kernel} (hk : RouteInv k) (lib : Library) (id : Bytes) (dn : String) :
    RouteInv (k.spawn lib id dn) := by
  unfold Kernel.spawn
  split
  · exact hk
  · intro a h
    simp only [upd] at h ⊢
    split at h
    · next ha => subst ha; exact ⟨by simp [Kernel.next], by simp⟩
    · obtain ⟨h1, h2⟩ := hk a h; exact ⟨h1, List.mem_append_left _ h2⟩

theorem RouteInv.retire {k : Kernel} (hk : RouteInv k) (a : Addr) : RouteInv (k.retire a) := by
  intro b h
  simp only [Kernel.retire, upd] at h
  split at h
  · simp at h
  · exact hk b h

theorem RouteInv.timeouts {k : Kernel} (hk : RouteInv k) (ps : List (MsgId × Nat)) :
    RouteInv (ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k) := by
  induction ps generalizing k with
  | nil => exact hk
  | cons p ps ih => exact ih (hk.answer _ _ _ _)

theorem RouteInv.step {k : Kernel} (hk : RouteInv k) (lib : Library) : ∀ e, RouteInv (k.step lib e)
  | .handle r s => hk.handle lib r s
  | .tick t => RouteInv.timeouts (k := { k with now := max k.now t }) (hk.frame rfl rfl) _
  | .spawn id dn => hk.spawn lib id dn
  | .retire a => hk.retire a
  | .send e => hk.send lib person e

/-- In every trace, every live actor is in the directory and has an incarnation of at least 1. -/
theorem RouteInv.run (lib : Library) (es : List Event) : RouteInv (Kernel.empty.run lib es) := by
  suffices ∀ k, RouteInv k → RouteInv (k.run lib es) from this _ (by intro a h; simp [Kernel.empty] at h)
  induction es with
  | nil => intro k hk; exact hk
  | cons e es ih =>
    intro k hk
    simp only [Kernel.run, List.foldl_cons]
    exact ih _ (hk.step lib e)

/-- An address in the directory is what its own wire form resolves to, when no other address there shares it. -/
theorem resolve_known {k : Kernel} {a : Addr} (ha : a ∈ k.dir) (hu : ∀ b ∈ k.dir, b.ref = a.ref → b = a) :
    k.resolve a.ref = a := by
  unfold Kernel.resolve
  cases h : k.dir.find? (·.ref == a.ref) with
  | none =>
    have := List.find?_eq_none.mp h a ha
    simp at this
  | some b =>
    have hb := List.mem_of_find?_eq_some h
    have hp := List.find?_some h
    simp only [beq_iff_eq] at hp
    exact hu b hb hp

/-- A live actor is reached by its wire form. -/
theorem resolve_live {k : Kernel} (hk : RouteInv k) {a : Addr} (hl : (k.defs a).isSome)
    (hu : ∀ b ∈ k.dir, b.ref = a.ref → b = a) : k.resolve a.ref = a :=
  resolve_known (hk a hl).2 hu

/-- A `Ref` the directory doesn't know never resolves to a live actor. -/
theorem unknown_not_live {k : Kernel} (hk : RouteInv k) {r : Ref} (hr : ∀ b ∈ k.dir, b.ref ≠ r) :
    k.defs (k.resolve r) = none := by
  have hn : k.dir.find? (·.ref == r) = none := List.find?_eq_none.mpr fun b hb => by simpa using hr b hb
  unfold Kernel.resolve
  rw [hn, Option.getD_none]
  cases h : k.defs ⟨r.vault, r.doc, 0⟩ with
  | none => rfl
  | some _ => exact absurd (hk ⟨r.vault, r.doc, 0⟩ (by rw [h]; rfl)).1 (by dsimp only; omega)

/-- A tell to a `Ref` the directory doesn't know is dropped. -/
theorem send_unknown_tell {k : Kernel} (hk : RouteInv k) (lib : Library) (s : Addr) {r : Ref}
    (hr : ∀ b ∈ k.dir, b.ref ≠ r) (name : String) (p : Value) : k.send lib s (.tell r name p) = k := by
  simp [Kernel.send, unknown_not_live hk hr]

/-- An ask to a `Ref` the directory doesn't know is never sent: the kernel fails it at once with `refused`. -/
theorem send_unknown_ask {k : Kernel} (hk : RouteInv k) (lib : Library) (s : Addr) {r : Ref}
    (hr : ∀ b ∈ k.dir, b.ref ≠ r) (name : String) (p : Value) (within : Nat) :
    k.send lib s (.ask r name p within) = k.append kernelAddr s "fail" .null
      (.fail ⟨s, k.resolve r, 0⟩ .refused) := by
  simp [Kernel.send, unknown_not_live hk hr]

end Aven.Actor
