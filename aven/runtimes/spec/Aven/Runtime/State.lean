import Aven.Runtime.Contract

/-!
# state-runtime (aven/actor/ARCHITECTURE.md, section 5; README, "Moving the actors' runtimes and the plugins in")

A declarative turn: no code, so it always ends. Its part is a statechart and a reducer as data, a list of handlers,
each for one message:

- **moves:** the statechart's edges for that message, `from → to`. A handler applies only in a phase it moves from;
  the first that does is the one that runs. An actor without a machine uses one phase, `""`.
- **updates:** the reducer, applied in order to the state: `set`, `merge`, `append` and `remove`, each at a path of
  map fields and array indexes, with values from the message's payload, the state before, the turn's time and seed, or
  a literal.
- **sends:** `tell` and `ask` to the sender or to an address held in the state, and `reply` to the ask being handled.

A runtime is a pure `run(part, input)` that the kernel calls, so this file names nothing of the actors': a message is
its sender's address, its name, its payload and, for an ask, the ask's id, all Values; what a step gives back is the
writes it commits, its sends as data and the phase it moved to. `Aven.Actor` maps them to its messages and effects
and joins the step to its kernel.

`step` is total and deterministic. Under the contract (`stateRuntime`) the part and the input are Values of the one
codec, its fuel is a count of the part's work, and its output is the step's output as a Value. What it guarantees:

- `step_moves`: a step that answers took one of the part's moves for that message and phase; one that doesn't refuses
  (`step_refuses`).
- `step_allowed`: when the part fits a machine's transitions (`fits`), every answer is a transition it allows.
- **An update touches only its path:** `get_set` (after a set the path holds the value), `get_set_other` (every path
  apart from it holds what it held), `get_remove` (after removing a field nothing is there), with `modify_get` and
  `modify_other` beneath them, and the same for each update (`set_get`, `merge_get`, `append_get`, `remove_get`,
  `update_other`).
- **A turn commits K8's steps, never a whole new state (A37):** a step answers with writes, `put`, `patch`, `remove`
  and an `edit` that pushes onto a list, each at a path. `set`, `merge`, `append` and `remove` lower to them
  (`Update.lower`); `lower_apply` and `lowerAll_apply` prove the writes, applied in order, give exactly the state the
  updates make, and `step_writes` that a step's writes are its handler's updates and apply. `Write.footprint` is what
  the caps check: the field each write's path starts with, and its verb.
- `state_output_fits` and `state_never_badOutput`: every answer has the output's shape.
- `state_more_room`: more fuel never changes an answer. `state_run_moves`: what the host hands on is a step.
-/

namespace Aven.Runtime

open Aven.Core (Value Bytes encode keyBytes lexLt)

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

/-- Whom a send goes to: the message's sender, or an address held in the state. -/
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

/-- A message as a runtime sees it: its sender's address, its name, its payload, and the ask's id if it is an ask. -/
structure Msg where
  sender : Value
  name : String
  payload : Value
  ask : Option Value
  deriving Repr, Inhabited

/-- What a step is handed: the state, the message, the turn's time and seed, and the phase. -/
structure StateInput where
  state : Value
  msg : Msg
  now : Nat
  seed : Nat
  phase : String
  deriving Repr, Inhabited

/-- A send as data: a tell or an ask to an address, or a reply to an ask by its id. -/
inductive Out where
  | tell (to : Value) (name : String) (payload : Value)
  | ask (to : Value) (name : String) (payload : Value) (within : Nat)
  | reply (re : Value) (payload : Value)
  deriving Repr, Inhabited

/-- An edit of a list: its value pushed at the end. -/
inductive ListEdit where
  | push (v : Value)
  deriving Repr, Inhabited

/-- One of K8's steps at a path of the state: `put` a value, `patch` fields into a map, `remove`, or `edit` a list. A
turn's answer is these, never a whole new state: they are what the turn commits, and what the caps check. -/
inductive Write where
  | put (p : Path) (v : Value)
  | patch (p : Path) (kvs : List (Bytes × Value))
  | remove (p : Path)
  | edit (p : Path) (e : ListEdit)
  deriving Repr, Inhabited

def Write.path : Write → Path
  | .put p _ | .patch p _ | .remove p | .edit p _ => p

/-- What a step gives back: the writes it commits, its sends and the phase it moved to. Never a whole new state
(A37). -/
structure StateOut where
  writes : List Write
  sends : List Out
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

/-- `v` without what is at `p`; `none` when the path doesn't fit. Removing an array's item moves the later ones up. -/
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
  | .now => some (.uint inp.now)
  | .seed => some (.uint inp.seed)

def setTo (x : Value) : Option Value → Option Value := fun _ => some x

def mergeIn (x : Value) : Option Value → Option Value
  | some c => some (mergeValue c x)
  | none => some x

def appendTo (x : Value) : Option Value → Option Value
  | some (.array xs) => some (.array (xs ++ [x]))
  | none => some (.array [x])
  | some _ => none

def Update.apply (inp : StateInput) (st : Value) : Update → Option Value
  | .set p e => (e.eval inp).bind fun x => modify (setTo x) st p
  | .merge p e => (e.eval inp).bind fun x => modify (mergeIn x) st p
  | .append p e => (e.eval inp).bind fun x => modify (appendTo x) st p
  | .remove p => removeAt st p

def Update.path : Update → Path
  | .set p _ | .merge p _ | .append p _ | .remove p => p

/-! ## An update touches only its path -/

theorem lookup_put_self (k : Bytes) (v : Value) :
    ∀ kvs, lookupField k (putField k v kvs) = some v
  | [] => by simp [putField, lookupField]
  | (k', v') :: kvs => by
    unfold putField
    by_cases h1 : (k' == k) = true
    · simp [h1, lookupField]
    · by_cases h2 : lexLt (keyBytes k) (keyBytes k') = true
      · simp [h1, h2, lookupField]
      · simp only [h1, h2, Bool.false_eq_true, ite_false, lookupField]
        exact lookup_put_self k v kvs

theorem lookup_put_other {k k2 : Bytes} (v : Value) (hk : k2 ≠ k) :
    ∀ kvs, lookupField k2 (putField k v kvs) = lookupField k2 kvs
  | [] => by
    have : (k == k2) = false := by simpa using Ne.symm hk
    simp [putField, lookupField, this]
  | (k', v') :: kvs => by
    have hkk : (k == k2) = false := by simpa using Ne.symm hk
    unfold putField
    by_cases h1 : (k' == k) = true
    · have : k' = k := by simpa using h1
      subst this
      simp [lookupField, hkk]
    · by_cases h2 : lexLt (keyBytes k) (keyBytes k') = true
      · simp [h1, h2, lookupField, hkk]
      · simp only [h1, h2, Bool.false_eq_true, ite_false, lookupField]
        split
        · rfl
        · exact lookup_put_other v hk kvs

theorem lookup_drop_self (k : Bytes) : ∀ kvs, lookupField k (dropField k kvs) = none
  | [] => rfl
  | (k', v') :: kvs => by
    unfold dropField at *
    by_cases h : k' = k
    · subst h
      have ih := lookup_drop_self k' kvs
      unfold dropField at ih
      simpa [List.filter] using ih
    · have h1 : (k' != k) = true := by simpa using h
      have h2 : (k' == k) = false := by simpa using h
      simp only [List.filter, h1, lookupField, h2, Bool.false_eq_true, ite_false]
      exact lookup_drop_self k kvs

theorem get_empty {p : Path} (hp : p ≠ []) : get (.map []) p = none := by
  cases p with
  | nil => exact absurd rfl hp
  | cons k p => cases k <;> simp [get, lookupField]

/-- What `modify` puts at its path is what `f` makes of what was there. -/
theorem modify_get (f : Option Value → Option Value) :
    ∀ (p : Path) (v v' : Value), modify f v p = some v' → ∃ c, f (get v p) = some c ∧ get v' p = some c
  | [], v, v', h => by simp only [modify] at h; exact ⟨v', by simpa [get] using h, by simp [get]⟩
  | .field k :: p, v, v', h => by
    cases v with
    | map kvs =>
      simp only [modify] at h
      cases hl : lookupField k kvs with
      | some c0 =>
        simp only [hl] at h
        cases hm : modify f c0 p with
        | none => simp [hm] at h
        | some c1 =>
          simp only [hm, Option.map_some, Option.some.injEq] at h
          subst h
          obtain ⟨c, hc, hg⟩ := modify_get f p c0 c1 hm
          exact ⟨c, by simpa [get, hl] using hc, by simpa [get, lookup_put_self] using hg⟩
      | none =>
        simp only [hl] at h
        by_cases hp : p.isEmpty = true
        · have : p = [] := List.isEmpty_iff.mp hp
          subst this
          simp only [hp, ite_true] at h
          cases hf : f none with
          | none => simp [hf] at h
          | some c1 =>
            simp only [hf, Option.map_some, Option.some.injEq] at h
            subst h
            exact ⟨c1, by simpa [get, hl] using hf, by simp [get, lookup_put_self]⟩
        · simp only [hp, Bool.false_eq_true, ite_false] at h
          have hne : p ≠ [] := fun h' => hp (by simp [h'])
          cases hm : modify f (.map []) p with
          | none => simp [hm] at h
          | some c1 =>
            simp only [hm, Option.map_some, Option.some.injEq] at h
            subst h
            obtain ⟨c, hc, hg⟩ := modify_get f p (.map []) c1 hm
            rw [get_empty hne] at hc
            exact ⟨c, by simpa [get, hl] using hc, by simpa [get, lookup_put_self] using hg⟩
    | _ => simp [modify] at h
  | .index i :: p, v, v', h => by
    cases v with
    | array xs =>
      simp only [modify] at h
      cases hx : xs[i]? with
      | none => simp [hx] at h
      | some c0 =>
        simp only [hx] at h
        cases hm : modify f c0 p with
        | none => simp [hm] at h
        | some c1 =>
          simp only [hm, Option.map_some, Option.some.injEq] at h
          subst h
          obtain ⟨c, hc, hg⟩ := modify_get f p c0 c1 hm
          have hi : i < xs.length := (List.getElem?_eq_some_iff.mp hx).1
          refine ⟨c, by simpa [get, hx] using hc, ?_⟩
          simp only [get, List.getElem?_set_self hi, Option.bind_some]
          exact hg
    | _ => simp [modify] at h

/-- Neither path lies along the other. -/
def Apart (p q : Path) : Prop := ¬ p <+: q ∧ ¬ q <+: p

theorem Apart.tail {k : Key} {p q : Path} (h : Apart (k :: p) (k :: q)) : Apart p q :=
  ⟨fun hp => h.1 (List.prefix_cons_inj _ |>.mpr hp), fun hq => h.2 (List.prefix_cons_inj _ |>.mpr hq)⟩

/-- `modify` leaves every path apart from its own as it was. -/
theorem modify_other (f : Option Value → Option Value) :
    ∀ (p q : Path) (v v' : Value), Apart p q → modify f v p = some v' → get v' q = get v q
  | [], _, _, _, ha, _ => absurd List.nil_prefix ha.1
  | _ :: _, [], _, _, ha, _ => absurd List.nil_prefix ha.2
  | .field k :: p, k2 :: q, v, v', ha, h => by
    cases v with
    | map kvs =>
      simp only [modify] at h
      generalize hin : (match lookupField k kvs with
        | some c => modify f c p
        | none => if p.isEmpty then f none else modify f (.map []) p) = inner at h
      cases inner with
      | none => simp at h
      | some c1 =>
        simp only [Option.map_some, Option.some.injEq] at h
        subst h
        cases k2 with
        | index j => simp [get]
        | field k' =>
          by_cases hkk : k' = k
          · subst hkk
            have ha' := ha.tail
            have hq : q ≠ [] := by rintro rfl; exact ha.2 (List.prefix_cons_inj _ |>.mpr List.nil_prefix)
            simp only [get, lookup_put_self, Option.bind_some]
            cases hl : lookupField k' kvs with
            | some c0 =>
              simp only [hl] at hin
              simp only [Option.bind_some]
              exact modify_other f p q c0 c1 ha' hin
            | none =>
              simp only [hl] at hin
              have hp : p ≠ [] := by rintro rfl; exact ha.1 (List.prefix_cons_inj _ |>.mpr List.nil_prefix)
              have hpe : p.isEmpty = false := by cases p <;> simp_all
              simp only [hpe, Bool.false_eq_true, ite_false] at hin
              rw [modify_other f p q (.map []) c1 ha' hin, get_empty hq]
              rfl
          · simp [get, lookup_put_other _ hkk]
    | _ => simp [modify] at h
  | .index i :: p, k2 :: q, v, v', ha, h => by
    cases v with
    | array xs =>
      simp only [modify] at h
      cases hx : xs[i]? with
      | none => simp [hx] at h
      | some c0 =>
        simp only [hx] at h
        cases hm : modify f c0 p with
        | none => simp [hm] at h
        | some c1 =>
          simp only [hm, Option.map_some, Option.some.injEq] at h
          subst h
          have hi : i < xs.length := (List.getElem?_eq_some_iff.mp hx).1
          cases k2 with
          | field _ => simp [get]
          | index j =>
            by_cases hij : j = i
            · subst hij
              simp only [get, List.getElem?_set_self hi, hx, Option.bind_some]
              exact modify_other f p q c0 c1 ha.tail hm
            · simp [get, List.getElem?_set_ne (Ne.symm hij)]
    | _ => simp [modify] at h

/-- **After a set, the path holds the value.** -/
theorem get_set {v v' x : Value} {p : Path} (h : modify (setTo x) v p = some v') : get v' p = some x := by
  obtain ⟨c, hc, hg⟩ := modify_get (setTo x) p v v' h
  simp only [setTo, Option.some.injEq] at hc
  rw [hg, hc]

/-- **A set leaves every path apart from it as it was.** -/
theorem get_set_other {v v' x : Value} {p q : Path} (ha : Apart p q) (h : modify (setTo x) v p = some v') :
    get v' q = get v q := modify_other (setTo x) p q v v' ha h

/-- A path that ends at a map field. -/
def endsInField : Path → Bool
  | [] => false
  | [.field _] => true
  | [.index _] => false
  | _ :: p => endsInField p

/-- **After a field is removed, nothing is at its path.** An array's item is not: the later ones move up. -/
theorem get_remove : ∀ {v v' : Value} {p : Path}, endsInField p = true → removeAt v p = some v' → get v' p = none
  | _, _, [], hp, _ => by simp [endsInField] at hp
  | v, v', [.field k], _, h => by
    cases v with
    | map kvs => simp only [removeAt, Option.some.injEq] at h; subst h; simp [get, lookup_drop_self]
    | _ => simp [removeAt] at h
  | _, _, [.index _], hp, _ => by simp [endsInField] at hp
  | v, v', .field k :: k2 :: p, hp, h => by
    have hp' : endsInField (k2 :: p) = true := by simpa [endsInField] using hp
    cases v with
    | map kvs =>
      simp only [removeAt] at h
      cases hl : lookupField k kvs with
      | none => simp [hl] at h
      | some c =>
        simp only [hl, Option.bind_some] at h
        cases hr : removeAt c (k2 :: p) with
        | none => simp [hr] at h
        | some c' =>
          simp only [hr, Option.map_some, Option.some.injEq] at h
          subst h
          simp only [get, lookup_put_self, Option.bind_some]
          exact get_remove hp' hr
    | _ => simp [removeAt] at h
  | v, v', .index i :: k2 :: p, hp, h => by
    have hp' : endsInField (k2 :: p) = true := by simpa [endsInField] using hp
    cases v with
    | array xs =>
      simp only [removeAt] at h
      cases hx : xs[i]? with
      | none => simp [hx] at h
      | some c =>
        simp only [hx, Option.bind_some] at h
        cases hr : removeAt c (k2 :: p) with
        | none => simp [hr] at h
        | some c' =>
          simp only [hr, Option.map_some, Option.some.injEq] at h
          subst h
          have hi : i < xs.length := (List.getElem?_eq_some_iff.mp hx).1
          simp only [get, List.getElem?_set_self hi, Option.bind_some]
          exact get_remove hp' hr
    | _ => simp [removeAt] at h

/-! ### The same, for each update -/

/-- A `set` puts its value at its path. -/
theorem set_get {inp : StateInput} {st st' x : Value} {p : Path} {e : Expr} (he : e.eval inp = some x)
    (h : (Update.set p e).apply inp st = some st') : get st' p = some x := by
  simp only [Update.apply, he, Option.bind_some] at h
  exact get_set h

/-- A `merge` puts at its path the merge of what was there with its value. -/
theorem merge_get {inp : StateInput} {st st' x : Value} {p : Path} {e : Expr} (he : e.eval inp = some x)
    (h : (Update.merge p e).apply inp st = some st') : ∃ c, mergeIn x (get st p) = some c ∧ get st' p = some c := by
  simp only [Update.apply, he, Option.bind_some] at h
  exact modify_get _ p st st' h

/-- An `append` puts at its path the array that was there with its value at the end. -/
theorem append_get {inp : StateInput} {st st' x : Value} {p : Path} {e : Expr} (he : e.eval inp = some x)
    (h : (Update.append p e).apply inp st = some st') : ∃ c, appendTo x (get st p) = some c ∧ get st' p = some c := by
  simp only [Update.apply, he, Option.bind_some] at h
  exact modify_get _ p st st' h

/-- A `remove` of a field leaves nothing at its path. -/
theorem remove_get {inp : StateInput} {st st' : Value} {p : Path} (hp : endsInField p = true)
    (h : (Update.remove p).apply inp st = some st') : get st' p = none := get_remove hp h

/-- **A `set`, `merge` or `append` touches only its path:** every path apart from it holds what it held. -/
theorem update_other {inp : StateInput} {st st' : Value} {u : Update} {q : Path} (hu : ∀ p, u ≠ .remove p)
    (ha : Apart u.path q) (h : u.apply inp st = some st') : get st' q = get st q := by
  cases u with
  | set p e =>
    simp only [Update.apply] at h
    cases hx : e.eval inp with
    | none => simp [hx] at h
    | some x => simp only [hx, Option.bind_some] at h; exact modify_other _ p q st st' ha h
  | merge p e =>
    simp only [Update.apply] at h
    cases hx : e.eval inp with
    | none => simp [hx] at h
    | some x => simp only [hx, Option.bind_some] at h; exact modify_other _ p q st st' ha h
  | append p e =>
    simp only [Update.apply] at h
    cases hx : e.eval inp with
    | none => simp [hx] at h
    | some x => simp only [hx, Option.bind_some] at h; exact modify_other _ p q st st' ha h
  | remove p => exact absurd rfl (hu p)

/-! ## Writes: what a turn commits (A37) -/

def foldM {α β : Type} (f : β → α → Option β) : β → List α → Option β
  | b, [] => some b
  | b, a :: as => (f b a).bind (foldM f · as)

def mapM {α β : Type} (f : α → Option β) : List α → Option (List β)
  | [] => some []
  | a :: as => do return (← f a) :: (← mapM f as)


/-- A write applied to the state; `none` when its path doesn't fit. A patch on nothing makes the map. -/
def Write.apply (st : Value) : Write → Option Value
  | .put p v => modify (setTo v) st p
  | .patch p kvs => modify (mergeIn (.map kvs)) st p
  | .remove p => removeAt st p
  | .edit p (.push v) => modify (appendTo v) st p

/-- The writes in order. -/
def applyAll (st : Value) (ws : List Write) : Option Value := foldM Write.apply st ws

/-- An update as the write it commits, on the state it meets: `set` is a put, `merge` a patch of a map's fields (a
put of anything else, which a merge replaces), `append` an edit that pushes, `remove` a remove. -/
def Update.lower (inp : StateInput) : Update → Option Write
  | .set p e => (e.eval inp).map (.put p)
  | .merge p e => (e.eval inp).map fun x => match x with
    | .map kvs => .patch p kvs
    | x => .put p x
  | .append p e => (e.eval inp).map fun x => .edit p (.push x)
  | .remove p => some (.remove p)

theorem mergeIn_other {x : Value} (hx : ∀ kvs, x ≠ .map kvs) : mergeIn x = setTo x := by
  funext c
  cases c with
  | none => rfl
  | some c =>
    cases x with
    | map kvs => exact absurd rfl (hx kvs)
    | _ => cases c <;> rfl

/-- **An update's write does exactly what the update does.** -/
theorem lower_apply (inp : StateInput) (st : Value) (u : Update) :
    (u.lower inp).bind (·.apply st) = u.apply inp st := by
  cases u with
  | set p e => cases hx : e.eval inp <;> simp [Update.lower, Update.apply, Write.apply, hx]
  | merge p e =>
    cases hx : e.eval inp with
    | none => simp [Update.lower, Update.apply, hx]
    | some x =>
      cases x with
      | map kvs => simp [Update.lower, Update.apply, Write.apply, hx]
      | _ => simp [Update.lower, Update.apply, Write.apply, hx, mergeIn_other]
  | append p e => cases hx : e.eval inp <;> simp [Update.lower, Update.apply, Write.apply, hx]
  | remove p => simp [Update.lower, Update.apply, Write.apply]

/-- A write's footprint, which the caps check (`Aven.Core.covers`): on the actor's state, a Record of type `type`, a
put or remove of the whole state is a put-replace or a remove, an edit is an edit, and every other write patches the
field its path starts with. -/
def Write.footprint (type : Aven.Core.DocId) (w : Write) : Aven.Core.Step :=
  let verb : Aven.Core.StepVerb := match w with
    | .put [] _ => .putReplace
    | .remove [] => .remove
    | .edit .. => .edit
    | _ => .patch
  ⟨type, verb, match w.path with
    | .field k :: _ => [k]
    | _ => []⟩

/-- A handler's updates as writes, each on the state the ones before it left. -/
def lowerAll (inp : StateInput) : Value → List Update → Option (List Write)
  | _, [] => some []
  | st, u :: us => (u.lower inp).bind fun w => (w.apply st).bind fun st' => (lowerAll inp st' us).map (w :: ·)

/-- **The writes a turn commits, applied to the state it was handed, give exactly the state its updates make.** -/
theorem lowerAll_apply (inp : StateInput) : ∀ (st : Value) (us : List Update),
    (lowerAll inp st us).bind (applyAll st) = foldM (Update.apply inp) st us
  | st, [] => by simp [lowerAll, applyAll, foldM]
  | st, u :: us => by
    have hl := lower_apply inp st u
    simp only [lowerAll, foldM]
    cases hw : u.lower inp with
    | none => simp [hw] at hl ⊢; rw [← hl]; rfl
    | some w =>
      simp only [hw, Option.bind_some] at hl ⊢
      rw [← hl]
      cases ha : w.apply st with
      | none => simp
      | some st' =>
        have ih := lowerAll_apply inp st' us
        cases hr : lowerAll inp st' us with
        | none => simp [hr] at ih ⊢; exact ih
        | some ws => simp [hr, applyAll, foldM, ha] at ih ⊢; exact ih

/-- Writes a handler's updates lowered to apply, in order. -/
theorem lowerAll_applies {inp : StateInput} : ∀ {st : Value} {us : List Update} {ws : List Write},
    lowerAll inp st us = some ws → (applyAll st ws).isSome
  | st, [], ws, h => by simp [lowerAll] at h; subst h; simp [applyAll, foldM]
  | st, u :: us, ws, h => by
    simp only [lowerAll] at h
    cases hw : u.lower inp with
    | none => simp [hw] at h
    | some w =>
      cases ha : w.apply st with
      | none => simp [hw, ha] at h
      | some st' =>
        cases hr : lowerAll inp st' us with
        | none => simp [hw, ha, hr] at h
        | some ws' =>
          simp [hw, ha, hr] at h
          subst h
          have := lowerAll_applies hr
          simpa [applyAll, foldM, ha] using this

/-! ## A step -/

/-- An address's shape, `[scope, id, n]`: what a tell or an ask may go to. -/
def addrShape : Value → Bool
  | .array [.text _, .text _, .uint _] => true
  | _ => false

def Target.resolve (inp : StateInput) : Target → Option Value
  | .sender => if addrShape inp.msg.sender then some inp.msg.sender else none
  | .state p => (get inp.state p).bind fun a => if addrShape a then some a else none

def Send.out (inp : StateInput) : Send → Option Out
  | .tell to n e => do return .tell (← to.resolve inp) n (← e.eval inp)
  | .ask to n e w => do return .ask (← to.resolve inp) n (← e.eval inp) w
  | .reply e => do return .reply (← inp.msg.ask) (← e.eval inp)

/-- The first handler for the message that moves from the phase, and where it moves to. -/
def StatePart.select (sp : StatePart) (name phase : String) : Option (Handler × String) :=
  (sp.handlers.find? fun h => h.on == name && h.moves.any (·.1 == phase)).bind fun h =>
    (h.moves.find? (·.1 == phase)).map fun mv => (h, mv.2)

/-- One turn: the handler, its updates in order as the writes they commit, its sends, and the phase it moves to. A
message no handler takes in this phase, an update whose path doesn't fit the state, or a send that can't be made
refuses. -/
def step (sp : StatePart) (inp : StateInput) : Except Failure StateOut :=
  match sp.select inp.msg.name inp.phase with
  | none => .error .refused
  | some (h, to) =>
    match lowerAll inp inp.state h.updates, mapM (Send.out inp) h.sends with
    | some ws, some fx => .ok ⟨ws, fx, to⟩
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

/-- Every move of the part is a transition `allows` permits: `allows name from to`, a machine's table as a function.
Admission checks it. -/
def StatePart.fits (sp : StatePart) (allows : String → String → String → Bool) : Bool :=
  sp.edges.all fun (n, f, t) => allows n f t

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
theorem step_moves {sp : StatePart} {inp : StateInput} {o : StateOut} (h : step sp inp = .ok o) :
    (inp.msg.name, inp.phase, o.phase) ∈ sp.edges := by
  unfold step at h
  split at h
  · cases h
  · rename_i hd to hs
    split at h
    · cases h; exact select_edge hs
    · cases h

/-- **Under transitions the part fits, a step takes one they allow, or refuses.** -/
theorem step_allowed {sp : StatePart} {allows : String → String → String → Bool} (hfit : sp.fits allows = true)
    {inp : StateInput} {o : StateOut} (h : step sp inp = .ok o) : allows inp.msg.name inp.phase o.phase = true := by
  have := List.all_eq_true.mp hfit _ (step_moves h)
  simpa using this

/-- **What a step commits is its handler's updates:** its writes, applied in order to the state it was handed, give
exactly the state those updates make, and they apply. -/
theorem step_writes {sp : StatePart} {inp : StateInput} {o : StateOut} (h : step sp inp = .ok o) :
    ∃ hd to, sp.select inp.msg.name inp.phase = some (hd, to) ∧
      applyAll inp.state o.writes = foldM (Update.apply inp) inp.state hd.updates ∧
      (applyAll inp.state o.writes).isSome := by
  unfold step at h
  split at h
  · cases h
  · rename_i hd to hs
    split at h
    · rename_i ws fx hws _
      cases h
      have := lowerAll_apply inp inp.state hd.updates
      rw [hws, Option.bind_some] at this
      refine ⟨hd, to, hs, this, ?_⟩
      -- every write applied when it was lowered
      exact lowerAll_applies hws
    · cases h

/-! ## Under the contract -/

def Out.value : Out → Value
  | .tell to n p => .array [.text (ascii "tell"), to, .text (ascii n), p]
  | .ask to n p w => .array [.text (ascii "ask"), to, .text (ascii n), p, .uint w]
  | .reply re p => .array [.text (ascii "reply"), re, p]

def Key.value : Key → Value
  | .field b => .text b
  | .index n => .uint n

def pathValue (p : Path) : Value := .array (p.map Key.value)

/-- A write as a Value: `["put", path, value]`, `["patch", path, {fields}]`, `["remove", path]`,
`["edit", path, ["push", value]]`. -/
def Write.value : Write → Value
  | .put p v => .array [.text (ascii "put"), pathValue p, v]
  | .patch p kvs => .array [.text (ascii "patch"), pathValue p, .map kvs]
  | .remove p => .array [.text (ascii "remove"), pathValue p]
  | .edit p (.push v) => .array [.text (ascii "edit"), pathValue p, .array [.text (ascii "push"), v]]

/-- A step's output as a Value: `[[write, …], [send, …], phase]`. -/
def StateOut.value (o : StateOut) : Value :=
  .array [.array (o.writes.map Write.value), .array (o.sends.map Out.value), .text (ascii o.phase)]

def isText : Value → Bool
  | .text _ => true
  | _ => false

def outShape : Value → Bool
  | .array [.text t, a, .text _, _] => t == ascii "tell" && addrShape a
  | .array [.text t, a, .text _, _, .uint _] => t == ascii "ask" && addrShape a
  | .array [.text t, _, _] => t == ascii "reply"
  | _ => false

def writeShape : Value → Bool
  | .array [.text t, .array _, _] => t == ascii "put" || t == ascii "patch" || t == ascii "edit"
  | .array [.text t, .array _] => t == ascii "remove"
  | _ => false

theorem write_shape (w : Write) : writeShape w.value = true := by
  cases w with
  | edit p e => cases e; simp [Write.value, writeShape, pathValue]
  | _ => simp [Write.value, writeShape, pathValue]

/-- The output's schema: writes and sends of their shapes, and a phase. -/
def outputShape : Value → Bool
  | .array [.array ws, .array fx, p] => ws.all writeShape && fx.all outShape && isText p
  | _ => false

/-- What `step` sends goes to addresses of their shape. -/
theorem resolve_shape {inp : StateInput} {t : Target} {a : Value} (h : t.resolve inp = some a) :
    addrShape a = true := by
  cases t with
  | sender =>
    simp only [Target.resolve] at h
    split at h
    · cases h; assumption
    · cases h
  | state p =>
    simp only [Target.resolve] at h
    cases hg : get inp.state p with
    | none => simp [hg] at h
    | some a' =>
      simp only [hg, Option.bind_some] at h
      split at h
      · cases h; assumption
      · cases h

theorem out_shape {inp : StateInput} {s : Send} {o : Out} (h : s.out inp = some o) : outShape o.value = true := by
  cases s with
  | tell to n e =>
    simp only [Send.out] at h
    cases hr : to.resolve inp with
    | none => simp [hr] at h
    | some a =>
      cases hx : e.eval inp with
      | none => simp [hr, hx] at h
      | some x => simp [hr, hx] at h; subst h; simp [Out.value, outShape, resolve_shape hr]
  | ask to n e w =>
    simp only [Send.out] at h
    cases hr : to.resolve inp with
    | none => simp [hr] at h
    | some a =>
      cases hx : e.eval inp with
      | none => simp [hr, hx] at h
      | some x => simp [hr, hx] at h; subst h; simp [Out.value, outShape, resolve_shape hr]
  | reply e =>
    simp only [Send.out] at h
    cases ha : inp.msg.ask with
    | none => simp [ha] at h
    | some re =>
      cases hx : e.eval inp with
      | none => simp [ha, hx] at h
      | some x => simp [ha, hx] at h; subst h; simp [Out.value, outShape]

theorem mapM_mem {α β : Type} {f : α → Option β} : ∀ {as : List α} {bs : List β}, mapM f as = some bs →
    ∀ b ∈ bs, ∃ a ∈ as, f a = some b
  | [], bs, h, b, hb => by simp [mapM] at h; subst h; cases hb
  | a :: as, bs, h, b, hb => by
    simp only [mapM] at h
    cases ha : f a with
    | none => simp [ha] at h
    | some b0 =>
      cases has : mapM f as with
      | none => simp [ha, has] at h
      | some bs' =>
        simp [ha, has] at h
        subst h
        rcases List.mem_cons.mp hb with rfl | hb'
        · exact ⟨a, List.mem_cons_self .., ha⟩
        · obtain ⟨a', ha', hf⟩ := mapM_mem has b hb'
          exact ⟨a', List.mem_cons_of_mem _ ha', hf⟩

theorem step_shape {sp : StatePart} {inp : StateInput} {o : StateOut} (h : step sp inp = .ok o) :
    outputShape o.value = true := by
  unfold step at h
  split at h
  · cases h
  · split at h
    · rename_i ws fx _ hfx
      cases h
      simp only [StateOut.value, outputShape, isText, Bool.and_true, List.all_map, Bool.and_eq_true,
        List.all_eq_true]
      refine ⟨fun w _ => by simpa using write_shape w, fun s hs => ?_⟩
      obtain ⟨snd, _, hout⟩ := mapM_mem hfx s hs
      simpa using out_shape hout
    · cases h

/-! ### Parsing the part and the input -/

def text? : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

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

/-- A message as a Value: `[sender, name, payload, ask id or null]`. -/
def Msg.ofValue? : Value → Option Msg
  | .array [s, n, p, .null] => do return ⟨s, ← text? n, p, none⟩
  | .array [s, n, p, a] => do return ⟨s, ← text? n, p, some a⟩
  | _ => none

/-- A step's input as a Value: `[state, message, [now, seed], phase]`. -/
def StateInput.ofValue? : Value → Option StateInput
  | .array [st, m, .array [.uint now, .uint seed], ph] => do return ⟨st, ← Msg.ofValue? m, now, seed, ← text? ph⟩
  | _ => none

/-! ### The runtime -/

/-- The fuel a step takes: one per handler looked at, per move, and per key and value it reads or writes. -/
def Path.cost (p : Path) : Nat := p.length + 1

def Expr.cost : Expr → Nat
  | .lit v => (encode v).length
  | .payload p | .state p => p.cost
  | .now | .seed => 1

def Update.cost : Update → Nat
  | .set p e | .merge p e | .append p e => p.cost + e.cost + 1
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
    | some sp, some inp => (step sp inp).map StateOut.value
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
    cases hs : step sp inp with
    | error e => intro h; cases h
    | ok out => intro h; cases h; exact step_shape hs
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
    ∃ sp inp out, StatePart.ofValue? p = some sp ∧ StateInput.ofValue? i = some inp ∧ step sp inp = .ok out ∧
      o = out.value ∧ (inp.msg.name, inp.phase, out.phase) ∈ sp.edges := by
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
      exact ⟨sp, inp, out, hsp, hinp, hs, rfl, step_moves hs⟩
  · cases he

end Aven.Runtime
