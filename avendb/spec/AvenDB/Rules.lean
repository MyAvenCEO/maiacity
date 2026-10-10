import AvenDB.Ops

/-!
# Caps are named groups of ops

`avendb/docs/OPS.md`, caps. A cap is a name and the ops its grantee may make, on the slice its selector picks: relay,
backup and read (keep, pass on and open the slice's edits), the write ops (create an entry, set a value, add, delete or
move rows, ask for tags, start a proposal, merge a line) and share (issue caps resting on it). Its role, which relays
and every operational rule read in the clear, is the class of its strongest op (`levelOf`). Every reader of an entry
judges each write by its touches, what its Loro ops did, place by place, read off the write imported on the version it
builds on, and the tags it asks for: a value set at a place, rows of a list added, deleted or moved, the entry created,
a proposal started, another line merged in, a tag asked for. A cap's ops allow a write when each touch is allowed by one
of them.

What an op allows reads only the op, the touch and whether the write is on the main line. The state's part, which cap a
write relies on and the ops of its chain, is in `State.lean`; C1 to C4 are proven in `RuleLemmas.lean`, but for the
half of C3 about a write's changes (`changes_allowed`), proven here.
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
    does inside a row it adds is part of adding it); the entry created; a tag asked for, added or removed; a proposal
    started; another line merged in. An op a reader can't place touches the whole record (`.root`). -/
inductive Touch where
  | set     (l : Loc) (to : Option Val)
  | insert  (f : String)
  | remove  (f : String)
  | move    (f : String)
  | create
  | tag     (t : Sym)
  | propose
  | merge
  deriving DecidableEq, Repr

/-- An op a cap names, in the order caps list them: `relay`, `backup` and `read` its slice's edits; `create` entries;
    `set` any change at or under `path` (only to the values `to`, if it lists them), `insert`, `remove` or `move` the
    rows of a list, `merge` another line, each on the lines `on` names (either, if none); ask for the tags `tag` lists
    (any, if none); `propose`; and `share`, issue caps resting on it. -/
inductive Rule where
  | relay
  | backup
  | read
  | create
  | set     (path : List Step) (to : Option (List Val)) (on : Option On)
  | insert  (path : List Step) (on : Option On)
  | remove  (path : List Step) (on : Option On)
  | move    (path : List Step) (on : Option On)
  | tag     (ts : Option (List Sym))
  | propose
  | merge   (on : Option On)
  | share
  deriving DecidableEq, Repr

/-- The class of an op: relay, backup and read are their own, share is owner, and every op that writes is write. -/
def Rule.level : Rule → Role
  | .relay  => .relay
  | .backup => .backup
  | .read   => .read
  | .share  => .owner
  | _       => .write

/-- The stronger of two roles. -/
def Role.max (a b : Role) : Role := if a.rank < b.rank then b else a

/-- A cap's role: the class of its strongest op, relay for none. -/
def levelOf (ops : List Rule) : Role := ops.foldl (fun r o => r.max o.level) .relay

/-- The ops of a role's built-in group: what a cap with that role and no narrower ops allows. -/
def Role.ops : Role → List Rule
  | .relay  => [.relay]
  | .backup => [.backup]
  | .read   => [.read]
  | .write  => [.read, .create, .set [] none none, .tag none, .propose, .merge none]
  | .owner  => [.read, .create, .set [] none none, .tag none, .propose, .merge none, .share]

/-- A built-in group: a name, the ops its caps name, and whether it goes to everyone (Public). The page offers them
    when it shares, and anyone may name their own. -/
structure Group where
  name     : String
  ops      : List Rule
  everyone : Bool := false
  deriving DecidableEq, Repr

def groups : List Group := [
  ⟨"Owner", Role.owner.ops, false⟩,
  ⟨"Editor", Role.write.ops, false⟩,
  ⟨"Suggester", [.read, .set [] none (some .proposals), .propose, .merge (some .proposals)], false⟩,
  ⟨"Viewer", Role.read.ops, false⟩,
  ⟨"Public", Role.read.ops, true⟩,
  ⟨"Backup", Role.backup.ops, false⟩,
  ⟨"Relay", Role.relay.ops, false⟩]

-- each role's group has that role, and a public group only reads
#guard [Role.relay, .backup, .read, .write, .owner].all fun r => levelOf r.ops == r
#guard (groups.map fun g => levelOf g.ops) == [.owner, .write, .write, .read, .read, .backup, .relay]
#guard groups.all fun g => !g.everyone || levelOf g.ops == .read

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
  | .tag none, .tag _ => true
  | .tag (some ts), .tag t => ts.contains t
  | .propose, .propose => true
  | .create, .create => true
  | _, _ => false

/-- Ops allow a write: each of its touches is allowed by one of them. -/
def allowsAll (rs : List Rule) (main : Bool) (ts : List Touch) : Bool := ts.all fun t => rs.any (·.allows main t)

/-- The tags a write asks for, added or removed, as touches. -/
def TagDelta.touches (d : TagDelta) : List Touch := (d.add ++ d.remove).map .tag

/-- The place a touch may change: where it sets, the list whose rows it changes, the whole record for a creation;
    none for a tag, a proposal's start or a merge, which change nothing of the record. -/
def Touch.loc : Touch → Option Loc
  | .set l _ => some l
  | .insert f | .remove f | .move f => some (.field f)
  | .create => some .root
  | .tag _ | .propose | .merge => none

/-- Only ops that write allow a touch: relay, backup, read and share allow none. -/
theorem level_of_allows {main : Bool} {r : Rule} {t : Touch} (h : r.allows main t = true) : r.level = .write := by
  cases r <;> cases t <;> simp_all [Rule.allows, Rule.level]

theorem max_rank (a b : Role) : a.rank ≤ (a.max b).rank ∧ b.rank ≤ (a.max b).rank := by
  unfold Role.max; split <;> omega

theorem levelOf_foldl (ops : List Rule) (r : Role) :
    r.rank ≤ (ops.foldl (fun r o => r.max o.level) r).rank ∧
      ∀ o ∈ ops, o.level.rank ≤ (ops.foldl (fun r o => r.max o.level) r).rank := by
  induction ops generalizing r with
  | nil => simp
  | cons o os ih =>
    obtain ⟨h1, h2⟩ := ih (r.max o.level)
    obtain ⟨m1, m2⟩ := max_rank r o.level
    refine ⟨Nat.le_trans m1 h1, fun x hx => ?_⟩
    rcases List.mem_cons.1 hx with rfl | hx
    · exact Nat.le_trans m2 h1
    · exact h2 x hx

/-- A cap's role is at least the class of each of its ops. -/
theorem level_le_levelOf {ops : List Rule} {o : Rule} (h : o ∈ ops) : o.level.rank ≤ (levelOf ops).rank :=
  (levelOf_foldl ops .relay).2 o h

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

/-- Ops allow fewer writes the more touches they have. -/
theorem allowsAll_sublist {rs : List Rule} {main : Bool} {ts us : List Touch} (h : allowsAll rs main ts = true)
    (hs : ∀ t ∈ us, t ∈ ts) : allowsAll rs main us = true := by
  simp only [allowsAll, List.all_eq_true] at h ⊢
  exact fun t ht => h t (hs t ht)

/-- C3, the changes: where ops allow every touch of a write and the touches' places cover what the write changed
    (`Within`), every change of its diff is at a place some touch covers that some op allows. -/
theorem changes_allowed {V : Type} [DecidableEq V] {rs : List Rule} {main : Bool} {ts : List Touch}
    {ps : List Path} {fs : List String} {r s : Record V} {c : Change V} (hall : allowsAll rs main ts = true)
    (hw : Within (ts.filterMap Touch.loc) r s) (hc : c ∈ diff ps fs r s) :
    ∃ t ∈ ts, (∃ l, t.loc = some l ∧ l.covers c.place = true) ∧ ∃ rule ∈ rs, rule.allows main t = true := by
  obtain ⟨l, hl, hcov⟩ := diff_within hw hc
  obtain ⟨t, ht, htl⟩ := List.mem_filterMap.1 hl
  simp only [allowsAll, List.all_eq_true, List.any_eq_true] at hall
  exact ⟨t, ht, ⟨l, htl, hcov⟩, hall t ht⟩

end AvenDB
