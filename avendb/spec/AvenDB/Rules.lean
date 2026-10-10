import AvenDB.Ops

/-!
# Rules: caps that name ops

`avendb/docs/OPS.md`, caps that name ops. A write cap's slice may carry rules: which ops its grantee's writes may
make. Every reader of an entry judges each write by its touches, what its Loro ops did, place by place, read off the
write imported on the version it builds on: a value set at a place, rows of a list added, deleted or moved, the entry
created, a proposal started, another line merged in. Rules allow a write when each touch is allowed by one of them.

What a rule allows reads only the rule, the touch and whether the write is on the main line. The state's part, which
caps a write relies on and whether they are ruled, is in `State.lean`; C1 to C4 are proven in `RuleLemmas.lean`, but
for the half of C3 about a write's changes (`changes_allowed`), proven here.
-/

namespace AvenDB

open Ops

/-- A step of a rule's path: a field, a row of a list of records by its id, or any one step. -/
inductive Step where
  | field (f : String)
  | row   (id : Int)
  | any
  deriving DecidableEq, Repr

/-- The lines a rule holds on. -/
inductive On where
  | main
  | proposals
  deriving DecidableEq, Repr

/-- What a write did, one op at a time: a value set or removed, a text edited or a list of values changed at a place
    (`to`: its new value, where one op set one value); a row of a list of records added, deleted or moved (what a write
    does inside a row it adds is part of adding it); the entry created; a proposal started; another line merged in. An
    op a reader can't place touches the whole record (`.root`). -/
inductive Touch where
  | set     (l : Loc) (to : Option Val)
  | insert  (f : String)
  | remove  (f : String)
  | move    (f : String)
  | create
  | propose
  | merge
  deriving DecidableEq, Repr

/-- An op pattern: `set` any change at or under `path` (only to the values `to`, if it lists them), `insert`, `remove`
    or `move` the rows of a list, `merge` another line, each on the lines `on` names (either, if none); `propose` and
    `create`. -/
inductive Rule where
  | set     (path : List Step) (to : Option (List Val)) (on : Option On)
  | insert  (path : List Step) (on : Option On)
  | remove  (path : List Step) (on : Option On)
  | move    (path : List Step) (on : Option On)
  | merge   (on : Option On)
  | propose
  | create
  deriving DecidableEq, Repr

/-- A place's path: a field, a row, or a field of a row. -/
def Ops.Loc.steps : Loc → List Step
  | .root => []
  | .field f => [.field f]
  | .row f i => [.field f, .row i]
  | .cell f i g => [.field f, .row i, .field g]

/-- A step of a pattern fits a step of a path: the same field, the same row, or any. -/
def Step.fits : Step → Step → Bool
  | .any, _ => true
  | .field f, .field g => f == g
  | .row i, .row j => i == j
  | _, _ => false

/-- A pattern reaches a path: it names it, or a place above it, step by step. -/
def reaches : List Step → List Step → Bool
  | [], _ => true
  | _ :: _, [] => false
  | p :: ps, x :: xs => p.fits x && reaches ps xs

/-- A rule's lines hold a write on the main line (`main`) or on a proposal. -/
def onLine (main : Bool) : Option On → Bool
  | none => true
  | some .main => main
  | some .proposals => !main

/-- A rule allows a touch of a write on the main line (`main`) or on a proposal. -/
def Rule.allows (main : Bool) : Rule → Touch → Bool
  | .set p to o, .set l v => onLine main o && reaches p l.steps && match to, v with
    | none, _ => true
    | some vs, some x => vs.contains x
    | some _, none => false
  | .set p none o, .insert f | .set p none o, .remove f | .set p none o, .move f =>
    onLine main o && reaches p [.field f]
  | .insert p o, .insert f | .remove p o, .remove f | .move p o, .move f => onLine main o && reaches p [.field f]
  | .merge o, .merge => onLine main o
  | .propose, .propose => true
  | .create, .create => true
  | _, _ => false

/-- Rules allow a write: each of its touches is allowed by one of them. -/
def allowsAll (rs : List Rule) (main : Bool) (ts : List Touch) : Bool := ts.all fun t => rs.any (·.allows main t)

/-- The place a touch may change: where it sets, the list whose rows it changes, the whole record for a creation;
    none for a proposal's start or a merge, which change nothing of their own. -/
def Touch.loc : Touch → Option Loc
  | .set l _ => some l
  | .insert f | .remove f | .move f => some (.field f)
  | .create => some .root
  | .propose | .merge => none

/-- A pattern that reaches a path reaches every path below it. -/
theorem reaches_append (p xs ys : List Step) (h : reaches p xs = true) : reaches p (xs ++ ys) = true := by
  induction p generalizing xs with
  | nil => rfl
  | cons s ps ih =>
    cases xs with
    | nil => simp [reaches] at h
    | cons x xs =>
      simp only [List.cons_append, reaches, Bool.and_eq_true] at h ⊢
      exact ⟨h.1, ih xs h.2⟩

/-- Rules allow fewer writes the more touches they have. -/
theorem allowsAll_sublist {rs : List Rule} {main : Bool} {ts us : List Touch} (h : allowsAll rs main ts = true)
    (hs : ∀ t ∈ us, t ∈ ts) : allowsAll rs main us = true := by
  simp only [allowsAll, List.all_eq_true] at h ⊢
  exact fun t ht => h t (hs t ht)

/-- C3, the changes: where rules allow every touch of a write and the touches' places cover what the write changed
    (`Within`), every change of its diff is at a place some touch covers that some rule allows. -/
theorem changes_allowed {V : Type} [DecidableEq V] {rs : List Rule} {main : Bool} {ts : List Touch}
    {ps : List Path} {fs : List String} {r s : Record V} {c : Change V} (hall : allowsAll rs main ts = true)
    (hw : Within (ts.filterMap Touch.loc) r s) (hc : c ∈ diff ps fs r s) :
    ∃ t ∈ ts, (∃ l, t.loc = some l ∧ l.covers c.place = true) ∧ ∃ rule ∈ rs, rule.allows main t = true := by
  obtain ⟨l, hl, hcov⟩ := diff_within hw hc
  obtain ⟨t, ht, htl⟩ := List.mem_filterMap.1 hl
  simp only [allowsAll, List.all_eq_true, List.any_eq_true] at hall
  exact ⟨t, ht, ⟨l, htl, hcov⟩, hall t ht⟩

end AvenDB
