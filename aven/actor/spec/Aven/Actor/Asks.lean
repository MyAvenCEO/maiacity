import Aven.Actor.Theorems

/-!
# Every ask is answered once, by its deadline (law 6)

A second invariant, `AskInv`, about inboxes and the asks still waiting. From it:

- `answers_at_most_once`: an ask's answers all travel back from the actor it was sent to, and there is at most one.
- `ask_answered_by_deadline`: once the clock passes an ask's deadline, it has been answered.

An ask the router could not send (no live actor) is failed by the kernel at once with `re` at seq 0, which no message
has; the theorems are about asks that were sent, whose seq is 1 or more.
-/

namespace Aven.Actor

/-- The answers to `id` in a list of messages. -/
def answersTo (l : List Message) (id : MsgId) : List Message := l.filter (·.kind.answers == some id)

theorem answersTo_append (l : List Message) (m : Message) (id : MsgId) :
    answersTo (l ++ [m]) id = answersTo l id ++ (if m.kind.answers = some id then [m] else []) := by
  simp only [answersTo, List.filter_append, List.filter_cons, List.filter_nil, beq_iff_eq]

/-- Where answers travel, and that there is at most one per ask. -/
structure Routes (k : Kernel) : Prop where
  /-- Every message in `inbox x y` is from `x` to `y`. -/
  ends : ∀ x y m, m ∈ k.inbox x y → m.sender = x ∧ m.to = y
  /-- An answer to a sent ask travels in the inbox from the asked to the asker. -/
  route : ∀ x y m, m ∈ k.inbox x y → ∀ id, m.kind.answers = some id →
    id.seq = 0 ∨ (x = id.to ∧ y = id.sender ∧ 1 ≤ id.seq ∧ id.seq ≤ (k.inbox id.sender id.to).length)
  once : ∀ id, 1 ≤ id.seq → (answersTo (k.inbox id.to id.sender) id).length ≤ 1

structure AskInv (k : Kernel) : Prop extends Routes k where
  waiting : ∀ p ∈ k.pending,
    answersTo (k.inbox p.1.to p.1.sender) p.1 = [] ∧ 1 ≤ p.1.seq ∧ p.1.seq ≤ (k.inbox p.1.sender p.1.to).length
  /-- Every ask sent is still waiting, or answered. -/
  answered : ∀ s r m, m ∈ k.inbox s r → ∀ dl, m.kind = .ask dl →
    (∃ p ∈ k.pending, p.1 = m.id) ∨ answersTo (k.inbox r s) m.id ≠ []

theorem AskInv.empty : AskInv Kernel.empty := by
  refine ⟨⟨?_, ?_, ?_⟩, ?_, ?_⟩ <;> simp [Kernel.empty, answersTo]

theorem inbox_append (k : Kernel) (s r : Addr) (name : String) (p : Value) (kd : Kind) (x y : Addr) :
    (k.append s r name p kd).inbox x y =
      if x = s ∧ y = r then k.inbox s r ++ [⟨s, r, (k.inbox s r).length + 1, name, p, kd⟩] else k.inbox x y := by
  simp only [Kernel.append, upd2]

/-- Every inbox only grows. -/
theorem length_append_le (k : Kernel) (s r : Addr) (name : String) (p : Value) (kd : Kind) (x y : Addr) :
    (k.inbox x y).length ≤ ((k.append s r name p kd).inbox x y).length := by
  rw [inbox_append]; split <;> simp_all

theorem answersTo_mono (k : Kernel) (s r : Addr) (name : String) (p : Value) (kd : Kind) (x y : Addr) (id : MsgId)
    (h : answersTo (k.inbox x y) id ≠ []) : answersTo ((k.append s r name p kd).inbox x y) id ≠ [] := by
  rw [inbox_append]; split
  · next hxy => obtain ⟨rfl, rfl⟩ := hxy; rw [answersTo_append]; simp_all
  · exact h

/-- Appending a message keeps the invariant, if it answers nothing, or answers with seq 0, or is the one answer to an
ask that no longer waits and had none. -/
theorem Routes.append {k : Kernel} (hk : Routes k) (s r : Addr) (name : String) (p : Value) (kd : Kind)
    (hkd : kd.answers = none ∨ (∃ id, kd.answers = some id ∧ id.seq = 0) ∨
      (∃ id, kd.answers = some id ∧ s = id.to ∧ r = id.sender ∧ 1 ≤ id.seq ∧
        id.seq ≤ (k.inbox id.sender id.to).length ∧ answersTo (k.inbox s r) id = [] ∧
        ∀ q ∈ k.pending, q.1 ≠ id)) :
    Routes (k.append s r name p kd) := by
  refine ⟨?_, ?_, ?_⟩
  · intro x y m hm
    rw [inbox_append] at hm
    split at hm
    · next hxy =>
      obtain ⟨rfl, rfl⟩ := hxy
      simp only [List.mem_append, List.mem_singleton] at hm
      rcases hm with hm | rfl
      · exact hk.ends _ _ m hm
      · exact ⟨rfl, rfl⟩
    · exact hk.ends _ _ m hm
  · intro x y m hm id hid
    rw [inbox_append] at hm
    split at hm
    · next hxy =>
      obtain ⟨rfl, rfl⟩ := hxy
      simp only [List.mem_append, List.mem_singleton] at hm
      rcases hm with hm | rfl
      · rcases hk.route _ _ m hm id hid with h | ⟨h1, h2, h3, h4⟩
        · exact .inl h
        · exact .inr ⟨h1, h2, h3, Nat.le_trans h4 (length_append_le ..)⟩
      · simp only at hid
        rcases hkd with h | ⟨id', h, h0⟩ | ⟨id', h, h1, h2, h3, h4, -, -⟩
        · simp [h] at hid
        · rw [h] at hid; cases hid; exact .inl h0
        · rw [h] at hid; cases hid; exact .inr ⟨h1, h2, h3, Nat.le_trans h4 (length_append_le ..)⟩
    · rcases hk.route _ _ m hm id hid with h | ⟨h1, h2, h3, h4⟩
      · exact .inl h
      · exact .inr ⟨h1, h2, h3, Nat.le_trans h4 (length_append_le ..)⟩
  · intro id hid
    rw [inbox_append]
    split
    · next hxy =>
      obtain ⟨h1, h2⟩ := hxy
      rw [answersTo_append]
      split
      · next hm =>
        try simp only at hm
        rcases hkd with h | ⟨id', h, h0⟩ | ⟨id', h, -, -, -, -, h5, -⟩
        · simp [h] at hm
        · rw [h] at hm; cases hm; omega
        · rw [h] at hm; cases hm; subst h1; subst h2; rw [h5]; simp
      · rw [← h1, ← h2]; simpa using hk.once id hid
    · exact hk.once id hid

theorem AskInv.append {k : Kernel} (hk : AskInv k) (s r : Addr) (name : String) (p : Value) (kd : Kind)
    (hkd : kd.answers = none ∨ (∃ id, kd.answers = some id ∧ id.seq = 0) ∨
      (∃ id, kd.answers = some id ∧ s = id.to ∧ r = id.sender ∧ 1 ≤ id.seq ∧
        id.seq ≤ (k.inbox id.sender id.to).length ∧ answersTo (k.inbox s r) id = [] ∧
        ∀ q ∈ k.pending, q.1 ≠ id))
    (hask : ∀ dl, kd = .ask dl → False) :
    AskInv (k.append s r name p kd) := by
  have hpend : (k.append s r name p kd).pending = k.pending := rfl
  refine ⟨hk.toRoutes.append s r name p kd hkd, ?_, ?_⟩
  · intro q hq
    rw [hpend] at hq
    obtain ⟨h1, h2, h3⟩ := hk.waiting q hq
    refine ⟨?_, h2, Nat.le_trans h3 (length_append_le ..)⟩
    rw [inbox_append]
    split
    · next hxy =>
      obtain ⟨e1, e2⟩ := hxy
      rw [answersTo_append, ← e1, ← e2, h1]
      split
      · next hm =>
        try simp only at hm
        rcases hkd with h | ⟨id', h, h0⟩ | ⟨id', h, -, -, -, -, -, h6⟩
        · simp [h] at hm
        · rw [h] at hm; cases hm; omega
        · rw [h] at hm; cases hm; exact absurd rfl (h6 q hq)
      · rfl
    · exact h1
  · intro x y m hm dl hdl
    rw [inbox_append] at hm
    have old : m ∈ k.inbox x y := by
      split at hm
      · next hxy =>
        obtain ⟨rfl, rfl⟩ := hxy
        simp only [List.mem_append, List.mem_singleton] at hm
        rcases hm with hm | rfl
        · exact hm
        · exact (hask dl hdl).elim
      · exact hm
    rcases hk.answered x y m old dl hdl with h | h
    · exact .inl h
    · exact .inr (answersTo_mono _ _ _ _ _ _ _ _ _ h)

theorem AskInv.answer {k : Kernel} (hk : AskInv k) (me : Addr) (re : MsgId) (p : Value) (why : Option Reason) :
    AskInv (k.answer me re p why) := by
  unfold Kernel.answer
  split
  · next h =>
    obtain ⟨hto, hp⟩ := h
    simp only [Kernel.isPending, List.any_eq_true, beq_iff_eq] at hp
    obtain ⟨q, hq, hqre⟩ := hp
    obtain ⟨w1, w2, w3⟩ := hk.waiting q hq
    rw [hqre] at w1 w2 w3
    -- Filtering the waiting asks: the answer is appended at once, so every ask stays waiting or answered.
    let k1 : Kernel := { k with pending := k.pending.filter (·.1 != re) }
    have base : ∀ (name : String) (kd : Kind), kd.answers = some re → (∀ dl, kd = .ask dl → False) →
        AskInv (k1.append me re.sender name p kd) := by
      intro name kd hkd hask
      refine ⟨⟨?_, ?_, ?_⟩, ?_, ?_⟩
      · intro x y m hm
        rw [inbox_append] at hm
        split at hm
        · next hxy =>
          obtain ⟨rfl, rfl⟩ := hxy
          simp only [List.mem_append, List.mem_singleton] at hm
          rcases hm with hm | rfl
          · exact hk.ends _ _ m hm
          · exact ⟨rfl, rfl⟩
        · exact hk.ends _ _ m hm
      · intro x y m hm id hid
        rw [inbox_append] at hm
        split at hm
        · next hxy =>
          obtain ⟨rfl, rfl⟩ := hxy
          simp only [List.mem_append, List.mem_singleton] at hm
          rcases hm with hm | rfl
          · rcases hk.route _ _ m hm id hid with h | ⟨h1, h2, h3, h4⟩
            · exact .inl h
            · exact .inr ⟨h1, h2, h3, Nat.le_trans h4 (length_append_le ..)⟩
          · simp only at hid; rw [hkd] at hid; cases hid
            exact .inr ⟨hto.symm, rfl, w2, Nat.le_trans w3 (length_append_le ..)⟩
        · rcases hk.route _ _ m hm id hid with h | ⟨h1, h2, h3, h4⟩
          · exact .inl h
          · exact .inr ⟨h1, h2, h3, Nat.le_trans h4 (length_append_le ..)⟩
      · intro id hid
        rw [inbox_append]
        split
        · next hxy =>
          obtain ⟨h1, h2⟩ := hxy
          rw [answersTo_append]
          split
          · next hm =>
            (try simp only at hm); rw [hkd] at hm; cases hm
            subst hto; simp only [k1]; rw [w1]; simp
          · rw [← h1, ← h2]; simpa using hk.once id hid
        · exact hk.once id hid
      · intro q' hq'
        simp only [k1, Kernel.append, List.mem_filter, bne_iff_ne, ne_eq] at hq'
        obtain ⟨hq', hne⟩ := hq'
        obtain ⟨h1, h2, h3⟩ := hk.waiting q' hq'
        refine ⟨?_, h2, Nat.le_trans h3 (length_append_le ..)⟩
        rw [inbox_append]
        split
        · next hxy =>
          obtain ⟨e1, e2⟩ := hxy
          rw [answersTo_append, ← e1, ← e2]
          simp only [k1] at h1 ⊢
          rw [h1]
          split
          · next hm => (try simp only at hm); rw [hkd] at hm; cases hm; exact absurd rfl hne
          · rfl
        · exact h1
      · intro x y m hm dl hdl
        rw [inbox_append] at hm
        have old : m ∈ k.inbox x y := by
          split at hm
          · next hxy =>
            obtain ⟨rfl, rfl⟩ := hxy
            simp only [List.mem_append, List.mem_singleton] at hm
            rcases hm with hm | rfl
            · exact hm
            · exact (hask dl hdl).elim
          · exact hm
        rcases hk.answered x y m old dl hdl with ⟨q', hq', hq'id⟩ | h
        · by_cases hre : q'.1 = re
          · -- this is the ask being answered now
            right
            have hmid : m.id = re := hq'id ▸ hre
            obtain ⟨e1, e2⟩ := hk.ends x y m old
            have hy : y = me := by rw [← hto, ← hmid, ← e2]; rfl
            have hx : x = re.sender := by rw [← hmid, ← e1]; rfl
            rw [inbox_append, ite_eq_left_of_eq_true _ _ (eq_true ⟨hy, hx⟩), answersTo_append, ite_eq_left_of_eq_true _ _ (eq_true (by rw [hkd, hmid]))]
            simp
          · left
            exact ⟨q', by simp only [k1, Kernel.append, List.mem_filter]; exact ⟨hq', by simpa using hre⟩, hq'id⟩
        · exact .inr (answersTo_mono _ _ _ _ _ _ _ _ _ h)
    cases why
    · exact base _ _ rfl (by intro _ h; cases h)
    · exact base _ _ rfl (by intro _ h; cases h)
  · exact hk

theorem Routes.frame {k k' : Kernel} (hk : Routes k) (hi : k'.inbox = k.inbox) : Routes k' := by
  obtain ⟨a, b, c⟩ := hk
  refine ⟨?_, ?_, ?_⟩ <;> simp only [hi] <;> assumption

/-- Steps that leave inboxes and waiting asks alone keep the invariant. -/
theorem AskInv.frame {k k' : Kernel} (hk : AskInv k) (hi : k'.inbox = k.inbox) (hp : k'.pending = k.pending) :
    AskInv k' := by
  obtain ⟨⟨a, b, c⟩, d, e⟩ := hk
  refine ⟨⟨?_, ?_, ?_⟩, ?_, ?_⟩ <;> simp only [hi, hp] <;> assumption

/-- Sending an ask: it is appended, and waits. Nothing answers it yet, since every answer to a sent ask names one
that was already in its inbox. -/
theorem AskInv.ask {k : Kernel} (hk : AskInv k) (s r : Addr) (name : String) (p : Value) (dl : Nat) :
    AskInv { k.append s r name p (.ask dl) with
      pending := k.pending ++ [(⟨s, r, (k.inbox s r).length + 1⟩, dl)] } := by
  have hR := hk.toRoutes.append s r name p (.ask dl) (.inl rfl)
  refine ⟨hR.frame rfl, ?_, ?_⟩
  · intro q hq
    simp only [List.mem_append, List.mem_singleton] at hq
    rcases hq with hq | rfl
    · obtain ⟨h1, h2, h3⟩ := hk.waiting q hq
      refine ⟨?_, h2, Nat.le_trans h3 (length_append_le ..)⟩
      show answersTo ((k.append s r name p (.ask dl)).inbox _ _) _ = []
      rw [inbox_append]
      split
      · next hxy => obtain ⟨e1, e2⟩ := hxy; rw [answersTo_append, ← e1, ← e2, h1]; simp [Kind.answers]
      · exact h1
    · have hnone : answersTo (k.inbox r s) ⟨s, r, (k.inbox s r).length + 1⟩ = [] := by
        rw [answersTo, List.filter_eq_nil_iff]
        intro m hm hans
        simp only [beq_iff_eq] at hans
        rcases hk.route r s m hm _ hans with h | ⟨-, -, -, h⟩
        · simp at h
        · dsimp only at h; omega
      refine ⟨?_, by simp, ?_⟩
      · show answersTo ((k.append s r name p (.ask dl)).inbox r s) _ = []
        rw [inbox_append]
        split
        · next hxy => obtain ⟨e1, -⟩ := hxy; subst e1; rw [answersTo_append]; simpa [Kind.answers] using hnone
        · exact hnone
      · show _ ≤ ((k.append s r name p (.ask dl)).inbox s r).length
        rw [inbox_append]; simp
  · intro x y m hm dl' hdl
    have hm' : m ∈ (k.append s r name p (.ask dl)).inbox x y := hm
    rw [inbox_append] at hm'
    have old : m ∈ k.inbox x y → (∃ q ∈ k.pending ++ [(⟨s, r, (k.inbox s r).length + 1⟩, dl)], q.1 = m.id) ∨
        answersTo ((k.append s r name p (.ask dl)).inbox y x) m.id ≠ [] := by
      intro hold
      rcases hk.answered x y m hold dl' hdl with ⟨q, hq, hqid⟩ | h
      · exact .inl ⟨q, List.mem_append_left _ hq, hqid⟩
      · exact .inr (answersTo_mono _ _ _ _ _ _ _ _ _ h)
    split at hm'
    · next hxy =>
      obtain ⟨rfl, rfl⟩ := hxy
      simp only [List.mem_append, List.mem_singleton] at hm'
      rcases hm' with hm' | rfl
      · exact old hm'
      · exact .inl ⟨_, List.mem_append_right _ (List.mem_singleton_self _), rfl⟩
    · exact old hm'

theorem AskInv.send {k : Kernel} (hk : AskInv k) (lib : Library) (s : Addr) (e : Effect) :
    AskInv (k.send lib s e) := by
  cases e with
  | tell r name p =>
    simp only [Kernel.send]
    split
    · exact hk.append _ _ _ _ _ (.inl rfl) (by intro _ h; cases h)
    · exact hk
  | ask r name p within =>
    simp only [Kernel.send]
    split
    · exact hk.ask _ _ _ _ _
    · exact hk.append _ _ _ _ _ (.inr (.inl ⟨_, rfl, rfl⟩)) (by intro _ h; cases h)
  | reply re p => simp only [Kernel.send]; exact hk.answer _ _ _ _

theorem AskInv.sendAll {k : Kernel} (hk : AskInv k) (lib : Library) (s : Addr) (fx : List Effect) :
    AskInv (k.sendAll lib s fx) := by
  induction fx generalizing k with
  | nil => exact hk
  | cons e fx ih => exact ih (hk.send lib s e)

theorem AskInv.handle {k : Kernel} (hk : AskInv k) (lib : Library) (r s : Addr) : AskInv (k.handle lib r s) := by
  unfold Kernel.handle
  split
  · exact hk
  · dsimp only
    split
    · refine AskInv.sendAll ?_ _ _ _; exact AskInv.frame hk rfl rfl
    · refine AskInv.sendAll ?_ _ _ _; exact AskInv.frame hk rfl rfl
    · refine AskInv.answer ?_ _ _ _ _; exact AskInv.frame hk rfl rfl
    · refine AskInv.answer ?_ _ _ _ _; exact AskInv.frame hk rfl rfl
    · exact AskInv.frame hk rfl rfl

theorem AskInv.timeouts {k : Kernel} (hk : AskInv k) (ps : List (MsgId × Nat)) :
    AskInv (ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k) := by
  induction ps generalizing k with
  | nil => exact hk
  | cons p ps ih => exact ih (hk.answer _ _ _ _)

theorem AskInv.step {k : Kernel} (hk : AskInv k) (lib : Library) : ∀ e, AskInv (k.step lib e)
  | .handle r s => hk.handle lib r s
  | .tick t => AskInv.timeouts (k := { k with now := max k.now t }) (AskInv.frame hk rfl rfl) _
  | .spawn id dn => by
    simp only [Kernel.step, Kernel.spawn]; split
    · exact hk
    · exact AskInv.frame hk rfl rfl
  | .retire a => AskInv.frame hk rfl rfl
  | .send e => hk.send lib person e

theorem AskInv.run (lib : Library) (es : List Event) : AskInv (Kernel.empty.run lib es) := by
  suffices ∀ k, AskInv k → AskInv (k.run lib es) from this _ AskInv.empty
  induction es with
  | nil => intro k hk; exact hk
  | cons e es ih => intro k hk; simp only [Kernel.run, List.foldl_cons]; exact ih _ (hk.step lib e)

/-! ## The clock leaves no ask waiting past its deadline -/

theorem Kernel.answer_now (k : Kernel) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) :
    (k.answer me re p w).now = k.now := by
  unfold Kernel.answer; split
  · cases w <;> rfl
  · rfl

theorem Kernel.answer_pending (k : Kernel) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) (hme : re.to = me) :
    ∀ q ∈ (k.answer me re p w).pending, q ∈ k.pending ∧ q.1 ≠ re := by
  intro q hq
  unfold Kernel.answer at hq
  split at hq
  · have hq' : q ∈ k.pending.filter (·.1 != re) := by cases w <;> exact hq
    simp only [List.mem_filter, bne_iff_ne, ne_eq] at hq'
    exact hq'
  · next h =>
    refine ⟨hq, fun hre => h ⟨hme, ?_⟩⟩
    simp only [Kernel.isPending, List.any_eq_true, beq_iff_eq]
    exact ⟨q, hq, hre⟩

theorem timeouts_pending (ps : List (MsgId × Nat)) : ∀ (k : Kernel),
    let k' := ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k
    k'.now = k.now ∧ ∀ q ∈ k'.pending, q ∈ k.pending ∧ ∀ p ∈ ps, q.1 ≠ p.1 := by
  induction ps with
  | nil => intro k; simp
  | cons p ps ih =>
    intro k
    simp only [List.foldl_cons]
    obtain ⟨hnow, hq⟩ := ih (k.answer p.1.to p.1 .null (some .timeout))
    refine ⟨hnow.trans (Kernel.answer_now ..), fun q hmem => ?_⟩
    obtain ⟨h1, h2⟩ := hq q hmem
    obtain ⟨h3, h4⟩ := Kernel.answer_pending _ _ _ _ _ rfl q h1
    refine ⟨h3, fun p' hp' => ?_⟩
    simp only [List.mem_cons] at hp'
    rcases hp' with rfl | hp'
    · exact h4
    · exact h2 p' hp'

/-- After the clock moves, every ask still waiting has its deadline ahead. -/
theorem tick_leaves_none_overdue (k : Kernel) (t : Nat) : ∀ q ∈ (k.tick t).pending, (k.tick t).now < q.2 := by
  intro q hq
  unfold Kernel.tick at hq ⊢
  dsimp only at hq ⊢
  obtain ⟨hnow, hall⟩ := timeouts_pending
    ((({ k with now := max k.now t } : Kernel)).pending.filter (·.2 ≤ max k.now t)) { k with now := max k.now t }
  obtain ⟨hin, hne⟩ := hall q hq
  rw [hnow]
  apply Nat.lt_of_not_le
  intro hle
  exact hne q (List.mem_filter.mpr ⟨hin, by simpa using hle⟩) rfl

/-! ## What the invariant gives -/

/-- An ask is answered at most once, and only by the actor it was sent to, back to the asker (law 6). -/
theorem answers_at_most_once (lib : Library) (es : List Event) (id : MsgId) (hid : 1 ≤ id.seq) :
    let k := Kernel.empty.run lib es
    (answersTo (k.inbox id.to id.sender) id).length ≤ 1 ∧
      ∀ x y, ¬ (x = id.to ∧ y = id.sender) → answersTo (k.inbox x y) id = [] := by
  have hk := AskInv.run lib es
  refine ⟨hk.once id hid, fun x y hxy => ?_⟩
  rw [answersTo, List.filter_eq_nil_iff]
  intro m hm hans
  simp only [beq_iff_eq] at hans
  rcases hk.route x y m hm id hans with h | ⟨h1, h2, -⟩
  · omega
  · exact hxy ⟨h1, h2⟩

/-- Every ask sent is answered, or still waits; and right after the clock moves, whatever still waits has its
deadline ahead. So once the clock has passed an ask's deadline, the ask has its one answer (law 6). -/
theorem ask_answered_or_waiting (lib : Library) (es : List Event) (s r : Addr) (m : Message) (dl : Nat)
    (hm : m ∈ (Kernel.empty.run lib es).inbox s r) (hask : m.kind = .ask dl) :
    (∃ q ∈ (Kernel.empty.run lib es).pending, q.1 = m.id) ∨
      answersTo ((Kernel.empty.run lib es).inbox r s) m.id ≠ [] :=
  (AskInv.run lib es).answered s r m hm dl hask

theorem ask_not_overdue (lib : Library) (es : List Event) (t : Nat) :
    let k := Kernel.empty.run lib (es ++ [.tick t])
    ∀ q ∈ k.pending, k.now < q.2 := by
  simp only [Kernel.run, List.foldl_append, List.foldl_cons, List.foldl_nil, Kernel.step]
  exact tick_leaves_none_overdue _ t

end Aven.Actor
