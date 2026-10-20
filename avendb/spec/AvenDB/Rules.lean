import AvenDB.Ops

/-!
# Shares are named groups of ops

`avendb/docs/ARCHITECTURE.md` §8. A share is a name and the ops its grantee may make, on the slice its selector picks:
relay, backup and read (keep, pass on and open the slice's edits), the write ops (create an entry, on the main line or
as a draft on a line of its own, set a value, add, delete or move rows, ask for tags, start a proposal, merge a line,
only where all it brings in lies under its path) and share (issue shares resting on it). Its level,
which relays and every operational rule read in the clear, is the class of its strongest op (`levelOf`). Every reader of
an entry judges each write by its touches, what its Loro ops did, place by place, read off the write imported on the
version it builds on, and the tags it asks for: a value set at a place, rows of a list added, deleted or moved, the
entry created, a proposal started, another line merged in and each place that line changed since their base, a tag asked
for. A share's ops allow a write when each touch is allowed by one of them.

What an op allows reads only the op, the touch and whether the write is on the main line. The state's part, which share
a write relies on and the ops of its chain, is in `State.lean`; C1 to C4 are proven in `RuleLemmas.lean`, but for the
half of C3 about a write's changes (`changes_allowed`), proven here.
-/

namespace AvenDB

open Ops

/-- A step of an op's path: a field, a row of a list of records by its id, or any one step. -/
inductive Step where
  | field (f : String)
  | row   (id : Int)
  | any
  deriving DecidableEq, Repr

/-- The lines an op holds on. -/
inductive On where
  | main
  | proposals
  deriving DecidableEq, Repr

/-- What a write did, one op at a time: a value set or removed, a text edited or a list of values changed at a place
    (`to`: its new value, where one op set one value); a row of the list of records at a place added, deleted or moved
    (what a write does inside a row it adds is part of adding it), at any depth; the entry created; a tag asked for,
    added or removed; a proposal started; another line merged in (`merge`), and each place where the writes it brings
    in, those its line's history didn't hold, changed the record (`merged`), read off those writes' touches. An op a
    reader can't place touches the whole record (`[]`). A set inside a row its writer's vault added, or in no row of an
    entry it created, is its own (`own`): readers mark it so from the entry's counted writes (`State.mine`), never the
    writer. -/
inductive Touch where
  | set     (l : Loc) (to : Option Val)
  | own     (l : Loc) (to : Option Val)
  | insert  (l : Loc)
  | remove  (l : Loc)
  | move    (l : Loc)
  | create
  | tag     (t : Sym)
  | propose
  | merge
  | merged  (l : Loc)
  deriving DecidableEq, Repr

/-- An op a share names, in the order shares list them: `relay`, `backup` and `read` its slice's edits; `create`
    entries, on the main line or as drafts, each starting a line of its own; `set` any change at or under `path` (only
    to the values `to`, if it lists them), `setOwn` the same but only of what is the writer's own (a set marked `own`:
    inside a row its vault added, or in no row of an entry it created), `insert`, `remove` or `move` the rows of a list, `merge` another line whose
    changes since their base all lie at or under `path` (anywhere, for `[]`), each of these on the lines `on` names
    (either, if none); ask for the tags `tag` lists (any, if none); `propose`; and `share`, issue shares resting on
    it. -/
inductive Op where
  | relay
  | backup
  | read
  | create  (on : Option On)
  | set     (path : List Step) (to : Option (List Val)) (on : Option On)
  | setOwn  (path : List Step) (to : Option (List Val)) (on : Option On)
  | insert  (path : List Step) (on : Option On)
  | remove  (path : List Step) (on : Option On)
  | move    (path : List Step) (on : Option On)
  | tag     (ts : Option (List Sym))
  | propose
  | merge   (on : Option On) (path : List Step)
  | share
  deriving DecidableEq, Repr

/-- The class of an op: relay, backup and read are their own, share is owner, and every op that writes is write. -/
def Op.level : Op → Level
  | .relay  => .relay
  | .backup => .backup
  | .read   => .read
  | .share  => .owner
  | _       => .write

/-- The stronger of two levels. -/
def Level.max (a b : Level) : Level := if a.rank < b.rank then b else a

/-- A share's level: the class of its strongest op, relay for none. -/
def levelOf (ops : List Op) : Level := ops.foldl (fun r o => r.max o.level) .relay

/-- The ops of a level's built-in group: what a share with that level and no narrower ops allows. A keep share allows
    none. -/
def Level.ops : Level → List Op
  | .keep _ => []
  | .relay  => [.relay]
  | .backup => [.backup]
  | .read   => [.read]
  | .write  => [.read, .create none, .set [] none none, .tag none, .propose, .merge none []]
  | .owner  => [.read, .create none, .set [] none none, .tag none, .propose, .merge none [], .share]

/-- A built-in group: a name, the ops its shares name, and whether it goes to everyone (Public). The page offers them
    when it shares, and anyone may name their own. -/
structure Group where
  name     : String
  ops      : List Op
  everyone : Bool := false
  deriving DecidableEq, Repr

/-- The ops of Member, the group a room gives the people in it (a chat room is an entry of type `room`, its messages
    the rows of its `messages`, a thread's replies the rows of a message's `thread`, reactions the rows of a message's
    `reactions`): read the room; add a message, a reply or a reaction, on the main line, at any depth under the
    messages; and of what is its own alone, change the text of a message or a reply, mark it edited or deleted, change
    whom it mentions and what it links, and take back a reaction (mark it deleted). Nothing of the room's own fields, no
    row moved or removed, no tag, no proposal, no share. -/
def memberOps : List Op :=
  let msg : List Step := [.field "messages", .any]
  let reply := msg ++ [.field "thread", .any]
  let own (p : List Step) : List Op :=
    ["text", "edited", "deleted", "mentions", "links"].map fun f => .setOwn (p ++ [.field f]) none (some .main)
  [.read] ++ own msg ++ own reply ++
    [msg ++ [.field "reactions", .any, .field "deleted"], reply ++ [.field "reactions", .any, .field "deleted"]].map
      (fun p => .setOwn p none (some .main)) ++ [.insert [.field "messages"] (some .main)]

def groups : List Group := [
  ⟨"Owner", Level.owner.ops, false⟩,
  ⟨"Editor", Level.write.ops, false⟩,
  ⟨"Suggester", [.read, .create (some .proposals), .set [] none (some .proposals), .propose,
    .merge (some .proposals) []], false⟩,
  ⟨"Member", memberOps, false⟩,
  ⟨"Viewer", Level.read.ops, false⟩,
  ⟨"Public", Level.read.ops, true⟩,
  ⟨"Backup", Level.backup.ops, false⟩,
  ⟨"Relay", Level.relay.ops, false⟩]

-- each level's group has that level, and a public group only reads
#guard [Level.relay, .backup, .read, .write, .owner].all fun r => levelOf r.ops == r
#guard (groups.map fun g => levelOf g.ops) == [.owner, .write, .write, .write, .read, .read, .backup, .relay]
#guard groups.all fun g => !g.everyone || levelOf g.ops == .read

/-! ## Cap groups

A cap is one op over one slice. A cap group is a name, its caps, and the cap groups of the same vault it includes: an
entry of its vault (`capGroupType`, `State.lean`), versioned as every entry is, which a share names in place of ops of
its own (`Share.group`). So Citizen is the Traveler group and the moves of the game: `includes` composes, and a new
version of a group narrows or widens every share that names it at once. -/

/-- One op over the entries a selector picks. -/
structure Cap where
  op    : Op
  slice : Selector := .all
  deriving DecidableEq, Repr

/-- A cap group, as the record of its entry says: its name, its caps, and the cap groups of its vault it includes, by
    their entries. -/
structure CapGroup where
  name     : String
  caps     : List Cap := []
  includes : List EntryId := []
  deriving DecidableEq, Repr

/-- A built-in group is a cap group of the same kind, fixed by the engine: each of its ops over the whole vault. -/
def Group.toCapGroup (g : Group) : CapGroup := ⟨g.name, g.ops.map fun o => ⟨o, .all⟩, []⟩

-- the built-in groups as cap groups grant, over any entry, exactly their ops
#guard groups.all fun g => (g.toCapGroup.caps.map (·.op)) == g.ops

/-- A step of a place, as a step of a path. -/
def Ops.Seg.step : Seg → Step
  | .field f => .field f
  | .row i => .row i

/-- A place's path: its steps, a field or a row, at any depth. -/
def Ops.Loc.steps (l : Loc) : List Step := l.map Seg.step

/-- The place of the innermost row a place lies in: the place up to its last row; none for a place in no row. -/
def Ops.Loc.row? (l : Loc) : Option Loc :=
  match l.reverse.dropWhile (fun s => match s with | .row _ => false | .field _ => true) with
  | [] => none
  | r => some r.reverse

#guard Ops.Loc.row? [.field "messages", .row 5, .field "text"] == some [.field "messages", .row 5]
#guard Ops.Loc.row? [.field "messages", .row 5, .field "reactions", .row 9, .field "deleted"] ==
  some [.field "messages", .row 5, .field "reactions", .row 9]
#guard Ops.Loc.row? [.field "name"] == none && Ops.Loc.row? [] == none

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

/-- An op's lines hold a write on the main line (`main`) or on a proposal. -/
def onLine (main : Bool) : Option On → Bool
  | none => true
  | some .main => main
  | some .proposals => !main

/-- An op allows a touch of a write on the main line (`main`) or on a proposal. -/
def Op.allows (main : Bool) : Op → Touch → Bool
  | .set p to o, .set l v | .set p to o, .own l v | .setOwn p to o, .own l v =>
    onLine main o && reaches p l.steps && match to, v with
    | none, _ => true
    | some vs, some x => vs.contains x
    | some _, none => false
  | .set p none o, .insert l | .set p none o, .remove l | .set p none o, .move l =>
    onLine main o && reaches p l.steps
  | .insert p o, .insert l | .remove p o, .remove l | .move p o, .move l => onLine main o && reaches p l.steps
  | .merge o _, .merge => onLine main o
  | .merge o p, .merged l => onLine main o && reaches p l.steps
  | .tag none, .tag _ => true
  | .tag (some ts), .tag t => ts.contains t
  | .propose, .propose => true
  | .create o, .create => onLine main o
  | _, _ => false

-- the same patterns at any depth: a field of any row of the lists in any row, a row's list's rows, and a cap on a
-- row covering everything under it
#guard (Op.set [.field "blocks", .any, .field "children", .any, .field "text"] none none).allows true
  (.set [.field "blocks", .row 1, .field "children", .row 2, .field "text"] (some (.str "x")))
#guard !(Op.set [.field "blocks", .any, .field "text"] none none).allows true
  (.set [.field "blocks", .row 1, .field "children", .row 2, .field "text"] none)
#guard (Op.insert [.field "blocks", .any, .field "children"] none).allows true
  (.insert [.field "blocks", .row 1, .field "children"])
#guard !(Op.insert [.field "blocks"] none).allows true (.remove [.field "blocks", .row 1, .field "children"])
#guard [Touch.set [.field "blocks", .row 1, .field "children", .row 2, .field "text"] none,
  .insert [.field "blocks", .row 1, .field "children"], .move [.field "blocks", .row 1, .field "children"]].all
  fun t => (Op.set [.field "blocks", .row 1] none none).allows true t

-- a merge with a path brings in only changes at or under it: a tuner merges new defaults of its params into main, and
-- nothing else; a merge without one brings in anything
#guard (Op.merge (some .main) [.field "params", .any, .field "default"]).allows true
  (.merged [.field "params", .row 2, .field "default"])
#guard !(Op.merge (some .main) [.field "params", .any, .field "default"]).allows true (.merged [.field "source"])
#guard !(Op.merge (some .main) [.field "params", .any, .field "default"]).allows false
  (.merged [.field "params", .row 2, .field "default"])
#guard (Op.merge (some .main) [.field "params", .any, .field "default"]).allows true .merge
#guard (Op.merge none []).allows false (.merged [])
#guard !(Op.set [] none none).allows true (.merged [.field "title"])

-- an own set op allows only a set its readers marked own; a set op allows both
#guard (Op.setOwn [.field "messages", .any, .field "text"] none (some .main)).allows true
  (.own [.field "messages", .row 5, .field "text"] (some (.str "hi")))
#guard !(Op.setOwn [.field "messages", .any, .field "text"] none (some .main)).allows true
  (.set [.field "messages", .row 5, .field "text"] (some (.str "hi")))
#guard !(Op.setOwn [.field "messages", .any, .field "text"] none (some .main)).allows false
  (.own [.field "messages", .row 5, .field "text"] (some (.str "hi")))
#guard (Op.set [] none none).allows true (.own [.field "messages", .row 5, .field "text"] none)
#guard ![Touch.insert [.field "messages", .row 5, .field "thread"], .remove [.field "messages"],
  .move [.field "messages"]].any fun t => (Op.setOwn [.field "messages"] none none).allows true t

/-- Ops allow a write: each of its touches is allowed by one of them. -/
def allowsAll (rs : List Op) (main : Bool) (ts : List Touch) : Bool := ts.all fun t => rs.any (·.allows main t)

-- a Suggester creates drafts alone, each starting a line of its own; an Editor creates on either line, and a create op
-- that names a line creates on that line alone
#guard (groups.find? (·.name == "Suggester")).any fun g =>
  allowsAll g.ops false [.create] && !allowsAll g.ops true [.create]
#guard (groups.find? (·.name == "Editor")).any fun g =>
  allowsAll g.ops false [.create] && allowsAll g.ops true [.create]

-- a Member posts, replies and reacts on main; changes what is its own of a message, a reply or a reaction alone; and
-- names nothing of the room itself, nor any other's message
#guard allowsAll memberOps true [.insert [.field "messages"], .insert [.field "messages", .row 5, .field "thread"],
  .insert [.field "messages", .row 5, .field "reactions"],
  .own [.field "messages", .row 5, .field "text"] (some (.str "hi")),
  .own [.field "messages", .row 5, .field "thread", .row 6, .field "deleted"] (some (.bool true)),
  .own [.field "messages", .row 5, .field "reactions", .row 9, .field "deleted"] (some (.bool true))]
#guard [Touch.set [.field "messages", .row 5, .field "text"] (some (.str "hi")), .own [.field "name"] none,
  .set [.field "topic"] none, .remove [.field "messages"], .move [.field "messages"], .create, .tag 1, .propose,
  .merge, .own [.field "messages", .row 5, .field "reactions", .row 9, .field "key"] none].all fun t =>
  !allowsAll memberOps true [t]
#guard !allowsAll memberOps false [.insert [.field "messages"]] && levelOf memberOps == .write
#guard !(Op.create (some .main)).allows false .create && (Op.create (some .main)).allows true .create

/-- The ops an access request goes to the vault it asks by (the Rust engine's `ask`, `world::answering`): an access
    request is a record the asking vault writes in its own vault and shares, that entry alone, with the vault it asks,
    which reads it and sets, on the main line, its `answer` to granted or denied, and its `part`, its part of the owner
    add a request to co-own asks for, signed for the asker to finish; and nothing else. -/
def answering : List Op :=
  [.read, .set [.field "answer"] (some [.str "granted", .str "denied"]) (some .main),
    .set [.field "part"] none (some .main)]

-- a write share, as the class of its set says, that writes one place to one of two values on the main line
#guard levelOf answering == .write
#guard allowsAll answering true [.set [.field "answer"] (some (.str "granted"))]
#guard allowsAll answering true [.set [.field "answer"] (some (.str "denied"))]
#guard !allowsAll answering true [.set [.field "answer"] (some (.str "maybe"))]
#guard !allowsAll answering true [.set [.field "why"] (some (.str "because"))]
#guard allowsAll answering true [.set [.field "part"] (some (.str "AQID"))]
#guard !allowsAll answering false [.set [.field "part"] (some (.str "AQID"))]
#guard !allowsAll answering false [.set [.field "answer"] (some (.str "granted"))]
#guard !allowsAll answering true [.create] && !allowsAll answering true [.tag 1]

/-- The tags a write asks for, added or removed, as touches. -/
def TagDelta.touches (d : TagDelta) : List Touch := (d.add ++ d.remove).map .tag

/-- The place a touch may change: where it sets, the list whose rows it changes, the place a merge brings a change to,
    the whole record for a creation; none for a tag, a proposal's start or a merge itself, which change nothing of the
    record. -/
def Touch.loc : Touch → Option Loc
  | .set l _ | .own l _ => some l
  | .insert l | .remove l | .move l | .merged l => some l
  | .create => some []
  | .tag _ | .propose | .merge => none

/-- M1, the op: only a merge allows a place a merge brings in, and only one on the write's line whose path reaches it. -/
theorem merged_within {main : Bool} {r : Op} {l : Loc} (h : r.allows main (.merged l) = true) :
    ∃ o p, r = .merge o p ∧ onLine main o = true ∧ reaches p l.steps = true := by
  cases r with
  | merge o p => exact ⟨o, p, rfl, by simpa [Op.allows] using h⟩
  | _ => simp [Op.allows] at h

/-- Only ops that write allow a touch: relay, backup, read and share allow none. -/
theorem level_of_allows {main : Bool} {r : Op} {t : Touch} (h : r.allows main t = true) : r.level = .write := by
  cases r <;> cases t <;> simp_all [Op.allows, Op.level]

theorem max_rank (a b : Level) : a.rank ≤ (a.max b).rank ∧ b.rank ≤ (a.max b).rank := by
  unfold Level.max; split <;> omega

theorem levelOf_foldl (ops : List Op) (r : Level) :
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

/-- A share's level is at least the class of each of its ops. -/
theorem level_le_levelOf {ops : List Op} {o : Op} (h : o ∈ ops) : o.level.rank ≤ (levelOf ops).rank :=
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
theorem allowsAll_sublist {rs : List Op} {main : Bool} {ts us : List Touch} (h : allowsAll rs main ts = true)
    (hs : ∀ t ∈ us, t ∈ ts) : allowsAll rs main us = true := by
  simp only [allowsAll, List.all_eq_true] at h ⊢
  exact fun t ht => h t (hs t ht)

/-- C3, the changes: where ops allow every touch of a write and the touches' places cover what the write changed
    (`Within`), every change of its diff is at a place some touch covers that some op allows. -/
theorem changes_allowed {V : Type} [DecidableEq V] {rs : List Op} {main : Bool} {ts : List Touch}
    {ps : List Path} {fs : List Path} {r s : Record V} {c : Change V} (hall : allowsAll rs main ts = true)
    (hw : Within (ts.filterMap Touch.loc) r s) (hc : c ∈ diff ps fs r s) :
    ∃ t ∈ ts, (∃ l, t.loc = some l ∧ l.covers c.place = true) ∧ ∃ op ∈ rs, op.allows main t = true := by
  obtain ⟨l, hl, hcov⟩ := diff_within hw hc
  obtain ⟨t, ht, htl⟩ := List.mem_filterMap.1 hl
  simp only [allowsAll, List.all_eq_true, List.any_eq_true] at hall
  exact ⟨t, ht, ⟨l, htl, hcov⟩, hall t ht⟩

end AvenDB
