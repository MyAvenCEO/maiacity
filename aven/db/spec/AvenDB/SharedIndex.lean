import AvenDB.ShelfIndex

/-!
# Shared indexes (B1, batch 5)

The index a device derives from what its edits say (`State`), kept on its shelf as a `ShelfIndex`, in the same save as
the edits it is of, and stamped with the head of their log. Its rows are blind (`BlindIndex`): a token of an entry's
type, of each of its tags and of each entry it links to, in the entry's audience, so a peer can keep the pages and
answer from them without reading one entry. Under each token the rows sort by the entry's creation (the depth of its
creation edit, then its id), so a view of a type, a tag or the entries that link to one lists them newest or oldest
first by a scan of one key range; beside them, the entries of each audience in the order of their creation.

Each row belongs to one entry (`owner`), and the rows of an entry are a function of the state alone (`rows`), so the
index of a state is the rows of every entry (`full`). The index is no derivation of single edits: an edit of an entry
may change rows it held before (a tag taken off, a move to another audience), so a save steps the index on by entry,
not by edit. The entries an edit touched are taken out of the index and put again as the state now says (`reentry`):
their old rows are read from the index itself, from each entry's own row that names them (`E`), never from an older
state the node no longer holds.

- X1: where the touched entries are all those whose rows differ between two states, stepping the index of the first
  over them gives the index of the second (`X1_step`).
- X2: stepping the empty index over every entry that has rows gives the index of the state: what a rebuild does
  (`X2_rebuild`).
- X3: an entry's changes as the shelf index applies them, its old rows taken out and its new rows put, are `reentry`
  where the old rows are all the index holds of the entry (`X3_changes`).
- X4: the index stepped on is a function of the state alone, so its root is the root of a rebuild, on every node that
  holds the same edits (`X4_same_root`), whatever it opened from (`ShelfIndex.I4_same_root`); a crash between the
  edits' save and the index's slot leaves the older slot, of a prefix of the log, which the node steps on again
  (`ShelfIndex.I3_crash`).
-/

namespace AvenDB.SharedIndex

open AvenDB.ShelfIndex

variable {S E K V : Type} [DecidableEq E] [DecidableEq K]

/-- What a state says of each entry's rows, each owned by its entry: a key names the entry it is a row of. -/
structure Rows (S E K V : Type) where
  rows : S → E → List (K × V)
  owner : K → E
  owned : ∀ s e kv, kv ∈ rows s e → owner kv.1 = e

/-- The value under `k` in a list of rows, the first that has it. -/
def look (k : K) : List (K × V) → Option V
  | [] => none
  | (k', v) :: rs => if k' = k then some v else look k rs

/-- The index of a state: the rows of every entry, each read under the entry its key names. -/
def full (R : Rows S E K V) (s : S) : Index K V :=
  fun k => look k (R.rows s (R.owner k))

/-- Entry `e` taken out of `ix` and put again with rows `new`. -/
def reentry (R : Rows S E K V) (ix : Index K V) (e : E) (new : List (K × V)) : Index K V :=
  fun k => if R.owner k = e then look k new else ix k

/-- The index stepped on over the entries `touched`, each put again as state `s` says. -/
def step (R : Rows S E K V) (s : S) (ix : Index K V) (touched : List E) : Index K V :=
  touched.foldl (fun ix e => reentry R ix e (R.rows s e)) ix

theorem step_at (R : Rows S E K V) (s : S) (touched : List E) :
    ∀ (ix : Index K V) (k : K),
      step R s ix touched k = if R.owner k ∈ touched then look k (R.rows s (R.owner k)) else ix k := by
  induction touched with
  | nil => intro ix k; simp [step]
  | cons e es ih =>
    intro ix k
    have h := ih (reentry R ix e (R.rows s e)) k
    simp only [step, List.foldl_cons] at h ⊢
    rw [h]
    by_cases he : R.owner k = e
    · subst he; simp [reentry]
    · by_cases hm : R.owner k ∈ es
      · simp [hm]
      · simp [hm, he, reentry]

/-- X1: stepping the index of `s` over every entry whose rows differ in `s'` gives the index of `s'`. -/
theorem X1_step (R : Rows S E K V) (s s' : S) (touched : List E)
    (hcover : ∀ e, e ∉ touched → R.rows s e = R.rows s' e) :
    step R s' (full R s) touched = full R s' := by
  funext k
  rw [step_at]
  split
  · rfl
  · rename_i h
    simp only [full]
    rw [hcover _ h]

/-- X2: a rebuild, the empty index stepped on over every entry with rows, is the index of the state. -/
theorem X2_rebuild (R : Rows S E K V) (s : S) (every : List E)
    (hevery : ∀ e, R.rows s e ≠ [] → e ∈ every) :
    step R s empty every = full R s := by
  funext k
  rw [step_at]
  split
  · rfl
  · rename_i h
    simp only [full, empty]
    have : R.rows s (R.owner k) = [] :=
      Classical.byContradiction fun hne => h (hevery _ hne)
    rw [this]; rfl

theorem look_none_of_not_mem (k : K) : ∀ rs : List (K × V), (∀ kv ∈ rs, kv.1 ≠ k) → look k rs = none
  | [] => fun _ => rfl
  | (k', v) :: rs => fun h => by
    have hk : k' ≠ k := h (k', v) (by simp)
    simp only [look, hk, ite_false]
    exact look_none_of_not_mem k rs (fun kv hm => h kv (by simp [hm]))

theorem fold_put (ix : Index K V) (new : List (K × V)) (k : K) :
    (new.map (fun kv => (kv.1, some kv.2))).foldl setRow ix k =
      match (new.reverse.find? (·.1 = k)) with
      | some kv => some kv.2
      | none => ix k := by
  induction new generalizing ix with
  | nil => simp
  | cons kv rs ih =>
    simp only [List.map_cons, List.foldl_cons, List.reverse_cons]
    rw [ih]
    rw [List.find?_append]
    cases hf : rs.reverse.find? (·.1 = k) with
    | some x => simp
    | none =>
      simp only [Option.none_or]
      by_cases hk : kv.1 = k
      · simp [hk, setRow]
      · simp [setRow, hk, Ne.symm hk]

theorem fold_del (ix : Index K V) (old : List K) (k : K) :
    (old.map (fun k => (k, (none : Option V)))).foldl setRow ix k = if k ∈ old then none else ix k := by
  induction old generalizing ix with
  | nil => simp
  | cons o os ih =>
    simp only [List.map_cons, List.foldl_cons]
    rw [ih]
    by_cases hm : k ∈ os
    · simp [hm]
    · by_cases ho : k = o
      · subst ho; simp [setRow]
      · simp [hm, ho, setRow]

/-- A list of rows with no key twice reads the same first or last. -/
theorem look_eq_find_rev (k : K) (rs : List (K × V)) (hnd : (rs.map Prod.fst).Nodup) :
    look k rs = (rs.reverse.find? (·.1 = k)).map Prod.snd := by
  induction rs with
  | nil => rfl
  | cons kv rs ih =>
    obtain ⟨k', v⟩ := kv
    simp only [List.map_cons, List.nodup_cons, List.mem_map] at hnd
    obtain ⟨hnot, hnd⟩ := hnd
    simp only [look, List.reverse_cons, List.find?_append]
    by_cases hk : k' = k
    · subst hk
      have : rs.reverse.find? (·.1 = k') = none := by
        rw [List.find?_eq_none]
        intro x hx heq
        exact hnot ⟨x, List.mem_reverse.mp hx, by simpa using heq⟩
      simp [this]
    · simp only [hk, ite_false]
      rw [ih hnd]
      cases rs.reverse.find? (·.1 = k) <;> simp [hk]

/-- X3: entry `e`'s changes as the shelf index applies them, every key the index holds of it taken out (`old`) and
    then its new rows put, are `reentry`. -/
theorem X3_changes (R : Rows S E K V) (ix : Index K V) (e : E) (old : List K) (new : List (K × V))
    (hold : ∀ k, R.owner k = e → ix k ≠ none → k ∈ old) (hold' : ∀ k ∈ old, R.owner k = e)
    (hnew : ∀ kv ∈ new, R.owner kv.1 = e) (hnd : (new.map Prod.fst).Nodup) :
    (old.map (fun k => (k, (none : Option V))) ++ new.map (fun kv => (kv.1, some kv.2))).foldl setRow ix =
      reentry R ix e new := by
  funext k
  rw [List.foldl_append, fold_put, fold_del]
  simp only [reentry]
  rw [look_eq_find_rev k new hnd]
  cases hf : new.reverse.find? (·.1 = k) with
  | some kv =>
    have hm := List.mem_reverse.mp (List.mem_of_find?_eq_some hf)
    have hk : kv.1 = k := by simpa using List.find?_some hf
    have : R.owner k = e := hk ▸ hnew kv hm
    simp [this]
  | none =>
    simp only [Option.map_none]
    by_cases ho : R.owner k = e
    · simp only [ho, ite_true]
      by_cases hm : k ∈ old
      · simp [hm]
      · simp only [hm, ite_false]
        exact Classical.byContradiction fun hne => hm (hold k ho hne)
    · have : k ∉ old := fun hm => ho (hold' k hm)
      simp [this, ho]

/-- X4: the index a node steps on is the index of its state, so its root is a rebuild's, on every node that holds
    the same edits. -/
theorem X4_same_root {R' : Type} (R : Rows S E K V) (build : Index K V → R') (s s' : S) (touched every : List E)
    (hcover : ∀ e, e ∉ touched → R.rows s e = R.rows s' e) (hevery : ∀ e, R.rows s' e ≠ [] → e ∈ every) :
    root build (step R s' (full R s) touched) = root build (step R s' empty every) := by
  rw [X1_step R s s' touched hcover, X2_rebuild R s' every hevery]

end AvenDB.SharedIndex
