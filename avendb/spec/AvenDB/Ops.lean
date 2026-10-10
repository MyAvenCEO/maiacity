import AvenDB.Basic

/-!
# Ops: one language to read and change any record

`avendb/docs/OPS.md`. Apps read and change records, whatever their schema, by ops: JSON values that the page, the Mac
app and every device's engine share. This file is what they mean.

- **Records, flat.** A record (what an item stores, or an app's view of it) is a JSON object. Flat, it is a value at
  each place (a field, or a field of a row of a list of records) and the rows of each list of records, in order. A row
  is named by its id, and where several rows share one (two devices added one at once) also by how many rows with
  that id come before it, its copy.
- **Changes.** The normal form of what a write did: the new value of a place (none: gone), the new rows of a list
  (none: the field no longer holds a list of records). `apply` runs changes in turn, `diff` gives the changes between
  two records. O1 (`apply_diff`): applying the diff of `r` and `s` to `r` gives `s`. So no change escapes a diff
  (`diff_complete`), and a diff names only what changed (`diff_sound`): what a reader checks of a write is all it did.
- **Ops.** What an app asks: set or unset a field, a row or a field of a row; insert, remove and move a row of a list
  of records; add a value to a list of values or drop one. Each names a place (`Loc`), and what it does is a change
  within it: O2 (`diff_within`): the diff of a change within some places names only what those places cover.
- **Queries.** A query's `where` mixes labels, the tests of a cap's selector, with tests of a record's values. Its
  labels make a selector that picks no less than the query (`cover_sound`), so a device can pick entries by labels
  first and test values only in what it opens: O3 (`plan_run`).
-/

namespace AvenDB.Ops

/-! ## Records, flat -/

/-- A row of a list of records: its id, and how many rows with that id come before it in the list. -/
structure Key where
  id   : Int
  copy : Nat := 0
  deriving DecidableEq, Repr

/-- A place of a record: a field, or a field of a row of a list of records. -/
inductive Path where
  | top (f : String)
  | row (f : String) (k : Key) (g : String)
  deriving DecidableEq, Repr

/-- A record, flat: the value at each place, and the rows of each list of records in order. A field holds a value
    (`leaf (.top f)`) or a list of records (`rows f`), and the fields of a list's rows are its places. -/
@[ext] structure Record (V : Type) where
  leaf : Path → Option V
  rows : String → Option (List Key)

/-- A change: a place's new value (none: gone), or a list's new rows (none: the field holds no list of records). -/
inductive Change (V : Type) where
  | set   (p : Path) (v : Option V)
  | order (f : String) (ks : Option (List Key))
  deriving DecidableEq, Repr

/-- What a change writes: a place, or a field's rows. -/
inductive Place where
  | leaf (p : Path)
  | list (f : String)
  deriving DecidableEq, Repr

section Flat

variable {V : Type}

def Change.place : Change V → Place
  | .set p _   => .leaf p
  | .order f _ => .list f

def Change.on (r : Record V) : Change V → Record V
  | .set q v    => { r with leaf := fun p => if p = q then v else r.leaf p }
  | .order g ks => { r with rows := fun f => if f = g then ks else r.rows f }

/-- The changes, one after the other. -/
def apply (r : Record V) (cs : List (Change V)) : Record V := cs.foldl Change.on r

/-- The value the last change of `cs` to place `p` gives it, if one changes it. -/
def setOf (p : Path) : List (Change V) → Option (Option V)
  | [] => none
  | .set q v :: cs    => (setOf p cs).or (if p = q then some v else none)
  | .order _ _ :: cs  => setOf p cs

/-- The rows the last change of `cs` to list `f` gives it, if one changes it. -/
def orderOf (f : String) : List (Change V) → Option (Option (List Key))
  | [] => none
  | .set _ _ :: cs    => orderOf f cs
  | .order g ks :: cs => (orderOf f cs).or (if f = g then some ks else none)

theorem apply_leaf (r : Record V) (cs : List (Change V)) (p : Path) :
    (apply r cs).leaf p = (setOf p cs).getD (r.leaf p) := by
  induction cs generalizing r with
  | nil => rfl
  | cons c cs ih =>
    show (apply (c.on r) cs).leaf p = _
    rw [ih]
    cases c with
    | set q v =>
      simp only [setOf, Change.on]
      cases setOf p cs <;> by_cases h : p = q <;> simp [h]
    | order g ks => simp [setOf, Change.on]

theorem apply_rows (r : Record V) (cs : List (Change V)) (f : String) :
    (apply r cs).rows f = (orderOf f cs).getD (r.rows f) := by
  induction cs generalizing r with
  | nil => rfl
  | cons c cs ih =>
    show (apply (c.on r) cs).rows f = _
    rw [ih]
    cases c with
    | set q v => simp [orderOf, Change.on]
    | order g ks =>
      simp only [orderOf, Change.on]
      cases orderOf f cs <;> by_cases h : f = g <;> simp [h]

theorem setOf_append (p : Path) (xs ys : List (Change V)) : setOf p (xs ++ ys) = (setOf p ys).or (setOf p xs) := by
  induction xs with
  | nil => simp [setOf]
  | cons c xs ih => cases c <;> simp [setOf, ih, Option.or_assoc]

theorem orderOf_append (f : String) (xs ys : List (Change V)) :
    orderOf f (xs ++ ys) = (orderOf f ys).or (orderOf f xs) := by
  induction xs with
  | nil => simp [orderOf]
  | cons c xs ih => cases c <;> simp [orderOf, ih, Option.or_assoc]

theorem setOf_orders (p : Path) (fs : List String) (g : String → Option (List Key)) :
    setOf p (fs.map fun f => (Change.order f (g f) : Change V)) = none := by
  induction fs with
  | nil => rfl
  | cons f fs ih => simpa [setOf] using ih

theorem orderOf_sets (f : String) (ps : List Path) (g : Path → Option V) :
    orderOf f (ps.map fun p => Change.set p (g p)) = none := by
  induction ps with
  | nil => rfl
  | cons p ps ih => simpa [orderOf] using ih

theorem setOf_sets (p : Path) (qs : List Path) (g : Path → Option V) :
    setOf p (qs.map fun q => Change.set q (g q)) = if p ∈ qs then some (g p) else none := by
  induction qs with
  | nil => simp [setOf]
  | cons q qs ih =>
    simp only [List.map_cons, setOf, ih, List.mem_cons]
    by_cases e : p = q
    · subst e; by_cases h : p ∈ qs <;> simp [h]
    · by_cases h : p ∈ qs <;> simp [h, e]

theorem orderOf_orders (f : String) (fs : List String) (g : String → Option (List Key)) :
    orderOf f (fs.map fun g' => (Change.order g' (g g') : Change V)) = if f ∈ fs then some (g f) else none := by
  induction fs with
  | nil => simp [orderOf]
  | cons f' fs ih =>
    simp only [List.map_cons, orderOf, ih, List.mem_cons]
    by_cases e : f = f'
    · subst e; by_cases h : f ∈ fs <;> simp [h]
    · by_cases h : f ∈ fs <;> simp [h, e]

/-- The changes that make `r` into `s`, given the lists `fs` and the places `ps` where they may differ: the new rows
    of each list that changed, then the new value of each place that changed. -/
def diff [DecidableEq V] (ps : List Path) (fs : List String) (r s : Record V) : List (Change V) :=
  (fs.filter fun f => decide (r.rows f ≠ s.rows f)).map (fun f => .order f (s.rows f)) ++
  (ps.filter fun p => decide (r.leaf p ≠ s.leaf p)).map (fun p => .set p (s.leaf p))

/-- `ps` and `fs` hold every place and every list where `r` and `s` differ. -/
def Reaches (ps : List Path) (fs : List String) (r s : Record V) : Prop :=
  (∀ p, r.leaf p ≠ s.leaf p → p ∈ ps) ∧ (∀ f, r.rows f ≠ s.rows f → f ∈ fs)

/-- O1, diff explains apply: applying the diff of `r` and `s` to `r` gives `s`. -/
theorem apply_diff [DecidableEq V] {ps : List Path} {fs : List String} {r s : Record V} (h : Reaches ps fs r s) :
    apply r (diff ps fs r s) = s := by
  apply Record.ext
  · funext p
    rw [apply_leaf, diff, setOf_append, setOf_sets, setOf_orders]
    by_cases hp : r.leaf p = s.leaf p
    · simp [List.mem_filter, hp]
    · simp [List.mem_filter, h.1 p hp, hp]
  · funext f
    rw [apply_rows, diff, orderOf_append, orderOf_sets, orderOf_orders]
    by_cases hf : r.rows f = s.rows f
    · simp [List.mem_filter, hf]
    · simp [List.mem_filter, h.2 f hf, hf]

/-- Nothing escapes a diff: each place and each list that changed has its new value in it. -/
theorem diff_complete [DecidableEq V] {ps : List Path} {fs : List String} {r s : Record V} (h : Reaches ps fs r s) :
    (∀ p, r.leaf p ≠ s.leaf p → .set p (s.leaf p) ∈ diff ps fs r s) ∧
    (∀ f, r.rows f ≠ s.rows f → .order f (s.rows f) ∈ diff ps fs r s) := by
  constructor
  · intro p hp
    exact List.mem_append_right _ (List.mem_map.2 ⟨p, List.mem_filter.2 ⟨h.1 p hp, by simpa using hp⟩, rfl⟩)
  · intro f hf
    exact List.mem_append_left _ (List.mem_map.2 ⟨f, List.mem_filter.2 ⟨h.2 f hf, by simpa using hf⟩, rfl⟩)

/-- A change says what changed between `r` and `s`. -/
def Change.differs (r s : Record V) : Change V → Prop
  | .set p v    => r.leaf p ≠ s.leaf p ∧ v = s.leaf p
  | .order f ks => r.rows f ≠ s.rows f ∧ ks = s.rows f

/-- A diff names only what changed. -/
theorem diff_sound [DecidableEq V] {ps : List Path} {fs : List String} {r s : Record V} {c : Change V}
    (hc : c ∈ diff ps fs r s) : c.differs r s := by
  simp only [diff, List.mem_append, List.mem_map, List.mem_filter] at hc
  rcases hc with ⟨f, ⟨_, hf⟩, rfl⟩ | ⟨p, ⟨_, hp⟩, rfl⟩
  · exact ⟨by simpa using hf, rfl⟩
  · exact ⟨by simpa using hp, rfl⟩

/-- A place no change writes keeps its value. -/
theorem apply_keeps {r : Record V} {cs : List (Change V)} {p : Path} (h : ∀ c ∈ cs, c.place ≠ .leaf p) :
    (apply r cs).leaf p = r.leaf p := by
  have : setOf p cs = none := by
    induction cs with
    | nil => rfl
    | cons c cs ih =>
      have rest := ih fun c' hc' => h c' (List.mem_cons_of_mem _ hc')
      cases c with
      | set q v =>
        have hq : p ≠ q := fun e => h _ (List.mem_cons_self ..) (by simp [Change.place, e])
        simp [setOf, rest, hq]
      | order g ks => simpa [setOf] using rest
  rw [apply_leaf, this]; rfl

/-! ### Places ops name -/

/-- What an op names: the whole record, a field, a row of a list of records (the first with that id, the one apps
    see), or a field of such a row. -/
inductive Loc where
  | root
  | field (f : String)
  | row   (f : String) (id : Int)
  | cell  (f : String) (id : Int) (g : String)
  deriving DecidableEq, Repr

/-- What changing at `l` may change. A row's place in its list is its list's order; and as rows are told apart by
    how many with their id come before them, changing one row of an id may renumber its copies. -/
def Loc.covers : Loc → Place → Bool
  | .root, _                                    => true
  | .field f, .leaf (.top g)                    => f == g
  | .field f, .leaf (.row g _ _)                => f == g
  | .field f, .list g                           => f == g
  | .row f i, .leaf (.row g k _)                => f == g && i == k.id
  | .row f _, .list g                           => f == g
  | .cell f i g, .leaf (.row f' k g')           => f == f' && i == k.id && g == g'
  | _, _                                        => false

/-- `s` is `r` changed only where some of `ls` covers. -/
def Within (ls : List Loc) (r s : Record V) : Prop :=
  (∀ p, r.leaf p ≠ s.leaf p → ∃ l ∈ ls, l.covers (.leaf p)) ∧
  (∀ f, r.rows f ≠ s.rows f → ∃ l ∈ ls, l.covers (.list f))

/-- Ops one after the other change only where one of them covers. -/
theorem Within.trans {ls ms : List Loc} {r s t : Record V} (h₁ : Within ls r s) (h₂ : Within ms s t) :
    Within (ls ++ ms) r t := by
  constructor
  · intro p hp
    by_cases e : r.leaf p = s.leaf p
    · obtain ⟨l, hl, c⟩ := h₂.1 p (e ▸ hp)
      exact ⟨l, List.mem_append_right _ hl, c⟩
    · obtain ⟨l, hl, c⟩ := h₁.1 p e
      exact ⟨l, List.mem_append_left _ hl, c⟩
  · intro f hf
    by_cases e : r.rows f = s.rows f
    · obtain ⟨l, hl, c⟩ := h₂.2 f (e ▸ hf)
      exact ⟨l, List.mem_append_right _ hl, c⟩
    · obtain ⟨l, hl, c⟩ := h₁.2 f e
      exact ⟨l, List.mem_append_left _ hl, c⟩

/-- O2, apply is what it says: the diff of a change within `ls` names only what `ls` covers. -/
theorem diff_within [DecidableEq V] {ls : List Loc} {ps : List Path} {fs : List String} {r s : Record V} {c : Change V}
    (hw : Within ls r s) (hc : c ∈ diff ps fs r s) : ∃ l ∈ ls, l.covers c.place := by
  have := diff_sound hc
  cases c with
  | set p v => exact hw.1 p this.1
  | order f ks => exact hw.2 f this.1

end Flat

/-! ## Records as JSON

The values of the records the vectors hold: scalars, and lists of scalars. (The engine takes any JSON value as a
leaf.) An empty JSON array is an empty list of records: a field's kind is read from its value alone. -/

inductive Val where
  | null
  | bool (b : Bool)
  | int  (n : Int)
  | str  (s : String)
  deriving DecidableEq, Repr

/-- A value at a place: one value, or a list of them. -/
inductive Leaf where
  | one  (v : Val)
  | many (vs : List Val)
  deriving DecidableEq, Repr

/-- A row of a list of records: its id, and its other fields. -/
structure Row where
  id     : Int
  fields : List (String × Leaf)
  deriving DecidableEq, Repr

/-- What a field holds. -/
inductive Item where
  | leaf (v : Leaf)
  | rows (rs : List Row)
  deriving DecidableEq, Repr

/-- A record: its fields, each once. -/
abbrev Doc := List (String × Item)

/-- A list of values as JSON reads it back: an empty one is an empty list of records. -/
def Item.list (vs : List Val) : Item := if vs.isEmpty then .rows [] else .leaf (.many vs)

/-- Each row with its key: its id, and how many rows before it have that id. -/
def keyed (rs : List Row) : List (Key × Row) :=
  rs.zipIdx.map fun (r, i) => (⟨r.id, (rs.take i).countP (·.id == r.id)⟩, r)

/-- The record, flat. -/
def Doc.meaning (d : Doc) : Record Leaf where
  leaf
    | .top f => match d.lookup f with
      | some (.leaf v) => some v
      | _ => none
    | .row f k g => match d.lookup f with
      | some (.rows rs) => ((keyed rs).lookup k).bind (·.fields.lookup g)
      | _ => none
  rows f := match d.lookup f with
    | some (.rows rs) => some ((keyed rs).map (·.1))
    | _ => none

/-- Its places that hold a value. -/
def Doc.paths (d : Doc) : List Path :=
  d.flatMap fun (f, x) => match x with
    | .leaf _ => [.top f]
    | .rows rs => (keyed rs).flatMap fun (k, r) => r.fields.map fun (g, _) => .row f k g

/-- Its lists of records. -/
def Doc.lists (d : Doc) : List String :=
  d.filterMap fun (f, x) => match x with
    | .rows _ => some f
    | .leaf _ => none

theorem lookup_mem {α β : Type} [BEq α] [LawfulBEq α] {a : α} {b : β} :
    ∀ {xs : List (α × β)}, xs.lookup a = some b → (a, b) ∈ xs
  | [], h => by simp [List.lookup] at h
  | (k, v) :: xs, h => by
    by_cases e : a = k
    · subst e; simp [List.lookup] at h; simp [h]
    · have ne : (a == k) = false := by simp [e]
      simp only [List.lookup, ne] at h
      exact List.mem_cons_of_mem _ (lookup_mem h)

theorem Doc.leaf_mem {d : Doc} {p : Path} (h : d.meaning.leaf p ≠ none) : p ∈ d.paths := by
  cases p with
  | top f =>
    simp only [Doc.meaning] at h
    split at h
    · rename_i v hv
      exact List.mem_flatMap.2 ⟨(f, .leaf v), lookup_mem hv, by simp⟩
    · exact absurd rfl h
  | row f k g =>
    simp only [Doc.meaning] at h
    split at h
    · rename_i rs hrs
      cases hr : (keyed rs).lookup k with
      | none => simp [hr] at h
      | some r =>
        cases hv : r.fields.lookup g with
        | none => simp [hr, hv] at h
        | some v =>
          refine List.mem_flatMap.2 ⟨(f, .rows rs), lookup_mem hrs, ?_⟩
          exact List.mem_flatMap.2 ⟨(k, r), lookup_mem hr, List.mem_map.2 ⟨(g, v), lookup_mem hv, rfl⟩⟩
    · exact absurd rfl h

theorem Doc.rows_mem {d : Doc} {f : String} (h : d.meaning.rows f ≠ none) : f ∈ d.lists := by
  simp only [Doc.meaning] at h
  split at h
  · rename_i rs hrs
    exact List.mem_filterMap.2 ⟨(f, .rows rs), lookup_mem hrs, rfl⟩
  · exact absurd rfl h

/-- Two records' places and lists reach everything where they differ. -/
theorem Doc.reaches (d e : Doc) : Reaches (d.paths ++ e.paths) (d.lists ++ e.lists) d.meaning e.meaning := by
  constructor
  · intro p hp
    by_cases hd : d.meaning.leaf p = none
    · have : e.meaning.leaf p ≠ none := fun he => hp (hd.trans he.symm)
      exact List.mem_append_right _ (Doc.leaf_mem this)
    · exact List.mem_append_left _ (Doc.leaf_mem hd)
  · intro f hf
    by_cases hd : d.meaning.rows f = none
    · have : e.meaning.rows f ≠ none := fun he => hf (hd.trans he.symm)
      exact List.mem_append_right _ (Doc.rows_mem this)
    · exact List.mem_append_left _ (Doc.rows_mem hd)

/-- What a write did to a record: its changes, each list's new rows first, then each place's new value. -/
def Doc.diff (d e : Doc) : List (Change Leaf) :=
  Ops.diff (d.paths ++ e.paths).eraseDups (d.lists ++ e.lists).eraseDups d.meaning e.meaning

/-- O1 for records: a write's diff, applied to the record before it, gives the record after it. -/
theorem Doc.apply_diff (d e : Doc) : apply d.meaning (d.diff e) = e.meaning := by
  have ⟨hp, hf⟩ := Doc.reaches d e
  exact Ops.apply_diff ⟨fun p h => List.mem_eraseDups.2 (hp p h), fun f h => List.mem_eraseDups.2 (hf f h)⟩

/-! ## Ops -/

/-- What an app asks of a record. A row is named by its id: an app's view holds one row of each id. -/
inductive Op where
  /-- The whole record. -/
  | put       (d : Doc)
  | set       (f : String) (x : Item)
  | unset     (f : String)
  /-- The row with `r`'s id, all its fields. -/
  | setRow    (f : String) (r : Row)
  | setCell   (f : String) (id : Int) (g : String) (v : Leaf)
  | unsetCell (f : String) (id : Int) (g : String)
  /-- A new row, at place `pos` or last. -/
  | insert    (f : String) (r : Row) (pos : Option Nat)
  | remove    (f : String) (id : Int)
  /-- The row to place `to` of the list without it. -/
  | move      (f : String) (id : Int) (to : Nat)
  /-- A value into a list of values, at place `pos` or last. -/
  | add       (f : String) (v : Val) (pos : Option Nat)
  /-- Every copy of a value out of a list of values. -/
  | drop      (f : String) (v : Val)
  deriving Repr

def Op.loc : Op → Loc
  | .put _              => .root
  | .set f _            => .field f
  | .unset f            => .field f
  | .setRow f r         => .row f r.id
  | .setCell f i g _    => .cell f i g
  | .unsetCell f i g    => .cell f i g
  | .insert f r _       => .row f r.id
  | .remove f i         => .row f i
  | .move f i _         => .row f i
  | .add f _ _          => .field f
  | .drop f _           => .field f

/-- `xs` with `k` holding `v`: in its place if it has one, else last. -/
def assign {α : Type} (xs : List (String × α)) (k : String) (v : α) : List (String × α) :=
  if xs.any (·.1 == k) then xs.map fun (k', v') => (k', if k' == k then v else v') else xs ++ [(k, v)]

def unassign {α : Type} (xs : List (String × α)) (k : String) : List (String × α) := xs.filter (·.1 != k)

/-- The first row with id `i`, changed by `g`. -/
def editRow (rs : List Row) (i : Int) (g : Row → Row) : List Row :=
  match rs with
  | [] => []
  | r :: rs => if r.id == i then g r :: rs else r :: editRow rs i g

/-- Without the first row with id `i`. -/
def dropRow (rs : List Row) (i : Int) : List Row := rs.eraseP (·.id == i)

def Doc.rowsAt (d : Doc) (f : String) : Option (List Row) :=
  match d.lookup f with
  | some (.rows rs) => some rs
  | _ => none

/-- The record after `op`, or none where the op makes no sense of it: a row or a field that isn't there, a second row
    with one id, a place past the end of a list, a row's id changed. -/
def Doc.run (d : Doc) : Op → Option Doc
  | .put e => some e
  | .set f x => some (assign d f x)
  | .unset f => some (unassign d f)
  | .setRow f r => do
    let rs ← d.rowsAt f
    guard (rs.any (·.id == r.id))
    some (assign d f (.rows (editRow rs r.id fun _ => r)))
  | .setCell f i g v => do
    let rs ← d.rowsAt f
    guard (g != "id" && rs.any (·.id == i))
    some (assign d f (.rows (editRow rs i fun r => { r with fields := assign r.fields g v })))
  | .unsetCell f i g => do
    let rs ← d.rowsAt f
    guard (g != "id" && rs.any (·.id == i))
    some (assign d f (.rows (editRow rs i fun r => { r with fields := unassign r.fields g })))
  | .insert f r pos =>
    match d.lookup f with
    | none => if pos.getD 0 == 0 then some (assign d f (.rows [r])) else none
    | some (.rows rs) =>
      let n := pos.getD rs.length
      if rs.any (·.id == r.id) || n > rs.length then none else some (assign d f (.rows (rs.insertIdx n r)))
    | some (.leaf _) => none
  | .remove f i => do
    let rs ← d.rowsAt f
    guard (rs.any (·.id == i))
    some (assign d f (.rows (dropRow rs i)))
  | .move f i to => do
    let rs ← d.rowsAt f
    let r ← rs.find? (·.id == i)
    let rest := dropRow rs i
    guard (to ≤ rest.length)
    some (assign d f (.rows (rest.insertIdx to r)))
  | .add f v pos =>
    let vs := match d.lookup f with
      | none | some (.rows []) => some []
      | some (.leaf (.many vs)) => some vs
      | _ => none
    match vs with
    | some vs =>
      let n := pos.getD vs.length
      if n > vs.length then none else some (assign d f (Item.list (vs.insertIdx n v)))
    | none => none
  | .drop f v =>
    match d.lookup f with
    | none | some (.rows []) => some d
    | some (.leaf (.many vs)) => some (assign d f (Item.list (vs.filter (· != v))))
    | _ => none

/-- Ops one after the other: none if one makes no sense. -/
def Doc.runAll (d : Doc) (ops : List Op) : Option Doc := ops.foldlM Doc.run d

/-- `Within`, on the places of two records: decidable, so the vectors check it of every op they run. -/
def Doc.within (ls : List Loc) (d e : Doc) : Bool :=
  (d.paths ++ e.paths).all (fun p => d.meaning.leaf p == e.meaning.leaf p || ls.any (·.covers (.leaf p))) &&
  (d.lists ++ e.lists).all (fun f => d.meaning.rows f == e.meaning.rows f || ls.any (·.covers (.list f)))

theorem Doc.within_spec {ls : List Loc} {d e : Doc} (h : d.within ls e = true) :
    Within ls d.meaning e.meaning := by
  have ⟨hp, hf⟩ := Doc.reaches d e
  simp only [Doc.within, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, beq_iff_eq, List.any_eq_true] at h
  constructor
  · intro p hne
    rcases h.1 p (hp p hne) with e' | e'
    · exact absurd e' hne
    · exact e'
  · intro f hne
    rcases h.2 f (hf f hne) with e' | e'
    · exact absurd e' hne
    · exact e'

/-! ## Queries -/

/-- An order on values: of two numbers, or two texts; any other two aren't ordered. -/
def Val.lt : Val → Val → Bool
  | .int a, .int b => decide (a < b)
  | .str a, .str b => decide (a < b)
  | _, _ => false

/-- `t` occurs in `s`. -/
def occursIn (t : List Char) : List Char → Bool
  | [] => t.isEmpty
  | s@(_ :: rest) => t.isPrefixOf s || occursIn t rest

/-- A test of the value at a place, `none` where it has none. -/
inductive Test where
  | eq       (v : Leaf)
  | ne       (v : Leaf)
  | lt       (v : Val)
  | le       (v : Val)
  | gt       (v : Val)
  | ge       (v : Val)
  /-- One of these values. -/
  | oneOf    (vs : List Val)
  /-- A list of values that holds this one. -/
  | has      (v : Val)
  /-- A text holding this one, ASCII letters in either case. -/
  | contains (s : String)
  /-- There is a value (true) or none (false). -/
  | present  (b : Bool)
  deriving DecidableEq, Repr

def Test.test : Test → Option Leaf → Bool
  | .eq v, x => x == some v
  | .ne v, x => x != some v
  | .lt v, some (.one x) => x.lt v
  | .le v, some (.one x) => x == v || x.lt v
  | .gt v, some (.one x) => v.lt x
  | .ge v, some (.one x) => x == v || v.lt x
  | .oneOf vs, some (.one x) => vs.contains x
  | .has v, some (.many xs) => xs.contains v
  | .contains s, some (.one (.str x)) => occursIn s.toLower.toList x.toLower.toList
  | .present b, x => x.isSome == b
  | _, _ => false

/-- What a test reads: a place, or a field of any row of a list (it holds if it holds of one). -/
inductive Target where
  | at   (p : Path)
  | each (f : String) (g : String)
  deriving DecidableEq, Repr

/-- The value a test sees at a field, as in JSON: an empty list of records is an empty list; a list of records is no
    value a test compares, though it is there. -/
def Record.seen (r : Record Leaf) (f : String) : Option Leaf :=
  match r.leaf (.top f), r.rows f with
  | some v, _ => some v
  | none, some [] => some (.many [])
  | _, _ => none

def Target.holds (r : Record Leaf) (t : Test) : Target → Bool
  | .at (.top f) => match t with
    | .present x => ((r.leaf (.top f)).isSome || (r.rows f).isSome) == x
    | t => t.test (r.seen f)
  | .at p => t.test (r.leaf p)
  | .each f g => ((r.rows f).getD []).any fun k => t.test (r.leaf (.row f k g))

/-- A query's `where`: labels, as a cap's selector tests them, and tests of the record's values. -/
inductive Where where
  | yes
  | no
  | label (a : Atom)
  | test  (x : Target) (t : Test)
  | and   (u w : Where)
  | or    (u w : Where)
  | not   (w : Where)
  deriving Repr

def Where.holds (a : Attrs) (r : Record Leaf) : Where → Bool
  | .yes => true
  | .no => false
  | .label x => x.test a
  | .test x t => x.holds r t
  | .and u w => u.holds a r && w.holds a r
  | .or u w => u.holds a r || w.holds a r
  | .not w => !w.holds a r

/-- Entries both selectors pick. -/
def _root_.AvenDB.Selector.both : Selector → Selector → Selector
  | .all, s => s
  | .anyOf ds, .all => .anyOf ds
  | .anyOf ds, .anyOf es => .anyOf (ds.flatMap fun d => es.map fun e => d ++ e)

/-- Entries either selector picks. -/
def _root_.AvenDB.Selector.either : Selector → Selector → Selector
  | .anyOf ds, .anyOf es => .anyOf (ds ++ es)
  | _, _ => .all

/-- The selector of a `where`'s labels: values and negations are left to the tests, so it picks no less. -/
def Where.cover : Where → Selector
  | .yes => .all
  | .no => .anyOf []
  | .label x => .anyOf [[x]]
  | .test _ _ => .all
  | .and u w => u.cover.both w.cover
  | .or u w => u.cover.either w.cover
  | .not _ => .all

theorem any_and_any {α β : Type} (xs : List α) (ys : List β) (P : α → Bool) (Q : β → Bool) :
    (xs.any fun x => ys.any fun y => P x && Q y) = (xs.any P && ys.any Q) := by
  apply Bool.eq_iff_iff.2
  simp only [List.any_eq_true, Bool.and_eq_true]
  constructor
  · rintro ⟨x, hx, y, hy, px, qy⟩
    exact ⟨⟨x, hx, px⟩, ⟨y, hy, qy⟩⟩
  · rintro ⟨⟨x, hx, px⟩, ⟨y, hy, qy⟩⟩
    exact ⟨x, hx, y, hy, px, qy⟩

theorem both_matches (s t : Selector) (a : Attrs) : (s.both t).matches a = (s.matches a && t.matches a) := by
  cases s with
  | all => simp [Selector.both, Selector.matches]
  | anyOf ds =>
    cases t with
    | all => simp [Selector.both, Selector.matches]
    | anyOf es =>
      simp only [Selector.both, Selector.matches, List.any_flatMap, List.any_map, Function.comp_def,
        List.all_append]
      exact any_and_any ds es _ _

theorem either_matches (s t : Selector) (a : Attrs) : (s.either t).matches a = (s.matches a || t.matches a) := by
  cases s <;> cases t <;> simp [Selector.either, Selector.matches, List.any_append]

/-- A `where`'s labels pick every entry it holds of. -/
theorem cover_sound (w : Where) (a : Attrs) (r : Record Leaf) (h : w.holds a r = true) :
    w.cover.matches a = true := by
  induction w with
  | yes => rfl
  | no => simp [Where.holds] at h
  | label x => simpa [Where.cover, Selector.matches, Where.holds] using h
  | test x t => rfl
  | and u w hu hw =>
    simp only [Where.holds, Bool.and_eq_true] at h
    simp [Where.cover, both_matches, hu h.1, hw h.2]
  | or u w hu hw =>
    simp only [Where.holds, Bool.or_eq_true] at h
    rcases h with h | h
    · simp [Where.cover, either_matches, hu h]
    · simp [Where.cover, either_matches, hw h]
  | not w _ => rfl

/-- The most conjunctions a selector has, the most tests in one, and the most ids or names a test lists. -/
def maxConjunctions : Nat := 8
def maxTests : Nat := 16
def maxIds : Nat := 1000

def _root_.AvenDB.Atom.bounded : Atom → Bool
  | .typeIn xs | .authorIn xs | .entryIn xs | .tagNone xs | .tagsWithin xs => decide (xs.length ≤ maxIds)
  | .createdIn _ _ | .tagHas _ => true

/-- Within the bounds a peer accepts of a cap's selector (`slice::Selector::bounded`). -/
def _root_.AvenDB.Selector.bounded : Selector → Bool
  | .all => true
  | .anyOf ds => decide (ds.length ≤ maxConjunctions) && ds.all fun d => decide (d.length ≤ maxTests) && d.all Atom.bounded

/-- How a device runs a query: picking by this selector, a cap's, then testing what it opens. A `where` whose labels
    make a selector beyond the bounds picks by none. -/
def Where.plan (w : Where) : Selector := if w.cover.bounded then w.cover else .all

theorem plan_sound (w : Where) (a : Attrs) (r : Record Leaf) (h : w.holds a r = true) : w.plan.matches a = true := by
  unfold Where.plan
  split
  · exact cover_sound w a r h
  · rfl

/-- A query: the entries a device opened (their labels and records) that its `where` holds of. -/
def query (es : List (Attrs × Record Leaf)) (w : Where) : List (Attrs × Record Leaf) :=
  es.filter fun e => w.holds e.1 e.2

/-- O3: picking by the plan's selector first, then testing, gives the query's rows; and they are entries the device
    opened. -/
theorem plan_run (es : List (Attrs × Record Leaf)) (w : Where) :
    es.filter (fun e => w.plan.matches e.1 && w.holds e.1 e.2) = query es w ∧ (query es w).Sublist es := by
  refine ⟨?_, List.filter_sublist⟩
  apply List.filter_congr
  intro e _
  by_cases h : w.holds e.1 e.2 = true
  · simp [h, plan_sound w e.1 e.2 h]
  · simp [h]

end AvenDB.Ops
