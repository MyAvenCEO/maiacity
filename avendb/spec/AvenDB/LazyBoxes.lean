import AvenDB.Theorems

/-!
# Boxes fetched later

Of what a new device syncs, most is access bookkeeping: `keys` edits, the boxes of a key to whoever the schedule seals
it to, and `wraps` edits, the keys of an entry's earlier stays wrapped under the key of its stay now. Neither changes
the state (`apply`, `wraps_same`): the schedule (`settle`) already says what is sealed to what, and an accepted box only
carries the bytes. So a device can take the state without them, and fetch them later, with an entry's history when it
opens one, or never, where a box goes to a key it can't open.

- Every reachable state is settled: settling it again changes nothing (`settle_self`), because every holder that opens
  a current key may (T6), so nothing is stale, and sealing and linking what is sealed and linked adds nothing
  (`sealAll_idem`). So a box edit, accepted or refused, leaves a reachable state exactly as it was (`step_box`).
- **L1** (`L1_lazy_view`): a device holding every edit but the box edits knows exactly what a device holding them all
  knows, and the same edits stand but the boxes, where no edit it holds names a box edit as a parent as deep as itself
  (`boxesUnder`, which an honest device's depths always meet, and which a device checks as each box arrives).
- **L2** (`L2_lazy_shut_out`): whatever boxes a device holds, it opens a current key only if it may (T6): fewer boxes
  open no more, so a removed device opens nothing new, lazily or not; and the boxes sealed to keys a holder can't open
  are no use to it at all (`L2_unopenable_irrelevant`).
- **L3** (`L3_fetched_checked`): a box fetched later is checked on the state the replay reached just before it, which is
  the state of the edits before it but the boxes: the same check, by the same rules, as if it had come first.
- **D1/D2** (derived entry keys): an entry's keys are derived from the key of the audience of its stay (the exact set of
  shares it falls in) at the epoch of each write; whoever opens that audience key opens them (`D1_member_opens`), and
  in its current stay nobody opens its key but who opens its audience's current key (`D2_entry_iff_audience`).
-/

namespace AvenDB

/-- A box edit: the boxes of one key, or the wraps of one entry's earlier keys. -/
def Action.isBox : Action → Bool
  | .keys .. | .wraps .. => true
  | _ => false

def Edit.isBox (o : Edit) : Bool := o.action.isBox

namespace Lazy

open Keys

/-! ## Folds that change nothing -/

theorem foldl_id {α β : Type} (f : β → α → β) (s : β) : ∀ l : List α, (∀ a ∈ l, f s a = s) → l.foldl f s = s
  | [], _ => rfl
  | a :: l, h => by
    rw [List.foldl_cons, h a List.mem_cons_self]
    exact foldl_id f s l fun b hb => h b (List.mem_cons_of_mem _ hb)

theorem addSeal_of_mem {st : State} {s : Seal} (h : s ∈ st.seals) : addSeal st s = st := by
  unfold addSeal
  split <;> simp_all

theorem publish_of_mem {st : State} {k : KeyName} (h : k ∈ st.published) : publish st k = st := by
  unfold publish
  split <;> simp_all

/-- What a fold makes good of each member, it keeps good, where each step keeps an invariant. -/
theorem foldl_good {α : Type} (f : State → α → State) (Good : State → α → Prop) (Inv : State → Prop)
    (hinv : ∀ acc a, Inv acc → Inv (f acc a)) (hgood : ∀ acc a, Inv acc → Good (f acc a) a)
    (hkeep : ∀ acc a b, Inv acc → Good acc b → Good (f acc a) b) :
    ∀ (l : List α) (acc : State), Inv acc → Inv (l.foldl f acc) ∧ ∀ a ∈ l, Good (l.foldl f acc) a
  | [], acc, h => ⟨h, fun _ h => by cases h⟩
  | a :: l, acc, h => by
    rw [List.foldl_cons]
    have ih := foldl_good f Good Inv hinv hgood hkeep l (f acc a) (hinv acc a h)
    refine ⟨ih.1, fun b hb => ?_⟩
    rcases List.mem_cons.1 hb with rfl | hb
    · -- good after its own step, and kept good by every later one
      suffices hk : ∀ (l' : List α) (acc' : State), Inv acc' → Good acc' b → Good (l'.foldl f acc') b from
        hk l _ (hinv acc b h) (hgood acc b h)
      intro l'
      induction l' with
      | nil => intro _ _ hg; exact hg
      | cons c l' ih' => intro acc' hi hg; exact ih' _ (hinv _ _ hi) (hkeep _ _ _ hi hg)
    · exact ih.2 b hb

/-! ## Linking twice links nothing new -/

/-- The test `linkAll` makes before it links the key of a write of an earlier stay: some seal already puts it under a
    key of the entry's stay now. -/
def linkedIn (seals : List Seal) (en : Entry) (w : Write) : Bool :=
  seals.any fun s => s.secret == w.key && match s.to with
    | .entry e s' _ => e == en.id && s' == en.stay
    | _ => false

/-- What `linkAll` leaves for one entry: its current key under its audience's, each of its writes' keys under its
    stay's audience key of its epoch, and each write's key of an earlier stay under a key of its stay now. -/
def LinkedEntry (z : State) (seals : List Seal) (en : Entry) : Prop :=
  ⟨entryKey z en, z.curKey (.audience en.vault en.audience)⟩ ∈ seals ∧
  ∀ w ∈ z.writes, w.entry = en.id →
    ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩ ∈ seals ∧
    (w.stay == en.stay || linkedIn seals en w) = true

theorem linkedIn_mono {a b : List Seal} (h : ∀ s ∈ a, s ∈ b) {en : Entry} {w : Write}
    (hl : linkedIn a en w = true) : linkedIn b en w = true := by
  unfold linkedIn at *
  obtain ⟨s, hs, hp⟩ := List.any_eq_true.1 hl
  exact List.any_eq_true.2 ⟨s, h s hs, hp⟩

theorem LinkedEntry.mono {z : State} {a b : List Seal} (h : ∀ s ∈ a, s ∈ b) {en : Entry}
    (hl : LinkedEntry z a en) : LinkedEntry z b en :=
  ⟨h _ hl.1, fun w hw he => ⟨h _ (hl.2 w hw he).1, by
    have := (hl.2 w hw he).2
    simp only [Bool.or_eq_true] at this
    rcases this with h' | h'
    · simp [h']
    · simp [linkedIn_mono h h']⟩⟩

/-- One write's turn in `linkAll`. -/
def linkWrite (en : Entry) (acc : State) (w : Write) : State :=
  let acc := addSeal acc ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩
  if w.stay == en.stay || acc.seals.any (fun s => s.secret == w.key && match s.to with
      | .entry e s' _ => e == en.id && s' == en.stay
      | _ => false) then acc
  else addSeal acc ⟨w.key, entryKey acc en⟩

/-- One entry's turn in `linkAll`. -/
def linkEntry (z : State) (acc : State) (en : Entry) : State :=
  (z.writes.filter (·.entry == en.id)).foldl (linkWrite en)
    (addSeal acc ⟨entryKey acc en, acc.curKey (.audience en.vault en.audience)⟩)

theorem linkAll_eq (z : State) : linkAll z = z.entries.foldl (linkEntry z) z := rfl

theorem sealsOnly_linkWrite (en : Entry) (acc : State) (w : Write) : SealsOnly acc (linkWrite en acc w) := by
  unfold linkWrite
  dsimp only
  split
  · exact sealsOnly_addSeal _ _
  · exact (sealsOnly_addSeal _ _).trans (sealsOnly_addSeal _ _)

theorem grow_linkWrite (en : Entry) (acc : State) (w : Write) : ∀ s ∈ acc.seals, s ∈ (linkWrite en acc w).seals := by
  intro s hs
  unfold linkWrite
  dsimp only
  split
  · exact mem_addSeal_of_mem hs
  · exact mem_addSeal_of_mem (mem_addSeal_of_mem hs)

theorem linkWrite_good (en : Entry) (acc : State) (w : Write) :
    ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩ ∈ (linkWrite en acc w).seals ∧
    (w.stay == en.stay || linkedIn (linkWrite en acc w).seals en w) = true := by
  have h₀ := addSeal_mem acc ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩
  unfold linkWrite
  dsimp only
  split
  · rename_i hc
    exact ⟨h₀, by unfold linkedIn; exact hc⟩
  · refine ⟨mem_addSeal_of_mem h₀, ?_⟩
    have hk : ⟨w.key, entryKey (addSeal acc _) en⟩ ∈ (addSeal (addSeal acc ⟨w.key, .scoped (.audience en.vault
        ((en.stayAudience w.stay).getD [])) w.epoch⟩) ⟨w.key, entryKey (addSeal acc ⟨w.key, .scoped
        (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩) en⟩).seals := addSeal_mem _ _
    have : linkedIn (addSeal (addSeal acc ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD []))
        w.epoch⟩) ⟨w.key, entryKey (addSeal acc ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD
        [])) w.epoch⟩) en⟩).seals en w = true := by
      unfold linkedIn
      refine List.any_eq_true.2 ⟨_, hk, ?_⟩
      simp [entryKey]
    simp [this]

/-- After linking, every entry is linked. -/
theorem linkAll_linked (z : State) : ∀ en ∈ z.entries, LinkedEntry z (linkAll z).seals en := by
  rw [linkAll_eq]
  have := foldl_good (linkEntry z) (fun acc en => LinkedEntry z acc.seals en) (SealsOnly z)
    (fun acc en h => ?_) (fun acc en h => ?_) (fun acc en b h hg => ?_) z.entries z (.refl _)
  · exact this.2
  · -- one entry's turn changes only the seals
    unfold linkEntry
    exact foldl_inv (fun a => SealsOnly z a) _ (fun a w ha => ha.trans (sealsOnly_linkWrite _ _ _)) _ _
      (h.trans (sealsOnly_addSeal _ _))
  · -- and links the entry
    have hep := h.epochs
    unfold linkEntry
    have hstart : ⟨entryKey z en, z.curKey (.audience en.vault en.audience)⟩ ∈
        (addSeal acc ⟨entryKey acc en, acc.curKey (.audience en.vault en.audience)⟩).seals := by
      rw [entryKey_congr hep, curKey_congr hep]; exact addSeal_mem _ _
    have hg := foldl_good (linkWrite en)
      (fun a w => ⟨w.key, .scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch⟩ ∈ a.seals ∧
        (w.stay == en.stay || linkedIn a.seals en w) = true)
      (fun a => ⟨entryKey z en, z.curKey (.audience en.vault en.audience)⟩ ∈ a.seals)
      (fun a w ha => grow_linkWrite en a w _ ha) (fun a w _ => linkWrite_good en a w)
      (fun a w b _ hb => ⟨grow_linkWrite en a w _ hb.1, by
        have hb2 := hb.2
        simp only [Bool.or_eq_true] at hb2
        rcases hb2 with h' | h'
        · simp [h']
        · simp [linkedIn_mono (grow_linkWrite en a w) h']⟩)
      (z.writes.filter (·.entry == en.id)) _ hstart
    refine ⟨hg.1, fun w hw he => hg.2 w (List.mem_filter.2 ⟨hw, by simp [he]⟩)⟩
  · -- what is linked stays linked
    refine hg.mono fun s hs => ?_
    unfold linkEntry
    exact foldl_inv (fun a : State => s ∈ a.seals) _ (fun a w ha => grow_linkWrite en a w _ ha) _ _
      (mem_addSeal_of_mem hs)

/-- Linking a state whose entries are all linked changes nothing. -/
theorem linkAll_self {z : State} (h : ∀ en ∈ z.entries, LinkedEntry z z.seals en) : linkAll z = z := by
  rw [linkAll_eq]
  refine foldl_id _ _ _ fun en hen => ?_
  obtain ⟨h₁, h₂⟩ := h en hen
  unfold linkEntry
  rw [addSeal_of_mem h₁]
  refine foldl_id _ _ _ fun w hw => ?_
  have hwe : w.entry = en.id := by simpa using (List.mem_filter.1 hw).2
  obtain ⟨h₃, h₄⟩ := h₂ w (List.mem_filter.1 hw).1 hwe
  unfold linkWrite
  dsimp only
  rw [addSeal_of_mem h₃]
  have : (w.stay == en.stay || z.seals.any (fun s => s.secret == w.key && match s.to with
      | .entry e s' _ => e == en.id && s' == en.stay
      | _ => false)) = true := h₄
  rw [ite_eq_left_iff.2 (fun h => absurd this h)]

/-! ## Sealing twice seals nothing new -/

/-- After sealing, every entry is linked. -/
theorem sealAll_linked (x : State) : ∀ en ∈ (sealAll x).entries, LinkedEntry (sealAll x) (sealAll x).seals en := by
  have hl := linkAll_linked ((keyFams x).foldl sealOne x)
  have hk' : Kept ((keyFams x).foldl sealOne x) (sealAll x) := (sealsOnly_linkAll _).keysOnly.kept
  have hep' : (sealAll x).epochs = ((keyFams x).foldl sealOne x).epochs := (sealsOnly_linkAll _).epochs
  intro en hen
  rw [hk'.entries] at hen
  obtain ⟨h₁, h₂⟩ := hl en hen
  refine ⟨?_, fun w hw he => ?_⟩
  · rw [entryKey_congr hep', curKey_congr hep']; exact h₁
  · rw [hk'.writes] at hw
    exact h₂ w hw he

/-- Sealing a state whose current keys are all sealed to their targets, and published where public, then linked,
    changes nothing: sealing and linking what `sealAll` made again adds nothing. -/
theorem sealAll_idem (x : State) : sealAll (sealAll x) = sealAll x := by
  -- y is what sealing x gave
  have hF := foldl_sealOne_spec x (keyFams x)
  have hso : SealsOnly x (sealAll x) := hF.1.trans (sealsOnly_linkAll _)
  have hk := hso.keysOnly.kept
  have hep := hso.epochs
  have hmono := linkAll_mono ((keyFams x).foldl sealOne x)
  generalize hy : sealAll x = y at hso hk hep
  have hy' : y = linkAll ((keyFams x).foldl sealOne x) := hy.symm
  -- its current keys are sealed to their targets and published where public
  have hsealed : ∀ k ∈ keyFams y, ∀ t ∈ targets y k, ⟨y.curKey k, t⟩ ∈ y.seals := by
    intro k hkf t ht
    rw [hk.keyFams] at hkf
    rw [targets_congr hk.vaults hk.shares hk.revoked hep] at ht
    rw [curKey_congr hep, hy']
    exact hmono.2 _ ((foldl_sealOne_all x (keyFams x) x (.refl _) hkf).1 t ht)
  have hpub : ∀ k ∈ keyFams y, publicKey y k = true → y.curKey k ∈ y.published := by
    intro k hkf hp
    rw [hk.keyFams] at hkf
    rw [hk.publicKey] at hp
    rw [curKey_congr hep, hy', hmono.1]
    exact (foldl_sealOne_all x (keyFams x) x (.refl _) hkf).2 hp
  -- each family's turn changes nothing
  have hone : ∀ k ∈ keyFams y, sealOne y k = y := by
    intro k hkf
    unfold sealOne
    dsimp only
    rw [foldl_id (fun a t => addSeal a ⟨a.curKey k, t⟩) y _ fun t ht => addSeal_of_mem (hsealed k hkf t ht)]
    split
    · rename_i hp; exact publish_of_mem (hpub k hkf hp)
    · rfl
  -- and its entries are linked
  have hlinked : ∀ en ∈ y.entries, LinkedEntry y y.seals en := hy ▸ sealAll_linked x
  rw [sealAll_eq, foldl_id _ _ _ hone, linkAll_self hlinked]

/-! ## Every reachable state is settled -/

/-- `opens` opens only what `Knows` gives. -/
theorem opens_sound {st : State} {start : List KeyName} {x : KeyName} (h : (opens st start).contains x = true) :
    Knows st start x := by
  have hround : ∀ known : List KeyName, (∀ y ∈ known, Knows st start y) →
      ∀ y ∈ openRound st known, Knows st start y := by
    intro known hk
    unfold openRound
    refine foldl_inv_mem (fun acc : List KeyName => ∀ y ∈ acc, Knows st start y) _ st.seals ?_ known hk
    intro acc s hs hacc y hy
    split at hy
    · rename_i hc
      rcases List.mem_append.1 hy with hy | hy
      · exact hacc y hy
      · rw [List.mem_singleton] at hy
        subst hy
        have : s.to ∈ acc := by simp_all
        exact .unseal hs (hacc _ this)
    · exact hacc y hy
  have hall : ∀ n known, (∀ y ∈ known, Knows st start y) → ∀ y ∈ openAll st n known, Knows st start y := by
    intro n
    induction n with
    | zero => intro known hk; exact hk
    | succ n ih =>
      intro known hk
      unfold openAll
      dsimp only
      split
      · exact hk
      · exact ih _ (hround known hk)
  refine hall _ _ (fun y hy => ?_) x (List.contains_iff_mem.1 h)
  rcases List.mem_append.1 hy with hy | hy
  · exact .own hy
  · exact .published hy

/-- In a reachable state nothing is stale against itself: every holder that opens a current key may (T6). -/
theorem staleKeys_self {st : State} (hr : Reachable st) : staleKeys st st = [] := by
  obtain ⟨edits, rfl⟩ := hr
  have hinv := keyInv_replay edits
  generalize replay {} edits = st at hinv
  have hstale : ((keyFams st).filter fun k =>
      (!publicKey st k && ((holders st).map fun h => (h, opens st (h.start st))).any fun (h, o) =>
        o.contains (st.curKey k) && !h.entitled st k) ||
      (!(keyFams st).contains k && st.seals.any (·.secret == st.curKey k))) = [] := by
    refine List.filter_eq_nil_iff.2 fun k hk => ?_
    simp only [List.contains_iff_mem.2 hk, Bool.not_true, Bool.false_and, Bool.or_false]
    intro hc
    simp only [Bool.and_eq_true, Bool.not_eq_true', List.any_map, List.any_eq_true, Function.comp] at hc
    obtain ⟨hp, h, -, ho, he⟩ := hc
    rcases hinv.fwd h k hk (opens_sound ho) with hm | hm
    · simp_all
    · simp_all
  unfold staleKeys
  simp only [hstale, List.nil_append, List.contains_nil, Bool.not_false, Bool.true_and]
  refine List.filter_eq_nil_iff.2 fun k _ => ?_
  cases k <;> simp

/-- The empty state is settled. -/
theorem sealAll_empty : sealAll ({} : State) = {} := by
  rfl

/-- Every reachable state is what sealing it gives. -/
theorem sealAll_reachable {st : State} (hr : Reachable st) : sealAll st = st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv (fun s => sealAll s = s) (fun s edit s' _ hs => ?_) edits {} sealAll_empty
  obtain ⟨post, -, rfl⟩ := Option.map_eq_some_iff.1 hs
  exact sealAll_idem _

/-- Every reachable state is settled: settling it against itself changes nothing. -/
theorem settle_self {st : State} (hr : Reachable st) : settle st st = st := by
  unfold settle
  rw [staleKeys_self hr, List.foldl_nil, sealAll_reachable hr]

/-- A box edit, accepted or refused, leaves a reachable state as it was. -/
theorem apply_box {st : State} {o : Edit} (hb : o.isBox = true) : apply st o = none ∨ apply st o = some st := by
  unfold Edit.isBox Action.isBox at hb
  split at hb
  · rename_i secret to pub h
    have : apply st o = if !mayBox st o.author secret then none
        else if !to.all (fun t => st.seals.contains ⟨secret, t⟩) then none
        else if pub && !st.published.contains secret then none else some st := by
      simp only [apply, h]
    rw [this]
    split
    · exact .inl rfl
    · split
      · exact .inl rfl
      · split
        · exact .inl rfl
        · exact .inr rfl
  · rename_i e ws h
    have : apply st o = if (!ws.isEmpty && ws.all (wrapOk st o.author e)) = true then some st else none := by
      simp only [apply, h]
    rw [this]
    split
    · exact .inr rfl
    · exact .inl rfl
  · cases hb

theorem step_box {st : State} (hr : Reachable st) {o : Edit} (hb : o.isBox = true) :
    step st o = none ∨ step st o = some st := by
  unfold step
  rcases apply_box (st := st) hb with h | h
  · exact .inl (by rw [h]; rfl)
  · exact .inr (by rw [h]; simp [settle_self hr])


/-! ## Reachable states along a run -/

theorem replay_append : ∀ (st : State) (a b : List Edit), replay st (a ++ b) = replay (replay st a) b
  | _, [], _ => rfl
  | st, e :: a, b => replay_append ((step st e).getD st) a b

theorem reachable_step {st st' : State} (hr : Reachable st) {e : Edit} (h : step st e = some st') :
    Reachable st' := by
  obtain ⟨es, rfl⟩ := hr
  refine ⟨es ++ [e], ?_⟩
  rw [replay_append]
  show st' = replay ((step (replay {} es) e).getD (replay {} es)) []
  rw [h]; rfl

theorem reachable_empty : Reachable ({} : State) := ⟨[], rfl⟩

/-- A box edit is no removal. -/
theorem box_not_removal {o : Edit} (h : o.isBox = true) : o.isRemoval = false := by
  unfold Edit.isBox Action.isBox at h
  unfold Edit.isRemoval Action.keep?
  split at h <;> simp_all

/-- What a box edit takes away: nothing. -/
theorem removes_box (edits : List Edit) {o : Edit} (h : o.isBox = true) : removes edits o = [] := by
  unfold Edit.isBox Action.isBox at h
  unfold removes
  split at h <;> simp_all

/-! ## Runs by what comes after

`runFrom` tells which removals come after an edit by their places in the list. The same run, told by the edits after
it (`runSuf`), is one that a device holding fewer edits runs alike. -/

/-- The facts the removals of `rem` among `rest`, the edits after `e`, hide from it, `all` being every edit. -/
def hiddenSuf (rem all rest : List Edit) (e : Edit) : List Fact :=
  (rest.filter fun r => rem.any (·.id == r.id) && !(r.action.keep?.getD []).contains e.id).flatMap (removes all)

/-- `runFrom`, each edit's hidden facts read off the edits after it. -/
def runSuf (rem all : List Edit) : State → List Edit → State × List Edit
  | st, [] => (st, [])
  | st, e :: rest =>
    if e.isRemoval && !rem.any (·.id == e.id) then runSuf rem all st rest
    else match apply (hide st (hiddenSuf rem all rest e)) e, step st e with
      | some _, some st' => let r := runSuf rem all st' rest; (r.1, e :: r.2)
      | _, _ => runSuf rem all st rest

/-- The facts hidden from the edit at place `i` are those the removals after it take away. -/
theorem hiddenAt_cuts (rem all : List Edit) (i : Nat) (e : Edit) :
    ∀ (l : List Edit) (n : Nat),
      (((l.zipIdx n).filterMap fun (r, j) =>
          if rem.any (·.id == r.id) then some (j, r.action.keep?.getD [], removes all r) else none).filter
        fun (j, keep, _) => decide (i < j) && !keep.contains e.id).flatMap (·.2.2) =
      hiddenSuf rem all (l.drop (i + 1 - n)) e
  | [], n => by simp [hiddenSuf]
  | a :: l, n => by
    have ih := hiddenAt_cuts rem all i e l (n + 1)
    rw [List.zipIdx_cons, List.filterMap_cons]
    by_cases hi : i < n
    · have h0 : i + 1 - n = 0 := by omega
      have h1 : i + 1 - (n + 1) = 0 := by omega
      rw [h1] at ih
      rw [h0, List.drop_zero]
      rw [List.drop_zero] at ih
      unfold hiddenSuf at ih ⊢
      by_cases hr : rem.any (·.id == a.id) = true
      · simp only [hr, ite_true, List.filter_cons, decide_eq_true hi, Bool.true_and] at ih ⊢
        split <;> simp_all
      · simp only [hr, List.filter_cons, Bool.false_and] at ih ⊢
        simpa using ih
    · have h0 : i + 1 - n = (i - n) + 1 := by omega
      have h1 : i + 1 - (n + 1) = i - n := by omega
      rw [h1] at ih
      rw [h0, List.drop_succ_cons, ← ih]
      by_cases hr : rem.any (·.id == a.id) = true
      · simp [hr, hi]
      · simp [hr]

theorem hiddenAt_eq (rem all : List Edit) (i : Nat) (e : Edit) :
    hiddenAt (cuts all rem) i e = hiddenSuf rem all (all.drop (i + 1)) e := by
  have := hiddenAt_cuts rem all i e all 0
  rw [Nat.sub_zero] at this
  rw [← this]
  simp only [hiddenAt, cuts]

/-- A run told by places is the run told by the edits after each. -/
theorem runFrom_suf (rem all : List Edit) :
    ∀ (l : List Edit) (n : Nat) (st : State), all.drop n = l →
      runFrom rem (cuts all rem) st (l.zipIdx n) = runSuf rem all st l
  | [], _, _, _ => rfl
  | e :: l, n, st, h => by
    have hl : all.drop (n + 1) = l := by
      rw [← List.drop_drop, h]; rfl
    rw [List.zipIdx_cons, runFrom.eq_2, runSuf.eq_2, hiddenAt_eq, hl]
    split
    · exact runFrom_suf rem all l (n + 1) st hl
    · rcases apply (hide st (hiddenSuf rem all l e)) e with _ | a <;>
        rcases step st e with _ | st' <;> dsimp only <;>
        first | rw [runFrom_suf rem all l (n + 1) st' hl] | rw [runFrom_suf rem all l (n + 1) st hl]

theorem runWith_suf (o rem : List Edit) : runWith o rem = runSuf rem o {} o :=
  runFrom_suf rem o o 0 {} rfl

theorem runSuf_snd_mem (rem all : List Edit) :
    ∀ (st : State) (l : List Edit), ∀ x ∈ (runSuf rem all st l).2, x ∈ l
  | _, [] => by simp [runSuf]
  | st, e :: rest => by
    unfold runSuf
    split
    · exact fun x hx => List.mem_cons_of_mem _ (runSuf_snd_mem rem all st rest x hx)
    · split
      · rename_i st' _ _
        intro x hx
        rcases List.mem_cons.1 hx with rfl | hx
        · exact List.mem_cons_self
        · exact List.mem_cons_of_mem _ (runSuf_snd_mem rem all st' rest x hx)
      · exact fun x hx => List.mem_cons_of_mem _ (runSuf_snd_mem rem all st rest x hx)

/-! ## Leaving the boxes out -/

/-- Not a box. -/
abbrev nb (o : Edit) : Bool := !o.isBox

theorem filterMap_filter_of {α β : Type} (p : α → Bool) (f : α → Option β) :
    ∀ l : List α, (∀ x ∈ l, p x = false → f x = none) → (l.filter p).filterMap f = l.filterMap f
  | [], _ => rfl
  | a :: l, h => by
    have ih := filterMap_filter_of p f l fun x hx => h x (List.mem_cons_of_mem _ hx)
    by_cases ha : p a = true
    · simp [ha, List.filterMap_cons, ih]
    · have : f a = none := h a List.mem_cons_self (by simpa using ha)
      simp [ha, this, ih]

theorem flatMap_filter_of {α β : Type} (p : α → Bool) (f : α → List β) :
    ∀ l : List α, (∀ x ∈ l, p x = false → f x = []) → (l.filter p).flatMap f = l.flatMap f
  | [], _ => rfl
  | a :: l, h => by
    have ih := flatMap_filter_of p f l fun x hx => h x (List.mem_cons_of_mem _ hx)
    by_cases ha : p a = true
    · simp [ha, ih]
    · have : f a = [] := h a List.mem_cons_self (by simpa using ha)
      simp [ha, this, ih]

/-- Box edits issue no grants. -/
theorem sharesIn_lazy (all : List Edit) : sharesIn (all.filter nb) = sharesIn all := by
  unfold sharesIn
  refine filterMap_filter_of nb _ all fun x _ hx => ?_
  have hb : x.isBox = true := by simpa [nb] using hx
  unfold Edit.isBox Action.isBox at hb
  split at hb <;> simp_all

theorem removes_lazy (all : List Edit) (r : Edit) : removes (all.filter nb) r = removes all r := by
  unfold removes
  rw [sharesIn_lazy]

theorem filter_comm' {α : Type} (p q : α → Bool) (l : List α) :
    (l.filter p).filter q = (l.filter q).filter p := by
  simp only [List.filter_filter, Bool.and_comm]

/-- The boxes left out, each edit has the same facts hidden. -/
theorem hiddenSuf_lazy (rem all rest : List Edit) (e : Edit) :
    hiddenSuf rem (all.filter nb) (rest.filter nb) e = hiddenSuf rem all rest e := by
  unfold hiddenSuf
  rw [filter_comm', show removes (all.filter nb) = removes all from funext (removes_lazy all)]
  refine flatMap_filter_of nb _ _ fun x _ hx => removes_box all (by simpa [nb] using hx)


/-- Leaving the boxes out of a run from a reachable state ends in the same state, with the same edits standing but
    the boxes. -/
theorem runSuf_lazy (rem all : List Edit) :
    ∀ (l : List Edit) (st : State), Reachable st →
      (runSuf rem all st l).1 = (runSuf rem (all.filter nb) st (l.filter nb)).1 ∧
      (runSuf rem all st l).2.filter nb = (runSuf rem (all.filter nb) st (l.filter nb)).2
  | [], _, _ => ⟨rfl, rfl⟩
  | e :: rest, st, hr => by
    by_cases hb : e.isBox = true
    · -- a box changes nothing, standing or not
      have hf : (e :: rest).filter nb = rest.filter nb := by simp [nb, hb]
      rw [hf]
      have ih := runSuf_lazy rem all rest st hr
      rw [runSuf.eq_2, box_not_removal hb]
      simp only [Bool.false_and, Bool.false_eq_true, ite_false]
      rcases step_box hr hb with hs | hs
      · rw [hs]
        split
        · rename_i h; cases h
        · exact ih
      · rw [hs]
        split
        · rename_i st' _ heq
          cases heq
          refine ⟨ih.1, ?_⟩
          simp only [List.filter_cons, nb, hb, Bool.not_true]
          exact ih.2
        · exact ih
    · have hf : (e :: rest).filter nb = e :: rest.filter nb := by simp [nb, hb]
      rw [hf, runSuf.eq_2, runSuf.eq_2, hiddenSuf_lazy]
      split
      · exact runSuf_lazy rem all rest st hr
      · split
        · rename_i st' _ hs
          have ih := runSuf_lazy rem all rest st' (reachable_step hr hs)
          refine ⟨ih.1, ?_⟩
          simp only [List.filter_cons, nb, hb, Bool.not_false, ite_true]
          exact congrArg _ ih.2
        · exact runSuf_lazy rem all rest st hr

/-- Replaying the edits, the boxes left out, with the same removals: the same state, the same edits standing but the
    boxes. -/
theorem runWith_lazy (o rem : List Edit) :
    (runWith (o.filter nb) rem).1 = (runWith o rem).1 ∧
    (runWith (o.filter nb) rem).2 = (runWith o rem).2.filter nb := by
  rw [runWith_suf, runWith_suf]
  have := runSuf_lazy rem o o {} reachable_empty
  exact ⟨this.1.symm, this.2.symm⟩

/-! ## The order and the removals that stand -/

/-- No edit but a box names a box edit as a parent as deep as itself, which would make it malformed (`wellFormed`). A
    device that has the edit but not the box can't tell; it checks this as each box arrives, and an honest device's
    depths always meet it. -/
def boxesUnder (edits : List Edit) : Prop :=
  ∀ e ∈ edits, e.isBox = false → ∀ q ∈ edits, q.isBox = true → q.id ∈ e.parents → q.depth < e.depth

theorem wellFormed_lazy {edits : List Edit} (hb : boxesUnder edits) {e : Edit} (he : e ∈ edits)
    (hn : e.isBox = false) : wellFormed (edits.filter nb) e = wellFormed edits e := by
  unfold wellFormed
  rw [Bool.eq_iff_iff]
  simp only [List.all_eq_true, List.mem_filter]
  constructor
  · intro h pid hp q hq
    by_cases hqb : q.isBox = true
    · by_cases hid : q.id = pid
      · subst hid
        simp [hb e he hn q hq hqb hp]
      · simp [hid]
    · exact h pid hp q ⟨hq, by simpa [nb] using hqb⟩
  · intro h pid hp q hq
    exact h pid hp q hq.1

theorem order_lazy {edits : List Edit} (hb : boxesUnder edits) (hids : ((order edits).map Edit.id).Nodup) :
    order (edits.filter nb) = (order edits).filter nb := by
  unfold order at hids ⊢
  have hX : (edits.filter nb).filter (wellFormed (edits.filter nb)) = (edits.filter (wellFormed edits)).filter nb := by
    rw [List.filter_filter, List.filter_filter]
    refine List.filter_congr fun e he => ?_
    by_cases hn : e.isBox = true
    · simp [nb, hn]
    · have hn' : e.isBox = false := by simpa using hn
      rw [wellFormed_lazy hb he hn']
      simp [nb, hn', Bool.and_comm]
  rw [hX]
  generalize edits.filter (wellFormed edits) = X at hids ⊢
  have hidsX : (X.map Edit.id).Nodup := ((List.mergeSort_perm X _).map Edit.id).nodup_iff.1 hids
  apply List.Perm.eq_of_pairwise (le := fun a b => Edit.before a b = true)
  · intro a b ha hb' hab hba
    have ha' : a ∈ X := (List.mem_filter.1 (List.mem_mergeSort.mp ha)).1
    have hb'' : b ∈ X := List.mem_mergeSort.mp (List.mem_filter.1 hb').1
    exact Syncing.eq_of_id_eq hidsX ha' hb'' (Syncing.before_antisymm hab hba)
  · exact List.pairwise_mergeSort Syncing.before_trans Syncing.before_total _
  · exact (List.pairwise_mergeSort Syncing.before_trans Syncing.before_total _).filter _
  · exact (List.mergeSort_perm _ _).trans ((List.mergeSort_perm X _).filter nb).symm

theorem removal_nb {o : Edit} (h : o.isRemoval = true) : nb o = true := by
  by_cases hb : o.isBox = true
  · rw [box_not_removal hb] at h; cases h
  · simpa [nb] using hb

/-- Two folds whose steps agree wherever an invariant holds, and keep it, agree. -/
theorem foldl_congr_inv {α β : Type} (f g : β → α → β) (Inv : β → Prop) :
    ∀ (l : List α) (b : β), Inv b → (∀ b a, a ∈ l → Inv b → f b a = g b a ∧ Inv (f b a)) →
      l.foldl f b = l.foldl g b
  | [], _, _, _ => rfl
  | a :: l, b, hb, h => by
    rw [List.foldl_cons, List.foldl_cons, ← (h b a List.mem_cons_self hb).1]
    exact foldl_congr_inv f g Inv l _ (h b a List.mem_cons_self hb).2
      fun b' a' ha' hb' => h b' a' (List.mem_cons_of_mem _ ha') hb'

/-- The boxes left out, the same removals stand. -/
theorem resolve_lazy (o : List Edit) (hids : (o.map Edit.id).Nodup) : resolve (o.filter nb) = resolve o := by
  unfold resolve
  dsimp only
  rw [(runWith_lazy o []).1]
  have hc : (o.filter nb).filter Edit.isRemoval = o.filter Edit.isRemoval := by
    rw [List.filter_filter]
    refine List.filter_congr fun e _ => ?_
    by_cases h : e.isRemoval = true
    · simp [h, removal_nb h]
    · simp at h; simp [h]
  rw [hc]
  refine foldl_congr_inv _ _ (fun rem : List Edit => ∀ x ∈ rem, x ∈ o ∧ x.isRemoval = true) _ [] (by simp) ?_
  intro rem r hr hinv
  have hr' := List.mem_filter.1 (List.mem_mergeSort.mp hr)
  -- a removal stood with the boxes exactly when without them
  have hany : ∀ x, x ∈ o → x.isRemoval = true →
      ((runWith (o.filter nb) (rem ++ [r])).2.any (·.id == x.id)) =
        ((runWith o (rem ++ [r])).2.any (·.id == x.id)) := by
    intro x hx hxr
    rw [(runWith_lazy o (rem ++ [r])).2, Bool.eq_iff_iff]
    simp only [List.any_eq_true, List.mem_filter, beq_iff_eq]
    constructor
    · rintro ⟨y, ⟨hy, -⟩, hid⟩; exact ⟨y, hy, hid⟩
    · rintro ⟨y, hy, hid⟩
      have hyo : y ∈ o := by rw [runWith_suf] at hy; exact runSuf_snd_mem _ _ _ _ y hy
      have := Syncing.eq_of_id_eq hids hyo hx hid
      subst this
      exact ⟨y, ⟨hy, removal_nb hxr⟩, rfl⟩
  have hall : ((r :: rem).all fun x => (runWith (o.filter nb) (rem ++ [r])).2.any (·.id == x.id)) =
      ((r :: rem).all fun x => (runWith o (rem ++ [r])).2.any (·.id == x.id)) := by
    rw [Bool.eq_iff_iff]
    simp only [List.all_eq_true]
    constructor
    · intro h x hx
      rcases List.mem_cons.1 hx with rfl | hx
      · rw [← hany _ hr'.1 hr'.2]; exact h _ hx
      · rw [← hany _ (hinv x hx).1 (hinv x hx).2]; exact h _ (List.mem_cons_of_mem _ hx)
    · intro h x hx
      rcases List.mem_cons.1 hx with rfl | hx
      · rw [hany _ hr'.1 hr'.2]; exact h _ List.mem_cons_self
      · rw [hany _ (hinv x hx).1 (hinv x hx).2]; exact h _ (List.mem_cons_of_mem _ hx)
  refine ⟨by simp only [hall], ?_⟩
  simp only [hall]
  split
  · intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact hinv x hx
    · rw [List.mem_singleton] at hx; subst hx; exact hr'
  · exact hinv

/-- **L1** (a first sync without the boxes): a device holding the edits but the box edits knows exactly what a device
    holding them all knows, with the same edits standing but the boxes, where no edit it holds names a box edit as a
    parent as deep as itself. Assumes ids don't collide. -/
theorem L1_lazy_view (edits : List Edit) (hids : ((order edits).map Edit.id).Nodup) (hb : boxesUnder edits) :
    view (edits.filter nb) = view edits ∧ standing (edits.filter nb) = (standing edits).filter nb := by
  unfold view standing
  dsimp only
  rw [order_lazy hb hids, resolve_lazy _ hids]
  exact runWith_lazy _ _

/-! ## Boxes held, and boxes fetched later -/

/-- Fewer seals open no more. -/
theorem knows_sub {st : State} {sub : List Seal} (h : ∀ s ∈ sub, s ∈ st.seals) {start : List KeyName}
    {k : KeyName} (hk : Knows { st with seals := sub } start k) : Knows st start k := by
  induction hk with
  | own hx => exact .own hx
  | published hx => exact .published hx
  | «unseal» hs _ ih => exact .unseal (h _ hs) ih

/-- **L2** (shut out, whatever boxes it holds): in a reachable state a holder that holds any part of the boxes the
    schedule seals opens the current key of a family in use only if it may (T6), so a removed device opens no key of
    an epoch after its removal, however many boxes it fetched or skipped. -/
theorem L2_lazy_shut_out {st : State} (hr : Reachable st) (h : Holder) {k : KeyFam} (hkf : k ∈ keyFams st)
    {sub : List Seal} (hsub : ∀ s ∈ sub, s ∈ st.seals)
    (hk : Knows { st with seals := sub } (h.start st) (st.curKey k)) : MayOpen st h k :=
  T6_forward_secrecy hr h hkf (knows_sub hsub hk)

/-- **L2**, boxes it can't open: leaving out every box sealed to a key a holder can't open, it opens exactly what it
    opens with them all. Such boxes need never reach it. -/
theorem L2_unopenable_irrelevant (st : State) (start : List KeyName) (k : KeyName) :
    Knows { st with seals := st.seals.filter fun s => knows st start s.to } start k ↔ Knows st start k := by
  constructor
  · exact knows_sub fun s hs => (List.mem_filter.1 hs).1
  · intro hk
    induction hk with
    | own hx => exact .own hx
    | published hx => exact .published hx
    | «unseal» hs hto ih =>
      exact .unseal (List.mem_filter.2 ⟨hs, opens_complete hto⟩) ih

/-- A run with the boxes left out, every edit keeping its place: the same state. -/
theorem runFrom_lazy (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (l : List (Edit × Nat)) (st : State), Reachable st →
      (runFrom rem cs st l).1 = (runFrom rem cs st (l.filter (nb ·.1))).1
  | [], _, _ => rfl
  | (e, i) :: rest, st, hr => by
    by_cases hb : e.isBox = true
    · have hf : ((e, i) :: rest).filter (nb ·.1) = rest.filter (nb ·.1) := by simp [nb, hb]
      rw [hf, runFrom.eq_2, box_not_removal hb]
      simp only [Bool.false_and, Bool.false_eq_true, ite_false]
      rcases step_box hr hb with hs | hs
      · rw [hs]
        split
        · rename_i h; cases h
        · exact runFrom_lazy rem cs rest st hr
      · rw [hs]
        split
        · rename_i st' _ heq
          cases heq
          exact runFrom_lazy rem cs rest st hr
        · exact runFrom_lazy rem cs rest st hr
    · have hf : ((e, i) :: rest).filter (nb ·.1) = (e, i) :: rest.filter (nb ·.1) := by
        simp [nb, hb]
      rw [hf, runFrom.eq_2, runFrom.eq_2]
      split
      · exact runFrom_lazy rem cs rest st hr
      · split
        · rename_i st' _ hs
          exact runFrom_lazy rem cs rest st' (reachable_step hr hs)
        · exact runFrom_lazy rem cs rest st hr

theorem runFrom_reachable (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) (l : List (Edit × Nat)) :
    Reachable (runFrom rem cs {} l).1 :=
  ⟨_, Shares.runFrom_fst rem cs {} l⟩

/-- The state a replay reaches before place `i`, of the edits before it but the boxes. -/
def lazyAt (o rem : List Edit) (i : Nat) : State :=
  (runFrom rem (cuts o rem) {} ((o.zipIdx.take i).filter (nb ·.1))).1

/-- **L3** (a box fetched later is checked as if it came first): the replay of `o`, with the removals `rem`, reaches
    before the box at place `i` the state of the edits before it but the boxes (`lazyAt`); and the box stands exactly
    where `apply` accepts it on that state, with what the removals after it take away hidden, as on the state itself.
    So a device that took the state without the boxes checks each box as it arrives, by the same rules, on the state it
    already holds of the edits before it. -/
theorem L3_fetched_checked (o rem : List Edit) (i : Nat) (hi : i < o.length) (hb : o[i].isBox = true) :
    (runFrom rem (cuts o rem) {} (o.zipIdx.take i)).1 = lazyAt o rem i ∧
    (runFrom rem (cuts o rem) {} (o.zipIdx.take (i + 1))).1 = lazyAt o rem i ∧
    (runFrom rem (cuts o rem) {} (o.zipIdx.take (i + 1))).2 =
      (runFrom rem (cuts o rem) {} (o.zipIdx.take i)).2 ++
        (if (apply (hide (lazyAt o rem i) (hiddenAt (cuts o rem) i o[i])) o[i]).isSome &&
            (step (lazyAt o rem i) o[i]).isSome then [o[i]] else []) := by
  have hS : (runFrom rem (cuts o rem) {} (o.zipIdx.take i)).1 = lazyAt o rem i :=
    runFrom_lazy rem _ _ {} reachable_empty
  have hr := runFrom_reachable rem (cuts o rem) (o.zipIdx.take i)
  have htake : o.zipIdx.take (i + 1) = o.zipIdx.take i ++ [(o[i], i)] := by
    rw [List.take_add_one, List.getElem?_eq_getElem (by simpa using hi)]
    simp [List.getElem_zipIdx]
  rw [htake, Stored.runFrom_append]
  generalize runFrom rem (cuts o rem) {} (o.zipIdx.take i) = A at hS hr ⊢
  rw [← hS]
  simp only [runFrom, box_not_removal hb, Bool.false_and, Bool.false_eq_true, ite_false]
  refine ⟨trivial, ?_, ?_⟩
  · rcases step_box hr hb with hs | hs
    · rw [hs]; split <;> simp_all
    · rw [hs]; split <;> simp_all
  · congr 1
    split
    · rename_i h₁ h₂ _ _ ha hs
      simp [ha, hs]
    · rename_i hno
      split
      · rename_i hc
        simp only [Bool.and_eq_true, Option.isSome_iff_exists] at hc
        obtain ⟨⟨a, ha⟩, ⟨b, hs⟩⟩ := hc
        exact absurd (hno a b ha hs) (by simp)
      · rfl

/-! ## Derived entry keys

The key of an entry in a stay is derived from the key of the audience of that stay (the exact set of shares it falls
in, `mk_audience`) at an epoch (`linkAll`, `keys::entry_key`); a move links the keys of the earlier stays under the key
of the stay now. So no reader set is ever coarser than an audience's. -/

/-- In a reachable state every entry is linked: its keys are where `linkAll` puts them. -/
theorem linked_reachable {st : State} (hr : Reachable st) : ∀ en ∈ st.entries, LinkedEntry st st.seals en := by
  have h := sealAll_linked st
  rw [sealAll_reachable hr] at h
  exact h

/-- **D1** (a member opens every entry key of its epochs): in a reachable state whoever opens the key of the audience
    of a write's stay at the write's epoch opens the key the write is under; and whoever opens the current key of an
    entry's audience opens the entry's current key. -/
theorem D1_member_opens {st : State} (hr : Reachable st) {en : Entry} (hen : en ∈ st.entries)
    {start : List KeyName} :
    (Knows st start (st.curKey (.audience en.vault en.audience)) → Knows st start (entryKey st en)) ∧
    ∀ w ∈ st.writes, w.entry = en.id →
      Knows st start (.scoped (.audience en.vault ((en.stayAudience w.stay).getD [])) w.epoch) →
      Knows st start w.key := by
  obtain ⟨h₁, h₂⟩ := linked_reachable hr en hen
  exact ⟨fun hk => .unseal h₁ hk, fun w hw he hk => .unseal (h₂ w hw he).1 hk⟩

/-- **D2** (an entry's readers are its audience's): in a reachable state a holder opens an entry's current key exactly
    when it opens the current key of the entry's audience, the exact set of shares the entry falls in. So the entry
    keys hang off no coarser group than the caps give; and by T6 that is only a holder who may read the audience
    now: whoever a revocation or a move took out opens neither. -/
theorem D2_entry_iff_audience {st : State} (hr : Reachable st) (h : Holder) {en : Entry} (hen : en ∈ st.entries) :
    (Knows st (h.start st) (entryKey st en) ↔ Knows st (h.start st) (st.curKey (.audience en.vault en.audience))) ∧
    (Knows st (h.start st) (entryKey st en) → MayOpen st h (.audience en.vault en.audience)) := by
  obtain ⟨edits, hst⟩ := hr
  have hinv := keyInv_replay edits
  rw [← hst] at hinv
  have hiff : Knows st (h.start st) (entryKey st en) ↔
      Knows st (h.start st) (st.curKey (.audience en.vault en.audience)) := by
    refine ⟨fun hk => ?_, (D1_member_opens ⟨edits, hst⟩ hen).1⟩
    generalize hx : entryKey st en = x at hk
    cases hk with
    | own hm =>
      subst hx
      cases h <;> simp [Holder.start, entryKey, State.curKey] at hm
    | published hm =>
      subst hx
      obtain ⟨⟨k, e, hke, -⟩, -⟩ := hinv.published _ hm
      simp [entryKey] at hke
    | «unseal» hs hto =>
      rename_i s
      have hsec : s.secret = .entry en.id en.stay (st.epochOf (.audience en.vault en.audience)) := by
        rw [← hx]; rfl
      obtain ⟨-, hall⟩ := hinv.entries s hs _ _ _ hsec
      have := (hall en hen rfl).2 rfl
      rw [this] at hto
      exact hto
  exact ⟨hiff, fun hk => T6_forward_secrecy ⟨edits, hst⟩ h
    (mem_keyFams.2 (.inr (.inr ⟨en, hen, rfl⟩))) (hiff.1 hk)⟩

end Lazy

end AvenDB
