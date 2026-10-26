import AvenDB.Basic

/-!
# Interests: what a view wants, in tiers

Step P3 of sync v2 (`docs/AVENDB_SYNC_V2.md`). One value says what a view wants: an `Interest`, a cap selector
(`Selector`, the grammar shares use, so caps and wants stay one concept) over one vault, a window, a tier and a
distance. A mounted view sets its Interests through one handle and its unmount clears them: no lease, no timer. A
manifest is a stored tree of Interests (`Tree`), the composite pattern of 2026-10-21, its slots (`$room`, `$timeline`,
`$asset`) bound from the route or the selection.

The scheduler (`schedule`) turns the Interests a device holds into one order of entries to bring:

- `schedule_ordered`: every entry of a higher tier comes before every entry of a lower one (now, next, later, idle),
  and inside a tier the nearer first, by the view's signal (viewport, playhead, camera).
- `schedule_whole`: it holds exactly the entries some Interest wants. Tiers and signals only order; they never
  withhold an entry (T19 still decides what each log sends) and never add one.
- `schedule_once`: each entry once.
- `schedule_best`: an entry two Interests want comes at the higher of their tiers.
- `retier_same_set`: a click that moves Interests between tiers, or a playhead that moves, changes the order alone.
- `served_needs_authority`, `served_tier_free`: what a device is served is what it may read; an Interest grants
  nothing, whatever its tier.
- `unbound_slot_wants_nothing`, `slot_names_one_entry`: a slot no route or selection bound wants nothing, never the
  whole vault; a bound slot wants that one entry.
- `flatten_never_raises`: a manifest held inside another's tier never pulls its parts above that tier.

Rust: `avendb-net/src/interest.rs` (`Interests::entries`). JS: `game/code/sources/interest.js` (`schedule`), whose
tests replay these laws.
-/

namespace AvenDB.Interest

/-- When a view wants it: on screen (`now`), one click away (`next`), the rest of the screen's data (`later`), and what
    the device keeps for offline use (`idle`). -/
inductive Tier where
  | now | next | later | idle
  deriving DecidableEq, Repr

def Tier.rank : Tier → Nat
  | .now => 0 | .next => 1 | .later => 2 | .idle => 3

/-- The lower of two tiers (the later rank): where a part held at `cap` lands. -/
def Tier.atMost (cap t : Tier) : Tier := if t.rank < cap.rank then cap else t

theorem Tier.atMost_rank (cap t : Tier) : cap.rank ≤ (cap.atMost t).rank := by
  unfold Tier.atMost; split <;> omega

/-- Which of an entry's entries a window keeps: all, or the newest `n` by creation. -/
inductive Window where
  | all
  | newest (n : Nat)
  deriving DecidableEq, Repr

/-- One Interest: a selector over one vault's entries, a window, a tier, and each entry's distance to the view's
    signal (0 where it has none). -/
structure Interest where
  vault  : VaultId
  want   : Selector
  window : Window := .all
  tier   : Tier
  dist   : EntryId → Nat := fun _ => 0

/-- What a device knows of the entries it could bring: each one's vault and attributes (held, or found by index). -/
abbrev Catalog := List (VaultId × Attrs)

def Window.keep : Window → List Attrs → List Attrs
  | .all, as => as
  | .newest n, as => (as.mergeSort (fun a b => decide (b.created ≤ a.created))).take n

/-- The entries Interest `i` wants of catalog `c`. It reads the vault, the selector and the window alone. -/
def wanted (c : Catalog) (vault : VaultId) (want : Selector) (window : Window) : List EntryId :=
  (window.keep ((c.filter fun p => p.1 == vault && want.matches p.2).map Prod.snd)).map Attrs.entry

def Interest.wants (c : Catalog) (i : Interest) : List EntryId := wanted c i.vault i.want i.window

/-- One entry to bring, at a tier's rank and a distance. -/
structure Work where
  entry : EntryId
  rank  : Nat
  dist  : Nat
  deriving DecidableEq, Repr

/-- The scheduler's order: the higher tier first, then the nearer. -/
def before (a b : Work) : Bool := a.rank < b.rank || (a.rank == b.rank && a.dist ≤ b.dist)

theorem before_trans (a b c : Work) : before a b = true → before b c = true → before a c = true := by
  unfold before; simp; omega

theorem before_total (a b : Work) : (before a b || before b a) = true := by
  unfold before; simp; omega

def works (c : Catalog) (i : Interest) : List Work :=
  (i.wants c).map fun e => ⟨e, i.tier.rank, i.dist e⟩

/-- Each entry once: its first work, the rest of it dropped. -/
def firstOf : List Work → List Work
  | [] => []
  | w :: ws => w :: firstOf (ws.filter (·.entry != w.entry))
termination_by l => l.length
decreasing_by simp_wf; exact Nat.lt_succ_of_le (List.length_filter_le _ _)

theorem firstOf_sublist : ∀ l : List Work, (firstOf l).Sublist l
  | [] => by simp [firstOf]
  | w :: ws => by
    rw [firstOf]
    exact ((firstOf_sublist _).trans List.filter_sublist).cons_cons w
termination_by l => l.length
decreasing_by simp_wf; exact Nat.lt_succ_of_le (List.length_filter_le _ _)

theorem mem_firstOf : ∀ (l : List Work) (e : EntryId), e ∈ (firstOf l).map Work.entry ↔ e ∈ l.map Work.entry
  | [] , _ => by simp [firstOf]
  | w :: ws, e => by
    rw [firstOf]
    have ih := mem_firstOf (ws.filter (·.entry != w.entry)) e
    simp only [List.map_cons, List.mem_cons] at ih ⊢
    constructor
    · rintro (h | h)
      · exact Or.inl h
      · rcases (List.mem_map.mp (ih.mp h)) with ⟨v, hv, rfl⟩
        exact Or.inr (List.mem_map.mpr ⟨v, (List.mem_filter.mp hv).1, rfl⟩)
    · rintro (h | h)
      · exact Or.inl h
      · by_cases hw : e = w.entry
        · exact Or.inl hw
        · rcases List.mem_map.mp h with ⟨v, hv, rfl⟩
          exact Or.inr (ih.mpr (List.mem_map.mpr ⟨v, List.mem_filter.mpr ⟨hv, by simpa using hw⟩, rfl⟩))
termination_by l => l.length
decreasing_by simp_wf; exact Nat.lt_succ_of_le (List.length_filter_le _ _)

theorem firstOf_nodup : ∀ l : List Work, ((firstOf l).map Work.entry).Nodup
  | [] => by simp [firstOf]
  | w :: ws => by
    rw [firstOf]
    refine List.nodup_cons.mpr ⟨?_, firstOf_nodup _⟩
    intro h
    rcases List.mem_map.mp ((mem_firstOf _ _).mp h) with ⟨v, hv, hve⟩
    have := (List.mem_filter.mp hv).2
    simp [hve] at this
termination_by l => l.length
decreasing_by simp_wf; exact Nat.lt_succ_of_le (List.length_filter_le _ _)

/-- In a list in the scheduler's order, the work kept for an entry comes no later than any work of it. -/
theorem firstOf_best : ∀ (l : List Work), l.Pairwise (fun a b => before a b = true) →
    ∀ w ∈ l, ∃ v ∈ firstOf l, v.entry = w.entry ∧ before v w = true
  | [], _, w, h => by simp at h
  | u :: us, hs, w, hw => by
    rw [firstOf]
    have hs' := List.pairwise_cons.mp hs
    rcases List.mem_cons.mp hw with rfl | hw
    · exact ⟨w, List.mem_cons_self, rfl, by unfold before; simp⟩
    · by_cases he : w.entry = u.entry
      · exact ⟨u, List.mem_cons_self, he.symm, hs'.1 w hw⟩
      · have hf : w ∈ us.filter (·.entry != u.entry) := List.mem_filter.mpr ⟨hw, by simpa using he⟩
        rcases firstOf_best _ (hs'.2.sublist List.filter_sublist) w hf with ⟨v, hv, hve, hvb⟩
        exact ⟨v, List.mem_cons_of_mem _ hv, hve, hvb⟩
termination_by l => l.length
decreasing_by simp_wf; exact Nat.lt_succ_of_le (List.length_filter_le _ _)

/-- The order a device brings what its Interests want. -/
def schedule (c : Catalog) (is : List Interest) : List Work :=
  firstOf ((is.flatMap (works c)).mergeSort before)

theorem schedule_ordered (c : Catalog) (is : List Interest) :
    (schedule c is).Pairwise (fun a b => before a b = true) :=
  (List.pairwise_mergeSort before_trans before_total _).sublist (firstOf_sublist _)

theorem schedule_once (c : Catalog) (is : List Interest) : ((schedule c is).map Work.entry).Nodup :=
  firstOf_nodup _

theorem schedule_whole (c : Catalog) (is : List Interest) (e : EntryId) :
    e ∈ (schedule c is).map Work.entry ↔ ∃ i ∈ is, e ∈ i.wants c := by
  unfold schedule
  rw [mem_firstOf]
  constructor
  · intro h
    rcases List.mem_map.mp h with ⟨w, hw, rfl⟩
    rcases List.mem_flatMap.mp (List.mem_mergeSort.mp hw) with ⟨i, hi, hwi⟩
    rcases List.mem_map.mp hwi with ⟨e, he, rfl⟩
    exact ⟨i, hi, he⟩
  · rintro ⟨i, hi, he⟩
    exact List.mem_map.mpr ⟨⟨e, i.tier.rank, i.dist e⟩,
      List.mem_mergeSort.mpr (List.mem_flatMap.mpr ⟨i, hi, List.mem_map.mpr ⟨e, he, rfl⟩⟩), rfl⟩

theorem schedule_best (c : Catalog) (is : List Interest) (i : Interest) (e : EntryId)
    (hi : i ∈ is) (he : e ∈ i.wants c) :
    ∃ v ∈ schedule c is, v.entry = e ∧ v.rank ≤ i.tier.rank := by
  have hw : (⟨e, i.tier.rank, i.dist e⟩ : Work) ∈ (is.flatMap (works c)).mergeSort before :=
    List.mem_mergeSort.mpr (List.mem_flatMap.mpr ⟨i, hi, List.mem_map.mpr ⟨e, he, rfl⟩⟩)
  rcases firstOf_best _ (List.pairwise_mergeSort before_trans before_total _) _ hw with ⟨v, hv, hve, hvb⟩
  refine ⟨v, hv, hve, ?_⟩
  unfold before at hvb; simp at hvb; omega

/-- What a click or a signal changes of an Interest: its tier and its distances, nothing it wants. -/
def Interest.what (i : Interest) : VaultId × Selector × Window := (i.vault, i.want, i.window)

theorem retier_same_set (c : Catalog) (is js : List Interest) (h : is.map Interest.what = js.map Interest.what)
    (e : EntryId) : e ∈ (schedule c is).map Work.entry ↔ e ∈ (schedule c js).map Work.entry := by
  rw [schedule_whole, schedule_whole]
  have key : ∀ (is js : List Interest), is.map Interest.what = js.map Interest.what →
      (∃ i ∈ is, e ∈ i.wants c) → ∃ j ∈ js, e ∈ j.wants c := by
    intro is js h ⟨i, hi, he⟩
    have : i.what ∈ js.map Interest.what := h ▸ List.mem_map_of_mem hi
    rcases List.mem_map.mp this with ⟨j, hj, hji⟩
    refine ⟨j, hj, ?_⟩
    simp only [Interest.what, Prod.mk.injEq] at hji
    simpa [Interest.wants, hji.1, hji.2.1, hji.2.2] using he
  exact ⟨key is js h, key js is h.symm⟩

/-- A closed view holds no Interest, so it has the device bring nothing. -/
theorem closed_brings_nothing (c : Catalog) : schedule c [] = [] := by
  simp [schedule, firstOf]

/-- What a device is served: what the schedule names that its caps let it read. -/
def served (may : EntryId → Bool) (c : Catalog) (is : List Interest) : List EntryId :=
  ((schedule c is).map Work.entry).filter may

theorem served_needs_authority (may : EntryId → Bool) (c : Catalog) (is : List Interest) (e : EntryId)
    (h : e ∈ served may c is) : may e = true :=
  (List.mem_filter.mp h).2

theorem served_tier_free (may : EntryId → Bool) (c : Catalog) (is js : List Interest)
    (h : is.map Interest.what = js.map Interest.what) (e : EntryId) :
    e ∈ served may c is ↔ e ∈ served may c js := by
  simp only [served, List.mem_filter]
  rw [retier_same_set c is js h e]

/-! ## Slots: bindings from the route or the selection -/

/-- What a manifest's part wants: a selector, or the one entry a slot (`$room`) is bound to. -/
inductive Pick where
  | sel (s : Selector)
  | slot (name : Sym)
  deriving DecidableEq, Repr

/-- The slots bound now, by the route or the selection. -/
abbrev Env := Sym → Option EntryId

def Pick.resolve (env : Env) : Pick → Option Selector
  | .sel s => some s
  | .slot n => (env n).map fun e => .anyOf [[.entryIn [e]]]

theorem unbound_slot_wants_nothing (env : Env) (n : Sym) (h : env n = none) :
    (Pick.slot n).resolve env = none := by
  simp [Pick.resolve, h]

theorem slot_names_one_entry (env : Env) (n : Sym) (s : Selector) (h : (Pick.slot n).resolve env = some s) :
    ∃ e, env n = some e ∧ s = .anyOf [[.entryIn [e]]] := by
  simp [Pick.resolve] at h
  rcases h with ⟨e, he, rfl⟩
  exact ⟨e, he, rfl⟩

/-! ## Manifests: trees of Interests -/

/-- A manifest, its slots resolved: Interests, and manifests it holds at a tier. -/
inductive Tree where
  | leaf (i : Interest)
  | hold (at_ : Tier) (parts : List Tree)

def Interest.lift (cap : Tier) (i : Interest) : Interest := { i with tier := cap.atMost i.tier }

mutual
def flatten (cap : Tier) : Tree → List Interest
  | .leaf i => [i.lift cap]
  | .hold t ps => flattenAll (cap.atMost t) ps
def flattenAll (cap : Tier) : List Tree → List Interest
  | [] => []
  | p :: ps => flatten cap p ++ flattenAll cap ps
end

theorem atMost_mono (a b t : Tier) (h : a.rank ≤ b.rank) : a.rank ≤ (b.atMost t).rank :=
  Nat.le_trans h (Tier.atMost_rank b t)

mutual
theorem flatten_never_raises (cap : Tier) : ∀ (t : Tree) (i : Interest), i ∈ flatten cap t → cap.rank ≤ i.tier.rank
  | .leaf j, i, h => by
    simp [flatten] at h; subst h; exact Tier.atMost_rank cap j.tier
  | .hold t ps, i, h => by
    simp only [flatten] at h
    exact Nat.le_trans (Tier.atMost_rank cap t) (flattenAll_never_raises (cap.atMost t) ps i h)
theorem flattenAll_never_raises (cap : Tier) : ∀ (ps : List Tree) (i : Interest), i ∈ flattenAll cap ps → cap.rank ≤ i.tier.rank
  | [], i, h => by simp [flattenAll] at h
  | p :: ps, i, h => by
    simp only [flattenAll, List.mem_append] at h
    rcases h with h | h
    · exact flatten_never_raises cap p i h
    · exact flattenAll_never_raises cap ps i h
end

/-- A manifest held at `now` keeps its own tiers. -/
theorem now_keeps_tiers (i : Interest) : (i.lift .now).tier = i.tier := by
  cases h : i.tier <;> simp [Interest.lift, Tier.atMost, Tier.rank, h]

end AvenDB.Interest
