import Std.Tactic

set_option autoImplicit false

/-!
# Shutdown ownership

This lifecycle abstraction records the native host's existing shutdown repair,
after the implementation and its five Rust regressions. It is not Rust
extraction, a proof of Tokio/Tauri, or a claim about forced OS exits.

An owner names a Node which may still need its final save/fence. Both published
Devices/drives and unpublished startup Nodes are owners. `active` counts work
admitted before close, including the producer portion of a constructor waiting
for a ceremony. It does not count a cleanup-only continuation holding a mutex. Cancelling
an observer (`waiters`) does not cancel that work or own the runtime-stop signal.

Refinement assumptions, checked separately in Rust:
* Node identities are not reused in this host; capture occurs synchronously after
  spawn, before the next startup await. The retained reference owns its writer.
* Admission and lifecycle transitions are serialized by their mutexes / atomic
  gates. Every mutating producer is admitted and accounted for; cancelling a
  ceremony ends its producer portion, not its captured Node's fence.
* `fence` represents actual quiescence, a successful authoritative save and the
  real storage fence. It is not a timeout or an admission flag. This model does
  not prove bytes/fsync, completeness of the producer inventory, filesystem lock
  exclusivity, or the Rust-to-model correspondence.
* The embedding app keeps the host and runtime stop sender alive until `stop`.
  An independently owned close task runs despite cancelled waiters. Failure is
  terminal/cached. Scheduling progress is not assumed or proved here.

Admission phase, fence obligations, retained owners and runtime lifetime are
separate: closing admission alone cannot certify persistence. Individual fences
may succeed before aggregate failure; remaining obligations retain their owner.
-/
namespace AvenDB.ShutdownOwnership

abbrev Owner := Nat

inductive Phase where
  | running | closing | failed | fenced | stopped
  deriving DecidableEq, Repr

structure State where
  phase : Phase
  active : Nat
  required : Owner → Bool
  retained : Owner → Bool
  provisional : Owner → Bool
  runtime : Bool
  waiters : Nat

def initial : State :=
  { phase := .running, active := 0, required := fun _ => false,
    retained := fun _ => false, provisional := fun _ => false,
    runtime := true, waiters := 0 }

/-- Pointwise ownership updates keep unrelated nodes untouched. -/
def set (owners : Owner → Bool) (owner : Owner) (value : Bool) : Owner → Bool :=
  fun target => if target = owner then value else owners target

/-- Every unfinished fence retains an owner and runtime. Admitted work also
retains the runtime. Fenced/stopped states have neither work nor fence debt. -/
def Safe (s : State) : Prop :=
  (∀ owner, s.required owner = true → s.retained owner = true ∧ s.runtime = true) ∧
  (0 < s.active → s.runtime = true) ∧
  ((s.phase = .fenced ∨ s.phase = .stopped) →
    s.active = 0 ∧ ∀ owner, s.required owner = false) ∧
  (s.runtime = false → s.phase = .stopped)

/-- Allowed abstract transitions, not a runtime implementation. The `fence`
transition assumes the real save/fence succeeded, as documented above. -/
inductive Step : State → State → Prop where
  | admit (s : State) (hopen : s.phase = .running) (alive : s.runtime = true) :
      Step s { s with active := s.active + 1 }
  | capture (s : State) (owner : Owner) (admitted : 0 < s.active)
      (phase : s.phase = .running ∨ s.phase = .closing) :
      Step s { s with required := set s.required owner true, retained := set s.retained owner true, provisional := set s.provisional owner true }
  | publish (s : State) (owner : Owner) :
      Step s { s with provisional := set s.provisional owner false }
  | finishWork (s : State) (admitted : 0 < s.active) :
      Step s { s with active := s.active - 1 }
  | beginClose (s : State) (hopen : s.phase = .running) :
      Step s { s with phase := .closing }
  | awaitClose (s : State) : Step s { s with waiters := s.waiters + 1 }
  | cancelWaiter (s : State) : Step s { s with waiters := s.waiters - 1 }
  | diagnosticTimeout (s : State) : Step s s
  | fence (s : State) (owner : Owner) (closing : s.phase = .closing)
      (drained : s.active = 0) (needed : s.required owner = true) :
      Step s { s with required := set s.required owner false, retained := set s.retained owner false, provisional := set s.provisional owner false }
  | failClose (s : State) (closing : s.phase = .closing) (drained : s.active = 0) :
      Step s { s with phase := .failed }
  | allFenced (s : State) (closing : s.phase = .closing) (drained : s.active = 0)
      (fenced : ∀ owner, s.required owner = false) :
      Step s { s with phase := .fenced }
  | stop (s : State) (fenced : s.phase = .fenced) :
      Step s { s with phase := .stopped, runtime := false }

inductive Reachable : State → Prop where
  | initial : Reachable initial
  | next {s next : State} : Reachable s → Step s next → Reachable next

theorem initial_safe : Safe initial := by
  simp [Safe, initial]

/-- No permitted transition abandons unfinished persistence, including when
startup and close overlap. -/
theorem step_safe {s next : State} (safe : Safe s) (step : Step s next) : Safe next := by
  obtain ⟨owners, work, empty, runtime⟩ := safe
  cases step with
  | admit hopen alive =>
      exact ⟨owners, fun _ => alive, by simp [hopen], by simp [alive]⟩
  | capture owner admitted phase =>
      refine ⟨?_, work, ?_, runtime⟩
      · intro target needed
        by_cases h : target = owner
        · simp [set, h, work admitted]
        · simpa [set, h] using owners target (by simpa [set, h] using needed)
      · rcases phase with hopen | closing <;> simp_all
  | publish => exact ⟨owners, work, empty, runtime⟩
  | finishWork admitted =>
      refine ⟨owners, fun _ => work admitted, ?_, runtime⟩
      intro phase
      obtain ⟨none, held⟩ := empty phase
      exact ⟨by simp [none], held⟩
  | beginClose hopen =>
      exact ⟨owners, work, by simp, fun dead => by simpa [hopen] using runtime dead⟩
  | awaitClose => exact ⟨owners, work, empty, runtime⟩
  | cancelWaiter => exact ⟨owners, work, empty, runtime⟩
  | diagnosticTimeout => exact ⟨owners, work, empty, runtime⟩
  | fence owner closing drained needed =>
      refine ⟨?_, work, by simp [closing], runtime⟩
      intro target required
      by_cases h : target = owner
      · simp [set, h] at required
      · simpa [set, h] using owners target (by simpa [set, h] using required)
  | failClose closing drained =>
      exact ⟨owners, work, by simp, fun dead => by simpa [closing] using runtime dead⟩
  | allFenced closing drained fenced =>
      exact ⟨owners, work, fun _ => ⟨drained, fenced⟩,
        fun dead => by simpa [closing] using runtime dead⟩
  | stop fenced =>
      obtain ⟨drained, held⟩ := empty (Or.inl fenced)
      refine ⟨?_, ?_, fun _ => ⟨drained, held⟩, fun _ => rfl⟩
      · intro owner required
        simp [held owner] at required
      · simp [drained]

theorem reachable_safe {s : State} (reachable : Reachable s) : Safe s := by
  induction reachable with
  | initial => exact initial_safe
  | next _ step ih => exact step_safe ih step

/-- A queued startup cannot gain admission after close begins or fails. -/
theorem admit_requires_open {s next : State}
    (h : Step s next) (more : next.active = s.active + 1) : s.phase = .running := by
  cases h <;> simp_all <;> omega

/-- Cancelling a quit waiter changes only its observer count. -/
theorem cancelled_waiter_keeps_obligations (s : State) :
    let next := { s with waiters := s.waiters - 1 }
    next.active = s.active ∧ next.required = s.required ∧ next.retained = s.retained ∧
      next.phase = s.phase ∧ next.runtime = s.runtime := by
  simp

/-- Publication transfers provisional bookkeeping, never a durability obligation. -/
theorem publication_keeps_obligations (s : State) (owner : Owner) :
    let next := { s with provisional := set s.provisional owner false }
    next.required = s.required ∧ next.retained = s.retained ∧ next.runtime = s.runtime := by
  simp

/-- An admitted constructor can capture its Node after close began. It is
retained immediately, including before a second ceremony. -/
theorem capture_while_closing {s : State} (owner : Owner) (active : 0 < s.active)
    (closing : s.phase = .closing) :
    ∃ next, Step s next ∧ next.required owner = true ∧ next.retained owner = true ∧
      next.provisional owner = true ∧ next.phase = .closing := by
  refine ⟨_, Step.capture s owner active (Or.inr closing), ?_⟩
  simp [set, closing]

/-- Closing admission preserves all admitted work and every persistence debt. -/
theorem begin_close_preserves_debt (s : State) :
    let next := { s with phase := Phase.closing }
    next.active = s.active ∧ next.required = s.required ∧ next.retained = s.retained := by
  simp

/-- Completing/cancelling a ceremony does not fence its provisional Node. -/
theorem finishing_work_keeps_owner (s : State) :
    let next := { s with active := s.active - 1 }
    next.required = s.required ∧ next.retained = s.retained := by
  simp

/-- A cached failure stays terminal; later observations cannot release an owner. -/
theorem failed_step_retains {s next : State} (failed : s.phase = .failed)
    (step : Step s next) : next.phase = .failed ∧ next.required = s.required ∧
      next.retained = s.retained ∧ next.runtime = s.runtime := by
  cases step <;> simp_all

/-- A finite sequence of the admitted lifecycle observations. -/
inductive Steps : State → State → Prop where
  | refl (s : State) : Steps s s
  | tail {s middle next : State} : Steps s middle → Step middle next → Steps s next

/-- Failure retention is preserved through any finite sequence of later calls,
not only the next waiter cancellation or repeated observation. -/
theorem failed_trace_retains {s next : State} (failed : s.phase = .failed)
    (steps : Steps s next) : next.phase = .failed ∧ next.required = s.required ∧
      next.retained = s.retained ∧ next.runtime = s.runtime := by
  induction steps with
  | refl => exact ⟨failed, rfl, rfl, rfl⟩
  | tail _ step ih =>
      obtain ⟨phase, required, retained, runtime⟩ := failed_step_retains ih.1 step
      exact ⟨phase, required.trans ih.2.1, retained.trans ih.2.2.1, runtime.trans ih.2.2.2⟩

/-- A reachable failed close, even without remaining owners, keeps its runtime. -/
theorem failed_runtime_alive {s : State} (reachable : Reachable s) (failed : s.phase = .failed) :
    s.runtime = true := by
  have safe := reachable_safe reachable
  cases alive : s.runtime with
  | false => have impossible := safe.2.2.2 alive; simp [failed] at impossible
  | true => rfl

/-- Runtime release requires aggregate fencing, not closed admission, an empty
waiter list, a timer, or one successful child fence. -/
theorem runtime_release_requires_all_fences {s next : State} (safe : Safe s)
    (step : Step s next) (alive : s.runtime = true) (ended : next.runtime = false) :
    s.phase = .fenced ∧ s.active = 0 ∧ ∀ owner, s.required owner = false := by
  cases step <;> simp_all
  exact safe.2.2.1 (Or.inl ‹s.phase = .fenced›)

/-- Every reachable outstanding owner, including failed provisional startup,
retains its writer owner and a runtime in which its work can run. -/
theorem unfinished_owner_retained {s : State} (reachable : Reachable s) (owner : Owner)
    (required : s.required owner = true) : s.retained owner = true ∧ s.runtime = true :=
  (reachable_safe reachable).1 owner required

end AvenDB.ShutdownOwnership
