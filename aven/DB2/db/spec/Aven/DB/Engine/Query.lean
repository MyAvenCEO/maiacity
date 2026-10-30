/-!
# The engine's queries: scope, operators, bounds (db/engine, "Queries"; ARCHITECTURE.md, A8)

A query reads tables of Records by type and nothing else. Every query names a **target**: what it ranges over, in the
grammar caps and wants share. A query without one is refused before anything runs, and its answer is `complete` only
when every Doc its target resolves to is held. Rows come only from the Records of held Docs inside the target. An answer that is not complete is `short`, naming the Docs still missing.

Each operator has a **bound** on the rows it can yield and a **cost** on the rows it can touch, both computed from the
counts a device knows before it runs (a directory's counts per type, later). The theorems: what a query yields never
exceeds its bound, and the work it does never exceeds its cost, operator by operator.

The target grammar, type ids and values are `Aven.Core`'s (the docs thread). Until it lands this model is generic over
them: `Doc`, `Ty`, `Target` and `Val` are parameters, and resolving a target is a function the caller passes in. -/

namespace Aven.DB.Engine

/-- A row as queries see it: columns by name. A Record's fields, or joined Records' fields side by side. -/
abbrev Tuple (Val : Type) := List (String × Val)

/-- A Record as the engine reads it from a Doc: where it lives, its type, its fields. -/
structure Rec (Doc Ty Val : Type) where
  doc : Doc
  ty : Ty
  fields : Tuple Val
  deriving Repr

/-- What the evaluator needs of values: an order, and a way to write a count. -/
structure Vals (Val : Type) where
  lt : Val → Val → Bool
  count : Nat → Val

inductive Cmp where
  | eq | ne | lt | le
  deriving DecidableEq, Repr

inductive Query (Ty Val : Type) where
  /-- every Record of a type, in the query's scope -/
  | scan (ty : Ty)
  /-- the rows whose column compares to a value -/
  | filter (col : String) (cmp : Cmp) (v : Val) (q : Query Ty Val)
  /-- only these columns, in this order; where a joined row has a column twice, the left one -/
  | project (cols : List String) (q : Query Ty Val)
  /-- rows of both sides whose columns are equal, side by side -/
  | join (l r : Query Ty Val) (lcol rcol : String)
  /-- the same, keeping a left row without a match on its own -/
  | leftJoin (l r : Query Ty Val) (lcol rcol : String)
  /-- the left rows without a match: "open tasks" are tasks with no `done` -/
  | anti (l r : Query Ty Val) (lcol rcol : String)
  /-- sorted by a column -/
  | order (col : String) (q : Query Ty Val)
  /-- one row per value of a column, with its count -/
  | group (col : String) (q : Query Ty Val)
  /-- at most `n` rows -/
  | limit (n : Nat) (q : Query Ty Val)
  deriving Repr

/-- A query as stored and run: its target, and its body. -/
structure Spec (Target Ty Val : Type) where
  target : Option Target
  body : Query Ty Val

variable {Doc Ty Target Val : Type} [DecidableEq Doc] [DecidableEq Ty] [DecidableEq Val]

def get (t : Tuple Val) (col : String) : Option Val := t.lookup col

def Cmp.holds (V : Vals Val) : Cmp → Val → Val → Bool
  | .eq, a, b => decide (a = b)
  | .ne, a, b => !decide (a = b)
  | .lt, a, b => V.lt a b
  | .le, a, b => decide (a = b) || V.lt a b

/-- Two rows match when both columns are there and equal. A missing column pairs nothing. -/
def pairs (lcol rcol : String) (a b : Tuple Val) : Bool :=
  match get a lcol, get b rcol with
  | some x, some y => decide (x = y)
  | _, _ => false

/-- Each value once, in first-seen order from the end. -/
def dedup : List Val → List Val
  | [] => []
  | a :: l => if a ∈ dedup l then dedup l else a :: dedup l

/-- Rows sorted by a column; rows without it go first. -/
def sortBy (V : Vals Val) (col : String) (rs : List (Tuple Val)) : List (Tuple Val) :=
  rs.mergeSort fun a b =>
    match get a col, get b col with
    | none, _ => true
    | some _, none => false
    | some x, some y => !V.lt y x

def countRows (col : String) (rs : List (Tuple Val)) (k : Val) : Nat :=
  (rs.filter fun t => get t col == some k).length

/-- The rows a query yields, given the rows of each type in its scope. -/
def eval (V : Vals Val) (src : Ty → List (Tuple Val)) : Query Ty Val → List (Tuple Val)
  | .scan ty => src ty
  | .filter col cmp v q => (eval V src q).filter fun t =>
      match get t col with
      | some x => cmp.holds V x v
      | none => false
  | .project cols q => (eval V src q).map fun t => cols.filterMap fun c => (get t c).map (c, ·)
  | .join l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).flatMap fun a => (rs.filter (pairs lcol rcol a)).map (a ++ ·)
  | .leftJoin l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).flatMap fun a =>
        match rs.filter (pairs lcol rcol a) with
        | [] => [a]
        | ms => ms.map (a ++ ·)
  | .anti l r lcol rcol =>
      let rs := eval V src r
      (eval V src l).filter fun a => (rs.filter (pairs lcol rcol a)).isEmpty
  | .order col q => sortBy V col (eval V src q)
  | .group col q =>
      let rs := eval V src q
      (dedup (rs.filterMap (get · col))).map fun k => [(col, k), ("count", V.count (countRows col rs k))]
  | .limit n q => (eval V src q).take n

/-! ## Scope (A8) -/

/-- How complete an answer is: every Doc of the target held, or the ones still missing. -/
inductive Completeness (Doc : Type) where
  | complete
  | short (missing : List Doc)
  deriving DecidableEq, Repr

inductive Answer (Doc Val : Type) where
  /-- no target: refused before anything runs -/
  | refused
  | rows (status : Completeness Doc) (rows : List (Tuple Val))
  deriving Repr

/-- The rows of a type inside a scope: Records of that type in held Docs the target resolves to. -/
def inScope (db : List (Rec Doc Ty Val)) (docs : List Doc) (held : Doc → Bool) (ty : Ty) : List (Tuple Val) :=
  (db.filter fun r => r.ty = ty ∧ r.doc ∈ docs ∧ held r.doc).map (·.fields)

/-- Run a stored query. `resolve` gives the Docs a target names (through its directory); `held` says which this device
holds. -/
def run (V : Vals Val) (resolve : Target → List Doc) (held : Doc → Bool) (db : List (Rec Doc Ty Val))
    (s : Spec Target Ty Val) : Answer Doc Val :=
  match s.target with
  | none => .refused
  | some t =>
    let docs := resolve t
    let missing := docs.filter (! held ·)
    .rows (if missing = [] then .complete else .short missing) (eval V (inScope db docs held) s.body)

theorem run_refused_without_target (V : Vals Val) (resolve : Target → List Doc) (held : Doc → Bool)
    (db : List (Rec Doc Ty Val)) (q : Query Ty Val) :
    run V resolve held db ⟨none, q⟩ = .refused := rfl

/-- `complete` means exactly: every Doc the target resolves to is held. -/
theorem complete_iff (V : Vals Val) (resolve : Target → List Doc) (held : Doc → Bool) (db : List (Rec Doc Ty Val))
    (t : Target) (q : Query Ty Val) (rs : List (Tuple Val)) :
    (run V resolve held db ⟨some t, q⟩ = .rows .complete rs) →
      ∀ d ∈ resolve t, held d = true := by
  intro h d hd
  simp only [run] at h
  split at h
  · rename_i hm
    have : d ∉ (resolve t).filter (! held ·) := by rw [hm]; simp
    simp [List.mem_filter, hd] at this
    exact this
  · cases h

omit [DecidableEq Val] in
/-- A Record outside the scope, or in a Doc not held, changes no answer: rows come from the scope alone. -/
theorem scoped_only (db : List (Rec Doc Ty Val)) (docs : List Doc) (held : Doc → Bool) (ty : Ty) :
    inScope db docs held ty = inScope (db.filter fun r => r.doc ∈ docs ∧ held r.doc) docs held ty := by
  simp only [inScope, List.filter_filter]
  congr 1
  apply List.filter_congr
  intro r _
  by_cases h1 : r.ty = ty <;> by_cases h2 : r.doc ∈ docs <;> by_cases h3 : held r.doc = true <;> simp [h1, h2, h3]

/-! ## Bounds and costs, per operator -/

/-- The most rows a query can yield, from the most rows each type can have. -/
def bound (n : Ty → Nat) : Query Ty Val → Nat
  | .scan ty => n ty
  | .filter _ _ _ q | .project _ q | .order _ q | .group _ q => bound n q
  | .limit k q => min k (bound n q)
  | .join l r _ _ => bound n l * bound n r
  | .leftJoin l r _ _ => bound n l * max 1 (bound n r)
  | .anti l _ _ _ => bound n l

/-- The work a query does as it runs: rows read, pairs compared, comparisons while sorting (counted as n²). -/
def work (V : Vals Val) (src : Ty → List (Tuple Val)) : Query Ty Val → Nat
  | .scan ty => (src ty).length
  | .filter _ _ _ q | .project _ q | .group _ q => work V src q + (eval V src q).length
  | .order _ q => work V src q + (eval V src q).length * (eval V src q).length
  | .limit _ q => work V src q
  | .join l r _ _ | .leftJoin l r _ _ | .anti l r _ _ =>
      work V src l + work V src r + (eval V src l).length * (eval V src r).length

/-- The most work a query may do, known before it runs. A query whose cost exceeds the device's limit is refused with
its cost in the answer. -/
def cost (n : Ty → Nat) : Query Ty Val → Nat
  | .scan ty => n ty
  | .filter _ _ _ q | .project _ q | .group _ q => cost n q + bound n q
  | .order _ q => cost n q + bound n q * bound n q
  | .limit _ q => cost n q
  | .join l r _ _ | .leftJoin l r _ _ | .anti l r _ _ => cost n l + cost n r + bound n l * bound n r

theorem length_dedup_le : ∀ l : List Val, (dedup l).length ≤ l.length
  | [] => by simp [dedup]
  | a :: l => by
    have ih := length_dedup_le l
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

omit [DecidableEq Ty] in
/-- What a query yields never exceeds its bound, when the counts it was given hold. -/
theorem length_le_bound (V : Vals Val) (src : Ty → List (Tuple Val)) (n : Ty → Nat)
    (hn : ∀ ty, (src ty).length ≤ n ty) : ∀ q : Query Ty Val, (eval V src q).length ≤ bound n q
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
    exact Nat.le_trans (length_dedup_le _)
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
    have hf := List.length_filter_le (pairs lcol rcol a) (eval V src r)
    cases h : List.filter (pairs lcol rcol a) (eval V src r) with
    | nil => simp; exact Nat.le_max_left 1 _
    | cons m ms => rw [h] at hf; simp only [List.length_map]; omega
  | .anti l _ _ _ => by
    simp only [eval, bound]
    exact Nat.le_trans (List.length_filter_le _ _) (length_le_bound V src n hn l)

omit [DecidableEq Ty] in
/-- The work a query does never exceeds its cost, operator by operator. -/
theorem work_le_cost (V : Vals Val) (src : Ty → List (Tuple Val)) (n : Ty → Nat)
    (hn : ∀ ty, (src ty).length ≤ n ty) : ∀ q : Query Ty Val, work V src q ≤ cost n q
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
