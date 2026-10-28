import AvenDB.TailRuns

/-!
# A late page with moves replays the last edits only

The proof of V4m: a device that receives a page of edits that sort after the place it steps on from (`Tail`), among
them marks that take an entry to another audience (moves), replays only the edits after that place again, from the state
it kept there, rather than every edit it holds, where every new move keeps every write of its entry that stood before
the place (`V4_tail_moves`). A first sync brings a vault's edits in their order, page by page, each page sorting after
the last, and a page of a vault whose entries move between audiences holds moves: each such page replayed every edit
held (2026-10-27, an iPhone's first sync: 16 of 25 replays whole, each because a removal came).

What a move takes away is an entry's audience, which only the writes of that entry read (`apply_narrowTo`): so a new
move after the place hides nothing from an edit before it that writes another entry, nor from a write of its entry it
keeps, and a write of its entry that didn't stand stands nowhere with more hidden (`apply_hide_mono`). The edits before
the place stand as they stood (`runFrom_more_aud`). Which removals `resolve` chooses: those before the place, which say
who may do what or are moves before it, as before (`V4_rewind`), and every move after it, held or new, where the replay
with all of them keeps each standing and is inert, no edit kept out by what a move hides alone (`runFrom_sandwich`).
-/

namespace AvenDB

namespace TailMoves

open Stored Trusted Moves Tails

/-! ## Audiences narrowed that an edit doesn't read -/

/-- With audiences narrowed that are each narrowed already or of another entry, a share reaches an entry only where it
    reached it before. -/
theorem inAudience_setNarrow_other (st : State) {n n' : List (EntryId × Audience)} (en : Entry)
    (hn : ∀ x ∈ n', x ∈ n ∨ x.1 ≠ en.id) (cp : Share) (h : inAudience (setNarrow st n) cp en = true) :
    inAudience (setNarrow st n') cp en = true := by
  simp only [inAudience, setNarrow, Bool.and_eq_true, Bool.or_eq_true, List.all_eq_true] at h ⊢
  rcases h with ⟨h1, h2 | ⟨h2, h3⟩⟩
  · exact ⟨h1, .inl h2⟩
  · refine ⟨h1, .inr ⟨h2, fun x hx => ?_⟩⟩
    rcases hn x hx with hx' | hx'
    · exact h3 x hx'
    · simp [hx']

theorem mayWrite_setNarrow_other (st : State) {n n' : List (EntryId × Audience)} (en : Entry)
    (hn : ∀ x ∈ n', x ∈ n ∨ x.1 ≠ en.id) (a : VaultId) (h : mayWrite (setNarrow st n) a en = true) :
    mayWrite (setNarrow st n') a en = true := by
  simp only [mayWrite, holdsShare_setNarrow, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with h | ⟨cp, hcp, hh, hi⟩
  · exact .inl h
  · exact .inr ⟨cp, hcp, hh, inAudience_setNarrow_other st en hn cp hi⟩

/-- An edit accepted with some audiences narrowed is accepted with them and others narrowed that it doesn't write. -/
theorem apply_setNarrow_other (st : State) {n n' : List (EntryId × Audience)} (edit : Edit)
    (hn : ∀ x ∈ n', x ∈ n ∨ writesEntry edit x.1 = false)
    (h : ok (apply (setNarrow st n) edit) = some ()) : ok (apply (setNarrow st n') edit) = some () := by
  by_cases ht : edit.action.isTrust = true
  · rwa [ok_trust, ← apply_trust _ _ ht, setNarrow_trust, ← setNarrow_trust st n, apply_trust _ _ ht, ← ok_trust]
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | write v x actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    simp only [apply, writes_setNarrow, actsVia_setNarrow, entry?_setNarrow, born_setNarrow,
      vault?_setNarrow, audienceOk_setNarrow, mayCreate_setNarrow, ok_ite] at h ⊢
    cases create with
    | some p => obtain ⟨x1, hdr⟩ := p; simpa only [ok_ite, ok_some] using h
    | none =>
      simp only at h ⊢
      cases hen : st.entry? x with
      | none => rw [hen] at h; simp [ok] at h
      | some en =>
        rw [hen] at h
        simp only [ok_ite] at h ⊢
        have hid : en.id = x := entry?_id hen
        have hn' : ∀ y ∈ n', y ∈ n ∨ y.1 ≠ en.id := fun y hy => by
          rcases hn y hy with h | h
          · exact .inl h
          · right; rw [hid]; intro he; simp [writesEntry, he] at h
        cases hm : mayWrite (setNarrow st n) actor en
        · simp [hm] at h
        · rw [mayWrite_setNarrow_other st en hn' actor hm]
          rw [hm] at h
          rw [← h]
          cases en.stayAudience stay with
          | none => rfl
          | some _ => simp only [ok_ite]; split <;> rfl
  | mark v x caps wants keep via =>
    simp only [apply, entry?_setNarrow, actsVia_setNarrow, audienceOk_setNarrow, wantsOk_setNarrow,
      wantsOf_setNarrow] at h ⊢
    cases hen : st.entry? x with
    | none => rw [hen] at h; exact h
    | some en =>
      rw [hen] at h
      cases caps <;> cases wants <;> simp only [ok_ite, ok_some] at h ⊢ <;> exact h
  | keys secret to' pub =>
    simp only [apply, mayBox_setNarrow, seals_setNarrow, published_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | checkpoint v c =>
    simp only [apply, vault?_setNarrow, approves_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | wraps x ws =>
    simp only [apply, wrapOk_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | snapshot v c =>
    simp only [apply, vault?_setNarrow, approves_setNarrow] at h ⊢
    revert h; repeat' split
    all_goals simp [ok]
  | _ => simp [Action.isTrust] at ht

/-- An edit accepted with facts `G` hidden is accepted with more hidden, `F`, where the facts no move hides are the same
    and every fact more is an audience of an entry it doesn't write. -/
theorem apply_hide_more (st : State) {F G : List Fact} (hp : plain F = plain G) (edit : Edit)
    (hmore : ∀ f ∈ F, f ∉ G → ∃ e to, f = .audience e to ∧ writesEntry edit e = false)
    (h : ok (apply (hide st G) edit) = some ()) : ok (apply (hide st F) edit) = some () := by
  rw [hide_split] at h ⊢
  rw [hp]
  refine apply_setNarrow_other _ edit (fun x hx => ?_) h
  rw [mem_hide_narrow] at hx
  rcases hx with hx | hx
  · exact .inl ((mem_hide_narrow st G x).2 (.inl hx))
  · by_cases hg : Fact.audience x.1 x.2 ∈ G
    · exact .inl ((mem_hide_narrow st G x).2 (.inr hg))
    · obtain ⟨e, to, he, hw⟩ := hmore _ hx hg
      cases he
      exact .inr hw

/-! ## The edits before the place, with new moves after it -/

/-- A replay with removals alike, the same facts hidden that no move hides, every audience hidden before hidden still,
    and every one more of an entry no edit that stood writes, is the same replay: an edit that stood stands with the
    audiences more narrowed that it doesn't read, and one that didn't stand stands nowhere with more hidden. -/
theorem runFrom_more_aud (rem rem' : List Edit) (cs cs' : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (l : List (Edit × Nat)),
      (∀ q ∈ l, rem'.any (·.id == q.1.id) = rem.any (·.id == q.1.id) ∧
        plain (hiddenAt cs' q.2 q.1) = plain (hiddenAt cs q.2 q.1) ∧
        ∀ f ∈ hiddenAt cs q.2 q.1, f ∈ hiddenAt cs' q.2 q.1) →
      (∀ w ∈ (runFrom rem cs st l).2, ∀ q ∈ l, q.1 = w → ∀ f ∈ hiddenAt cs' q.2 q.1, f ∉ hiddenAt cs q.2 q.1 →
        ∃ e to, f = .audience e to ∧ writesEntry w e = false) →
      runFrom rem' cs' st l = runFrom rem cs st l
  | _, [], _, _ => rfl
  | st, (edit, i) :: rest, hl, hk => by
    obtain ⟨hrem, hp, hsub⟩ := hl (edit, i) List.mem_cons_self
    dsimp only at hrem hp hsub
    have hl' := fun q hq => hl q (List.mem_cons_of_mem _ hq)
    have hk' : ∀ (st' : State), (runFrom rem cs st' rest).2 ⊆ (runFrom rem cs st ((edit, i) :: rest)).2 →
        ∀ w ∈ (runFrom rem cs st' rest).2, ∀ q ∈ rest, q.1 = w → ∀ f ∈ hiddenAt cs' q.2 q.1,
          f ∉ hiddenAt cs q.2 q.1 → ∃ e to, f = .audience e to ∧ writesEntry w e = false :=
      fun st' hs w hw q hq => hk w (hs hw) q (List.mem_cons_of_mem _ hq)
    rw [runFrom.eq_2, runFrom.eq_2, hrem]
    split
    · rename_i hr
      have heq : runFrom rem cs st ((edit, i) :: rest) = runFrom rem cs st rest := by
        rw [runFrom.eq_2]; simp [hr]
      exact runFrom_more_aud rem rem' cs cs' st rest hl' (hk' st (by rw [heq]; exact fun _ h => h))
    · rename_i hr
      -- with more hidden it is accepted only where it was (`apply_hide_mono`)
      have hFG : ok (apply (hide st (hiddenAt cs' i edit)) edit) = some () →
          ok (apply (hide st (hiddenAt cs i edit)) edit) = some () :=
        apply_hide_mono st hp.symm (fun f hf _ => hsub f hf) edit
      rcases hG : apply (hide st (hiddenAt cs i edit)) edit with _ | a
      · have hF : apply (hide st (hiddenAt cs' i edit)) edit = none := by
          rcases hF : apply (hide st (hiddenAt cs' i edit)) edit with _ | b
          · rfl
          · rw [hF, hG] at hFG; simp [ok] at hFG
        simp only [hF]
        have heq : runFrom rem cs st ((edit, i) :: rest) = runFrom rem cs st rest := by
          rw [runFrom.eq_2]; simp [hr, hG]
        exact runFrom_more_aud rem rem' cs cs' st rest hl' (hk' st (by rw [heq]; exact fun _ h => h))
      · rcases hs : step st edit with _ | st'
        · have heq : runFrom rem cs st ((edit, i) :: rest) = runFrom rem cs st rest := by
            rw [runFrom.eq_2]; simp [hr, hG, hs]
          rcases apply (hide st (hiddenAt cs' i edit)) edit with _ | b <;>
            exact runFrom_more_aud rem rem' cs cs' st rest hl' (hk' st (by rw [heq]; exact fun _ h => h))
        · -- it stood: what more is hidden from it is an audience of an entry it doesn't write
          have heq : runFrom rem cs st ((edit, i) :: rest) =
              ((runFrom rem cs st' rest).1, edit :: (runFrom rem cs st' rest).2) := by
            rw [runFrom.eq_2]; simp [hr, hG, hs]
          have hmore := hk edit (by rw [heq]; exact List.mem_cons_self) (edit, i) List.mem_cons_self rfl
          have hok := apply_hide_more st hp edit hmore (by rw [hG]; rfl)
          rcases hF : apply (hide st (hiddenAt cs' i edit)) edit with _ | b
          · rw [hF] at hok; simp [ok] at hok
          · simp only []
            rw [runFrom_more_aud rem rem' cs cs' st' rest hl'
              (hk' st' (by rw [heq]; exact fun _ h => List.mem_cons_of_mem _ h))]

/-! ## What the moves after the place hide -/

/-- What a move takes away turns on nothing else held. -/
theorem removes_move (a b : List Edit) {y : Edit} (hy : isMove y = true) : removes a y = removes b y := by
  obtain ⟨v, e, to, wants, keep, via, h⟩ := move_shape hy
  simp [removes, h]

theorem mem_tailFacts {edits rem : List Edit} {x : Edit} {f : Fact} :
    ∀ {l : List Edit}, f ∈ tailFacts edits rem l x → ∃ y ∈ l, rem.any (·.id == y.id) = true ∧
      (y.action.keep?.getD []).contains x.id = false ∧ f ∈ removes edits y
  | [], h => by simp [tailFacts] at h
  | y :: l, h => by
    unfold tailFacts at h
    rw [List.filter_cons] at h
    split at h
    · rename_i hy
      rw [List.flatMap_cons, List.mem_append] at h
      rcases h with h | h
      · split at h
        · simp at h
        · rename_i hk
          exact ⟨y, List.mem_cons_self, hy, by simpa using hk, h⟩
      · obtain ⟨z, hz, h1, h2, h3⟩ := mem_tailFacts (l := l) (by unfold tailFacts; exact h)
        exact ⟨z, List.mem_cons_of_mem _ hz, h1, h2, h3⟩
    · obtain ⟨z, hz, h1, h2, h3⟩ := mem_tailFacts (l := l) (by unfold tailFacts; exact h)
      exact ⟨z, List.mem_cons_of_mem _ hz, h1, h2, h3⟩

theorem tailFacts_mem {edits rem : List Edit} {x y : Edit} {f : Fact} :
    ∀ {l : List Edit}, y ∈ l → rem.any (·.id == y.id) = true → (y.action.keep?.getD []).contains x.id = false →
      f ∈ removes edits y → f ∈ tailFacts edits rem l x
  | [], hy, _, _, _ => absurd hy List.not_mem_nil
  | z :: l, hy, hr, hk, hf => by
    unfold tailFacts
    rw [List.filter_cons]
    rcases List.mem_cons.1 hy with rfl | hy
    · simp only [hr, ↓reduceIte, List.flatMap_cons, hk, Bool.false_eq_true]
      exact List.mem_append_left _ hf
    · have ih := tailFacts_mem (l := l) hy hr hk hf
      unfold tailFacts at ih
      split
      · rw [List.flatMap_cons]; exact List.mem_append_right _ ih
      · exact ih

/-- Where every removal chosen among `l` is a move, all they hide is audiences. -/
theorem plain_tailFacts {edits rem : List Edit} {x : Edit} {l : List Edit}
    (h : ∀ y ∈ l, rem.any (·.id == y.id) = true → isMove y = true) : plain (tailFacts edits rem l x) = [] := by
  refine List.filter_eq_nil_iff.2 fun f hf => ?_
  obtain ⟨y, hy, hr, -, hfy⟩ := mem_tailFacts hf
  simp [removes_aud (h y hy hr) edits f hfy]

/-- The facts hidden from an edit before the place: those the removals before it hide, then those after it. -/
theorem hiddenAt_split (p t X : List Edit) (x : Edit) {i : Nat} (hi : i < p.length) :
    hiddenAt (cuts (p ++ t) X) i x = hiddenAt (cutsAt (p ++ t) X p 0) i x ++ tailFacts (p ++ t) X t x := by
  rw [cuts_eq_cutsAt, cutsAt_append, hiddenAt_append', Nat.zero_add,
    hiddenAt_cutsAt_before _ _ _ t p.length i hi]

theorem foldl_rstep_sub (edits : List Edit) :
    ∀ (l acc : List Edit), ∃ c, l.foldl (rstep edits) acc = acc ++ c ∧ c.Sublist l
  | [], acc => ⟨[], by simp⟩
  | r :: l, acc => by
    obtain ⟨c, hc, hm⟩ := foldl_rstep_sub edits l (rstep edits acc r)
    rw [List.foldl_cons]
    by_cases h : ((r :: acc).all fun x => (runWith edits (acc ++ [r])).2.any (·.id == x.id)) = true
    · have hs : rstep edits acc r = acc ++ [r] := by unfold rstep; exact ite_eq_left_iff.2 (fun h' => absurd h h')
      rw [hs] at hc
      exact ⟨r :: c, by rw [hs, hc]; simp, hm.cons_cons r⟩
    · have hs : rstep edits acc r = acc := by unfold rstep; exact ite_eq_right_iff.2 (fun h' => absurd h' h)
      rw [hs] at hc
      exact ⟨c, by rw [hs, hc], hm.cons r⟩

/-! ## A late page with moves replays the last edits -/

/-- The removals a device chooses where the edits after the place, `s'`, hold new moves: those `resolve` chose among
    the removals before the place (`cp`, ranked as before), then every move after the place, held or new. -/
def chosen (p s s' cp : List Edit) : List Edit := cp.foldl (rstep (p ++ s)) [] ++ s'.filter isMove

/-- The edits `s'` after the place replayed from the state kept there, with those removals. -/
def tailRunM (p s s' cp : List Edit) : State × List Edit :=
  runFrom (chosen p s s' cp) (cutsAt (p ++ s') (chosen p s s' cp) s' p.length) (kept p s).1 (s'.zipIdx p.length)

/-- **V4m (a late page with moves replays the last edits)**: a device that kept the replay of the edits it held,
    `p ++ s` in order, at a place after `p`, every removal after it a move that stood, and receives edits that sort
    after it, `p ++ s'` in order, whose removals after the place are moves too, held or new, replays only `s'` from
    the state it kept there, with the removals it chose before the place and every move after it: where the removals
    before the place rank as before (`cp`) and take away what they took, every new move keeps every write of its entry
    that stood before the place, every move after the place stands again, and the moves after the place hide nothing
    that keeps an edit out, from the edits before the place as from those after it. The edits before the place stand
    as they stood. -/
theorem V4_tail_moves (held fresh p s s' cp : List Edit)
    (ho' : order (held ++ fresh) = p ++ s')
    (hids : ((p ++ s).map Edit.id).Nodup) (hids' : ((p ++ s').map Edit.id).Nodup)
    (hsub : ∀ x ∈ s, x ∈ s')
    (hmoves : ∀ x ∈ s, x.isRemoval = true → x.action.isTrust = false)
    (hchosen : ∀ x ∈ s, x.isRemoval = true → x ∈ resolve (p ++ s))
    (hc : cands (p ++ s) = cp ++ s.filter isMove) (hc' : cands (p ++ s') = cp ++ s'.filter isMove)
    (hcp : ∀ x ∈ cp, x ∈ p)
    (hrm : ∀ r ∈ p, r.isRemoval = true → removes (p ++ s') r = removes (p ++ s) r)
    (hkeep : ∀ m ∈ s', m ∉ s → isMove m = true → ∀ w ∈ (kept p s).2, ∀ e to,
      Fact.audience e to ∈ removes (p ++ s') m → writesEntry w e = true → (m.action.keep?.getD []).contains w.id = true)
    (hstands : ∀ x ∈ s', x.isRemoval = true → (tailRunM p s s' cp).2.any (·.id == x.id) = true)
    (hinertP : runFrom (resolve (p ++ s)) (stripTail (p ++ s) (resolve (p ++ s)) p s) {} p.zipIdx = kept p s)
    (hinertT : runFrom (chosen p s s' cp) (strip (cutsAt (p ++ s') (chosen p s s' cp) s' p.length)) (kept p s).1
      (s'.zipIdx p.length) = tailRunM p s s' cp) :
    view (held ++ fresh) = (tailRunM p s s' cp).1 ∧
      standing (held ++ fresh) = (kept p s).2 ++ (tailRunM p s s' cp).2 := by
  have hnd := nodup_of_map _ hids
  have hnd' := nodup_of_map _ hids'
  have hdis : ∀ x ∈ p, ∀ y ∈ s, y.id ≠ x.id := by
    have h := hids; rw [List.map_append, List.nodup_append] at h
    exact fun x hx y hy he => h.2.2 _ (List.mem_map_of_mem hx) _ (List.mem_map_of_mem hy) he.symm
  have hdis' : ∀ x ∈ p, ∀ y ∈ s', y.id ≠ x.id := by
    have h := hids'; rw [List.map_append, List.nodup_append] at h
    exact fun x hx y hy he => h.2.2 _ (List.mem_map_of_mem hx) _ (List.mem_map_of_mem hy) he.symm
  -- the removals chosen: before the place, then the moves after it
  obtain ⟨Rp, hRpdef⟩ : ∃ Rp, Rp = cp.foldl (rstep (p ++ s)) [] := ⟨_, rfl⟩
  obtain ⟨M', hM'def⟩ : ∃ M', M' = s'.filter isMove := ⟨_, rfl⟩
  have hR' : chosen p s s' cp = Rp ++ M' := by rw [hRpdef, hM'def]; rfl
  have hRp : ∀ x ∈ Rp, x ∈ p := by
    intro x hx
    obtain ⟨c, hcf, hm⟩ := foldl_rstep_form (p ++ s) cp []
    rw [← hRpdef, List.nil_append] at hcf
    rw [hcf] at hx; exact hcp x (hm x hx)
  obtain ⟨c, hRc, hcs⟩ : ∃ c, (resolve (p ++ s)) = Rp ++ c ∧ ∀ y ∈ c, y ∈ s.filter isMove := by
    obtain ⟨c, hcf, hm⟩ := foldl_rstep_form (p ++ s) (s.filter isMove) Rp
    refine ⟨c, ?_, hm⟩
    rw [resolve_eq, hc, List.foldl_append, ← hRpdef, hcf]
  have hM's : ∀ y ∈ M', y ∈ s' := fun y hy => (List.mem_filter.1 (hM'def ▸ hy)).1
  have hnotin : ∀ (X : List Edit) (t : List Edit), (∀ y ∈ X, y ∈ t) → (∀ x ∈ p, ∀ y ∈ t, y.id ≠ x.id) →
      ∀ x ∈ p, X.any (·.id == x.id) = false := by
    intro X t hX ht x hx
    exact List.any_eq_false.2 fun y hy h => ht x hx y (hX y hy) (by simpa using h)
  have hRany : ∀ x ∈ p, (resolve (p ++ s)).any (·.id == x.id) = Rp.any (·.id == x.id) := by
    intro x hx
    rw [hRc, List.any_append, hnotin c s (fun y hy => (List.mem_filter.1 (hcs y hy)).1) hdis x hx, Bool.or_false]
  have hR'any : ∀ x ∈ p, (chosen p s s' cp).any (·.id == x.id) = Rp.any (·.id == x.id) := by
    intro x hx
    rw [hR', List.any_append, hnotin M' s' hM's hdis' x hx, Bool.or_false]
  have hagreeP : ∀ x ∈ p, (chosen p s s' cp).any (·.id == x.id) = (resolve (p ++ s)).any (·.id == x.id) := fun x hx => by
    rw [hR'any x hx, hRany x hx]
  -- every removal chosen after the place is a move
  have hR'mv : ∀ y ∈ s', (chosen p s s' cp).any (·.id == y.id) = true → isMove y = true := by
    intro y hy h
    obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
    rw [hR'] at hz
    rcases List.mem_append.1 hz with hz | hz
    · exact absurd (by simpa using he : z.id = y.id).symm (hdis' z (hRp z hz) y hy)
    · have hzy : z = y := eq_of_id_eq hids' (List.mem_append_right _ (hM's z hz)) (List.mem_append_right _ hy)
        (by simpa using he)
      exact hzy ▸ (List.mem_filter.1 (hM'def ▸ hz)).2
  have hRmv : ∀ y ∈ s, (resolve (p ++ s)).any (·.id == y.id) = true → isMove y = true := by
    intro y hy h
    obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
    obtain ⟨hzo, hzr⟩ := resolve_removals _ z hz
    have hzy : z = y := eq_of_id_eq hids hzo (List.mem_append_right _ hy) (by simpa using he)
    subst hzy
    simp [isMove, hzr, hmoves z hy hzr]
  -- the removals before the place cut as before
  have hA : cutsAt (p ++ s') (chosen p s s' cp) p 0 = cutsAt (p ++ s) (resolve (p ++ s)) p 0 :=
    cutsAt_congr (fun r hr => hagreeP r hr) (fun r hr h => by
      obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
      obtain ⟨hzo, hzr⟩ := resolve_removals _ z hz
      have hzy : z = r := eq_of_id_eq hids hzo (List.mem_append_left _ hr) (by simpa using he)
      exact hrm r hr (hzy ▸ hzr)) 0
  -- the edits before the place stand as they stood
  have hP : runFrom (chosen p s s' cp) (cuts (p ++ s') (chosen p s s' cp)) {} p.zipIdx = kept p s := by
    unfold kept
    refine runFrom_more_aud (resolve (p ++ s)) (chosen p s s' cp) (cuts (p ++ s) (resolve (p ++ s))) (cuts (p ++ s') (chosen p s s' cp)) {} p.zipIdx (fun q hq => ?_) ?_
    · have hqp := List.fst_mem_of_mem_zipIdx hq
      have hi : q.2 < p.length := by simpa using (List.mem_zipIdx hq).2.1
      refine ⟨hagreeP q.1 hqp, ?_, ?_⟩
      · rw [hiddenAt_split p s' (chosen p s s' cp) q.1 hi, hiddenAt_split p s (resolve (p ++ s)) q.1 hi, hA, plain_append, plain_append,
          plain_tailFacts hR'mv, plain_tailFacts hRmv]
      · intro f hf
        rw [hiddenAt_split p s (resolve (p ++ s)) q.1 hi] at hf
        rw [hiddenAt_split p s' (chosen p s s' cp) q.1 hi, hA]
        rcases List.mem_append.1 hf with hf | hf
        · exact List.mem_append_left _ hf
        · obtain ⟨y, hy, hr, hk, hfy⟩ := mem_tailFacts hf
          have hym := hRmv y hy hr
          refine List.mem_append_right _ (tailFacts_mem (hsub y hy) ?_ hk (by rw [removes_move _ _ hym]; exact hfy))
          rw [hR', List.any_append]
          have : M'.any (·.id == y.id) = true := List.any_eq_true.2 ⟨y, hM'def ▸ List.mem_filter.2 ⟨hsub y hy, hym⟩, by simp⟩
          rw [this, Bool.or_true]
    · intro w hw q hq hqw f hf hng
      have hqp := List.fst_mem_of_mem_zipIdx hq
      have hi : q.2 < p.length := by simpa using (List.mem_zipIdx hq).2.1
      rw [hiddenAt_split p s' (chosen p s s' cp) q.1 hi, hA] at hf
      rw [hiddenAt_split p s (resolve (p ++ s)) q.1 hi] at hng
      rcases List.mem_append.1 hf with hf | hf
      · exact absurd (List.mem_append_left _ hf) hng
      · obtain ⟨y, hy, hr, hk, hfy⟩ := mem_tailFacts hf
        have hym := hR'mv y hy hr
        obtain ⟨v, e, to, wants, keep, via, hya⟩ := move_shape hym
        have hfe : f = .audience e to := by simpa [removes, hya] using hfy
        refine ⟨e, to, hfe, ?_⟩
        by_cases hys : y ∈ s
        · exfalso
          have hyR : (resolve (p ++ s)).any (·.id == y.id) = true :=
            List.any_eq_true.2 ⟨y, hchosen y hys (isMove_isRemoval hym), by simp⟩
          exact hng (List.mem_append_right _ (tailFacts_mem hys hyR hk (by rw [removes_move _ _ hym]; exact hfy)))
        · cases hwe : writesEntry w e
          · rfl
          · have := hkeep y hy hys hym w hw e to (hfe ▸ hfy) hwe
            rw [← hqw, hk] at this
            exact absurd this (by simp)
  have hrun : runWith (p ++ s') (chosen p s s' cp) = ((tailRunM p s s' cp).1, (kept p s).2 ++ (tailRunM p s s' cp).2) := by
    rw [runWith_split, hP]; rfl
  have hrun0 : runWith (p ++ s) (resolve (p ++ s)) = ((tailRun p s s).1, (kept p s).2 ++ (tailRun p s s).2) := by
    rw [runWith_split]; rfl
  -- the removals before the place are chosen as before: each is tried with those before it, all before the place,
  -- on a replay whose edits after the place hide nothing from them and none of which they are (`V4_rewind`)
  have hcands_p : ∀ x ∈ cp, x ∈ p ++ s ∧ x.isRemoval = true := fun x hx =>
    mem_cands (o := p ++ s) (by rw [hc]; exact List.mem_append_left _ hx)
  have hfoldP : cp.foldl (rstep (p ++ s')) [] = Rp := by
    rw [hRpdef]
    refine foldl_congr_prefix (rstep (p ++ s')) (rstep (p ++ s)) [] cp fun pre r post hC => ?_
    obtain ⟨b, hb, hbpre⟩ := foldl_rstep_form (p ++ s) pre []
    simp only [List.nil_append] at hb
    rw [hb]
    have hrcp : r ∈ cp := by rw [hC]; simp
    have hTp : ∀ x ∈ b ++ [r], x ∈ p := by
      intro x hx
      rcases List.mem_append.1 hx with hx | hx
      · exact hcp x (by rw [hC]; exact List.mem_append_left _ (hbpre x hx))
      · rw [List.mem_singleton] at hx; exact hx ▸ hcp r hrcp
    have hTrem : ∀ x ∈ b ++ [r], x.isRemoval = true := by
      intro x hx
      rcases List.mem_append.1 hx with hx | hx
      · exact (hcands_p x (by rw [hC]; exact List.mem_append_left _ (hbpre x hx))).2
      · rw [List.mem_singleton] at hx; exact hx ▸ (hcands_p r hrcp).2
    have hnil : ∀ t : List Edit, (∀ y ∈ t, ∀ z ∈ p, z.id ≠ y.id) →
        t.filter (fun y => (b ++ [r]).any (·.id == y.id)) = [] := by
      intro t ht
      refine List.filter_eq_nil_iff.2 fun y hy h => ?_
      obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
      exact ht y hy z (hTp z hz) (by simpa using he)
    have hT := V4_rewind p s s' (b ++ [r]) (b ++ [r]) (fun _ _ => rfl)
      (fun y hy h => by
        obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
        have hzy : z = y := eq_of_id_eq hids (List.mem_append_left _ (hTp z hz)) (List.mem_append_left _ hy)
          (by simpa using he)
        exact hrm y hy (hzy ▸ hTrem z hz))
      (fun x _ => by
        unfold tailFacts
        rw [hnil s' (fun y hy z hz => (hdis' z hz y hy).symm), hnil s (fun y hy z hz => (hdis z hz y hy).symm)]; rfl)
    have hT0 := V4_rewind p s s (b ++ [r]) (b ++ [r]) (fun _ _ => rfl) (fun _ _ _ => rfl) (fun _ _ => rfl)
    have hcnd : ((r :: b).all fun x => (runWith (p ++ s') (b ++ [r])).2.any (·.id == x.id)) =
        ((r :: b).all fun x => (runWith (p ++ s) (b ++ [r])).2.any (·.id == x.id)) := by
      rw [hT, hT0]
      refine Stored.all_congr_mem fun x hx => ?_
      have hxp : x ∈ p := hTp x (by
        rcases List.mem_cons.1 hx with rfl | hx
        · simp
        · exact List.mem_append_left _ hx)
      simp only [List.any_append]
      rw [any_tail_false (fun y hy => hdis' x hxp y hy),
        any_tail_false (fun y hy => hdis x hxp y hy)]
    unfold rstep
    rw [hcnd]
  -- every removal chosen stands in the replay with them all
  have hstand : ∀ x ∈ chosen p s s' cp, (runWith (p ++ s') (chosen p s s' cp)).2.any (·.id == x.id) = true := by
    intro x hx
    rw [hrun, List.any_append]
    rw [hR'] at hx
    rcases List.mem_append.1 hx with hxp | hxm
    · have hxR : x ∈ resolve (p ++ s) := by rw [hRc]; exact List.mem_append_left _ hxp
      have hold := Moves.resolve_stands (p ++ s) x hxR
      rw [hrun0, List.any_append] at hold
      unfold tailRun at hold
      rw [any_tail_false (fun y hy => hdis x (hRp x hxp) y hy), Bool.or_false] at hold
      rw [hold, Bool.true_or]
    · have hxm' := List.mem_filter.1 (hM'def ▸ hxm)
      rw [hstands x hxm'.1 (isMove_isRemoval hxm'.2), Bool.or_true]
  -- and the replay is inert
  have hPs : runFrom (chosen p s s' cp) (stripTail (p ++ s') (chosen p s s' cp) p s') {} p.zipIdx = kept p s := by
    rw [← hinertP]
    refine runFrom_congr _ _ _ _ {} p.zipIdx fun ⟨y, i⟩ hq => ⟨hagreeP y (List.fst_mem_of_mem_zipIdx hq), ?_⟩
    have hi := (List.mem_zipIdx hq).2.1
    dsimp only
    unfold stripTail
    rw [hiddenAt_append', hiddenAt_append', hiddenAt_strip, hiddenAt_strip,
      hiddenAt_cutsAt_before _ _ _ s' _ _ (by omega), hiddenAt_cutsAt_before _ _ _ s _ _ (by omega),
      plain_tailFacts hR'mv, plain_tailFacts hRmv, hA]
  have hTs : runFrom (chosen p s s' cp) (stripTail (p ++ s') (chosen p s s' cp) p s') (kept p s).1
      (s'.zipIdx p.length) = tailRunM p s s' cp := by
    rw [← hinertT]
    refine runFrom_congr _ _ _ _ _ _ fun ⟨y, i⟩ hq => ⟨rfl, ?_⟩
    have hi := (List.mem_zipIdx hq).1
    dsimp only
    unfold stripTail
    rw [hiddenAt_append', hiddenAt_cutsAt_past _ _ _ p 0 i (by omega), List.nil_append]
  have hinert : runFrom (chosen p s s' cp) (stripTail (p ++ s') (chosen p s s' cp) p s') {} (p ++ s').zipIdx =
      runWith (p ++ s') (chosen p s s' cp) := by
    rw [hrun, List.zipIdx_append, runFrom_append, Nat.zero_add, hPs, hTs]
  -- every move after the place, held or new, is chosen in its turn: tried with the removals chosen before it, the
  -- replay keeps each standing, as the replay with all of them does, which is inert (`runFrom_sandwich`)
  have hM'sub : M'.Sublist s' := hM'def ▸ List.filter_sublist
  have hsubM : ∀ {x y : Edit}, List.Sublist [x, y] M' → List.Sublist [x, y] (p ++ s') :=
    fun h => (h.trans hM'sub).trans (List.sublist_append_right p s')
  have hfoldM : ∀ (post pre : List Edit), M' = pre ++ post →
      post.foldl (rstep (p ++ s')) (Rp ++ pre) = Rp ++ M' := by
    intro post
    induction post with
    | nil => intro pre h; rw [h, List.append_nil]; rfl
    | cons r post' ih =>
      intro pre hM
      rw [List.foldl_cons]
      have hrM : r ∈ M' := by rw [hM]; simp
      have hrs' : r ∈ s' := hM's r hrM
      obtain ⟨q₁, t, hs'⟩ := List.append_of_mem hrs'
      have ho'' : p ++ s' = (p ++ q₁) ++ r :: t := by rw [hs']; simp
      have hQ : p ++ s' = (p ++ q₁ ++ [r]) ++ t := by rw [ho'']; simp
      have hct : ∀ y ∈ post', y ∈ t ∧ isMove y = true := by
        intro y hy
        have hsl : List.Sublist [r, y] M' := by
          rw [hM]
          exact (List.cons_sublist_cons.2 (List.singleton_sublist.2 hy)).trans (List.sublist_append_right pre _)
        have hyM : y ∈ M' := by rw [hM]; simp [hy]
        exact ⟨pair_after hnd' ho'' (hsubM hsl), (List.mem_filter.1 (hM'def ▸ hyM)).2⟩
      have hbq : ∀ x ∈ Rp ++ pre, x ∈ p ++ q₁ := by
        intro x hx
        rcases List.mem_append.1 hx with hx | hx
        · exact List.mem_append_left _ (hRp x hx)
        · have hsl : List.Sublist [x, r] M' := by
            rw [hM]
            exact List.Sublist.append (List.singleton_sublist.2 hx) (List.singleton_sublist.2 List.mem_cons_self)
          exact pair_before hnd' ho'' (hsubM hsl)
      have hQt : ∀ z ∈ p ++ q₁ ++ [r], ∀ y ∈ t, z.id ≠ y.id := by
        have h := hids'; rw [hQ, List.map_append, List.nodup_append] at h
        exact fun z hz y hy => h.2.2 _ (List.mem_map_of_mem hz) _ (List.mem_map_of_mem hy)
      have hReq : chosen p s s' cp = (Rp ++ pre ++ [r]) ++ post' := by rw [hR', hM]; simp
      have hagree : ∀ z ∈ p ++ q₁ ++ [r],
          (Rp ++ pre ++ [r]).any (·.id == z.id) = (chosen p s s' cp).any (·.id == z.id) := by
        intro z hz
        have : post'.any (·.id == z.id) = false :=
          List.any_eq_false.2 fun y hy h => hQt z hz y (hct y hy).1 (beq_iff_eq.1 h).symm
        rw [hReq, List.any_append (xs := Rp ++ pre ++ [r]), this, Bool.or_false]
      have hTR : ∀ y ∈ s', (Rp ++ pre ++ [r]).any (·.id == y.id) = true →
          (chosen p s s' cp).any (·.id == y.id) = true := by
        intro y _ h; rw [hReq, List.any_append, h, Bool.true_or]
      have hmv : ∀ y ∈ s', (chosen p s s' cp).any (·.id == y.id) = true →
          (Rp ++ pre ++ [r]).any (·.id == y.id) = false → isMove y = true := by
        intro y hy h hT
        rw [hReq, List.any_append, hT, Bool.false_or] at h
        obtain ⟨z, hz, he⟩ := List.any_eq_true.1 h
        have hzt := (hct z hz).1
        have hzy : z = y := eq_of_id_eq hids' (by rw [hQ]; exact List.mem_append_right _ hzt)
          (List.mem_append_right _ hy) (by simpa using he)
        exact hzy ▸ (hct z hz).2
      have hsplit : ∀ X : List Edit, cuts (p ++ s') X = cutsAt (p ++ s') X p 0 ++ cutsAt (p ++ s') X s' p.length := by
        intro X; rw [cuts_eq_cutsAt, cutsAt_append, Nat.zero_add]
      have hA2 : cutsAt (p ++ s') (Rp ++ pre ++ [r]) p 0 = cutsAt (p ++ s') (chosen p s s' cp) p 0 :=
        cutsAt_congr (fun z hz => hagree z (by simp [hz])) (fun _ _ _ => rfl) 0
      have hcutT : ∀ (i : Nat) (x : Edit),
          plain (hiddenAt (cuts (p ++ s') (Rp ++ pre ++ [r])) i x) =
            plain (hiddenAt (cuts (p ++ s') (chosen p s s' cp)) i x) ∧
            ∀ f ∈ hiddenAt (cuts (p ++ s') (Rp ++ pre ++ [r])) i x, isAud f = true →
              f ∈ hiddenAt (cuts (p ++ s') (chosen p s s' cp)) i x := by
        intro i x
        obtain ⟨h1, h2⟩ := hiddenAt_cutsAt_mono (p ++ s') (Rp ++ pre ++ [r]) (chosen p s s' cp) i x s' p.length hTR hmv
        rw [hsplit, hsplit, hiddenAt_append', hiddenAt_append', hA2, plain_append, plain_append, h1]
        refine ⟨rfl, fun f hf _ => ?_⟩
        rcases List.mem_append.1 hf with hf | hf
        · exact List.mem_append_left _ hf
        · exact List.mem_append_right _ (h2 f hf)
      have hcutS : ∀ (i : Nat) (x : Edit),
          plain (hiddenAt (stripTail (p ++ s') (chosen p s s' cp) p s') i x) =
            plain (hiddenAt (cuts (p ++ s') (chosen p s s' cp)) i x) ∧
            ∀ f ∈ hiddenAt (stripTail (p ++ s') (chosen p s s' cp) p s') i x, isAud f = true →
              f ∈ hiddenAt (cuts (p ++ s') (Rp ++ pre ++ [r])) i x := by
        intro i x
        unfold stripTail
        rw [hsplit, hsplit, hiddenAt_append', hiddenAt_append', hiddenAt_append', hiddenAt_strip, hA2, plain_append,
          plain_append, plain_plain]
        refine ⟨rfl, fun f hf hfa => ?_⟩
        rcases List.mem_append.1 hf with hf | hf
        · exact List.mem_append_left _ hf
        · rw [mem_plain] at hf; rw [hf.2] at hfa; exact absurd hfa (by simp)
      have hzip : (p ++ s').zipIdx = (p ++ q₁ ++ [r]).zipIdx ++ t.zipIdx (p ++ q₁ ++ [r]).length := by
        rw [hQ, List.zipIdx_append, Nat.zero_add]
      have hsw := runFrom_sandwich (chosen p s s' cp) (Rp ++ pre ++ [r]) (cuts (p ++ s') (chosen p s s' cp))
        (cuts (p ++ s') (Rp ++ pre ++ [r])) (stripTail (p ++ s') (chosen p s s' cp) p s')
        (t.zipIdx (p ++ q₁ ++ [r]).length) {}
        (p ++ q₁ ++ [r]).zipIdx (by rw [← hzip, zipIdx_ids]; exact hids')
        (fun z hz => hagree z.1 (List.fst_mem_of_mem_zipIdx hz))
        (fun z _ => hcutT z.2 z.1) (fun z _ => hcutS z.2 z.1) (by rw [← hzip]; exact hinert)
      have hcond : ((r :: (Rp ++ pre)).all fun x =>
          (runWith (p ++ s') (Rp ++ pre ++ [r])).2.any (·.id == x.id)) = true := by
        refine List.all_eq_true.2 fun x hx => ?_
        have hxQ : x ∈ p ++ q₁ ++ [r] := by
          rcases List.mem_cons.1 hx with rfl | hx
          · simp
          · exact List.mem_append_left _ (hbq x hx)
        have hxR : x ∈ chosen p s s' cp := by
          rw [hReq]; rcases List.mem_cons.1 hx with rfl | hx
          · simp
          · rcases List.mem_append.1 hx with h | h <;> simp [h]
        have hs := hstand x hxR
        unfold runWith at hs ⊢
        rw [hzip, runFrom_append] at hs ⊢
        rw [List.any_append, any_tail_false (fun y hy => (hQt x hxQ y hy).symm), Bool.or_false] at hs
        rw [List.any_append, hsw, hs, Bool.true_or]
      have hstep : rstep (p ++ s') (Rp ++ pre) r = Rp ++ pre ++ [r] := by
        simp only [rstep, hcond, ↓reduceIte]
      rw [hstep, List.append_assoc]
      exact ih (pre ++ [r]) (by rw [hM]; simp)
  have hres : resolve (p ++ s') = chosen p s s' cp := by
    rw [resolve_eq, hc', List.foldl_append, hfoldP, ← hM'def, hR']
    simpa using hfoldM M' [] (by simp)
  unfold view standing
  simp only [ho', hres, hrun, and_self]

end TailMoves

end AvenDB
