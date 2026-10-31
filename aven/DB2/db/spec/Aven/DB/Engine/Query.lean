import Aven.Core

/-!
# The engine's queries: scope, operators, bounds (db/engine, "Queries"; ARCHITECTURE.md, A8)

A query reads tables of Records by type and nothing else. Every query names a **target** in `Aven.Core`'s one grammar,
the same that caps and wants use (A8, decided 30 Oct 2026). A query without one is refused before anything runs. The
target is resolved over a directory: the genesis facts of the Docs it lists (`Aven.Core.Facts`). The answer is
`complete` exactly when every Doc the target resolves to is held, and `short` otherwise, naming the Docs still missing.
Rows come only from the Records of held Docs inside the target.

Each operator has a **bound** on the rows it can yield and a **cost** on the rows it can touch, both computed from
counts a device knows before it runs: any upper bound per type will do, such as a directory's counts. What a query
yields never exceeds its bound, and the work it does never exceeds its cost, operator by operator.

Values are `Aven.Core.Value`s in the examples. The evaluator needs only an equality and an order on them (`Vals`);
the engine compares Values by their one encoding, which is Value equality on canonical Values (`Aven.Core.encode_inj`).
Columns are field names, as UTF-8 bytes. -/

namespace Aven.DB.Engine

open Aven.Core

/-- A row as queries see it: columns by name. A Record's fields, or joined Records' fields side by side. -/
abbrev Tuple (Val : Type) := List (Bytes × Val)

/-- A Record as the engine reads it from a Doc: where it lives, its type (a type Doc), its fields. -/
structure Rec (Val : Type) where
  doc : DocId
  type : DocId
  fields : Tuple Val

/-- What the evaluator needs of values: equality, an order, and a way to write a count. -/
structure Vals (Val : Type) where
  eq : Val → Val → Bool
  lt : Val → Val → Bool
  count : Nat → Val

inductive Cmp where
  | eq | ne | lt | le
  deriving DecidableEq, Repr

inductive Query (Val : Type) where
  /-- every Record of a type, in the query's scope -/
  | scan (type : DocId)
  /-- the rows whose column compares to a value -/
  | filter (col : Bytes) (cmp : Cmp) (v : Val) (q : Query Val)
  /-- only these columns, in this order; where a joined row has a column twice, the left one -/
  | project (cols : List Bytes) (q : Query Val)
  /-- rows of both sides whose columns are equal, side by side -/
  | join (l r : Query Val) (lcol rcol : Bytes)
  /-- the same, keeping a left row without a match on its own -/
  | leftJoin (l r : Query Val) (lcol rcol : Bytes)
  /-- the left rows without a match: "open tasks" are tasks with no `done` -/
  | anti (l r : Query Val) (lcol rcol : Bytes)
  /-- sorted by a column -/
  | order (col : Bytes) (q : Query Val)
  /-- one row per value of a column, with its count -/
  | group (col : Bytes) (q : Query Val)
  /-- at most `n` rows -/
  | limit (n : Nat) (q : Query Val)

/-- A query as stored and run: its target, and its body. -/
structure Spec (Val : Type) where
  target : Option Target
  body : Query Val

variable {Val : Type}

def get (t : Tuple Val) (col : Bytes) : Option Val := t.lookup col

def Cmp.holds (V : Vals Val) : Cmp → Val → Val → Bool
  | .eq, a, b => V.eq a b
  | .ne, a, b => !V.eq a b
  | .lt, a, b => V.lt a b
  | .le, a, b => V.eq a b || V.lt a b

/-- Two rows match when both columns are there and equal. A missing column matches nothing. -/
def pairs (V : Vals Val) (lcol rcol : Bytes) (a b : Tuple Val) : Bool :=
  match get a lcol, get b rcol with
  | some x, some y => V.eq x y
  | _, _ => false

/-- Each value once. -/
def dedup (V : Vals Val) : List Val → List Val
  | [] => []
  | a :: l => if (dedup V l).any (V.eq a) then dedup V l else a :: dedup V l

/-- Rows sorted by a column; rows without it go first. -/
def sortBy (V : Vals Val) (col : Bytes) (rs : List (Tuple Val)) : List (Tuple Val) :=
  rs.mergeSort fun a b =>
    match get a col, get b col with
    | none, _ => true
    | some _, none => false
    | some x, some y => !V.lt y x

def countRows (V : Vals Val) (col : Bytes) (rs : List (Tuple Val)) (k : Val) : Nat :=
  (rs.filter fun t => match get t col with | some x => V.eq x k | none => false).length

/-- The rows a query yields, given the rows of each type in its scope. -/
def eval (V : Vals Val) (src : DocId → List (Tuple Val)) : Query Val → List (Tuple Val)
  | .scan ty => src ty
  | .filter col cmp v q => (eval V src q).filter fun t =>
      match get t col with
      | some x => cmp.holds V x v
      | none => false
  | .project cols q => (eval V src q).map fun t => cols.filterMap fun c => (get t c).map (c, ·)
  | .join l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).flatMap fun a => (rs.filter (pairs V lcol rcol a)).map (a ++ ·)
  | .leftJoin l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).flatMap fun a =>
        match rs.filter (pairs V lcol rcol a) with
        | [] => [a]
        | ms => ms.map (a ++ ·)
  | .anti l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).filter fun a => (rs.filter (pairs V lcol rcol a)).isEmpty
  | .order col q => sortBy V col (eval V src q)
  | .group col q =>
      let rs := eval V src q
      (dedup V (rs.filterMap (get · col))).map fun k => [(col, k), ("count".toUTF8.toList, V.count (countRows V col rs k))]
  | .limit n q => (eval V src q).take n

/-! ## Scope (A8) -/

/-- The Docs a target resolves to, among those a directory lists. -/
def resolve (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool) (dir : List Facts) (t : Target) :
    List DocId :=
  (dir.filter (t.coversB gov spawned lists)).map (·.id)

/-- How complete an answer is: every Doc of the target held, or the ones still missing. -/
inductive Completeness where
  | complete
  | short (missing : List DocId)
  deriving DecidableEq, Repr

inductive Answer (Val : Type) where
  /-- no target: refused before anything runs -/
  | refused
  | rows (status : Completeness) (rows : List (Tuple Val))

/-- The rows of a type among some Docs: Records of that type in those Docs that this device holds. -/
def inScope (db : List (Rec Val)) (docs : List DocId) (held : DocId → Bool) (ty : DocId) : List (Tuple Val) :=
  (db.filter fun r => r.type == ty && docs.contains r.doc && held r.doc).map (·.fields)

/-- The answer over some Docs: `complete` when all are held, else `short` with the missing ones. -/
def answerOver (V : Vals Val) (docs : List DocId) (held : DocId → Bool) (db : List (Rec Val)) (q : Query Val) :
    Answer Val :=
  let missing := docs.filter (! held ·)
  .rows (if missing = [] then .complete else .short missing) (eval V (inScope db docs held) q)

/-- Run a stored query over the Docs its target resolves to in a directory. -/
def run (V : Vals Val) (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool) (dir : List Facts)
    (held : DocId → Bool) (db : List (Rec Val)) (s : Spec Val) : Answer Val :=
  match s.target with
  | none => .refused
  | some t => answerOver V (resolve gov spawned lists dir t) held db s.body

theorem run_refused_without_target (V : Vals Val) (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool)
    (dir : List Facts) (held : DocId → Bool) (db : List (Rec Val)) (q : Query Val) :
    run V gov spawned lists dir held db ⟨none, q⟩ = .refused := rfl

/-- An answer over some Docs is `complete` exactly when every one of them is held. -/
theorem answerOver_complete_iff (V : Vals Val) (docs : List DocId) (held : DocId → Bool) (db : List (Rec Val))
    (q : Query Val) :
    (∃ rs, answerOver V docs held db q = .rows .complete rs) ↔ ∀ d ∈ docs, held d = true := by
  simp only [answerOver]
  constructor
  · rintro ⟨rs, h⟩ d hd
    split at h
    · rename_i hm
      have : d ∉ docs.filter (! held ·) := by rw [hm]; simp
      simpa [List.mem_filter, hd] using this
    · cases h
  · intro h
    refine ⟨eval V (inScope db docs held) q, ?_⟩
    have : docs.filter (! held ·) = [] := by
      rw [List.filter_eq_nil_iff]
      intro d hd
      simp [h d hd]
    simp [this]

/-- **`complete` means exactly that every Doc the target resolves to is held** (A8). -/
theorem complete_iff (V : Vals Val) (gov : Bytes → Bytes → Bool) (spawned lists : DocId → DocId → Bool)
    (dir : List Facts) (held : DocId → Bool) (db : List (Rec Val)) (t : Target) (q : Query Val) :
    (∃ rs, run V gov spawned lists dir held db ⟨some t, q⟩ = .rows .complete rs) ↔
      ∀ f ∈ dir, t.covers (gov · · = true) (spawned · · = true) (lists · · = true) f → held f.id = true := by
  simp only [run]
  rw [answerOver_complete_iff]
  simp only [resolve, List.mem_map, List.mem_filter]
  constructor
  · intro h f hf hc
    exact h f.id ⟨f, ⟨hf, Target.coversB_iff.mpr hc⟩, rfl⟩
  · rintro h d ⟨f, ⟨hf, hc⟩, rfl⟩
    exact h f hf (Target.coversB_iff.mp hc)

/-- A Record outside the scope, or in a Doc not held, changes no answer: rows come from the scope alone. -/
theorem scoped_only (db : List (Rec Val)) (docs : List DocId) (held : DocId → Bool) (ty : DocId) :
    inScope db docs held ty = inScope (db.filter fun r => docs.contains r.doc && held r.doc) docs held ty := by
  simp only [inScope, List.filter_filter]
  congr 1
  apply List.filter_congr
  intro r _
  cases r.type == ty <;> cases docs.contains r.doc <;> cases held r.doc <;> rfl

/-! ## Bounds and costs, per operator -/

/-- The most rows a query can yield, from the most rows each type can have. -/
def bound (n : DocId → Nat) : Query Val → Nat
  | .scan ty => n ty
  | .filter _ _ _ q | .project _ q | .order _ q | .group _ q => bound n q
  | .limit k q => min k (bound n q)
  | .join l r _ _ => bound n l * bound n r
  | .leftJoin l r _ _ => bound n l * max 1 (bound n r)
  | .anti l _ _ _ => bound n l

/-- The work a query does as it runs: rows read, pairs compared, comparisons while sorting (counted as n²). -/
def work (V : Vals Val) (src : DocId → List (Tuple Val)) : Query Val → Nat
  | .scan ty => (src ty).length
  | .filter _ _ _ q | .project _ q | .group _ q => work V src q + (eval V src q).length
  | .order _ q => work V src q + (eval V src q).length * (eval V src q).length
  | .limit _ q => work V src q
  | .join l r _ _ | .leftJoin l r _ _ | .anti l r _ _ =>
      work V src l + work V src r + (eval V src l).length * (eval V src r).length

/-- The most work a query may do, known before it runs. A query whose cost exceeds the device's limit is refused with
its cost in the answer. -/
def cost (n : DocId → Nat) : Query Val → Nat
  | .scan ty => n ty
  | .filter _ _ _ q | .project _ q | .group _ q => cost n q + bound n q
  | .order _ q => cost n q + bound n q * bound n q
  | .limit _ q => cost n q
  | .join l r _ _ | .leftJoin l r _ _ | .anti l r _ _ => cost n l + cost n r + bound n l * bound n r

theorem length_dedup_le (V : Vals Val) : ∀ l : List Val, (dedup V l).length ≤ l.length
  | [] => by simp [dedup]
  | a :: l => by
    have ih := length_dedup_le V l
    simp only [dedup]
    split <;> simp <;> omega

theorem length_filterMap_le {α β : Type} (f : α → Option β) : ∀ l : List α, (l.filterMap f).length ≤ l.length
  | [] => by simp
  | a :: l => by
    have ih := length_filterMap_le f l
    simp only [List.filterMap_cons]
    split <;> simp <;> omega

/-- A sum of `m` terms, each at most `c`, is at most `m * c`. -/
theorem sum_le_mul {α : Type} (f : α → Nat) (c : Nat) :
    ∀ l : List α, (∀ a ∈ l, f a ≤ c) → (l.map f).sum ≤ l.length * c
  | [] => by simp
  | a :: l => by
    intro h
    have ha := h a (by simp)
    have ih := sum_le_mul f c l (fun b hb => h b (by simp [hb]))
    simp [List.sum_cons, Nat.succ_mul]
    omega

/-- What a query yields never exceeds its bound, when the counts it was given hold. -/
theorem length_le_bound (V : Vals Val) (src : DocId → List (Tuple Val)) (n : DocId → Nat)
    (hn : ∀ ty, (src ty).length ≤ n ty) : ∀ q : Query Val, (eval V src q).length ≤ bound n q
  | .scan ty => hn ty
  | .filter _ _ _ q => by
    simp only [eval, bound]
    exact Nat.le_trans (List.length_filter_le _ _) (length_le_bound V src n hn q)
  | .project _ q => by
    simp only [eval, bound, List.length_map]
    exact length_le_bound V src n hn q
  | .order _ q => by
    simp only [eval, bound, sortBy, List.length_mergeSort]
    exact length_le_bound V src n hn q
  | .group _ q => by
    simp only [eval, bound, List.length_map]
    exact Nat.le_trans (length_dedup_le V _)
      (Nat.le_trans (length_filterMap_le _ _) (length_le_bound V src n hn q))
  | .limit k q => by
    simp only [eval, bound, List.length_take]
    have := length_le_bound V src n hn q
    omega
  | .join l r lcol rcol => by
    simp only [eval, bound, List.length_flatMap, List.length_map]
    have hl := length_le_bound V src n hn l
    have hr := length_le_bound V src n hn r
    refine Nat.le_trans (sum_le_mul _ (eval V src r).length _ ?_) (Nat.mul_le_mul hl hr)
    intro a _
    exact List.length_filter_le _ _
  | .leftJoin l r lcol rcol => by
    simp only [eval, bound, List.length_flatMap]
    have hl := length_le_bound V src n hn l
    have hr := length_le_bound V src n hn r
    refine Nat.le_trans (sum_le_mul _ (max 1 (eval V src r).length) _ ?_)
      (Nat.mul_le_mul hl (by omega))
    intro a _
    have hf := List.length_filter_le (pairs V lcol rcol a) (eval V src r)
    cases h : List.filter (pairs V lcol rcol a) (eval V src r) with
    | nil => simp; exact Nat.le_max_left 1 _
    | cons m ms => rw [h] at hf; simp only [List.length_map]; omega
  | .anti l _ _ _ => by
    simp only [eval, bound]
    exact Nat.le_trans (List.length_filter_le _ _) (length_le_bound V src n hn l)

/-- The work a query does never exceeds its cost, operator by operator. -/
theorem work_le_cost (V : Vals Val) (src : DocId → List (Tuple Val)) (n : DocId → Nat)
    (hn : ∀ ty, (src ty).length ≤ n ty) : ∀ q : Query Val, work V src q ≤ cost n q
  | .scan ty => hn ty
  | .filter _ _ _ q | .project _ q | .group _ q => by
    simp only [work, cost]
    exact Nat.add_le_add (work_le_cost V src n hn q) (length_le_bound V src n hn q)
  | .order _ q => by
    simp only [work, cost]
    have hb := length_le_bound V src n hn q
    exact Nat.add_le_add (work_le_cost V src n hn q) (Nat.mul_le_mul hb hb)
  | .limit _ q => by
    simp only [work, cost]
    exact work_le_cost V src n hn q
  | .join l r _ _ | .leftJoin l r _ _ | .anti l r _ _ => by
    simp only [work, cost]
    exact Nat.add_le_add (Nat.add_le_add (work_le_cost V src n hn l) (work_le_cost V src n hn r))
      (Nat.mul_le_mul (length_le_bound V src n hn l) (length_le_bound V src n hn r))

end Aven.DB.Engine
