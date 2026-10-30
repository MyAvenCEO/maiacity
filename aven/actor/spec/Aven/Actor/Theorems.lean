import Aven.Actor.Kernel

/-!
# The kernel's theorems (ARCHITECTURE.md, section 14)

One invariant, `Inv`, holds from the empty kernel through every event of every trace (`Inv.run`). From it:

- `handled_in_order`: what an actor handled from one sender is exactly the start of that sender's inbox, in order:
  messages from one actor to another are handled in the order sent, each once, with none skipped.
- `replays`: replaying an actor's journal from its first state gives its state and phase now (law 8).
- `machine_sound`: every turn that ran under a machine took one of its transitions (section 6).
- `spawn_fresh`: a spawn's address is new: no message was ever sent to it and it has no journal, so a face placed
  again is a new incarnation whose messages are never taken for the old one's.
-/

namespace Aven.Actor

/-- An address no spawn has reached yet. -/
def Kernel.Fresh (k : Kernel) (a : Addr) : Prop := k.spawned a.id < a.n

/-- What an actor handled from `s`, in order. -/
def handledFrom (es : List Entry) (s : Addr) : List Message := (es.filter (·.msg.sender == s)).map (·.msg)

structure Inv (lib : Library) (k : Kernel) : Prop where
  /-- Every message in `inbox s r` is from `s` to `r`, numbered by its place from 1. -/
  wf : ∀ s r (i : Nat) (h : i < (k.inbox s r).length),
    (k.inbox s r)[i].sender = s ∧ (k.inbox s r)[i].to = r ∧ (k.inbox s r)[i].seq = i + 1
  readLe : ∀ r s, k.read r s ≤ (k.inbox s r).length
  handled : ∀ r s, handledFrom (k.journal r) s = (k.inbox s r).take (k.read r s)
  entries : ∀ a, ∀ e ∈ k.journal a,
    (e.after, e.phaseAfter, e.outcome, e.effects) = judge lib e.defn e.before e.msg e.given e.phaseBefore
  replay : ∀ a, (k.state a, k.phase a) = replay lib (k.start a) (k.journal a)
  fresh : ∀ a, k.Fresh a → k.defs a = none ∧ k.journal a = [] ∧ ∀ s, k.inbox s a = []
  pendingOld : ∀ p ∈ k.pending, ¬ k.Fresh p.1.sender

theorem Inv.empty (lib : Library) : Inv lib Kernel.empty := by
  constructor <;> simp [Kernel.empty, handledFrom, Aven.Actor.replay]

/-! ## Appending, answering and sending keep the invariant -/

theorem Inv.append {lib : Library} {k : Kernel} (hk : Inv lib k) (s r : Addr) (name : String) (p : Value)
    (kd : Kind) (hr : ¬ k.Fresh r) : Inv lib (k.append s r name p kd) := by
  constructor
  · intro x y i h
    simp only [Kernel.append, upd2] at h ⊢
    by_cases hxy : x = s ∧ y = r
    · obtain ⟨rfl, rfl⟩ := hxy
      simp only [and_self, ite_true, List.length_append, List.length_singleton] at h ⊢
      by_cases hi : i < (k.inbox x y).length
      · rw [List.getElem_append_left hi]; exact hk.wf x y i hi
      · have : i = (k.inbox x y).length := by omega
        subst this; simp
    · simp only [hxy, ite_false] at h ⊢; exact hk.wf x y i h
  · intro x y
    have := hk.readLe x y
    simp only [Kernel.append, upd2]
    split <;> (try simp_all) <;> omega
  · intro x y
    simp only [Kernel.append, upd2]
    split
    · next hxy =>
      obtain ⟨rfl, rfl⟩ := hxy
      rw [List.take_append_of_le_length (hk.readLe x y)]; exact hk.handled x y
    · exact hk.handled x y
  · exact hk.entries
  · exact hk.replay
  · intro a ha
    obtain ⟨h1, h2, h3⟩ := hk.fresh a ha
    refine ⟨h1, h2, fun x => ?_⟩
    simp only [Kernel.append, upd2]
    split
    · next hxy => obtain ⟨-, rfl⟩ := hxy; exact absurd ha hr
    · exact h3 x
  · exact hk.pendingOld

theorem Inv.filterPending {lib : Library} {k : Kernel} (hk : Inv lib k) (f : MsgId × Nat → Bool) :
    Inv lib { k with pending := k.pending.filter f } :=
  ⟨hk.wf, hk.readLe, hk.handled, hk.entries, hk.replay, hk.fresh,
    fun p hp => hk.pendingOld p (List.mem_filter.mp hp).1⟩

theorem Inv.answer {lib : Library} {k : Kernel} (hk : Inv lib k) (me : Addr) (re : MsgId) (p : Value)
    (why : Option Reason) : Inv lib (k.answer me re p why) := by
  unfold Kernel.answer
  split
  · next h =>
    obtain ⟨-, hp⟩ := h
    have hold : ¬ k.Fresh re.sender := by
      simp only [Kernel.isPending, List.any_eq_true, beq_iff_eq] at hp
      obtain ⟨q, hq, rfl⟩ := hp
      exact hk.pendingOld q hq
    have hf := hk.filterPending (·.1 != re)
    cases why <;> exact hf.append _ _ _ _ _ hold
  · exact hk

theorem Inv.send {lib : Library} {k : Kernel} (hk : Inv lib k) (s : Addr) (hs : ¬ k.Fresh s) (e : Effect) :
    Inv lib (k.send s e) := by
  cases e with
  | tell r name p =>
    simp only [Kernel.send]
    split
    · next h =>
      apply hk.append
      intro hr; simp [hk.fresh r hr] at h
    · exact hk
  | ask r name p within =>
    simp only [Kernel.send]
    split
    · next h =>
      have hr : ¬ k.Fresh r := by intro hr; simp [hk.fresh r hr] at h
      have ha := hk.append s r name p (.ask (k.now + min within askMax)) hr
      refine ⟨ha.wf, ha.readLe, ha.handled, ha.entries, ha.replay, ha.fresh, ?_⟩
      intro q hq
      simp only [List.mem_append, List.mem_singleton] at hq
      rcases hq with hq | rfl
      · exact hk.pendingOld q hq
      · exact hs
    · exact hk.append _ _ _ _ _ hs
  | reply re p => simp only [Kernel.send]; exact hk.answer _ _ _ _

theorem Kernel.send_spawned (k : Kernel) (s : Addr) (e : Effect) : (k.send s e).spawned = k.spawned := by
  cases e <;> simp only [Kernel.send, Kernel.answer, Kernel.append] <;> (try split) <;> (try split) <;> rfl

theorem Inv.sendAll {lib : Library} {k : Kernel} (hk : Inv lib k) (s : Addr) (hs : ¬ k.Fresh s)
    (fx : List Effect) : Inv lib (k.sendAll s fx) := by
  induction fx generalizing k with
  | nil => exact hk
  | cons e fx ih =>
    apply ih (hk.send s hs e)
    simp only [Kernel.Fresh, Kernel.send_spawned]; exact hs

/-! ## Every event keeps the invariant -/

theorem Inv.timeouts {lib : Library} {k : Kernel} (hk : Inv lib k) (ps : List (MsgId × Nat)) :
    Inv lib (ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k) := by
  induction ps generalizing k with
  | nil => exact hk
  | cons p ps ih => exact ih (hk.answer _ _ _ _)

theorem Inv.tick {lib : Library} {k : Kernel} (hk : Inv lib k) (t : Nat) : Inv lib (k.tick t) :=
  Inv.timeouts (k := { k with now := max k.now t })
    ⟨hk.wf, hk.readLe, hk.handled, hk.entries, hk.replay, hk.fresh, hk.pendingOld⟩ _

theorem Inv.retire {lib : Library} {k : Kernel} (hk : Inv lib k) (a : Addr) : Inv lib (k.retire a) := by
  refine ⟨hk.wf, hk.readLe, hk.handled, hk.entries, hk.replay, fun b hb => ?_, hk.pendingOld⟩
  obtain ⟨h1, h2, h3⟩ := hk.fresh b hb
  refine ⟨?_, h2, h3⟩
  simp only [Kernel.retire, upd]; split <;> simp [h1]

theorem Inv.spawn {lib : Library} {k : Kernel} (hk : Inv lib k) (id dn : String) :
    Inv lib (k.spawn lib id dn) := by
  unfold Kernel.spawn
  split
  · exact hk
  · next d hd =>
    have hnew : k.Fresh (k.next id) := by simp [Kernel.Fresh, Kernel.next]
    obtain ⟨hd0, hj0, hi0⟩ := hk.fresh _ hnew
    -- Fresh after the spawn implies fresh before it.
    have hback : ∀ b : Addr, (upd k.spawned id (k.spawned id + 1)) b.id < b.n → k.Fresh b := by
      intro b hb; simp only [upd] at hb; unfold Kernel.Fresh; split at hb
      · next h => rw [h]; omega
      · omega
    refine ⟨hk.wf, hk.readLe, hk.handled, hk.entries, fun b => ?_, fun b hb => ?_, fun q hq hf => ?_⟩
    · simp only [upd]
      split
      · next hb => subst hb; simp [hj0, Aven.Actor.replay]
      · exact hk.replay b
    · have hb' := hback b hb
      obtain ⟨h1, h2, h3⟩ := hk.fresh b hb'
      refine ⟨?_, h2, h3⟩
      simp only [upd]
      split
      · next hb2 =>
        subst hb2; simp [Kernel.next, Kernel.Fresh, upd] at hb
      · exact h1
    · exact hk.pendingOld q hq (hback _ hf)

/-- Handling one message: the entry it journals, and the state it leaves, are `judge`'s. -/
theorem Inv.handle {lib : Library} {k : Kernel} (hk : Inv lib k) (r s : Addr) : Inv lib (k.handle lib r s) := by
  unfold Kernel.handle
  split
  · exact hk
  · next m hm =>
    have hlt : k.read r s < (k.inbox s r).length := by
      rcases Nat.lt_or_ge (k.read r s) (k.inbox s r).length with h | h
      · exact h
      · simp [List.getElem?_eq_none h] at hm
    have hm' : (k.inbox s r)[k.read r s] = m := by simp [List.getElem?_eq_getElem hlt] at hm; exact hm
    have hsender : m.sender = s := hm' ▸ (hk.wf s r _ hlt).1
    have hr : ¬ k.Fresh r := by
      intro hf
      have := (hk.fresh r hf).2.2 s
      simp [this] at hlt
    generalize hj : judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r) = j
    have hk' : Inv lib { k with
        read := upd2 k.read r s (k.read r s + 1)
        journal := upd k.journal r (k.journal r ++
          [⟨m, k.defs r, ⟨k.now, (k.journal r).length⟩, k.state r, k.phase r, j.1, j.2.1, j.2.2.2, j.2.2.1⟩])
        state := upd k.state r j.1
        phase := upd k.phase r j.2.1 } := by
      constructor
      · exact hk.wf
      · intro x y
        simp only [upd2]
        split
        · next hxy => obtain ⟨rfl, rfl⟩ := hxy; omega
        · exact hk.readLe x y
      · intro x y
        simp only [upd, upd2]
        by_cases hx : x = r
        · subst hx
          simp only [ite_true]
          by_cases hy : y = s
          · subst hy
            simp only [and_self, ite_true, handledFrom, List.filter_append, List.map_append]
            rw [List.take_add_one, ← hk.handled, List.getElem?_eq_getElem hlt, hm']
            simp [handledFrom, hsender]
          · simp only [hy, and_false, ite_false, handledFrom, List.filter_append, List.map_append]
            have := hk.handled x y
            simp only [handledFrom] at this
            rw [← this]
            have hne : (m.sender == y) = false := by simp [hsender]; exact Ne.symm hy
            simp [hne]
        · simp only [hx, ite_false, false_and]
          exact hk.handled x y
      · intro a e he
        simp only [upd] at he
        split at he
        · next ha =>
          subst ha
          simp only [List.mem_append, List.mem_singleton] at he
          rcases he with he | rfl
          · exact hk.entries _ e he
          · simp [← hj]
        · exact hk.entries a e he
      · intro a
        simp only [upd]
        split
        · next ha =>
          subst ha
          have hrep := hk.replay a
          simp only [Aven.Actor.replay] at hrep
          rw [Aven.Actor.replay, List.foldl_append, ← hrep]
          simp [← hj]
        · exact hk.replay a
      · intro a ha
        obtain ⟨h1, h2, h3⟩ := hk.fresh a ha
        refine ⟨h1, ?_, h3⟩
        simp only [upd]
        split
        · next har => subst har; exact absurd ha hr
        · exact h2
      · exact hk.pendingOld
    have hr' : ¬ Kernel.Fresh { k with
        read := upd2 k.read r s (k.read r s + 1)
        journal := upd k.journal r (k.journal r ++
          [⟨m, k.defs r, ⟨k.now, (k.journal r).length⟩, k.state r, k.phase r, j.1, j.2.1, j.2.2.2, j.2.2.1⟩])
        state := upd k.state r j.1
        phase := upd k.phase r j.2.1 } r := hr
    dsimp only
    rw [hj]
    split
    · exact hk'.sendAll r hr' _
    · exact hk'.answer _ _ _ _
    · exact hk'.answer _ _ _ _
    · exact hk'

theorem Inv.step {lib : Library} {k : Kernel} (hk : Inv lib k) : ∀ e, Inv lib (k.step lib e)
  | .handle r s => hk.handle r s
  | .tick t => hk.tick t
  | .spawn id dn => hk.spawn id dn
  | .retire a => hk.retire a
  | .send e => hk.send person (by simp [Kernel.Fresh, person]) e

theorem Inv.runFrom {lib : Library} {k : Kernel} (hk : Inv lib k) (es : List Event) : Inv lib (k.run lib es) := by
  induction es generalizing k with
  | nil => exact hk
  | cons e es ih => simp only [Kernel.run, List.foldl_cons]; exact ih (hk.step e)

theorem Inv.run (lib : Library) (es : List Event) : Inv lib (Kernel.empty.run lib es) :=
  (Inv.empty lib).runFrom es

/-! ## What the invariant gives -/

/-- Messages from one actor to another are handled in the order sent, each once, none skipped. -/
theorem handled_in_order (lib : Library) (es : List Event) (r s : Addr) :
    let k := Kernel.empty.run lib es
    handledFrom (k.journal r) s = (k.inbox s r).take (k.read r s) :=
  (Inv.run lib es).handled r s

/-- Replaying an actor's journal from its first state gives its state and phase now (law 8). -/
theorem replays (lib : Library) (es : List Event) (a : Addr) :
    let k := Kernel.empty.run lib es
    (k.state a, k.phase a) = replay lib (k.start a) (k.journal a) :=
  (Inv.run lib es).replay a

/-- A turn that ran under a machine took one of its transitions: the drawn machine and the behaviour cannot drift
apart (section 6). -/
theorem judge_machine {lib : Library} {dn : String} {d : Def} {mc : Machine} {st : Value} {m : Message} {g : Given}
    {ph : String} (hd : lib dn = some d) (hm : d.machine = some mc)
    (hdone : (judge lib (some dn) st m g ph).2.2.1 = .done) :
    (m.name, ph, (judge lib (some dn) st m g ph).2.1) ∈ mc.transitions := by
  simp only [judge, Option.bind_some, hd] at hdone ⊢
  split at hdone
  · split at hdone
    · next st' ph' fx hrun =>
      simp only [runTurn, hm] at hrun
      split at hrun
      · simp at hrun
      · split at hrun
        · split at hrun
          · next p _ hmem => simp at hrun; obtain ⟨-, rfl, -⟩ := hrun; simp_all
          · simp at hrun
        · simp at hrun
    · simp at hdone
  · simp at hdone

theorem machine_sound (lib : Library) (es : List Event) (a : Addr) (e : Entry)
    (he : e ∈ (Kernel.empty.run lib es).journal a) (dn : String) (d : Def) (mc : Machine)
    (hdn : e.defn = some dn) (hd : lib dn = some d) (hm : d.machine = some mc) (hdone : e.outcome = .done) :
    (e.msg.name, e.phaseBefore, e.phaseAfter) ∈ mc.transitions := by
  have h := (Inv.run lib es).entries a e he
  rw [hdn] at h
  have hph : e.phaseAfter = _ := congrArg (·.2.1) h
  have hout : e.outcome = _ := congrArg (·.2.2.1) h
  rw [hph]
  exact judge_machine hd hm (hout ▸ hdone)

/-- A spawn's address is new: never sent to, no journal. A face placed again is a new incarnation. -/
theorem spawn_fresh (lib : Library) (es : List Event) (id : String) :
    let k := Kernel.empty.run lib es
    k.defs (k.next id) = none ∧ k.journal (k.next id) = [] ∧ ∀ s, k.inbox s (k.next id) = [] :=
  (Inv.run lib es).fresh _ (by simp [Kernel.Fresh, Kernel.next])

end Aven.Actor
