import AvenDB.Logs
import AvenDB.Lemmas

/-!
# Sync lemmas

Helpers for T11, T12, T13 and T19 in `Theorems.lean`. The replay order is a total preorder whose ties are edits with the
same id, so sorting any arrangement of the same edits, with distinct ids, gives one list (`order_perm`). A peer's
answer is made of three filters of its edits, one for items, one for auth edits and one for vault edits, and no edit is
in two of them. The closed part of a log holds the whole past of each of its edits, so everything a responder finds
below an asker's frontier is something the asker holds (`reaches_held`).
-/

namespace AvenDB

/-! ## One order -/

/-- `Edit.before` compares depth, then rank, then id: the order of triples of numbers (`omega` sees through numbers,
    not through the names `EditId` gives them). -/
private def lexLe (d₁ r₁ i₁ d₂ r₂ i₂ : Nat) : Prop := d₁ < d₂ ∨ d₁ = d₂ ∧ (r₁ < r₂ ∨ r₁ = r₂ ∧ i₁ ≤ i₂)

private theorem before_iff (a b : Edit) : a.before b = true ↔ lexLe a.depth a.rank a.id b.depth b.rank b.id := by
  simp only [Edit.before, Bool.or_eq_true, Bool.and_eq_true, decide_eq_true_eq, beq_iff_eq, lexLe]

theorem before_total (a b : Edit) : (a.before b || b.before a) = true := by
  rw [Bool.or_eq_true, before_iff, before_iff]
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂, lexLe d₁ r₁ i₁ d₂ r₂ i₂ ∨ lexLe d₂ r₂ i₂ d₁ r₁ i₁ := by intros; simp only [lexLe]; omega
  exact this ..

theorem before_trans (a b c : Edit) (h₁ : a.before b = true) (h₂ : b.before c = true) : a.before c = true := by
  rw [before_iff] at *
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂ d₃ r₃ i₃, lexLe d₁ r₁ i₁ d₂ r₂ i₂ → lexLe d₂ r₂ i₂ d₃ r₃ i₃ → lexLe d₁ r₁ i₁ d₃ r₃ i₃ := by
    intros; simp only [lexLe] at *; omega
  exact this _ _ _ _ _ _ _ _ _ h₁ h₂

theorem before_antisymm {a b : Edit} (h₁ : a.before b = true) (h₂ : b.before a = true) : a.id = b.id := by
  rw [before_iff] at *
  have : ∀ d₁ r₁ i₁ d₂ r₂ i₂ : Nat, lexLe d₁ r₁ i₁ d₂ r₂ i₂ → lexLe d₂ r₂ i₂ d₁ r₁ i₁ → i₁ = i₂ := by
    intros; simp only [lexLe] at *; omega
  exact this _ _ _ _ _ _ h₁ h₂

/-- Among edits with distinct ids, an id names one edit. -/
theorem eq_of_id_eq {edits : List Edit} (h : (edits.map Edit.id).Nodup) {a b : Edit} (ha : a ∈ edits) (hb : b ∈ edits)
    (hid : a.id = b.id) : a = b := by
  have hp : edits.Pairwise (fun x y => x.id ≠ y.id) := List.pairwise_map.mp h
  exact List.Pairwise.forall_of_forall_of_flip (R := fun x y => x.id = y.id → x = y) (fun _ _ _ => rfl)
    (hp.imp fun hne heq => absurd heq hne) (hp.imp fun hne heq => absurd heq.symm hne) ha hb hid

/-- Sorting two arrangements of the same edits with distinct ids by `Edit.before` gives the same list. -/
theorem mergeSort_before_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂)
    (hids : (edits₁.map Edit.id).Nodup) : edits₁.mergeSort Edit.before = edits₂.mergeSort Edit.before := by
  apply List.Perm.eq_of_pairwise (le := fun a b => Edit.before a b = true)
  · intro a b ha hb hab hba
    exact eq_of_id_eq hids (List.mem_mergeSort.mp ha) (hperm.mem_iff.mpr (List.mem_mergeSort.mp hb))
      (before_antisymm hab hba)
  · exact List.pairwise_mergeSort before_trans before_total _
  · exact List.pairwise_mergeSort before_trans before_total _
  · exact (List.mergeSort_perm _ _).trans (hperm.trans (List.mergeSort_perm _ _).symm)

/-- Whether an edit is malformed depends only on which edits are held, not on their arrangement. -/
theorem wellFormed_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) :
    wellFormed edits₁ = wellFormed edits₂ := by
  funext edit
  simp only [wellFormed]
  congr 1
  funext p
  exact Bool.eq_iff_iff.mpr (by simp only [List.all_eq_true]; exact ⟨fun h q hq => h q (hperm.mem_iff.mpr hq),
    fun h q hq => h q (hperm.mem_iff.mp hq)⟩)

theorem order_perm {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    order edits₁ = order edits₂ := by
  unfold order
  rw [wellFormed_perm hperm]
  exact mergeSort_before_perm (hperm.filter _) (hids.sublist ((List.filter_sublist).map _))

/-! ## What a peer sends -/

/-- A write or a checkpoint is no auth edit and no vault edit. -/
theorem item_not_auth {edit : Edit} {x : SpaceId × EntryId} (h : edit.item? = some x) (edits : List Edit) :
    edit.authScope? edits = none ∧ edit.vaultOf? = none ∧ edit.isRemoval = false := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents⟩
  cases action <;> simp_all [Edit.item?, Edit.authScope?, Edit.vaultOf?, Edit.isRemoval, Action.keep?]

/-- A vault edit is no auth edit. -/
theorem vault_not_auth {edit : Edit} {v : VaultId} (h : edit.vaultOf? = some v) (edits : List Edit) :
    edit.authScope? edits = none ∧ edit.item? = none := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents⟩
  cases action <;> simp_all [Edit.item?, Edit.authScope?, Edit.vaultOf?]
  case keys k _ _ _ => cases k <;> simp_all [KeyScope.scope?]

/-- A revocation that takes a device's cap is no write or checkpoint. -/
theorem takesFrom_not_item {st : State} {edits : List Edit} {d : SignerId} {edit : Edit}
    (h : edit.takesFrom st edits d = true) : edit.item? = none := by
  rcases edit with ⟨id, depth, author, cosigners, action, parents⟩
  cases action <;> simp_all [Edit.item?, Edit.takesFrom]

theorem mem_respond {edits : List Edit} {d : SignerId} {edit : Edit} (h : edit ∈ respond edits d) :
    edit ∈ edits ∧
    ((∃ sp e, edit.item? = some (sp, e) ∧ mayReceive (view edits) d sp e = true) ∨
     ((∃ sc, edit.authScope? edits = some sc ∧ reaches (view edits) d sc = true) ∨
       edit.takesFrom (view edits) edits d = true) ∨
     (∃ v, edit.vaultOf? = some v)) := by
  simp only [respond, List.mem_append, List.mem_filter] at h
  rcases h with (⟨hm, hw⟩ | ⟨hm, ha⟩) | ⟨hm, hv⟩
  · refine ⟨hm, .inl ?_⟩
    split at hw
    · next sp e he => exact ⟨sp, e, he, hw⟩
    · simp at hw
  · refine ⟨hm, .inr (.inl ?_)⟩
    simp only [Bool.or_eq_true] at ha
    rcases ha with ha | ha
    · split at ha
      · next sc hsc => exact .inl ⟨sc, hsc, ha⟩
      · simp at ha
    · exact .inr ha
  · refine ⟨hm, .inr (.inr ?_)⟩
    split at hv
    · next v hv' => exact ⟨v, hv'⟩
    · simp at hv

theorem respond_sub {edits : List Edit} {d : SignerId} {edit : Edit} (h : edit ∈ respond edits d) : edit ∈ edits :=
  (mem_respond h).1

theorem respondSince_sub {edits : List Edit} {d : SignerId} {fr : Ask} {edit : Edit}
    (h : edit ∈ respondSince edits d fr) : edit ∈ respond edits d :=
  (List.mem_filter.mp h).1

/-- A peer sends every write and checkpoint of an item the device may receive. -/
theorem item_in_respond {edits : List Edit} {d : SignerId} {edit : Edit} {sp : SpaceId} {e : EntryId}
    (hm : edit ∈ edits) (hi : edit.item? = some (sp, e)) (hr : mayReceive (view edits) d sp e = true) :
    edit ∈ respond edits d := by
  simp only [respond, List.mem_append, List.mem_filter]
  exact .inl (.inl ⟨hm, by rw [hi]; exact hr⟩)

/-! ## Frontiers -/

section
variable (lg : Edit → Option LogId)

/-- Id `i` is in `F`, or a parent of an edit of `os` whose id is reached: what `ancestorsN` collects. -/
inductive Reaches (os : List Edit) (F : List EditId) : EditId → Prop where
  | base {i : EditId} : i ∈ F → Reaches os F i
  | step {y : Edit} {p : EditId} : y ∈ os → Reaches os F y.id → p ∈ y.parents → Reaches os F p

theorem reaches_step {os : List Edit} {F : List EditId} {i : EditId} (h : Reaches os (ancestorsStep os F) i) :
    Reaches os F i := by
  induction h with
  | base hi =>
    simp only [ancestorsStep, List.mem_append, List.mem_filter, List.mem_flatMap] at hi
    rcases hi with hi | ⟨⟨y, ⟨hy, hyF⟩, hp⟩, _⟩
    · exact .base hi
    · exact .step hy (.base (List.contains_iff_mem.mp hyF)) hp
  | step hy _ hp ih => exact .step hy ih hp

theorem reaches_of_ancestorsN {os : List Edit} : ∀ (n : Nat) {F : List EditId} {i : EditId},
    i ∈ ancestorsN os n F → Reaches os F i
  | 0, _, _, h => .base h
  | n + 1, _, _, h => reaches_step (reaches_of_ancestorsN n h)

/-- Each id `closedIds` admits is that of an edit of `os` whose parents were all admitted. -/
def ClosedIds (os : List Edit) (ids : List EditId) : Prop :=
  ∀ i ∈ ids, ∃ o ∈ os, o.id = i ∧ ∀ p ∈ o.parents, p ∈ ids

theorem closedIds_inv {os : List Edit} : ∀ (n : Nat) {ids : List EditId}, ClosedIds os ids →
    ClosedIds os (closedIds os n ids)
  | 0, _, h => h
  | n + 1, ids, h => closedIds_inv n (by
    intro i hi
    simp only [closeStep, List.mem_append, List.mem_map, List.mem_filter, Bool.and_eq_true, List.all_eq_true,
      List.contains_iff_mem] at hi
    rcases hi with hi | ⟨o, ⟨ho, _, hps⟩, rfl⟩
    · obtain ⟨o, ho, hid, hps⟩ := h i hi
      exact ⟨o, ho, hid, fun p hp => List.mem_append_left _ (hps p hp)⟩
    · exact ⟨o, ho, rfl, fun p hp => List.mem_append_left _ (hps p hp)⟩)

theorem closedPart_sub {edits : List Edit} {l : LogId} {a : Edit} (h : a ∈ closedPart lg edits l) :
    a ∈ edits ∧ lg a = some l := by
  simp only [closedPart, inLog, List.mem_filter, beq_iff_eq] at h
  exact ⟨h.1.1, h.1.2⟩

/-- The closed part holds the whole past of each of its edits. -/
theorem closedPart_closed {edits : List Edit} {l : LogId} {a : Edit} (h : a ∈ closedPart lg edits l) :
    ∀ p ∈ a.parents, ∃ b ∈ closedPart lg edits l, b.id = p := by
  intro p hp
  have inv := closedIds_inv (os := inLog lg edits l) (inLog lg edits l).length (ids := []) (by simp [ClosedIds])
  simp only [closedPart, List.mem_filter, Bool.and_eq_true, List.all_eq_true, List.contains_iff_mem] at h ⊢
  obtain ⟨o, ho, hid, hps⟩ := inv p (h.2.2 p hp)
  exact ⟨o, ⟨ho, by rw [hid]; exact h.2.2 p hp, hps⟩, hid⟩

/-- `closedIds` admits an id only after the parents of the edit it names: the order edits were admitted in. -/
def AdmitOrder (os : List Edit) (ids : List EditId) : Prop :=
  ∀ o ∈ os, o.id ∈ ids → ∀ p ∈ o.parents, p ∈ ids ∧ ids.idxOf p < ids.idxOf o.id

theorem closeStep_order {os : List Edit} (hu : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b) {ids : List EditId}
    (h : AdmitOrder os ids) : AdmitOrder os (closeStep os ids) := by
  intro o ho hin p hp
  by_cases hold : o.id ∈ ids
  · obtain ⟨hpi, hlt⟩ := h o ho hold p hp
    refine ⟨List.mem_append_left _ hpi, ?_⟩
    rw [closeStep, List.idxOf_append, List.idxOf_append, ite_eq_left hpi, ite_eq_left hold]
    exact hlt
  · -- admitted in this round: the edit with its id, which is `o`, had its parents in
    simp only [closeStep, List.mem_append, List.mem_map, List.mem_filter, Bool.and_eq_true, List.all_eq_true,
      List.contains_iff_mem] at hin
    rcases hin with hin | ⟨o', ⟨ho', _, hps⟩, hid⟩
    · exact absurd hin hold
    · obtain rfl := hu o' ho' o ho hid
      have hpi := hps p hp
      refine ⟨List.mem_append_left _ hpi, ?_⟩
      rw [closeStep, List.idxOf_append, List.idxOf_append, ite_eq_left hpi, ite_eq_right hold]
      exact Nat.lt_of_lt_of_le (List.idxOf_lt_length_of_mem hpi) (Nat.le_add_left _ _)

theorem closedIds_order {os : List Edit} (hu : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b) :
    ∀ (n : Nat) {ids : List EditId}, AdmitOrder os ids → AdmitOrder os (closedIds os n ids)
  | 0, _, h => h
  | n + 1, _, h => closedIds_order hu n (closeStep_order hu h)

/-- Every edit of a log's closed part is at or below its frontier, when no two edits of the log share an id. -/
theorem closed_reaches_frontier {edits : List Edit} {l : LogId}
    (hu : ∀ a ∈ edits, ∀ b ∈ edits, a.id = b.id → a = b) {x : Edit} (hx : x ∈ closedPart lg edits l) :
    Reaches (inLog lg edits l) (frontier lg edits l) x.id := by
  let os := inLog lg edits l
  let ids := closedIds os os.length []
  have hu' : ∀ a ∈ os, ∀ b ∈ os, a.id = b.id → a = b :=
    fun a ha b hb => hu a (List.mem_filter.mp ha).1 b (List.mem_filter.mp hb).1
  have hord : AdmitOrder os ids := closedIds_order hu' _ (by simp [AdmitOrder])
  have hin : ∀ y ∈ closedPart lg edits l, y ∈ os ∧ y.id ∈ ids := by
    intro y hy
    simp only [closedPart, List.mem_filter, Bool.and_eq_true, List.contains_iff_mem] at hy
    exact ⟨hy.1, hy.2.1⟩
  -- from each edit, up to an edit that builds on it, until one that nothing builds on: one of the frontier
  suffices H : ∀ n, ∀ x ∈ closedPart lg edits l, ids.length - ids.idxOf x.id ≤ n →
      Reaches os (frontier lg edits l) x.id from H _ x hx (Nat.le_refl _)
  intro n
  induction n with
  | zero =>
    intro x hx hn
    have := List.idxOf_lt_length_of_mem (hin x hx).2
    omega
  | succ n ih =>
    intro x hx hn
    by_cases hc : (closedPart lg edits l).any (·.parents.contains x.id) = true
    · obtain ⟨y, hy, hyp⟩ := List.any_eq_true.mp hc
      have hyp := List.contains_iff_mem.mp hyp
      have hlt := (hord y (hin y hy).1 (hin y hy).2 x.id hyp).2
      have hyl := List.idxOf_lt_length_of_mem (hin y hy).2
      exact .step (hin y hy).1 (ih y hy (by omega)) hyp
    · refine .base ?_
      simp only [frontier, List.mem_mergeSort, List.mem_map, List.mem_filter]
      exact ⟨x, ⟨hx, by simpa using hc⟩, rfl⟩

theorem frontier_mem {edits : List Edit} {l : LogId} {i : EditId} (h : i ∈ frontier lg edits l) :
    ∃ a ∈ closedPart lg edits l, a.id = i := by
  simp only [frontier, List.mem_mergeSort, List.mem_map, List.mem_filter] at h
  obtain ⟨a, ⟨ha, _⟩, rfl⟩ := h
  exact ⟨a, ha, rfl⟩

theorem levels_mem {os : List Edit} : ∀ (n : Nat) {seen lv x : List EditId}, x ∈ levels os n seen lv →
    ∀ i ∈ x, i ∈ lv ∨ ∃ o ∈ os, o.id = i
  | 0, _, _, _, h => by simp [levels] at h
  | n + 1, seen, lv, x, h => by
    intro i hi
    simp only [levels] at h
    split at h
    · simp at h
    · rcases List.mem_cons.mp h with rfl | h
      · exact .inl hi
      · rcases levels_mem n h i hi with hs | ho
        · simp only [stepBack, List.mem_map, List.mem_filter] at hs
          obtain ⟨o, ⟨ho, _⟩, rfl⟩ := hs
          exact .inr ⟨o, ho, rfl⟩
        · exact .inr ho

theorem pick_mem : ∀ (k : Nat) {ls : List (List EditId)} {i : EditId}, i ∈ pick k ls → ∃ lv ∈ ls, i ∈ lv
  | _, [], _, h => by simp [pick] at h
  | _, [lv], _, h => ⟨lv, List.mem_singleton_self _, h⟩
  | k, lv :: lv' :: rest, i, h => by
    simp only [pick, List.mem_append] at h
    rcases h with h | h
    · split at h
      · exact ⟨lv, List.mem_cons_self .., h⟩
      · simp at h
    · obtain ⟨x, hx, hix⟩ := pick_mem (k + 1) h
      exact ⟨x, List.mem_cons_of_mem _ hx, hix⟩

/-- Every edit a device sends of a log when it asks is one of its closed part. -/
theorem haves_mem {edits : List Edit} {l : LogId} {i : EditId} (h : i ∈ haves lg edits l) :
    ∃ a ∈ closedPart lg edits l, a.id = i := by
  simp only [haves, List.mem_mergeSort, List.mem_eraseDups] at h
  obtain ⟨lv, hlv, hi⟩ := pick_mem 0 h
  rcases levels_mem _ hlv i hi with hf | ho
  · exact frontier_mem lg hf
  · exact ho

end

/-- Whatever a responder holding `R` reaches from the edits `F` an asker sent of a log, all of the asker's closed part,
    walking its own copy of the log, is an edit of the asker's closed part: an id both hold names one edit, and the
    closed part holds the past of each of its edits. -/
theorem reaches_held (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) {F : List EditId}
    (hF : ∀ i ∈ F, ∃ a ∈ closedPart lgA A l, a.id = i) {i : EditId}
    (h : Reaches (inLog lgR R l) F i) : ∃ a ∈ closedPart lgA A l, a.id = i := by
  induction h with
  | base hi => exact hF _ hi
  | step hy _ hp ih =>
    obtain ⟨a, ha, haid⟩ := ih
    have := hid a (closedPart_sub lgA ha).1 _ (List.mem_filter.mp hy).1 haid
    subst this
    exact closedPart_closed lgA ha _ hp

/-- Frontier sync loses nothing, log by log: every edit of the responder's copy of log `l` is one the asker holds, or
    lies beyond the edits `F` the asker sent, all of its closed part. The asker and the responder may place edits in
    logs differently (`lgA`, `lgR`). -/
theorem frontier_sync (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) {F : List EditId}
    (hF : ∀ i ∈ F, ∃ a ∈ closedPart lgA A l, a.id = i) {x : Edit} (hx : x ∈ inLog lgR R l) :
    x ∈ A ∨ x ∈ missing lgR R l F := by
  by_cases hc : (ancestors lgR R l F).contains x.id = true
  · left
    have hr : Reaches (inLog lgR R l) F x.id := reaches_of_ancestorsN _ (List.contains_iff_mem.mp hc)
    obtain ⟨a, ha, haid⟩ := reaches_held lgA lgR hid hF hr
    have := hid a (closedPart_sub lgA ha).1 x (List.mem_filter.mp hx).1 haid
    exact this ▸ (closedPart_sub lgA ha).1
  · right
    simp only [missing, List.mem_filter]
    exact ⟨hx, by simpa using hc⟩

theorem loose_mem {edits : List Edit} {i : EditId} (h : i ∈ loose edits) : ∃ a ∈ edits, a.id = i := by
  simp only [loose, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter] at h
  obtain ⟨a, ⟨ha, _⟩, rfl⟩ := h
  exact ⟨a, ha, rfl⟩

/-- What a device sends when it asks is so of the edits `A` it holds: each edit it names of a log is one of the log's
    closed part, and each loose edit one it holds. -/
def Truthful (A : List Edit) (a : Ask) : Prop :=
  (∀ l, ∀ i ∈ a.haves l, ∃ x ∈ closedPart (Edit.log? A) A l, x.id = i) ∧ ∀ i ∈ a.loose, ∃ x ∈ A, x.id = i

theorem asks_truthful (A : List Edit) : Truthful A (asks A) :=
  ⟨fun _ _ hi => haves_mem _ hi, fun _ hi => loose_mem hi⟩

theorem frontiers_truthful (A : List Edit) : Truthful A ⟨frontiers A, []⟩ :=
  ⟨fun _ _ hi => frontier_mem _ hi, fun _ hi => nomatch hi⟩

/-- What a device holding `A` is sent when it asks truthfully covers whatever of the full answer it lacks. -/
theorem respondSince_complete {A R : List Edit} {d : SignerId} (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b)
    {a : Ask} (ha : Truthful A a) {edit : Edit} (h : edit ∈ respond R d) : edit ∈ A ∨ edit ∈ respondSince R d a := by
  by_cases hw : a.loose.contains edit.id = true
  · left
    obtain ⟨x, hx, hxid⟩ := ha.2 _ (List.contains_iff_mem.mp hw)
    exact (hid x hx edit (respond_sub h) hxid) ▸ hx
  · have hn : edit.id ∉ a.loose := fun hm => hw (List.contains_iff_mem.mpr hm)
    cases hl : edit.log? R with
    | none =>
      right
      simp only [respondSince, List.mem_filter, hl]
      exact ⟨h, by simpa using hn⟩
    | some l =>
      have hx : edit ∈ inLog (Edit.log? R) R l := List.mem_filter.mpr ⟨respond_sub h, by simp [hl]⟩
      rcases frontier_sync (Edit.log? A) (Edit.log? R) hid (ha.1 l) hx with hA | hm
      · exact .inl hA
      · right
        simp only [respondSince, List.mem_filter, hl]
        exact ⟨h, by simpa [missing, hn] using (List.mem_filter.mp hm).2⟩

/-- One hash per log is enough: a device whose frontier of a log is the peer's holds the peer's whole closed part of
    it, in its own closed part. -/
theorem same_frontier_held (lgA lgR : Edit → Option LogId) {A R : List Edit} {l : LogId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (hu : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b)
    (hf : frontier lgA A l = frontier lgR R l) {x : Edit} (hx : x ∈ closedPart lgR R l) :
    x ∈ closedPart lgA A l := by
  have hr := closed_reaches_frontier lgR hu hx
  rw [← hf] at hr
  obtain ⟨a, ha, haid⟩ := reaches_held lgA lgR hid (fun _ hi => frontier_mem lgA hi) hr
  obtain rfl := hid a (closedPart_sub lgA ha).1 x (closedPart_sub lgR hx).1 haid
  exact ha

theorem mem_receive {edits incoming : List Edit} {edit : Edit} :
    edit ∈ receive edits incoming ↔ edit ∈ edits ∨ edit ∈ incoming := by
  simp only [receive, List.mem_append, List.mem_filter]
  constructor
  · rintro (h | ⟨h, _⟩)
    · exact .inl h
    · exact .inr h
  · rintro (h | h)
    · exact .inl h
    · by_cases h' : edit ∈ edits
      · exact .inl h'
      · exact .inr ⟨h, by simpa using h'⟩

/-- After a device holding `A` asked a peer holding `R` (`asks`), it holds a write or checkpoint of an item it may
    receive exactly when one of them held it. -/
theorem item_after_sync {A R : List Edit} {d : SignerId} {sp : SpaceId} {e : EntryId}
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (hr : mayReceive (view R) d sp e = true) {edit : Edit}
    (hop : edit.item? = some (sp, e)) : edit ∈ receive A (respondSince R d (asks A)) ↔ edit ∈ A ∨ edit ∈ R := by
  rw [mem_receive]
  constructor
  · rintro (h | h)
    · exact .inl h
    · exact .inr (respond_sub (respondSince_sub h))
  · rintro (h | h)
    · exact .inl h
    · exact respondSince_complete hid (asks_truthful A) (item_in_respond h hop hr)

end AvenDB
