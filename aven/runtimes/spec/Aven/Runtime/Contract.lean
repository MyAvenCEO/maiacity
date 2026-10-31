import Aven.Core

/-!
# The runtime contract (README, "The runtime contract")

A runtime is `run(part, input) → output | failure`, over `Aven.Core`'s Values. The module is WebAssembly; Lean states
what it means: an answer for each part and input, and what computing it costs in fuel and memory. The host's `run`
checks the input's schema and the limits, and checks the output's size, its encoding's length in the one codec, and
its schema. Nothing else goes in: no clock, no randomness, no host state. Determinism is the type of `run`.

A runtime is named by the hash of its module's bytes, a render's cache key by the name of a Value, and the manifest
lists modules by hash: all `Aven.Core`'s hashes.
-/

namespace Aven.Runtime

open Aven.Core

/-- A string's bytes. -/
def ascii (s : String) : Bytes := s.toUTF8.toList

/-- The limits a run is held to: fuel (instructions), memory (bytes) and output (bytes of its encoding). -/
structure Limits where
  fuel : Nat
  memory : Nat
  output : Nat
  deriving DecidableEq, Repr

/-- `l` is no more than `l'` in every limit. -/
def Limits.le (l l' : Limits) : Prop := l.fuel ≤ l'.fuel ∧ l.memory ≤ l'.memory ∧ l.output ≤ l'.output

/-- Why a run failed. A failure is a Value too, the same on every device. -/
inductive Failure where
  | badInput
  | outOfFuel
  | outOfMemory
  | refused
  | outputTooLarge
  | badOutput
  deriving DecidableEq, Repr

def Failure.name : Failure → String
  | .badInput => "badInput"
  | .outOfFuel => "outOfFuel"
  | .outOfMemory => "outOfMemory"
  | .refused => "refused"
  | .outputTooLarge => "outputTooLarge"
  | .badOutput => "badOutput"

/-- What a runtime means: its answer for a part and an input (`refused` when the part isn't in its format), the fuel
and memory computing it takes, and its schemas. -/
structure Runtime where
  eval : Value → Value → Except Failure Value
  fuel : Value → Value → Nat
  memory : Value → Value → Nat
  input : Value → Bool
  output : Value → Bool

/-- The host's run: the input's schema, then fuel and memory, then the answer, then its encoding's length and its
schema. -/
def run (r : Runtime) (l : Limits) (p i : Value) : Except Failure Value :=
  if !r.input i then .error .badInput
  else if r.fuel p i > l.fuel then .error .outOfFuel
  else if r.memory p i > l.memory then .error .outOfMemory
  else match r.eval p i with
    | .error e => .error e
    | .ok o =>
      if (encode o).length > l.output then .error .outputTooLarge
      else if !r.output o then .error .badOutput
      else .ok o

/-- A run's result as the Value the host hands on: `{"ok": output}` or `{"failure": name}`. -/
def result : Except Failure Value → Value
  | .ok o => .map [(ascii "ok", o)]
  | .error f => .map [(ascii "failure", .text (ascii f.name))]

/-- Every answer fits its schema and its output limit, as encoded. -/
theorem run_ok_fits {r : Runtime} {l : Limits} {p i o : Value} (h : run r l p i = .ok o) :
    r.output o = true ∧ (encode o).length ≤ l.output ∧ r.input i = true ∧ r.eval p i = .ok o := by
  unfold run at h
  by_cases hi : r.input i <;> simp [hi] at h
  by_cases hf : r.fuel p i > l.fuel <;> simp [hf] at h
  by_cases hm : r.memory p i > l.memory <;> simp [hm] at h
  cases he : r.eval p i with
  | error e => simp [he] at h
  | ok o' =>
    simp only [he] at h
    by_cases hs : (encode o').length > l.output <;> simp [hs] at h
    by_cases ho : r.output o' <;> simp [ho] at h
    subst h
    exact ⟨ho, by omega, hi, rfl⟩

/-- More room never changes an answer: what runs within some limits gives the same output within larger ones. So a
device that allows more agrees with one that allows less, wherever the smaller one answers. -/
theorem run_more_room {r : Runtime} {l l' : Limits} {p i o : Value} (hl : l.le l') (h : run r l p i = .ok o) :
    run r l' p i = .ok o := by
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
    by_cases hs : (encode o').length > l.output <;> simp [hs] at h
    have : ¬ (encode o').length > l'.output := by omega
    simp [this]
    exact h

/-- What a device has besides the run's arguments: its clock and its randomness. -/
structure Device where
  clock : Nat
  seed : Nat

/-- A run on a device: the device's clock and randomness never reach the runtime. A shim inside the module answers a
compiled engine's clock and random calls from the input alone. -/
def runOn (_d : Device) (r : Runtime) (l : Limits) (p i : Value) : Except Failure Value := run r l p i

/-- Two devices give the same result for the same runtime, limits, part and input. -/
theorem deterministic (d d' : Device) (r : Runtime) (l : Limits) (p i : Value) :
    runOn d r l p i = runOn d' r l p i := rfl

/-! ## Pins, withdrawals and floors (README, "Names, versions, hashes and floors"; A7, A42) -/

/-- What a Doc's or a vault's owners did to a runtime, in its history (A7): pinned it, or withdrew the pin, by its
hash. A hole in a runtime is closed by withdrawing its pin, never by a floor that rises with releases. -/
inductive PinAct where
  | pin (h : Hash)
  | withdraw (h : Hash)
  deriving DecidableEq, Repr

/-- Whether `h` is pinned after these acts, in order: the last act on it decides. -/
def pinned (acts : List PinAct) (h : Hash) : Bool :=
  acts.foldl (fun b a => match a with
    | .pin h' => if h' = h then true else b
    | .withdraw h' => if h' = h then false else b) false

/-- **The runtime a verdict runs:** exactly the hash the envelope names, when it is pinned in the envelope's past;
otherwise none, and the envelope is refused. Never a floor and never a newer version: every reader re-lowers alike
(K7, rule 4). -/
def verdictRuntime (past : List PinAct) (named : Hash) : Option Hash :=
  if pinned past named then some named else none

theorem verdict_named {past : List PinAct} {named h : Hash} (hv : verdictRuntime past named = some h) : h = named := by
  unfold verdictRuntime at hv
  split at hv
  · exact (Option.some.inj hv).symm
  · cases hv

theorem pinned_append (acts more : List PinAct) (h : Hash) :
    pinned (acts ++ more) h = more.foldl (fun b a => match a with
      | .pin h' => if h' = h then true else b
      | .withdraw h' => if h' = h then false else b) (pinned acts h) := by
  simp [pinned, List.foldl_append]

/-- A withdrawal closes the hash for every envelope whose past holds it, until a pin again. -/
theorem withdraw_closes (acts : List PinAct) (h : Hash) : verdictRuntime (acts ++ [.withdraw h]) h = none := by
  simp [verdictRuntime, pinned_append]

/-- **Readers agree:** two readers whose histories hold the same envelope's past, whatever came after it (a later
withdrawal, a later pin), run the same runtime for it, or both refuse it. -/
theorem readers_agree_pins (past later later' : List PinAct) (named : Hash) :
    verdictRuntime ((past ++ later).take past.length) named =
      verdictRuntime ((past ++ later').take past.length) named := by
  simp

/-- **A floor binds only what a device runs for itself:** its renders and their cache. A file render runs the newest
version the registry names; a cached render below the runtime's floor is dropped. -/
def cacheKeeps (floor version : Nat) : Bool := decide (floor ≤ version)

theorem cache_drops {floor version : Nat} (h : version < floor) : cacheKeeps floor version = false := by
  simp [cacheKeeps]; omega

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

/-- One frozen runtime, named by its module's hash. -/
structure Frozen where
  name : String
  version : Nat
  hash : Hash
  floor : Nat
  deriving DecidableEq, Repr

/-- A new manifest only appends to the old one. -/
def Manifest.extends (old new : List Frozen) : Prop := old <+: new

/-- A frozen entry never changes: whatever stood at a place in the old manifest stands there in the new one. -/
theorem frozen {old new : List Frozen} (h : Manifest.extends old new) {n : Nat} {e : Frozen}
    (he : old[n]? = some e) : new[n]? = some e := by
  obtain ⟨rest, rfl⟩ := h
  rw [List.getElem?_append_left (List.getElem?_eq_some_iff.mp he).1]
  exact he

/-- A host loads bytes only by a hash the manifest lists, and only when `H` names the bytes by it. -/
def loads (H : Bytes → Hash) (manifest : List Frozen) (want : Hash) (bytes : Bytes) : Bool :=
  manifest.any (·.hash == want) && H bytes == want

theorem loads_listed {H : Bytes → Hash} {manifest : List Frozen} {want : Hash} {bytes : Bytes}
    (h : loads H manifest want bytes = true) : ∃ e ∈ manifest, e.hash = H bytes := by
  unfold loads at h
  simp only [Bool.and_eq_true, List.any_eq_true, beq_iff_eq] at h
  obtain ⟨⟨e, he, rfl⟩, hb⟩ := h
  exact ⟨e, he, hb.symm⟩

/-! ## A render's cache key (README, "The file registry", 5) -/

/-- What a render is cached by: the runtime's hash, the file's hash and the render's params. -/
structure RenderKey where
  runtime : Hash
  file : Hash
  params : Value
  deriving Repr

def RenderKey.value (k : RenderKey) : Value := .array [k.runtime.value, k.file.value, k.params]

/-- The key's name: the hash of its Value's one encoding. -/
def RenderKey.name (H : Bytes → Hash) (k : RenderKey) : Hash := nameOf H k.value

/-- Two allowed keys with one name are one key: a cached render is never handed out for another runtime, file or
params, as long as the hash doesn't collide. -/
theorem renderKey_inj {H : Bytes → Hash} (hH : Injective H) {a b : RenderKey} (ha : Canon a.value = true)
    (hb : Canon b.value = true) (h : a.name H = b.name H) : a.runtime = b.runtime ∧ a.file = b.file ∧
    a.params = b.params := by
  have hv := nameOf_inj hH ha hb h
  obtain ⟨ar, af, ap⟩ := a
  obtain ⟨br, bf, bp⟩ := b
  obtain ⟨arb⟩ := ar
  obtain ⟨afb⟩ := af
  obtain ⟨brb⟩ := br
  obtain ⟨bfb⟩ := bf
  simp only [RenderKey.value, Hash.value, Value.array.injEq, List.cons.injEq, Value.bytes.injEq, and_true] at hv
  obtain ⟨rfl, rfl, rfl⟩ := hv
  exact ⟨rfl, rfl, rfl⟩

end Aven.Runtime
