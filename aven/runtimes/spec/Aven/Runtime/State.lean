import Aven.Runtime.Contract
import Aven.Actor.Kernel

/-!
# state-runtime (aven/actor/ARCHITECTURE.md, section 5; README, "Moving the actors' runtimes and the plugins in")

A declarative turn: no code, so it always ends. Its part is a statechart and a reducer as data, a list of handlers,
each for one message:

- **moves:** the statechart's edges for that message, `from → to`. A handler applies only in a phase it moves from;
  the first that does is the one that runs. An actor without a machine uses one phase, `""`.
- **updates:** the reducer, applied in order to the state: `set`, `merge`, `append` and `remove`, each at a path of
  map fields and array indexes, with values from the message's payload, the state before, the turn's given or a
  literal.
- **sends:** the effects: `tell` and `ask` to the sender or to an address held in the state, and `reply` to the ask
  being handled.

`step` is total and deterministic. Under the contract (`stateRuntime`) the part and the input are Values of the one
codec, its fuel is a count of the part's work, and its output is the turn's output as a Value. What it guarantees:

- `step_moves`: a step that answers took one of the part's moves for that message and phase; one that doesn't refuses.
- `step_allowed`: when the part fits a machine (`fits`, which admission checks), every answer is a transition the
  machine allows.
- `runTurn_state`: so the actors' kernel (`Aven.Actor.runTurn`) accepts every answer of a state part that fits its
  definition's machine, and `Aven.Actor.machine_sound` covers it.
- `state_output_fits` and `state_never_badOutput`: every answer has the output's shape.
- `state_more_room`: more fuel never changes an answer.

The kernel's `Def.turn` takes the state, the message and the given, not the phase; a state part's moves need the phase,
so `stateTurn` takes it, and the join is stated per phase (`runTurn_state`).
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode keyBytes lexLt)
open Aven.Actor (Addr MsgId Kind Message Effect Given Machine Def runTurn)

abbrev TurnOut := Aven.Actor.Output

/-! ## The grammar -/

inductive Key where
  | field (name : Bytes)
  | index (n : Nat)
  deriving DecidableEq, Repr, Inhabited

abbrev Path := List Key

/-- Where a value comes from. -/
inductive Expr where
  | lit (v : Value)
  | payload (p : Path)
  | state (p : Path)
  | now
  | seed
  deriving Repr, Inhabited

inductive Update where
  | set (p : Path) (e : Expr)
  | merge (p : Path) (e : Expr)
  | append (p : Path) (e : Expr)
  | remove (p : Path)
  deriving Repr, Inhabited

/-- Whom a send goes to: the message's sender, or an address held in the state (`[scope, id, n]`). -/
inductive Target where
  | sender
  | state (p : Path)
  deriving Repr, Inhabited

inductive Send where
  | tell (to : Target) (name : String) (e : Expr)
  | ask (to : Target) (name : String) (e : Expr) (within : Nat)
  | reply (e : Expr)
  deriving Repr, Inhabited

structure Handler where
  on : String
  moves : List (String × String)
  updates : List Update
  sends : List Send
  deriving Repr, Inhabited

structure StatePart where
  initial : String
  handlers : List Handler
  deriving Repr, Inhabited

/-- What a turn is handed: the state, the message, the given and the phase. -/
structure StateInput where
  state : Value
  msg : Message
  given : Given
  phase : String
  deriving Repr, Inhabited

/-! ## Values at paths -/

def lookupField (k : Bytes) : List (Bytes × Value) → Option Value
  | [] => none
  | (k', v) :: kvs => if k' == k then some v else lookupField k kvs

/-- A map with `k` set to `v`, its keys kept in the codec's order. -/
def putField (k : Bytes) (v : Value) : List (Bytes × Value) → List (Bytes × Value)
  | [] => [(k, v)]
  | (k', v') :: kvs =>
    if k' == k then (k, v) :: kvs
    else if lexLt (keyBytes k) (keyBytes k') then (k, v) :: (k', v') :: kvs
    else (k', v') :: putField k v kvs

def dropField (k : Bytes) (kvs : List (Bytes × Value)) : List (Bytes × Value) := kvs.filter (·.1 != k)

def get : Value → Path → Option Value
  | v, [] => some v
  | .map kvs, .field k :: p => (lookupField k kvs).bind (get · p)
  | .array xs, .index i :: p => xs[i]?.bind (get · p)
  | _, _ => none

/-- `v` with the value at `p` changed by `f`; a missing field becomes `f none`. `none` when the path doesn't fit. -/
def modify (f : Option Value → Option Value) : Value → Path → Option Value
  | v, [] => f (some v)
  | .map kvs, .field k :: p =>
    let inner := match lookupField k kvs with
      | some c => modify f c p
      | none => if p.isEmpty then f none else modify f (.map []) p
    inner.map fun c => .map (putField k c kvs)
  | .array xs, .index i :: p =>
    match xs[i]? with
    | some c => (modify f c p).map fun c' => .array (xs.set i c')
    | none => none
  | _, _ => none

/-- `v` without what is at `p`; `none` when the path doesn't fit. -/
def removeAt : Value → Path → Option Value
  | _, [] => some .null
  | .map kvs, [.field k] => some (.map (dropField k kvs))
  | .array xs, [.index i] => if i < xs.length then some (.array (xs.eraseIdx i)) else none
  | .map kvs, .field k :: p => (lookupField k kvs).bind fun c =>
      (removeAt c p).map fun c' => .map (putField k c' kvs)
  | .array xs, .index i :: p => xs[i]?.bind fun c => (removeAt c p).map fun c' => .array (xs.set i c')
  | _, _ => none

/-- A shallow merge: `b`'s fields over `a`'s, when both are maps; otherwise `b`. -/
def mergeValue : Value → Value → Value
  | .map a, .map b => .map (b.foldl (fun acc (k, v) => putField k v acc) a)
  | _, b => b

def Expr.eval (inp : StateInput) : Expr → Option Value
  | .lit v => some v
  | .payload p => get inp.msg.payload p
  | .state p => get inp.state p
  | .now => some (.uint inp.given.now)
  | .seed => some (.uint inp.given.seed)

def Update.apply (inp : StateInput) (st : Value) : Update → Option Value
  | .set p e => (e.eval inp).bind fun x => modify (fun _ => some x) st p
  | .merge p e => (e.eval inp).bind fun x => modify (fun c => some (match c with
      | some c => mergeValue c x
      | none => x)) st p
  | .append p e => (e.eval inp).bind fun x => modify (fun c => match c with
      | some (.array xs) => some (.array (xs ++ [x]))
      | none => some (.array [x])
      | some _ => none) st p
  | .remove p => removeAt st p

/-! ## Addresses and text inside Values -/

def text? : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

def addrValue (a : Addr) : Value := .array [.text (ascii a.scope), .text (ascii a.id), .uint a.n]

def addrOf? : Value → Option Addr
  | .array [s, i, .uint n] => do return ⟨← text? s, ← text? i, n⟩
  | _ => none

def msgIdValue (m : MsgId) : Value := .array [addrValue m.sender, addrValue m.to, .uint m.seq]

def Target.resolve (inp : StateInput) : Target → Option Addr
  | .sender => some inp.msg.sender
  | .state p => (get inp.state p).bind addrOf?

def Send.effect (inp : StateInput) : Send → Option Effect
  | .tell to n e => do return .tell (← to.resolve inp) n (← e.eval inp)
  | .ask to n e w => do return .ask (← to.resolve inp) n (← e.eval inp) w
  | .reply e => match inp.msg.kind with
    | .ask _ => do return .reply inp.msg.id (← e.eval inp)
    | _ => none

/-! ## A step -/

/-- The first handler for the message that moves from the phase, and where it moves to. -/
def StatePart.select (sp : StatePart) (name phase : String) : Option (Handler × String) :=
  (sp.handlers.find? fun h => h.on == name && h.moves.any (·.1 == phase)).bind fun h =>
    (h.moves.find? (·.1 == phase)).map fun mv => (h, mv.2)

def foldM {α β : Type} (f : β → α → Option β) : β → List α → Option β
  | b, [] => some b
  | b, a :: as => (f b a).bind (foldM f · as)

def mapM {α β : Type} (f : α → Option β) : List α → Option (List β)
  | [] => some []
  | a :: as => do return (← f a) :: (← mapM f as)

/-- One turn: the handler, its updates in order, its sends, and the phase it moves to. A message no handler takes in
this phase, an update whose path doesn't fit the state, or a send that can't be made refuses. -/
def step (sp : StatePart) (inp : StateInput) : Except Failure TurnOut :=
  match sp.select inp.msg.name inp.phase with
  | none => .error .refused
  | some (h, to) =>
    match foldM (Update.apply inp) inp.state h.updates, mapM (Send.effect inp) h.sends with
    | some st, some fx => .ok ⟨st, fx, some to⟩
    | _, _ => .error .refused

/-- A step that fails refuses: state-runtime has no other failure of its own. -/
theorem step_refuses {sp : StatePart} {inp : StateInput} {e : Failure} (h : step sp inp = .error e) : e = .refused := by
  unfold step at h
  split at h
  · cases h; rfl
  · split at h
    · cases h
    · cases h; rfl

/-- Every edge of the part's statechart: a message, the phase it moves from and the one it moves to. -/
def StatePart.edges (sp : StatePart) : List (String × String × String) :=
  sp.handlers.flatMap fun h => h.moves.map fun (f, t) => (h.on, f, t)

/-- The part's statechart as the actors' machine: per phase, each message's targets. -/
def StatePart.machine (sp : StatePart) : Machine :=
  let froms := (sp.edges.map (·.2.1)).eraseDups
  ⟨sp.initial, froms.map fun f =>
    (f, (sp.handlers.map (·.on)).eraseDups.filterMap fun n =>
      let tos := (sp.edges.filter fun e => e.1 == n && e.2.1 == f).map (·.2.2)
      if tos.isEmpty then none else some (n, tos))⟩

/-- Every move of the part is a transition `mc` allows. Admission checks it. -/
def StatePart.fits (sp : StatePart) (mc : Machine) : Bool := sp.edges.all fun (n, f, t) => mc.allows n f t

theorem select_edge {sp : StatePart} {name phase to : String} {h : Handler}
    (hs : sp.select name phase = some (h, to)) : (name, phase, to) ∈ sp.edges := by
  unfold StatePart.select at hs
  cases hf : sp.handlers.find? (fun h => h.on == name && h.moves.any (·.1 == phase)) with
  | none => simp [hf] at hs
  | some h' =>
    simp only [hf, Option.bind_some] at hs
    cases hm : h'.moves.find? (·.1 == phase) with
    | none => simp [hm] at hs
    | some mv =>
      simp only [hm, Option.map_some, Option.some.injEq, Prod.mk.injEq] at hs
      obtain ⟨rfl, rfl⟩ := hs
      have hh := List.find?_some hf
      simp only [Bool.and_eq_true, beq_iff_eq] at hh
      have hmv := List.find?_some hm
      simp only [beq_iff_eq] at hmv
      simp only [StatePart.edges, List.mem_flatMap, List.mem_map]
      refine ⟨h', List.mem_of_find?_eq_some hf, mv, List.mem_of_find?_eq_some hm, ?_⟩
      rw [hh.1, ← hmv]

/-- **A step takes one of the part's moves, or refuses.** -/
theorem step_moves {sp : StatePart} {inp : StateInput} {o : TurnOut} (h : step sp inp = .ok o) :
    ∃ to, o.phase = some to ∧ (inp.msg.name, inp.phase, to) ∈ sp.edges := by
  unfold step at h
  split at h
  · cases h
  · rename_i hd to hs
    split at h
    · cases h; exact ⟨to, rfl, select_edge hs⟩
    · cases h

/-- **Under a machine the part fits, a step takes one of the machine's transitions, or refuses.** -/
theorem step_allowed {sp : StatePart} {mc : Machine} (hfit : sp.fits mc = true) {inp : StateInput} {o : TurnOut}
    (h : step sp inp = .ok o) : ∃ to, o.phase = some to ∧ mc.allows inp.msg.name inp.phase to = true := by
  obtain ⟨to, hp, he⟩ := step_moves h
  refine ⟨to, hp, ?_⟩
  have := List.all_eq_true.mp hfit _ he
  simpa using this

/-! ## Joined to the actors' kernel -/

/-- A state part as the turn the kernel runs, at the phase the kernel holds. -/
def stateTurn (sp : StatePart) (phase : String) (st : Value) (m : Message) (g : Given) : Option TurnOut :=
  match step sp ⟨st, m, g, phase⟩ with
  | .ok o => some o
  | .error _ => none

/-- **The kernel accepts every answer:** for a definition whose turn is a state part that fits its machine, the
kernel's check after the turn passes, so the turn is `done`, and `machine_sound` covers it. -/
theorem runTurn_state {sp : StatePart} {d : Def} {mc : Machine} {ph : String} (hm : d.machine = some mc)
    (hfit : sp.fits mc = true) (ht : d.turn = stateTurn sp ph) {st : Value} {m : Message} {g : Given} {o : TurnOut}
    (ho : stateTurn sp ph st m g = some o) :
    ∃ to, o.phase = some to ∧ mc.allows m.name ph to = true ∧ runTurn d st m g ph = some (o.state, to, o.effects) := by
  have hs : step sp ⟨st, m, g, ph⟩ = .ok o := by
    unfold stateTurn at ho
    split at ho
    · rename_i o' hs; cases ho; exact hs
    · cases ho
  obtain ⟨to, hp, ha⟩ := step_allowed hfit hs
  refine ⟨to, hp, ha, ?_⟩
  simp [runTurn, ht, ho, hm, hp, ha]

/-! ## Under the contract -/

def kindValue : Kind → Value
  | .tell => .array [.text (ascii "tell")]
  | .ask d => .array [.text (ascii "ask"), .uint d]
  | .reply re => .array [.text (ascii "reply"), msgIdValue re]
  | .fail re _ => .array [.text (ascii "fail"), msgIdValue re]

def effectValue : Effect → Value
  | .tell to n p => .array [.text (ascii "tell"), addrValue to, .text (ascii n), p]
  | .ask to n p w => .array [.text (ascii "ask"), addrValue to, .text (ascii n), p, .uint w]
  | .reply re p => .array [.text (ascii "reply"), msgIdValue re, p]

/-- A turn's output as a Value: `[state, [effect, …], phase]`. -/
def outValue (o : TurnOut) : Value :=
  .array [o.state, .array (o.effects.map effectValue), .text (ascii (o.phase.getD ""))]

def isText : Value → Bool
  | .text _ => true
  | _ => false

/-- An address's shape: `[scope, id, n]`. -/
def addrShape : Value → Bool
  | .array [.text _, .text _, .uint _] => true
  | _ => false

def effectShape : Value → Bool
  | .array [.text t, a, .text _, _] => t == ascii "tell" && addrShape a
  | .array [.text t, a, .text _, _, .uint _] => t == ascii "ask" && addrShape a
  | .array [.text t, .array [_, _, .uint _], _] => t == ascii "reply"
  | _ => false

/-- The output's schema: a state, effects of their shapes, and a phase. -/
def outputShape : Value → Bool
  | .array [_, .array fx, p] => fx.all effectShape && isText p
  | _ => false

theorem effect_shape (e : Effect) : effectShape (effectValue e) = true := by
  cases e <;> simp [effectValue, effectShape, msgIdValue, addrValue, addrShape]

theorem output_shape (o : TurnOut) : outputShape (outValue o) = true := by
  simp only [outValue, outputShape, isText, Bool.and_true, List.all_map, List.all_eq_true]
  intro e _
  simpa using effect_shape e

/-! ### Parsing the part and the input -/

def path? : Value → Option Path
  | .array ks => mapM (fun
      | .text b => some (.field b)
      | .uint n => some (.index n)
      | _ => none) ks
  | _ => none

def expr? : Value → Option Expr
  | .array [.text t, v] => if t == ascii "lit" then some (.lit v)
      else if t == ascii "payload" then (path? v).map .payload
      else if t == ascii "state" then (path? v).map .state else none
  | .array [.text t] => if t == ascii "now" then some .now else if t == ascii "seed" then some .seed else none
  | _ => none

def target? : Value → Option Target
  | .array [.text t] => if t == ascii "sender" then some .sender else none
  | .array [.text t, p] => if t == ascii "state" then (path? p).map .state else none
  | _ => none

def update? : Value → Option Update
  | .array [.text t, p, e] => do
    let p ← path? p
    let e ← expr? e
    if t == ascii "set" then return .set p e
    else if t == ascii "merge" then return .merge p e
    else if t == ascii "append" then return .append p e
    else none
  | .array [.text t, p] => if t == ascii "remove" then (path? p).map .remove else none
  | _ => none

def send? : Value → Option Send
  | .array [.text t, to, n, e] => if t == ascii "tell" then
      do return .tell (← target? to) (← text? n) (← expr? e) else none
  | .array [.text t, to, n, e, .uint w] => if t == ascii "ask" then
      do return .ask (← target? to) (← text? n) (← expr? e) w else none
  | .array [.text t, e] => if t == ascii "reply" then (expr? e).map .reply else none
  | _ => none

def move? : Value → Option (String × String)
  | .array [f, t] => do return (← text? f, ← text? t)
  | _ => none

def handler? : Value → Option Handler
  | .array [n, .array mv, .array us, .array ss] =>
    do return ⟨← text? n, ← mapM move? mv, ← mapM update? us, ← mapM send? ss⟩
  | _ => none

/-- A state part as a Value: `[initial, [[message, [[from, to], …], [update, …], [send, …]], …]]`. -/
def StatePart.ofValue? : Value → Option StatePart
  | .array [i, .array hs] => do return ⟨← text? i, ← mapM handler? hs⟩
  | _ => none

def msgId? : Value → Option MsgId
  | .array [s, t, .uint q] => do return ⟨← addrOf? s, ← addrOf? t, q⟩
  | _ => none

def kind? : Value → Option Kind
  | .array [.text t] => if t == ascii "tell" then some .tell else none
  | .array [.text t, .uint d] => if t == ascii "ask" then some (.ask d) else none
  | .array [.text t, re] => if t == ascii "reply" then (msgId? re).map .reply else none
  | _ => none

/-- A message as a Value: `[sender, to, seq, name, payload, kind]`. -/
def messageOf? : Value → Option Message
  | .array [s, t, .uint q, n, p, k] => do return ⟨← addrOf? s, ← addrOf? t, q, ← text? n, p, ← kind? k⟩
  | _ => none

/-- A turn's input as a Value: `[state, message, [now, seed], phase]`. -/
def StateInput.ofValue? : Value → Option StateInput
  | .array [st, m, .array [.uint now, .uint seed], ph] => do return ⟨st, ← messageOf? m, ⟨now, seed⟩, ← text? ph⟩
  | _ => none

/-! ### The runtime -/

/-- The fuel a step takes: one per handler looked at, per move, and per key and value it reads or writes. -/
def Path.cost (p : Path) : Nat := p.length + 1

def Expr.cost : Expr → Nat
  | .lit v => (encode v).length
  | .payload p | .state p => p.cost
  | .now | .seed => 1

def Update.cost : Update → Nat
  | .set p e | .merge p e | .append p e => p.cost + e.cost + (encode (.null)).length
  | .remove p => p.cost

def Send.cost : Send → Nat
  | .tell _ _ e | .ask _ _ e _ | .reply e => e.cost + 1

def stepFuel (sp : StatePart) (inp : StateInput) : Nat :=
  sp.handlers.length + match sp.select inp.msg.name inp.phase with
    | none => 0
    | some (h, _) => h.moves.length + (h.updates.map Update.cost).sum + (h.sends.map Send.cost).sum

/-- state-runtime under the contract: the part and the input parsed from Values, `step`, and its output as a Value.
A part that doesn't parse is refused; an input that doesn't parse fails the input's schema. -/
def stateRuntime : Runtime where
  eval p i := match StatePart.ofValue? p, StateInput.ofValue? i with
    | some sp, some inp => (step sp inp).map outValue
    | _, _ => .error .refused
  fuel p i := match StatePart.ofValue? p, StateInput.ofValue? i with
    | some sp, some inp => stepFuel sp inp
    | _, _ => 0
  memory p i := (encode p).length + 2 * (encode i).length
  input i := (StateInput.ofValue? i).isSome
  output := outputShape

/-- **Every answer has the output's shape.** -/
theorem state_output_fits {p i o : Value} (h : stateRuntime.eval p i = .ok o) : outputShape o = true := by
  simp only [stateRuntime] at h
  split at h
  · rename_i sp inp _ _
    revert h
    cases step sp inp with
    | error e => intro h; cases h
    | ok out => intro h; cases h; exact output_shape out
  · cases h

/-- state-runtime's own failures are refusals. -/
theorem state_eval_refuses {p i : Value} {e : Failure} (h : stateRuntime.eval p i = .error e) : e = .refused := by
  simp only [stateRuntime] at h
  split at h
  · rename_i sp inp _ _
    revert h
    cases hs : step sp inp with
    | error e' => intro h; cases h; exact step_refuses hs
    | ok out => intro h; cases h
  · cases h; rfl

/-- So the host never refuses a state step's output as `badOutput`. -/
theorem state_never_badOutput (l : Limits) (p i : Value) : run stateRuntime l p i ≠ .error .badOutput := by
  intro h
  unfold run at h
  split at h
  · cases h
  · split at h
    · cases h
    · split at h
      · cases h
      · split at h
        · rename_i e he
          cases h
          cases state_eval_refuses he
        · rename_i o ho
          split at h
          · cases h
          · split at h
            · rename_i hb
              have := state_output_fits ho
              simp [stateRuntime, this] at hb
            · cases h

/-- **More fuel never changes an answer**, from the contract. -/
theorem state_more_room {l l' : Limits} {p i o : Value} (hl : l.le l') (h : run stateRuntime l p i = .ok o) :
    run stateRuntime l' p i = .ok o := run_more_room hl h

/-- And every answer the host hands on is a step of the parsed part that took one of its moves. -/
theorem state_run_moves {l : Limits} {p i o : Value} (h : run stateRuntime l p i = .ok o) :
    ∃ sp inp out to, StatePart.ofValue? p = some sp ∧ StateInput.ofValue? i = some inp ∧ step sp inp = .ok out ∧
      o = outValue out ∧ out.phase = some to ∧ (inp.msg.name, inp.phase, to) ∈ sp.edges := by
  have he := (run_ok_fits h).2.2.2
  simp only [stateRuntime] at he
  split at he
  · rename_i sp inp hsp hinp
    revert he
    cases hs : step sp inp with
    | error e => intro he; cases he
    | ok out =>
      intro he
      cases he
      obtain ⟨to, hp, hedge⟩ := step_moves hs
      exact ⟨sp, inp, out, to, hsp, hinp, hs, rfl, hp, hedge⟩
  · cases he

end Aven.Runtime
