import Aven.Actor.Describe

/-!
# Every ask is answered by its own deadline (law 6)

`ask_not_overdue` says nothing waits past the deadline the kernel keeps for it. This file ties that deadline to the
ask's own message: every waiting ask is a message in its inbox whose kind carries that very deadline. From it:

- `answered_by_deadline`: once the clock has moved to or past an ask's deadline, the ask has its answer.
-/

namespace Aven.Actor

open Aven.Core (Value TypeId Bytes)

/-- Every waiting ask is a message in its inbox, whose kind is `ask` with the deadline it waits on. -/
def LinkInv (k : Kernel) : Prop :=
  ∀ q ∈ k.pending, ∃ m ∈ k.inbox q.1.sender q.1.to, m.id = q.1 ∧ m.kind = .ask q.2

theorem LinkInv.empty : LinkInv Kernel.empty := by
  intro q hq; simp [Kernel.empty] at hq

theorem mem_inbox_append (k : Kernel) (s r : Addr) (name : String) (p : Value) (kd : Kind) (x y : Addr) (m : Message)
    (hm : m ∈ k.inbox x y) : m ∈ (k.append s r name p kd).inbox x y := by
  rw [inbox_append]; split
  · next hxy => obtain ⟨rfl, rfl⟩ := hxy; exact List.mem_append_left _ hm
  · exact hm

theorem LinkInv.append {k : Kernel} (hk : LinkInv k) (s r : Addr) (name : String) (p : Value) (kd : Kind) :
    LinkInv (k.append s r name p kd) := by
  intro q hq
  obtain ⟨m, hm, h1, h2⟩ := hk q hq
  exact ⟨m, mem_inbox_append _ _ _ _ _ _ _ _ _ hm, h1, h2⟩

theorem LinkInv.answer {k : Kernel} (hk : LinkInv k) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) :
    LinkInv (k.answer me re p w) := by
  unfold Kernel.answer
  split
  · have hf : LinkInv { k with pending := k.pending.filter (·.1 != re) } := by
      intro q hq
      exact hk q (List.mem_filter.mp hq).1
    cases w <;> exact hf.append _ _ _ _ _
  · exact hk

theorem LinkInv.send {k : Kernel} (hk : LinkInv k) (lib : Library) (s : Addr) (e : Effect) :
    LinkInv (k.send lib s e) := by
  cases e with
  | tell r name p => simp only [Kernel.send]; split
                     · exact hk.append _ _ _ _ _
                     · exact hk
  | ask r name p within =>
    simp only [Kernel.send]
    split
    · intro q hq
      simp only [List.mem_append, List.mem_singleton] at hq
      rcases hq with hq | rfl
      · obtain ⟨m, hm, h1, h2⟩ := hk q hq
        exact ⟨m, mem_inbox_append _ _ _ _ _ _ _ _ _ hm, h1, h2⟩
      · refine ⟨⟨s, k.resolve r, (k.inbox s (k.resolve r)).length + 1, name, p, .ask (k.now + min within askMax)⟩,
          ?_, rfl, rfl⟩
        show _ ∈ (k.append s (k.resolve r) name p _).inbox s (k.resolve r)
        rw [inbox_append]; simp
    · exact hk.append _ _ _ _ _
  | reply re p => simp only [Kernel.send]; exact hk.answer _ _ _ _

theorem LinkInv.sendAll {k : Kernel} (hk : LinkInv k) (lib : Library) (s : Addr) (fx : List Effect) :
    LinkInv (k.sendAll lib s fx) := by
  induction fx generalizing k with
  | nil => exact hk
  | cons e fx ih => exact ih (hk.send lib s e)

theorem LinkInv.frame {k k' : Kernel} (hk : LinkInv k) (hi : k'.inbox = k.inbox) (hp : k'.pending = k.pending) :
    LinkInv k' := by
  intro q hq; rw [hp] at hq; rw [hi]; exact hk q hq

theorem LinkInv.handle {k : Kernel} (hk : LinkInv k) (lib : Library) (r s : Addr) : LinkInv (k.handle lib r s) := by
  unfold Kernel.handle
  split
  · exact hk
  · dsimp only
    split
    · refine LinkInv.sendAll ?_ _ _ _; exact LinkInv.frame hk rfl rfl
    · refine LinkInv.sendAll ?_ _ _ _; exact LinkInv.frame hk rfl rfl
    · refine LinkInv.answer ?_ _ _ _ _; exact LinkInv.frame hk rfl rfl
    · refine LinkInv.answer ?_ _ _ _ _; exact LinkInv.frame hk rfl rfl
    · exact LinkInv.frame hk rfl rfl

theorem LinkInv.timeouts {k : Kernel} (hk : LinkInv k) (ps : List (MsgId × Nat)) :
    LinkInv (ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k) := by
  induction ps generalizing k with
  | nil => exact hk
  | cons p ps ih => exact ih (hk.answer _ _ _ _)

theorem LinkInv.step {k : Kernel} (hk : LinkInv k) (lib : Library) : ∀ e, LinkInv (k.step lib e)
  | .handle r s => hk.handle lib r s
  | .tick t => LinkInv.timeouts (k := { k with now := max k.now t }) (hk.frame rfl rfl) _
  | .spawn id dn => by
    simp only [Kernel.step, Kernel.spawn]; split
    · exact hk
    · exact LinkInv.frame hk rfl rfl
  | .retire _ => LinkInv.frame hk rfl rfl
  | .send e => hk.send lib person e

theorem LinkInv.runFrom {k : Kernel} (hk : LinkInv k) (lib : Library) (es : List Event) :
    LinkInv (k.run lib es) := by
  induction es generalizing k with
  | nil => exact hk
  | cons e es ih => simp only [Kernel.run, List.foldl_cons]; exact ih (hk.step lib e)

/-- In one inbox, a message's seq names it: two with one seq are one message. -/
theorem seq_unique {lib : Library} {k : Kernel} (hk : Inv lib k) (s r : Addr) (m m' : Message)
    (hm : m ∈ k.inbox s r) (hm' : m' ∈ k.inbox s r) (h : m.seq = m'.seq) : m = m' := by
  obtain ⟨i, hi, rfl⟩ := List.getElem_of_mem hm
  obtain ⟨j, hj, rfl⟩ := List.getElem_of_mem hm'
  have hij : i = j := by
    have := (hk.wf s r i hi).2.2
    have := (hk.wf s r j hj).2.2
    omega
  subst hij; rfl

/-- Once the clock has moved to or past an ask's own deadline, the ask has its answer, back from the actor it was
sent to (law 6). -/
theorem answered_by_deadline (lib : Library) (es : List Event) (t : Nat) (s r : Addr) (m : Message) (dl : Nat)
    (hm : m ∈ (Kernel.empty.run lib (es ++ [.tick t])).inbox s r) (hask : m.kind = .ask dl)
    (hdl : dl ≤ (Kernel.empty.run lib (es ++ [.tick t])).now) :
    answersTo ((Kernel.empty.run lib (es ++ [.tick t])).inbox r s) m.id ≠ [] := by
  rcases ask_answered_or_waiting lib _ s r m dl hm hask with ⟨q, hq, hqid⟩ | h
  · exfalso
    have hlate := ask_not_overdue lib es t q hq
    obtain ⟨m', hm', hid', hkind'⟩ := (LinkInv.empty.runFrom lib (es ++ [.tick t])) q hq
    have hinv := Inv.run lib (es ++ [.tick t])
    have hends := (AskInv.run lib (es ++ [.tick t])).ends
    -- the waiting ask's message is `m` itself
    have hsr : q.1.sender = s ∧ q.1.to = r := by
      obtain ⟨e1, e2⟩ := hends s r m hm
      rw [hqid]; exact ⟨e1, e2⟩
    rw [hsr.1, hsr.2] at hm'
    have hseq : m'.seq = m.seq := by
      have := congrArg MsgId.seq hid'; rw [hqid] at this; exact this
    have heq := seq_unique hinv s r m' m hm' hm hseq
    rw [heq, hask] at hkind'
    cases hkind'
    omega
  · exact h

end Aven.Actor
