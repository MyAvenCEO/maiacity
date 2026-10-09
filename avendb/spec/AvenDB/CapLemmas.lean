import AvenDB.Props

/-!
# Caps, cells, removals and relays

The proofs of the theorems about cap chains and cells (T22, T23), the replay and strong removal (T16, T18, the view,
the order of writes, the generations along a replay for T15), stated as in `Theorems.lean`.

Settling keys changes only the epochs, the seals and what is published, and never lowers an epoch. An accepted edit
adds a cap only with a new id and a parent that comes before it (`capParentOk`), never takes a cap away, and never sets
`narrow`, which only `hide` does while an edit is checked. So in every reachable state the caps are well formed
(`CapsWell`): a cap's chain is its parent's chain and the cap itself (T22), and with nothing narrowed the write rule
reads exactly what the selectors say wherever an entry's live cell is its semantic cell (T23). A new write brings a new
id and builds on accepted writes, and a removal keeps some of the writes with what they build on, so the writes stay
ordered. A run with removals ends in the replay of the edits that stood in it.
-/

namespace AvenDB.Caps

/-! ## Folds, and settling keys

Settling keys changes only the epochs, the seals and what is published, and never lowers an epoch. -/

/-- What holds at the start of a fold and is kept by each step holds at its end. -/
theorem foldl_inv {α β : Type} (P : β → Prop) (f : β → α → β) (hf : ∀ b a, P b → P (f b a)) :
    ∀ (l : List α) (b : β), P b → P (l.foldl f b)
  | [], _, h => h
  | a :: l, b, h => foldl_inv P f hf l (f b a) (hf b a h)

/-- `st` is `base` with other seals and other published keys. -/
def SealsOnly (base st : State) : Prop := ∃ ss ps, st = { base with seals := ss, published := ps }

/-- `st` is `base` with other epochs, seals and published keys. -/
def KeysOnly (base st : State) : Prop := ∃ es ss ps, st = { base with epochs := es, seals := ss, published := ps }

/-- Adding a seal changes only the seals. -/
theorem sealsOnly_addSeal {base st : State} (h : SealsOnly base st) (s : Seal) : SealsOnly base (addSeal st s) := by
  obtain ⟨ss, ps, rfl⟩ := h
  unfold addSeal
  split
  · exact ⟨ss, ps, rfl⟩
  · exact ⟨_, ps, rfl⟩

/-- Publishing a key changes only what is published. -/
theorem sealsOnly_publish {base st : State} (h : SealsOnly base st) (k : KeyName) : SealsOnly base (publish st k) := by
  obtain ⟨ss, ps, rfl⟩ := h
  unfold publish
  split
  · exact ⟨ss, ps, rfl⟩
  · exact ⟨ss, _, rfl⟩

/-- Linking the entry keys only adds seals. -/
theorem sealsOnly_linkAll {base st : State} (h : SealsOnly base st) : SealsOnly base (linkAll st) := by
  unfold linkAll
  refine foldl_inv (SealsOnly base) _ (fun acc en hacc => ?_) _ _ h
  refine foldl_inv (SealsOnly base) _ (fun acc w hacc => ?_) _ _ (sealsOnly_addSeal hacc _)
  dsimp only
  split
  · exact sealsOnly_addSeal hacc _
  · exact sealsOnly_addSeal (sealsOnly_addSeal hacc _) _

/-- Sealing, publishing and linking change only the seals and what is published. -/
theorem sealsOnly_sealAll (st : State) : SealsOnly st (sealAll st) := by
  unfold sealAll
  refine sealsOnly_linkAll (foldl_inv (SealsOnly st) _ (fun acc k hacc => ?_) _ _ ⟨st.seals, st.published, rfl⟩)
  have h1 := foldl_inv (SealsOnly st) (fun a t => addSeal a ⟨a.curKey k, t⟩) (fun a _ ha => sealsOnly_addSeal ha _)
    (targets acc k) acc hacc
  dsimp only
  split
  · exact sealsOnly_publish h1 _
  · exact h1

/-- Rotating changes only the epochs and the seals. -/
theorem keysOnly_foldl_bump (st : State) (l : List KeyFam) : KeysOnly st (l.foldl bump st) := by
  refine foldl_inv (KeysOnly st) bump (fun b k hb => ?_) l st ⟨st.epochs, st.seals, st.published, rfl⟩
  obtain ⟨es, ss, ps, rfl⟩ := hb
  exact ⟨_, _, ps, rfl⟩

/-- Settling keys changes only the epochs, the seals and what is published. -/
theorem keysOnly_settle (pre post : State) : KeysOnly post (settle pre post) := by
  obtain ⟨es, ss₀, ps₀, h1⟩ := keysOnly_foldl_bump post (staleKeys pre post)
  obtain ⟨ss, ps, h2⟩ := sealsOnly_sealAll ((staleKeys pre post).foldl bump post)
  unfold settle
  rw [h2, h1]
  exact ⟨es, ss, ps, rfl⟩

/-- Settling keeps the caps. -/
theorem settle_caps (pre post : State) : (settle pre post).caps = post.caps := by
  obtain ⟨_, _, _, h⟩ := keysOnly_settle pre post
  rw [h]

/-- Settling keeps the writes. -/
theorem settle_writes (pre post : State) : (settle pre post).writes = post.writes := by
  obtain ⟨_, _, _, h⟩ := keysOnly_settle pre post
  rw [h]

/-- Settling keeps `narrow`. -/
theorem settle_narrow (pre post : State) : (settle pre post).narrow = post.narrow := by
  obtain ⟨_, _, _, h⟩ := keysOnly_settle pre post
  rw [h]

/-- Rotating `k` raises its epoch by one and leaves the others. -/
theorem epochOf_bump (st : State) (k k' : KeyFam) :
    (bump st k).epochOf k' = st.epochOf k' + if k = k' then 1 else 0 := by
  unfold bump State.epochOf
  by_cases hk : k = k'
  · subst hk
    simp
  · have hne : (k == k') = false := by simpa using hk
    simp only [List.find?_cons, hne, List.find?_filter, hk, ite_false, Nat.add_zero]
    congr 2
    funext x
    by_cases hx : x.1 = k' <;> simp [hx, Ne.symm hk]

/-- Rotating never lowers an epoch. -/
theorem epochOf_foldl_bump (k : KeyFam) :
    ∀ (l : List KeyFam) (st : State), st.epochOf k ≤ (l.foldl bump st).epochOf k
  | [], _ => Nat.le_refl _
  | k' :: l, st => by
    rw [List.foldl_cons]
    refine Nat.le_trans ?_ (epochOf_foldl_bump k l _)
    rw [epochOf_bump]
    exact Nat.le_add_right _ _

/-- Settling never lowers an epoch. -/
theorem epochOf_settle (pre post : State) (k : KeyFam) : post.epochOf k ≤ (settle pre post).epochOf k := by
  obtain ⟨ss, ps, h⟩ := sealsOnly_sealAll ((staleKeys pre post).foldl bump post)
  unfold settle
  rw [h]
  exact epochOf_foldl_bump k _ post

/-! ## Causally closed writes -/

/-- Write `w` builds only on writes of its own entry among `ws`. -/
theorem depsIn_iff {ws : List Write} {w : Write} :
    depsIn ws w = true ↔ ∀ d ∈ w.deps, ∃ x ∈ ws, x.edit = d ∧ x.entry = w.entry := by
  simp [depsIn, List.all_eq_true, List.any_eq_true]

/-- More writes hold every dependency fewer writes held. -/
theorem depsIn_mono {ws ws' : List Write} {w : Write} (h : depsIn ws w = true) (hsub : ∀ x ∈ ws, x ∈ ws') :
    depsIn ws' w = true := by
  rw [depsIn_iff] at h ⊢
  intro d hd
  obtain ⟨x, hx, hxd⟩ := h d hd
  exact ⟨x, hsub x hx, hxd⟩

/-- `closeDeps` keeps some of the writes, in order. -/
theorem closeDeps_sublist (ws : List Write) : (closeDeps ws).Sublist ws := by
  unfold closeDeps
  -- what the fold keeps from `l`, starting from writes kept from `pre`, is kept from `pre ++ l`
  suffices h : ∀ (l kept pre : List Write), kept.Sublist pre →
      (l.foldl (fun kept w => if depsIn kept w then kept ++ [w] else kept) kept).Sublist (pre ++ l) from
    h ws [] [] .slnil
  intro l
  induction l with
  | nil => intro kept pre h; simpa using h
  | cons w l ih =>
    intro kept pre h
    rw [List.foldl_cons, show pre ++ w :: l = pre ++ [w] ++ l by simp]
    apply ih
    split
    · exact h.append (.refl _)
    · exact h.trans (List.sublist_append_left _ _)

/-- Every write `closeDeps` keeps builds only on writes it keeps. -/
theorem closeDeps_closed (ws : List Write) : ∀ w ∈ closeDeps ws, depsIn (closeDeps ws) w = true := by
  unfold closeDeps
  refine foldl_inv (fun kept => ∀ w ∈ kept, depsIn kept w = true) _ (fun kept w h => ?_) ws [] (by simp)
  split
  · rename_i hw
    -- the dependencies of `w` and of every write kept before it were kept already
    have hsub : ∀ y ∈ kept, y ∈ kept ++ [w] := fun y hy => List.mem_append_left _ hy
    intro x hx
    rcases List.mem_append.1 hx with hx | hx
    · exact depsIn_mono (h x hx) hsub
    · rw [List.mem_singleton] at hx
      subst hx
      exact depsIn_mono hw hsub
  · exact h

/-- A removal keeps some of the writes, in order, and only writes whose dependencies it keeps: what `closeDeps` keeps,
    of the entries whose creation it keeps, which are the entries of what they build on. -/
theorem dropUnseen_writes (pre mid : State) (keep : List EditId) :
    (dropUnseen pre mid keep).writes.Sublist mid.writes ∧
      ∀ w ∈ (dropUnseen pre mid keep).writes, depsIn (dropUnseen pre mid keep).writes w = true := by
  unfold dropUnseen
  dsimp only
  refine ⟨List.filter_sublist.trans ((closeDeps_sublist _).trans List.filter_sublist), fun w hw => ?_⟩
  obtain ⟨hw1, hw2⟩ := List.mem_filter.1 hw
  rw [depsIn_iff]
  intro d hd
  obtain ⟨x, hx, hxd, hxe⟩ := depsIn_iff.1 (closeDeps_closed _ w hw1) d hd
  exact ⟨x, List.mem_filter.2 ⟨hx, by rw [hxe]; exact hw2⟩, hxd, hxe⟩

/-! ## What one step does -/

/-- An accepted edit never touches `narrow`: only `hide` sets it. -/
theorem apply_narrow {st post : State} {edit : Edit} (h : apply st edit = some post) : post.narrow = st.narrow := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try rfl)

/-- An accepted edit leaves the epochs alone. -/
theorem apply_epochs {st post : State} {edit : Edit} (h : apply st edit = some post) : post.epochs = st.epochs := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try rfl)

/-- An accepted edit leaves the caps alone, or adds one cap with a new id that `capParentOk` accepts. -/
theorem apply_caps {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.caps = st.caps ∨ ∃ c, post.caps = st.caps ++ [c] ∧ st.cap? c.id = none ∧ capParentOk st c = true := by
  unfold apply at h
  dsimp only at h
  split at h
  case h_8 c via _ =>
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨h1, -, h3, -, rfl⟩ := h
    refine .inr ⟨c, rfl, ?_, ?_⟩
    · cases hc : st.cap? c.id with
      | none => rfl
      | some _ => simp [hc] at h1
    · cases hp : capParentOk st c with
      | true => rfl
      | false => simp [hp] at h3
  all_goals (repeat' split at h) <;> (try cases h) <;> exact .inl rfl

/-- An accepted edit leaves the writes alone, or is a write edit adding one write with its new id and its author that
    builds on accepted writes, or is a removal keeping some of the writes, in order, with what they build on. -/
theorem apply_writes {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.writes = st.writes ∨
    (∃ w, post.writes = st.writes ++ [w] ∧ w.edit = edit.id ∧ w.author = edit.author ∧
      (∀ x ∈ st.writes, x.edit ≠ w.edit) ∧ depsIn st.writes w = true ∧
      ∃ v e a s g d p via cr tg, edit.action = .write v e a s g d p via cr tg) ∨
    (post.writes.Sublist st.writes ∧ ∀ w ∈ post.writes, depsIn post.writes w = true) := by
  unfold apply at h
  dsimp only at h
  split at h
  case h_10 v e actor stay gen deps proposal via create tags hact =>
    split at h
    · cases h
    rename_i hok
    -- the write's id is new
    have hfresh : ∀ x ∈ st.writes, x.edit ≠ edit.id := by
      intro x hx hxe
      simp only [Bool.or_eq_true, List.any_eq_true, beq_iff_eq] at hok
      exact hok (.inl ⟨x, hx, hxe⟩)
    have hw : ∃ v e a s g d p via cr tg, edit.action = .write v e a s g d p via cr tg :=
      ⟨_, _, _, _, _, _, _, _, _, _, hact⟩
    split at h
    · -- a new entry: its first write builds on nothing
      repeat' split at h
      all_goals try cases h
      exact .inr (.inl ⟨_, rfl, rfl, rfl, hfresh, rfl, hw⟩)
    · repeat' split at h
      all_goals try cases h
      all_goals
        rename_i hdeps _ _
        exact .inr (.inl ⟨_, rfl, rfl, rfl, hfresh, by simpa using hdeps, hw⟩)
  all_goals (repeat' split at h) <;> (try cases h) <;>
    first | exact .inl rfl | exact .inr (.inr (dropUnseen_writes _ _ _))

/-! ## Every reachable state -/

/-- What holds at the start and is kept by every accepted step holds after any replay. -/
theorem replay_inv (P : State → Prop) (hstep : ∀ st st' edit, P st → step st edit = some st' → P st') :
    ∀ (edits : List Edit) (st : State), P st → P (replay st edits)
  | [], _, h => h
  | edit :: edits, st, h => by
    show P (replay ((step st edit).getD st) edits)
    cases hs : step st edit with
    | none => exact replay_inv P hstep edits st h
    | some st' => exact replay_inv P hstep edits st' (hstep st st' edit h hs)

/-- Nothing is narrowed in a reachable state: `narrow` is set only while checking an edit, never on the state carried
    forward. -/
theorem narrow_reachable {st : State} (hr : Reachable st) : st.narrow = [] := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv (fun st => st.narrow = []) (fun st st' edit hn h => ?_) edits {} rfl
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_narrow, apply_narrow hpost, hn]

/-! ## Cap chains -/

/-- The caps of a state are well formed: no two share an id, and a cap resting on another names one that comes before
    it, over the same vault, an owner cap granted to its issuer, wide if it is. -/
def CapsWell (st : State) : Prop :=
  (st.caps.map (·.id)).Nodup ∧
  ∀ c ∈ st.caps, ∀ p, c.parent = some p → ∃ pc, st.cap? p = some pc ∧ st.caps.idxOf pc < st.caps.idxOf c ∧
    pc.over = c.over ∧ pc.role = .owner ∧ pc.grantee = .principal (.vault c.issuer) ∧ (c.wide = true → pc.wide = true)

/-- Two caps with one id are one, where ids come once. -/
theorem cap_eq_of_id {cs : List Cap} (hnd : (cs.map (·.id)).Nodup) {a b : Cap} (ha : a ∈ cs) (hb : b ∈ cs)
    (h : a.id = b.id) : a = b := by
  induction cs with
  | nil => simp at ha
  | cons c cs ih =>
    rw [List.map_cons, List.nodup_cons] at hnd
    rw [List.mem_cons] at ha hb
    rcases ha with ha | ha <;> rcases hb with hb | hb
    · exact ha.trans hb.symm
    · exact absurd (by rw [← ha, h]; exact List.mem_map_of_mem hb) hnd.1
    · exact absurd (by rw [← hb, ← h]; exact List.mem_map_of_mem ha) hnd.1
    · exact ih hnd.2 ha hb

/-- Well-formedness reads only the caps. -/
theorem capsWell_congr {st st' : State} (h : st'.caps = st.caps) : CapsWell st' ↔ CapsWell st := by
  unfold CapsWell State.cap?
  rw [h]

/-- Adding a cap with a new id that `capParentOk` accepts keeps the caps well formed: its parent is an earlier cap. -/
theorem capsWell_add {st st' : State} (hw : CapsWell st) {c : Cap} (hcaps : st'.caps = st.caps ++ [c])
    (hnew : st.cap? c.id = none) (hok : capParentOk st c = true) : CapsWell st' := by
  obtain ⟨hnd, hpar⟩ := hw
  have hids : ∀ x ∈ st.caps, x.id ≠ c.id := fun x hx hxc => by
    have := List.find?_eq_none.1 hnew x hx
    simp [hxc] at this
  have hc : c ∉ st.caps := fun hc => hids c hc rfl
  -- a lookup that finds a cap before still finds it
  have hlook : ∀ p pc, st.cap? p = some pc → st'.cap? p = some pc := fun p pc h => by
    unfold State.cap? at h ⊢
    rw [hcaps, List.find?_append, h]
    rfl
  have hidx : ∀ x ∈ st.caps, st'.caps.idxOf x = st.caps.idxOf x := fun x hx => by
    simp only [hcaps, List.idxOf_append, hx, ↓reduceIte]
  refine ⟨?_, fun x hx p hp => ?_⟩
  · rw [hcaps, List.map_append, List.nodup_append]
    refine ⟨hnd, by simp, fun a ha b hb hab => ?_⟩
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
    rw [List.map_singleton, List.mem_singleton] at hb
    exact hids x hx (hab.trans hb)
  · rw [hcaps, List.mem_append, List.mem_singleton] at hx
    rcases hx with hx | rfl
    · obtain ⟨pc, hpc, hlt, hrest⟩ := hpar x hx p hp
      exact ⟨pc, hlook p pc hpc, by rw [hidx pc (List.mem_of_find?_eq_some hpc), hidx x hx]; exact hlt, hrest⟩
    · -- the new cap: its parent passed `capParentOk` and comes before it
      unfold capParentOk at hok
      rw [hp] at hok
      dsimp only at hok
      cases hpc : st.cap? p with
      | none => rw [hpc] at hok; cases hok
      | some pc =>
        rw [hpc] at hok
        simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, Bool.not_eq_true'] at hok
        obtain ⟨⟨⟨⟨_, hover⟩, hrole⟩, hgr⟩, hwide⟩ := hok
        have hpcm := List.mem_of_find?_eq_some hpc
        refine ⟨pc, hlook p pc hpc, ?_, hover, hrole, hgr, fun h => by simpa [h] using hwide⟩
        rw [hidx pc hpcm]
        simp only [hcaps, List.idxOf_append, hc, ↓reduceIte, List.idxOf_cons_self, Nat.zero_add]
        exact List.idxOf_lt_length_of_mem hpcm

/-- In every reachable state the caps are well formed. -/
theorem capsWell_reachable {st : State} (hr : Reachable st) : CapsWell st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv CapsWell (fun st st' edit hw h => ?_) edits {} ⟨List.nodup_nil, fun _ h => by cases h⟩
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rcases apply_caps hpost with hcaps | ⟨c, hcaps, hnew, hok⟩
  · exact (capsWell_congr ((settle_caps st post).trans hcaps)).2 hw
  · exact capsWell_add hw ((settle_caps st post).trans hcaps) hnew hok

/-- With a rank that drops from each cap to its parent, any fuel at least a cap's rank gives its whole chain. -/
theorem chainN_stable (st : State) (r : Cap → Nat)
    (hr : ∀ x ∈ st.caps, ∀ p, x.parent.bind st.cap? = some p → r p < r x) :
    ∀ m n x, x ∈ st.caps → r x ≤ m → r x ≤ n → chainN st m x = chainN st n x := by
  -- a cap of rank 0 rests on nothing
  have hroot : ∀ x ∈ st.caps, r x = 0 → x.parent.bind st.cap? = none := fun x hx h0 => by
    cases h : x.parent.bind st.cap? with
    | none => rfl
    | some p => exact absurd (hr x hx p h) (by omega)
  intro m
  induction m with
  | zero =>
    intro n x hx hm _
    cases n with
    | zero => rfl
    | succ n => simp [chainN, hroot x hx (by omega)]
  | succ m ih =>
    intro n x hx hm hn
    cases n with
    | zero => simp [chainN, hroot x hx (by omega)]
    | succ n =>
      cases h : x.parent.bind st.cap? with
      | none => simp only [chainN, h]
      | some p =>
        obtain ⟨q, -, hq⟩ := Option.bind_eq_some_iff.1 h
        have := hr x hx p h
        simp only [chainN, h, ih n p (List.mem_of_find?_eq_some hq) (by omega) (by omega)]

/-- In a well-formed state, the chain of a cap resting on `pc` is `pc`'s chain and the cap. -/
theorem chain_parent {st : State} (hw : CapsWell st) {c pc : Cap} {p : CapId}
    (hp : c.parent = some p) (hpc : st.cap? p = some pc) : chain st c = chain st pc ++ [c] := by
  -- the place in the caps ranks them: a parent comes first
  have hr : ∀ x ∈ st.caps, ∀ q, x.parent.bind st.cap? = some q → st.caps.idxOf q < st.caps.idxOf x := by
    intro x hx q hq
    obtain ⟨p', hp', hq'⟩ := Option.bind_eq_some_iff.1 hq
    obtain ⟨pc', hpc', hlt, -⟩ := hw.2 x hx p' hp'
    rw [hq'] at hpc'
    cases hpc'
    exact hlt
  have hpcm := List.mem_of_find?_eq_some hpc
  have hlt := List.idxOf_lt_length_of_mem hpcm
  have h1 : chainN st (st.caps.length + 1) c = chainN st st.caps.length pc ++ [c] := by
    simp only [chainN, hp, Option.bind_some, hpc]
  unfold chain
  rw [h1, chainN_stable st (st.caps.idxOf ·) hr st.caps.length (st.caps.length + 1) pc hpcm (by omega) (by omega)]

/-! ## T22 and T23 -/

theorem T22_slices_narrow {st : State} (hr : Reachable st) {c pc : Cap} (hc : c ∈ st.caps) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.caps) :
    pc.over = c.over ∧ pc.role = .owner ∧ pc.grantee = .principal (.vault c.issuer) ∧
      (∀ a, effSelects st c a = true → effSelects st pc a = true) ∧ (c.wide = true → pc.wide = true) := by
  have hw := capsWell_reachable hr
  obtain ⟨pc', hpc', -, hover, hrole, hgr, hwide⟩ := hw.2 c hc pc.id hp
  -- ids come once, so the parent found is `pc`
  have hid : pc'.id = pc.id := by simpa using List.find?_some hpc'
  obtain rfl := cap_eq_of_id hw.1 (List.mem_of_find?_eq_some hpc') hpc hid
  refine ⟨hover, hrole, hgr, fun a ha => ?_, hwide⟩
  unfold effSelects at ha ⊢
  rw [chain_parent hw hp hpc', List.all_append, Bool.and_eq_true] at ha
  exact ha.1

/-- Two tests that agree on every member of a list agree on whether some member passes. -/
theorem any_congr_mem {α : Type} {l : List α} {p q : α → Bool} (h : ∀ x ∈ l, p x = q x) : l.any p = l.any q := by
  induction l with
  | nil => rfl
  | cons x l ih =>
    simp only [List.any_cons, h x List.mem_cons_self, ih fun y hy => h y (List.mem_cons_of_mem _ hy)]

theorem T23_cells_mean_slices {st : State} (hr : Reachable st) (en : Entry) (hcell : liveCell st en = semCell st en)
    (a : VaultId) : mayWrite st a en = semWrite st a en := by
  have hw := capsWell_reachable hr
  have hn := narrow_reachable hr
  unfold mayWrite semWrite
  congr 1
  refine any_congr_mem fun cp hcp => ?_
  unfold inCell
  rw [hn]
  simp only [List.all_nil, Bool.and_true]
  cases hh : holdsCap st a cp .write
  · simp
  have hlive : st.live cp.id = true := by
    simp only [holdsCap, Bool.and_eq_true] at hh
    exact hh.1.1
  cases ho : cp.over == en.vault
  · simp
  cases hwd : cp.wide
  · -- a cap that isn't wide: in the cell, live, exactly when its slice holds the entry and its creation was let in
    simp only [Bool.true_and, Bool.false_or, Bool.and_true]
    rw [Bool.eq_iff_iff]
    have hmem : en.cell.contains cp.id = true ↔ cp.id ∈ semCell st en := by
      rw [← hcell, liveCell, List.mem_filter, List.contains_iff_mem]
      exact ⟨fun h => ⟨h, hlive⟩, fun h => h.1⟩
    rw [hmem]
    unfold semCell
    cases had : en.admitted
    · simp
    · simp only [↓reduceIte, mkCell, List.mem_mergeSort, List.mem_eraseDups, List.mem_map, List.mem_filter,
        Bool.true_and]
      constructor
      · rintro ⟨cp', ⟨hcp', hcond⟩, hid⟩
        obtain rfl := cap_eq_of_id hw.1 hcp' hcp hid
        simp only [Bool.and_eq_true] at hcond
        exact hcond.2
      · intro he
        exact ⟨cp, ⟨hcp, by simp [beq_iff_eq.1 ho, hlive, hwd, he]⟩, rfl⟩
  · simp

theorem T23_creations (st : State) (a v : VaultId) (x : Cell) (attrs : Attrs) (h : admits st a v x attrs = true) :
    mayCreate st a v x = true := by
  unfold admits at h
  unfold mayCreate
  simp only [Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with h | ⟨cp, hcp, ⟨⟨hv, hh⟩, hx⟩, -⟩
  · exact .inl h
  · exact .inr ⟨cp, hcp, ⟨hv, hh⟩, hx⟩

/-! ## Runs and resolve -/

/-- A run ends in the replay of the edits that stood in it. -/
theorem runFrom_fst (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (l : List (Edit × Nat)), (runFrom rem cs st l).1 = replay st (runFrom rem cs st l).2
  | _, [] => rfl
  | st, (edit, i) :: rest => by
    unfold runFrom
    split
    · exact runFrom_fst rem cs st rest
    · split
      · rename_i st' _ hs
        show _ = replay ((step st edit).getD st) _
        rw [hs]
        exact runFrom_fst rem cs st' rest
      · exact runFrom_fst rem cs st rest

/-- The edits that stand in a run are among the edits it ran. -/
theorem runFrom_snd_mem (rem : List Edit) (cs : List (Nat × List EditId × List Fact)) :
    ∀ (st : State) (l : List (Edit × Nat)), ∀ o ∈ (runFrom rem cs st l).2, o ∈ l.map Prod.fst
  | _, [] => by simp [runFrom]
  | st, (edit, i) :: rest => by
    unfold runFrom
    split
    · exact fun o ho => List.mem_cons_of_mem _ (runFrom_snd_mem rem cs st rest o ho)
    · split
      · rename_i st' _ _
        intro o ho
        rcases List.mem_cons.1 ho with rfl | ho
        · exact List.mem_cons_self
        · exact List.mem_cons_of_mem _ (runFrom_snd_mem rem cs st' rest o ho)
      · exact fun o ho => List.mem_cons_of_mem _ (runFrom_snd_mem rem cs st rest o ho)

/-- The edits that stand in what a peer knows are among the edits it holds. -/
theorem standing_mem (edits : List Edit) : ∀ o ∈ standing edits, o ∈ edits := fun o ho => by
  have h := runFrom_snd_mem _ _ _ _ o ho
  rw [List.zipIdx_map_fst] at h
  exact (List.mem_filter.1 (List.mem_mergeSort.1 h)).1

/-- Every removal `resolve` picks stands in the run with the removals it picks: the fold only ever keeps a list whose
    run accepts all of it. -/
theorem resolve_stands (edits : List Edit) :
    ∀ r ∈ resolve edits, (runWith edits (resolve edits)).2.any (·.id == r.id) = true := by
  unfold resolve
  refine foldl_inv (fun rem => ∀ r ∈ rem, (runWith edits rem).2.any (·.id == r.id) = true) _ (fun rem r h => ?_) _ []
    (by simp)
  dsimp only
  split
  · rename_i hall
    intro x hx
    refine List.all_eq_true.1 hall x ?_
    rcases List.mem_append.1 hx with hx | hx
    · exact List.mem_cons_of_mem _ hx
    · rw [List.mem_singleton] at hx
      exact hx ▸ List.mem_cons_self
  · exact h

/-- Every write a replay holds was there at the start, or a write edit it replayed made it, with the edit's id and
    author. -/
theorem replay_writes_from :
    ∀ (l : List Edit) (st : State) (w : Write), w ∈ (replay st l).writes → w ∈ st.writes ∨
      ∃ o ∈ l, o.id = w.edit ∧ o.author = w.author ∧
        ∃ v e a s g d p via cr tg, o.action = .write v e a s g d p via cr tg
  | [], _, _, h => .inl h
  | edit :: edits, st, w, h => by
    change w ∈ (replay ((step st edit).getD st) edits).writes at h
    rcases replay_writes_from edits _ w h with h | ⟨o, ho, hrest⟩
    · cases hs : step st edit with
      | none => rw [hs] at h; exact .inl h
      | some st' =>
        rw [hs] at h
        unfold step at hs
        obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 hs
        change w ∈ (settle st post).writes at h
        rw [settle_writes] at h
        rcases apply_writes hpost with hws | ⟨w', hws, hid, hauth, -, -, hact⟩ | ⟨hsub, -⟩
        · exact .inl (hws ▸ h)
        · rw [hws] at h
          rcases List.mem_append.1 h with h | h
          · exact .inl h
          · rw [List.mem_singleton] at h
            subst h
            exact .inr ⟨edit, List.mem_cons_self, hid.symm, hauth.symm, hact⟩
        · exact .inl (hsub.subset h)
    · exact .inr ⟨o, List.mem_cons_of_mem _ ho, hrest⟩

/-! ## What a peer knows -/

theorem view_eq_replay (edits : List Edit) : view edits = replay {} (standing edits) := runFrom_fst _ _ _ _

/-- No step breaks causal closure nor the order of the writes: a new write builds only on accepted writes and brings a
    new id, and a removal keeps some of the writes, in order, with what they build on. -/
theorem writes_step {st st' : State} {edit : Edit} (hc : CausallyClosed st) (ho : Ordered st.writes)
    (h : step st edit = some st') : CausallyClosed st' ∧ Ordered st'.writes := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  unfold CausallyClosed at hc ⊢
  rw [settle_writes]
  obtain ⟨hnd, hpw, hself⟩ := ho
  rcases apply_writes hpost with hws | ⟨w, hws, -, -, hfresh, hdeps, -⟩ | ⟨hsub, hclosed⟩
  · rw [hws]
    exact ⟨hc, hnd, hpw, hself⟩
  · rw [hws]
    -- what the accepted writes build on is accepted already, so none builds on `w`, whose id is new
    have hnot : ∀ x ∈ st.writes, w.edit ∉ x.deps := fun x hx hd => by
      obtain ⟨y, hy, hyd, -⟩ := hc x hx _ hd
      exact hfresh y hy hyd
    have hsub : ∀ x ∈ st.writes, x ∈ st.writes ++ [w] := fun x hx => List.mem_append_left _ hx
    refine ⟨fun x hx d hd => ?_, ?_, ?_, ?_⟩
    · rcases List.mem_append.1 hx with hx | hx
      · obtain ⟨y, hy, hyd⟩ := hc x hx d hd
        exact ⟨y, hsub y hy, hyd⟩
      · rw [List.mem_singleton] at hx
        subst hx
        obtain ⟨y, hy, hyd⟩ := depsIn_iff.1 hdeps d hd
        exact ⟨y, hsub y hy, hyd⟩
    · rw [List.map_append, List.nodup_append]
      refine ⟨hnd, by simp, ?_⟩
      intro a ha b hb hab
      obtain ⟨x, hx, rfl⟩ := List.mem_map.1 ha
      rw [List.map_singleton, List.mem_singleton] at hb
      exact hfresh x hx (hab.trans hb)
    · rw [List.pairwise_append]
      refine ⟨hpw, List.pairwise_singleton _ _, fun x hx b hb => ?_⟩
      rw [List.mem_singleton] at hb
      subst hb
      exact hnot x hx
    · intro x hx
      rcases List.mem_append.1 hx with hx | hx
      · exact hself x hx
      · rw [List.mem_singleton] at hx
        subst hx
        intro hd
        obtain ⟨y, hy, hyd, -⟩ := depsIn_iff.1 hdeps _ hd
        exact hfresh y hy hyd
  · -- a removal keeps some of the writes, in order, with what they build on
    exact ⟨fun w hw => depsIn_iff.1 (hclosed w hw), (hsub.map _).nodup hnd, hpw.sublist hsub,
      fun x hx => hself x (hsub.subset hx)⟩

theorem writes_ordered (edits : List Edit) : Ordered (view edits).writes := by
  rw [view_eq_replay]
  have h := replay_inv (fun st => CausallyClosed st ∧ Ordered st.writes)
    (fun _ _ _ ⟨h₁, h₂⟩ h => writes_step h₁ h₂ h) (standing edits) {} (by simp [CausallyClosed, Ordered])
  exact h.2

/-! ## Strong removal -/

-- the split only says where `x` sits; the proof needs no more of it than `i`
set_option linter.unusedVariables false in
theorem T16_strong_removal (edits rem : List Edit) (pre post : List (Edit × Nat)) (x : Edit) (i : Nat)
    (hsplit : edits.zipIdx = pre ++ (x, i) :: post)
    (hstood : (runFrom rem (cuts edits rem) (runFrom rem (cuts edits rem) {} pre).1 [(x, i)]).2 = [x]) :
    (apply (hide (replay {} (runFrom rem (cuts edits rem) {} pre).2) (hiddenAt (cuts edits rem) i x)) x).isSome ∧
    ∀ r j, edits[j]? = some r → rem.any (·.id == r.id) → i < j → x.id ∉ r.action.keep?.getD [] →
      ∀ f ∈ removes edits r, f ∈ hiddenAt (cuts edits rem) i x := by
  refine ⟨?_, fun r j hr hrem hij hkeep f hf => ?_⟩
  · -- the edit stood after the edits before it, so `apply` accepted it with its hidden facts taken away
    rw [← runFrom_fst]
    generalize (runFrom rem (cuts edits rem) {} pre).1 = st at hstood ⊢
    unfold runFrom at hstood
    split at hstood
    · simp [runFrom] at hstood
    · split at hstood
      · rename_i hap _
        rw [hap]
        rfl
      · simp [runFrom] at hstood
  · -- the removal is among the cuts, after the edit, and hadn't seen it
    unfold hiddenAt cuts
    refine List.mem_flatMap.2 ⟨(j, r.action.keep?.getD [], removes edits r), List.mem_filter.2 ⟨List.mem_filterMap.2
      ⟨(r, j), List.mem_zipIdx_iff_getElem?.2 hr, by simp [hrem]⟩, by simp [hij, hkeep]⟩, hf⟩

theorem T16_resolved_removals_stand (edits : List Edit) :
    ∀ r ∈ resolve (order edits), (standing edits).any (·.id == r.id) :=
  resolve_stands (order edits)

/-! ## Once the curves fall -/

theorem T18_checkpointed_writes (edits : List Edit) {w : Write} (hw : w ∈ (view (checkpointed edits)).writes) :
    ∃ c ∈ edits, c.author = w.author ∧ ∃ e covers, c.action = .checkpoint e covers ∧ w.edit ∈ covers := by
  rw [view_eq_replay] at hw
  rcases replay_writes_from _ {} w hw with h | ⟨o, ho, hid, hauth, _, _, _, _, _, _, _, _, _, _, hact⟩
  · simp at h
  · -- the write's edit counts only with a checkpoint by its author that covers it
    obtain ⟨-, hkeep⟩ := List.mem_filter.1 (standing_mem _ o ho)
    rw [hact] at hkeep
    obtain ⟨c, hc, hv⟩ := List.any_eq_true.1 hkeep
    simp only [vouches, Bool.and_eq_true, beq_iff_eq] at hv
    obtain ⟨hca, hcov⟩ := hv
    split at hcov
    · rename_i e covers heq
      exact ⟨c, hc, hca.trans hauth, e, covers, heq, hid ▸ List.contains_iff_mem.1 hcov⟩
    · cases hcov

/-! ## The generations along a replay -/

/-- A trace holds the state it starts from. -/
theorem mem_trace_self (st : State) : ∀ edits, st ∈ trace st edits
  | [] => List.mem_singleton_self _
  | _ :: _ => List.mem_cons_self

/-- A step never lowers an epoch. -/
theorem epochOf_le_step (st : State) (edit : Edit) (k : KeyFam) :
    st.epochOf k ≤ ((step st edit).getD st).epochOf k := by
  unfold step
  cases hp : apply st edit with
  | none => exact Nat.le_refl _
  | some post =>
    show st.epochOf k ≤ (settle st post).epochOf k
    have he : post.epochOf k = st.epochOf k := by simp only [State.epochOf, apply_epochs hp]
    rw [← he]
    exact epochOf_settle st post k

/-- Epochs only grow along a replay: no state of its trace has an epoch beyond the one where the replay ends. -/
theorem epochOf_le_replay (k : KeyFam) : ∀ (st : State) (edits : List Edit), ∀ x ∈ trace st edits,
    x.epochOf k ≤ (replay st edits).epochOf k
  | _, [], _, hx => by rw [List.mem_singleton.1 hx]; exact Nat.le_refl _
  | st, edit :: edits, x, hx => by
    rcases List.mem_cons.1 hx with rfl | hx
    · exact Nat.le_trans (epochOf_le_step x edit k) (epochOf_le_replay k _ edits _ (mem_trace_self _ edits))
    · exact epochOf_le_replay k _ edits x hx

theorem T15_no_older_epoch (edits : List Edit) (k : KeyFam) :
    ∀ st ∈ trace {} (standing edits), st.epochOf k ≤ (view edits).epochOf k := by
  intro st hst
  rw [view_eq_replay]
  exact epochOf_le_replay k {} _ st hst

end AvenDB.Caps
