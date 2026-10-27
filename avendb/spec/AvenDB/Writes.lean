import AvenDB.Proposals

/-!
# A version's writes: what tells a newer version from an older one (T10l)

A version of an entry is named by its heads, and holds them and every write of the entry they build on (`holds`). Its
count of writes (`writesAt`) is how a reader tells versions apart in time: a version that comes after another holds every
write that one holds and at least one more, so it holds more (`T10_writes_grow`); and whoever hands out a version made of
only some of the writes, leaving the newest out, as a server may, hands out one that holds no more than the full one
(`T10_writes_left_out`). A signature proves who wrote a write, never that a version is the newest: this count does,
against the newest a reader already proved (maiaCITY's game/code/fresh.js), so it refuses an older version that is
validly signed. The Rust core's `History::version(heads).len()`, each public row's `version.writes`
(`world::public_row`).
-/

namespace AvenDB

/-- How many writes of entry `e` the version with heads `v` holds: its heads and every write they build on. -/
def writesAt (ws : List Write) (e : EntryId) (v : List EditId) : Nat :=
  (holds ws e v).length

/-! ## Counting what a list keeps of another -/

/-- What one test keeps of a list, another that passes all of it keeps at least as much of. -/
theorem length_filter_le {α : Type} (l : List α) {p q : α → Bool} (h : ∀ x ∈ l, p x = true → q x = true) :
    (l.filter p).length ≤ (l.filter q).length := by
  induction l with
  | nil => simp
  | cons a l ih =>
    have ih := ih fun x hx => h x (List.mem_cons_of_mem _ hx)
    simp only [List.filter_cons]
    cases hp : p a <;> cases hq : q a
    · simpa using ih
    · simp; omega
    · exact absurd (h a List.mem_cons_self hp) (by simp [hq])
    · simpa using ih

/-- ... and more of it, where it keeps one the first doesn't. -/
theorem length_filter_lt {α : Type} (l : List α) {p q : α → Bool} (h : ∀ x ∈ l, p x = true → q x = true)
    (hx : ∃ x ∈ l, q x = true ∧ p x = false) : (l.filter p).length < (l.filter q).length := by
  induction l with
  | nil => simp at hx
  | cons a l ih =>
    have hle := length_filter_le l fun x hx => h x (List.mem_cons_of_mem _ hx)
    simp only [List.filter_cons]
    obtain ⟨x, hxl, hqx, hpx⟩ := hx
    rcases List.mem_cons.1 hxl with rfl | hxl
    · simp [hqx, hpx]; omega
    · have ih := ih (fun y hy => h y (List.mem_cons_of_mem _ hy)) ⟨x, hxl, hqx, hpx⟩
      cases hp : p a <;> cases hq : q a
      · simpa using ih
      · simp; omega
      · exact absurd (h a List.mem_cons_self hp) (by simp [hq])
      · simpa using ih

/-- Of a list in which nothing comes twice, a part of it in its order is what it keeps of its members. -/
theorem sublist_eq_filter {α : Type} [DecidableEq α] {a l : List α} (hs : a.Sublist l) (hnd : l.Nodup) :
    a = l.filter fun x => decide (x ∈ a) := by
  induction hs with
  | slnil => rfl
  | @cons a' l' x hs ih =>
    rw [List.nodup_cons] at hnd
    have hx : x ∉ a' := fun h => hnd.1 (hs.subset h)
    have hx' : decide (x ∈ a') = false := by simpa using hx
    rw [List.filter_cons, hx']
    exact ih hnd.2
  | @cons_cons a' l' x hs ih =>
    rw [List.nodup_cons] at hnd
    have hx' : decide (x ∈ x :: a') = true := by simp
    rw [List.filter_cons, hx']
    simp only [ite_true]
    congr 1
    rw [ih hnd.2]
    refine List.filter_congr fun y hy => ?_
    have : y ≠ x := fun h => hnd.1 (h ▸ hy)
    simp [this, hy]

/-- Two parts of a list in which nothing comes twice, each in its order: one holding all the other holds is no shorter,
    and longer where it holds one the other doesn't. -/
theorem length_of_subset {α : Type} [DecidableEq α] {a b l : List α} (ha : a.Sublist l) (hb : b.Sublist l)
    (hnd : l.Nodup) (hsub : ∀ x ∈ a, x ∈ b) :
    a.length ≤ b.length ∧ ((∃ x ∈ b, x ∉ a) → a.length < b.length) := by
  have hmono : ∀ x ∈ l, decide (x ∈ a) = true → decide (x ∈ b) = true := fun x _ h => by
    simpa using hsub x (by simpa using h)
  have ea := sublist_eq_filter ha hnd
  have eb := sublist_eq_filter hb hnd
  constructor
  · rw [ea, eb]
    exact length_filter_le l hmono
  · rintro ⟨x, hxb, hxa⟩
    have hq : decide (x ∈ b) = true := by simpa using hxb
    have hp : decide (x ∈ a) = false := by simpa using hxa
    rw [ea, eb]
    exact length_filter_lt l hmono ⟨x, hb.subset hxb, hq, hp⟩

/-- Writes in order come once each: no two share an id. -/
theorem Ordered.nodup {ws : List Write} (hord : Ordered ws) : ws.Nodup :=
  List.Pairwise.of_map (·.edit) (fun _ _ h hab => h (hab ▸ rfl)) hord.1

/-! ## T10l: a later version holds more writes; one with writes left out, no more -/

/-- A version that comes after another, holding every write it holds and at least one more, holds more writes. -/
theorem T10_writes_grow {ws : List Write} (hord : Ordered ws) {e : EntryId} {v v' : List EditId}
    (hdesc : ∀ x ∈ holds ws e v, x ∈ holds ws e v') (hmore : ∃ x ∈ holds ws e v', x ∉ holds ws e v) :
    writesAt ws e v < writesAt ws e v' :=
  (length_of_subset (reach_sublist ws e _) (reach_sublist ws e _) hord.nodup hdesc).2 hmore

/-- Of only some of the writes, in their order (`ws'`, what a server hands out that leaves writes out), a version holds
    only writes the full writes' version with those heads holds too: what it reaches back to, the full writes reach as
    well. -/
theorem holds_left_out {ws ws' : List Write} (hord : Ordered ws) (hsub : ws'.Sublist ws) {e : EntryId}
    {v : List EditId} : ∀ x ∈ holds ws' e v, x ∈ holds ws e v :=
  reach_induct _ (fun _ hx he hs => mem_reach_of_seed (hsub.subset hx) he hs)
    (fun _ hx he _ _ _ hy hd => reach_closed hord hy (hsub.subset hx) he hd)

/-- A version made of only some of the writes, writes left out, holds no more writes than the full one it is part of:
    whatever heads it names, so long as all it holds the full version holds. So a version with writes left out never
    counts as newer than the version it was cut from. -/
theorem T10_writes_left_out {ws ws' : List Write} (hord : Ordered ws) (hsub : ws'.Sublist ws) {e : EntryId}
    {v' v : List EditId} (hpart : ∀ x ∈ holds ws' e v', x ∈ holds ws e v) :
    writesAt ws' e v' ≤ writesAt ws e v :=
  (length_of_subset ((reach_sublist ws' e _).trans hsub) (reach_sublist ws e _) hord.nodup hpart).1

/-- In particular, the same heads, with writes left out, hold no more. -/
theorem T10_writes_left_out_same {ws ws' : List Write} (hord : Ordered ws) (hsub : ws'.Sublist ws) {e : EntryId}
    {v : List EditId} : writesAt ws' e v ≤ writesAt ws e v :=
  T10_writes_left_out hord hsub (holds_left_out hord hsub)

/-! ## A person's write waits for no read and no catch-up (batch 5, W2)

A device's Lab runs one turn at a time (avendb-net's `lab_schedule.rs`). Its turns come in three classes: a person's
writes, the page's reads, and background work (catch-up, upkeep, a keeper's scan). Writes go first, oldest first, ahead
of any read or background turn that waits (`pick_write_first`); with no write waiting, reads and background share the
turns as before, three reads then one background turn (`pick_without_writes`). So a write waits for the turn that runs
when it comes and for the writes made before it, nothing else (`write_granted_in_order`), however many reads and
background turns wait or come while it waits (`pick_ignores_others`); with every turn at most `T` long (avendb's
`scale_turns.rs` holds each at 50 ms at 130,000 edits), a write is applied within `(k + 1) * T` of being asked for, `k`
the writes ahead of it (`write_wait_bound`). This models the order of turns only; how long a turn takes is measured. -/

namespace Turns

/-- A turn waiting for the Lab: a person's write, a page's read, or background work. -/
inductive Class where
  | write
  | read
  | background
  deriving DecidableEq, Repr

/-- The turns waiting, each by its ticket, oldest first, and how many reads in a row were let go ahead of background. -/
structure Queue where
  writes : List Nat
  reads : List Nat
  background : List Nat
  burst : Nat
  deriving DecidableEq, Repr

/-- The next turn: the oldest write; with none, the oldest read unless three reads in a row went ahead of waiting
background work; else the oldest background turn. What is left waiting beside it. -/
def pick (q : Queue) : Option (Class × Nat × Queue) :=
  match q.writes with
  | w :: ws => some (.write, w, { q with writes := ws })
  | [] =>
    match q.reads, q.background with
    | r :: rs, [] => some (.read, r, { q with reads := rs, burst := q.burst + 1 })
    | r :: rs, b :: bs =>
      if q.burst < 3 then some (.read, r, { q with reads := rs, burst := q.burst + 1 })
      else some (.background, b, { q with background := bs, burst := 0 })
    | [], b :: bs => some (.background, b, { q with background := bs, burst := 0 })
    | [], [] => none

/-- The turns granted, `n` picks in a row, with nothing new coming. -/
def grants : Nat → Queue → List (Class × Nat)
  | 0, _ => []
  | n + 1, q =>
    match pick q with
    | some (c, t, q') => (c, t) :: grants n q'
    | none => []

/-- A waiting write goes first, whatever else waits. -/
theorem pick_write_first (q : Queue) (w : Nat) (ws : List Nat) (h : q.writes = w :: ws) :
    pick q = some (.write, w, { q with writes := ws }) := by
  simp [pick, h]

/-- While writes wait, the reads and background work waiting, and those that come, change nothing of which turn is
next. -/
theorem pick_ignores_others (q : Queue) (rs bs : List Nat) (n : Nat) (w : Nat) (ws : List Nat)
    (h : q.writes = w :: ws) :
    (pick { q with reads := rs, background := bs, burst := n }).map (fun x => (x.1, x.2.1)) =
      (pick q).map (fun x => (x.1, x.2.1)) := by
  simp [pick, h]

/-- With no write waiting, turns go as before writes had a class of their own. -/
theorem pick_without_writes (q : Queue) (h : q.writes = []) (r : Nat) (rs : List Nat) (b : Nat) (bs : List Nat)
    (hr : q.reads = r :: rs) (hb : q.background = b :: bs) (busy : 3 ≤ q.burst) :
    pick q = some (.background, b, { q with background := bs, burst := 0 }) := by
  simp [pick, h, hr, hb]
  omega

/-- The writes waiting are granted first, in the order they were made: the write with `k` writes ahead of it gets
the `k + 1`th turn. -/
theorem write_granted_in_order (pre post : List Nat) (w : Nat) (q : Queue) (h : q.writes = pre ++ w :: post) :
    grants (pre.length + 1) q = (pre ++ [w]).map (fun t => (Class.write, t)) := by
  induction pre generalizing q with
  | nil => simp [grants, pick, h]
  | cons x xs ih =>
    have hq : q.writes = x :: (xs ++ w :: post) := by simp [h]
    have step := ih { q with writes := xs ++ w :: post } rfl
    simp only [List.length_cons]
    rw [grants, pick_write_first q x _ hq]
    simp only
    rw [step]
    simp

/-- Turns each at most `T` long add up to at most `T` for each. -/
theorem sum_le_of_each_le (ds : List Nat) (T : Nat) (h : ∀ d ∈ ds, d ≤ T) : ds.sum ≤ ds.length * T := by
  induction ds with
  | nil => simp
  | cons d ds ih =>
    simp only [List.sum_cons, List.length_cons, Nat.succ_mul]
    have := h d (List.mem_cons_self ..)
    have := ih (fun e he => h e (List.mem_cons_of_mem _ he))
    omega

/-- A write with `k` writes ahead of it is applied after at most the turn running when it came and those `k` writes,
then its own: within `(k + 2) * T` of being asked for when every turn is at most `T`, whatever reads and background
work wait. -/
theorem write_wait_bound (running : Nat) (ahead : List Nat) (own T : Nat) (hr : running ≤ T)
    (ha : ∀ d ∈ ahead, d ≤ T) (ho : own ≤ T) : running + ahead.sum + own ≤ (ahead.length + 2) * T := by
  have := sum_le_of_each_le ahead T ha
  have e : (ahead.length + 2) * T = ahead.length * T + T + T := by
    rw [Nat.add_mul]; omega
  omega

end Turns

end AvenDB
