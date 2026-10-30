/-!
# The want queue (db/engine, "Wants"; ARCHITECTURE.md, "Massive data: wants decide what moves", A9)

Wants are the one demand signal: actors' loads, the device profile, what is on screen, a query's target, follows. The
queue turns them into the order in which a device fetches and opens, and holds these laws:

- **served = wants ∩ caps:** a key is queued exactly when something wants it and the device's caps allow it;
- **each key once, at its highest tier:** the best of every want for it, by tier and then by signal;
- **tiers only order:** changing tiers never adds or withholds a key;
- **prerequisites inherit priority:** what a key needs first (its Doc id, keys, checkpoint, segments) is queued at least
  as high as the key;
- **every round moves:** a round serves the first unsatisfied key, uploads before pulls, and either moves a measure
  down, finds nothing left, or raises the stall alarm;
- **`now` is never evicted:** over budget, only entries below `now` go, lowest tier first.

A key is (Doc, branch, depth, window) in A9; here it is any type with equality, so `Aven.Core` can supply its own. Caps
are a predicate on keys, which caps' target grammar decides. A9 waits for Samuel; this models its recommendation, and
every theorem below depends on it. -/

namespace Aven.DB.Engine

/-- `screen` and `turn` are the two kinds of `now`: the screen's comes before a background turn's. -/
inductive Tier where
  | screen | turn | next | later | idle
  deriving DecidableEq, Repr

def Tier.rank : Tier → Nat
  | .screen => 0 | .turn => 1 | .next => 2 | .later => 3 | .idle => 4

def Tier.isNow : Tier → Bool
  | .screen | .turn => true
  | _ => false

/-- One want: a key, how urgently, and the signal that orders it inside its tier (viewport position, distance to the
playhead, place in a list); smaller is nearer. -/
structure Want (Key : Type) where
  key : Key
  tier : Tier
  signal : Nat
  deriving DecidableEq, Repr

variable {Key : Type} [DecidableEq Key]

/-- `a` goes before `b`: a higher tier, or the same tier and a nearer signal. -/
def Want.before (a b : Want Key) : Bool :=
  a.tier.rank < b.tier.rank || (a.tier.rank == b.tier.rank && a.signal ≤ b.signal)

/-- The best want for a key. -/
def bestFor (k : Key) : List (Want Key) → Option (Want Key)
  | [] => none
  | w :: ws =>
    match bestFor k ws with
    | none => if w.key = k then some w else none
    | some a => if w.key = k ∧ w.before a then some w else some a

/-- Each key once, in first-seen order. -/
def keysOnce : List Key → List Key
  | [] => []
  | k :: ks => if k ∈ keysOnce ks then keysOnce ks else k :: keysOnce ks

/-- The queue: every wanted key the caps allow, once, with its best want, in order. -/
def queue (cap : Key → Bool) (ws : List (Want Key)) : List (Want Key) :=
  (((keysOnce (ws.map (·.key))).filter cap).filterMap (bestFor · ws)).mergeSort fun a b => a.before b

/-- Prerequisites: each want brings what its key needs first, at the same tier and signal, listed before it so a tie
goes to the prerequisite. `pre` is closed: what a prerequisite needs is a prerequisite too. -/
def expand (pre : Key → List Key) (ws : List (Want Key)) : List (Want Key) :=
  ws.flatMap fun w => (pre w.key).map (fun k => { w with key := k }) ++ [w]

/-! ### The best want -/

theorem bestFor_mem (k : Key) : ∀ (ws : List (Want Key)) (b : Want Key), bestFor k ws = some b → b ∈ ws ∧ b.key = k
  | [], _, h => by simp [bestFor] at h
  | w :: ws, b, h => by
    simp only [bestFor] at h
    split at h
    · split at h
      · cases h; simp_all
      · cases h
    · rename_i a ha
      have ih := bestFor_mem k ws a ha
      split at h
      · cases h; simp_all
      · cases h; exact ⟨List.mem_cons_of_mem _ ih.1, ih.2⟩

theorem bestFor_some (k : Key) : ∀ (ws : List (Want Key)) (w : Want Key), w ∈ ws → w.key = k →
    ∃ b, bestFor k ws = some b
  | [], _, h, _ => by simp at h
  | v :: ws, w, hw, hk => by
    simp only [bestFor]
    cases hb : bestFor k ws with
    | none =>
      simp only
      cases List.mem_cons.mp hw with
      | inl h => subst h; simp [hk]
      | inr h => obtain ⟨b, hb'⟩ := bestFor_some k ws w h hk; simp [hb] at hb'
    | some a => simp only; split <;> exact ⟨_, rfl⟩

/-- The best want's tier is at least as high as every want for its key. -/
theorem bestFor_highest (k : Key) : ∀ (ws : List (Want Key)) (b : Want Key), bestFor k ws = some b →
    ∀ w ∈ ws, w.key = k → b.tier.rank ≤ w.tier.rank
  | [], _, h, _, _, _ => by simp [bestFor] at h
  | v :: ws, b, h, w, hw, hk => by
    simp only [bestFor] at h
    cases hb : bestFor k ws with
    | none =>
      rw [hb] at h
      simp only at h
      split at h
      · cases h
        cases List.mem_cons.mp hw with
        | inl h => subst h; exact Nat.le_refl _
        | inr h => obtain ⟨c, hc⟩ := bestFor_some k ws w h hk; simp [hb] at hc
      · cases h
    | some a =>
      rw [hb] at h
      simp only at h
      have ha := bestFor_highest k ws a hb
      split at h
      · rename_i hv
        cases h
        have hva : v.tier.rank ≤ a.tier.rank := by
          simp only [Want.before, Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true, beq_iff_eq] at hv
          omega
        cases List.mem_cons.mp hw with
        | inl h => subst h; exact Nat.le_refl _
        | inr h => exact Nat.le_trans hva (ha w h hk)
      · rename_i hv
        cases h
        cases List.mem_cons.mp hw with
        | inl h =>
          subst h
          simp only [Want.before, Bool.or_eq_true, decide_eq_true_eq, Bool.and_eq_true, beq_iff_eq, hk,
            true_and, not_or, not_and] at hv
          omega
        | inr h => exact ha w h hk

/-! ### The laws -/

theorem mem_keysOnce : ∀ (ks : List Key) (k : Key), k ∈ keysOnce ks ↔ k ∈ ks
  | [], _ => by simp [keysOnce]
  | a :: ks, k => by
    have ih := mem_keysOnce ks
    simp only [keysOnce]
    split
    · rename_i h; rw [ih k, List.mem_cons]; constructor
      · exact Or.inr
      · rintro (rfl | h'); exact (ih _).mp h; exact h'
    · rw [List.mem_cons, List.mem_cons, ih k]

theorem nodup_keysOnce : ∀ ks : List Key, (keysOnce ks).Nodup
  | [] => by simp [keysOnce]
  | a :: ks => by
    simp only [keysOnce]
    split
    · exact nodup_keysOnce ks
    · rename_i h; exact List.nodup_cons.mpr ⟨h, nodup_keysOnce ks⟩

theorem mem_queue_iff (cap : Key → Bool) (ws : List (Want Key)) (e : Want Key) :
    e ∈ queue cap ws ↔ e.key ∈ ws.map (·.key) ∧ cap e.key = true ∧ bestFor e.key ws = some e := by
  simp only [queue, List.mem_mergeSort, List.mem_filterMap, List.mem_filter, mem_keysOnce]
  constructor
  · rintro ⟨k, ⟨hk, hc⟩, hb⟩
    have := (bestFor_mem k ws e hb).2
    subst this
    exact ⟨hk, hc, hb⟩
  · rintro ⟨hk, hc, hb⟩
    exact ⟨e.key, ⟨hk, hc⟩, hb⟩

/-- **served = wants ∩ caps:** a key is queued exactly when something wants it and caps allow it. -/
theorem served_eq_wants_caps (cap : Key → Bool) (ws : List (Want Key)) (k : Key) :
    k ∈ (queue cap ws).map (·.key) ↔ (∃ w ∈ ws, w.key = k) ∧ cap k = true := by
  constructor
  · intro h
    obtain ⟨e, he, rfl⟩ := List.mem_map.mp h
    obtain ⟨hk, hc, _⟩ := (mem_queue_iff cap ws e).mp he
    obtain ⟨w, hw, hwk⟩ := List.mem_map.mp hk
    exact ⟨⟨w, hw, hwk⟩, hc⟩
  · rintro ⟨⟨w, hw, hwk⟩, hc⟩
    obtain ⟨b, hb⟩ := bestFor_some k ws w hw hwk
    have hbk := (bestFor_mem k ws b hb).2
    refine List.mem_map.mpr ⟨b, (mem_queue_iff cap ws b).mpr ⟨?_, ?_, ?_⟩, hbk⟩
    · rw [hbk]; exact List.mem_map.mpr ⟨w, hw, hwk⟩
    · rw [hbk]; exact hc
    · rw [hbk]; exact hb

/-- **Each key once.** -/
theorem keys_once (cap : Key → Bool) (ws : List (Want Key)) : ((queue cap ws).map (·.key)).Nodup := by
  have hp := List.mergeSort_perm
    (((keysOnce (ws.map (·.key))).filter cap).filterMap (bestFor · ws)) (fun a b => a.before b)
  rw [queue, (hp.map _).nodup_iff]
  have key_of : ∀ l : List Key, (l.filterMap (bestFor · ws)).map (·.key) = l.filter fun k => (bestFor k ws).isSome := by
    intro l
    induction l with
    | nil => rfl
    | cons k l ih =>
      simp only [List.filterMap_cons, List.filter_cons]
      cases hb : bestFor k ws with
      | none => simp [ih]
      | some b => simp [ih, (bestFor_mem k ws b hb).2]
  rw [key_of]
  exact ((nodup_keysOnce _).filter _).filter _

/-- **At its highest tier:** a queued key's tier is at least as high as every want for it. -/
theorem queued_highest (cap : Key → Bool) (ws : List (Want Key)) (e : Want Key) (he : e ∈ queue cap ws) :
    ∀ w ∈ ws, w.key = e.key → e.tier.rank ≤ w.tier.rank :=
  bestFor_highest e.key ws e ((mem_queue_iff cap ws e).mp he).2.2

/-- **Tiers only order:** wants with other tiers and signals queue exactly the same keys. -/
theorem tiers_only_order (cap : Key → Bool) (ws : List (Want Key)) (f : Want Key → Tier) (g : Want Key → Nat)
    (k : Key) :
    k ∈ (queue cap (ws.map fun w => { w with tier := f w, signal := g w })).map (·.key) ↔
      k ∈ (queue cap ws).map (·.key) := by
  rw [served_eq_wants_caps, served_eq_wants_caps]
  constructor
  · rintro ⟨⟨w, hw, hk⟩, hc⟩
    obtain ⟨a, ha, rfl⟩ := List.mem_map.mp hw
    exact ⟨⟨a, ha, hk⟩, hc⟩
  · rintro ⟨⟨w, hw, hk⟩, hc⟩
    exact ⟨⟨_, List.mem_map.mpr ⟨w, hw, rfl⟩, hk⟩, hc⟩

/-- **Prerequisites inherit priority:** when a key is queued, everything it needs first that caps allow is queued at a
tier at least as high. -/
theorem prerequisites_inherit (cap : Key → Bool) (pre : Key → List Key)
    (closed : ∀ k k', k' ∈ pre k → ∀ k'', k'' ∈ pre k' → k'' ∈ pre k)
    (ws : List (Want Key)) (e : Want Key) (he : e ∈ queue cap (expand pre ws))
    (k' : Key) (hk' : k' ∈ pre e.key) (hc : cap k' = true) :
    ∃ e' ∈ queue cap (expand pre ws), e'.key = k' ∧ e'.tier.rank ≤ e.tier.rank := by
  obtain ⟨_, _, hb⟩ := (mem_queue_iff cap _ e).mp he
  have hmem := (bestFor_mem e.key _ e hb).1
  -- a want for k' at e's tier and signal is in the expansion
  have hw : ({ e with key := k' } : Want Key) ∈ expand pre ws := by
    simp only [expand, List.mem_flatMap, List.mem_append, List.mem_map, List.mem_singleton] at hmem ⊢
    obtain ⟨w, hw, (⟨k, hk, rfl⟩ | rfl)⟩ := hmem
    · exact ⟨w, hw, Or.inl ⟨k', closed w.key k hk k' hk', rfl⟩⟩
    · exact ⟨_, hw, Or.inl ⟨k', hk', rfl⟩⟩
  obtain ⟨b, hb'⟩ := bestFor_some k' _ _ hw rfl
  have hbk := (bestFor_mem k' _ b hb').2
  refine ⟨b, (mem_queue_iff cap _ b).mpr ⟨?_, ?_, ?_⟩, hbk, ?_⟩
  · rw [hbk]; exact List.mem_map.mpr ⟨_, hw, rfl⟩
  · rw [hbk]; exact hc
  · rw [hbk]; exact hb'
  · exact bestFor_highest k' _ b hb' ({ e with key := k' } : Want Key) hw rfl

/-! ### Rounds: every round moves -/

/-- What a round did. -/
inductive Round (Key : Type) where
  /-- one page or chunk of this key came -/
  | moved (k : Key)
  /-- nothing is left to fetch or send -/
  | done
  /-- the first key with work left got nothing from any source: the stall alarm -/
  | stalled (k : Key)
  deriving DecidableEq, Repr

/-- The first key in order with work left. -/
def firstLeft (left : Key → Nat) : List Key → Option Key
  | [] => none
  | k :: ks => if 0 < left k then some k else firstLeft left ks

/-- One round over the device's own unsent uploads and then the queue's keys: the first with work left is served, a page
at a time. `got k` says whether a source delivered a page of it. -/
def round (left : Key → Nat) (uploads keys : List Key) (got : Key → Bool) : Round Key × (Key → Nat) :=
  match firstLeft left (uploads ++ keys) with
  | none => (.done, left)
  | some k => if got k then (.moved k, fun x => if x = k then left x - 1 else left x) else (.stalled k, left)

/-- What is left in all: the progress measure. -/
def measure (left : Key → Nat) (ks : List Key) : Nat := (ks.map left).sum

omit [DecidableEq Key] in
theorem firstLeft_spec (left : Key → Nat) : ∀ (ks : List Key) (k : Key), firstLeft left ks = some k →
    k ∈ ks ∧ 0 < left k
  | [], _, h => by simp [firstLeft] at h
  | a :: ks, k, h => by
    simp only [firstLeft] at h
    split at h
    · cases h; exact ⟨by simp, by assumption⟩
    · have := firstLeft_spec left ks k h; exact ⟨List.mem_cons_of_mem _ this.1, this.2⟩

omit [DecidableEq Key] in
theorem firstLeft_none (left : Key → Nat) : ∀ ks : List Key, firstLeft left ks = none → ∀ k ∈ ks, left k = 0
  | [], _, _, hk => by simp at hk
  | a :: ks, h, k, hk => by
    simp only [firstLeft] at h
    split at h
    · cases h
    · rename_i ha
      cases List.mem_cons.mp hk with
      | inl e => subst e; omega
      | inr e => exact firstLeft_none left ks h k e

theorem measure_drop (left : Key → Nat) (k : Key) (hk : 0 < left k) :
    ∀ ks : List Key, k ∈ ks → ks.Nodup →
      measure (fun x => if x = k then left x - 1 else left x) ks < measure left ks
  | [], h, _ => by simp at h
  | a :: ks, h, hn => by
    have ⟨hna, hnd⟩ := List.nodup_cons.mp hn
    simp only [measure, List.map_cons, List.sum_cons]
    by_cases hak : a = k
    · subst hak
      have : (ks.map fun x => if x = a then left x - 1 else left x) = ks.map left := by
        apply List.map_congr_left
        intro x hx
        have : x ≠ a := fun e => hna (e ▸ hx)
        simp [this]
      rw [this]; simp; omega
    · have hks : k ∈ ks := by cases List.mem_cons.mp h with
        | inl e => exact absurd e.symm hak
        | inr e => exact e
      have := measure_drop left k hk ks hks hnd
      simp only [measure] at this
      simp [hak]; omega

/-- **Every round moves:** it moves the measure down, or nothing is left, or it raises the stall alarm on a key with
work left, changing nothing. -/
theorem round_moves (left : Key → Nat) (uploads keys : List Key) (got : Key → Bool)
    (hn : (uploads ++ keys).Nodup) :
    (∀ k left', round left uploads keys got = (.moved k, left') →
        measure left' (uploads ++ keys) < measure left (uploads ++ keys)) ∧
    (∀ left', round left uploads keys got = (.done, left') → ∀ k ∈ uploads ++ keys, left k = 0) ∧
    (∀ k left', round left uploads keys got = (.stalled k, left') →
        left' = left ∧ k ∈ uploads ++ keys ∧ 0 < left k) := by
  unfold round
  cases hf : firstLeft left (uploads ++ keys) with
  | none =>
    refine ⟨?_, ?_, ?_⟩
    · intro k l' h; simp at h
    · intro _ _; exact firstLeft_none left _ hf
    · intro k l' h; simp at h
  | some k =>
    have ⟨hm, hl⟩ := firstLeft_spec left _ k hf
    refine ⟨?_, ?_, ?_⟩
    · intro k' l' h
      simp only at h
      split at h
      · simp only [Prod.mk.injEq, Round.moved.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        exact measure_drop left k hl _ hm hn
      · simp at h
    · intro l' h
      simp only at h
      split at h <;> simp at h
    · intro k' l' h
      simp only at h
      split at h
      · simp at h
      · simp only [Prod.mk.injEq, Round.stalled.injEq] at h
        obtain ⟨rfl, rfl⟩ := h
        exact ⟨rfl, hm, hl⟩

omit [DecidableEq Key] in
/-- **Uploads first:** while any upload has work left, the round serves an upload. -/
theorem uploads_first (left : Key → Nat) (uploads keys : List Key)
    (u : Key) (hu : u ∈ uploads) (hl : 0 < left u) :
    ∃ k ∈ uploads, firstLeft left (uploads ++ keys) = some k := by
  induction uploads with
  | nil => simp at hu
  | cons a us ih =>
    simp only [List.cons_append, firstLeft]
    split
    · exact ⟨a, by simp, rfl⟩
    · rename_i ha
      cases List.mem_cons.mp hu with
      | inl e => subst e; exact absurd hl ha
      | inr e => obtain ⟨k, hk, h⟩ := ih e; exact ⟨k, List.mem_cons_of_mem _ hk, h⟩

/-! ### Budgets and eviction: `now` is never evicted -/

/-- What a device keeps of a key: its tier, its bytes, when it was last used. -/
structure Kept (Key : Type) where
  key : Key
  tier : Tier
  bytes : Nat
  used : Nat
  deriving DecidableEq, Repr

/-- Keep in order while the budget lasts. -/
def fit (budget : Nat) : Nat → List (Kept Key) → List (Kept Key)
  | _, [] => []
  | spent, e :: es => if spent + e.bytes ≤ budget then e :: fit budget (spent + e.bytes) es else fit budget spent es

def total (es : List (Kept Key)) : Nat := (es.map (·.bytes)).sum

/-- Over budget, entries go lowest tier first, then least recently used. Every `now` entry stays. -/
def evict (budget : Nat) (es : List (Kept Key)) : List (Kept Key) :=
  let now := es.filter (·.tier.isNow)
  let rest := (es.filter (! ·.tier.isNow)).mergeSort fun a b =>
    a.tier.rank < b.tier.rank || (a.tier.rank == b.tier.rank && b.used ≤ a.used)
  now ++ fit budget (total now) rest

omit [DecidableEq Key] in
theorem now_never_evicted (budget : Nat) (es : List (Kept Key)) (e : Kept Key) (he : e ∈ es)
    (hn : e.tier.isNow = true) : e ∈ evict budget es := by
  simp only [evict]
  exact List.mem_append_left _ (List.mem_filter.mpr ⟨he, hn⟩)

omit [DecidableEq Key] in
theorem fit_total (budget : Nat) : ∀ (spent : Nat) (es : List (Kept Key)), spent ≤ budget →
    spent + total (fit budget spent es) ≤ budget
  | spent, [], h => by simp [fit, total]; exact h
  | spent, e :: es, h => by
    simp only [fit]
    split
    · rename_i hb
      have := fit_total budget (spent + e.bytes) es hb
      simp only [total, List.map_cons, List.sum_cons] at this ⊢
      omega
    · exact fit_total budget spent es h

omit [DecidableEq Key] in
theorem mem_fit (budget : Nat) : ∀ (spent : Nat) (es : List (Kept Key)) (e : Kept Key), e ∈ fit budget spent es → e ∈ es
  | _, [], _, h => by simp [fit] at h
  | spent, a :: es, e, h => by
    simp only [fit] at h
    split at h
    · cases List.mem_cons.mp h with
      | inl h => exact h ▸ List.mem_cons_self
      | inr h => exact List.mem_cons_of_mem _ (mem_fit budget _ es e h)
    · exact List.mem_cons_of_mem _ (mem_fit budget _ es e h)

omit [DecidableEq Key] in
/-- Eviction only drops, and when `now` alone fits the budget, what is kept fits it too. -/
theorem evict_fits (budget : Nat) (es : List (Kept Key)) :
    (∀ e ∈ evict budget es, e ∈ es) ∧
      (total (es.filter (·.tier.isNow)) ≤ budget → total (evict budget es) ≤ budget) := by
  constructor
  · intro e he
    simp only [evict, List.mem_append] at he
    rcases he with h | h
    · exact (List.mem_filter.mp h).1
    · exact (List.mem_filter.mp (List.mem_mergeSort.mp (mem_fit budget _ _ e h))).1
  · intro h
    have := fit_total budget _ ((es.filter (! ·.tier.isNow)).mergeSort fun a b =>
      a.tier.rank < b.tier.rank || (a.tier.rank == b.tier.rank && b.used ≤ a.used)) h
    simp only [evict, total, List.map_append, List.sum_append] at this ⊢
    exact this

end Aven.DB.Engine
