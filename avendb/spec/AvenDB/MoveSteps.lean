import AvenDB.TrustRuns

/-!
# A move steps on a stored view

The proof of V3, the first part of M2b of the master plan: a device steps a new mark that takes an entry to another
audience (a move, `Action.mark` with `caps`) on the view it keeps, as it steps new writes (V1), rather than replaying
every edit it holds again, when the move sorts after every edit held, no edit held builds on it, and it keeps every
write of its entry that stands (`keep`). A steward drafting a move keeps every write of the entry its view holds, so its
own moves, and every move a device receives once it holds what the move's steward held, step on.

What a move takes away is its entry's audience, which only the check of a write of that entry reads (`inAudience`, read
by `mayWrite`): every other edit is accepted alike with the audience narrowed (`apply_narrowTo`), and a write is
accepted with it narrowed only where it is without (`apply_narrowTo_mono`). So the move cuts nothing from an edit before
it that stood, but writes of its entry, which it keeps, and nothing stands that didn't (`runFrom_narrow`). A move ranks
after every other removal (`priority`) and sorts after them in the one order, so it is the last removal `resolve` tries
(`mergeSort_append_last`): every removal tried before it is tried on a replay that skips it, as before
(`runWith_skip`), and it stands where it steps on the view (`resolve_move`).
-/

namespace AvenDB

namespace Moves

open Stored Trusted

/-! ## A narrowed audience -/

/-- The state with entry `e` narrowed to audience `to` too, as a move that hadn't seen an edit narrows it. -/
def narrowTo (st : State) (e : EntryId) (to : Audience) : State := { st with narrow := st.narrow ++ [(e, to)] }

/-- An edit writes entry `e`. -/
def writesEntry (edit : Edit) (e : EntryId) : Bool :=
  match edit.action with
  | .write _ x .. => x == e
  | _ => false

theorem narrowTo_trust (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).trust = st.trust := rfl

theorem vault?_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).vault? = st.vault? := by
  rw [← vault?_trust, narrowTo_trust, vault?_trust]

theorem actsVia_narrowTo (st : State) (e : EntryId) (to : Audience) : actsVia (narrowTo st e to) = actsVia st := by
  rw [← actsVia_trust, narrowTo_trust, actsVia_trust]

theorem approves_narrowTo (st : State) (e : EntryId) (to : Audience) : approves (narrowTo st e to) = approves st := by
  rw [← approves_trust, narrowTo_trust, approves_trust]

theorem entry?_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).entry? = st.entry? := by
  cases st; rfl

theorem audienceOk_narrowTo (st : State) (e : EntryId) (to : Audience) :
    audienceOk (narrowTo st e to) = audienceOk st := by
  cases st; rfl

theorem wantsOk_narrowTo (st : State) (e : EntryId) (to : Audience) : wantsOk (narrowTo st e to) = wantsOk st := by
  cases st; rfl

theorem holdsShare_narrowTo (st : State) (e : EntryId) (to : Audience) :
    holdsShare (narrowTo st e to) = holdsShare st := by
  rw [← holdsShare_trust, narrowTo_trust, holdsShare_trust]

theorem chain_narrowTo (st : State) (e : EntryId) (to : Audience) : chain (narrowTo st e to) = chain st := by
  funext c; simp only [chain, chainN_congr (a := narrowTo st e to) (b := st) rfl]; rfl

theorem mayCreate_narrowTo (st : State) (e : EntryId) (to : Audience) :
    mayCreate (narrowTo st e to) = mayCreate st := by
  funext a v x; simp only [mayCreate, intake, holdsShare_narrowTo, chain_narrowTo]; rfl

theorem actsForN_narrowTo (st : State) (e : EntryId) (to : Audience) :
    actsForN (narrowTo st e to) = actsForN st := by
  funext s n
  induction n with
  | zero => rfl
  | succ n ih => funext v; simp only [actsForN, ih, vault?_narrowTo]

theorem entitled_narrowTo (st : State) (e : EntryId) (to : Audience) : entitled (narrowTo st e to) = entitled st := by
  funext d k; simp only [entitled, actsFor, actsForN_narrowTo]; rfl

theorem mayBox_narrowTo (st : State) (e : EntryId) (to : Audience) : mayBox (narrowTo st e to) = mayBox st := by
  funext d k; cases k <;> simp only [mayBox, entitled_narrowTo, entry?_narrowTo] <;> rfl

theorem writes_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).writes = st.writes := rfl
theorem born_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).born = st.born := rfl
theorem seals_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).seals = st.seals := rfl
theorem published_narrowTo (st : State) (e : EntryId) (to : Audience) :
    (narrowTo st e to).published = st.published := rfl
theorem wantsOf_narrowTo (st : State) (e : EntryId) (to : Audience) : (narrowTo st e to).wantsOf = st.wantsOf := by
  cases st; rfl

/-- Narrowing entry `e` changes nothing of another entry's audience. -/
theorem inAudience_narrowTo_other (st : State) {e : EntryId} (to : Audience) (cp : Share) {en : Entry}
    (h : en.id ≠ e) : inAudience (narrowTo st e to) cp en = inAudience st cp en := by
  have : (e != en.id) = true := by simpa using fun h' => h h'.symm
  simp [inAudience, narrowTo, List.all_append, this]

/-- With an audience narrowed, a share reaches an entry only where it reached it before. -/
theorem inAudience_narrowTo_mono (st : State) (e : EntryId) (to : Audience) (cp : Share) (en : Entry)
    (h : inAudience (narrowTo st e to) cp en = true) : inAudience st cp en = true := by
  simp only [inAudience, narrowTo, List.all_append, Bool.and_eq_true, Bool.or_eq_true] at h ⊢
  rcases h with ⟨h1, h2 | ⟨h2, h3, -⟩⟩
  · exact ⟨h1, .inl h2⟩
  · exact ⟨h1, .inr ⟨h2, h3⟩⟩

theorem mayWrite_narrowTo_other (st : State) {e : EntryId} (to : Audience) (a : VaultId) {en : Entry}
    (h : en.id ≠ e) : mayWrite (narrowTo st e to) a en = mayWrite st a en := by
  simp only [mayWrite, holdsShare_narrowTo, inAudience_narrowTo_other st to _ h]; rfl

theorem mayWrite_narrowTo_mono (st : State) (e : EntryId) (to : Audience) (a : VaultId) (en : Entry)
    (h : mayWrite (narrowTo st e to) a en = true) : mayWrite st a en = true := by
  simp only [mayWrite, holdsShare_narrowTo, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with h | ⟨cp, hcp, hh, hi⟩
  · exact .inl h
  · exact .inr ⟨cp, hcp, hh, inAudience_narrowTo_mono st e to cp en hi⟩

/-- The entry `entry?` finds is the one asked for. -/
theorem entry?_id {st : State} {x : EntryId} {en : Entry} (h : st.entry? x = some en) : en.id = x := by
  simpa using List.find?_some h

/-- What an edit's check says, accepted or not, and nothing of the state it leaves. -/
def ok (o : Option State) : Option Unit := o.map fun _ => ()

theorem ok_ite (c : Prop) [Decidable c] (x : Option State) : ok (if c then none else x) = if c then none else ok x := by
  split <;> rfl

theorem ok_ite' (c : Prop) [Decidable c] (x : Option State) : ok (if c then x else none) = if c then ok x else none := by
  split <;> rfl

theorem ok_some (s : State) : ok (some s) = some () := rfl

theorem wrapOk_narrowTo (st : State) (e : EntryId) (to : Audience) : wrapOk (narrowTo st e to) = wrapOk st := by
  funext d x w; simp only [wrapOk, mayBox_narrowTo, seals_narrowTo]

/-- Accepting maps through the trust records alike. -/
theorem ok_trust (o : Option State) : ok o = (o.map State.trust).map fun _ => () := by
  cases o <;> rfl

/-- Every edit but a write of entry `e` is accepted alike with `e`'s audience narrowed. -/
theorem apply_narrowTo (st : State) (e : EntryId) (to : Audience) (edit : Edit) (hw : writesEntry edit e = false) :
    ok (apply (narrowTo st e to) edit) = ok (apply st edit) := by
  by_cases ht : edit.action.isTrust = true
  · rw [ok_trust, ok_trust, ← apply_trust _ _ ht, narrowTo_trust, apply_trust _ _ ht]
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | write v x actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    have hx : x ≠ e := by simpa [writesEntry] using hw
    simp only [apply, writes_narrowTo, actsVia_narrowTo, entry?_narrowTo, born_narrowTo,
      vault?_narrowTo, audienceOk_narrowTo, mayCreate_narrowTo, ok_ite]
    cases create with
    | some p => obtain ⟨x1, hdr⟩ := p; simp only [ok_ite, ok_some]
    | none =>
      simp only
      cases hen : st.entry? x with
      | none => rfl
      | some en =>
        simp only [mayWrite_narrowTo_other st to actor (by rw [entry?_id hen]; exact hx), ok_ite]
        cases en.stayAudience stay with
        | none => rfl
        | some _ => simp only [ok_ite]; split <;> rfl
  | mark v x caps wants keep via =>
    simp only [apply, entry?_narrowTo, actsVia_narrowTo, audienceOk_narrowTo, wantsOk_narrowTo, wantsOf_narrowTo]
    cases st.entry? x with
    | none => rfl
    | some en =>
      cases caps <;> cases wants <;> simp only [ok_ite, ok_some]
  | keys secret to' pub =>
    simp only [apply, mayBox_narrowTo]
    simp only [ok_ite, ok_some]
    rfl
  | checkpoint v c =>
    simp only [apply, vault?_narrowTo, approves_narrowTo]
    simp only [ok_ite', ok_some]
  | wraps x ws =>
    simp only [apply, wrapOk_narrowTo]
    simp only [ok_ite', ok_some]
  | snapshot v c =>
    simp only [apply, vault?_narrowTo, approves_narrowTo]
    simp only [ok_ite', ok_some]
  | _ => simp [Action.isTrust] at ht

/-- A write of entry `e` is accepted with `e`'s audience narrowed only where it is without. -/
theorem apply_narrowTo_mono (st : State) (e : EntryId) (to : Audience) (edit : Edit)
    (h : ok (apply (narrowTo st e to) edit) = some ()) : ok (apply st edit) = some () := by
  cases hw : writesEntry edit e
  · rwa [← apply_narrowTo st e to edit hw]
  rcases edit with ⟨id, depth, author, cosigners, action, parents, files⟩
  cases action with
  | write v x actor stay epoch deps proposal via create tags proof touches fits defines adds =>
    simp only [apply, writes_narrowTo, actsVia_narrowTo, entry?_narrowTo, born_narrowTo,
      vault?_narrowTo, audienceOk_narrowTo, mayCreate_narrowTo, ok_ite] at h ⊢
    cases create with
    | some p => obtain ⟨x1, hdr⟩ := p; simpa only [ok_ite, ok_some] using h
    | none =>
      simp only at h ⊢
      cases hen : st.entry? x with
      | none => rw [hen] at h; simp [ok] at h
      | some en =>
        rw [hen] at h
        simp only [ok_ite] at h ⊢
        cases hm : mayWrite (narrowTo st e to) actor en
        · simp [hm] at h
        · rw [mayWrite_narrowTo_mono st e to actor en hm]
          rw [hm] at h
          rw [← h]
          cases en.stayAudience stay with
          | none => rfl
          | some _ => simp only [ok_ite]; split <;> rfl
  | _ => simp [writesEntry] at hw

/-! ## The run with a move after it -/

/-- Hiding that an entry is in an audience, after other facts, narrows the entry to it. -/
theorem hide_audience (st : State) (fs : List Fact) (e : EntryId) (to : Audience) :
    hide st (fs ++ [.audience e to]) = narrowTo (hide st fs) e to := by
  unfold hide narrowTo
  cases fs with
  | nil =>
    simp only [List.nil_append, List.isEmpty_cons, Bool.false_eq_true, ↓reduceIte, List.isEmpty_nil,
      List.filterMap_cons, List.filterMap_nil, List.append_nil]
    have hv : (st.vaults.map fun vt => { vt with
        owners := vt.owners.filter fun p => ![Fact.audience e to].contains (.owner vt.id p),
        devices := vt.devices.filter fun d => ![Fact.audience e to].contains (.device vt.id d),
        root := if [Fact.audience e to].contains (.root vt.id) then none else vt.root }) = st.vaults := by
      conv => rhs; rw [← List.map_id st.vaults]
      refine List.map_congr_left fun vt _ => ?_
      cases vt; simp
    rw [hv]
  | cons f fs =>
    have h1 : ((f :: fs) ++ [Fact.audience e to]).isEmpty = false := by simp
    have h2 : (f :: fs).isEmpty = false := rfl
    simp only [h1, h2, Bool.false_eq_true, ↓reduceIte, List.filterMap_append, List.contains_append]
    simp [List.append_assoc]

/-- The facts hidden from an edit by one more cut. -/
theorem hiddenAt_append (cs : List (Nat × List EditId × List Fact)) (j : Nat) (keep : List EditId) (fs : List Fact)
    (i : Nat) (edit : Edit) :
    hiddenAt (cs ++ [(j, keep, fs)]) i edit =
      hiddenAt cs i edit ++ (if i < j && !keep.contains edit.id then fs else []) := by
  unfold hiddenAt
  rw [List.filter_append, List.flatMap_append]
  congr 1
  simp only [List.filter_cons, List.filter_nil]
  split <;> simp_all

/-- A move after every edit replayed, keeping every write of its entry that stands there, changes no edit's fate: what
    it takes away is the entry's audience, which only the entry's writes read. -/
theorem runFrom_narrow (rem rem' : List Edit) (cs : List (Nat × List EditId × List Fact)) (j : Nat)
    (keep : List EditId) (e : EntryId) (to : Audience) :
    ∀ (st : State) (l : List (Edit × Nat)),
      (∀ p ∈ l, p.2 < j ∧ rem'.any (·.id == p.1.id) = rem.any (·.id == p.1.id)) →
      (∀ w ∈ (runFrom rem cs st l).2, writesEntry w e = true → keep.contains w.id = true) →
      runFrom rem' (cs ++ [(j, keep, [.audience e to])]) st l = runFrom rem cs st l
  | _, [], _, _ => rfl
  | st, (edit, i) :: rest, hl, hk => by
    obtain ⟨hij, hrem⟩ := hl (edit, i) List.mem_cons_self
    dsimp only at hij hrem
    have hl' := fun p hp => hl p (List.mem_cons_of_mem _ hp)
    rw [runFrom.eq_2] at hk
    rw [runFrom.eq_2, runFrom.eq_2, hrem, hiddenAt_append]
    simp only [hij, decide_true, Bool.true_and]
    split
    · rename_i hr
      simp only [hr, ↓reduceIte] at hk
      exact runFrom_narrow rem rem' cs j keep e to st rest hl' hk
    · rename_i hr
      simp only [hr, Bool.false_eq_true, ↓reduceIte] at hk
      cases hkeep : keep.contains edit.id
      · -- the move hides the entry's audience from the edit
        simp only [Bool.not_false, ↓reduceIte, hide_audience]
        cases hw : writesEntry edit e
        · have hok := apply_narrowTo (hide st (hiddenAt cs i edit)) e to edit hw
          rcases ha : apply (narrowTo (hide st (hiddenAt cs i edit)) e to) edit with _ | a <;>
            rcases hb : apply (hide st (hiddenAt cs i edit)) edit with _ | b <;>
            rw [ha, hb] at hok <;> simp only [ok, Option.map_none, Option.map_some, reduceCtorEq] at hok <;>
            rcases hs : step st edit with _ | st' <;> simp only [hb, hs] at hk ⊢
          all_goals first
            | exact runFrom_narrow rem rem' cs j keep e to st rest hl' hk
            | rw [runFrom_narrow rem rem' cs j keep e to st' rest hl' fun w hw' => hk w (List.mem_cons_of_mem _ hw')]
        · -- a write of the entry the move doesn't keep stood nowhere, and stands nowhere with less
          have hmono := apply_narrowTo_mono (hide st (hiddenAt cs i edit)) e to edit
          rcases ha : apply (narrowTo (hide st (hiddenAt cs i edit)) e to) edit with _ | a <;>
            rcases hb : apply (hide st (hiddenAt cs i edit)) edit with _ | b <;>
            rcases hs : step st edit with _ | st' <;> simp only [hb, hs] at hk ⊢
          all_goals first
            | exact runFrom_narrow rem rem' cs j keep e to st rest hl' hk
            | exact absurd (hk edit List.mem_cons_self hw) (by rw [hkeep]; exact Bool.false_ne_true)
            | (rw [ha, hb] at hmono; simp [ok] at hmono)
      · -- the move kept the edit
        simp only [Bool.not_true, Bool.false_eq_true, ↓reduceIte, List.append_nil]
        rcases hb : apply (hide st (hiddenAt cs i edit)) edit with _ | b <;>
          rcases hs : step st edit with _ | st' <;> simp only [hb, hs] at hk ⊢
        all_goals first
          | exact runFrom_narrow rem rem' cs j keep e to st rest hl' hk
          | rw [runFrom_narrow rem rem' cs j keep e to st' rest hl' fun w hw' => hk w (List.mem_cons_of_mem _ hw')]

/-! ## A move after the edits held -/

section Move

variable {v : VaultId} {e : EntryId} {to : Audience} {wants : Option (List ShareId)} {keep : List EditId}
  {via : List VaultId} {x : Edit}

theorem isRemoval_move (hx : x.action = .mark v e (some to) wants keep via) : x.isRemoval = true := by
  simp [Edit.isRemoval, Action.keep?, hx]

/-- A move issues no grant. -/
theorem sharesIn_move (o : List Edit) (hx : x.action = .mark v e (some to) wants keep via) :
    sharesIn (o ++ [x]) = sharesIn o := by
  simp [sharesIn, List.filterMap_append, hx]

/-- The cuts of the edits with a move after them: the cuts before, and the move's own where it is tried. -/
theorem cuts_move (o rem : List Edit) (hx : x.action = .mark v e (some to) wants keep via) :
    cuts (o ++ [x]) rem =
      cuts o rem ++ (if rem.any (·.id == x.id) then [(o.length, keep, [.audience e to])] else []) := by
  have hs := sharesIn_move o hx
  unfold cuts
  rw [List.zipIdx_append, List.filterMap_append, List.zipIdx_singleton]
  congr 1
  · congr 1
    funext p
    simp only [removes, hs]
  · simp only [List.filterMap_cons, List.filterMap_nil, Nat.zero_add]
    by_cases hr : rem.any (·.id == x.id) = true
    · simp only [hr, ↓reduceIte, removes, Action.keep?, hx, Option.getD_some]
    · simp only [hr, Bool.false_eq_true, ↓reduceIte]

theorem filterMap_congr_mem {α β : Type} {f g : α → Option β} :
    ∀ {l : List α}, (∀ a ∈ l, f a = g a) → l.filterMap f = l.filterMap g
  | [], _ => rfl
  | a :: l, h => by
    simp only [List.filterMap_cons, h a List.mem_cons_self, filterMap_congr_mem fun b hb => h b (List.mem_cons_of_mem _ hb)]

/-- Removals that agree on every edit cut alike. -/
theorem cuts_congr {o rem rem' : List Edit} (h : ∀ r ∈ o, rem.any (·.id == r.id) = rem'.any (·.id == r.id)) :
    cuts o rem = cuts o rem' := by
  unfold cuts
  refine filterMap_congr_mem fun ⟨r, j⟩ hm => ?_
  simp only [h r (List.fst_mem_of_mem_zipIdx hm)]

/-- A removal last, where it is tried and nothing cuts after it, steps. -/
theorem runFrom_last (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) (st : State) (i : Nat)
    (hin : rem.any (·.id == x.id) = true) (hcs : ∀ c ∈ cs, c.1 ≤ i) :
    runFrom rem cs st [(x, i)] = stepsOn st [x] := by
  have hh : hiddenAt cs i x = [] := by
    unfold hiddenAt
    rw [List.filter_eq_nil_iff.2 fun c hc => by have := hcs c hc; simp; omega]
    rfl
  rw [runFrom.eq_2, hh]
  simp only [hin, Bool.not_true, Bool.and_false, Bool.false_eq_true, ↓reduceIte, hide, List.isEmpty_nil]
  rw [stepsOn.eq_2]
  unfold step
  cases apply st x <;> rfl

/-- A replay that doesn't try the move skips it. -/
theorem runWith_skip (o rem : List Edit) (hx : x.action = .mark v e (some to) wants keep via)
    (hrem : rem.any (·.id == x.id) = false) : runWith (o ++ [x]) rem = runWith o rem := by
  unfold runWith
  rw [cuts_move o rem hx, hrem]
  simp only [Bool.false_eq_true, ↓reduceIte, List.append_nil, List.zipIdx_append, List.zipIdx_singleton]
  rw [runFrom_append]
  simp [runFrom, isRemoval_move hx, hrem]

/-- A replay that tries the move, with removals among the edits held that the move doesn't cut, is the replay without it,
    then the move stepped on, where every write of its entry that stands there is one it keeps. -/
theorem runWith_move (o R : List Edit) (hx : x.action = .mark v e (some to) wants keep via)
    (hox : ∀ y ∈ o, y.id ≠ x.id)
    (hk : ∀ w ∈ (runWith o R).2, writesEntry w e = true → keep.contains w.id = true) :
    runWith (o ++ [x]) (R ++ [x]) =
      ((stepsOn (runWith o R).1 [x]).1, (runWith o R).2 ++ (stepsOn (runWith o R).1 [x]).2) := by
  have hrx : ∀ r ∈ o, (R ++ [x]).any (·.id == r.id) = R.any (·.id == r.id) := fun r hr => by
    have : (x.id == r.id) = false := by simpa using fun h => hox r hr h.symm
    simp only [List.any_append, List.any_cons, List.any_nil, this, Bool.or_false]
  have hin : (R ++ [x]).any (·.id == x.id) = true := by simp
  unfold runWith
  rw [cuts_move o _ hx, hin]
  simp only [↓reduceIte]
  rw [cuts_congr hrx, List.zipIdx_append, List.zipIdx_singleton, runFrom_append,
    runFrom_narrow R (R ++ [x]) (cuts o R) o.length keep e to {} o.zipIdx ?hl hk,
    runFrom_last (R ++ [x]) _ _ _ hin ?hcs]
  case hl =>
    intro p hp
    exact ⟨by simpa using (List.mem_zipIdx hp).2.1, hrx p.1 (List.fst_mem_of_mem_zipIdx hp)⟩
  case hcs =>
    intro c hc
    rcases List.mem_append.1 hc with hc | hc
    · have := cuts_lt c hc; omega
    · rw [List.mem_singleton] at hc; subst hc; simp

/-! ## The removals that stand with a move after the edits held -/

/-- Sorting a list with one more element last that ranks after every other one puts it last: the sort is stable. -/
theorem mergeSort_append_last {α : Type} {le : α → α → Bool} (trans : ∀ a b c, le a b → le b c → le a c)
    (total : ∀ a b, le a b || le b a) (l : List α) (x : α) (hx : ∀ a ∈ l, le a x) :
    (l ++ [x]).mergeSort le = l.mergeSort le ++ [x] := by
  rw [← List.mergeSort_zipIdx, ← List.mergeSort_zipIdx (l := l), List.zipIdx_append, List.zipIdx_singleton]
  have hS : (l.zipIdx ++ [(x, 0 + l.length)]).mergeSort (List.zipIdxLE le) =
      l.zipIdx.mergeSort (List.zipIdxLE le) ++ [(x, 0 + l.length)] := by
    have hmem : ∀ p ∈ l.zipIdx ++ [(x, 0 + l.length)], (l ++ [x])[p.2]? = some p.1 := by
      intro p hp
      rw [← List.mem_zipIdx_iff_getElem?, List.zipIdx_append, List.zipIdx_singleton]
      exact hp
    apply List.Perm.eq_of_pairwise (le := fun a b => List.zipIdxLE le a b = true)
    · intro a b ha hb hab hba
      have ha' := hmem a (List.mem_mergeSort.1 ha)
      have hb' : b ∈ l.zipIdx ++ [(x, 0 + l.length)] := by
        rcases List.mem_append.1 hb with hb | hb
        · exact List.mem_append_left _ (List.mem_mergeSort.1 hb)
        · exact List.mem_append_right _ hb
      have hb'' := hmem b hb'
      simp only [List.zipIdxLE] at hab hba
      have hi : a.2 = b.2 := by
        cases h1 : le a.1 b.1 <;> cases h2 : le b.1 a.1 <;>
          simp only [h1, h2, ↓reduceIte, Bool.false_eq_true, decide_eq_true_eq] at hab hba <;> omega
      rw [hi, hb''] at ha'
      exact Prod.ext (Option.some.inj ha').symm hi
    · exact List.pairwise_mergeSort (List.zipIdxLE_trans trans) (List.zipIdxLE_total total) _
    · refine List.pairwise_append.2 ⟨List.pairwise_mergeSort (List.zipIdxLE_trans trans) (List.zipIdxLE_total total) _,
        List.pairwise_singleton _ _, fun a ha b hb => ?_⟩
      rw [List.mem_singleton] at hb
      subst hb
      have ha' := List.mem_mergeSort.1 ha
      have hl := List.mem_zipIdx' ha'
      simp only [List.zipIdxLE, hx a.1 (List.fst_mem_of_mem_zipIdx ha'), ↓reduceIte]
      split <;> simp; omega
    · exact (List.mergeSort_perm _ _).trans ((List.mergeSort_perm _ _).symm.append_right _)
  rw [hS, List.map_append]
  rfl

/-- Every removal ranks no later than a move. -/
theorem prioLe_move (base : State) {a : Edit} (ha : a.isRemoval = true) : prioLe (priority base a) [2, 0, 0, 0] := by
  rcases a with ⟨_, _, _, _, aa, _, _⟩
  cases aa with
  | revoke r =>
    cases r with
    | grant c actor keep via => rfl
    | owner v p keep => unfold priority; simp only; repeat' split
                        all_goals rfl
    | device v d keep => unfold priority; simp only; repeat' split
                         all_goals rfl
  | settings v s =>
    cases s with
    | threshold n => simp [Edit.isRemoval, Action.keep?] at ha
    | root r k => unfold priority; simp only; repeat' split
                  all_goals rfl
  | mark v e caps wants keep via =>
    cases caps with
    | none => simp [Edit.isRemoval, Action.keep?] at ha
    | some to => rfl
  | _ => simp [Edit.isRemoval, Action.keep?] at ha

/-- Every removal `resolve` chooses stands in the replay with them. -/
theorem resolve_stands (edits : List Edit) :
    ∀ y ∈ resolve edits, (runWith edits (resolve edits)).2.any (·.id == y.id) = true := by
  unfold resolve
  refine Keys.foldl_inv_mem (fun rem => ∀ y ∈ rem, (runWith edits rem).2.any (·.id == y.id) = true) _ _
    (fun rem r _ hrem => ?_) [] (by simp)
  dsimp only
  split
  · rename_i h
    rw [List.all_eq_true] at h
    intro y hy
    rcases List.mem_append.1 hy with hy | hy
    · exact h y (List.mem_cons_of_mem _ hy)
    · rw [List.mem_singleton] at hy; subst hy; exact h _ List.mem_cons_self
  · exact hrem

/-- The edits that stand are among the edits replayed. -/
theorem mem_of_runWith (edits rem : List Edit) {y : Edit} (hy : y ∈ (runWith edits rem).2) : y ∈ edits := by
  have := Shares.runFrom_snd_mem rem (cuts edits rem) {} edits.zipIdx y hy
  rwa [List.zipIdx_map_fst] at this

/-- With a move after the edits held, the removals that stand are those that stood, and the move where it steps on
    what the edits held give. -/
theorem resolve_move (o : List Edit) (hx : x.action = .mark v e (some to) wants keep via)
    (hox : ∀ y ∈ o, y.id ≠ x.id)
    (hk : ∀ w ∈ (runWith o (resolve o)).2, writesEntry w e = true → keep.contains w.id = true) :
    resolve (o ++ [x]) = if (step (runWith o (resolve o)).1 x).isSome then resolve o ++ [x] else resolve o := by
  have hnot : ∀ rem : List Edit, (∀ y ∈ rem, y ∈ o) → rem.any (·.id == x.id) = false := fun rem h =>
    List.any_eq_false.2 fun y hy => by simpa using hox y (h y hy)
  -- the replay without removals skips the move, so every removal has the priority it had
  have hbase := runWith_skip o [] hx rfl
  have hcands : (o ++ [x]).filter Edit.isRemoval = o.filter Edit.isRemoval ++ [x] := by
    rw [List.filter_append]; simp [isRemoval_move hx]
  have hpx : priority (runWith o []).1 x = [2, 0, 0, 0] := by simp [priority, hx]
  have hsort := mergeSort_append_last (le := fun a b => prioLe (priority (runWith o []).1 a) (priority (runWith o []).1 b))
    (fun a b c h1 h2 => prioLe_trans _ _ _ h1 h2) (fun a b => prioLe_total _ _) (o.filter Edit.isRemoval) x
    (fun a ha => by rw [hpx]; exact prioLe_move _ (List.mem_filter.1 ha).2)
  have hres : resolve o = ((o.filter Edit.isRemoval).mergeSort fun a b =>
      prioLe (priority (runWith o []).1 a) (priority (runWith o []).1 b)).foldl (fun rem r =>
        if (r :: rem).all (fun y => (runWith o (rem ++ [r])).2.any (·.id == y.id)) then rem ++ [r] else rem) [] := rfl
  conv => lhs; unfold resolve
  dsimp only
  rw [hbase, hcands, hsort, List.foldl_append]
  -- each removal held is tried on a replay that skips the move, as before
  rw [foldl_congr_inv (fun rem => ∀ y ∈ rem, y ∈ o) (· ∈ o) _
    (fun rem r => if (r :: rem).all (fun y => (runWith o (rem ++ [r])).2.any (·.id == y.id)) then rem ++ [r] else rem)
    (fun rem r hrem hr => by
      rw [runWith_skip o _ hx (hnot _ fun y hy => by
        rcases List.mem_append.1 hy with hy | hy
        · exact hrem y hy
        · rw [List.mem_singleton] at hy; exact hy ▸ hr)])
    (fun rem r hrem hr => by
      split
      · intro y hy
        rcases List.mem_append.1 hy with hy | hy
        · exact hrem y hy
        · rw [List.mem_singleton] at hy; exact hy ▸ hr
      · exact hrem)
    _ [] (fun r hr => (List.mem_filter.1 (List.mem_mergeSort.1 hr)).1) (by simp), ← hres]
  -- the move is tried last: it stands where it steps on, and every removal before it still stands
  simp only [List.foldl_cons, List.foldl_nil]
  rw [runWith_move o (resolve o) hx hox hk]
  have hR := hnot (resolve o) (mem_of_mem_resolve o)
  have hcond : ((x :: resolve o).all fun y =>
      ((runWith o (resolve o)).2 ++ (stepsOn (runWith o (resolve o)).1 [x]).2).any (·.id == y.id)) =
      (step (runWith o (resolve o)).1 x).isSome := by
    have hl : (runWith o (resolve o)).2.any (·.id == x.id) = false :=
      List.any_eq_false.2 fun y hy => by simpa using hox y (mem_of_runWith o _ hy)
    have hall : ((resolve o).all fun y =>
        ((runWith o (resolve o)).2 ++ (stepsOn (runWith o (resolve o)).1 [x]).2).any (·.id == y.id)) = true :=
      List.all_eq_true.2 fun y hy => by rw [List.any_append, resolve_stands o y hy, Bool.true_or]
    rw [List.all_cons, hall, Bool.and_true, List.any_append, hl, Bool.false_or, stepsOn.eq_2]
    cases step (runWith o (resolve o)).1 x <;> simp [stepsOn]
  rw [hcond]

end Move


/-! ## The stored view -/

theorem V3_move_steps_on (held : List Edit) (x : Edit) {v : VaultId} {e : EntryId} {to : Audience}
    {wants : Option (List ShareId)} {keep : List EditId} {via : List VaultId}
    (hx : x.action = .mark v e (some to) wants keep via)
    (hd : ∀ y ∈ held, y.depth < x.depth) (hp : ∀ y ∈ held, x.id ∉ y.parents)
    (hids : ((held ++ [x]).map Edit.id).Nodup)
    (hk : ∀ w ∈ standing held, writesEntry w e = true → keep.contains w.id = true) :
    view (held ++ [x]) = (stepsOn (view held) (order [x])).1 ∧
      standing (held ++ [x]) = standing held ++ (stepsOn (view held) (order [x])).2 := by
  have hox : ∀ y ∈ order held, y.id ≠ x.id := by
    rw [List.map_append, List.nodup_append] at hids
    exact fun y hy => hids.2.2 _ (List.mem_map_of_mem (mem_of_mem_order hy)) _ (by simp)
  unfold view standing at *
  simp only [] at *
  rw [order_append (fun y hy n hn => by rw [List.mem_singleton] at hn; subst hn; exact hd y hy)
    (fun y hy n hn => by rw [List.mem_singleton] at hn; subst hn; exact hp y hy) hids]
  by_cases hwf : wellFormed [x] x = true
  · have ho : order [x] = [x] := by simp [order, hwf]
    rw [ho, resolve_move (order held) hx hox hk]
    split
    · rw [runWith_move (order held) _ hx hox hk]
      exact ⟨rfl, rfl⟩
    · rename_i hs
      rw [runWith_skip (order held) _ hx (List.any_eq_false.2 fun y hy => by
        simpa using hox y (mem_of_mem_resolve _ y hy))]
      cases h : step (runWith (order held) (resolve (order held))).1 x with
      | none => simp [stepsOn, h]
      | some _ => simp [h] at hs
  · have ho : order [x] = [] := by simp [order, hwf]
    simp [ho, stepsOn]

end Moves

end AvenDB
