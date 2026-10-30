/-!
# The runtime contract (README, "The runtime contract")

A runtime is `run(part, input) → output | failure`. The module is WebAssembly; Lean states what it means: an answer for
each part and input, and what computing it costs in fuel and memory. The host's `run` checks the input's schema and
the limits, and checks the output's size and schema. Nothing else goes in: no clock, no randomness, no host state.
Determinism is the type of `run`.

Part, input and output are any types here. Once `Aven.Core` lands they are its Values, and hashes its hashes.
-/

namespace Aven.Runtime

/-- The limits a run is held to: fuel (instructions), memory (bytes) and output (bytes). -/
structure Limits where
  fuel : Nat
  memory : Nat
  output : Nat
  deriving DecidableEq, Repr

/-- `l` is no more than `l'` in every limit. -/
def Limits.le (l l' : Limits) : Prop := l.fuel ≤ l'.fuel ∧ l.memory ≤ l'.memory ∧ l.output ≤ l'.output

/-- Why a run failed. A failure is a value too, the same on every device. -/
inductive Failure where
  | badInput
  | outOfFuel
  | outOfMemory
  | refused
  | outputTooLarge
  | badOutput
  deriving DecidableEq, Repr

/-- What a runtime means: its answer for a part and an input (`refused` when the part isn't in its format), the fuel
and memory computing it takes, its schemas and the size of an output. -/
structure Runtime (P I O : Type) where
  eval : P → I → Except Failure O
  fuel : P → I → Nat
  memory : P → I → Nat
  input : I → Bool
  output : O → Bool
  size : O → Nat

/-- The host's run: the input's schema, then fuel and memory, then the answer, then the output's size and schema. -/
def run {P I O : Type} (r : Runtime P I O) (l : Limits) (p : P) (i : I) : Except Failure O :=
  if !r.input i then .error .badInput
  else if r.fuel p i > l.fuel then .error .outOfFuel
  else if r.memory p i > l.memory then .error .outOfMemory
  else match r.eval p i with
    | .error e => .error e
    | .ok o =>
      if r.size o > l.output then .error .outputTooLarge
      else if !r.output o then .error .badOutput
      else .ok o

variable {P I O : Type}

/-- Every answer fits its schema and its output limit. -/
theorem run_ok_fits {r : Runtime P I O} {l : Limits} {p : P} {i : I} {o : O} (h : run r l p i = .ok o) :
    r.output o = true ∧ r.size o ≤ l.output ∧ r.input i = true ∧ r.eval p i = .ok o := by
  unfold run at h
  by_cases hi : r.input i <;> simp [hi] at h
  by_cases hf : r.fuel p i > l.fuel <;> simp [hf] at h
  by_cases hm : r.memory p i > l.memory <;> simp [hm] at h
  cases he : r.eval p i with
  | error e => simp [he] at h
  | ok o' =>
    simp only [he] at h
    by_cases hs : r.size o' > l.output <;> simp [hs] at h
    by_cases ho : r.output o' <;> simp [ho] at h
    subst h
    exact ⟨ho, by omega, hi, rfl⟩

/-- More room never changes an answer: what runs within some limits gives the same output within larger ones. So a
device that allows more agrees with one that allows less, wherever the smaller one answers. -/
theorem run_more_room {r : Runtime P I O} {l l' : Limits} {p : P} {i : I} {o : O} (hl : l.le l')
    (h : run r l p i = .ok o) : run r l' p i = .ok o := by
  obtain ⟨hf', hm', ho'⟩ := hl
  unfold run at h ⊢
  by_cases hi : r.input i <;> simp [hi] at h ⊢
  by_cases hf : r.fuel p i > l.fuel <;> simp [hf] at h
  by_cases hm : r.memory p i > l.memory <;> simp [hm] at h
  have : ¬ r.fuel p i > l'.fuel := by omega
  have : ¬ r.memory p i > l'.memory := by omega
  simp [*]
  cases he : r.eval p i with
  | error e => simp [he] at h
  | ok o' =>
    simp only [he] at h ⊢
    by_cases hs : r.size o' > l.output <;> simp [hs] at h
    have : ¬ r.size o' > l'.output := by omega
    simp [this]
    exact h

/-- What a device has besides the run's arguments: its clock and its randomness. -/
structure Device where
  clock : Nat
  seed : Nat

/-- A run on a device: the device's clock and randomness never reach the runtime. A shim inside the module answers a
compiled engine's clock and random calls from the input alone. -/
def runOn {P I O : Type} (_d : Device) (r : Runtime P I O) (l : Limits) (p : P) (i : I) : Except Failure O :=
  run r l p i

/-- Two devices give the same result for the same runtime, limits, part and input. -/
theorem deterministic (d d' : Device) (r : Runtime P I O) (l : Limits) (p : P) (i : I) :
    runOn d r l p i = runOn d' r l p i := rfl

/-! ## Versions and floors (README, "Names, versions, hashes and floors") -/

/-- The version a part runs on: the one it names, or the floor when it names an older one. -/
def resolve (floor named : Nat) : Nat := max floor named

theorem resolve_ge_floor (floor named : Nat) : floor ≤ resolve floor named := Nat.le_max_left _ _

theorem resolve_named {floor named : Nat} (h : floor ≤ named) : resolve floor named = named := Nat.max_eq_right h

theorem resolve_floor {floor named : Nat} (h : named ≤ floor) : resolve floor named = floor := Nat.max_eq_left h

/-! ## The module a host admits (README, "The runtime contract") -/

/-- What the host reads from a module's bytes before it compiles one: its imports, whether it declares a maximum
memory (in 64 KiB pages) and whether it exports `alloc`, `run` and one memory. -/
structure Module where
  imports : List String
  maxPages : Option Nat
  exportsAbi : Bool
  deriving DecidableEq, Repr

/-- A module is admitted when it imports nothing at all, declares a maximum memory within the limit, and exports the
ABI. -/
def admit (pages : Nat) (m : Module) : Bool :=
  m.imports.isEmpty && m.exportsAbi && match m.maxPages with
    | some p => decide (p ≤ pages)
    | none => false

theorem admit_imports_nothing {pages : Nat} {m : Module} (h : admit pages m = true) : m.imports = [] := by
  unfold admit at h
  simp only [Bool.and_eq_true] at h
  exact List.isEmpty_iff.mp h.1.1

theorem admit_memory {pages : Nat} {m : Module} (h : admit pages m = true) : ∃ p, m.maxPages = some p ∧ p ≤ pages := by
  unfold admit at h
  simp only [Bool.and_eq_true] at h
  cases hp : m.maxPages with
  | none => simp [hp] at h
  | some p => simp [hp] at h; exact ⟨p, rfl, h.2⟩

/-! ## The manifest (README, "Only from the repository") -/

/-- One frozen runtime, named by its module's hash. `H` is `Aven.Core`'s hash. -/
structure Frozen (H : Type) where
  name : String
  version : Nat
  hash : H
  floor : Nat
  deriving DecidableEq, Repr

/-- A new manifest only appends to the old one. -/
def Manifest.extends {H : Type} (old new : List (Frozen H)) : Prop := old <+: new

/-- A frozen entry never changes: whatever stood at a place in the old manifest stands there in the new one. -/
theorem frozen {H : Type} {old new : List (Frozen H)} (h : Manifest.extends old new) {n : Nat} {e : Frozen H}
    (he : old[n]? = some e) : new[n]? = some e := by
  obtain ⟨rest, rfl⟩ := h
  rw [List.getElem?_append_left (List.getElem?_eq_some_iff.mp he).1]
  exact he

/-- A host loads bytes only by a hash the manifest lists, and only when the bytes are named by it. -/
def loads {H : Type} [DecidableEq H] (hashOf : List UInt8 → H) (manifest : List (Frozen H)) (want : H)
    (bytes : List UInt8) : Bool :=
  manifest.any (·.hash == want) && hashOf bytes == want

theorem loads_listed {H : Type} [DecidableEq H] {hashOf : List UInt8 → H} {manifest : List (Frozen H)} {want : H}
    {bytes : List UInt8} (h : loads hashOf manifest want bytes = true) :
    ∃ e ∈ manifest, e.hash = hashOf bytes := by
  unfold loads at h
  simp only [Bool.and_eq_true, List.any_eq_true, beq_iff_eq] at h
  obtain ⟨⟨e, he, rfl⟩, hb⟩ := h
  exact ⟨e, he, hb.symm⟩

end Aven.Runtime
