import AvenDB.ShelfIndex

/-!
# Query views

A query view is the stored answer of one query with its parameters (B2 of the one-query-engine plan). The view at
head `H` is the query run on the edits up to `H`, and nothing else: a device may keep it, step the next edits on it,
compact the log under it, and what it shows stays what the query on the whole log shows. Here are the rules that let
an engine keep it by the change alone (the delta rule), for the three parts a query has: a selector, a window and a
follow of at most `k` hops. The ideas are DBSP's (a view kept by its delta, for operators that are linear or close to
it); the proofs are our own and use the core library alone.

An edit sets an entry's row, or takes it away (`Edit`); the rows of a log are its edits applied in order, the last
one of each entry standing (`rows`, the index of `ShelfIndex.lean` with one row per edit).

- **Selector.** A selector is a list of label and value tests, all of which a row must pass (`Sel`). Two selectors
  meet in one that a row passes where it passes both (`meet_test`), so the selectors are closed under intersection
  (A1 moves this type into `Selector.lean`; the rules here read only `Sel.test`). What a selector picks of the rows
  of a log is itself an index of that log: each edit says the row it sets where the row passes, else none
  (`QV1_selected_derive`). So the selection is kept exactly as the shelf's indexes are: stamped with its head, caught
  up with the edits after it (`QV2_catch_up`, which reads only those edits), opened from an honest slot or built
  again (`QV3_open`); and where an entry no new edit names, the selection stays as it was (`QV4_untouched`).
- **Window.** A query shows the newest `w` entries it selects, in creation order (`lastN`). New entries come after
  every one before them, so the window after them is the window of the old window and the new entries that pass
  (`QW1_append`): it reads the old window and the new edits, never the older entries. A change within the part of the
  order the window spans takes the window again from that part and as many older entries as it no longer fills
  (`QW2_refill`); that refill reads at most `w` entries from the index, never the log (`lastN_length`).
- **Follow.** A query follows the links of the rows it shows, at most `k` hops (`reach`). What it reaches reads only
  the links of the entries it reaches, so a change that names none of them leaves it as it was (`QF1_untouched`), and
  where no row holds more than `f` links it reaches at most `r · (f + 1) ^ k` entries from `r` (`QF2_bound`).
- **Compaction.** Taking out every edit a later edit of the same entry overrides keeps the rows (`QC1_compact`), so it
  keeps every view of the log (`QC2_view`): a device may drop overridden edits under its views (it keeps them in the
  history), and its views stay the query's answer.

The vectors (`QueryViewVectors.lean`, `vectors/query_views.json`) are runs of edits with a query: what the model's
view shows at each head, and what each step touched. The Rust query views (`crates/avendb/src/query_view.rs`, B3)
must show the same at every head, whether they stepped there or replayed.
-/

namespace AvenDB.QueryView

open AvenDB.ShelfIndex

/-! ## Rows and selectors -/

/-- An entry's row, as a query reads it: its type, its tags, the entries it links to and one value. -/
structure Row where
  type  : Nat
  tags  : List Nat
  links : List Nat
  value : Nat
  deriving DecidableEq, Repr

/-- One test of a selector: a label (type, tag, link), which a blind peer can match by token, or a value test. -/
inductive Atom where
  | type (t : Nat)
  | tag (g : Nat)
  | link (e : Nat)
  | atLeast (n : Nat)
  deriving DecidableEq, Repr

def Atom.test : Atom → Row → Bool
  | .type t, r => r.type == t
  | .tag g, r => r.tags.contains g
  | .link e, r => r.links.contains e
  | .atLeast n, r => decide (n ≤ r.value)

/-- A selector: every one of its tests holds. The empty selector picks every row. -/
abbrev Sel := List Atom

def Sel.test (s : Sel) (r : Row) : Bool := s.all (·.test r)

/-- Two selectors meet in one. -/
def Sel.meet (a b : Sel) : Sel := a ++ b

/-- A row passes the meet of two selectors where it passes both: selectors are closed under intersection. -/
theorem meet_test (a b : Sel) (r : Row) : (a.meet b).test r = (a.test r && b.test r) := by
  simp [Sel.meet, Sel.test, List.all_append]

/-! ## The rows of a log -/

/-- An edit: the row it sets for an entry, or none where it takes the entry's row away. -/
abbrev Edit := Nat × Option Row

/-- The rows of a log: its edits in order, the last of each entry standing. -/
def rows (log : List Edit) : Index Nat Row := log.foldl setRow empty

/-- The rows as the shelf keeps them: an index with one row per edit. -/
def rowsDerive : Derive Edit Nat Row := ⟨fun x => [x]⟩

theorem foldl_step_eq (d : Derive Edit Nat Row) (hd : ∀ x, d.rows x = [x]) :
    ∀ (l : List Edit) (ix : Index Nat Row), l.foldl (step d) ix = l.foldl setRow ix
  | [], _ => rfl
  | x :: xs, ix => by
    simp only [List.foldl_cons, step, hd, List.foldl_cons, List.foldl_nil]
    exact foldl_step_eq d hd xs _

theorem rows_derive (log : List Edit) : rows log = derive rowsDerive log :=
  (foldl_step_eq rowsDerive (fun _ => rfl) log empty).symm

/-- Where some edit of `l` names entry `e`, the row `l` leaves there is the same from any start; where none does, it
    is the start's. -/
theorem fold_at : ∀ (l : List Edit) (ix ix' : Index Nat Row) (e : Nat),
    (l.foldl setRow ix) e = if l.any (·.1 == e) then (l.foldl setRow ix') e else ix e
  | [], _, _, _ => by simp
  | x :: xs, ix, ix', e => by
    simp only [List.foldl_cons, List.any_cons]
    rw [fold_at xs (setRow ix x) (setRow ix' x) e]
    by_cases hx : xs.any (·.1 == e) = true
    · simp [hx]
    · have hx' : xs.any (·.1 == e) = false := Bool.eq_false_iff.2 hx
      have h1 := fold_at xs (setRow ix' x) (setRow ix' x) e
      rw [hx'] at h1
      simp only [hx', Bool.or_false, Bool.false_eq_true, ↓reduceIte] at h1 ⊢
      rw [h1]
      by_cases he : x.1 = e
      · simp [setRow, he]
      · have : e ≠ x.1 := fun h => he h.symm
        simp [setRow, he, this]

/-- The rows after a batch: the batch's own where it names the entry, else the log's. -/
theorem rows_append (log batch : List Edit) (e : Nat) :
    rows (log ++ batch) e = if batch.any (·.1 == e) then rows batch e else rows log e := by
  unfold rows
  rw [List.foldl_append]
  exact fold_at batch _ empty e

/-! ## Selection -/

/-- What a selector picks of an index: each row that passes it. -/
def pick (s : Sel) (ix : Index Nat Row) : Index Nat Row := fun e => (ix e).filter s.test

/-- An edit as the selection sees it: the row it sets where the row passes, else none. -/
def pickEdit (s : Sel) (x : Edit) : Edit := (x.1, x.2.filter s.test)

/-- The selection kept as an index of the log. -/
def selDerive (s : Sel) : Derive Edit Nat Row := ⟨fun x => [pickEdit s x]⟩

/-- The view of a selector at the head of a log: its pick of the log's rows. -/
def selected (s : Sel) (log : List Edit) : Index Nat Row := pick s (rows log)

theorem pick_setRow (s : Sel) (ix : Index Nat Row) (x : Edit) :
    pick s (setRow ix x) = setRow (pick s ix) (pickEdit s x) := by
  funext e
  simp only [pick, setRow, pickEdit]
  by_cases h : e = x.1 <;> simp [h]

theorem pick_foldl (s : Sel) : ∀ (l : List Edit) (ix : Index Nat Row),
    pick s (l.foldl setRow ix) = (l.map (pickEdit s)).foldl setRow (pick s ix)
  | [], _ => rfl
  | x :: xs, ix => by
    simp only [List.foldl_cons, List.map_cons]
    rw [pick_foldl s xs, pick_setRow]

theorem foldl_selDerive (s : Sel) : ∀ (l : List Edit) (ix : Index Nat Row),
    l.foldl (step (selDerive s)) ix = (l.map (pickEdit s)).foldl setRow ix
  | [], _ => rfl
  | x :: xs, ix => by
    simp only [List.foldl_cons, List.map_cons, step, selDerive, List.foldl_nil]
    exact foldl_selDerive s xs _

/-- QV1: the selection of a log is an index of that log, one row per edit. -/
theorem QV1_selected_derive (s : Sel) (log : List Edit) : selected s log = derive (selDerive s) log := by
  unfold selected rows derive
  rw [pick_foldl, foldl_selDerive]
  rfl

/-- QV2 (the delta rule of a selector): the selection after a batch is the selection before with the batch's edits
    stepped on, one by one; it reads the batch and nothing of the log before it. -/
theorem QV2_catch_up (s : Sel) (log batch : List Edit) :
    selected s (log ++ batch) = catchUp (selDerive s) (selected s log) batch := by
  rw [QV1_selected_derive, QV1_selected_derive, I1_catch_up]

/-- QV3: a selection stamped with its head opens as the selection of the whole log, from an honest slot (caught up)
    or none (built again), as every shelf index does. -/
theorem QV3_open {H : Type} [DecidableEq H] (s : Sel) (stamp : List Edit → H) (hs : Sound stamp) (log : List Edit)
    (slot : Option (Slot Nat Row H)) (hh : ∀ x, slot = some x → Honest (selDerive s) stamp x) :
    openSlot (selDerive s) stamp log slot = selected s log := by
  rw [QV1_selected_derive]
  cases slot with
  | none => rfl
  | some x => exact I2_open _ stamp hs log x (hh x rfl)

/-- QV4: where no edit of the batch names an entry, its row in the selection stays as it was. -/
theorem QV4_untouched (s : Sel) (log batch : List Edit) (e : Nat) (he : batch.any (·.1 == e) = false) :
    selected s (log ++ batch) e = selected s log e := by
  simp only [selected, pick, rows_append, he]
  rfl

/-- Selecting with the meet of two selectors is selecting with one in what the other picked. -/
theorem selected_meet (a b : Sel) (log : List Edit) (e : Nat) :
    selected (a.meet b) log e = (selected a log e).filter b.test := by
  simp only [selected, pick]
  cases rows log e with
  | none => rfl
  | some r =>
    cases ha : a.test r <;> cases hb : b.test r <;> simp [Option.filter, meet_test, ha, hb]

/-! ## Window -/

/-- The newest `w` of a list, in its order. -/
def lastN (w : Nat) (l : List Nat) : List Nat := (l.reverse.take w).reverse

theorem lastN_length (w : Nat) (l : List Nat) : (lastN w l).length ≤ w := by
  simp [lastN, List.length_take]
  omega

theorem lastN_append (w : Nat) (a b : List Nat) : lastN w (a ++ b) = lastN (w - b.length) a ++ lastN w b := by
  simp [lastN, List.reverse_append, List.take_append, List.length_reverse]

theorem lastN_lastN (m n : Nat) (l : List Nat) : lastN m (lastN n l) = lastN (min m n) l := by
  simp [lastN, List.take_take]

/-- The window of a query: the newest `w` entries of `order` (the entries in creation order) that pass `p`. -/
def window (w : Nat) (p : Nat → Bool) (order : List Nat) : List Nat := lastN w (order.filter p)

/-- QW1 (the delta rule of a window, for new entries): the window after new entries is the window of the old window
    and the new entries that pass. -/
theorem QW1_append (w : Nat) (p : Nat → Bool) (order added : List Nat) :
    window w p (order ++ added) = lastN w (window w p order ++ added.filter p) := by
  unfold window
  rw [List.filter_append, lastN_append, lastN_append, lastN_lastN]
  congr 2
  omega

/-- QW2 (the delta rule of a window, for a change within it): where `order` splits into an older part `older` and the
    part `recent` the change falls in, and the change leaves every older entry as it was, the new window is the change's
    pick of `recent` with as many of the older entries the query picked before as it has room for. -/
theorem QW2_refill (w : Nat) (p p' : Nat → Bool) (older recent : List Nat) (same : ∀ e ∈ older, p' e = p e) :
    window w p' (older ++ recent) =
      lastN (w - (recent.filter p').length) (older.filter p) ++ lastN w (recent.filter p') := by
  unfold window
  rw [List.filter_append, lastN_append, List.filter_congr same]

/-- A window whose entries all still pass and that the change leaves full keeps its entries. -/
theorem window_full_stays (w : Nat) (p : Nat → Bool) (order added : List Nat) (hnone : added.filter p = []) :
    window w p (order ++ added) = window w p order := by
  rw [QW1_append, hnone, List.append_nil, window, lastN_lastN, Nat.min_self]

/-! ## Follow -/

/-- The entries `k` hops or fewer from `roots`, following `links`. -/
def reach (links : Nat → List Nat) : Nat → List Nat → List Nat
  | 0, roots => roots
  | k + 1, roots => roots ++ reach links k (roots.flatMap links)

theorem flatMap_congr {f g : Nat → List Nat} : ∀ (l : List Nat), (∀ x ∈ l, f x = g x) → l.flatMap f = l.flatMap g
  | [], _ => rfl
  | x :: xs, h => by
    simp only [List.flatMap_cons, h x (by simp), flatMap_congr xs (fun y hy => h y (by simp [hy]))]

/-- QF1: what a follow reaches reads only the links of what it reaches, so links changed elsewhere leave it as it
    was. -/
theorem QF1_untouched (links links' : Nat → List Nat) :
    ∀ (k : Nat) (roots : List Nat), (∀ e ∈ reach links k roots, links' e = links e) →
      reach links' k roots = reach links k roots
  | 0, _, _ => rfl
  | k + 1, roots, h => by
    simp only [reach] at h ⊢
    have hr : roots.flatMap links' = roots.flatMap links :=
      flatMap_congr roots fun x hx => h x (List.mem_append_left _ hx)
    rw [hr, QF1_untouched links links' k _ fun e he => h e (List.mem_append_right _ he)]

theorem flatMap_length_le (links : Nat → List Nat) (f : Nat) (hf : ∀ e, (links e).length ≤ f) :
    ∀ (l : List Nat), (l.flatMap links).length ≤ l.length * f
  | [] => by simp
  | x :: xs => by
    simp only [List.flatMap_cons, List.length_append, List.length_cons, Nat.succ_mul]
    have := flatMap_length_le links f hf xs
    have := hf x
    omega

/-- QF2: where no row holds more than `f` links, a follow of `k` hops from `r` entries reaches at most
    `r · (f + 1) ^ k` of them. -/
theorem QF2_bound (links : Nat → List Nat) (f : Nat) (hf : ∀ e, (links e).length ≤ f) :
    ∀ (k : Nat) (roots : List Nat), (reach links k roots).length ≤ roots.length * (f + 1) ^ k
  | 0, roots => by simp [reach]
  | k + 1, roots => by
    simp only [reach, List.length_append]
    have h1 := QF2_bound links f hf k (roots.flatMap links)
    have h2 := flatMap_length_le links f hf roots
    have h3 : (roots.flatMap links).length * (f + 1) ^ k ≤ roots.length * f * (f + 1) ^ k :=
      Nat.mul_le_mul_right _ h2
    have h4 : 0 < (f + 1) ^ k := Nat.pow_pos (by omega)
    have h5 : roots.length ≤ roots.length * (f + 1) ^ k := Nat.le_mul_of_pos_right _ h4
    have h6 : roots.length * (f + 1) ^ (k + 1) = roots.length * (f + 1) ^ k + roots.length * f * (f + 1) ^ k := by
      rw [Nat.pow_succ, Nat.mul_comm ((f + 1) ^ k), ← Nat.mul_assoc, Nat.mul_succ, Nat.add_mul, Nat.add_comm]
    omega

/-! ## Compaction -/

/-- The log with every edit a later edit of the same entry overrides taken out. -/
def compact : List Edit → List Edit
  | [] => []
  | x :: xs => if xs.any (·.1 == x.1) then compact xs else x :: compact xs

theorem foldl_compact : ∀ (l : List Edit) (ix : Index Nat Row), (compact l).foldl setRow ix = l.foldl setRow ix
  | [], _ => rfl
  | x :: xs, ix => by
    simp only [compact, List.foldl_cons]
    split
    · rename_i hlater
      rw [foldl_compact xs ix]
      funext e
      rw [fold_at xs ix (setRow ix x) e]
      split
      · rfl
      · rename_i hno
        have hne : e ≠ x.1 := fun h => hno (h ▸ hlater)
        rw [fold_at xs (setRow ix x) (setRow ix x) e]
        simp [hno, setRow, hne]
    · simp only [List.foldl_cons]
      exact foldl_compact xs _

/-- QC1: compaction keeps the rows. -/
theorem QC1_compact (log : List Edit) : rows (compact log) = rows log := foldl_compact log empty

/-- A view of a log: anything worked out of its rows and its creation order alone. -/
def created (log : List Edit) : List Nat := (log.map (·.1)).eraseDups

/-- QC2: a compacted log gives every view its rows give; compaction keeps an entry's first place where its last edit
    is its first, and the window reads the order the device kept, never the compacted log's. -/
theorem QC2_view {α : Type} (view : Index Nat Row → α) (log : List Edit) : view (rows (compact log)) = view (rows log) := by
  rw [QC1_compact]

/-! ## A query and its answer -/

/-- A query: a selector, a window of the newest `window` entries it picks, and a follow of `follow` hops from them. -/
structure Query where
  sel    : Sel
  window : Nat
  follow : Nat
  deriving Repr

/-- The links of an entry's row in an index, none where it has no row. -/
def linksIn (ix : Index Nat Row) (e : Nat) : List Nat := ((ix e).map Row.links).getD []

/-- The answer of a query on a log, the order being the entries in creation order: its window, and what it follows
    from the window's links. -/
def answer (q : Query) (log : List Edit) (order : List Nat) : List Nat × List Nat :=
  let sel := selected q.sel log
  let win := window q.window (fun e => (sel e).isSome) order
  (win, reach (linksIn (rows log)) q.follow (win.flatMap (linksIn (rows log))))

/-- The answer after a batch that names none of what the old answer reached and adds no entry its selector picks is the
    old answer: the window by `QV4_untouched` and `window_full_stays`, the follow by `QF1_untouched`. -/
theorem answer_untouched (q : Query) (log batch : List Edit) (order : List Nat) 
    (hquiet : ∀ e ∈ order, batch.any (·.1 == e) = false)
    (hadded : ((batch.map (·.1)).eraseDups.filter fun e => (selected q.sel (log ++ batch) e).isSome) = [])
    (hreach : ∀ e ∈ (answer q log order).1 ++ (answer q log order).2, batch.any (·.1 == e) = false) :
    answer q (log ++ batch) (order ++ ((batch.map (·.1)).eraseDups)) = answer q log order := by
  have hsel : ∀ e ∈ order, (selected q.sel (log ++ batch) e).isSome = (selected q.sel log e).isSome := fun e he => by
    rw [QV4_untouched _ _ _ e (hquiet e he)]
  have hwin : window q.window (fun e => (selected q.sel (log ++ batch) e).isSome)
        (order ++ (batch.map (·.1)).eraseDups) = window q.window (fun e => (selected q.sel log e).isSome) order := by
    rw [window_full_stays _ _ _ _ hadded, window, window, List.filter_congr hsel]
  have hlinks : ∀ e, batch.any (·.1 == e) = false → linksIn (rows (log ++ batch)) e = linksIn (rows log) e := by
    intro e he
    simp only [linksIn, rows_append, he]
    rfl
  simp only [answer] at hreach ⊢
  rw [hwin]
  have hroots : (window q.window (fun e => (selected q.sel log e).isSome) order).flatMap (linksIn (rows (log ++ batch)))
      = (window q.window (fun e => (selected q.sel log e).isSome) order).flatMap (linksIn (rows log)) :=
    flatMap_congr _ fun e he => hlinks e (hreach e (List.mem_append_left _ he))
  rw [hroots, QF1_untouched _ _ _ _ fun e he => hlinks e (hreach e (List.mem_append_right _ he))]

end AvenDB.QueryView
