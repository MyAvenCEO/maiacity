import Aven.Actor.Asks

/-!
# Machines are data (ARCHITECTURE.md, section 6)

A machine is a table: per phase, the messages it allows and the phases each may lead to. What Prolog did for it is
split: its facts are the table, its checks are `Machine.wellFormed`, run once when a definition is admitted, and
proven sound here. From them:

- `wellFormed_sound`: an admitted machine's initial phase and every target are declared, every message it names is
  in the interface, and every declared phase is reachable.
- `phase_reachable`: a live actor under a machine is always in a phase reachable from the initial one, and so a
  declared one.
-/

namespace Aven.Actor

/-- The phases a machine can reach from its initial phase, by steps its table allows. -/
inductive Machine.Reachable (mc : Machine) : String → Prop
  | initial : Machine.Reachable mc mc.initial
  | step {p q : String} (name : String) :
      Machine.Reachable mc p → mc.allows name p q = true → Machine.Reachable mc q

theorem Machine.allows_iff (mc : Machine) (name p q : String) :
    mc.allows name p q = true ↔ ∃ e ∈ mc.phases, e.1 = p ∧ ∃ t ∈ e.2, t.1 = name ∧ q ∈ t.2 := by
  simp only [Machine.allows, Machine.targets, List.contains_iff_mem, List.mem_flatMap, List.mem_filter,
    beq_iff_eq]
  constructor
  · rintro ⟨e, ⟨he, rfl⟩, t, ⟨ht, rfl⟩, hq⟩; exact ⟨e, he, rfl, t, ht, rfl, hq⟩
  · rintro ⟨e, he, rfl, t, ht, rfl, hq⟩; exact ⟨e, ⟨he, rfl⟩, t, ⟨ht, rfl⟩, hq⟩

theorem Machine.grow_sound (mc : Machine) (ps : List String) (hps : ∀ x ∈ ps, mc.Reachable x) :
    ∀ x ∈ mc.grow ps, mc.Reachable x := by
  intro x hx
  simp only [Machine.grow, List.mem_append, List.mem_flatMap, List.mem_filter, List.contains_iff_mem] at hx
  rcases hx with hx | ⟨e, ⟨he, hc⟩, t, ht, hxt⟩
  · exact hps x hx
  · exact .step t.1 (hps _ hc) ((mc.allows_iff _ _ _).mpr ⟨e, he, rfl, t, ht, rfl, hxt⟩)

theorem Machine.reach_sound (mc : Machine) : ∀ x ∈ mc.reach, mc.Reachable x := by
  unfold Machine.reach
  generalize mc.phases.length = n
  induction n with
  | zero => intro x hx; simp only [Nat.repeat, List.mem_singleton] at hx; subst hx; exact .initial
  | succ n ih => exact mc.grow_sound _ ih

/-- What admission guarantees. -/
theorem Machine.wellFormed_sound {mc : Machine} {messages : List String} (h : mc.wellFormed messages = true) :
    mc.initial ∈ mc.declared ∧
      (∀ e ∈ mc.phases, ∀ t ∈ e.2, t.1 ∈ messages ∧ ∀ q ∈ t.2, q ∈ mc.declared) ∧
      ∀ p ∈ mc.declared, mc.Reachable p := by
  simp only [Machine.wellFormed, Bool.and_eq_true, List.contains_iff_mem, List.all_eq_true] at h
  obtain ⟨⟨h1, h2⟩, h3⟩ := h
  refine ⟨h1, fun e he t ht => ⟨(h2 e he t ht).1, fun q hq => (h2 e he t ht).2 q hq⟩,
    fun p hp => mc.reach_sound p (h3 p hp)⟩

/-- In an admitted machine, every reachable phase is declared. -/
theorem Machine.reachable_declared {mc : Machine} {messages : List String} (h : mc.wellFormed messages = true)
    {p : String} (hp : mc.Reachable p) : p ∈ mc.declared := by
  obtain ⟨h1, h2, -⟩ := Machine.wellFormed_sound h
  cases hp with
  | initial => exact h1
  | step name _ ha =>
    obtain ⟨e, he, -, t, ht, -, hq⟩ := (mc.allows_iff _ _ _).mp ha
    exact (h2 e he t ht).2 _ hq

/-! ## The kernel keeps every actor in a reachable phase -/

/-- Every live actor under a machine runs an admitted definition and is in a reachable phase. -/
def PhaseInv (lib : Library) (k : Kernel) : Prop :=
  ∀ a dn d mc, k.defs a = some dn → lib dn = some d → d.machine = some mc →
    d.admit = true ∧ mc.Reachable (k.phase a)

theorem PhaseInv.frame {lib : Library} {k k' : Kernel} (hk : PhaseInv lib k) (hd : k'.defs = k.defs)
    (hp : k'.phase = k.phase) : PhaseInv lib k' := by
  intro a dn d mc h1 h2 h3
  rw [hd] at h1; rw [hp]; exact hk a dn d mc h1 h2 h3

theorem Kernel.answer_frame (k : Kernel) (me : Addr) (re : MsgId) (p : Value) (w : Option Reason) :
    (k.answer me re p w).defs = k.defs ∧ (k.answer me re p w).phase = k.phase := by
  unfold Kernel.answer; split
  · cases w <;> exact ⟨rfl, rfl⟩
  · exact ⟨rfl, rfl⟩

theorem Kernel.send_frame (k : Kernel) (s : Addr) (e : Effect) :
    (k.send s e).defs = k.defs ∧ (k.send s e).phase = k.phase := by
  cases e with
  | tell => simp only [Kernel.send]; split <;> exact ⟨rfl, rfl⟩
  | ask => simp only [Kernel.send]; split <;> exact ⟨rfl, rfl⟩
  | reply re p => exact Kernel.answer_frame ..

theorem PhaseInv.sendAll {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (s : Addr) (fx : List Effect) :
    PhaseInv lib (k.sendAll s fx) := by
  induction fx generalizing k with
  | nil => exact hk
  | cons e fx ih => exact ih (hk.frame (Kernel.send_frame k s e).1 (Kernel.send_frame k s e).2)

theorem PhaseInv.answer {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (me : Addr) (re : MsgId) (p : Value)
    (w : Option Reason) : PhaseInv lib (k.answer me re p w) :=
  hk.frame (Kernel.answer_frame ..).1 (Kernel.answer_frame ..).2

/-- Under a machine, a handled message leaves the phase as it was, or takes a step the table allows. -/
theorem judge_phase {lib : Library} {dn : String} {d : Def} {mc : Machine} (hd : lib dn = some d)
    (hm : d.machine = some mc) (st : Value) (m : Message) (g : Given) (ph : String) :
    (judge lib (some dn) st m g ph).2.1 = ph ∨ mc.allows m.name ph (judge lib (some dn) st m g ph).2.1 = true := by
  by_cases hdone : (judge lib (some dn) st m g ph).2.2.1 = .done
  · exact .inr (judge_machine hd hm hdone)
  · left
    simp only [judge, Option.bind_some, hd] at hdone ⊢
    by_cases hg : gate d m ph = true
    · simp only [hg, ite_true] at hdone ⊢
      cases hr : runTurn d st m g ph with
      | none => simp
      | some v => obtain ⟨a, b, c⟩ := v; simp [hr] at hdone
    · simp [hg]

theorem PhaseInv.handle {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (r s : Addr) :
    PhaseInv lib (k.handle lib r s) := by
  unfold Kernel.handle
  split
  · exact hk
  · next m _ =>
    have hk' : PhaseInv lib { k with
        read := upd2 k.read r s (k.read r s + 1)
        journal := upd k.journal r (k.journal r ++
          [⟨m, k.defs r, ⟨k.now, (k.journal r).length⟩, k.state r, k.phase r,
            (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).1,
            (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).2.1,
            (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).2.2.2,
            (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).2.2.1⟩])
        state := upd k.state r (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).1
        phase := upd k.phase r
          (judge lib (k.defs r) (k.state r) m ⟨k.now, (k.journal r).length⟩ (k.phase r)).2.1 } := by
      intro a dn d mc h1 h2 h3
      obtain ⟨hadm, hreach⟩ := hk a dn d mc h1 h2 h3
      refine ⟨hadm, ?_⟩
      simp only [upd]
      split
      · next ha =>
        subst ha
        rw [h1]
        rcases judge_phase h2 h3 (k.state a) m ⟨k.now, (k.journal a).length⟩ (k.phase a) with h | h
        · rw [h]; exact hreach
        · exact .step _ hreach h
      · exact hreach
    dsimp only
    split
    · exact hk'.sendAll _ _
    · exact hk'.answer _ _ _ _
    · exact hk'.answer _ _ _ _
    · exact hk'

theorem PhaseInv.spawn {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (id dn : String) :
    PhaseInv lib (k.spawn lib id dn) := by
  unfold Kernel.spawn
  split
  · exact hk
  · next d hd =>
    have hd' : lib dn = some d ∧ d.admit = true := by
      simpa [Option.filter_eq_some_iff] using hd
    intro a dn' d' mc h1 h2 h3
    simp only [upd] at h1 ⊢
    split at h1
    · next ha =>
      subst ha
      cases h1
      rw [hd'.1] at h2; cases h2
      refine ⟨hd'.2, ?_⟩
      simp only [ite_true, Def.initialPhase, h3, Option.map_some, Option.getD_some]
      exact .initial
    · next ha =>
      simp only [ha, ite_false]
      exact hk a dn' d' mc h1 h2 h3

theorem PhaseInv.retire {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (a : Addr) :
    PhaseInv lib (k.retire a) := by
  intro b dn d mc h1 h2 h3
  simp only [Kernel.retire, upd] at h1
  split at h1
  · cases h1
  · exact hk b dn d mc h1 h2 h3

theorem PhaseInv.timeouts {lib : Library} {k : Kernel} (hk : PhaseInv lib k) (ps : List (MsgId × Nat)) :
    PhaseInv lib (ps.foldl (fun k p => k.answer p.1.to p.1 .null (some .timeout)) k) := by
  induction ps generalizing k with
  | nil => exact hk
  | cons p ps ih => exact ih (hk.answer _ _ _ _)

theorem PhaseInv.step {lib : Library} {k : Kernel} (hk : PhaseInv lib k) :
    ∀ e, PhaseInv lib (k.step lib e)
  | .handle r s => hk.handle r s
  | .tick t => PhaseInv.timeouts (k := { k with now := max k.now t }) (hk.frame rfl rfl) _
  | .spawn id dn => hk.spawn id dn
  | .retire a => hk.retire a
  | .send _ => hk.frame (Kernel.send_frame ..).1 (Kernel.send_frame ..).2

theorem PhaseInv.run (lib : Library) (es : List Event) : PhaseInv lib (Kernel.empty.run lib es) := by
  suffices ∀ k, PhaseInv lib k → PhaseInv lib (k.run lib es) from
    this _ (by intro a dn d mc h; simp [Kernel.empty] at h)
  induction es with
  | nil => intro k hk; exact hk
  | cons e es ih =>
    intro k hk
    simp only [Kernel.run, List.foldl_cons]
    exact ih _ (hk.step e)

/-- A live actor under a machine is always in a phase reachable from the initial one, and so a declared one. -/
theorem phase_reachable (lib : Library) (es : List Event) (a : Addr) (dn : String) (d : Def) (mc : Machine)
    (h1 : (Kernel.empty.run lib es).defs a = some dn) (h2 : lib dn = some d) (h3 : d.machine = some mc) :
    mc.Reachable ((Kernel.empty.run lib es).phase a) ∧ (Kernel.empty.run lib es).phase a ∈ mc.declared := by
  obtain ⟨hadm, hreach⟩ := PhaseInv.run lib es a dn d mc h1 h2 h3
  have hwf : mc.wellFormed d.messages = true := by simpa [Def.admit, h3] using hadm
  exact ⟨hreach, Machine.reachable_declared hwf hreach⟩

end Aven.Actor
