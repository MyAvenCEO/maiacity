import AvenDB.Step
import AvenDB.Doc

/-!
# Proposals, write by write

Every write extends one line of its entry's history (`Write.line`): the main line, or a proposal, which a write starts
(`Proposal.new`) from the version its `deps` name. A line's history is its own writes and every write they build on
(`history`), and what a device shows on a line is Loro's content of the updates in that history (`content`). A merge
is a write on a line that also builds on another line's heads; a promote is such a write whose update brings the line
to exactly the other line's content, as `Doc.lean`'s `promote` does.

T10f to T10h tie `Doc.lean`'s merge and promote to the writes. A write on one line leaves every other line as it was,
so main stays unchanged until a write on it merges a proposal (T10f). A merge's history is the union of both lines'
(T10g), so by Loro's convergence it shows `Doc.lean`'s merge of the two, for which T10a to T10c hold. A promote shows
exactly the proposal's content and keeps both histories (T10h, from T10d and T10e).
-/

namespace AvenDB

/-- The writes of entry `(sp, e)` among `ws` that are seeds (`s`), and every write of the entry those build on,
    transitively, in the order of `ws`. Each write comes after what it builds on, so one pass from the end collects
    them. -/
def reach (ws : List Write) (sp : SpaceId) (e : EntryId) (s : Write → Bool) : List Write :=
  ws.foldr (fun w acc =>
    if w.space == sp && w.entry == e && (s w || acc.any (·.deps.contains w.edit)) then w :: acc else acc) []

/-- The history of line `l` of entry `(sp, e)`: the line's own writes and everything they build on. -/
def history (ws : List Write) (sp : SpaceId) (e : EntryId) (l : Option EditId) : List Write :=
  reach ws sp e (·.line == l)

/-- The writes of `h` that no write of `h` builds on. -/
def tips (h : List Write) : List EditId :=
  (h.filter fun w => !h.any (·.deps.contains w.edit)).map (·.edit)

/-- The heads of line `l`: what the next write on it builds on. -/
def heads (ws : List Write) (sp : SpaceId) (e : EntryId) (l : Option EditId) : List EditId :=
  tips (history ws sp e l)

/-- What a device holding the writes `ws` shows on line `l`: Loro's content of the updates in the line's history,
    each named by its write's id. -/
def content (L : Loro) (ws : List Write) (sp : SpaceId) (e : EntryId) (l : Option EditId) : L.Doc :=
  L.materialize ((history ws sp e l).map (·.edit))

/-- The writes come in an order their dependencies respect: no two share an id, and none builds on itself or on one
    after it. Every peer's writes do (`writes_ordered`). -/
def Ordered (ws : List Write) : Prop :=
  (ws.map (·.edit)).Nodup ∧ ws.Pairwise (fun a b => b.edit ∉ a.deps) ∧ ∀ w ∈ ws, w.edit ∉ w.deps

/-! ## Reaching back along the dependencies -/

theorem reach_cons (w : Write) (ws : List Write) (sp : SpaceId) (e : EntryId) (s : Write → Bool) :
    reach (w :: ws) sp e s =
      if w.space == sp && w.entry == e && (s w || (reach ws sp e s).any (·.deps.contains w.edit))
      then w :: reach ws sp e s else reach ws sp e s := rfl

theorem mem_reach_cons {w x : Write} {ws : List Write} {sp : SpaceId} {e : EntryId} {s : Write → Bool} :
    x ∈ reach (w :: ws) sp e s ↔
      (x = w ∧ w.space = sp ∧ w.entry = e ∧ (s w = true ∨ ∃ y ∈ reach ws sp e s, w.edit ∈ y.deps)) ∨
        x ∈ reach ws sp e s := by
  rw [reach_cons]
  split
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, List.any_eq_true, List.contains_iff_mem] at h
    simp only [List.mem_cons]
    constructor
    · rintro (rfl | hx)
      · exact .inl ⟨rfl, h.1.1, h.1.2, h.2⟩
      · exact .inr hx
    · rintro (⟨rfl, -⟩ | hx)
      · exact .inl rfl
      · exact .inr hx
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, List.any_eq_true, List.contains_iff_mem] at h
    constructor
    · exact .inr
    · rintro (⟨rfl, hs, he, hw⟩ | hx)
      · exact absurd ⟨⟨hs, he⟩, hw⟩ h
      · exact hx

/-- What `reach` collects is among the writes, of the entry. -/
theorem mem_reach {x : Write} {ws : List Write} {sp : SpaceId} {e : EntryId} {s : Write → Bool}
    (h : x ∈ reach ws sp e s) : x ∈ ws ∧ x.space = sp ∧ x.entry = e := by
  induction ws with
  | nil => simp [reach] at h
  | cons w ws ih =>
    rcases mem_reach_cons.1 h with ⟨rfl, hs, he, -⟩ | h
    · exact ⟨List.mem_cons_self, hs, he⟩
    · obtain ⟨hx, hs, he⟩ := ih h
      exact ⟨List.mem_cons_of_mem _ hx, hs, he⟩

/-- A write added last is collected only as a seed, and then everything it builds on is too. -/
theorem reach_snoc (ws : List Write) (m : Write) (sp : SpaceId) (e : EntryId) (s : Write → Bool) :
    reach (ws ++ [m]) sp e s =
      if m.space == sp && m.entry == e && s m then reach ws sp e (fun w => s w || m.deps.contains w.edit) ++ [m]
      else reach ws sp e s := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    rw [List.cons_append, reach_cons, ih]
    split
    · rw [reach_cons]
      simp only [List.any_append, List.any_cons, List.any_nil, Bool.or_assoc, Bool.or_comm (m.deps.contains w.edit),
        Bool.false_or]
      split
      · rw [List.cons_append]
      · rfl
    · rfl

/-- More seeds, among the writes, collect more. -/
theorem reach_mono {ws : List Write} {sp : SpaceId} {e : EntryId} {s t : Write → Bool}
    (h : ∀ w ∈ ws, s w = true → t w = true) : ∀ x ∈ reach ws sp e s, x ∈ reach ws sp e t := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    have ih := ih fun x hx => h x (List.mem_cons_of_mem _ hx)
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, hs, he, hw⟩ | hx
    · refine mem_reach_cons.2 (.inl ⟨rfl, hs, he, ?_⟩)
      rcases hw with hw | ⟨y, hy, hd⟩
      · exact .inl (h _ List.mem_cons_self hw)
      · exact .inr ⟨y, ih y hy, hd⟩
    · exact mem_reach_cons.2 (.inr (ih x hx))

/-- What two kinds of seeds collect together is what each collects. -/
theorem reach_or {ws : List Write} {sp : SpaceId} {e : EntryId} {s t : Write → Bool} :
    ∀ x ∈ reach ws sp e (fun w => s w || t w), x ∈ reach ws sp e s ∨ x ∈ reach ws sp e t := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, hs, he, hw⟩ | hx
    · rcases hw with hw | ⟨y, hy, hd⟩
      · rcases Bool.or_eq_true _ _ ▸ hw with hw | hw
        · exact .inl (mem_reach_cons.2 (.inl ⟨rfl, hs, he, .inl hw⟩))
        · exact .inr (mem_reach_cons.2 (.inl ⟨rfl, hs, he, .inl hw⟩))
      · rcases ih y hy with hy | hy
        · exact .inl (mem_reach_cons.2 (.inl ⟨rfl, hs, he, .inr ⟨y, hy, hd⟩⟩))
        · exact .inr (mem_reach_cons.2 (.inl ⟨rfl, hs, he, .inr ⟨y, hy, hd⟩⟩))
    · rcases ih x hx with hx | hx
      · exact .inl (mem_reach_cons.2 (.inr hx))
      · exact .inr (mem_reach_cons.2 (.inr hx))

/-- Seeds that `s` already collects collect nothing more. -/
theorem reach_within {ws : List Write} {sp : SpaceId} {e : EntryId} {s t : Write → Bool}
    (hnd : (ws.map (·.edit)).Nodup)
    (h : ∀ w ∈ ws, w.space = sp → w.entry = e → t w = true → w ∈ reach ws sp e s) :
    ∀ x ∈ reach ws sp e t, x ∈ reach ws sp e s := by
  induction ws with
  | nil => simp [reach]
  | cons w ws ih =>
    rw [List.map_cons, List.nodup_cons] at hnd
    -- a seed among the later writes is collected among them: it isn't `w`, whose id comes once
    have ih := ih hnd.2 fun z hz hs he ht => by
      rcases mem_reach_cons.1 (h z (List.mem_cons_of_mem _ hz) hs he ht) with ⟨rfl, -⟩ | hz'
      · exact absurd (List.mem_map_of_mem hz) hnd.1
      · exact hz'
    intro x hx
    rcases mem_reach_cons.1 hx with ⟨rfl, hs, he, hw⟩ | hx
    · rcases hw with hw | ⟨y, hy, hd⟩
      · exact h _ List.mem_cons_self hs he hw
      · exact mem_reach_cons.2 (.inl ⟨rfl, hs, he, .inr ⟨y, ih y hy, hd⟩⟩)
    · exact mem_reach_cons.2 (.inr (ih x hx))

/-- Two writes with one id are one, where ids come once. -/
theorem eq_of_edit_eq {ws : List Write} (hnd : (ws.map (·.edit)).Nodup) {a b : Write} (ha : a ∈ ws) (hb : b ∈ ws)
    (h : a.edit = b.edit) : a = b := by
  induction ws with
  | nil => simp at ha
  | cons w ws ih =>
    rw [List.map_cons, List.nodup_cons] at hnd
    rw [List.mem_cons] at ha hb
    rcases ha with ha | ha <;> rcases hb with hb | hb
    · exact ha.trans hb.symm
    · exact absurd (by rw [← ha, h]; exact List.mem_map_of_mem hb) hnd.1
    · exact absurd (by rw [← hb, ← h]; exact List.mem_map_of_mem ha) hnd.1
    · exact ih hnd.2 ha hb

theorem mem_tips {h : List Write} {d : EditId} :
    d ∈ tips h ↔ ∃ w ∈ h, (∀ y ∈ h, w.edit ∉ y.deps) ∧ w.edit = d := by
  simp [tips, and_assoc]

/-- The tips of what `s` collects collect it all again: everything there is built on by a tip. -/
theorem reach_tips {ws : List Write} (hord : Ordered ws) {sp : SpaceId} {e : EntryId} {s : Write → Bool}
    (x : Write) :
    x ∈ reach ws sp e (fun w => (tips (reach ws sp e s)).contains w.edit) ↔ x ∈ reach ws sp e s := by
  obtain ⟨hnd, hpw, hself⟩ := hord
  constructor
  · -- each tip is a write `s` collects, the only one with its id
    refine reach_within hnd (fun w hw _ _ ht => ?_) x
    obtain ⟨y, hy, -, hyw⟩ := mem_tips.1 (List.contains_iff_mem.1 ht)
    rwa [eq_of_edit_eq hnd (mem_reach hy).1 hw hyw] at hy
  · revert x
    induction ws with
    | nil => simp [reach]
    | cons w ws ih =>
      rw [List.map_cons, List.nodup_cons] at hnd
      rw [List.pairwise_cons] at hpw
      have ih := ih hnd.2 hpw.2 fun x hx => hself x (List.mem_cons_of_mem _ hx)
      -- a tip of what the later writes collect is a tip of it all: `w` builds on nothing after it
      have hmono : ∀ x ∈ reach ws sp e (fun z => (tips (reach ws sp e s)).contains z.edit),
          x ∈ reach ws sp e (fun z => (tips (reach (w :: ws) sp e s)).contains z.edit) := by
        refine reach_mono fun z _ hz => ?_
        obtain ⟨y, hy, hnot, hyz⟩ := mem_tips.1 (List.contains_iff_mem.1 hz)
        refine List.contains_iff_mem.2 (mem_tips.2 ⟨y, mem_reach_cons.2 (.inr hy), fun u hu => ?_, hyz⟩)
        rcases mem_reach_cons.1 hu with ⟨rfl, -⟩ | hu
        · exact hpw.1 y (mem_reach hy).1
        · exact hnot u hu
      intro x hx
      rcases mem_reach_cons.1 hx with ⟨rfl, hs, he, -⟩ | hx
      · refine mem_reach_cons.2 (.inl ⟨rfl, hs, he, ?_⟩)
        by_cases hb : ∃ y ∈ reach ws sp e s, x.edit ∈ y.deps
        · obtain ⟨y, hy, hd⟩ := hb
          exact .inr ⟨y, hmono y (ih y hy), hd⟩
        · -- nothing after `w` builds on it, nor does `w` itself: `w` is a tip
          refine .inl (List.contains_iff_mem.2 (mem_tips.2 ⟨x, hx, fun u hu hd => ?_, rfl⟩))
          rcases mem_reach_cons.1 hu with ⟨rfl, -⟩ | hu
          · exact hself _ List.mem_cons_self hd
          · exact hb ⟨u, hu, hd⟩
      · exact mem_reach_cons.2 (.inr (hmono x (ih x hx)))

/-! ## T10 for the writes -/

/-- T10f: a write leaves every line it isn't on as it was: main stays unchanged until a write on it merges a proposal.
    -/
theorem T10_other_lines (ws : List Write) (w : Write) (sp : SpaceId) (e : EntryId) (l : Option EditId)
    (h : ¬(w.space = sp ∧ w.entry = e ∧ w.line = l)) : history (ws ++ [w]) sp e l = history ws sp e l := by
  unfold history
  rw [reach_snoc]
  split
  · rename_i hc
    simp only [Bool.and_eq_true, beq_iff_eq] at hc
    exact absurd ⟨hc.1.1, hc.1.2, hc.2⟩ h
  · rfl

/-- T10g: a merge, a write on line `l` that builds on the heads of `l` and of `l'`, makes `l`'s history the union of
    both lines' histories and itself: no write of either is lost, and nothing else comes in. -/
theorem T10_merge_union {ws : List Write} (hord : Ordered ws) {m : Write} {sp : SpaceId} {e : EntryId}
    {l l' : Option EditId} (hm : m.space = sp ∧ m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws sp e l ∨ d ∈ heads ws sp e l') (x : Write) :
    x ∈ history (ws ++ [m]) sp e l ↔ x ∈ history ws sp e l ∨ x ∈ history ws sp e l' ∨ x = m := by
  have hc : (m.space == sp && m.entry == e && m.line == l) = true := by simp [hm.1, hm.2.1, hm.2.2]
  unfold history
  rw [reach_snoc]
  simp only [hc, ↓reduceIte, List.mem_append, List.mem_singleton]
  have hdep : ∀ w ∈ ws, m.deps.contains w.edit = true →
      ((tips (reach ws sp e (·.line == l))).contains w.edit || (tips (reach ws sp e (·.line == l'))).contains w.edit)
        = true := fun w _ hw => by
    simpa [heads, history, List.contains_iff_mem] using (hdeps w.edit).1 (List.contains_iff_mem.1 hw)
  constructor
  · rintro (hx | rfl)
    · rcases reach_or x hx with hx | hx
      · exact .inl hx
      · rcases reach_or x (reach_mono hdep x hx) with hx | hx
        · exact .inl ((reach_tips hord x).1 hx)
        · exact .inr (.inl ((reach_tips hord x).1 hx))
    · exact .inr (.inr rfl)
  · rintro (hx | hx | rfl)
    · exact .inl (reach_mono (fun _ _ h => by simp [h]) x hx)
    · refine .inl (reach_mono (fun w _ h => ?_) x ((reach_tips hord x).2 hx))
      have : w.edit ∈ heads ws sp e l' := by simpa [heads, history, List.contains_iff_mem] using h
      simp [(hdeps w.edit).2 (.inr this)]
    · exact .inr rfl

/-- T10g, as a device shows it: after the merge, line `l` shows `Doc.lean`'s merge of both lines' histories and the
    merge's own update, so the merge laws T10a to T10c hold for what every device shows. -/
theorem T10_merge_content (L : Loro) {ws : List Write} (hord : Ordered ws) {m : Write} {sp : SpaceId}
    {e : EntryId} {l l' : Option EditId} (hm : m.space = sp ∧ m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws sp e l ∨ d ∈ heads ws sp e l') :
    content L (ws ++ [m]) sp e l =
      L.materialize (merge ((history ws sp e l).map (·.edit)) ((history ws sp e l').map (·.edit)) ++ [m.edit]) := by
  unfold content
  refine L.converges _ _ fun u => ?_
  simp only [List.mem_map, List.mem_append, mem_merge, List.mem_singleton]
  constructor
  · rintro ⟨x, hx, rfl⟩
    rcases (T10_merge_union hord hm hdeps x).1 hx with hx | hx | rfl
    · exact .inl (.inl ⟨x, hx, rfl⟩)
    · exact .inl (.inr ⟨x, hx, rfl⟩)
    · exact .inr rfl
  · rintro ((⟨x, hx, rfl⟩ | ⟨x, hx, rfl⟩) | rfl)
    · exact ⟨x, (T10_merge_union hord hm hdeps x).2 (.inl hx), rfl⟩
    · exact ⟨x, (T10_merge_union hord hm hdeps x).2 (.inr (.inl hx)), rfl⟩
    · exact ⟨m, (T10_merge_union hord hm hdeps m).2 (.inr (.inr rfl)), rfl⟩

/-- T10h: a promote of line `l'` into line `l`, a merge whose update is Loro's revert of the merged history to `l'`'s,
    makes `l` show exactly what `l'` shows (T10d), and keeps the history of both (T10e, from T10g). -/
theorem T10_promote_shows (L : Loro) {ws : List Write} (hord : Ordered ws) {m : Write} {sp : SpaceId}
    {e : EntryId} {l l' : Option EditId} (hm : m.space = sp ∧ m.entry = e ∧ m.line = l)
    (hdeps : ∀ d, d ∈ m.deps ↔ d ∈ heads ws sp e l ∨ d ∈ heads ws sp e l')
    (hrev : m.edit = L.revertTo (merge ((history ws sp e l).map (·.edit)) ((history ws sp e l').map (·.edit)))
      ((history ws sp e l').map (·.edit))) :
    content L (ws ++ [m]) sp e l = content L ws sp e l' := by
  rw [T10_merge_content L hord hm hdeps, hrev]
  exact T10_promote_content L _ _

end AvenDB
