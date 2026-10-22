import AvenDB.Lemmas
import AvenDB.CapLemmas
import AvenDB.SyncLemmas
import AvenDB.KeyLemmas

/-!
# Stored views

The proof of V1: a device keeps what it knows between unlocks (its stored view, M1 of the master plan) and steps new
edits on it (`stepsOn`, `Step.lean`), never replaying every edit it holds again. When every new edit is a write, deeper
than every edit it held, and no edit it held builds on a new one, the view of all its edits is the view it kept with
the new edits stepped on one by one, in the replay order, and the edits that stand are those that stood with the new
ones that step. This is the Rust engine's stepped path (`replay_on_why`); anything else replays again.

The new edits sort after every edit held (`order_append`); a write is no removal and issues no grant, so the removals
cut what they cut before and hide nothing from an edit after them (`runWith_append`); and a write leaves the vaults and
the shares alone, which is all a removal's priority reads, so the same removals stand (`resolve_append`).
-/

namespace AvenDB.Stored

open Syncing

/-! ## Writes -/

/-- A write is no removal. -/
theorem isRemoval_of_isWrite {edit : Edit} (h : edit.action.isWrite = true) : edit.isRemoval = false := by
  unfold Edit.isRemoval
  cases ha : edit.action <;> simp_all [Action.isWrite, Action.keep?]

/-- Writes issue no grants. -/
theorem sharesIn_writes {edits : List Edit} (h : ∀ n ∈ edits, n.action.isWrite = true) : sharesIn edits = [] := by
  unfold sharesIn
  refine List.filterMap_eq_nil_iff.2 fun n hn => ?_
  have := h n hn
  cases ha : n.action <;> simp_all [Action.isWrite]

/-- A write leaves the vaults and the shares alone. -/
theorem apply_write_keeps {st post : State} {edit : Edit} (hw : edit.action.isWrite = true)
    (h : apply st edit = some post) : post.vaults = st.vaults ∧ post.shares = st.shares := by
  cases ha : edit.action with
  | write v e actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    unfold apply at h
    rw [ha] at h
    dsimp only at h
    repeat' split at h
    all_goals first
      | (simp at h; done)
      | (obtain rfl := Option.some.inj h; split <;> exact ⟨rfl, rfl⟩)
      | (obtain rfl := Option.some.inj h; exact ⟨rfl, rfl⟩)
  | _ => simp [Action.isWrite, ha] at hw

/-- A step of a write leaves the vaults and the shares alone. -/
theorem step_write_keeps {st st' : State} {edit : Edit} (hw : edit.action.isWrite = true)
    (h : step st edit = some st') : st'.vaults = st.vaults ∧ st'.shares = st.shares := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [Core.settle_vaults, Core.settle_shares]
  exact apply_write_keeps hw hpost

/-- Steps of writes leave the vaults and the shares alone. -/
theorem stepsOn_keeps : ∀ (st : State) (edits : List Edit), (∀ n ∈ edits, n.action.isWrite = true) →
    (stepsOn st edits).1.vaults = st.vaults ∧ (stepsOn st edits).1.shares = st.shares
  | _, [], _ => ⟨rfl, rfl⟩
  | st, edit :: edits, h => by
    have ht := fun n hn => h n (List.mem_cons_of_mem _ hn)
    unfold stepsOn
    split
    · rename_i st' hs
      obtain ⟨hv, hc⟩ := step_write_keeps (h edit List.mem_cons_self) hs
      obtain ⟨hv', hc'⟩ := stepsOn_keeps st' edits ht
      exact ⟨hv'.trans hv, hc'.trans hc⟩
    · exact stepsOn_keeps st edits ht

/-! ## A removal's priority reads only the vaults and the shares -/

theorem approvesN_congr {a b : State} (hv : a.vaults = b.vaults) : approvesN a = approvesN b := by
  funext sigs n
  induction n with
  | zero => funext p; cases p <;> rfl
  | succ n ih => funext p; cases p <;> simp only [approvesN, ih, State.vault?, hv]

theorem tierN_congr {a b : State} (hv : a.vaults = b.vaults) : tierN a = tierN b := by
  funext n
  induction n with
  | zero => rfl
  | succ n ih => funext v; simp only [tierN, ih, State.vault?, hv]

theorem chainN_congr {a b : State} (hc : a.shares = b.shares) : chainN a = chainN b := by
  funext n
  induction n with
  | zero => rfl
  | succ n ih =>
    have hs : a.share? = b.share? := by funext x; simp only [State.share?, hc]
    funext c; simp only [chainN, ih, hs]

theorem priority_congr {a b : State} (hv : a.vaults = b.vaults) (hc : a.shares = b.shares) :
    priority a = priority b := by
  have hd : a.depth = b.depth := by simp only [State.depth, hv]
  have hva : a.vault? = b.vault? := by funext x; simp only [State.vault?, hv]
  have hsa : a.share? = b.share? := by funext x; simp only [State.share?, hc]
  have hap : approves a = approves b := by funext sigs p; simp only [approves, approvesN_congr hv, hd]
  have hti : tier a = tier b := by funext v; simp only [tier, tierN_congr hv, hd]
  have hse : seniority a = seniority b := by funext x c; simp only [seniority, chain, chainN_congr hc, hc]
  funext edit
  unfold priority
  simp only [hva, hsa, hap, hti, hse]

/-! ## Replay with new writes after the edits held -/

/-- A run over two lists is the run over the first, then over the second from where it ended. -/
theorem runFrom_append (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (xs ys : List (Edit × Nat)),
      runFrom rem cs st (xs ++ ys) =
        ((runFrom rem cs (runFrom rem cs st xs).1 ys).1,
          (runFrom rem cs st xs).2 ++ (runFrom rem cs (runFrom rem cs st xs).1 ys).2)
  | st, [], ys => by simp [runFrom]
  | st, (edit, i) :: xs, ys => by
    rw [List.cons_append, runFrom.eq_2, runFrom.eq_2]
    split
    · exact runFrom_append rem cs st xs ys
    · split
      · rename_i st' _ _
        rw [runFrom_append rem cs st' xs ys]
        simp
      · exact runFrom_append rem cs st xs ys

/-- Edits that are no removals, each after every cut, simply step. -/
theorem runFrom_steps (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (l : List (Edit × Nat)), (∀ p ∈ l, p.1.isRemoval = false ∧ ∀ c ∈ cs, c.1 ≤ p.2) →
      runFrom rem cs st l = stepsOn st (l.map Prod.fst)
  | _, [], _ => rfl
  | st, (edit, i) :: rest, h => by
    have ht := fun p hp => h p (List.mem_cons_of_mem _ hp)
    obtain ⟨hr, hcs⟩ := h (edit, i) List.mem_cons_self
    have hh : hiddenAt cs i edit = [] := by
      unfold hiddenAt
      rw [List.filter_eq_nil_iff.2 fun c hc => by have := hcs c hc; simp; omega]
      rfl
    rw [runFrom.eq_2, hh]
    simp only [hr, Bool.false_and, Bool.false_eq_true, ↓reduceIte, hide, List.isEmpty_nil, List.map_cons]
    rw [stepsOn.eq_2]
    unfold step
    cases apply st edit <;> simp only [Option.map, runFrom_steps rem cs _ rest ht]

/-- Every cut sits at a position among the edits. -/
theorem cuts_lt {edits rem : List Edit} : ∀ c ∈ cuts edits rem, c.1 < edits.length := by
  intro c hc
  unfold cuts at hc
  obtain ⟨⟨r, j⟩, hm, hf⟩ := List.mem_filterMap.1 hc
  dsimp only at hf
  split at hf
  · obtain rfl := Option.some.inj hf
    exact (List.mem_zipIdx' hm).1
  · simp at hf

/-- New writes, none of them among the removals, cut nothing more. -/
theorem cuts_append {held new rem : List Edit} (hw : ∀ n ∈ new, n.action.isWrite = true)
    (hrem : ∀ x ∈ rem, ∀ n ∈ new, x.id ≠ n.id) : cuts (held ++ new) rem = cuts held rem := by
  have hs : sharesIn (held ++ new) = sharesIn held := by
    rw [sharesIn, List.filterMap_append, ← sharesIn, ← sharesIn, sharesIn_writes hw, List.append_nil]
  unfold cuts
  rw [List.zipIdx_append, List.filterMap_append]
  have hnew : (new.zipIdx (0 + held.length)).filterMap (fun (r, j) =>
      if rem.any (·.id == r.id) then some (j, r.action.keep?.getD [], removes (held ++ new) r) else none) = [] := by
    refine List.filterMap_eq_nil_iff.2 fun ⟨r, j⟩ hm => ?_
    have hr : r ∈ new := List.fst_mem_of_mem_zipIdx hm
    have hc : (rem.any fun x => x.id == r.id) = false :=
      List.any_eq_false.2 fun x hx => by simpa using hrem x hx r hr
    simp [hc]
  rw [hnew, List.append_nil]
  congr 1
  funext p
  simp only [removes, hs]

/-- Replaying new writes after the edits held, none of them among the removals, is replaying the edits held, then
    stepping the new writes on. -/
theorem runWith_append {held new rem : List Edit} (hw : ∀ n ∈ new, n.action.isWrite = true)
    (hrem : ∀ x ∈ rem, ∀ n ∈ new, x.id ≠ n.id) :
    runWith (held ++ new) rem =
      ((stepsOn (runWith held rem).1 new).1, (runWith held rem).2 ++ (stepsOn (runWith held rem).1 new).2) := by
  unfold runWith
  rw [cuts_append hw hrem, List.zipIdx_append, runFrom_append, runFrom_steps rem _ _ _ ?_, List.zipIdx_map_fst]
  intro ⟨n, i⟩ hm
  refine ⟨isRemoval_of_isWrite (hw n (List.fst_mem_of_mem_zipIdx hm)), fun c hc => ?_⟩
  have := cuts_lt c hc
  have := (List.mem_zipIdx hm).1
  omega

/-! ## The order -/

/-- The new edits sort after every edit held. -/
theorem order_append {held new : List Edit} (hd : ∀ e ∈ held, ∀ n ∈ new, e.depth < n.depth)
    (hp : ∀ e ∈ held, ∀ n ∈ new, n.id ∉ e.parents) (hids : ((held ++ new).map Edit.id).Nodup) :
    order (held ++ new) = order held ++ order new := by
  unfold order
  -- an edit held is malformed among all exactly when among those held; a new one exactly when among the new ones
  have hf : (held ++ new).filter (wellFormed (held ++ new)) = held.filter (wellFormed held) ++
      new.filter (wellFormed new) := by
    rw [List.filter_append]
    congr 1
    · refine List.filter_congr fun e he => ?_
      simp only [wellFormed, List.all_append]
      refine Bool.eq_iff_iff.2 ?_
      simp only [List.all_eq_true, Bool.and_eq_true]
      exact ⟨fun h p hp' => (h p hp').1, fun h p hp' => ⟨h p hp', fun q hq => by
        have : q.id ≠ p := fun heq => hp e he q hq (heq ▸ hp')
        simp [this]⟩⟩
    · refine List.filter_congr fun n hn => ?_
      simp only [wellFormed, List.all_append]
      refine Bool.eq_iff_iff.2 ?_
      simp only [List.all_eq_true, Bool.and_eq_true]
      exact ⟨fun h p hp' => (h p hp').2, fun h p hp' => ⟨fun q hq => by simp [hd q hq n hn], h p hp'⟩⟩
  rw [hf]
  have hsub : (held.filter (wellFormed held) ++ new.filter (wellFormed new)).Sublist (held ++ new) :=
    List.filter_sublist.append List.filter_sublist
  have hids' := hids.sublist (hsub.map Edit.id)
  apply List.Perm.eq_of_pairwise (le := fun a b => Edit.before a b = true)
  · intro a b ha hb hab hba
    have ha' := List.mem_mergeSort.1 ha
    have hb' : b ∈ held.filter (wellFormed held) ++ new.filter (wellFormed new) := by
      rcases List.mem_append.1 hb with hb | hb
      · exact List.mem_append_left _ (List.mem_mergeSort.1 hb)
      · exact List.mem_append_right _ (List.mem_mergeSort.1 hb)
    exact eq_of_id_eq hids' ha' hb' (before_antisymm hab hba)
  · exact List.pairwise_mergeSort before_trans before_total _
  · refine List.pairwise_append.2 ⟨List.pairwise_mergeSort before_trans before_total _,
      List.pairwise_mergeSort before_trans before_total _, fun a ha b hb => ?_⟩
    have ha' := (List.mem_filter.1 (List.mem_mergeSort.1 ha)).1
    have hb' := (List.mem_filter.1 (List.mem_mergeSort.1 hb)).1
    simp [Edit.before, hd a ha' b hb']
  · exact (List.mergeSort_perm _ _).trans ((List.mergeSort_perm _ _).symm.append (List.mergeSort_perm _ _).symm)

/-! ## The removals that stand -/

/-- A fold whose two step functions agree on everything a fold over the list meets gives one result. -/
theorem foldl_congr_inv {α β : Type} (P : β → Prop) (Q : α → Prop) (f g : β → α → β)
    (hfg : ∀ b a, P b → Q a → f b a = g b a) (hP : ∀ b a, P b → Q a → P (f b a)) :
    ∀ (l : List α) (b : β), (∀ a ∈ l, Q a) → P b → l.foldl f b = l.foldl g b
  | [], _, _, _ => rfl
  | a :: l, b, hl, hb => by
    simp only [List.foldl_cons]
    rw [← hfg b a hb (hl a List.mem_cons_self)]
    exact foldl_congr_inv P Q f g hfg hP l (f b a) (fun x hx => hl x (List.mem_cons_of_mem _ hx))
      (hP b a hb (hl a List.mem_cons_self))

/-- Two tests that agree on every member of a list agree on all of it. -/
theorem all_congr_mem {α : Type} {f g : α → Bool} : ∀ {l : List α}, (∀ x ∈ l, f x = g x) → l.all f = l.all g
  | [], _ => rfl
  | a :: l, h => by
    simp only [List.all_cons, h a List.mem_cons_self, all_congr_mem fun x hx => h x (List.mem_cons_of_mem _ hx)]

/-- New writes after the edits held leave the removals that stand as they were. -/
theorem resolve_append {held new : List Edit} (hw : ∀ n ∈ new, n.action.isWrite = true)
    (hdis : ∀ x ∈ held, ∀ n ∈ new, x.id ≠ n.id) : resolve (held ++ new) = resolve held := by
  -- the replay without removals ends with the vaults and the shares it ended with before, so on every priority
  have hbase := runWith_append (held := held) (rem := []) hw (by simp)
  have hprio : priority (runWith (held ++ new) []).1 = priority (runWith held []).1 := by
    rw [hbase]
    obtain ⟨hv, hc⟩ := stepsOn_keeps (runWith held []).1 new hw
    exact priority_congr hv hc
  -- the candidates are the removals held
  have hnil : new.filter Edit.isRemoval = [] :=
    List.filter_eq_nil_iff.2 fun n hn => by simp [isRemoval_of_isWrite (hw n hn)]
  have hcands : (held ++ new).filter Edit.isRemoval = held.filter Edit.isRemoval := by
    rw [List.filter_append, hnil, List.append_nil]
  unfold resolve
  dsimp only
  rw [hprio, hcands]
  -- each candidate is kept on both sides alike: the new writes have other ids
  refine foldl_congr_inv (fun rem => ∀ x ∈ rem, x ∈ held) (· ∈ held) _ _ (fun rem r hrem hr => ?_)
    (fun rem r hrem hr => ?_) _ [] (fun r hr => (List.mem_filter.1 (List.mem_mergeSort.1 hr)).1) (by simp)
  · have hx : ∀ x ∈ rem ++ [r], ∀ n ∈ new, x.id ≠ n.id := fun x hx => by
      rcases List.mem_append.1 hx with hx | hx
      · exact hdis x (hrem x hx)
      · rw [List.mem_singleton] at hx; exact hx ▸ hdis r hr
    have hall : ((r :: rem).all fun x => (runWith (held ++ new) (rem ++ [r])).2.any (·.id == x.id)) =
        ((r :: rem).all fun x => (runWith held (rem ++ [r])).2.any (·.id == x.id)) := by
      refine all_congr_mem fun x hx' => ?_
      have hxh : x ∈ held := by
        rcases List.mem_cons.1 hx' with rfl | hx'
        · exact hr
        · exact hrem x hx'
      have : (stepsOn (runWith held (rem ++ [r])).1 new).2.any (·.id == x.id) = false := by
        refine List.any_eq_false.2 fun n hn => ?_
        simp only [beq_iff_eq]
        exact fun heq => hdis x hxh n (stepsOn_sub _ _ n hn) heq.symm
      simp only [runWith_append hw hx, List.any_append, this, Bool.or_false]
    simp only [hall]
  · split
    · intro x hx
      rcases List.mem_append.1 hx with hx | hx
      · exact hrem x hx
      · rw [List.mem_singleton] at hx; exact hx ▸ hr
    · exact hrem
where
  stepsOn_sub : ∀ (st : State) (l : List Edit), ∀ n ∈ (stepsOn st l).2, n ∈ l
    | _, [] => by simp [stepsOn]
    | st, e :: l => by
      unfold stepsOn
      split
      · rename_i st' _
        intro n hn
        rcases List.mem_cons.1 hn with rfl | hn
        · exact List.mem_cons_self
        · exact List.mem_cons_of_mem _ (stepsOn_sub st' l n hn)
      · exact fun n hn => List.mem_cons_of_mem _ (stepsOn_sub st l n hn)

/-! ## The stored view -/

/-- The edits of `order` are among the edits. -/
theorem mem_of_mem_order {edits : List Edit} {x : Edit} (h : x ∈ order edits) : x ∈ edits :=
  (List.mem_filter.1 (List.mem_mergeSort.1 h)).1

/-- The removals that stand are among the edits. -/
theorem mem_of_mem_resolve (edits : List Edit) : ∀ x ∈ resolve edits, x ∈ edits := by
  unfold resolve
  refine Keys.foldl_inv_mem (fun rem => ∀ x ∈ rem, x ∈ edits) _ _ (fun rem r hr hrem => ?_) [] (by simp)
  have hr' := (List.mem_filter.1 (List.mem_mergeSort.1 hr)).1
  dsimp only
  split
  · intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact hrem x hx
    · rw [List.mem_singleton] at hx; exact hx ▸ hr'
  · exact hrem

theorem V1_view_steps_on (held new : List Edit) (hw : ∀ n ∈ new, n.action.isWrite = true)
    (hd : ∀ e ∈ held, ∀ n ∈ new, e.depth < n.depth) (hp : ∀ e ∈ held, ∀ n ∈ new, n.id ∉ e.parents)
    (hids : ((held ++ new).map Edit.id).Nodup) :
    view (held ++ new) = (stepsOn (view held) (order new)).1 ∧
      standing (held ++ new) = standing held ++ (stepsOn (view held) (order new)).2 := by
  have hw' : ∀ n ∈ order new, n.action.isWrite = true := fun n hn => hw n (mem_of_mem_order hn)
  have hdis : ∀ x ∈ held, ∀ n ∈ new, x.id ≠ n.id := by
    rw [List.map_append, List.nodup_append] at hids
    exact fun x hx n hn => hids.2.2 _ (List.mem_map_of_mem hx) _ (List.mem_map_of_mem hn)
  have hdis' : ∀ x ∈ order held, ∀ n ∈ order new, x.id ≠ n.id := fun x hx n hn =>
    hdis x (mem_of_mem_order hx) n (mem_of_mem_order hn)
  have hrem : ∀ x ∈ resolve (order held), ∀ n ∈ order new, x.id ≠ n.id := fun x hx =>
    hdis' x (mem_of_mem_resolve _ x hx)
  unfold view standing
  simp only []
  rw [order_append hd hp hids, resolve_append hw' hdis', runWith_append hw' hrem]
  exact ⟨rfl, rfl⟩

end AvenDB.Stored
