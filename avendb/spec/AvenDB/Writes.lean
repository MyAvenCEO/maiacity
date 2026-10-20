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

end AvenDB
