import AvenDB.Props

/-!
# Keys

The proofs of the key theorems (T5, T6, T7, T24), stated as in `Theorems.lean`.
-/

namespace AvenDB.Keys

/-! ## Folds -/

/-- What holds at the start of a fold and is kept by each step holds at its end. -/
theorem foldl_inv {α β : Type} (P : β → Prop) (f : β → α → β) (hf : ∀ b a, P b → P (f b a)) :
    ∀ (l : List α) (b : β), P b → P (l.foldl f b)
  | [], _, h => h
  | a :: l, b, h => foldl_inv P f hf l (f b a) (hf b a h)

/-- What holds at the start of a fold and is kept by each step on a member of the list holds at its end. -/
theorem foldl_inv_mem {α β : Type} (P : β → Prop) (f : β → α → β) :
    ∀ (l : List α), (∀ b, ∀ a ∈ l, P b → P (f b a)) → ∀ b, P b → P (l.foldl f b)
  | [], _, _, h => h
  | a :: l, hf, b, h =>
    foldl_inv_mem P f l (fun b' a' ha' => hf b' a' (List.mem_cons_of_mem _ ha')) (f b a)
      (hf b a List.mem_cons_self h)

/-- A fold of steps that each leave a part of the state alone leaves it alone. -/
theorem foldl_same {α β : Type} (get : State → β) (f : State → α → State) (hf : ∀ s a, get (f s a) = get s)
    (l : List α) (s : State) : get (l.foldl f s) = get s :=
  foldl_inv (fun t => get t = get s) f (fun t a h => (hf t a).trans h) l s rfl

/-! ## Lookups -/

/-- A lookup finds a vault with that id. -/
theorem vault?_id {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt) : vt.id = v := by
  simpa using List.find?_some h

/-- A lookup finds a vault of the state. -/
theorem vault?_mem {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt) : vt ∈ st.vaults :=
  List.mem_of_find?_eq_some h

/-- A vault is found by its id. -/
theorem vault?_isSome {st : State} {vt : Vault} (h : vt ∈ st.vaults) : (st.vault? vt.id).isSome = true := by
  unfold State.vault?
  rw [List.find?_isSome]
  exact ⟨vt, h, by simp⟩

/-- A lookup finds a cap with that id. -/
theorem cap?_id {st : State} {c : CapId} {cp : Cap} (h : st.cap? c = some cp) : cp.id = c := by
  simpa using List.find?_some h

/-- A lookup finds a cap of the state. -/
theorem cap?_mem {st : State} {c : CapId} {cp : Cap} (h : st.cap? c = some cp) : cp ∈ st.caps :=
  List.mem_of_find?_eq_some h

/-- A lookup finds an entry with that id. -/
theorem entry?_id {st : State} {e : EntryId} {en : Entry} (h : st.entry? e = some en) : en.id = e := by
  simpa using List.find?_some h

/-- A lookup finds an entry of the state. -/
theorem entry?_mem {st : State} {e : EntryId} {en : Entry} (h : st.entry? e = some en) : en ∈ st.entries :=
  List.mem_of_find?_eq_some h

/-- Two members of a list whose images under `f` are distinct, with the same image, are the same. -/
theorem eq_of_nodup_map {α β : Type} {f : α → β} : ∀ {l : List α}, (l.map f).Nodup →
    ∀ {x y : α}, x ∈ l → y ∈ l → f x = f y → x = y
  | [], _, _, _, hx, _, _ => by cases hx
  | a :: l, hn, x, y, hx, hy, hxy => by
    rw [List.map_cons, List.nodup_cons] at hn
    rcases List.mem_cons.1 hx with hxa | hxl <;> rcases List.mem_cons.1 hy with hya | hyl
    · rw [hxa, hya]
    · subst hxa
      exact absurd (by rw [hxy]; exact List.mem_map_of_mem hyl) hn.1
    · subst hya
      exact absurd (by rw [← hxy]; exact List.mem_map_of_mem hxl) hn.1
    · exact eq_of_nodup_map hn.2 hxl hyl hxy

/-- With distinct ids, a lookup finds the one cap of that id. -/
theorem cap?_of_mem {st : State} (hn : (st.caps.map (·.id)).Nodup) {cp : Cap} (h : cp ∈ st.caps) :
    st.cap? cp.id = some cp := by
  cases hf : st.cap? cp.id with
  | none =>
    unfold State.cap? at hf
    rw [List.find?_eq_none] at hf
    exact absurd (by simp) (hf cp h)
  | some cp' => rw [eq_of_nodup_map hn (cap?_mem hf) h (cap?_id hf)]

/-- With distinct ids, a lookup finds the one entry of that id. -/
theorem entry?_of_mem {st : State} (hn : (st.entries.map (·.id)).Nodup) {en : Entry} (h : en ∈ st.entries) :
    st.entry? en.id = some en := by
  cases hf : st.entry? en.id with
  | none =>
    unfold State.entry? at hf
    rw [List.find?_eq_none] at hf
    exact absurd (by simp) (hf en h)
  | some en' => rw [eq_of_nodup_map hn (entry?_mem hf) h (entry?_id hf)]

/-- The cell of a stay is the cell of a stay the entry has. -/
theorem stayCell_mem {en : Entry} {s : Option EditId} {x : Cell} (h : en.stayCell s = some x) : (s, x) ∈ en.stays := by
  unfold Entry.stayCell at h
  cases hf : en.stays.find? (·.1 == s) with
  | none => rw [hf] at h; cases h
  | some p =>
    rw [hf] at h
    cases h
    have hp := List.find?_some hf
    simp only [beq_iff_eq] at hp
    rw [← hp]
    exact List.mem_of_find?_eq_some hf

/-- A stay the entry has has a cell. -/
theorem stayCell_of_mem {en : Entry} {s : Option EditId} (h : s ∈ en.stays.map (·.1)) :
    ∃ x, en.stayCell s = some x := by
  unfold Entry.stayCell
  cases hf : en.stays.find? (·.1 == s) with
  | none =>
    rw [List.find?_eq_none] at hf
    obtain ⟨p, hp, rfl⟩ := List.mem_map.1 h
    exact absurd (by simp) (hf p hp)
  | some p => exact ⟨p.2, rfl⟩

/-! ## What an accepted edit changes

Before settling keys, an accepted edit changes the state in one of a few ways (`Change`), and a removal then drops
some entries and writes (`Applied`). -/

/-- Keep, in order, each write whose dependencies were kept: some of the writes. -/
theorem closeDeps_sublist (ws : List Write) : (closeDeps ws).Sublist ws := by
  unfold closeDeps
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

/-- How an accepted edit changes the state, before a removal drops entries and writes. -/
inductive Change (st : State) : State → Prop where
  | same : Change st st
  | genesis (vt : Vault) : st.vault? vt.id = none → (∀ p ∈ vt.owners, ownerFits st vt.kind p = true) →
      Change st { st with vaults := st.vaults ++ [vt] }
  | setVault (v : VaultId) (vt vt' : Vault) : st.vault? v = some vt → vt'.id = vt.id →
      (∀ p ∈ vt'.owners, p ∈ vt.owners ∨ ownerFits st vt.kind p = true) → Change st (setVault st vt')
  | cap (c : Cap) : st.cap? c.id = none → (st.vault? c.over).isSome = true →
      (∀ g, c.grantee = .principal (.vault g) → (st.vault? g).isSome = true) →
      Change st { st with caps := st.caps ++ [c] }
  | revoke (rs : List CapId) : Change st { st with revoked := st.revoked ++ rs }
  | create (en : Entry) (w : Write) (x : Cell) (u : List EditId) : st.entry? en.id = none → en.id ∉ st.born →
      (st.vault? en.vault).isSome = true → en.stays = [(none, x)] → w.entry = en.id → w.stay = none →
      Change st { st with entries := st.entries ++ [en], born := st.born ++ [en.id], writes := st.writes ++ [w],
                          uncounted := u }
  | write (en : Entry) (w : Write) (st₁ : State) (u : List EditId) : st.entry? w.entry = some en →
      w.stay ∈ en.stays.map (·.1) → (st₁ = st ∨ ∃ a, st₁ = setEntry st { en with attrs := a }) →
      Change st { st₁ with writes := st₁.writes ++ [w], uncounted := u }
  | move (en : Entry) (σ : Option EditId) (x : Cell) : st.entry? en.id = some en → σ ∉ en.stays.map (·.1) →
      Change st (setEntry st { en with stays := (σ, x) :: en.stays })
  | lane (l : List (VaultId × BlobId)) : Change st { st with lane := l }

/-- An accepted edit: a change, then some of the entries and writes dropped. -/
def Applied (st post : State) : Prop :=
  ∃ mid, Change st mid ∧ ∃ es ws, es.Sublist mid.entries ∧ ws.Sublist mid.writes ∧
    post = { mid with entries := es, writes := ws }

/-- A change that drops nothing. -/
theorem Change.applied {st mid : State} (h : Change st mid) : Applied st mid :=
  ⟨mid, h, _, _, .refl _, .refl _, rfl⟩

/-- A change, and then what a removal drops. -/
theorem Change.applied_drop {st mid : State} (h : Change st mid) (keep : List EditId) :
    Applied st (dropUnseen st mid keep) :=
  ⟨mid, h, _, _, List.filter_sublist, List.filter_sublist.trans ((closeDeps_sublist _).trans List.filter_sublist),
    rfl⟩

/-- Every accepted edit is a change, then some entries and writes dropped. -/
theorem apply_cases {st post : State} {edit : Edit} (h : apply st edit = some post) : Applied st post := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try (cases h; done))
  · -- genesis
    rename_i hfree hfit _ _
    cases h
    refine Change.applied (.genesis _ ?_ ?_)
    · simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, Option.isSome_eq_false_iff,
        Option.isNone_iff_eq_none] at hfree
      exact hfree.1.1
    · simp only [Bool.or_eq_true, Bool.not_eq_true', not_or, Bool.not_eq_false, List.all_eq_true] at hfit
      exact hfit.1
  · -- addOwner, a vault
    rename_i hv _ _ _ hfit _ _
    cases h
    refine Change.applied (.setVault _ _ _ hv (by rfl) fun p hp => ?_)
    rcases List.mem_append.1 hp with hp | hp
    · exact .inl hp
    · rw [List.mem_singleton] at hp
      subst hp
      simp only [Bool.or_eq_true, Bool.not_eq_true', not_or, Bool.not_eq_false] at hfit
      exact .inr hfit.2
  · -- addOwner, a signer
    rename_i hv _ _ _ hfit _ _
    cases h
    refine Change.applied (.setVault _ _ _ hv (by rfl) fun p hp => ?_)
    rcases List.mem_append.1 hp with hp | hp
    · exact .inl hp
    · rw [List.mem_singleton] at hp
      subst hp
      simp only [Bool.or_eq_true, Bool.not_eq_true', not_or, Bool.not_eq_false] at hfit
      exact .inr hfit.2
  · -- removeOwner
    rename_i hv _ _
    cases h
    exact Change.applied_drop (.setVault _ _ _ hv (by rfl) fun p hp => .inl (List.mem_of_mem_erase hp)) _
  · -- setThreshold
    rename_i hv _
    cases h
    exact Change.applied (.setVault _ _ _ hv (by rfl) fun p hp => .inl hp)
  · -- addDevice
    rename_i hv _ _
    cases h
    exact Change.applied (.setVault _ _ _ hv (by rfl) fun p hp => .inl hp)
  · -- removeDevice
    rename_i hv _ _
    cases h
    refine Change.applied_drop (.setVault _ _ _ hv (by rfl) fun p hp => ?_) _
    exact .inl hp
  · -- setRoot
    rename_i hv _
    cases h
    exact Change.applied (.setVault _ _ _ hv (by rfl) fun p hp => .inl hp)
  · -- a cap naming a signer is refused
    rename_i hno _ _
    exact absurd rfl hno
  · -- a cap naming a vault
    rename_i hfree _ g hg hgv _ _
    cases h
    simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, Option.isSome_eq_false_iff,
      Option.isNone_iff_eq_none] at hfree hgv
    refine Change.applied (.cap _ hfree.1 (Option.isSome_iff_ne_none.2 hfree.2) fun g' hg' => ?_)
    rw [hg] at hg'
    cases hg'
    exact Option.isSome_iff_ne_none.2 hgv.1
  · -- a public cap
    rename_i hfree _ hg _ _ _
    cases h
    simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, Option.isSome_eq_false_iff,
      Option.isNone_iff_eq_none] at hfree
    refine Change.applied (.cap _ hfree.1 (Option.isSome_iff_ne_none.2 hfree.2) fun g' hg' => ?_)
    rw [hg] at hg'
    cases hg'
  · -- revoke
    cases h
    exact Change.applied_drop (.revoke _) _
  · -- a write creating its entry
    rename_i hfresh _
    cases h
    simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, Option.isSome_eq_false_iff,
      Option.isNone_iff_eq_none, List.contains_iff_mem] at hfresh
    exact Change.applied (.create _ _ _ _ hfresh.1.1.1.1.1 hfresh.1.1.1.1.2
      (Option.isSome_iff_ne_none.2 hfresh.1.1.1.2) rfl rfl rfl)
  · -- a write to an entry, by its own vault
    rename_i he _ _ _ hx _ _ _ _
    cases h
    exact Change.applied (.write _ _ _ _ he (List.mem_map.2 ⟨_, stayCell_mem hx, rfl⟩) (.inr ⟨_, rfl⟩))
  · -- a write to an entry, by another vault
    rename_i he _ _ _ hx _ _ _ _
    cases h
    exact Change.applied (.write _ _ _ _ he (List.mem_map.2 ⟨_, stayCell_mem hx, rfl⟩) (.inl rfl))
  · -- move
    rename_i he _ hnew
    cases h
    simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, List.any_eq_false, beq_iff_eq] at hnew
    refine Change.applied_drop (.move _ _ _ (by rw [entry?_id he]; exact he) fun hm => ?_) _
    obtain ⟨p, hp, hp1⟩ := List.mem_map.1 hm
    exact hnew.2 p hp hp1
  · -- keys
    cases h
    exact Change.applied .same
  · -- publish
    cases h
    exact Change.applied (.lane _)
  · -- checkpoint
    cases h
    exact Change.applied .same

/-! ## What exists

Owners, a cap's vault and grantee, and an entry's vault exist; caps and entries have distinct ids; each entry has
stays, all distinct; and a write is of an entry once created, in one of its entry's stays (`Sane`). Every accepted
edit keeps this. -/

/-- A vault that may own vaults exists. -/
theorem ownerFits_vault {st : State} {k : Kind} {o : VaultId} (h : ownerFits st k (.vault o) = true) :
    (st.vault? o).isSome = true := by
  cases k with
  | human => simp [ownerFits] at h
  | coop | aven =>
    simp only [ownerFits, ownsVaults] at h
    cases ho : st.vault? o with
    | none => rw [ho] at h; cases h
    | some _ => rfl

/-- Lookups only read the vaults. -/
theorem vault?_congr {st st' : State} (h : st'.vaults = st.vaults) (x : VaultId) : st'.vault? x = st.vault? x := by
  simp only [State.vault?, h]

/-- An appended vault is found only where nothing was found before. -/
theorem vault?_append (st : State) (vt : Vault) (x : VaultId) :
    ({ st with vaults := st.vaults ++ [vt] } : State).vault? x =
      (st.vault? x).or (if vt.id = x then some vt else none) := by
  simp only [State.vault?, List.find?_append, List.find?_cons, List.find?_nil]
  cases hb : (vt.id == x)
  · have : ¬vt.id = x := by simpa using hb
    simp [this]
  · have : vt.id = x := by simpa using hb
    simp [this]

/-- `setVault` replaces the vault of the same id and leaves the others. -/
theorem vault?_setVault (st : State) (vt' : Vault) (x : VaultId) :
    (setVault st vt').vault? x = (st.vault? x).map (fun y => if y.id == vt'.id then vt' else y) := by
  unfold setVault State.vault?
  simp only [List.find?_map]
  congr 2
  funext y
  simp only [Function.comp]
  split <;> simp_all

/-- What every reachable state keeps about what exists: what owners, caps and entries name exists, ids are distinct,
    entries have distinct stays, and writes are of entries once created, in stays they have. -/
structure Sane (st : State) : Prop where
  /-- Every owner vault exists. -/
  owners : ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome = true
  /-- Caps have distinct ids. -/
  capIds : (st.caps.map (·.id)).Nodup
  /-- A cap's vault exists. -/
  capOver : ∀ cp ∈ st.caps, (st.vault? cp.over).isSome = true
  /-- A cap's grantee vault exists. -/
  capGrantee : ∀ cp ∈ st.caps, ∀ g, cp.grantee = .principal (.vault g) → (st.vault? g).isSome = true
  /-- Entries have distinct ids. -/
  entryIds : (st.entries.map (·.id)).Nodup
  /-- An entry's vault exists. -/
  entryVault : ∀ en ∈ st.entries, (st.vault? en.vault).isSome = true
  /-- An entry's id was created. -/
  entryBorn : ∀ en ∈ st.entries, en.id ∈ st.born
  /-- An entry is in some stay. -/
  staysNe : ∀ en ∈ st.entries, en.stays ≠ []
  /-- An entry's stays are distinct. -/
  staysNodup : ∀ en ∈ st.entries, (en.stays.map (·.1)).Nodup
  /-- A write is of an entry once created. -/
  writeBorn : ∀ w ∈ st.writes, w.entry ∈ st.born
  /-- A write is in a stay its entry has. -/
  writeStay : ∀ w ∈ st.writes, ∀ en ∈ st.entries, en.id = w.entry → w.stay ∈ en.stays.map (·.1)

/-- A change to the vaults alone that keeps every vault and whose owners exist keeps the state sane. -/
theorem Sane.of_vaults {st st' : State} (hs : Sane st)
    (hgrow : ∀ x, (st.vault? x).isSome = true → (st'.vault? x).isSome = true)
    (howners : ∀ x vt, st'.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st'.vault? o).isSome = true)
    (hc : st'.caps = st.caps) (he : st'.entries = st.entries) (hw : st'.writes = st.writes)
    (hb : st'.born = st.born) : Sane st' where
  owners := howners
  capIds := hc ▸ hs.capIds
  capOver cp hcp := hgrow _ (hs.capOver cp (hc ▸ hcp))
  capGrantee cp hcp g hg := hgrow _ (hs.capGrantee cp (hc ▸ hcp) g hg)
  entryIds := he ▸ hs.entryIds
  entryVault en hen := hgrow _ (hs.entryVault en (he ▸ hen))
  entryBorn en hen := hb ▸ hs.entryBorn en (he ▸ hen)
  staysNe en hen := hs.staysNe en (he ▸ hen)
  staysNodup en hen := hs.staysNodup en (he ▸ hen)
  writeBorn w hw' := hb ▸ hs.writeBorn w (hw ▸ hw')
  writeStay w hw' en hen := hs.writeStay w (hw ▸ hw') en (he ▸ hen)

/-- A state with the same vaults, caps, entries, writes and births is as sane. -/
theorem Sane.congr {st st' : State} (hs : Sane st) (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (he : st'.entries = st.entries) (hw : st'.writes = st.writes) (hb : st'.born = st.born) : Sane st' :=
  hs.of_vaults (fun x h => by rw [vault?_congr hv]; exact h)
    (fun x vt h o ho => by rw [vault?_congr hv] at h ⊢; exact hs.owners x vt h o ho) hc he hw hb

/-- Changing one entry, keeping its id and vault, keeping its stays and adding fresh ones, keeps the state sane. -/
theorem Sane.set_entry {st : State} (hs : Sane st) {en en' : Entry} (hen : en ∈ st.entries) (hid : en'.id = en.id)
    (hv : en'.vault = en.vault) (hne : en'.stays ≠ []) (hnd : (en'.stays.map (·.1)).Nodup)
    (hsub : ∀ s ∈ en.stays.map (·.1), s ∈ en'.stays.map (·.1)) : Sane (AvenDB.setEntry st en') := by
  -- every entry after is `en'` in place of an entry of its id, or an entry as it was
  have hmem : ∀ y ∈ (AvenDB.setEntry st en').entries, (y = en' ∧ ∃ x ∈ st.entries, x.id = en'.id) ∨
      (y ∈ st.entries ∧ y.id ≠ en'.id) := by
    intro y hy
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hy
    by_cases hxid : x.id = en'.id
    · exact .inl ⟨by simp [hxid], x, hx, hxid⟩
    · exact .inr ⟨by simp [hxid, hx], by simp [hxid]⟩
  refine Sane.of_vaults (st := { st with entries := (AvenDB.setEntry st en').entries }) ?_ (fun _ h => h) hs.owners
    rfl rfl rfl rfl
  refine ⟨hs.owners, hs.capIds, hs.capOver, hs.capGrantee, ?_, ?_, ?_, ?_, ?_, hs.writeBorn, ?_⟩
  · show ((st.entries.map fun x : Entry => if x.id == en'.id then en' else x).map fun x : Entry => x.id).Nodup
    rw [List.map_map]
    have : ((·.id) ∘ fun x : Entry => if x.id == en'.id then en' else x) = (·.id) := by
      funext x
      by_cases hx : x.id = en'.id <;> simp [hx]
    rw [this]
    exact hs.entryIds
  · intro y hy
    rcases hmem y hy with ⟨rfl, -⟩ | ⟨hy, -⟩
    · rw [hv]; exact hs.entryVault en hen
    · exact hs.entryVault y hy
  · intro y hy
    rcases hmem y hy with ⟨rfl, -⟩ | ⟨hy, -⟩
    · rw [hid]; exact hs.entryBorn en hen
    · exact hs.entryBorn y hy
  · intro y hy
    rcases hmem y hy with ⟨rfl, -⟩ | ⟨hy, -⟩
    · exact hne
    · exact hs.staysNe y hy
  · intro y hy
    rcases hmem y hy with ⟨rfl, -⟩ | ⟨hy, -⟩
    · exact hnd
    · exact hs.staysNodup y hy
  · intro w hw y hy hyw
    rcases hmem y hy with ⟨rfl, x, hx, hxid⟩ | ⟨hy, -⟩
    · -- the entry of that id was `en`
      have hxe : x = en := eq_of_nodup_map hs.entryIds hx hen (by rw [hxid, hid])
      subst hxe
      exact hsub _ (hs.writeStay w hw x hx (by rw [← hyw, hxid]))
    · exact hs.writeStay w hw y hy hyw

/-- Adding a write of an entry ever created, in a stay of its entry, keeps the state sane. -/
theorem Sane.addWrite {st : State} (hs : Sane st) {w : Write} {u : List EditId} (hb : w.entry ∈ st.born)
    (hstay : ∀ en ∈ st.entries, en.id = w.entry → w.stay ∈ en.stays.map (·.1)) :
    Sane { st with writes := st.writes ++ [w], uncounted := u } where
  owners := hs.owners
  capIds := hs.capIds
  capOver := hs.capOver
  capGrantee := hs.capGrantee
  entryIds := hs.entryIds
  entryVault := hs.entryVault
  entryBorn := hs.entryBorn
  staysNe := hs.staysNe
  staysNodup := hs.staysNodup
  writeBorn x hx := by
    rcases List.mem_append.1 hx with hx | hx
    · exact hs.writeBorn x hx
    · rw [List.mem_singleton.1 hx]; exact hb
  writeStay x hx := by
    rcases List.mem_append.1 hx with hx | hx
    · exact hs.writeStay x hx
    · rw [List.mem_singleton.1 hx]; exact hstay

/-- Dropping entries and writes keeps the state sane. -/
theorem Sane.drop {st : State} (hs : Sane st) {es : List Entry} {ws : List Write} (he : es.Sublist st.entries)
    (hw : ws.Sublist st.writes) : Sane { st with entries := es, writes := ws } where
  owners := hs.owners
  capIds := hs.capIds
  capOver := hs.capOver
  capGrantee := hs.capGrantee
  entryIds := (he.map _).nodup hs.entryIds
  entryVault en hen := hs.entryVault en (he.subset hen)
  entryBorn en hen := hs.entryBorn en (he.subset hen)
  staysNe en hen := hs.staysNe en (he.subset hen)
  staysNodup en hen := hs.staysNodup en (he.subset hen)
  writeBorn w hw' := hs.writeBorn w (hw.subset hw')
  writeStay w hw' en hen := hs.writeStay w (hw.subset hw') en (he.subset hen)

/-- A change keeps the state sane. -/
theorem Sane.change {st mid : State} (hs : Sane st) (h : Change st mid) : Sane mid := by
  cases h with
  | same => exact hs
  | genesis vt hfree hfit =>
    refine Sane.of_vaults hs (fun x hx => ?_) (fun x u hx o ho => ?_) rfl rfl rfl rfl
    · rw [vault?_append]
      cases hl : st.vault? x with
      | none => rw [hl] at hx; cases hx
      | some _ => rfl
    · rw [vault?_append] at hx ⊢
      have hgrow : (st.vault? o).isSome = true → ((st.vault? o).or (if vt.id = o then some vt else none)).isSome =
          true := fun h => by
        cases hl : st.vault? o with
        | none => rw [hl] at h; cases h
        | some _ => rfl
      cases hl : st.vault? x with
      | some u' =>
        rw [hl] at hx
        cases hx
        exact hgrow (hs.owners x _ hl o ho)
      | none =>
        rw [hl] at hx
        by_cases hvx : vt.id = x
        · simp only [hvx, Option.none_or, ite_true, Option.some.injEq] at hx
          subst hx
          exact hgrow (ownerFits_vault (hfit _ ho))
        · simp [hvx] at hx
  | setVault v vt vt' hv hid hown =>
    refine Sane.of_vaults hs (fun x hx => ?_) (fun x u hx o ho => ?_) rfl rfl rfl rfl
    · rw [vault?_setVault]
      cases hl : st.vault? x with
      | none => rw [hl] at hx; cases hx
      | some _ => rfl
    · have hgrow : (st.vault? o).isSome = true → ((setVault st vt').vault? o).isSome = true := fun h => by
        rw [vault?_setVault]
        cases hl : st.vault? o with
        | none => rw [hl] at h; cases h
        | some _ => rfl
      rw [vault?_setVault] at hx
      cases hl : st.vault? x with
      | none => rw [hl] at hx; cases hx
      | some y =>
        rw [hl] at hx
        simp only [Option.map_some, Option.some.injEq] at hx
        by_cases hy : y.id = vt'.id
        · simp only [hy, beq_self_eq_true, ite_true] at hx
          subst hx
          rcases hown _ ho with ho | ho
          · exact hgrow (hs.owners v vt hv o ho)
          · exact hgrow (ownerFits_vault ho)
        · simp only [beq_iff_eq, hy, ite_false] at hx
          subst hx
          exact hgrow (hs.owners x _ hl o ho)
  | cap c hfree hover hgr =>
    refine ⟨hs.owners, ?_, ?_, ?_, hs.entryIds, hs.entryVault, hs.entryBorn, hs.staysNe, hs.staysNodup,
      hs.writeBorn, hs.writeStay⟩
    · show ((st.caps ++ [c]).map (·.id)).Nodup
      rw [List.map_append, List.nodup_append]
      refine ⟨hs.capIds, by simp, fun a ha b hb => ?_⟩
      rw [List.mem_singleton.1 hb]
      intro hac
      obtain ⟨cp, hcp, rfl⟩ := List.mem_map.1 ha
      unfold State.cap? at hfree
      rw [List.find?_eq_none] at hfree
      exact hfree cp hcp (by simp [hac])
    · intro cp hcp
      rcases List.mem_append.1 hcp with hcp | hcp
      · exact hs.capOver cp hcp
      · rw [List.mem_singleton.1 hcp]; exact hover
    · intro cp hcp g hg
      rcases List.mem_append.1 hcp with hcp | hcp
      · exact hs.capGrantee cp hcp g hg
      · rw [List.mem_singleton.1 hcp] at hg; exact hgr g hg
  | revoke rs => exact hs.congr rfl rfl rfl rfl rfl
  | create en w x _ hfree hnew hv hstays hwe hws =>
    have hnot : ∀ y ∈ st.entries, y.id ≠ en.id := fun y hy hid => by
      unfold State.entry? at hfree
      rw [List.find?_eq_none] at hfree
      exact hfree y hy (by simp [hid])
    refine ⟨hs.owners, hs.capIds, hs.capOver, hs.capGrantee, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · show ((st.entries ++ [en]).map (·.id)).Nodup
      rw [List.map_append, List.nodup_append]
      refine ⟨hs.entryIds, by simp, fun a ha b hb => ?_⟩
      rw [List.mem_singleton.1 hb]
      obtain ⟨y, hy, rfl⟩ := List.mem_map.1 ha
      exact hnot y hy
    · intro y hy
      rcases List.mem_append.1 hy with hy | hy
      · exact hs.entryVault y hy
      · rw [List.mem_singleton.1 hy]; exact hv
    · intro y hy
      rcases List.mem_append.1 hy with hy | hy
      · exact List.mem_append_left _ (hs.entryBorn y hy)
      · rw [List.mem_singleton.1 hy]; exact List.mem_append_right _ (List.mem_singleton_self _)
    · intro y hy
      rcases List.mem_append.1 hy with hy | hy
      · exact hs.staysNe y hy
      · rw [List.mem_singleton.1 hy, hstays]; simp
    · intro y hy
      rcases List.mem_append.1 hy with hy | hy
      · exact hs.staysNodup y hy
      · rw [List.mem_singleton.1 hy, hstays]; simp
    · intro x' hx
      rcases List.mem_append.1 hx with hx | hx
      · exact List.mem_append_left _ (hs.writeBorn x' hx)
      · rw [List.mem_singleton.1 hx, hwe]; exact List.mem_append_right _ (List.mem_singleton_self _)
    · intro x' hx y hy hyx
      rcases List.mem_append.1 hx with hx | hx <;> rcases List.mem_append.1 hy with hy | hy
      · exact hs.writeStay x' hx y hy hyx
      · -- an old write is of an entry created before, not of the new one
        rw [List.mem_singleton.1 hy] at hyx
        exact absurd (hyx ▸ hs.writeBorn x' hx) hnew
      · rw [List.mem_singleton.1 hx, hwe] at hyx
        exact absurd hyx (hnot y hy)
      · rw [List.mem_singleton.1 hx, List.mem_singleton.1 hy, hws, hstays]
        simp
  | write en w st₁ _ he hstay h₁ =>
    have hen := entry?_mem he
    have hid := entry?_id he
    rcases h₁ with rfl | ⟨a, rfl⟩
    · refine hs.addWrite (hid ▸ hs.entryBorn en hen) fun y hy hyw => ?_
      have : y = en := eq_of_nodup_map hs.entryIds hy hen (by rw [hyw, hid])
      exact this ▸ hstay
    · have hs₁ := hs.set_entry (en' := { en with attrs := a }) hen rfl rfl (hs.staysNe en hen) (hs.staysNodup en hen)
        fun s hs => hs
      refine hs₁.addWrite (hid ▸ hs.entryBorn en hen) fun y hy hyw => ?_
      obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hy
      by_cases hxid : x.id = en.id
      · simp only [hxid, beq_self_eq_true, ite_true]
        exact hstay
      · simp only [beq_iff_eq, hxid, ite_false] at hyw ⊢
        exact absurd (hyw.trans hid.symm) hxid
  | move en σ x he hσ =>
    have hen := entry?_mem he
    refine hs.set_entry hen rfl rfl (by simp) ?_ fun s hs => List.mem_cons_of_mem _ hs
    rw [List.map_cons, List.nodup_cons]
    exact ⟨hσ, hs.staysNodup en hen⟩
  | lane l => exact hs.congr rfl rfl rfl rfl rfl

/-- An accepted edit keeps the state sane. -/
theorem Sane.of_apply {st post : State} {edit : Edit} (hs : Sane st) (h : apply st edit = some post) : Sane post := by
  obtain ⟨mid, hc, es, ws, he, hw, rfl⟩ := apply_cases h
  exact (hs.change hc).drop he hw

/-! ## What the key rules read

Who may open what reads only the vaults, the caps and the revocations; the key families read the entries too, and the
targets the epochs. -/

/-- The current key reads only the epochs. -/
theorem curKey_congr {st st' : State} (he : st'.epochs = st.epochs) (k : KeyFam) : st'.curKey k = st.curKey k := by
  simp only [State.curKey, State.epochOf, he]

/-- Acting for a vault reads only the vaults. -/
theorem actsForN_congr {st st' : State} (hv : st'.vaults = st.vaults) (s : SignerId) :
    ∀ n v, actsForN st' s n v = actsForN st s n v
  | 0, _ => rfl
  | n + 1, v => by simp only [actsForN, vault?_congr hv, actsForN_congr hv s n]

/-- Owning a vault reads only the vaults. -/
theorem ownsN_congr {st st' : State} (hv : st'.vaults = st.vaults) (a : VaultId) :
    ∀ n x, ownsN st' a n x = ownsN st a n x
  | 0, _ => rfl
  | n + 1, x => by simp only [ownsN, vault?_congr hv, ownsN_congr hv a n]

/-- What a vault may read reads only the caps and the revocations. -/
theorem readsV_congr {st st' : State} (hc : st'.caps = st.caps) (hr : st'.revoked = st.revoked) (y : VaultId)
    (k : KeyFam) : readsV st' y k = readsV st y k := by
  cases k <;> simp only [readsV, State.cap?, State.live, hc, hr]

/-- Being public reads only the caps and the revocations. -/
theorem publicKey_congr {st st' : State} (hc : st'.caps = st.caps) (hr : st'.revoked = st.revoked) (k : KeyFam) :
    publicKey st' k = publicKey st k := by
  cases k <;> simp only [publicKey, State.cap?, State.live, hc, hr]

/-- Being entitled reads only the vaults, the caps and the revocations. -/
theorem Holder.entitled_congr {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (h : Holder) (k : KeyFam) : h.entitled st' k = h.entitled st k := by
  have hd : st'.depth = st.depth := by simp [State.depth, hv]
  cases h <;> simp only [Holder.entitled, AvenDB.entitled, entitledV, actsFor, owns, hd, actsForN_congr hv,
    ownsN_congr hv, readsV_congr hc hr, hv, publicKey_congr hc hr]

/-- The key families read only the vaults, the caps, the revocations and the entries. -/
theorem keyFams_congr {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (he : st'.entries = st.entries) : keyFams st' = keyFams st := by
  simp only [keyFams, State.live, hv, hc, hr, he]

/-- The targets read only the vaults, the caps, the revocations and the epochs. -/
theorem targets_congr {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (he : st'.epochs = st.epochs) (k : KeyFam) : targets st' k = targets st k := by
  cases k <;> simp only [targets, vault?_congr hv, State.cap?, State.live, hc, hr, curKey_congr he]

/-- The holders read only the vaults. -/
theorem holders_congr {st st' : State} (hv : st'.vaults = st.vaults) : holders st' = holders st := by
  simp only [holders, signers, hv]

/-! ## Settling keys

Settling rotates the stale families (`bump`), seals each current key to its targets and publishes the public ones,
then derives and links the entry keys (`linkAll`). It changes only the epochs, the seals and what is published. -/

/-- `st'` is `st` with other epochs, seals and published keys. -/
def KeysOnly (st st' : State) : Prop := ∃ es ss ps, st' = { st with epochs := es, seals := ss, published := ps }

/-- `st'` is `st` with other seals and published keys. -/
def SealsOnly (st st' : State) : Prop := ∃ ss ps, st' = { st with seals := ss, published := ps }

/-- A state differs from itself in its seals and published keys only. -/
theorem SealsOnly.refl (st : State) : SealsOnly st st := ⟨st.seals, st.published, rfl⟩

/-- Changing only the seals and published keys twice changes only those. -/
theorem SealsOnly.trans {a b c : State} (h₁ : SealsOnly a b) (h₂ : SealsOnly b c) : SealsOnly a c := by
  obtain ⟨ss, ps, rfl⟩ := h₁
  obtain ⟨ss', ps', rfl⟩ := h₂
  exact ⟨ss', ps', rfl⟩

/-- Changing only the seals and published keys changes only the key schedule. -/
theorem SealsOnly.keysOnly {a b : State} (h : SealsOnly a b) : KeysOnly a b := by
  obtain ⟨ss, ps, rfl⟩ := h
  exact ⟨a.epochs, ss, ps, rfl⟩

/-- Changing only the key schedule twice changes only the key schedule. -/
theorem KeysOnly.trans {a b c : State} (h₁ : KeysOnly a b) (h₂ : KeysOnly b c) : KeysOnly a c := by
  obtain ⟨es, ss, ps, rfl⟩ := h₁
  obtain ⟨es', ss', ps', rfl⟩ := h₂
  exact ⟨es', ss', ps', rfl⟩

/-- What a change of keys keeps. -/
structure Kept (st st' : State) : Prop where
  vaults : st'.vaults = st.vaults
  caps : st'.caps = st.caps
  revoked : st'.revoked = st.revoked
  entries : st'.entries = st.entries
  writes : st'.writes = st.writes
  born : st'.born = st.born

/-- Changing only the key schedule keeps what the key rules read but the epochs. -/
theorem KeysOnly.kept {a b : State} (h : KeysOnly a b) : Kept a b := by
  obtain ⟨es, ss, ps, rfl⟩ := h
  exact ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩

/-- Changing only the seals and published keys keeps the epochs. -/
theorem SealsOnly.epochs {a b : State} (h : SealsOnly a b) : b.epochs = a.epochs := by
  obtain ⟨ss, ps, rfl⟩ := h
  rfl

/-- A change of keys keeps the families in use. -/
theorem Kept.keyFams {a b : State} (h : Kept a b) : keyFams b = keyFams a :=
  keyFams_congr h.vaults h.caps h.revoked h.entries

/-- A change of keys keeps who is entitled to what. -/
theorem Kept.entitled {a b : State} (h : Kept a b) (x : Holder) (k : KeyFam) : x.entitled b k = x.entitled a k :=
  Holder.entitled_congr h.vaults h.caps h.revoked x k

/-- A change of keys keeps which families are public. -/
theorem Kept.publicKey {a b : State} (h : Kept a b) (k : KeyFam) : publicKey b k = publicKey a k :=
  publicKey_congr h.caps h.revoked k

/-- A change of keys keeps the state sane. -/
theorem Kept.sane {a b : State} (h : Kept a b) (hs : Sane a) : Sane b :=
  hs.congr h.vaults h.caps h.entries h.writes h.born

/-- Adding a seal changes only the seals. -/
theorem sealsOnly_addSeal (st : State) (s : Seal) : SealsOnly st (addSeal st s) := by
  unfold addSeal
  split
  · exact .refl _
  · exact ⟨_, _, rfl⟩

/-- Publishing a key changes only what is published. -/
theorem sealsOnly_publish (st : State) (k : KeyName) : SealsOnly st (publish st k) := by
  unfold publish
  split
  · exact .refl _
  · exact ⟨_, _, rfl⟩

/-- Linking the entry keys only adds seals. -/
theorem sealsOnly_linkAll (st : State) : SealsOnly st (linkAll st) := by
  unfold linkAll
  refine foldl_inv (fun acc => SealsOnly st acc) _ (fun acc en h => ?_) _ _ (.refl _)
  dsimp only
  refine foldl_inv (fun acc => SealsOnly st acc) _ (fun acc w h => ?_) _ _
    (h.trans (sealsOnly_addSeal _ _))
  have h' := h.trans (sealsOnly_addSeal acc
    ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩)
  split
  · exact h'
  · exact h'.trans (sealsOnly_addSeal _ _)

/-- One family's turn in `sealAll`: seal its current key to each target, and publish it if it is public. -/
def sealOne (acc : State) (k : KeyFam) : State :=
  let acc := (targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc
  if publicKey acc k then publish acc (acc.curKey k) else acc

/-- `sealAll` takes one family's turn after another, then links the entry keys. -/
theorem sealAll_eq (st : State) : sealAll st = linkAll ((keyFams st).foldl sealOne st) := rfl

/-- Sealing to the targets only adds seals of the current key to a target. -/
theorem foldl_addSeal (acc : State) (k : KeyFam) :
    SealsOnly acc ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc) ∧
    (∀ s ∈ ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).seals,
      s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩) ∧
    ∀ t ∈ targets acc k, ⟨acc.curKey k, t⟩ ∈ ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).seals
    := by
  -- the seals only grow
  have hgrow : ∀ (a : State) (s : Seal) (x : Seal), x ∈ a.seals → x ∈ (addSeal a s).seals := by
    intro a s x hx
    unfold addSeal
    split
    · exact hx
    · exact List.mem_append_left _ hx
  have hadd : ∀ (a : State) (s : Seal), s ∈ (addSeal a s).seals := by
    intro a s
    unfold addSeal
    split
    · rename_i h; exact List.contains_iff_mem.1 h
    · exact List.mem_append_right _ (List.mem_singleton_self _)
  refine ⟨?_, ?_, ?_⟩
  · refine foldl_inv (fun a => SealsOnly acc a) _ (fun a t h => h.trans (sealsOnly_addSeal _ _)) _ _ (.refl _)
  · refine foldl_inv_mem (fun a : State => SealsOnly acc a ∧ ∀ s ∈ a.seals,
      s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩) _ _ ?_ acc ⟨.refl _, fun s hs => .inl hs⟩ |>.2
    intro a t ht ⟨hso, hseals⟩
    refine ⟨hso.trans (sealsOnly_addSeal _ _), fun s hs => ?_⟩
    unfold addSeal at hs
    split at hs
    · exact hseals s hs
    · rcases List.mem_append.1 hs with hs | hs
      · exact hseals s hs
      · rw [List.mem_singleton] at hs
        subst hs
        exact .inr ⟨t, ht, by rw [curKey_congr hso.epochs]⟩
  · intro t ht
    suffices h : ∀ (l : List KeyName) (a : State), SealsOnly acc a → t ∈ l →
        ⟨acc.curKey k, t⟩ ∈ (l.foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) a).seals from
      h _ acc (.refl _) ht
    intro l
    induction l with
    | nil => intro _ _ h; cases h
    | cons t' l ih =>
      intro a hso hmem
      rw [List.foldl_cons]
      rcases List.mem_cons.1 hmem with rfl | hmem
      · refine foldl_inv (fun b : State => ⟨acc.curKey k, t⟩ ∈ b.seals) _ (fun b _ h => hgrow _ _ _ h) l _ ?_
        rw [← curKey_congr hso.epochs]
        exact hadd _ _
      · exact ih _ (hso.trans (sealsOnly_addSeal _ _)) hmem

/-- A seal is added, or was there. -/
theorem mem_addSeal {st : State} {x s : Seal} (h : s ∈ (addSeal st x).seals) : s ∈ st.seals ∨ s = x := by
  unfold addSeal at h
  split at h
  · exact .inl h
  · rcases List.mem_append.1 h with h | h
    · exact .inl h
    · exact .inr (List.mem_singleton.1 h)

/-- Sealing keeps every seal. -/
theorem mem_addSeal_of_mem {st : State} {x s : Seal} (h : s ∈ st.seals) : s ∈ (addSeal st x).seals := by
  unfold addSeal
  split
  · exact h
  · exact List.mem_append_left _ h

/-- Sealing adds its seal. -/
theorem addSeal_mem (st : State) (x : Seal) : x ∈ (addSeal st x).seals := by
  unfold addSeal
  split
  · rename_i h; exact List.contains_iff_mem.1 h
  · exact List.mem_append_right _ (List.mem_singleton_self _)

/-- Linking the entry keys keeps every seal and publishes nothing. -/
theorem linkAll_mono (st : State) : (linkAll st).published = st.published ∧ ∀ s ∈ st.seals, s ∈ (linkAll st).seals := by
  unfold linkAll
  refine foldl_inv (fun acc : State => acc.published = st.published ∧ ∀ s ∈ st.seals, s ∈ acc.seals) _
    (fun acc en h => ?_) _ _ ⟨rfl, fun s hs => hs⟩
  dsimp only
  have hstep : ∀ (a : State) (x : Seal), (addSeal a x).published = a.published ∧
      ∀ s ∈ a.seals, s ∈ (addSeal a x).seals := fun a x =>
    ⟨by unfold addSeal; split <;> rfl, fun s hs => mem_addSeal_of_mem hs⟩
  refine foldl_inv (fun acc : State => acc.published = st.published ∧ ∀ s ∈ st.seals, s ∈ acc.seals) _
    (fun acc w h => ?_) _ _ ⟨(hstep _ _).1.trans h.1, fun s hs => (hstep _ _).2 s (h.2 s hs)⟩
  have h₁ := hstep acc ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩
  split
  · exact ⟨h₁.1.trans h.1, fun s hs => h₁.2 s (h.2 s hs)⟩
  · exact ⟨(hstep _ _).1.trans (h₁.1.trans h.1), fun s hs => (hstep _ _).2 s (h₁.2 s (h.2 s hs))⟩

/-- One family's turn keeps everything but the seals and what is published. -/
theorem sealsOnly_sealOne (acc : State) (k : KeyFam) : SealsOnly acc (sealOne acc k) := by
  have h := (foldl_addSeal acc k).1
  unfold sealOne
  dsimp only
  split
  · exact h.trans (sealsOnly_publish _ _)
  · exact h

/-- One family's turn adds only seals of its current key to one of its targets. -/
theorem sealOne_seals {acc : State} {k : KeyFam} {s : Seal} (hs : s ∈ (sealOne acc k).seals) :
    s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩ := by
  obtain ⟨-, hseals, -⟩ := foldl_addSeal acc k
  unfold sealOne at hs
  dsimp only at hs
  split at hs
  · unfold publish at hs
    split at hs <;> exact hseals s hs
  · exact hseals s hs

/-- One family's turn seals its current key to each of its targets. -/
theorem sealOne_sealed (acc : State) (k : KeyFam) {t : KeyName} (ht : t ∈ targets acc k) :
    ⟨acc.curKey k, t⟩ ∈ (sealOne acc k).seals := by
  obtain ⟨-, -, hall⟩ := foldl_addSeal acc k
  unfold sealOne
  dsimp only
  split
  · unfold publish
    split <;> exact hall t ht
  · exact hall t ht

/-- One family's turn publishes only its current key, and only if the family is public. -/
theorem sealOne_published {acc : State} {k : KeyFam} {x : KeyName} (hx : x ∈ (sealOne acc k).published) :
    x ∈ acc.published ∨ (publicKey acc k = true ∧ x = acc.curKey k) := by
  obtain ⟨hso, -, -⟩ := foldl_addSeal acc k
  have hk := hso.keysOnly.kept
  have hpub : ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).published = acc.published :=
    foldl_same State.published _ (fun a t => by unfold addSeal; split <;> rfl) _ _
  unfold sealOne at hx
  dsimp only at hx
  split at hx
  · rename_i hkp
    unfold publish at hx
    split at hx
    · exact .inl (hpub ▸ hx)
    · rcases List.mem_append.1 hx with hx | hx
      · exact .inl (hpub ▸ hx)
      · rw [List.mem_singleton] at hx
        rw [hk.publicKey] at hkp
        exact .inr ⟨hkp, by rw [hx, curKey_congr hso.epochs]⟩
  · exact .inl (hpub ▸ hx)

/-- What is published stays published. -/
theorem sealOne_published_mono {acc : State} {k : KeyFam} {x : KeyName} (hx : x ∈ acc.published) :
    x ∈ (sealOne acc k).published := by
  have hpub : ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).published = acc.published :=
    foldl_same State.published _ (fun a t => by unfold addSeal; split <;> rfl) _ _
  unfold sealOne
  dsimp only
  split
  · unfold publish
    split
    · exact hpub ▸ hx
    · exact List.mem_append_left _ (hpub ▸ hx)
  · exact hpub ▸ hx

/-- A public family's turn publishes its current key. -/
theorem sealOne_publishes {acc : State} {k : KeyFam} (hk : publicKey acc k = true) :
    acc.curKey k ∈ (sealOne acc k).published := by
  obtain ⟨hso, -, -⟩ := foldl_addSeal acc k
  have hkept := hso.keysOnly.kept
  unfold sealOne
  dsimp only
  split
  · rw [← curKey_congr hso.epochs]
    unfold publish
    split
    · rename_i h
      exact List.contains_iff_mem.1 h
    · exact List.mem_append_right _ (List.mem_singleton_self _)
  · rename_i hn
    exact absurd (by rw [hkept.publicKey]; exact hk) hn

/-- The turns of the families `l`, after one another: they add seals of a current key to one of its targets, and
    publish the current keys of public families. -/
theorem foldl_sealOne_spec (st : State) (l : List KeyFam) :
    SealsOnly st (l.foldl sealOne st) ∧
    (∀ s ∈ (l.foldl sealOne st).seals, s ∈ st.seals ∨ ∃ k ∈ l, ∃ t ∈ targets st k, s = ⟨st.curKey k, t⟩) ∧
    (∀ x ∈ (l.foldl sealOne st).published, x ∈ st.published ∨ ∃ k ∈ l, publicKey st k = true ∧ x = st.curKey k) := by
  refine foldl_inv_mem (fun acc : State => SealsOnly st acc ∧
      (∀ s ∈ acc.seals, s ∈ st.seals ∨ ∃ k ∈ l, ∃ t ∈ targets st k, s = ⟨st.curKey k, t⟩) ∧
      (∀ x ∈ acc.published, x ∈ st.published ∨ ∃ k ∈ l, publicKey st k = true ∧ x = st.curKey k))
    _ _ ?_ st ⟨.refl _, fun s hs => .inl hs, fun x hx => .inl hx⟩
  intro acc k hk ⟨hso, hseals, hpub⟩
  have hkept := hso.keysOnly.kept
  refine ⟨hso.trans (sealsOnly_sealOne acc k), fun s hs => ?_, fun x hx => ?_⟩
  · rcases sealOne_seals hs with hs | ⟨t, ht, rfl⟩
    · exact hseals s hs
    · rw [targets_congr hkept.vaults hkept.caps hkept.revoked hso.epochs] at ht
      exact .inr ⟨k, hk, t, ht, by rw [curKey_congr hso.epochs]⟩
  · rcases sealOne_published hx with hx | ⟨hkp, rfl⟩
    · exact hpub x hx
    · rw [hkept.publicKey] at hkp
      exact .inr ⟨k, hk, hkp, by rw [curKey_congr hso.epochs]⟩

/-- A family's turn keeps every seal. -/
theorem sealOne_seals_mono {acc : State} {k : KeyFam} {s : Seal} (hs : s ∈ acc.seals) : s ∈ (sealOne acc k).seals := by
  have hs' : s ∈ ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).seals :=
    foldl_inv (fun b : State => s ∈ b.seals) _ (fun b _ h => mem_addSeal_of_mem h) _ _ hs
  unfold sealOne
  dsimp only
  split
  · unfold publish
    split <;> exact hs'
  · exact hs'

/-- The turns of the families `l` seal the current key of each to each of its targets, and publish the current key
    of each public one. -/
theorem foldl_sealOne_all (st : State) {k : KeyFam} :
    ∀ (l : List KeyFam) (acc : State), SealsOnly st acc → k ∈ l →
      (∀ t ∈ targets st k, ⟨st.curKey k, t⟩ ∈ (l.foldl sealOne acc).seals) ∧
      (publicKey st k = true → st.curKey k ∈ (l.foldl sealOne acc).published)
  | [], _, _, h => by cases h
  | k' :: l, acc, hso, hmem => by
    rw [List.foldl_cons]
    have hkept := hso.keysOnly.kept
    rcases List.mem_cons.1 hmem with rfl | hmem
    · refine ⟨fun t ht => ?_, fun hpub => ?_⟩
      · refine foldl_inv (fun a : State => ⟨st.curKey k, t⟩ ∈ a.seals) _ (fun a _ h => sealOne_seals_mono h) l _ ?_
        rw [← curKey_congr hso.epochs]
        exact sealOne_sealed acc k (by rw [targets_congr hkept.vaults hkept.caps hkept.revoked hso.epochs]; exact ht)
      · refine foldl_inv (fun a : State => st.curKey k ∈ a.published) _ (fun a _ h => sealOne_published_mono h) l _
          ?_
        rw [← curKey_congr hso.epochs]
        exact sealOne_publishes (by rw [hkept.publicKey]; exact hpub)
    · exact foldl_sealOne_all st l _ (hso.trans (sealsOnly_sealOne acc k')) hmem

/-- The seals `linkAll` adds: each entry's current key under its cell's current key, each write's key under its stay's
    cell key of its generation, and the key of a write from an earlier stay under its entry's current key. -/
def LinkSeal (st : State) (s : Seal) : Prop :=
  ∃ en ∈ st.entries, s = ⟨entryKey st en, st.curKey (.cell en.vault en.cell)⟩ ∨
    ∃ w ∈ st.writes, w.entry = en.id ∧
      (s = ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩ ∨
        (w.stay ≠ en.stay ∧ s = ⟨w.key, entryKey st en⟩))

/-- An entry key reads only the epochs. -/
theorem entryKey_congr {st st' : State} (he : st'.epochs = st.epochs) (en : Entry) :
    entryKey st' en = entryKey st en := by
  simp only [entryKey, State.epochOf, he]

/-- Linking adds only the derivations and links of the entry keys. -/
theorem linkAll_seals {st : State} {s : Seal} (hs : s ∈ (linkAll st).seals) : s ∈ st.seals ∨ LinkSeal st s := by
  unfold linkAll at hs
  refine (foldl_inv_mem (fun acc : State => SealsOnly st acc ∧ ∀ s ∈ acc.seals, s ∈ st.seals ∨ LinkSeal st s) _ _
    ?_ st ⟨.refl _, fun s hs => .inl hs⟩).2 s hs
  intro acc en hen ⟨hso, hseals⟩
  dsimp only
  have h₀ : SealsOnly st (addSeal acc ⟨entryKey acc en, acc.curKey (.cell en.vault en.cell)⟩) ∧
      ∀ s ∈ (addSeal acc ⟨entryKey acc en, acc.curKey (.cell en.vault en.cell)⟩).seals,
        s ∈ st.seals ∨ LinkSeal st s := by
    refine ⟨hso.trans (sealsOnly_addSeal _ _), fun s hs => ?_⟩
    rcases mem_addSeal hs with hs | rfl
    · exact hseals s hs
    · exact .inr ⟨en, hen, .inl (by rw [entryKey_congr hso.epochs, curKey_congr hso.epochs])⟩
  refine foldl_inv_mem (fun acc : State => SealsOnly st acc ∧ ∀ s ∈ acc.seals, s ∈ st.seals ∨ LinkSeal st s) _ _
    ?_ _ h₀
  intro acc w hw ⟨hso, hseals⟩
  obtain ⟨hw, hwe⟩ := List.mem_filter.1 hw
  have hwe' : w.entry = en.id := by simpa using hwe
  have h₁ : SealsOnly st (addSeal acc ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩) ∧
      ∀ s ∈ (addSeal acc ⟨w.key, .scoped (.cell en.vault ((en.stayCell w.stay).getD [])) w.gen⟩).seals,
        s ∈ st.seals ∨ LinkSeal st s := by
    refine ⟨hso.trans (sealsOnly_addSeal _ _), fun s hs => ?_⟩
    rcases mem_addSeal hs with hs | rfl
    · exact hseals s hs
    · exact .inr ⟨en, hen, .inr ⟨w, hw, hwe', .inl rfl⟩⟩
  split
  · exact h₁
  · rename_i hne
    refine ⟨h₁.1.trans (sealsOnly_addSeal _ _), fun s hs => ?_⟩
    rcases mem_addSeal hs with hs | rfl
    · exact h₁.2 s hs
    · refine .inr ⟨en, hen, .inr ⟨w, hw, hwe', .inr ⟨fun h => hne (by simp [h]), ?_⟩⟩⟩
      rw [entryKey_congr h₁.1.epochs]

/-! ### Rotating -/

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

/-- Rotating the families `l` raises each family's epoch by how often `l` names it. -/
theorem epochOf_foldl_bump (k : KeyFam) : ∀ (l : List KeyFam) (st : State),
    (l.foldl bump st).epochOf k = st.epochOf k + l.count k
  | [], _ => by simp
  | k' :: l, st => by
    rw [List.foldl_cons, epochOf_foldl_bump k l, epochOf_bump, List.count_cons]
    by_cases hk : k' = k <;> simp [hk] <;> omega

/-- Rotating changes only the epochs and the seals. -/
theorem keysOnly_foldl_bump : ∀ (l : List KeyFam) (st : State), KeysOnly st (l.foldl bump st)
  | [], st => ⟨st.epochs, st.seals, st.published, rfl⟩
  | k :: l, st => by
    rw [List.foldl_cons]
    exact KeysOnly.trans ⟨_, _, st.published, rfl⟩ (keysOnly_foldl_bump l (bump st k))

/-- Rotating publishes nothing. -/
theorem foldl_bump_published (l : List KeyFam) (st : State) : (l.foldl bump st).published = st.published :=
  foldl_same State.published bump (fun _ _ => rfl) l st

/-- Rotating adds only seals of one epoch of a rotated family to the next. -/
theorem foldl_bump_seals : ∀ (l : List KeyFam) (st : State) {s : Seal}, s ∈ (l.foldl bump st).seals →
    s ∈ st.seals ∨ ∃ k ∈ l, ∃ e, st.epochOf k ≤ e ∧ e < (l.foldl bump st).epochOf k ∧
      s = ⟨.scoped k e, .scoped k (e + 1)⟩
  | [], _, _, hs => .inl hs
  | k' :: l, st, s, hs => by
    rw [List.foldl_cons] at hs ⊢
    rcases foldl_bump_seals l (bump st k') hs with hs | ⟨k, hk, e, he1, he2, rfl⟩
    · simp only [bump, List.mem_append, List.mem_singleton] at hs
      rcases hs with hs | rfl
      · exact .inl hs
      · refine .inr ⟨k', List.mem_cons_self, st.epochOf k', Nat.le_refl _, ?_, rfl⟩
        rw [epochOf_foldl_bump, epochOf_bump]
        simp
        omega
    · refine .inr ⟨k, List.mem_cons_of_mem _ hk, e, ?_, he2, rfl⟩
      rw [epochOf_bump] at he1
      omega

/-! ### Settling -/

/-- Settling changes only the epochs, the seals and what is published. -/
theorem keysOnly_settle (pre post : State) : KeysOnly post (settle pre post) := by
  unfold settle
  rw [sealAll_eq]
  exact (keysOnly_foldl_bump _ _).trans
    ((foldl_sealOne_spec _ _).1.trans (sealsOnly_linkAll _)).keysOnly

/-- Settling keeps whatever the key rules read but the epochs. -/
theorem kept_settle (pre post : State) : Kept post (settle pre post) := (keysOnly_settle pre post).kept

/-- Settling raises the epoch of each stale family, by how often it is stale. -/
theorem epochOf_settle (pre post : State) (k : KeyFam) :
    (settle pre post).epochOf k = post.epochOf k + (staleKeys pre post).count k := by
  unfold settle
  rw [sealAll_eq, ← epochOf_foldl_bump]
  have h := ((foldl_sealOne_spec ((staleKeys pre post).foldl bump post)
    (keyFams ((staleKeys pre post).foldl bump post))).1.trans (sealsOnly_linkAll _)).epochs
  simp only [State.epochOf, h]

/-- The seals after settling: the ones before, the seal of each old epoch of a rotated family to the next, seals of
    current keys to their targets, and the derivations and links of the entry keys. -/
theorem settle_seals {pre post : State} {s : Seal} (hs : s ∈ (settle pre post).seals) :
    s ∈ post.seals ∨
    (∃ k e, k ∈ staleKeys pre post ∧ post.epochOf k ≤ e ∧ e < (settle pre post).epochOf k ∧
      s = ⟨.scoped k e, .scoped k (e + 1)⟩) ∨
    (∃ k ∈ keyFams post, ∃ t ∈ targets (settle pre post) k, s = ⟨(settle pre post).curKey k, t⟩) ∨
    LinkSeal (settle pre post) s := by
  have hmid := (keysOnly_foldl_bump (staleKeys pre post) post).kept
  obtain ⟨hso, hseals, -⟩ := foldl_sealOne_spec ((staleKeys pre post).foldl bump post)
    (keyFams ((staleKeys pre post).foldl bump post))
  have hlink := sealsOnly_linkAll ((keyFams ((staleKeys pre post).foldl bump post)).foldl sealOne
    ((staleKeys pre post).foldl bump post))
  have hall := hso.trans hlink
  have hk := hall.keysOnly.kept
  unfold settle at hs ⊢
  rw [sealAll_eq] at hs ⊢
  rcases linkAll_seals hs with hs | hs
  · rcases hseals s hs with hs | ⟨k, hk', t, ht, rfl⟩
    · rcases foldl_bump_seals _ _ hs with hs | ⟨k, hk, e, he1, he2, rfl⟩
      · exact .inl hs
      · refine .inr (.inl ⟨k, e, hk, he1, ?_, rfl⟩)
        simp only [State.epochOf, hall.epochs] at he2 ⊢
        exact he2
    · refine .inr (.inr (.inl ⟨k, ?_, t, ?_, ?_⟩))
      · rw [← hmid.keyFams]; exact hk'
      · rw [targets_congr hk.vaults hk.caps hk.revoked hall.epochs]; exact ht
      · rw [curKey_congr hall.epochs]
  · refine .inr (.inr (.inr ?_))
    obtain ⟨en, hen, h⟩ := hs
    refine ⟨en, by rw [hlink.keysOnly.kept.entries]; exact hen, ?_⟩
    rw [entryKey_congr hlink.epochs, curKey_congr hlink.epochs, hlink.keysOnly.kept.writes]
    exact h

/-- What is published after settling: what was before, and the current keys of public families. -/
theorem settle_published {pre post : State} {x : KeyName} (hx : x ∈ (settle pre post).published) :
    x ∈ post.published ∨ ∃ k ∈ keyFams post, publicKey post k = true ∧ x = (settle pre post).curKey k := by
  have hmid := (keysOnly_foldl_bump (staleKeys pre post) post).kept
  obtain ⟨hso, -, hpub⟩ := foldl_sealOne_spec ((staleKeys pre post).foldl bump post)
    (keyFams ((staleKeys pre post).foldl bump post))
  have hlink := sealsOnly_linkAll ((keyFams ((staleKeys pre post).foldl bump post)).foldl sealOne
    ((staleKeys pre post).foldl bump post))
  have hall := hso.trans hlink
  have hlp := (linkAll_mono ((keyFams ((staleKeys pre post).foldl bump post)).foldl sealOne
    ((staleKeys pre post).foldl bump post))).1
  unfold settle at hx ⊢
  rw [sealAll_eq] at hx ⊢
  rw [hlp] at hx
  rcases hpub x hx with hx | ⟨k, hk, hkp, rfl⟩
  · exact .inl (foldl_bump_published _ _ ▸ hx)
  · refine .inr ⟨k, by rw [← hmid.keyFams]; exact hk, by rw [← hmid.publicKey]; exact hkp, ?_⟩
    rw [curKey_congr hall.epochs]

/-- Settling seals the current key of every family to each of its targets, and publishes it if it is public. -/
theorem settle_sealed {pre post : State} {k : KeyFam} (hk : k ∈ keyFams post) :
    (∀ t ∈ targets (settle pre post) k, ⟨(settle pre post).curKey k, t⟩ ∈ (settle pre post).seals) ∧
    (publicKey post k = true → (settle pre post).curKey k ∈ (settle pre post).published) := by
  have hmid := (keysOnly_foldl_bump (staleKeys pre post) post).kept
  obtain ⟨hso, -, -⟩ := foldl_sealOne_spec ((staleKeys pre post).foldl bump post)
    (keyFams ((staleKeys pre post).foldl bump post))
  have hlink := sealsOnly_linkAll ((keyFams ((staleKeys pre post).foldl bump post)).foldl sealOne
    ((staleKeys pre post).foldl bump post))
  have hmono := linkAll_mono ((keyFams ((staleKeys pre post).foldl bump post)).foldl sealOne
    ((staleKeys pre post).foldl bump post))
  have hall := hso.trans hlink
  have hk' := hall.keysOnly.kept
  have hkm : k ∈ keyFams ((staleKeys pre post).foldl bump post) := by rw [hmid.keyFams]; exact hk
  obtain ⟨hts, hps⟩ := foldl_sealOne_all ((staleKeys pre post).foldl bump post)
    (keyFams ((staleKeys pre post).foldl bump post)) ((staleKeys pre post).foldl bump post) (.refl _) hkm
  unfold settle
  rw [sealAll_eq]
  refine ⟨fun t ht => ?_, fun hpub => ?_⟩
  · rw [targets_congr hk'.vaults hk'.caps hk'.revoked hall.epochs] at ht
    rw [curKey_congr hall.epochs]
    exact hmono.2 _ (hts t ht)
  · rw [hmono.1, curKey_congr hall.epochs]
    exact hps (by rw [hmid.publicKey]; exact hpub)

/-! ### A step -/

/-- An accepted step checks the edit, then settles the keys. -/
theorem step_cases {st st' : State} {edit : Edit} (h : step st edit = some st') :
    ∃ post, apply st edit = some post ∧ st' = settle st post := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  exact ⟨post, hpost, rfl⟩

/-- An accepted edit leaves the key schedule alone: the epochs, the seals and what is published. -/
theorem apply_keys {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.epochs = st.epochs ∧ post.seals = st.seals ∧ post.published = st.published := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try exact ⟨rfl, rfl, rfl⟩)

/-- A step raises the epoch of each stale family, by how often it is stale. -/
theorem epochOf_step {pre post : State} {edit : Edit} (hpost : apply pre edit = some post) (k : KeyFam) :
    (settle pre post).epochOf k = pre.epochOf k + (staleKeys pre post).count k := by
  rw [epochOf_settle]
  simp only [State.epochOf, (apply_keys hpost).1]

/-- A family that isn't stale keeps its current key. -/
theorem curKey_step {pre post : State} {edit : Edit} (hpost : apply pre edit = some post) {k : KeyFam}
    (hS : k ∉ staleKeys pre post) : (settle pre post).curKey k = pre.curKey k := by
  simp only [State.curKey, epochOf_step hpost, List.count_eq_zero.2 hS, Nat.add_zero]

/-- A stale family moves to a later epoch. -/
theorem epochOf_step_lt {pre post : State} {edit : Edit} (hpost : apply pre edit = some post) {k : KeyFam}
    (hS : k ∈ staleKeys pre post) : pre.epochOf k < (settle pre post).epochOf k := by
  rw [epochOf_step hpost]
  have := List.count_pos_iff.2 hS
  omega

/-- A step never lowers an epoch. -/
theorem epochOf_le_step {pre post : State} {edit : Edit} (hpost : apply pre edit = some post) (k : KeyFam) :
    pre.epochOf k ≤ (settle pre post).epochOf k := by
  rw [epochOf_step hpost]
  exact Nat.le_add_right _ _

/-! ## `opens` finds what `Knows` gives

Each round of `openRound` that changes the list opens the secret of some seal not open before, so after one round
per seal nothing new opens: the list is closed under the seals. -/

/-- Whatever is sealed to a key in `known` is in `known`. -/
def SealClosed (st : State) (known : List KeyName) : Prop := ∀ s ∈ st.seals, s.to ∈ known → s.secret ∈ known

/-- A list that holds the start and what is published, and is closed under the seals, holds every key `Knows`
    gives. -/
theorem knows_mem {st : State} {start known : List KeyName} (hs : ∀ x ∈ start, x ∈ known)
    (hp : ∀ x ∈ st.published, x ∈ known) (hc : SealClosed st known) {x : KeyName} (h : Knows st start x) :
    x ∈ known := by
  induction h with
  | own hx => exact hs _ hx
  | published hx => exact hp _ hx
  | «unseal» hs' _ ih => exact hc _ hs' ih

/-- One step of `openRound`. -/
def openStep (acc : List KeyName) (s : Seal) : List KeyName :=
  if acc.contains s.to && !acc.contains s.secret then acc ++ [s.secret] else acc

/-- A round takes one step per seal. -/
theorem openRound_eq (st : State) (known : List KeyName) :
    openRound st known = st.seals.foldl openStep known := rfl

/-- A step keeps every key open. -/
theorem openStep_mono {acc : List KeyName} {s : Seal} {x : KeyName} (hx : x ∈ acc) : x ∈ openStep acc s := by
  unfold openStep
  split
  · exact List.mem_append_left _ hx
  · exact hx

/-- A round adds to the list only secrets of seals that it didn't hold. -/
theorem openRound_spec (st : State) (known : List KeyName) :
    ∃ added, openRound st known = known ++ added ∧
      ∀ x ∈ added, x ∉ known ∧ ∃ s ∈ st.seals, x = s.secret := by
  rw [openRound_eq]
  refine foldl_inv_mem (fun acc => ∃ added, acc = known ++ added ∧ ∀ x ∈ added, x ∉ known ∧
    ∃ s ∈ st.seals, x = s.secret) _ _ ?_ known ⟨[], by simp, by simp⟩
  intro acc s hs ⟨added, hacc, hadded⟩
  unfold openStep
  split
  · rename_i hc
    simp only [Bool.and_eq_true, Bool.not_eq_true', List.contains_eq_mem, decide_eq_true_eq,
      decide_eq_false_iff_not] at hc
    refine ⟨added ++ [s.secret], by rw [hacc, List.append_assoc], fun x hx => ?_⟩
    rcases List.mem_append.1 hx with hx | hx
    · exact hadded x hx
    · rw [List.mem_singleton] at hx
      subst hx
      exact ⟨fun h => hc.2 (hacc ▸ List.mem_append_left _ h), s, hs, rfl⟩
  · exact ⟨added, hacc, hadded⟩

/-- A round opens the secret of every seal to a key the list held. -/
theorem openRound_opens {st : State} {known : List KeyName} {s : Seal} (hs : s ∈ st.seals)
    (hto : s.to ∈ known) : s.secret ∈ openRound st known := by
  rw [openRound_eq]
  suffices h : ∀ (l : List Seal) (acc : List KeyName), (∀ x ∈ known, x ∈ acc) → s ∈ l →
      s.secret ∈ l.foldl openStep acc from h _ _ (fun _ h => h) hs
  intro l
  induction l with
  | nil => intro _ _ h; cases h
  | cons s' l ih =>
    intro acc hacc hmem
    rw [List.foldl_cons]
    rcases List.mem_cons.1 hmem with rfl | hmem
    · refine foldl_inv (fun a => s.secret ∈ a) _ (fun _ _ h => openStep_mono h) l _ ?_
      unfold openStep
      by_cases hin : s.secret ∈ acc
      · split
        · exact List.mem_append_left _ hin
        · exact hin
      · have hc : (acc.contains s.to && !acc.contains s.secret) = true := by simp [hacc _ hto, hin]
        simp only [hc, ↓reduceIte]
        exact List.mem_append_right _ (List.mem_singleton_self _)
    · exact ih _ (fun x hx => openStep_mono (hacc x hx)) hmem

/-- The seals whose secret `known` doesn't hold yet. -/
def unopened (st : State) (known : List KeyName) : Nat :=
  (st.seals.filter fun s => !known.contains s.secret).length

/-- A round that changes the list opens the secret of one more seal. -/
theorem unopened_lt {st : State} {known : List KeyName} (h : (openRound st known).length ≠ known.length) :
    unopened st (openRound st known) < unopened st known := by
  obtain ⟨added, hnext, hadded⟩ := openRound_spec st known
  obtain ⟨x, hx⟩ : ∃ x, x ∈ added := by
    cases added with
    | nil => simp [hnext] at h
    | cons x _ => exact ⟨x, List.mem_cons_self⟩
  obtain ⟨hxk, s, hs, rfl⟩ := hadded _ hx
  unfold unopened
  -- the seals still unopened after the round are among those unopened before it
  have hsub : (st.seals.filter fun s => !(openRound st known).contains s.secret) =
      (st.seals.filter fun s => !known.contains s.secret).filter
        fun s => !(openRound st known).contains s.secret := by
    rw [List.filter_filter]
    congr 1
    funext y
    by_cases hy : y.secret ∈ openRound st known
    · simp [hy]
    · have : y.secret ∉ known := fun h => hy (hnext ▸ List.mem_append_left _ h)
      simp [hy, this]
  rw [hsub, List.length_filter_lt_length_iff_exists]
  refine ⟨s, List.mem_filter.2 ⟨hs, by simpa using hxk⟩, ?_⟩
  simp [hnext, hx]

/-- With more rounds than unopened seals, `openAll` ends closed under the seals. -/
theorem openAll_closed (st : State) : ∀ (n : Nat) (known : List KeyName), unopened st known < n →
    SealClosed st (openAll st n known) ∧ ∀ x ∈ known, x ∈ openAll st n known
  | 0, _, h => absurd h (Nat.not_lt_zero _)
  | n + 1, known, h => by
    unfold openAll
    dsimp only
    split
    · rename_i heq
      refine ⟨fun s hs hto => ?_, fun x hx => hx⟩
      obtain ⟨added, hnext, -⟩ := openRound_spec st known
      have hlen : added = [] := by
        rw [beq_iff_eq, hnext, List.length_append] at heq
        exact List.eq_nil_of_length_eq_zero (by omega)
      have := openRound_opens hs hto
      rwa [hnext, hlen, List.append_nil] at this
    · rename_i hne
      have hlt := unopened_lt (st := st) (known := known) (by simpa using hne)
      obtain ⟨hc, hsub⟩ := openAll_closed st n (openRound st known) (by omega)
      obtain ⟨added, hnext, -⟩ := openRound_spec st known
      exact ⟨hc, fun x hx => hsub x (by rw [hnext]; exact List.mem_append_left _ hx)⟩

/-- `opens` finds every key `Knows` gives. -/
theorem opens_complete {st : State} {start : List KeyName} {x : KeyName} (h : Knows st start x) :
    (opens st start).contains x = true := by
  obtain ⟨hc, hsub⟩ := openAll_closed st (st.seals.length + 1) (start ++ st.published)
    (Nat.lt_succ_of_le (List.length_filter_le _ _))
  exact List.contains_iff_mem.2 (knows_mem (fun y hy => hsub y (List.mem_append_left _ hy))
    (fun y hy => hsub y (List.mem_append_right _ hy)) hc h)

/-! ## Chains of owners

`actsFor` and `owns` follow chains of owners no longer than there are vaults. A chain that passes a vault twice can
be cut short, so that bound finds every chain. -/

/-- Vault `o` is listed as an owner of vault `v`. -/
def OwnerOf (st : State) (o v : VaultId) : Prop := ∃ vt, st.vault? v = some vt ∧ Principal.vault o ∈ vt.owners

/-- A chain from `v` up through owners to a vault where `B` holds, listing the vaults it passes, `v` first. -/
inductive Chain (st : State) (B : VaultId → Prop) : VaultId → List VaultId → Prop where
  | base {v : VaultId} : B v → Chain st B v [v]
  | up {v o : VaultId} {ys : List VaultId} : OwnerOf st o v → Chain st B o ys → Chain st B v (v :: ys)

/-- From any vault it passes, a chain goes on as a chain. -/
theorem Chain.suffix {st : State} {B : VaultId → Prop} {v : VaultId} {ys : List VaultId} (h : Chain st B v ys)
    {y : VaultId} (hy : y ∈ ys) : ∃ zs, Chain st B y zs ∧ zs <:+ ys := by
  induction h with
  | base hb =>
    rw [List.mem_singleton] at hy
    subst hy
    exact ⟨_, .base hb, List.suffix_refl _⟩
  | @up v o ys hov hc ih =>
    rcases List.mem_cons.1 hy with rfl | hy
    · exact ⟨_, .up hov hc, List.suffix_refl _⟩
    · obtain ⟨zs, hzs, hsuf⟩ := ih hy
      exact ⟨zs, hzs, hsuf.trans (List.suffix_cons _ _)⟩

/-- Every chain can be cut short to one that passes no vault twice. -/
theorem Chain.nodup {st : State} {B : VaultId → Prop} {v : VaultId} {ys : List VaultId} (h : Chain st B v ys) :
    ∃ zs, Chain st B v zs ∧ zs.Nodup ∧ ∀ z ∈ zs, z ∈ ys := by
  induction h with
  | base hb => exact ⟨_, .base hb, List.nodup_cons.2 ⟨by simp, List.nodup_nil⟩, fun z hz => hz⟩
  | @up v o ys hov _ ih =>
    obtain ⟨zs, hzs, hnd, hsub⟩ := ih
    by_cases hv : v ∈ zs
    · obtain ⟨ws, hws, hsuf⟩ := hzs.suffix hv
      exact ⟨ws, hws, hsuf.sublist.nodup hnd, fun z hz => List.mem_cons_of_mem _ (hsub z (hsuf.subset hz))⟩
    · refine ⟨v :: zs, .up hov hzs, List.nodup_cons.2 ⟨hv, hnd⟩, fun z hz => ?_⟩
      rcases List.mem_cons.1 hz with rfl | hz
      · exact List.mem_cons_self
      · exact List.mem_cons_of_mem _ (hsub z hz)

/-- A vault with an owner exists. -/
theorem OwnerOf.mem {st : State} {o v : VaultId} (h : OwnerOf st o v) : v ∈ st.vaults.map (·.id) := by
  obtain ⟨vt, hv, -⟩ := h
  exact List.mem_map.2 ⟨vt, vault?_mem hv, vault?_id hv⟩

/-- A chain whose ends exist passes only vaults that exist. -/
theorem Chain.mem {st : State} {B : VaultId → Prop} (hB : ∀ v, B v → v ∈ st.vaults.map (·.id)) {v : VaultId}
    {ys : List VaultId} (h : Chain st B v ys) : ∀ z ∈ ys, z ∈ st.vaults.map (·.id) := by
  induction h with
  | base hb => intro z hz; rw [List.mem_singleton.1 hz]; exact hB _ hb
  | up hov _ ih =>
    intro z hz
    rcases List.mem_cons.1 hz with rfl | hz
    · exact hov.mem
    · exact ih z hz

/-- A chain whose ends exist can be cut to one no longer than the number of vaults. -/
theorem Chain.short {st : State} {B : VaultId → Prop} (hB : ∀ v, B v → v ∈ st.vaults.map (·.id)) {v : VaultId}
    {ys : List VaultId} (h : Chain st B v ys) : ∃ zs, Chain st B v zs ∧ zs.length ≤ st.vaults.length := by
  obtain ⟨zs, hzs, hnd, -⟩ := h.nodup
  refine ⟨zs, hzs, ?_⟩
  have := hnd.length_le_of_subset (hzs.mem hB)
  simpa using this

/-- A chain to `a`, after a chain of owners from `a` down to `x`, is a chain to `x`. -/
theorem Chain.trans {st : State} {B : VaultId → Prop} {a : VaultId} {ys : List VaultId} (h₁ : Chain st B a ys) :
    ∀ {x : VaultId} {zs : List VaultId}, Chain st (OwnerOf st a) x zs → Chain st B x (zs ++ ys)
  | _, _, .base hax => .up hax h₁
  | _, _, .up hov h => .up hov (h₁.trans h)

/-- A chain ends where `B` holds. -/
theorem Chain.exists_base {st : State} {B : VaultId → Prop} {v : VaultId} {ys : List VaultId}
    (h : Chain st B v ys) : ∃ y, B y := by
  induction h with
  | base hb => exact ⟨_, hb⟩
  | up _ _ ih => exact ih

/-- Signer `s` is a member of vault `v`: one of its devices or owner signers. -/
def MemberOf (st : State) (s : SignerId) (v : VaultId) : Prop :=
  ∃ vt, st.vault? v = some vt ∧ (vt.devices.contains s || vt.owners.contains (.signer s)) = true

/-- Whatever `actsForN` finds is a chain to a vault the signer is a member of. -/
theorem chain_of_actsForN {st : State} {s : SignerId} :
    ∀ {n : Nat} {v : VaultId}, actsForN st s n v = true → ∃ ys, Chain st (MemberOf st s) v ys ∧ ys.length ≤ n
  | 0, _, h => by simp [actsForN] at h
  | n + 1, v, h => by
    simp only [actsForN] at h
    cases hv : st.vault? v with
    | none => rw [hv] at h; cases h
    | some vt =>
      rw [hv] at h
      dsimp only at h
      cases hm : (vt.devices.contains s || vt.owners.contains (.signer s)) with
      | true => exact ⟨_, .base ⟨vt, hv, hm⟩, by simp⟩
      | false =>
        rw [hm, Bool.false_or] at h
        obtain ⟨p, hp, hpo⟩ := List.any_eq_true.1 h
        cases p with
        | vault o =>
          obtain ⟨ys, hys, hlen⟩ := chain_of_actsForN hpo
          exact ⟨_, .up ⟨vt, hv, hp⟩ hys, by simp; omega⟩
        | signer _ => cases hpo

/-- A chain no longer than `n` is found by `actsForN` with fuel `n`. -/
theorem actsForN_of_chain {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : Chain st (MemberOf st s) v ys) : ∀ {n : Nat}, ys.length ≤ n → actsForN st s n v = true := by
  induction h with
  | base hb =>
    obtain ⟨vt, hv, hm⟩ := hb
    intro n hn
    match n, hn with
    | n + 1, _ => simp only [actsForN, hv, hm, Bool.true_or]
  | up hov _ ih =>
    obtain ⟨vt, hv, ho⟩ := hov
    intro n hn
    match n, hn with
    | n + 1, hn =>
      simp only [actsForN, hv]
      rw [List.any_eq_true.2 ⟨_, ho, ih (by simp at hn; omega)⟩, Bool.or_true]

/-- Whatever `ownsN` finds is a chain of owners. -/
theorem chain_of_ownsN {st : State} {a : VaultId} :
    ∀ {n : Nat} {x : VaultId}, ownsN st a n x = true → ∃ ys, Chain st (OwnerOf st a) x ys ∧ ys.length ≤ n
  | 0, _, h => by simp [ownsN] at h
  | n + 1, x, h => by
    simp only [ownsN] at h
    cases hx : st.vault? x with
    | none => rw [hx] at h; cases h
    | some vt =>
      rw [hx] at h
      obtain ⟨p, hp, hpo⟩ := List.any_eq_true.1 h
      cases p with
      | vault o =>
        simp only [Bool.or_eq_true, beq_iff_eq] at hpo
        rcases hpo with rfl | hpo
        · exact ⟨_, .base ⟨vt, hx, hp⟩, by simp⟩
        · obtain ⟨ys, hys, hlen⟩ := chain_of_ownsN hpo
          exact ⟨_, .up ⟨vt, hx, hp⟩ hys, by simp; omega⟩
      | signer _ => cases hpo

/-- A chain of owners no longer than `n` is found by `ownsN` with fuel `n`. -/
theorem ownsN_of_chain {st : State} {a x : VaultId} {ys : List VaultId} (h : Chain st (OwnerOf st a) x ys) :
    ∀ {n : Nat}, ys.length ≤ n → ownsN st a n x = true := by
  induction h with
  | base hb =>
    obtain ⟨vt, hx, ha⟩ := hb
    intro n hn
    match n, hn with
    | n + 1, _ =>
      simp only [ownsN, hx]
      exact List.any_eq_true.2 ⟨_, ha, by simp⟩
  | up hov _ ih =>
    obtain ⟨vt, hx, ho⟩ := hov
    intro n hn
    match n, hn with
    | n + 1, hn =>
      simp only [ownsN, hx]
      exact List.any_eq_true.2 ⟨_, ho, by simp [ih (by simp at hn; omega)]⟩

/-- A member's vault exists. -/
theorem MemberOf.mem {st : State} {s : SignerId} {v : VaultId} (h : MemberOf st s v) :
    v ∈ st.vaults.map (·.id) := by
  obtain ⟨vt, hv, -⟩ := h
  exact List.mem_map.2 ⟨vt, vault?_mem hv, vault?_id hv⟩

/-- Every chain to a vault the signer is a member of is found by `actsFor`. -/
theorem actsFor_of_chain {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : Chain st (MemberOf st s) v ys) : actsFor st s v = true := by
  obtain ⟨zs, hzs, hlen⟩ := h.short fun _ hb => hb.mem
  exact actsForN_of_chain hzs (by unfold State.depth; omega)

/-- Every chain of owners is found by `owns`. -/
theorem owns_of_chain {st : State} {a x : VaultId} {ys : List VaultId} (h : Chain st (OwnerOf st a) x ys) :
    owns st a x = true := by
  obtain ⟨zs, hzs, hlen⟩ := h.short fun _ hb => hb.mem
  exact ownsN_of_chain hzs (by unfold State.depth; omega)

/-- Acting for a vault is acting for every vault it owns. -/
theorem actsFor_owns {st : State} {s : SignerId} {a x : VaultId} (h : actsFor st s a = true)
    (hax : owns st a x = true) : actsFor st s x = true := by
  obtain ⟨ys, hys, -⟩ := chain_of_actsForN h
  obtain ⟨zs, hzs, -⟩ := chain_of_ownsN hax
  exact actsFor_of_chain (hys.trans hzs)

/-- Owning is transitive. -/
theorem owns_trans {st : State} {a b c : VaultId} (h₁ : owns st a b = true) (h₂ : owns st b c = true) :
    owns st a c = true := by
  obtain ⟨ys, hys, -⟩ := chain_of_ownsN h₁
  obtain ⟨zs, hzs, -⟩ := chain_of_ownsN h₂
  exact owns_of_chain (hys.trans hzs)

/-- A member of a vault acts for it. -/
theorem actsFor_member {st : State} {s : SignerId} {v : VaultId} {vt : Vault} (hv : st.vault? v = some vt)
    (hs : (vt.devices.contains s || vt.owners.contains (.signer s)) = true) : actsFor st s v = true :=
  actsFor_of_chain (.base ⟨vt, hv, hs⟩)

/-- A listed owner owns. -/
theorem owns_owner {st : State} {o v : VaultId} {vt : Vault} (hv : st.vault? v = some vt)
    (ho : Principal.vault o ∈ vt.owners) : owns st o v = true :=
  owns_of_chain (.base ⟨vt, hv, ho⟩)

/-- A vault some vault owns exists. -/
theorem owns_mem {st : State} {a x : VaultId} (h : owns st a x = true) : x ∈ st.vaults.map (·.id) := by
  obtain ⟨ys, hys, -⟩ := chain_of_ownsN h
  cases hys with
  | base hb => exact hb.mem
  | up hov _ => exact hov.mem

/-- A signer that acts for a vault is listed by some vault. -/
theorem actsFor_listed {st : State} {s : SignerId} {v : VaultId} (h : actsFor st s v = true) : s ∈ signers st := by
  obtain ⟨ys, hys, -⟩ := chain_of_actsForN h
  obtain ⟨y, vt, hy, hm⟩ := hys.exists_base
  unfold signers
  refine List.mem_flatMap.2 ⟨vt, vault?_mem hy, ?_⟩
  simp only [Bool.or_eq_true, List.contains_iff_mem] at hm
  rcases hm with hm | hm
  · exact List.mem_append_left _ hm
  · exact List.mem_append_right _ (List.mem_filterMap.2 ⟨_, hm, rfl⟩)

/-- A signer that acts for a vault acts for an existing one. -/
theorem actsFor_mem {st : State} {s : SignerId} {v : VaultId} (h : actsFor st s v = true) :
    v ∈ st.vaults.map (·.id) := by
  obtain ⟨ys, hys, -⟩ := chain_of_actsForN h
  cases hys with
  | base hb => exact hb.mem
  | up hov _ => exact hov.mem

/-! ## Who may open a family's current key -/

/-- The key families: each vault's seed, the key of each live cap with read or more, and each entry's cell. -/
theorem mem_keyFams {st : State} {k : KeyFam} :
    k ∈ keyFams st ↔ (∃ vt ∈ st.vaults, k = .seed vt.id) ∨
      (∃ cp ∈ st.caps, st.live cp.id = true ∧ cp.role.allows .read = true ∧ k = .cap cp.over cp.id) ∨
      ∃ en ∈ st.entries, k = .cell en.vault en.cell := by
  unfold keyFams
  simp only [List.mem_append, List.mem_map, List.mem_filter, List.mem_eraseDups, Bool.and_eq_true]
  constructor
  · rintro ((⟨vt, hvt, rfl⟩ | ⟨cp, ⟨hcp, hl, hr⟩, rfl⟩) | ⟨en, hen, rfl⟩)
    · exact .inl ⟨vt, hvt, rfl⟩
    · exact .inr (.inl ⟨cp, hcp, hl, hr, rfl⟩)
    · exact .inr (.inr ⟨en, hen, rfl⟩)
  · rintro (⟨vt, hvt, rfl⟩ | ⟨cp, hcp, hl, hr, rfl⟩ | ⟨en, hen, rfl⟩)
    · exact .inl (.inl ⟨vt, hvt, rfl⟩)
    · exact .inl (.inr ⟨cp, ⟨hcp, hl, hr⟩, rfl⟩)
    · exact .inr ⟨en, hen, rfl⟩

/-- A vault's seed is a family exactly when the vault exists. -/
theorem seed_mem_keyFams {st : State} {v : VaultId} (h : (st.vault? v).isSome = true) : .seed v ∈ keyFams st := by
  obtain ⟨vt, hvt⟩ := Option.isSome_iff_exists.1 h
  exact mem_keyFams.2 (.inl ⟨vt, vault?_mem hvt, by rw [vault?_id hvt]⟩)

/-- The seed of a family that exists is of a vault that exists. -/
theorem seed_mem_keyFams_iff {st : State} {v : VaultId} (h : KeyFam.seed v ∈ keyFams st) :
    (st.vault? v).isSome = true := by
  rcases mem_keyFams.1 h with ⟨vt, hvt, hv⟩ | ⟨_, _, _, _, h⟩ | ⟨_, _, h⟩
  · cases hv
    exact vault?_isSome hvt
  · cases h
  · cases h

/-- A cap family is of a live cap with read or more, over its vault: with distinct ids, the one `cap?` finds. -/
theorem cap_mem_keyFams {st : State} (hn : (st.caps.map (·.id)).Nodup) {v : VaultId} {c : CapId}
    (h : KeyFam.cap v c ∈ keyFams st) :
    ∃ cp, st.cap? c = some cp ∧ cp ∈ st.caps ∧ cp.over = v ∧ cp.id = c ∧ st.live c = true ∧
      cp.role.allows .read = true := by
  rcases mem_keyFams.1 h with ⟨_, _, h⟩ | ⟨cp, hcp, hl, hr, h⟩ | ⟨_, _, h⟩
  · cases h
  · cases h
    exact ⟨cp, cap?_of_mem hn hcp, hcp, rfl, rfl, hl, hr⟩
  · cases h

/-- Whoever may open a vault's seed may open what that vault may open. -/
theorem mayOpen_via {st : State} {h : Holder} {v : VaultId} {k : KeyFam}
    (hv : h.entitled st (.seed v) = true) (hk : MayOpen st (.vault v) k) : MayOpen st h k := by
  rcases hk with hk | hk
  · left
    simp only [Holder.entitled, entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at hk
    cases h with
    | signer s =>
      simp only [Holder.entitled, AvenDB.entitled, List.any_eq_true, Bool.and_eq_true, readsV,
        beq_iff_eq] at hv ⊢
      obtain ⟨y, hy, hact, rfl⟩ := hv
      rcases hk with hk | ⟨x, hx, hown, hread⟩
      · exact ⟨y, hy, hact, hk⟩
      · exact ⟨x, hx, actsFor_owns hact hown, hread⟩
    | vault w =>
      simp only [Holder.entitled, entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, readsV,
        beq_iff_eq] at hv ⊢
      rcases hv with rfl | ⟨y, hy, hown, rfl⟩
      · exact hk
      · rcases hk with hk | ⟨x, hx, hown', hread⟩
        · exact .inr ⟨y, hy, hown, hk⟩
        · exact .inr ⟨x, hx, owns_trans hown hown', hread⟩
    | everyone => simp [Holder.entitled, publicKey] at hv
  · exact .inr hk

/-- Family `k` lies within family `f` in `st`: it is `f`, or `f` is a cap's and `k` a cell of the same vault that the
    cap reaches, being in it or wide. -/
def Within (st : State) : KeyFam → KeyFam → Prop
  | .cap v c, k => k = .cap v c ∨
      ∃ x, k = .cell v x ∧ (x.contains c = true ∨ ∃ cp ∈ st.caps, cp.id = c ∧ cp.wide = true)
  | f, k => k = f

/-- A family lies within itself. -/
theorem Within.refl (st : State) (f : KeyFam) : Within st f f := by
  cases f <;> simp [Within]

/-- What lies within a cap's or a cell's family is a cap's or a cell's family. -/
theorem Within.not_seed {st : State} {f k : KeyFam} (h : Within st f k) (hf : ∀ v, f ≠ .seed v) :
    ∀ v, k ≠ .seed v := by
  intro v hk
  subst hk
  cases f with
  | seed u => exact hf u rfl
  | cap u c =>
    rcases h with h | ⟨x, h, -⟩
    · cases h
    · cases h
  | cell u x => cases h

/-- Lying within chains. -/
theorem Within.trans {st : State} {f k k' : KeyFam} (h₁ : Within st f k) (h₂ : Within st k k') : Within st f k' := by
  cases f with
  | seed v => simp only [Within] at h₁; subst h₁; exact h₂
  | cell v x => simp only [Within] at h₁; subst h₁; exact h₂
  | cap v c =>
    rcases h₁ with rfl | ⟨x, rfl, hx⟩
    · exact h₂
    · simp only [Within] at h₂
      subst h₂
      exact .inr ⟨x, rfl, hx⟩

/-- More caps, more within. -/
theorem Within.mono {st st' : State} (hc : ∀ cp ∈ st.caps, cp ∈ st'.caps) {f k : KeyFam} (h : Within st f k) :
    Within st' f k := by
  cases f with
  | seed v => exact h
  | cell v x => exact h
  | cap v c =>
    rcases h with h | ⟨x, rfl, hx | ⟨cp, hcp, hid, hw⟩⟩
    · exact .inl h
    · exact .inr ⟨x, rfl, .inl hx⟩
    · exact .inr ⟨x, rfl, .inr ⟨cp, hc cp hcp, hid, hw⟩⟩

/-- A cap named in a cell, or whose every copy is wide, reaches the cell; with distinct cap ids a wide cap of that id
    is its only copy. -/
theorem wide_all {st : State} (hn : (st.caps.map (·.id)).Nodup) {c : CapId} {x : Cell}
    (hx : x.contains c = true ∨ ∃ cp ∈ st.caps, cp.id = c ∧ cp.wide = true) :
    x.contains c = true ∨ ∀ cp ∈ st.caps, cp.id = c → cp.wide = true := by
  rcases hx with hx | ⟨cp, hcp, hid, hw⟩
  · exact .inl hx
  · refine .inr fun cp' hcp' hid' => ?_
    rw [eq_of_nodup_map hn hcp' hcp (hid'.trans hid.symm)]
    exact hw

/-- A cap a vault may read reaches a cell it is in, or every cell when wide: the vault may read that cell. -/
theorem readsV_cell_of_cap {st : State} {y v : VaultId} {c : CapId} {x : Cell}
    (h : readsV st y (.cap v c) = true) (hx : x.contains c = true ∨ ∀ cp ∈ st.caps, cp.id = c → cp.wide = true) :
    readsV st y (.cell v x) = true := by
  simp only [readsV] at h ⊢
  cases hc : st.cap? c with
  | none => rw [hc] at h; cases h
  | some cp =>
    rw [hc] at h
    simp only [Bool.and_eq_true, Bool.or_eq_true, beq_iff_eq] at h
    obtain ⟨⟨⟨hover, hlive⟩, hread⟩, hy⟩ := h
    rcases hy with rfl | hg
    · simp
    · have hcp := cap?_mem hc
      have hid := cap?_id hc
      refine Bool.or_eq_true_iff.2 (.inr (List.any_eq_true.2 ⟨cp, hcp, ?_⟩))
      simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, hover, hid, hlive, hread, hg, and_true,
        true_and]
      rcases hx with hx | hw
      · exact .inr hx
      · exact .inl (hw cp hcp hid)

/-- A public cap reaches a cell it is in, or every cell when wide: that cell is public. -/
theorem publicKey_cell_of_cap {st : State} {v : VaultId} {c : CapId} {x : Cell}
    (h : publicKey st (.cap v c) = true) (hx : x.contains c = true ∨ ∀ cp ∈ st.caps, cp.id = c → cp.wide = true) :
    publicKey st (.cell v x) = true := by
  simp only [publicKey] at h ⊢
  cases hc : st.cap? c with
  | none => rw [hc] at h; cases h
  | some cp =>
    rw [hc] at h
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    obtain ⟨⟨⟨hover, hlive⟩, hread⟩, hg⟩ := h
    have hcp := cap?_mem hc
    have hid := cap?_id hc
    refine List.any_eq_true.2 ⟨cp, hcp, ?_⟩
    simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true, hover, hid, hlive, hread, hg, and_true,
      true_and]
    rcases hx with hx | hw
    · exact .inr hx
    · exact .inl (hw cp hcp hid)

/-- Whoever is entitled to a cap's key is entitled to the keys of the cells it reaches. -/
theorem Holder.entitled_cell_of_cap {st : State} {h : Holder} {v : VaultId} {c : CapId} {x : Cell}
    (hk : h.entitled st (.cap v c) = true)
    (hx : x.contains c = true ∨ ∀ cp ∈ st.caps, cp.id = c → cp.wide = true) : h.entitled st (.cell v x) = true := by
  cases h with
  | signer s =>
    simp only [Holder.entitled, AvenDB.entitled, List.any_eq_true, Bool.and_eq_true] at hk ⊢
    obtain ⟨y, hy, hact, hread⟩ := hk
    exact ⟨y, hy, hact, readsV_cell_of_cap hread hx⟩
  | vault w =>
    simp only [Holder.entitled, entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at hk ⊢
    rcases hk with hk | ⟨y, hy, hown, hread⟩
    · exact .inl (readsV_cell_of_cap hk hx)
    · exact .inr ⟨y, hy, hown, readsV_cell_of_cap hread hx⟩
  | everyone => exact publicKey_cell_of_cap hk hx

/-- Whoever may open a family's key may open the keys of the families within it. -/
theorem mayOpen_within {st : State} (hn : (st.caps.map (·.id)).Nodup) {h : Holder} {f k : KeyFam}
    (hfk : Within st f k) (hf : MayOpen st h f) : MayOpen st h k := by
  cases f with
  | seed v => simp only [Within] at hfk; subst hfk; exact hf
  | cell v x => simp only [Within] at hfk; subst hfk; exact hf
  | cap v c =>
    rcases hfk with rfl | ⟨x, rfl, hx⟩
    · exact hf
    · exact hf.imp (fun h => Holder.entitled_cell_of_cap h (wide_all hn hx))
        (fun h => publicKey_cell_of_cap h (wide_all hn hx))

/-- A vault holder may open its own seed. -/
theorem mayOpen_self (st : State) (v : VaultId) : MayOpen st (.vault v) (.seed v) :=
  .inl (by simp [Holder.entitled, entitledV, readsV])

/-- No seed is public. -/
theorem publicKey_seed (st : State) (v : VaultId) : publicKey st (.seed v) = false := rfl

/-- Whom the current key of a family is sealed to, wrapped under or derived from: a signer entitled to it, the seed
    of a vault entitled to it, or for a cell the key of a live cap with read or more that reaches it. -/
theorem mem_targets {st : State} (hs : Sane st) {k : KeyFam} (hk : k ∈ keyFams st) {t : KeyName}
    (ht : t ∈ targets st k) :
    (∃ d, t = .signer d ∧ entitled st d k = true) ∨
    (∃ o, t = st.curKey (.seed o) ∧ (st.vault? o).isSome = true ∧ entitledV st o k = true) ∨
    (∃ v c x, k = .cell v x ∧ t = st.curKey (.cap v c) ∧ .cap v c ∈ keyFams st ∧
      (x.contains c = true ∨ ∃ cp ∈ st.caps, cp.id = c ∧ cp.wide = true)) := by
  cases k with
  | seed v =>
    simp only [targets] at ht
    cases hv : st.vault? v with
    | none => rw [hv] at ht; cases ht
    | some vt =>
      rw [hv] at ht
      dsimp only at ht
      have hvt := vault?_mem hv
      have hid := vault?_id hv
      rcases List.mem_append.1 ht with ht | ht
      · obtain ⟨d, hd, rfl⟩ := List.mem_map.1 ht
        refine .inl ⟨d, rfl, List.any_eq_true.2 ⟨vt, hvt, ?_⟩⟩
        simp only [Bool.and_eq_true, readsV, hid, beq_self_eq_true, and_true]
        refine actsFor_member hv ?_
        simp only [Bool.or_eq_true, List.contains_iff_mem]
        rcases List.mem_append.1 hd with hd | hd
        · exact .inl hd
        · obtain ⟨p, hp, hpd⟩ := List.mem_filterMap.1 hd
          cases p with
          | signer s => cases hpd; exact .inr hp
          | vault _ => cases hpd
      · obtain ⟨o, ho, rfl⟩ := List.mem_map.1 ht
        obtain ⟨p, hp, hpo⟩ := List.mem_filterMap.1 ho
        cases p with
        | vault o' =>
          simp only [Option.some.injEq] at hpo
          subst hpo
          refine .inr (.inl ⟨o', rfl, hs.owners v vt hv o' hp, ?_⟩)
          simp only [entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true]
          exact .inr ⟨vt, hvt, by rw [hid]; exact owns_owner hv hp, by simp [readsV, hid]⟩
        | signer _ => cases hpo
  | cap v c =>
    obtain ⟨cp, hc, hcp, hover, hid, hlive, hread⟩ := cap_mem_keyFams hs.capIds hk
    simp only [targets] at ht
    rcases List.mem_cons.1 ht with rfl | ht
    · refine .inr (.inl ⟨v, rfl, hover ▸ hs.capOver cp hcp, ?_⟩)
      simp only [entitledV, readsV, hc, hover, hlive, hread, beq_self_eq_true, Bool.true_or, Bool.and_true]
    · rw [hc] at ht
      dsimp only at ht
      split at ht
      · rename_i g hg
        rw [List.mem_singleton] at ht
        subst ht
        refine .inr (.inl ⟨g, rfl, hs.capGrantee cp hcp g hg, ?_⟩)
        simp only [entitledV, readsV, hc, hover, hlive, hread, hg, beq_self_eq_true, Bool.or_true, Bool.and_true,
          Bool.true_or]
      · cases ht
  | cell v x =>
    simp only [targets] at ht
    rcases List.mem_cons.1 ht with rfl | ht
    · refine .inr (.inl ⟨v, rfl, ?_, by simp [entitledV, readsV]⟩)
      rcases mem_keyFams.1 hk with ⟨_, _, h⟩ | ⟨_, _, _, _, h⟩ | ⟨en, hen, h⟩
      · cases h
      · cases h
      · cases h
        exact hs.entryVault en hen
    · obtain ⟨cp, hcp, rfl⟩ := List.mem_map.1 ht
      obtain ⟨hcp, hcond⟩ := List.mem_filter.1 hcp
      simp only [Bool.and_eq_true, beq_iff_eq, Bool.or_eq_true] at hcond
      obtain ⟨⟨⟨hover, hlive⟩, hread⟩, hx⟩ := hcond
      refine .inr (.inr ⟨v, cp.id, x, rfl, rfl, ?_, ?_⟩)
      · exact mem_keyFams.2 (.inr (.inl ⟨cp, hcp, hlive, hread, by rw [hover]⟩))
      · rcases hx with hw | hx
        · exact .inr ⟨cp, hcp, rfl, hw⟩
        · exact .inl hx

/-! ## What an accepted step keeps -/

/-- A change keeps every cap, adding caps only at the end, every entry id ever created and every vault. -/
theorem Change.grows {st mid : State} (h : Change st mid) :
    (∃ l, mid.caps = st.caps ++ l) ∧ (∀ e ∈ st.born, e ∈ mid.born) ∧
    ∀ x, (st.vault? x).isSome = true → (mid.vault? x).isSome = true := by
  cases h with
  | genesis vt _ _ =>
    refine ⟨⟨[], by simp⟩, fun e he => he, fun x hx => ?_⟩
    rw [vault?_append]
    cases hl : st.vault? x with
    | none => rw [hl] at hx; cases hx
    | some _ => rfl
  | setVault v vt vt' _ _ _ =>
    refine ⟨⟨[], by simp [AvenDB.setVault]⟩, fun e he => he, fun x hx => ?_⟩
    rw [vault?_setVault]
    cases hl : st.vault? x with
    | none => rw [hl] at hx; cases hx
    | some _ => rfl
  | cap c _ _ _ => exact ⟨⟨[c], rfl⟩, fun e he => he, fun x hx => hx⟩
  | create en w x _ _ _ _ _ _ _ =>
    exact ⟨⟨[], by simp⟩, fun e he => List.mem_append_left _ he, fun x hx => hx⟩
  | write en w st₁ _ _ _ h₁ =>
    rcases h₁ with rfl | ⟨a, rfl⟩
    · exact ⟨⟨[], by simp⟩, fun e he => he, fun x hx => hx⟩
    · exact ⟨⟨[], by simp [setEntry]⟩, fun e he => he, fun x hx => hx⟩
  | move en σ x _ _ => exact ⟨⟨[], by simp [setEntry]⟩, fun e he => he, fun x hx => hx⟩
  | same => exact ⟨⟨[], by simp⟩, fun e he => he, fun x hx => hx⟩
  | revoke rs => exact ⟨⟨[], by simp⟩, fun e he => he, fun x hx => hx⟩
  | lane l => exact ⟨⟨[], by simp⟩, fun e he => he, fun x hx => hx⟩

/-- An accepted edit keeps every cap, adding caps only at the end, every entry id ever created and every vault. -/
theorem apply_grows {st post : State} {edit : Edit} (h : apply st edit = some post) :
    (∃ l, post.caps = st.caps ++ l) ∧ (∀ e ∈ st.born, e ∈ post.born) ∧
    ∀ x, (st.vault? x).isSome = true → (post.vault? x).isSome = true := by
  obtain ⟨mid, hc, es, ws, -, -, rfl⟩ := apply_cases h
  exact hc.grows

/-- Entry `en'` is entry `en` with more stays in front, if any. -/
def Extends (en en' : Entry) : Prop := en'.id = en.id ∧ en'.vault = en.vault ∧ ∃ l, en'.stays = l ++ en.stays

/-- After a change, every entry is one that was there, with more stays in front if any, or one whose id was never
    created before. -/
theorem Change.entries {st mid : State} (h : Change st mid) :
    ∀ en' ∈ mid.entries, (∃ en ∈ st.entries, Extends en en') ∨ en'.id ∉ st.born := by
  have hsame : ∀ en' ∈ st.entries, (∃ en ∈ st.entries, Extends en en') ∨ en'.id ∉ st.born :=
    fun en' h => .inl ⟨en', h, rfl, rfl, [], rfl⟩
  -- an entry `setEntry` puts in place of `en` extends it
  have hset : ∀ (en en' : Entry), en ∈ st.entries → Extends en en' →
      ∀ y ∈ (setEntry st en').entries, (∃ en ∈ st.entries, Extends en y) ∨ y.id ∉ st.born := by
    intro en en' hen hext y hy
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hy
    by_cases hxid : x.id = en'.id
    · simp only [hxid, beq_self_eq_true, ite_true]
      exact .inl ⟨en, hen, hext⟩
    · simp only [beq_iff_eq, hxid, ite_false]
      exact hsame x hx
  cases h with
  | same => exact hsame
  | genesis _ _ _ => exact hsame
  | setVault _ _ _ _ _ _ => exact hsame
  | cap _ _ _ _ => exact hsame
  | revoke _ => exact hsame
  | lane _ => exact hsame
  | create en w x _ _ hnew _ _ _ _ =>
    intro y hy
    rcases List.mem_append.1 hy with hy | hy
    · exact hsame y hy
    · rw [List.mem_singleton.1 hy]
      exact .inr hnew
  | write en w st₁ _ he _ h₁ =>
    rcases h₁ with rfl | ⟨a, rfl⟩
    · exact hsame
    · exact hset en _ (entry?_mem he) ⟨rfl, rfl, [], rfl⟩
  | move en σ x he _ => exact hset en _ (entry?_mem he) ⟨rfl, rfl, [(σ, x)], rfl⟩

/-- After an accepted edit, every entry is one that was there, with more stays in front if any, or one whose id was
    never created before. -/
theorem apply_entries {st post : State} {edit : Edit} (h : apply st edit = some post) :
    ∀ en' ∈ post.entries, (∃ en ∈ st.entries, Extends en en') ∨ en'.id ∉ st.born := by
  obtain ⟨mid, hc, es, ws, hes, -, rfl⟩ := apply_cases h
  exact fun en' hen' => hc.entries en' (hes.subset hen')

/-- Settling keeps every seal and everything published. -/
theorem settle_mono (pre post : State) : (∀ s ∈ post.seals, s ∈ (settle pre post).seals) ∧
    ∀ x ∈ post.published, x ∈ (settle pre post).published := by
  unfold settle
  rw [sealAll_eq]
  have hb : ∀ (l : List KeyFam) (st : State), (∀ s ∈ st.seals, s ∈ (l.foldl bump st).seals) ∧
      (l.foldl bump st).published = st.published := by
    intro l st
    refine ⟨fun s hs => foldl_inv (fun a : State => s ∈ a.seals) _ (fun a k h => ?_) l st hs,
      foldl_bump_published l st⟩
    exact List.mem_append_left _ h
  have hs : ∀ (l : List KeyFam) (st : State), (∀ s ∈ st.seals, s ∈ (l.foldl sealOne st).seals) ∧
      ∀ x ∈ st.published, x ∈ (l.foldl sealOne st).published := fun l st =>
    ⟨fun s h => foldl_inv (fun a : State => s ∈ a.seals) _ (fun _ _ h => sealOne_seals_mono h) l st h,
      fun x h => foldl_inv (fun a : State => x ∈ a.published) _ (fun _ _ h => sealOne_published_mono h) l st h⟩
  refine ⟨fun s h => (linkAll_mono _).2 s ((hs _ _).1 s ((hb _ _).1 s h)), fun x h => ?_⟩
  rw [(linkAll_mono _).1]
  exact (hs _ _).2 x (by rw [(hb _ _).2]; exact h)

/-! ## T6, kept by every step

T6 holds in every reachable state as part of an invariant (`KeyInv`). After a step, a holder opens only what it
opened before, what the previous key of a family it may open now opened, the new keys of families it may open now,
and entry keys (`MayKnow`); and each current key of a family in use among these is of a family it may open. A family
in use rotates (`staleKeys`) when a holder listed before opened its key and may no longer, everyone among them, or when
it comes back into use while a seal holds its key; and a holder listed nowhere opened only its own seed and what
everyone opened. Entry keys open only entry keys, and an entry's key in its current stay is derived only from its
cell's key of the same generation (T24). -/

/-- What every reachable state keeps about its keys: T6 for every holder and every family in use, and what its seals
    and published keys may hold. -/
structure KeyInv (st : State) : Prop where
  sane : Sane st
  /-- T6: a holder opens the current key of a family in use only if it may open it. -/
  fwd : ∀ h, ∀ k ∈ keyFams st, Knows st (h.start st) (st.curKey k) → MayOpen st h k
  /-- No seal hides a signer's key, and a sealed scoped key is of an epoch its family has reached. -/
  secret : ∀ s ∈ st.seals, (∀ d, s.secret ≠ .signer d) ∧ ∀ k e, s.secret = .scoped k e → e ≤ st.epochOf k
  /-- A scoped key is sealed under a scoped key of an epoch its family has reached, or a signer's key, never under an
      entry key. -/
  sealedTo : ∀ s ∈ st.seals, ∀ k e, s.secret = .scoped k e →
    (∀ f e', s.to = .scoped f e' → e' ≤ st.epochOf f) ∧ ∀ x σ g, s.to ≠ .entry x σ g
  /-- Nothing is sealed to the seed of a vault that doesn't exist. -/
  seedTo : ∀ s ∈ st.seals, ∀ u e, s.to = .scoped (.seed u) e → (st.vault? u).isSome = true
  /-- What is sealed to a cap's or a cell's key is a key of a family within it, or an entry key. -/
  within : ∀ s ∈ st.seals, ∀ f e, s.to = .scoped f e → (∀ v, f ≠ .seed v) →
    (∃ k e', s.secret = .scoped k e' ∧ Within st f k) ∨ ∃ x σ g, s.secret = .entry x σ g
  /-- What is published is a scoped key of an epoch its family has reached, and also sealed. -/
  published : ∀ x ∈ st.published, (∃ k e, x = .scoped k e ∧ e ≤ st.epochOf k) ∧ ∃ s ∈ st.seals, s.secret = x
  /-- The current key of every public family in use is published. -/
  «public» : ∀ k ∈ keyFams st, publicKey st k = true → st.curKey k ∈ st.published
  /-- An entry's key is of an entry once created, in a stay it has if it exists, and in its current stay it is sealed
      only under its cell's key of the same generation. -/
  entries : ∀ s ∈ st.seals, ∀ e σ g, s.secret = .entry e σ g → e ∈ st.born ∧
    ∀ en ∈ st.entries, en.id = e → σ ∈ en.stays.map (·.1) ∧ (σ = en.stay → s.to = .scoped (.cell en.vault en.cell) g)

/-- A key one opens is one it started with, the secret of a seal, or published. -/
theorem knows_cases {st : State} {start : List KeyName} {x : KeyName} (h : Knows st start x) :
    x ∈ start ∨ (∃ s ∈ st.seals, s.secret = x) ∨ x ∈ st.published := by
  cases h with
  | own hx => exact .inl hx
  | published hx => exact .inr (.inr hx)
  | «unseal» hs _ => exact .inr (.inl ⟨_, hs, rfl⟩)

/-- A key one opens is one it started with, an entry key, or a scoped key of an epoch its family has reached. -/
theorem KeyInv.knows_old {st : State} (hinv : KeyInv st) {start : List KeyName} {x : KeyName}
    (h : Knows st start x) : x ∈ start ∨ (∃ k e, x = .scoped k e ∧ e ≤ st.epochOf k) ∨ ∃ e σ g, x = .entry e σ g := by
  rcases knows_cases h with hx | ⟨s, hs, rfl⟩ | hx
  · exact .inl hx
  · obtain ⟨hsig, hsc⟩ := hinv.secret s hs
    cases hsec : s.secret with
    | signer d => exact absurd hsec (hsig d)
    | «scoped» k e => exact .inr (.inl ⟨k, e, rfl, hsc k e hsec⟩)
    | entry e σ g => exact .inr (.inr ⟨e, σ, g, rfl⟩)
  · obtain ⟨⟨k, e, rfl, he⟩, -⟩ := hinv.published _ hx
    exact .inr (.inl ⟨k, e, rfl, he⟩)

/-- Starting from a key nothing is sealed to, one opens that key and what everyone opens. -/
theorem knows_fresh {st : State} {y x : KeyName} (hy : ∀ s ∈ st.seals, s.to ≠ y) (h : Knows st [y] x) :
    x = y ∨ Knows st [] x := by
  induction h with
  | own hx => exact .inl (List.mem_singleton.1 hx)
  | published hx => exact .inr (.published hx)
  | «unseal» hs _ ih =>
    rcases ih with heq | ih
    · exact absurd heq (hy _ hs)
    · exact .inr (.unseal hs ih)

/-- From a cap's or a cell's key one opens keys of families within it, entry keys, and what everyone opens. -/
theorem KeyInv.knows_within {st : State} (hinv : KeyInv st) {f : KeyFam} (hf : ∀ v, f ≠ .seed v) {x : KeyName}
    (h : Knows st [st.curKey f] x) :
    (∃ k e, x = .scoped k e ∧ Within st f k) ∨ (∃ e σ g, x = .entry e σ g) ∨ Knows st [] x := by
  induction h with
  | own hx =>
    rw [List.mem_singleton] at hx
    exact .inl ⟨f, _, hx, Within.refl st f⟩
  | published hx => exact .inr (.inr (.published hx))
  | @«unseal» s hs _ ih =>
    rcases ih with ⟨k, e, hto, hfk⟩ | ⟨e, σ, g, hto⟩ | ih
    · rcases hinv.within s hs k e hto (hfk.not_seed hf) with ⟨k', e', hsec, hkk'⟩ | hent
      · exact .inl ⟨k', e', hsec, hfk.trans hkk'⟩
      · exact .inr (.inl hent)
    · -- nothing scoped is sealed to an entry key
      cases hsec : s.secret with
      | signer d => exact absurd hsec ((hinv.secret s hs).1 d)
      | «scoped» k e' => exact absurd hto ((hinv.sealedTo s hs k e' hsec).2 e σ g)
      | entry e' σ' g' => exact .inr (.inl ⟨e', σ', g', rfl⟩)
    · exact .inr (.inr (.unseal hs ih))

/-- The signer holders are the signers some vault lists. -/
theorem signer_mem_holders {st : State} {s : SignerId} : Holder.signer s ∈ holders st ↔ s ∈ signers st := by
  simp [holders]

/-- The vault holders are the vaults that exist. -/
theorem vault_mem_holders {st : State} {v : VaultId} :
    Holder.vault v ∈ holders st ↔ v ∈ st.vaults.map (·.id) := by
  simp [holders, eq_comm]

/-- Everyone is a holder. -/
theorem everyone_mem_holders (st : State) : Holder.everyone ∈ holders st := by
  simp [holders]

/-- A vault found by a lookup is listed. -/
theorem mem_ids_of_isSome {st : State} {v : VaultId} (h : (st.vault? v).isSome = true) :
    v ∈ st.vaults.map (·.id) := by
  obtain ⟨vt, hvt⟩ := Option.isSome_iff_exists.1 h
  exact List.mem_map.2 ⟨vt, vault?_mem hvt, vault?_id hvt⟩

/-- A signer entitled to anything is listed by some vault. -/
theorem entitled_listed {st : State} {s : SignerId} {k : KeyFam} (h : entitled st s k = true) :
    s ∈ signers st := by
  simp only [AvenDB.entitled, List.any_eq_true, Bool.and_eq_true] at h
  obtain ⟨_, _, hact, _⟩ := h
  exact actsFor_listed hact

/-- A family in use after a change that doesn't rotate: if it isn't public after, every holder listed before that
    opened its key may open it after; and if it wasn't in use before, nothing sealed its key. -/
theorem not_stale {pre post : State} {k : KeyFam} (hk : k ∈ keyFams post) (hS : k ∉ staleKeys pre post) :
    (publicKey post k = false → ∀ h ∈ holders pre, (opens pre (h.start pre)).contains (pre.curKey k) = true →
      h.entitled post k = true) ∧
    (k ∉ keyFams pre → ∀ s ∈ pre.seals, s.secret ≠ pre.curKey k) := by
  unfold staleKeys at hS
  simp only [List.mem_append, List.mem_filter, not_or, not_and] at hS
  have h₀ := hS.1 hk
  simp only [Bool.or_eq_true, Bool.and_eq_true, Bool.not_eq_true', not_or, not_and, List.any_map,
    List.any_eq_true, not_exists] at h₀
  refine ⟨fun hpub h hh ho => ?_, fun hnot s hs hsec => ?_⟩
  · have := h₀.1 hpub h hh
    simp only [Function.comp, Bool.and_eq_true, Bool.not_eq_true', not_and] at this
    cases he : h.entitled post k
    · exact absurd he (this ho)
    · rfl
  · exact h₀.2 (by simpa using hnot) s hs (by simp [hsec])

/-- A key name is a signer's key, a scoped key or an entry key. -/
theorem keyName_cases (x : KeyName) :
    (∃ d, x = .signer d) ∨ (∃ k e, x = .scoped k e) ∨ ∃ e σ g, x = .entry e σ g := by
  cases x with
  | signer d => exact .inl ⟨d, rfl⟩
  | «scoped» k e => exact .inr (.inl ⟨k, e, rfl⟩)
  | entry e σ g => exact .inr (.inr ⟨e, σ, g, rfl⟩)

/-- A family that rotates is in use after the change. -/
theorem mem_keyFams_of_stale {pre post : State} {k : KeyFam} (h : k ∈ staleKeys pre post) : k ∈ keyFams post := by
  unfold staleKeys at h
  simp only [List.mem_append, List.mem_filter] at h
  rcases h with h | h
  · exact h.1
  · exact h.1

/-- Before the step, a holder opened the current key of a family in use after it that doesn't rotate only if it may
    open it after: `staleKeys` checks the holders listed before, and the others opened only a seed or public keys. -/
theorem KeyInv.base_mayOpen {pre post : State} (hinv : KeyInv pre) {h : Holder} {k : KeyFam}
    (hk : k ∈ keyFams post) (hS : k ∉ staleKeys pre post)
    (hx : Knows pre (h.start pre) (pre.curKey k)) : MayOpen (settle pre post) h k := by
  obtain ⟨hns, hfresh⟩ := not_stale hk hS
  have hkept := kept_settle pre post
  unfold MayOpen
  rw [hkept.entitled, hkept.publicKey]
  -- a vault opens its own seed
  have hself : ∀ v, pre.curKey k = pre.curKey (.seed v) → (Holder.vault v).entitled post k = true := by
    intro v hkv
    simp only [State.curKey, KeyName.scoped.injEq] at hkv
    obtain ⟨rfl, -⟩ := hkv
    simp [Holder.entitled, entitledV, readsV]
  cases hpub : publicKey post k
  · left
    -- what everyone opened is public now
    have hev : ¬ Knows pre [] (pre.curKey k) := fun hev => by
      have := hns hpub .everyone (everyone_mem_holders pre) (opens_complete hev)
      simp [Holder.entitled, hpub] at this
    by_cases hkp : k ∈ keyFams pre
    · by_cases hh : h ∈ holders pre
      · exact hns hpub h hh (opens_complete hx)
      · cases h with
        | signer s =>
          rcases hinv.fwd (.signer s) k hkp hx with hent | hpre
          · exact absurd (signer_mem_holders.2 (entitled_listed hent)) hh
          · exact (hev (.published (hinv.public k hkp hpre))).elim
        | vault v =>
          -- nothing is sealed to the seed of a vault that doesn't exist
          have hnone : ∀ s ∈ pre.seals, s.to ≠ pre.curKey (.seed v) := fun s hs hto =>
            hh (vault_mem_holders.2 (mem_ids_of_isSome (hinv.seedTo s hs v _ hto)))
          rcases knows_fresh hnone hx with heq | hev'
          · exact hself v heq
          · exact (hev hev').elim
        | everyone => exact absurd (everyone_mem_holders pre) hh
    · -- a family back in use: nothing sealed or published its key
      rcases knows_cases hx with hst | ⟨s, hs, hsec⟩ | hpb
      · cases h with
        | signer s => simp [Holder.start, State.curKey] at hst
        | vault v =>
          simp only [Holder.start, List.mem_singleton] at hst
          exact hself v hst
        | everyone => simp [Holder.start] at hst
      · exact absurd hsec (hfresh hkp s hs)
      · obtain ⟨-, s, hs, hsec⟩ := hinv.published _ hpb
        exact absurd hsec (hfresh hkp s hs)
  · exact .inr rfl

/-- Before the step, the previous key of a family a holder may open now opened the current key of a family in use
    that doesn't rotate only if the holder may open that family too. -/
theorem KeyInv.closure_mayOpen {pre post : State} {edit : Edit} (hinv : KeyInv pre)
    (hpost : apply pre edit = some post) {h : Holder} {f k : KeyFam} (hk : k ∈ keyFams post)
    (hS : k ∉ staleKeys pre post) (hf : MayOpen (settle pre post) h f)
    (hx : Knows pre [pre.curKey f] (pre.curKey k)) : MayOpen (settle pre post) h k := by
  have hkept := kept_settle pre post
  have hs' : Sane (settle pre post) := hkept.sane (hinv.sane.of_apply hpost)
  obtain ⟨⟨l, hcaps⟩, -, -⟩ := apply_grows hpost
  -- a cap's or a cell's key
  have hwithin : (∀ v, f ≠ .seed v) → MayOpen (settle pre post) h k := by
    intro hfs
    rcases hinv.knows_within hfs hx with ⟨k', e, heq, hfk⟩ | ⟨e, σ, g, heq⟩ | hev
    · simp only [State.curKey, KeyName.scoped.injEq] at heq
      obtain ⟨rfl, -⟩ := heq
      have hc : ∀ cp ∈ pre.caps, cp ∈ (settle pre post).caps := fun cp hcp => by
        rw [hkept.caps, hcaps]
        exact List.mem_append_left _ hcp
      exact mayOpen_within hs'.capIds (hfk.mono hc) hf
    · simp [State.curKey] at heq
    · rcases hinv.base_mayOpen (h := .everyone) hk hS hev with h1 | h1
      · exact .inr h1
      · exact .inr h1
  cases f with
  | seed v =>
    have hv := hinv.base_mayOpen (h := .vault v) hk hS hx
    rcases hf with hf | hf
    · exact mayOpen_via hf hv
    · simp [publicKey] at hf
  | cap v c => exact hwithin (fun _ h => by cases h)
  | cell v x => exact hwithin (fun _ h => by cases h)

/-- What holder `h` may open after the step from `pre` that settles as `st'`: what it opened before, what the previous
    key of a family it may open now opened before, the new keys of families it may open now, and entry keys. -/
def MayKnow (pre st' : State) (h : Holder) (x : KeyName) : Prop :=
  Knows pre (h.start pre) x ∨ (∃ f, MayOpen st' h f ∧ Knows pre [pre.curKey f] x) ∨
  (∃ k e, x = .scoped k e ∧ pre.epochOf k < e ∧ MayOpen st' h k) ∨ ∃ e σ g, x = .entry e σ g

/-- A key newer than any before the step is one of a family the holder may open now. -/
theorem KeyInv.mayKnow_new {pre st' : State} (hinv : KeyInv pre) {h : Holder} {k : KeyFam} {e : Nat}
    (hx : MayKnow pre st' h (.scoped k e)) (he : pre.epochOf k < e) : MayOpen st' h k := by
  rcases hx with hx | ⟨f, -, hx⟩ | ⟨k', e', heq, -, hk⟩ | ⟨_, _, _, heq⟩
  · rcases hinv.knows_old hx with hstart | ⟨k', e', heq, he'⟩ | ⟨_, _, _, heq⟩
    · cases h with
      | signer s => simp [Holder.start] at hstart
      | vault v =>
        simp only [Holder.start, List.mem_singleton, State.curKey, KeyName.scoped.injEq] at hstart
        obtain ⟨rfl, rfl⟩ := hstart
        omega
      | everyone => simp [Holder.start] at hstart
    · simp only [KeyName.scoped.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      omega
    · cases heq
  · rcases hinv.knows_old hx with hstart | ⟨k', e', heq, he'⟩ | ⟨_, _, _, heq⟩
    · simp only [List.mem_singleton, State.curKey, KeyName.scoped.injEq] at hstart
      obtain ⟨rfl, rfl⟩ := hstart
      omega
    · simp only [KeyName.scoped.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      omega
    · cases heq
  · simp only [KeyName.scoped.injEq] at heq
    obtain ⟨rfl, rfl⟩ := heq
    exact hk
  · cases heq

/-- The current key of a family in use that the holder may know after the step is one of a family it may open. -/
theorem KeyInv.mayKnow_cur {pre post : State} {edit : Edit} (hinv : KeyInv pre) (hpost : apply pre edit = some post)
    {h : Holder} {k : KeyFam} (hk : k ∈ keyFams post)
    (hx : MayKnow pre (settle pre post) h ((settle pre post).curKey k)) : MayOpen (settle pre post) h k := by
  by_cases hS : k ∈ staleKeys pre post
  · exact hinv.mayKnow_new hx (epochOf_step_lt hpost hS)
  · rw [curKey_step hpost hS] at hx
    rcases hx with hx | ⟨f, hf, hx⟩ | ⟨k', e, heq, he, -⟩ | ⟨_, _, _, heq⟩
    · exact hinv.base_mayOpen hk hS hx
    · exact hinv.closure_mayOpen hpost hk hS hf hx
    · simp only [State.curKey, KeyName.scoped.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      omega
    · simp [State.curKey] at heq

/-- The current key of a family the holder may open is one it may know. -/
theorem mayKnow_of_mayOpen {pre post : State} {edit : Edit} (hpost : apply pre edit = some post) {h : Holder}
    {k : KeyFam} (hk : MayOpen (settle pre post) h k) :
    MayKnow pre (settle pre post) h ((settle pre post).curKey k) := by
  by_cases hS : k ∈ staleKeys pre post
  · exact .inr (.inr (.inl ⟨k, _, rfl, epochOf_step_lt hpost hS, hk⟩))
  · rw [curKey_step hpost hS]
    exact .inr (.inl ⟨k, hk, .own (List.mem_singleton_self _)⟩)

/-- Only a signer may know its own key. -/
theorem KeyInv.mayKnow_signer {pre st' : State} (hinv : KeyInv pre) {h : Holder} {d : SignerId}
    (hx : MayKnow pre st' h (.signer d)) : h = .signer d := by
  rcases hx with hx | ⟨f, -, hx⟩ | ⟨k, e, heq, -, -⟩ | ⟨_, _, _, heq⟩
  · rcases hinv.knows_old hx with hstart | ⟨_, _, heq, -⟩ | ⟨_, _, _, heq⟩
    · cases h with
      | signer s =>
        simp only [Holder.start, List.mem_singleton, KeyName.signer.injEq] at hstart
        rw [hstart]
      | vault v => simp [Holder.start, State.curKey] at hstart
      | everyone => simp [Holder.start] at hstart
    · cases heq
    · cases heq
  · rcases hinv.knows_old hx with hstart | ⟨_, _, heq, -⟩ | ⟨_, _, _, heq⟩
    · simp [State.curKey] at hstart
    · cases heq
    · cases heq
  · cases heq
  · cases heq

/-- Everything a holder opens after the step is a key it may know: `MayKnow` holds the holder's start and what is
    published, and is closed under every seal, old, rotated, new or linking an entry key. -/
theorem KeyInv.mayKnow_closed {pre post : State} {edit : Edit} (hinv : KeyInv pre) (hpost : apply pre edit = some post)
    {h : Holder} {x : KeyName} (hx : Knows (settle pre post) (h.start (settle pre post)) x) :
    MayKnow pre (settle pre post) h x := by
  obtain ⟨hepochs, hseals, hpubs⟩ := apply_keys hpost
  have hkept := kept_settle pre post
  have hs' : Sane (settle pre post) := hkept.sane (hinv.sane.of_apply hpost)
  induction hx with
  | own hx =>
    cases h with
    | signer s =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      exact .inl (.own (List.mem_singleton_self _))
    | vault v =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      exact mayKnow_of_mayOpen hpost (mayOpen_self _ v)
    | everyone => simp [Holder.start] at hx
  | published hx =>
    rcases settle_published hx with hx | ⟨k, -, hpub, rfl⟩
    · exact .inl (.published (hpubs ▸ hx))
    · exact mayKnow_of_mayOpen hpost (.inr (by rw [hkept.publicKey]; exact hpub))
  | @«unseal» s hs _ ih =>
    rcases settle_seals hs with hs | ⟨k, e, -, he, -, rfl⟩ | ⟨k, hk, t, ht, rfl⟩ | ⟨en, -, hl⟩
    · -- an old seal: of an entry key, or of a scoped key to a scoped key of an epoch reached before
      rw [hseals] at hs
      rcases keyName_cases s.secret with ⟨d, hsec⟩ | ⟨a, e, hsec⟩ | ⟨e, σ, g, hsec⟩
      · exact absurd hsec ((hinv.secret s hs).1 d)
      · obtain ⟨hto, hent⟩ := hinv.sealedTo s hs a e hsec
        rcases ih with ih | ⟨f, hf, ih⟩ | ⟨k, e', hto', he', -⟩ | ⟨x, σ, g, hto'⟩
        · exact .inl (.unseal hs ih)
        · exact .inr (.inl ⟨f, hf, .unseal hs ih⟩)
        · exact absurd (hto k e' hto') (by omega)
        · exact absurd hto' (hent x σ g)
      · exact .inr (.inr (.inr ⟨e, σ, g, hsec⟩))
    · -- a rotated family: whoever may open its new key may open it, and so the previous one
      have hpe : post.epochOf k = pre.epochOf k := by simp only [State.epochOf, hepochs]
      rw [hpe] at he
      have hk := hinv.mayKnow_new ih (by omega)
      by_cases hlt : pre.epochOf k < e
      · exact .inr (.inr (.inl ⟨k, e, rfl, hlt, hk⟩))
      · have : e = pre.epochOf k := by omega
        subst this
        exact .inr (.inl ⟨k, hk, .own (List.mem_singleton_self _)⟩)
    · -- a current key sealed to a target the holder may know
      refine mayKnow_of_mayOpen hpost ?_
      have hk' : k ∈ keyFams (settle pre post) := by rw [hkept.keyFams]; exact hk
      rcases mem_targets hs' hk' ht with ⟨d, rfl, hent⟩ | ⟨o, rfl, ho, hent⟩ | ⟨v, c, x, rfl, rfl, hc, hx⟩
      · rw [hinv.mayKnow_signer ih]
        exact .inl hent
      · have hv := hinv.mayKnow_cur hpost (by rw [← hkept.keyFams]; exact seed_mem_keyFams ho) ih
        rcases hv with hv | hv
        · exact mayOpen_via hv (.inl hent)
        · simp [publicKey] at hv
      · exact mayOpen_within hs'.capIds (f := .cap v c) (.inr ⟨x, rfl, hx⟩)
          (hinv.mayKnow_cur hpost (by rw [← hkept.keyFams]; exact hc) ih)
    · -- linking opens only entry keys
      rcases hl with rfl | ⟨w, -, -, rfl | ⟨-, rfl⟩⟩
      · exact .inr (.inr (.inr ⟨_, _, _, rfl⟩))
      · exact .inr (.inr (.inr ⟨_, _, _, rfl⟩))
      · exact .inr (.inr (.inr ⟨_, _, _, rfl⟩))

/-- An entry with stays is in its current stay and its current cell, and its current stay's cell is that cell. -/
theorem stay_mem {en : Entry} (h : en.stays ≠ []) :
    en.stay ∈ en.stays.map (·.1) ∧ en.cell ∈ en.stays.map (·.2) ∧ en.stayCell en.stay = some en.cell := by
  cases hs : en.stays with
  | nil => exact absurd hs h
  | cons p l =>
    obtain ⟨σ, x⟩ := p
    simp [Entry.stay, Entry.cell, Entry.stayCell, hs]

/-- An entry that extends another, with distinct stays, whose current stay is a stay of the other, has the other's
    current stay and cell: nothing moved it. -/
theorem Extends.stay {en en' : Entry} (hext : Extends en en') (hnd : (en'.stays.map (·.1)).Nodup)
    {σ : Option EditId} (hσ : σ ∈ en.stays.map (·.1)) (hcur : σ = en'.stay) :
    en'.stay = en.stay ∧ en'.cell = en.cell := by
  obtain ⟨-, -, l, hl⟩ := hext
  cases l with
  | nil =>
    rw [List.nil_append] at hl
    constructor <;> simp [Entry.stay, Entry.cell, hl]
  | cons p l =>
    -- a move put a fresh stay in front
    exfalso
    obtain ⟨τ, y⟩ := p
    have hst : en'.stay = τ := by simp [Entry.stay, hl]
    rw [hl] at hnd
    simp only [List.cons_append, List.map_cons, List.nodup_cons, List.map_append, List.mem_append] at hnd
    exact hnd.1 (.inr (hst ▸ hcur ▸ hσ))

/-- The key of a cap or a cell is derived from its vault's seed. -/
theorem seed_mem_targets (st : State) {k : KeyFam} (hk : ∀ v, k ≠ .seed v) :
    st.curKey (.seed k.vault) ∈ targets st k := by
  cases k with
  | seed v => exact absurd rfl (hk v)
  | cap v c => simp [targets, KeyFam.vault]
  | cell v x => simp [targets, KeyFam.vault]

/-- One step keeps `KeyInv`. -/
theorem KeyInv.step {st st' : State} {edit : Edit} (hinv : KeyInv st) (h : step st edit = some st') :
    KeyInv st' := by
  obtain ⟨post, hpost, rfl⟩ := step_cases h
  obtain ⟨-, hseals, hpubs⟩ := apply_keys hpost
  have hkept := kept_settle st post
  have hs' : Sane (settle st post) := hkept.sane (hinv.sane.of_apply hpost)
  obtain ⟨⟨l, hcaps⟩, hborn, hvaults⟩ := apply_grows hpost
  have hmono := settle_mono st post
  have hle : ∀ k, st.epochOf k ≤ (settle st post).epochOf k := epochOf_le_step hpost
  have hvault : ∀ u, (st.vault? u).isSome = true → ((settle st post).vault? u).isSome = true := fun u hu => by
    rw [vault?_congr hkept.vaults]
    exact hvaults u hu
  have hcap : ∀ cp ∈ st.caps, cp ∈ (settle st post).caps := fun cp hcp => by
    rw [hkept.caps, hcaps]
    exact List.mem_append_left _ hcp
  have hfam : ∀ {k}, k ∈ keyFams post → k ∈ keyFams (settle st post) := fun hk => by rw [hkept.keyFams]; exact hk
  refine ⟨hs', fun h k hk hx => ?_, fun s hs => ?_, fun s hs => ?_, fun s hs => ?_, fun s hs => ?_, fun x hx => ?_,
    fun k hk hpub => ?_, fun s hs => ?_⟩
  · -- T6
    rw [hkept.keyFams] at hk
    exact hinv.mayKnow_cur hpost hk (hinv.mayKnow_closed hpost hx)
  · -- what is sealed
    rcases settle_seals hs with hs | ⟨k, e, -, -, he, rfl⟩ | ⟨k, -, t, -, rfl⟩ | ⟨en, -, hl⟩
    · rw [hseals] at hs
      obtain ⟨hsig, hsc⟩ := hinv.secret s hs
      exact ⟨hsig, fun k e hk => Nat.le_trans (hsc k e hk) (hle k)⟩
    · refine ⟨fun d hd => (by cases hd), fun k' e' hk => ?_⟩
      cases hk
      omega
    · refine ⟨fun d hd => (by cases hd), fun k' e' hk => ?_⟩
      cases hk
      exact Nat.le_refl _
    · rcases hl with rfl | ⟨w, -, -, rfl | ⟨-, rfl⟩⟩ <;>
        exact ⟨fun d hd => (by cases hd), fun k e hk => (by cases hk)⟩
  · -- what a scoped key is sealed to
    intro k e hsec
    rcases settle_seals hs with hs | ⟨k', e', -, -, he, rfl⟩ | ⟨k', hk', t, ht, rfl⟩ | ⟨en, -, hl⟩
    · rw [hseals] at hs
      obtain ⟨hto, hent⟩ := hinv.sealedTo s hs k e hsec
      exact ⟨fun f e' hf => Nat.le_trans (hto f e' hf) (hle f), hent⟩
    · refine ⟨fun f e'' hf => ?_, fun x σ g hx => by cases hx⟩
      cases hf
      omega
    · rcases mem_targets hs' (hfam hk') ht with ⟨d, rfl, -⟩ | ⟨o, rfl, -, -⟩ | ⟨v, c, x, -, rfl, -, -⟩
      · exact ⟨fun f e' hf => (by cases hf), fun x σ g hx => by cases hx⟩
      · exact ⟨fun f e' hf => by cases hf; exact Nat.le_refl _, fun x σ g hx => by cases hx⟩
      · exact ⟨fun f e' hf => by cases hf; exact Nat.le_refl _, fun x σ g hx => by cases hx⟩
    · rcases hl with rfl | ⟨w, -, -, rfl | ⟨-, rfl⟩⟩ <;> cases hsec
  · -- nothing is sealed to the seed of a vault that doesn't exist
    intro u e hto
    rcases settle_seals hs with hs | ⟨k, e', hS, -, -, rfl⟩ | ⟨k, hk, t, ht, rfl⟩ | ⟨en, -, hl⟩
    · rw [hseals] at hs
      exact hvault u (hinv.seedTo s hs u e hto)
    · cases hto
      rw [vault?_congr hkept.vaults]
      exact seed_mem_keyFams_iff (mem_keyFams_of_stale hS)
    · rcases mem_targets hs' (hfam hk) ht with ⟨d, rfl, -⟩ | ⟨o, rfl, ho, -⟩ | ⟨v, c, x, -, rfl, -, -⟩
      · cases hto
      · cases hto
        exact ho
      · cases hto
    · rcases hl with rfl | ⟨w, -, -, rfl | ⟨-, rfl⟩⟩ <;> cases hto
  · -- what is sealed to a cap's or a cell's key
    intro f e hto hf
    rcases settle_seals hs with hs | ⟨k, e', -, -, -, rfl⟩ | ⟨k, hk, t, ht, rfl⟩ | ⟨en, -, hl⟩
    · rw [hseals] at hs
      rcases hinv.within s hs f e hto hf with ⟨k, e', hsec, hfk⟩ | hent
      · exact .inl ⟨k, e', hsec, hfk.mono hcap⟩
      · exact .inr hent
    · cases hto
      exact .inl ⟨f, e', rfl, Within.refl _ _⟩
    · rcases mem_targets hs' (hfam hk) ht with ⟨d, rfl, -⟩ | ⟨o, rfl, -, -⟩ | ⟨v, c, x, rfl, rfl, -, hx⟩
      · cases hto
      · cases hto
        exact absurd rfl (hf o)
      · cases hto
        exact .inl ⟨_, _, rfl, .inr ⟨x, rfl, hx⟩⟩
    · rcases hl with rfl | ⟨w, -, -, rfl | ⟨-, rfl⟩⟩
      · exact .inr ⟨_, _, _, rfl⟩
      · exact .inr ⟨_, _, _, rfl⟩
      · exact .inr ⟨_, _, _, rfl⟩
  · -- what is published
    rcases settle_published hx with hx | ⟨k, hk, hpub, rfl⟩
    · rw [hpubs] at hx
      obtain ⟨⟨k, e, rfl, he⟩, s, hs, hsec⟩ := hinv.published _ hx
      exact ⟨⟨k, e, rfl, Nat.le_trans he (hle k)⟩, s, hmono.1 s (by rw [hseals]; exact hs), hsec⟩
    · refine ⟨⟨k, _, rfl, Nat.le_refl _⟩, _, (settle_sealed hk).1 _ (seed_mem_targets _ fun v hv => ?_), rfl⟩
      subst hv
      simp [publicKey] at hpub
  · -- the current key of a public family in use is published
    rw [hkept.keyFams] at hk
    rw [hkept.publicKey] at hpub
    exact (settle_sealed hk).2 hpub
  · -- entry keys
    intro e σ g hsec
    rcases settle_seals hs with hs | ⟨k, e', -, -, -, rfl⟩ | ⟨k, -, t, -, rfl⟩ | ⟨en, hen, hl⟩
    · rw [hseals] at hs
      obtain ⟨hb, hall⟩ := hinv.entries s hs e σ g hsec
      refine ⟨by rw [hkept.born]; exact hborn e hb, fun en' hen' hid => ?_⟩
      have hen'' : en' ∈ post.entries := by rw [← hkept.entries]; exact hen'
      rcases apply_entries hpost en' hen'' with ⟨en, hen, hext⟩ | hnew
      · obtain ⟨hσ, hto⟩ := hall en hen (hext.1.symm.trans hid)
        refine ⟨?_, fun hcur => ?_⟩
        · obtain ⟨-, -, l, hl⟩ := hext
          rw [hl, List.map_append]
          exact List.mem_append_right _ hσ
        · obtain ⟨h1, h2⟩ := hext.stay (hs'.staysNodup en' hen') hσ hcur
          rw [hto (hcur.trans h1), hext.2.1, h2]
      · exact absurd (hid ▸ hb) hnew
    · cases hsec
    · cases hsec
    · -- the seals linking adds are of entries there now, in a stay they have
      have hone : ∀ en' ∈ (settle st post).entries, en'.id = en.id → en' = en := fun en' hen' hid =>
        eq_of_nodup_map hs'.entryIds hen' hen hid
      rcases hl with rfl | ⟨w, hw, hwe, rfl | ⟨hne, rfl⟩⟩
      · simp only [entryKey, KeyName.entry.injEq] at hsec
        obtain ⟨rfl, rfl, rfl⟩ := hsec
        refine ⟨hs'.entryBorn en hen, fun en' hen' hid => ?_⟩
        obtain rfl := hone en' hen' hid
        exact ⟨(stay_mem (hs'.staysNe en' hen')).1, fun _ => rfl⟩
      · simp only [Write.key, KeyName.entry.injEq] at hsec
        obtain ⟨rfl, rfl, rfl⟩ := hsec
        refine ⟨hs'.writeBorn w hw, fun en' hen' hid => ?_⟩
        obtain rfl := hone en' hen' (hid.trans hwe)
        refine ⟨hs'.writeStay w hw en' hen' hwe.symm, fun hcur => ?_⟩
        rw [hcur, (stay_mem (hs'.staysNe en' hen')).2.2]
        rfl
      · simp only [Write.key, KeyName.entry.injEq] at hsec
        obtain ⟨rfl, rfl, rfl⟩ := hsec
        refine ⟨hs'.writeBorn w hw, fun en' hen' hid => ?_⟩
        obtain rfl := hone en' hen' (hid.trans hwe)
        exact ⟨hs'.writeStay w hw en' hen' hwe.symm, fun hcur => absurd hcur hne⟩

/-- The empty state has no families in use, no seals and nothing published. -/
theorem keyInv_empty : KeyInv {} := by
  have hs : Sane {} := ⟨fun x vt hx => by simp [State.vault?] at hx, List.nodup_nil, fun _ h => (by cases h),
    fun _ h => (by cases h), List.nodup_nil, fun _ h => (by cases h), fun _ h => (by cases h),
    fun _ h => (by cases h), fun _ h => (by cases h), fun _ h => (by cases h), fun _ h => (by cases h)⟩
  refine ⟨hs, fun h k hk => ?_, fun _ h => (by cases h), fun _ h => (by cases h), fun _ h => (by cases h),
    fun _ h => (by cases h), fun _ h => (by cases h), fun k hk => ?_, fun _ h => (by cases h)⟩ <;>
    simp [keyFams] at hk

/-- What holds of a state and is kept by every accepted step holds after any replay from it. -/
theorem replay_inv (P : State → Prop) (hstep : ∀ st edit st', P st → step st edit = some st' → P st') :
    ∀ (edits : List Edit) (st : State), P st → P (replay st edits)
  | [], _, h => h
  | edit :: edits, st, h => by
    show P (replay ((step st edit).getD st) edits)
    cases hs : step st edit with
    | none => exact replay_inv P hstep edits st h
    | some st' => exact replay_inv P hstep edits st' (hstep st edit st' h hs)

/-- Every reachable state keeps `KeyInv`. -/
theorem keyInv_replay (edits : List Edit) : KeyInv (replay {} edits) :=
  replay_inv KeyInv (fun _ _ _ h hs => h.step hs) edits {} keyInv_empty

/-- A key one opens is one it started with, a published one, or the secret of a seal whose key it opens. -/
theorem knows_cases_to {st : State} {start : List KeyName} {x : KeyName} (h : Knows st start x) :
    x ∈ start ∨ x ∈ st.published ∨ ∃ s ∈ st.seals, s.secret = x ∧ Knows st start s.to := by
  cases h with
  | own hx => exact .inl hx
  | published hx => exact .inr (.inl hx)
  | «unseal» hs hto => exact .inr (.inr ⟨_, hs, rfl, hto⟩)

/-- Whoever opens the key of an entry in its current stay, at its cell's current generation, opens its cell's current
    key, and so may open it. -/
theorem KeyInv.entry_key {st : State} (hinv : KeyInv st) (h : Holder) {en : Entry} (hen : en ∈ st.entries)
    (hk : Knows st (h.start st) (entryKey st en)) : MayOpen st h (.cell en.vault en.cell) := by
  rcases knows_cases_to hk with hst | hpub | ⟨s, hs, hsec, hto⟩
  · cases h <;> simp [Holder.start, entryKey, State.curKey] at hst
  · obtain ⟨⟨k, e, heq, -⟩, -⟩ := hinv.published _ hpub
    simp [entryKey] at heq
  · obtain ⟨-, hall⟩ := hinv.entries s hs _ _ _ hsec
    obtain ⟨-, hto'⟩ := hall en hen rfl
    rw [hto' rfl] at hto
    exact hinv.fwd h _ (mem_keyFams.2 (.inr (.inr ⟨en, hen, rfl⟩))) hto

/-! ## T5 and T24, along the history

Every seal is justified by the history: a scoped key sealed to a signer's key is one that signer could read, a scoped
key sealed to another family's key is one whoever could read that family could read, an entry key sealed to a cell's
key is of an entry that whoever could read that cell could read, an entry key is linked only under a key of the same
entry, and a published key is of a family that was public. Opening keys follows seals, so whoever opens a key could
read its family, or a cell its entry was in. -/

/-- Whoever could read a vault's seed could read whatever that vault could read. -/
theorem EverReads.trans_seed {sts : List State} {h : Holder} {v : VaultId} {k : KeyFam}
    (h₁ : EverReads sts h (.seed v)) (h₂ : EverReads sts (.vault v) k) : EverReads sts h k := by
  generalize hk : KeyFam.seed v = kv at h₁
  induction h₁ generalizing v with
  | entitled hst hent => subst hk; exact .via hst hent h₂
  | «public» _ hpub => subst hk; simp [publicKey] at hpub
  | via hst hent _ ih => exact .via hst hent (ih h₂ hk)

/-- Whoever could read a cap could read the cells it reaches, when the caps of every state of the history are among
    `all`, whose ids are distinct: a cap is then the same in every state. -/
theorem EverReads.cell_of_cap {sts : List State} {all : List Cap} (hn : (all.map (·.id)).Nodup)
    (hall : ∀ st ∈ sts, ∀ cp ∈ st.caps, cp ∈ all) {h : Holder} {v : VaultId} {c : CapId} {x : Cell}
    (hr : EverReads sts h (.cap v c)) (hx : x.contains c = true ∨ ∃ cp ∈ all, cp.id = c ∧ cp.wide = true) :
    EverReads sts h (.cell v x) := by
  -- in every state of the history, the cap reaches the cell
  have hx' : ∀ st ∈ sts, x.contains c = true ∨ ∀ cp ∈ st.caps, cp.id = c → cp.wide = true := by
    intro st hst
    rcases hx with hx | ⟨cp, hcp, hid, hw⟩
    · exact .inl hx
    · refine .inr fun cp' hcp' hid' => ?_
      rw [eq_of_nodup_map hn (hall st hst cp' hcp') hcp (hid'.trans hid.symm)]
      exact hw
  generalize hk : KeyFam.cap v c = kc at hr
  induction hr with
  | entitled hst hent => subst hk; exact .entitled hst (Holder.entitled_cell_of_cap hent (hx' _ hst))
  | «public» hst hpub => subst hk; exact .public hst (publicKey_cell_of_cap hpub (hx' _ hst))
  | via hst hent _ ih => exact .via hst hent (ih hk)

/-- A trace holds the state it starts from. -/
theorem mem_trace_self (st : State) : ∀ edits, st ∈ trace st edits
  | [] => List.mem_singleton_self _
  | _ :: _ => List.mem_cons_self

/-- A trace holds the state it ends in. -/
theorem replay_mem_trace : ∀ (st : State) (edits : List Edit), replay st edits ∈ trace st edits
  | _, [] => List.mem_singleton_self _
  | st, edit :: edits => List.mem_cons_of_mem _ (replay_mem_trace ((step st edit).getD st) edits)

/-- A step keeps every cap. -/
theorem caps_step (st : State) (edit : Edit) : ∀ cp ∈ st.caps, cp ∈ ((step st edit).getD st).caps := by
  intro cp hcp
  cases hs : step st edit with
  | none => exact hcp
  | some st' =>
    obtain ⟨post, hpost, rfl⟩ := step_cases hs
    obtain ⟨⟨l, hl⟩, -, -⟩ := apply_grows hpost
    show cp ∈ (settle st post).caps
    rw [(kept_settle st post).caps, hl]
    exact List.mem_append_left _ hcp

/-- Along a replay caps are only added: every cap of a state of its trace is a cap where it ends. -/
theorem caps_replay : ∀ (st : State) (edits : List Edit), ∀ x ∈ trace st edits, ∀ cp ∈ x.caps,
    cp ∈ (replay st edits).caps
  | _, [], x, hx, cp, hcp => by rw [List.mem_singleton.1 hx] at hcp; exact hcp
  | st, edit :: edits, x, hx, cp, hcp => by
    rcases List.mem_cons.1 hx with rfl | hx
    · exact caps_replay _ edits _ (mem_trace_self _ edits) cp (caps_step x edit cp hcp)
    · exact caps_replay _ edits x hx cp hcp

/-- Over the history `sts`, holder `h` could read some cell entry `e` was in. -/
def EntryRead (sts : List State) (h : Holder) (e : EntryId) : Prop :=
  ∃ st ∈ sts, ∃ en ∈ st.entries, en.id = e ∧ ∃ x ∈ en.stays.map (·.2), EverReads sts h (.cell en.vault x)

/-- Over the history `sts`, every seal and published key of `st` is justified: whoever opens what a key is sealed to
    could read the key's family, or a cell its entry was in; and a published key is of a family that was public. -/
def SealsRead (sts : List State) (st : State) : Prop :=
  (∀ s ∈ st.seals, (∀ d, s.secret ≠ .signer d) ∧
    -- a scoped key is sealed to a signer that could read its family, or under a family whose readers could read it
    (∀ a e, s.secret = .scoped a e →
      (∀ d, s.to = .signer d → EverReads sts (.signer d) a) ∧
      (∀ b e', s.to = .scoped b e' → ∀ h, EverReads sts h b → EverReads sts h a) ∧
      ∀ x σ g, s.to ≠ .entry x σ g) ∧
    -- an entry key is sealed under a cell whose readers could read a cell of the entry, or under the same entry
    ∀ x σ g, s.secret = .entry x σ g →
      (∀ d, s.to ≠ .signer d) ∧
      (∀ b e', s.to = .scoped b e' → ∀ h, EverReads sts h b → EntryRead sts h x) ∧
      ∀ x' σ' g', s.to = .entry x' σ' g' → x' = x) ∧
  ∀ x ∈ st.published, ∃ a e, x = .scoped a e ∧ ∃ st₀ ∈ sts, publicKey st₀ a = true

/-- A step whose result is part of the history keeps every seal justified: a rotation seals a key under its family's
    next key, a current key goes only to those entitled to it then, and a link stays within one entry. -/
theorem SealsRead.step {sts : List State} {all : List Cap} (hn : (all.map (·.id)).Nodup)
    (hall : ∀ st ∈ sts, ∀ cp ∈ st.caps, cp ∈ all) {st st' : State} {edit : Edit} (hinv : SealsRead sts st)
    (hsane : Sane st) (h : step st edit = some st') (hst' : st' ∈ sts) : SealsRead sts st' := by
  obtain ⟨post, hpost, rfl⟩ := step_cases h
  obtain ⟨-, hseals, hpubs⟩ := apply_keys hpost
  have hkept := kept_settle st post
  have hs' : Sane (settle st post) := hkept.sane (hsane.of_apply hpost)
  refine ⟨fun s hs => ?_, fun x hx => ?_⟩
  · rcases settle_seals hs with hs | ⟨k, e, -, -, -, rfl⟩ | ⟨k, hk, t, ht, rfl⟩ | ⟨en, hen, hl⟩
    · exact hinv.1 s (hseals ▸ hs)
    · -- a rotation seals a family's key to its own next key
      refine ⟨fun d hd => (by cases hd), fun a e' ha => ?_, fun x σ g hx => (by cases hx)⟩
      cases ha
      refine ⟨fun d hd => (by cases hd), fun b e'' hb h hr => ?_, fun x σ g hx => (by cases hx)⟩
      cases hb
      exact hr
    · -- a current key is sealed only to whoever may read it then
      have hk' : k ∈ keyFams (settle st post) := by rw [hkept.keyFams]; exact hk
      refine ⟨fun d hd => (by cases hd), fun a e' ha => ?_, fun x σ g hx => (by cases hx)⟩
      cases ha
      rcases mem_targets hs' hk' ht with ⟨d, rfl, hent⟩ | ⟨o, rfl, -, hent⟩ | ⟨v, c, x, rfl, rfl, -, hx⟩
      · refine ⟨fun d' hd => ?_, fun b e'' hb => (by cases hb), fun x σ g hx => (by cases hx)⟩
        cases hd
        exact .entitled hst' hent
      · refine ⟨fun d hd => (by cases hd), fun b e'' hb h hr => ?_, fun x σ g hx => (by cases hx)⟩
        cases hb
        exact EverReads.trans_seed hr (.entitled hst' hent)
      · refine ⟨fun d hd => (by cases hd), fun b e'' hb h hr => ?_, fun x σ g hx => (by cases hx)⟩
        cases hb
        exact EverReads.cell_of_cap hn hall hr
          (hx.imp id fun ⟨cp, hcp, hid, hw⟩ => ⟨cp, hall _ hst' cp hcp, hid, hw⟩)
    · -- linking seals an entry's keys to the keys of its stays' cells and to its own current key
      have hread : ∀ y ∈ en.stays.map (·.2), ∀ h, EverReads sts h (.cell en.vault y) → EntryRead sts h en.id :=
        fun y hy h hr => ⟨_, hst', en, hen, rfl, y, hy, hr⟩
      rcases hl with rfl | ⟨w, hw, hwe, rfl | ⟨-, rfl⟩⟩
      · refine ⟨fun d hd => (by cases hd), fun a e hae => (by cases hae), fun x σ g hx => ?_⟩
        simp only [entryKey, KeyName.entry.injEq] at hx
        obtain ⟨rfl, -, -⟩ := hx
        refine ⟨fun d hd => (by cases hd), fun b e' hb h hr => ?_, fun x' σ' g' hx' => (by cases hx')⟩
        cases hb
        exact hread _ (stay_mem (hs'.staysNe en hen)).2.1 h hr
      · refine ⟨fun d hd => (by cases hd), fun a e hae => (by cases hae), fun x σ g hx => ?_⟩
        simp only [Write.key, KeyName.entry.injEq] at hx
        obtain ⟨rfl, -, -⟩ := hx
        refine ⟨fun d hd => (by cases hd), fun b e' hb h hr => ?_, fun x' σ' g' hx' => (by cases hx')⟩
        cases hb
        rw [hwe]
        obtain ⟨y, hy⟩ := stayCell_of_mem (hs'.writeStay w hw en hen hwe.symm)
        simp only [hy, Option.getD_some] at hr
        exact hread y (List.mem_map.2 ⟨_, stayCell_mem hy, rfl⟩) h hr
      · refine ⟨fun d hd => (by cases hd), fun a e hae => (by cases hae), fun x σ g hx => ?_⟩
        simp only [Write.key, KeyName.entry.injEq] at hx
        obtain ⟨rfl, -, -⟩ := hx
        refine ⟨fun d hd => (by cases hd), fun b e' hb => (by cases hb), fun x' σ' g' hx' => ?_⟩
        simp only [entryKey, KeyName.entry.injEq] at hx'
        rw [← hx'.1, hwe]
  · rcases settle_published hx with hx | ⟨k, -, hpub, rfl⟩
    · exact hinv.2 x (hpubs ▸ hx)
    · exact ⟨k, _, rfl, _, hst', by rw [hkept.publicKey]; exact hpub⟩

/-- Along a replay whose states are all part of the history, every seal stays justified. -/
theorem sealsRead_replay {sts : List State} {all : List Cap} (hn : (all.map (·.id)).Nodup)
    (hall : ∀ st ∈ sts, ∀ cp ∈ st.caps, cp ∈ all) :
    ∀ (edits : List Edit) (st : State), (∀ x ∈ trace st edits, x ∈ sts) → Sane st →
      SealsRead sts st → SealsRead sts (replay st edits)
  | [], _, _, _, h => h
  | edit :: edits, st, htr, hs, h => by
    have htr' : ∀ x ∈ trace ((step st edit).getD st) edits, x ∈ sts := fun x hx =>
      htr x (List.mem_cons_of_mem _ hx)
    show SealsRead sts (replay ((step st edit).getD st) edits)
    cases hst : step st edit with
    | none =>
      rw [hst] at htr'
      exact sealsRead_replay hn hall edits st htr' hs h
    | some st' =>
      rw [hst] at htr'
      have h' := h.step hn hall hs hst (htr' _ (mem_trace_self _ edits))
      obtain ⟨post, hpost, rfl⟩ := step_cases hst
      exact sealsRead_replay hn hall edits _ htr' ((kept_settle st post).sane (hs.of_apply hpost)) h'

/-- Every seal along a history from the empty state is justified by it. -/
theorem sealsRead_trace (edits : List Edit) : SealsRead (trace {} edits) (replay {} edits) :=
  sealsRead_replay (keyInv_replay edits).sane.capIds (caps_replay {} edits) edits {} (fun _ hx => hx)
    keyInv_empty.sane ⟨fun _ h => (by cases h), fun _ h => (by cases h)⟩

/-- With every seal justified, a holder opens a signer's key only if it is that signer, a key of a family only if it
    could read that family, and a key of an entry only if it could read a cell the entry was in. -/
theorem knows_everReads {sts : List State} {st : State} (hst : st ∈ sts) (hinv : SealsRead sts st) {h : Holder}
    {x : KeyName} (hx : Knows st (h.start st) x) :
    (∀ d, x = .signer d → h = .signer d) ∧ (∀ k e, x = .scoped k e → EverReads sts h k) ∧
      ∀ e σ g, x = .entry e σ g → EntryRead sts h e := by
  induction hx with
  | own hx =>
    cases h with
    | signer s =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      exact ⟨fun d hd => (by cases hd; rfl), fun k e hk => (by cases hk), fun e σ g he => (by cases he)⟩
    | vault v =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      refine ⟨fun d hd => (by cases hd), fun k e hk => ?_, fun e σ g he => (by cases he)⟩
      cases hk
      exact .entitled hst (by simp [Holder.entitled, entitledV, readsV])
    | everyone => simp [Holder.start] at hx
  | published hx =>
    obtain ⟨a, e, rfl, st₀, hst₀, hpub⟩ := hinv.2 _ hx
    refine ⟨fun d hd => (by cases hd), fun k e' hk => ?_, fun e σ g he => (by cases he)⟩
    cases hk
    exact .public hst₀ hpub
  | @«unseal» s hs _ ih =>
    obtain ⟨hsig, hsc, hent⟩ := hinv.1 s hs
    rcases keyName_cases s.secret with ⟨d, hsec⟩ | ⟨a, e, hsec⟩ | ⟨y, σ, g, hsec⟩
    · exact absurd hsec (hsig d)
    · obtain ⟨hd, hb, hne⟩ := hsc a e hsec
      rw [hsec]
      refine ⟨fun d hd => (by cases hd), fun k e' hk => ?_, fun e σ g he => (by cases he)⟩
      cases hk
      rcases keyName_cases s.to with ⟨d, hto⟩ | ⟨b, e'', hto⟩ | ⟨y, τ, g', hto⟩
      · rw [ih.1 d hto]
        exact hd d hto
      · exact hb b e'' hto h (ih.2.1 b e'' hto)
      · exact absurd hto (hne y τ g')
    · obtain ⟨hd, hb, hy⟩ := hent y σ g hsec
      rw [hsec]
      refine ⟨fun d hd => (by cases hd), fun k e' hk => (by cases hk), fun e σ' g' he => ?_⟩
      cases he
      rcases keyName_cases s.to with ⟨d, hto⟩ | ⟨b, e'', hto⟩ | ⟨z, τ, g', hto⟩
      · exact absurd hto (hd d)
      · exact hb b e'' hto h (ih.2.1 b e'' hto)
      · rw [← hy z τ g' hto]
        exact ih.2.2 z τ g' hto

/-- A holder that never reads anything of another vault through the vaults whose seeds it could read, and never could
    read the seed of a family's vault, reads that family only while it is public. -/
theorem everReads_blind {sts : List State} {h : Holder} {k : KeyFam} (hr : EverReads sts h k)
    (hblind : ∀ v, EverReads sts h (.seed v) → ∀ st ∈ sts, ∀ k, readsV st v k = true → k.vault = v)
    (hk : ¬ EverReads sts h (.seed k.vault)) : ∃ st ∈ sts, publicKey st k = true := by
  induction hr with
  | @entitled h k st hst hent =>
    cases h with
    | signer s =>
      simp only [Holder.entitled, AvenDB.entitled, List.any_eq_true, Bool.and_eq_true] at hent
      obtain ⟨y, hy, hact, hread⟩ := hent
      -- the signer could read the seed of the vault it read `k` through
      have hys : EverReads sts (.signer s) (.seed y.id) := .entitled hst (by
        simp only [Holder.entitled, AvenDB.entitled, List.any_eq_true, Bool.and_eq_true]
        exact ⟨y, hy, hact, by simp [readsV]⟩)
      rw [hblind y.id hys st hst k hread] at hk
      exact absurd hys hk
    | vault w =>
      simp only [Holder.entitled, entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at hent
      rcases hent with hread | ⟨y, hy, hown, hread⟩
      · have hw : EverReads sts (.vault w) (.seed w) := .entitled hst (by simp [Holder.entitled, entitledV, readsV])
        rw [hblind w hw st hst k hread] at hk
        exact absurd hw hk
      · -- the vault could read the seed of the vault it owns that read `k`
        have hys : EverReads sts (.vault w) (.seed y.id) := .entitled hst (by
          simp only [Holder.entitled, entitledV, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true]
          exact .inr ⟨y, hy, hown, by simp [readsV]⟩)
        rw [hblind y.id hys st hst k hread] at hk
        exact absurd hys hk
    | everyone => exact ⟨st, hst, hent⟩
  | «public» hst hpub => exact ⟨_, hst, hpub⟩
  | via hst hent _ ih => exact ih (fun w hw => hblind w (.via hst hent hw)) (fun hv => hk (.via hst hent hv))

theorem T5_confidentiality (edits : List Edit) (h : Holder) (k : KeyFam) (e : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.scoped k e)) : EverReads (trace {} edits) h k :=
  -- every seal along the history is justified, from the empty state on, and opening keys follows seals
  (knows_everReads (replay_mem_trace {} edits) (sealsRead_trace edits) hk).2.1 k e rfl

theorem T6_forward_secrecy {st : State} (hr : Reachable st) (h : Holder) {k : KeyFam} (hkf : k ∈ keyFams st)
    (hk : Knows st (h.start st) (st.curKey k)) : MayOpen st h k := by
  obtain ⟨edits, rfl⟩ := hr
  exact (keyInv_replay edits).fwd h k hkf hk

theorem T7_blind_server (edits : List Edit) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} edits) (.signer srv) (.seed v) →
      ∀ st ∈ trace {} edits, ∀ k, readsV st v k = true → k.vault = v)
    {k : KeyFam} (hk : ¬ EverReads (trace {} edits) (.signer srv) (.seed k.vault)) {e : Nat}
    (h : Knows (replay {} edits) [.signer srv] (.scoped k e)) : ∃ st ∈ trace {} edits, publicKey st k = true :=
  everReads_blind (T5_confidentiality edits (.signer srv) k e h) hblind hk

theorem T24_entry_keys {st : State} (hr : Reachable st) (h : Holder) {en : Entry} (hen : en ∈ st.entries)
    (hk : Knows st (h.start st) (entryKey st en)) : MayOpen st h (.cell en.vault en.cell) := by
  obtain ⟨edits, rfl⟩ := hr
  exact (keyInv_replay edits).entry_key h hen hk

theorem T24_entry_history (edits : List Edit) (h : Holder) (e : EntryId) (s : Option EditId) (g : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.entry e s g)) :
    ∃ st ∈ trace {} edits, ∃ en ∈ st.entries, en.id = e ∧
      ∃ x ∈ en.stays.map (·.2), EverReads (trace {} edits) h (.cell en.vault x) :=
  (knows_everReads (replay_mem_trace {} edits) (sealsRead_trace edits) hk).2.2 e s g rfl

end AvenDB.Keys
