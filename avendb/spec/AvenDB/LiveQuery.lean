/-! Live queries (sync v2, P2): a mounted query is kept current from what changed, never by re-running every view.

The device keeps, beside its stored view, an index of its entries by an immutable key (the vault and the type its
creation gave them), in creation order, updated as each entry arrives. A query that selects entries by key reads the
index instead of walking every entry (`index_insert`, `indexed_eq_scan`).

Each change names the entries it touched (`Change.touched`): those it added and those whose row it changed. A change
that touched no entry a query selects leaves its answer as it was (`untouched_query_unchanged`), so the page re-runs
only the views a change touched. Rows of entries a change did not touch stay as they were in every answer
(`untouched_rows_stay`), so a later `subscribe` can push the touched rows alone and the page applies them as a diff.

A change of standing (a share, a key, a cap group) may change what any row shows; it touches every query (`all`). -/
namespace AvenDB.LiveQuery

/-- What a query selects: entries by key, or by id. -/
structure Interest where
  keys : List Nat
  ids : List Nat

def Interest.selects (q : Interest) (keyOf : Nat → Nat) (e : Nat) : Bool :=
  q.keys.contains (keyOf e) || q.ids.contains e

/-- The answer: each selected entry, in creation order, with its row where it shows one. -/
def result (q : Interest) (keyOf : Nat → Nat) (rowOf : Nat → Option Nat) (entries : List Nat) : List (Nat × Nat) :=
  (entries.filter (q.selects keyOf)).filterMap fun e => (rowOf e).map (e, ·)

/-- A change: new entries appended in creation order, rows replaced, and the entries it says it touched. -/
structure Change where
  added : List Nat
  rowOf : Nat → Option Nat
  touched : List Nat
  all : Bool

/-- What a change must say of itself: every entry it added, and every entry whose row it changed, is touched. -/
def Change.honest (c : Change) (before : Nat → Option Nat) : Prop :=
  (∀ e ∈ c.added, e ∈ c.touched) ∧ (∀ e, c.rowOf e ≠ before e → e ∈ c.touched)

def touches (q : Interest) (keyOf : Nat → Nat) (c : Change) : Bool :=
  c.all || c.touched.any (q.selects keyOf)

theorem filterMap_congr {f g : Nat → Option (Nat × Nat)} :
    ∀ (l : List Nat), (∀ x ∈ l, f x = g x) → l.filterMap f = l.filterMap g
  | [], _ => rfl
  | x :: xs, h => by
    simp only [List.filterMap_cons, h x (by simp), filterMap_congr xs (fun y hy => h y (by simp [hy]))]

theorem untouched_query_unchanged (q : Interest) (keyOf : Nat → Nat) (before : Nat → Option Nat)
    (entries : List Nat) (c : Change) (honest : c.honest before) (quiet : touches q keyOf c = false) :
    result q keyOf c.rowOf (entries ++ c.added) = result q keyOf before entries := by
  obtain ⟨hadd, hrow⟩ := honest
  simp only [touches, Bool.or_eq_false_iff, List.any_eq_false] at quiet
  obtain ⟨_, none⟩ := quiet
  unfold result
  rw [List.filter_append]
  have hnew : c.added.filter (q.selects keyOf) = [] := by
    rw [List.filter_eq_nil_iff]
    intro e he
    simpa using none e (hadd e he)
  rw [hnew, List.append_nil]
  apply filterMap_congr
  intro e he
  have hs : q.selects keyOf e = true := (List.mem_filter.1 he).2
  by_cases hc : c.rowOf e = before e
  · rw [hc]
  · exact absurd hs (by simpa using none e (hrow e hc))

theorem untouched_rows_stay (q : Interest) (keyOf : Nat → Nat) (before : Nat → Option Nat)
    (entries : List Nat) (c : Change) (honest : c.honest before) (e v : Nat) (he : e ∉ c.touched) :
    (e, v) ∈ result q keyOf c.rowOf (entries ++ c.added) ↔ (e, v) ∈ result q keyOf before entries := by
  obtain ⟨hadd, hrow⟩ := honest
  have same : c.rowOf e = before e := by
    by_cases h : c.rowOf e = before e
    · exact h
    · exact absurd (hrow e h) he
  have notNew : e ∉ c.added := fun h => he (hadd e h)
  simp only [result, List.mem_filterMap, List.mem_filter, List.mem_append, Option.map_eq_some_iff,
    Prod.mk.injEq]
  constructor
  · rintro ⟨x, ⟨hx | hx, hs⟩, y, hy, rfl, rfl⟩
    · exact ⟨x, ⟨hx, hs⟩, y, same ▸ hy, rfl, rfl⟩
    · exact absurd hx notNew
  · rintro ⟨x, ⟨hx, hs⟩, y, hy, rfl, rfl⟩
    exact ⟨x, ⟨Or.inl hx, hs⟩, y, same.symm ▸ hy, rfl, rfl⟩

/-! ## The index

`index key` lists the entries of that key in creation order. Kept by appending each new entry to its key's list, it
is always the full scan's filter, so a query by keys reads the same candidates from it. -/

def insert (keyOf : Nat → Nat) (idx : Nat → List Nat) (e : Nat) : Nat → List Nat :=
  fun k => if keyOf e = k then idx k ++ [e] else idx k

theorem index_insert (keyOf : Nat → Nat) (entries : List Nat) (idx : Nat → List Nat)
    (h : ∀ k, idx k = entries.filter (keyOf · = k)) (e k : Nat) :
    insert keyOf idx e k = (entries ++ [e]).filter (keyOf · = k) := by
  unfold insert
  rw [List.filter_append, ← h k]
  by_cases hk : keyOf e = k <;> simp [hk]

theorem index_foldl (keyOf : Nat → Nat) (added entries : List Nat) (idx : Nat → List Nat)
    (h : ∀ k, idx k = entries.filter (keyOf · = k)) (k : Nat) :
    (added.foldl (insert keyOf) idx) k = (entries ++ added).filter (keyOf · = k) := by
  induction added generalizing entries idx with
  | nil => simp [h k]
  | cons e es ih =>
    simp only [List.foldl_cons]
    have step : ∀ k, insert keyOf idx e k = (entries ++ [e]).filter (keyOf · = k) :=
      index_insert keyOf entries idx h e
    rw [ih (entries ++ [e]) (insert keyOf idx e) step, List.append_assoc, List.singleton_append]

/-- The index built entry by entry from nothing is the full scan's filter. -/
theorem indexed_eq_scan (keyOf : Nat → Nat) (entries : List Nat) (k : Nat) :
    (entries.foldl (insert keyOf) (fun _ => [])) k = entries.filter (keyOf · = k) := by
  have := index_foldl keyOf entries [] (fun _ => []) (by simp) k
  simpa using this

end AvenDB.LiveQuery
