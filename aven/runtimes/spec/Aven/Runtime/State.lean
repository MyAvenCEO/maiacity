import Aven.Runtime.Contract

/-!
# state-runtime (ARCHITECTURE.md of aven/actor, section 5)

A declarative turn, with no code: for each message name, a rule of updates to the state and messages to send. It
computes nothing but lookups, so a step always ends, and every update touches only its own path.

- A **path** is a list of map keys.
- A **source** is a literal Value, or a lookup in the message's payload or in the state.
- An **update** sets, merges into, appends to or removes what is at a path.
- A **send** replies to the ask being handled, or tells an address that a source gives as text (`scope/id/n`).

`StatePart.step` is the runtime: a part, a state, a message's name and payload in; the new state, the sends and the
next phase out. `Aven.Actor` joins it to the kernel's turn.

What it proves:

- `get_set`, `get_set_other`: after `set p v`, `p` holds `v`, and every path apart from `p` (neither along the other)
  holds what it held. `get_remove`: after `remove p`, `p` holds nothing. So an update touches only its path.
-/

namespace Aven.Runtime

open Aven.Core

/-- A path: map keys, each as its UTF-8 bytes. -/
abbrev Path := List Bytes

def path (ks : List String) : Path := ks.map ascii

/-- What is at a path, if anything. -/
def getAt : Value → Path → Option Value
  | v, [] => some v
  | .map kvs, k :: p => (kvs.lookup k).bind (getAt · p)
  | _, _ :: _ => none

def eraseEntry (kvs : List (Bytes × Value)) (k : Bytes) : List (Bytes × Value) := kvs.filter (·.1 != k)

/-- Replace or add a map entry. The order of a map's entries means nothing: its encoding sorts them. -/
def setEntry (kvs : List (Bytes × Value)) (k : Bytes) (v : Value) : List (Bytes × Value) := (k, v) :: eraseEntry kvs k

/-- Put `w` at a path, making maps on the way where there are none. -/
def setAt : Value → Path → Value → Value
  | _, [], w => w
  | .map kvs, k :: p, w => .map (setEntry kvs k (setAt ((kvs.lookup k).getD (.map [])) p w))
  | _, k :: p, w => .map [(k, setAt (.map []) p w)]

/-- Remove what is at a path; nothing changes where nothing is. -/
def removeAt : Value → Path → Value
  | _, [] => .null
  | .map kvs, [k] => .map (eraseEntry kvs k)
  | .map kvs, k :: p => match kvs.lookup k with
    | some w => .map (setEntry kvs k (removeAt w p))
    | none => .map kvs
  | v, _ :: _ => v

inductive Source where
  | lit (v : Value)
  | payload (p : Path)
  | state (p : Path)
  deriving Repr, Inhabited

def Source.eval (src : Source) (st payload : Value) : Value :=
  match src with
  | .lit v => v
  | .payload p => (getAt payload p).getD .null
  | .state p => (getAt st p).getD .null

inductive Update where
  | set (p : Path) (src : Source)
  /-- The source's map entries go into the map at `p`. -/
  | merge (p : Path) (src : Source)
  /-- The source goes at the end of the array at `p`. -/
  | append (p : Path) (src : Source)
  | remove (p : Path)
  deriving Repr, Inhabited

def Update.apply (u : Update) (payload : Value) (st : Value) : Value :=
  match u with
  | .set p src => setAt st p (src.eval st payload)
  | .merge p src =>
    match (getAt st p).getD (.map []), src.eval st payload with
    | .map old, .map new => setAt st p (.map (new.foldl (fun acc (k, v) => setEntry acc k v) old))
    | _, v => setAt st p v
  | .append p src =>
    match (getAt st p).getD (.array []) with
    | .array xs => setAt st p (.array (xs ++ [src.eval st payload]))
    | _ => setAt st p (.array [src.eval st payload])
  | .remove p => removeAt st p

inductive Send where
  | reply (src : Source)
  | tell (to : Source) (name : String) (payload : Source)
  deriving Repr, Inhabited

/-- One message name's rule: updates in order, then sends, from the new state, and an optional next phase. -/
structure StateRule where
  updates : List Update
  sends : List Send
  phase : Option String
  deriving Repr, Inhabited

/-- A state-runtime part: a rule per message name. -/
abbrev StatePart := List (String × StateRule)

/-- What a send comes to: a reply's Value, or a tell to an address given as text. -/
inductive SendOut where
  | reply (v : Value)
  | tell (to : String) (name : String) (payload : Value)
  deriving Repr, Inhabited

def textOf : Value → Option String
  | .text b => String.fromUTF8? ⟨b.toArray⟩
  | _ => none

/-- A send, from the new state and the payload. A tell to something that is no text is dropped. -/
def Send.out (s : Send) (st payload : Value) : Option SendOut :=
  match s with
  | .reply src => some (.reply (src.eval st payload))
  | .tell to name p => (textOf (to.eval st payload)).map fun a => .tell a name (p.eval st payload)

structure StateOut where
  state : Value
  sends : List SendOut
  phase : Option String
  deriving Repr, Inhabited

/-- state-runtime: no rule for the message is an error; otherwise the updates in order, then the sends. -/
def StatePart.step (part : StatePart) (st : Value) (name : String) (payload : Value) : Option StateOut :=
  match part.lookup name with
  | none => none
  | some rule =>
    let st' := rule.updates.foldl (fun s u => u.apply payload s) st
    some ⟨st', rule.sends.filterMap (·.out st' payload), rule.phase⟩

/-! ## An update touches only its path -/

theorem lookup_eraseEntry_other (kvs : List (Bytes × Value)) (k k' : Bytes) (hk : k' ≠ k) :
    (eraseEntry kvs k).lookup k' = kvs.lookup k' := by
  induction kvs with
  | nil => rfl
  | cons e kvs ih =>
    unfold eraseEntry at ih ⊢
    by_cases he : e.1 = k
    · have h1 : (k' == k) = false := by simpa using hk
      simp [List.filter, he, List.lookup, h1, ih]
    · have hne : (e.1 != k) = true := by simpa using he
      simp only [List.filter, hne, List.lookup]
      split <;> simp_all

theorem lookup_eraseEntry_self (kvs : List (Bytes × Value)) (k : Bytes) : (eraseEntry kvs k).lookup k = none := by
  induction kvs with
  | nil => rfl
  | cons e kvs ih =>
    unfold eraseEntry at ih ⊢
    by_cases he : e.1 = k
    · simp [List.filter, he, ih]
    · have hne : (e.1 != k) = true := by simpa using he
      have : (k == e.1) = false := by simp [Ne.symm he]
      simp [List.filter, hne, List.lookup, this, ih]

theorem lookup_setEntry_self (kvs : List (Bytes × Value)) (k : Bytes) (v : Value) :
    (setEntry kvs k v).lookup k = some v := by
  simp [setEntry]

theorem lookup_setEntry_other (kvs : List (Bytes × Value)) (k k' : Bytes) (v : Value) (hk : k' ≠ k) :
    (setEntry kvs k v).lookup k' = kvs.lookup k' := by
  have : (k' == k) = false := by simpa using hk
  simp only [setEntry, List.lookup, this]
  exact lookup_eraseEntry_other kvs k k' hk

/-- After `set p w`, the path holds `w`. -/
theorem get_set (v : Value) (p : Path) (w : Value) : getAt (setAt v p w) p = some w := by
  induction p generalizing v with
  | nil => simp [setAt, getAt]
  | cons k p ih =>
    cases v <;> simp [setAt, getAt, lookup_setEntry_self, List.lookup, ih]

/-- Neither path lies along the other. -/
def Apart (p q : Path) : Prop := ¬ p <+: q ∧ ¬ q <+: p

/-- A set leaves every path apart from it as it was: an update touches only its path. -/
theorem get_set_other (v : Value) (p q : Path) (w : Value) (h : Apart p q) : getAt (setAt v p w) q = getAt v q := by
  induction p generalizing v q with
  | nil => exact absurd (List.nil_prefix) h.1
  | cons k p ih =>
    cases q with
    | nil => exact absurd (List.nil_prefix) h.2
    | cons k' q =>
      by_cases hkk : k' = k
      · subst hkk
        have h' : Apart p q := ⟨fun hp => h.1 (List.prefix_cons_inj _ |>.mpr hp),
          fun hq => h.2 (List.prefix_cons_inj _ |>.mpr hq)⟩
        have hq : q ≠ [] := by rintro rfl; exact h.2 (List.prefix_cons_inj _ |>.mpr (List.nil_prefix))
        cases v with
        | map kvs =>
          simp only [setAt, getAt, lookup_setEntry_self, Option.bind_some]
          rw [ih _ _ h']
          cases hl : kvs.lookup k' with
          | none =>
            obtain ⟨k2, q2, rfl⟩ := List.exists_cons_of_ne_nil hq
            simp [getAt, List.lookup]
          | some x => simp
        | _ =>
          simp only [setAt, getAt, List.lookup, BEq.rfl, Option.bind_some]
          rw [ih _ _ h']
          obtain ⟨k2, q2, rfl⟩ := List.exists_cons_of_ne_nil hq
          simp [getAt, List.lookup]
      · cases v with
        | map kvs => simp [setAt, getAt, lookup_setEntry_other _ _ _ _ hkk]
        | _ =>
          have : (k' == k) = false := by simpa using hkk
          simp [setAt, getAt, List.lookup, this]

/-- After `remove p`, nothing is at `p`. -/
theorem get_remove (v : Value) (p : Path) (hp : p ≠ []) : getAt (removeAt v p) p = none := by
  induction p generalizing v with
  | nil => exact absurd rfl hp
  | cons k p ih =>
    cases p with
    | nil =>
      cases v <;> simp [removeAt, getAt, lookup_eraseEntry_self]
    | cons k2 p2 =>
      cases v with
      | map kvs =>
        simp only [removeAt]
        cases hl : kvs.lookup k with
        | none => simp [getAt, hl]
        | some w => simp [getAt, lookup_setEntry_self, ih w (by simp)]
      | _ => simp [removeAt, getAt]

end Aven.Runtime
