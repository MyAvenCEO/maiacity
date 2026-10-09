import AvenDB.Props

/-!
# Vaults and writes

The proofs of the theorems about vaults (T2, T3, T21 and that devices don't govern), about who writes (T1), the caps'
grantees (T4, T8), the schema lane (T17) and causal closure (T14), stated as in `Theorems.lean`.

Settling keys changes only the epochs, the seals and what is published, so a step changes everything else only through
`apply`: it adds a vault or changes one (`VaultChange`), adds a cap, an entry or a write, or drops writes and entries
(`dropUnseen`). Without cycles, `owns` finds every chain of owners, so the check in `addOwner` refuses every owner that
would close a cycle. Authorization reads only the vaults, the caps, which caps are revoked, `narrow` and the entries'
vaults and cells, so an edit that only adds to these keeps every write authorized (`Keeps`); every other edit is a
removal, and `dropUnseen` keeps a write that lost its authorization only if the removal had seen it. `dropUnseen` keeps
or drops all the entries of one id together, so no lemma here needs entry ids to be unique.
-/

namespace AvenDB.Core

/-! ## Folds, and settling keys

Settling keys changes only the epochs, the seals and what is published. -/

/-- What holds at the start of a fold and is kept by each step holds at its end. -/
theorem foldl_inv {α β : Type} (P : β → Prop) (f : β → α → β) (hf : ∀ b a, P b → P (f b a)) :
    ∀ (l : List α) (b : β), P b → P (l.foldl f b)
  | [], _, h => h
  | a :: l, b, h => foldl_inv P f hf l (f b a) (hf b a h)

/-- A fold of steps that each leave a part of the state alone leaves it alone. -/
theorem foldl_same {α β : Type} (get : State → β) (f : State → α → State) (hf : ∀ s a, get (f s a) = get s)
    (l : List α) (s : State) : get (l.foldl f s) = get s :=
  foldl_inv (fun t => get t = get s) f (fun t a h => (hf t a).trans h) l s rfl

/-- Rotating, sealing, publishing and linking keys leave alone whatever `get` reads besides the epochs, the seals and
    what is published. -/
theorem settle_same {β : Type} (get : State → β)
    (he : ∀ (st : State) es ss, get { st with epochs := es, seals := ss } = get st)
    (hs : ∀ (st : State) ss, get { st with seals := ss } = get st)
    (hp : ∀ (st : State) ps, get { st with published := ps } = get st) (pre post : State) :
    get (settle pre post) = get post := by
  have hseal : ∀ st s, get (addSeal st s) = get st := fun st s => by
    unfold addSeal
    split
    · rfl
    · exact hs _ _
  have hpub : ∀ st k, get (publish st k) = get st := fun st k => by
    unfold publish
    split
    · rfl
    · exact hp _ _
  -- linking adds seals only, entry by entry and write by write
  have hlink : ∀ st, get (linkAll st) = get st := fun st => by
    unfold linkAll
    refine foldl_same get _ (fun acc en => (foldl_same get _ (fun a w => ?_) _ _).trans (hseal _ _)) _ _
    dsimp only
    split
    · exact hseal _ _
    · rw [hseal, hseal]
  unfold settle sealAll
  rw [hlink, foldl_same get _ ?_, foldl_same get bump (fun st _ => he st _ _)]
  intro acc k
  simp only
  split
  · rw [hpub, foldl_same get _ (fun a _ => hseal a _)]
  · rw [foldl_same get _ (fun a _ => hseal a _)]

/-- Settling keys leaves the vaults alone. -/
theorem settle_vaults (pre post : State) : (settle pre post).vaults = post.vaults :=
  settle_same State.vaults (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the caps alone. -/
theorem settle_caps (pre post : State) : (settle pre post).caps = post.caps :=
  settle_same State.caps (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys revokes nothing. -/
theorem settle_revoked (pre post : State) : (settle pre post).revoked = post.revoked :=
  settle_same State.revoked (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the entries alone. -/
theorem settle_entries (pre post : State) : (settle pre post).entries = post.entries :=
  settle_same State.entries (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the writes alone. -/
theorem settle_writes (pre post : State) : (settle pre post).writes = post.writes :=
  settle_same State.writes (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the schema lane alone. -/
theorem settle_lane (pre post : State) : (settle pre post).lane = post.lane :=
  settle_same State.lane (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys narrows nothing. -/
theorem settle_narrow (pre post : State) : (settle pre post).narrow = post.narrow :=
  settle_same State.narrow (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- What holds at the start and is kept by every accepted step holds after any replay. -/
theorem replay_inv (P : State → Prop) (hstep : ∀ st st' edit, P st → step st edit = some st' → P st') :
    ∀ (edits : List Edit) (st : State), P st → P (replay st edits)
  | [], _, h => h
  | edit :: edits, st, h => by
    show P (replay ((step st edit).getD st) edits)
    cases hs : step st edit with
    | none => exact replay_inv P hstep edits st h
    | some st' => exact replay_inv P hstep edits st' (hstep st st' edit h hs)

/-! ## Looking up vaults -/

/-- Lookups only read the vaults. -/
theorem vault?_congr {st st' : State} (h : st'.vaults = st.vaults) (x : VaultId) : st'.vault? x = st.vault? x := by
  simp only [State.vault?, h]

/-- A lookup finds the vault with that id. -/
theorem vault?_id {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt) : vt.id = v := by
  simpa using List.find?_some h

/-- `setVault` replaces the vault of the same id and leaves the others. -/
theorem setVault_vault? (st : State) (vt' : Vault) (x : VaultId) :
    (setVault st vt').vault? x = (st.vault? x).map (fun y => if y.id == vt'.id then vt' else y) := by
  unfold setVault State.vault?
  simp only [List.find?_map]
  congr 2
  funext y
  simp only [Function.comp]
  split <;> simp_all

/-- `setVault` leaves the lookups of other ids alone. -/
theorem setVault_vault?_ne {st : State} {vt' : Vault} {x : VaultId} (hx : x ≠ vt'.id) :
    (setVault st vt').vault? x = st.vault? x := by
  rw [setVault_vault?]
  cases h : st.vault? x with
  | none => rfl
  | some y =>
    have := vault?_id h
    subst this
    simp [hx]

/-- `setVault` puts the new vault where the lookup found the old one. -/
theorem setVault_vault?_self {st : State} {vt' : Vault} {x : VaultId} {vt : Vault} (h : st.vault? x = some vt)
    (hid : vt'.id = x) : (setVault st vt').vault? x = some vt' := by
  rw [setVault_vault?, h]
  have := vault?_id h
  simp [this, hid]

/-- Appending a vault leaves the lookups of other ids alone. -/
theorem append_vault?_ne {st : State} {vt : Vault} {x : VaultId} (hx : x ≠ vt.id) :
    ({ st with vaults := st.vaults ++ [vt] } : State).vault? x = st.vault? x := by
  unfold State.vault?
  rw [List.find?_append]
  have : List.find? (fun y => y.id == x) [vt] = none := by
    simp only [List.find?_cons, List.find?_nil]
    have : (vt.id == x) = false := by simp only [beq_eq_false_iff_ne]; exact fun h => hx h.symm
    rw [this]
  rw [this, Option.or_none]

/-- An appended vault whose id was free is found. -/
theorem append_vault?_new {st : State} {vt : Vault} (h : st.vault? vt.id = none) :
    ({ st with vaults := st.vaults ++ [vt] } : State).vault? vt.id = some vt := by
  unfold State.vault? at *
  rw [List.find?_append, h]
  simp

/-- A vault that may own vaults exists. -/
theorem ownsVaults_isSome {st : State} {o : VaultId} (h : ownsVaults st o = true) : (st.vault? o).isSome = true := by
  unfold ownsVaults at h
  cases ho : st.vault? o with
  | none => rw [ho] at h; cases h
  | some _ => rfl

/-- A vault fits as an owner only if it exists. -/
theorem ownerFits_vault {st : State} {k : Kind} {o : VaultId} (h : ownerFits st k (.vault o) = true) :
    (st.vault? o).isSome = true := by
  cases k with
  | human => simp [ownerFits] at h
  | coop => exact ownsVaults_isSome h
  | aven => exact ownsVaults_isSome h

/-! ## What one step does to the vaults -/

/-- How an accepted edit changes an existing vault `vt` of id `v` into `vt'`, with what the edit had to carry. -/
inductive VaultChange (st : State) (sigs : List SignerId) (v : VaultId) (vt : Vault) : Vault → Prop where
  | addOwner (p : Principal) : p ∉ vt.owners → ownerFits st vt.kind p = true →
      (∀ x, p = .vault x → x ≠ v ∧ owns st v x = false) →
      approves st sigs (.vault v) = true → approves st sigs p = true →
      VaultChange st sigs v vt { vt with owners := vt.owners ++ [p] }
  | removeOwner (p : Principal) : (approves st sigs (.vault v) = true ∨ approves st sigs p = true) →
      VaultChange st sigs v vt
        { vt with owners := vt.owners.erase p, threshold := min vt.threshold (vt.owners.erase p).length }
  | setThreshold (n : Nat) : approves st sigs (.vault v) = true →
      VaultChange st sigs v vt { vt with threshold := n }
  | addDevice (d : SignerId) : vt.kind.hasDevices = true → approves st sigs (.vault v) = true → d ∈ sigs →
      VaultChange st sigs v vt { vt with devices := vt.devices ++ [d] }
  | removeDevice (d : SignerId) : (approves st sigs (.vault v) = true ∨ d ∈ sigs) →
      VaultChange st sigs v vt { vt with devices := vt.devices.erase d }
  /-- The root hands itself on, or steps down: the current root signed, and so did the new one. -/
  | setRoot (r : Option SignerId) : vt.root.any sigs.contains = true → r.all sigs.contains = true →
      VaultChange st sigs v vt { vt with root := r }

/-- A change to a vault keeps its id. -/
theorem VaultChange.id {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : vt'.id = vt.id := by
  cases h <;> rfl

/-- An accepted edit leaves the vaults as they were, appends a new one, or changes one existing vault. -/
theorem apply_vaults {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.vaults = st.vaults ∨
    (∃ v kind owners threshold root, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      rootFits kind edit.sigs root = true ∧ post.vaults = st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩]) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st edit.sigs v vt vt' ∧
      post.vaults = (setVault st vt').vaults) := by
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨⟨⟨hnone, -⟩, -⟩, ⟨hfit, hroot⟩, -, -, rfl⟩ := h
    exact .inr (.inl ⟨_, _, _, _, _, hnone, hfit, hroot, rfl⟩)
  · -- addOwner
    split at h
    · simp at h
    · rename_i v p _ _ vt hv
      simp at h
      obtain ⟨⟨hnot, hfit⟩, hcyc, ⟨hv', hp⟩, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .addOwner p hnot hfit ?_ hv' hp, rfl⟩)
      intro x hx
      subst hx
      simpa using hcyc
  · -- removeOwner
    split at h
    · simp at h
    · rename_i v p keep _ _ vt hv
      simp at h
      obtain ⟨-, happ, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .removeOwner p ?_, rfl⟩)
      cases h1 : approves st edit.sigs (.vault v)
      · exact .inr (happ h1)
      · exact .inl rfl
  · -- setThreshold
    split at h
    · simp at h
    · rename_i v n _ _ vt hv
      simp at h
      obtain ⟨⟨-, happ⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .setThreshold n happ, rfl⟩)
  · -- addDevice
    split at h
    · simp at h
    · rename_i v d _ _ vt hv
      simp at h
      obtain ⟨⟨hk, -⟩, ⟨happ, hd⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .addDevice d hk happ hd, rfl⟩)
  · -- removeDevice
    split at h
    · simp at h
    · rename_i v d keep _ _ vt hv
      simp at h
      obtain ⟨-, happ, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .removeDevice d ?_, rfl⟩)
      cases h1 : approves st edit.sigs (.vault v)
      · exact .inr (happ h1)
      · exact .inl rfl
  · -- setRoot
    split at h
    · simp at h
    · rename_i v r keep _ _ vt hv
      simp at h
      obtain ⟨⟨hroot, hnew⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .setRoot r hroot hnew, rfl⟩)
  -- every other edit leaves the vaults alone
  all_goals
    dsimp only at h
    repeat' split at h
    all_goals cases h
    all_goals exact .inl rfl

/-- What a step does to the vaults, told by lookups: nothing, a new vault with a free id and existing owners, or
    one existing vault changed as `VaultChange` says. -/
theorem step_vault? {st st' : State} {edit : Edit} (h : step st edit = some st') :
    (∀ x, st'.vault? x = st.vault? x) ∨
    (∃ v kind owners threshold root, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      rootFits kind edit.sigs root = true ∧
      ∀ x, st'.vault? x = if x = v then some ⟨v, kind, owners, threshold, [], root⟩ else st.vault? x) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st edit.sigs v vt vt' ∧
      ∀ x, st'.vault? x = if x = v then some vt' else st.vault? x) := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  have hs : ∀ x, (settle st post).vault? x = post.vault? x := vault?_congr (settle_vaults st post)
  rcases apply_vaults hpost with hv | ⟨v, kind, owners, threshold, root, hnone, hfit, hroot, hv⟩ |
    ⟨v, vt, vt', hvt, hch, hv⟩
  · exact .inl fun x => by rw [hs, vault?_congr hv]
  · refine .inr (.inl ⟨v, kind, owners, threshold, root, hnone, hfit, hroot, fun x => ?_⟩)
    rw [hs, vault?_congr (st := { st with vaults := st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩] }) hv]
    split
    · subst x; exact append_vault?_new hnone
    · exact append_vault?_ne ‹_›
  · refine .inr (.inr ⟨v, vt, vt', hvt, hch, fun x => ?_⟩)
    rw [hs, vault?_congr hv]
    have hid : vt'.id = v := (hch.id).trans (vault?_id hvt)
    split
    · subst x; exact setVault_vault?_self hvt hid
    · exact setVault_vault?_ne (by rw [hid]; assumption)

/-- After a step, a vault that existed is as it was, or changed as `VaultChange` says. -/
theorem step_vault?_old {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') : vt' = vt ∨ VaultChange st edit.sigs v vt vt' := by
  rcases step_vault? h with hsame | ⟨w, _, _, _, _, hw, -, -, hlook⟩ | ⟨w, vtw, vtw', hw, hch, hlook⟩
  · rw [hsame, h₁] at h₂
    exact .inl (Option.some.inj h₂).symm
  · have hvw : v ≠ w := fun e => by rw [e, hw] at h₁; cases h₁
    rw [hlook, ite_eq_right hvw, h₁] at h₂
    exact .inl (Option.some.inj h₂).symm
  · by_cases hvw : v = w
    · subst hvw
      rw [hlook, ite_eq_left rfl] at h₂
      rw [h₁] at hw
      cases Option.some.inj hw
      cases Option.some.inj h₂
      exact .inr hch
    · rw [hlook, ite_eq_right hvw, h₁] at h₂
      exact .inl (Option.some.inj h₂).symm

/-! ## Chains of owners -/

/-- Vault `a` is listed as an owner of vault `x`. -/
def OwnerOf (st : State) (a x : VaultId) : Prop := ∃ vt, st.vault? x = some vt ∧ Principal.vault a ∈ vt.owners

/-- A chain of owners from `a` down to `x`, listing the vaults it passes through, `x` first. -/
inductive OwnerChain (st : State) (a : VaultId) : VaultId → List VaultId → Prop where
  | one {x : VaultId} : OwnerOf st a x → OwnerChain st a x [x]
  | cons {b x : VaultId} {ys : List VaultId} : OwnerOf st b x → OwnerChain st a b ys → OwnerChain st a x (x :: ys)

/-- Every chain of owners can be listed. -/
theorem OwnerChain.of_transGen {st : State} {a x : VaultId} (h : Relation.TransGen (OwnerOf st) a x) :
    ∃ ys, OwnerChain st a x ys := by
  induction h with
  | single hax => exact ⟨_, .one hax⟩
  | tail _ hbc ih =>
    obtain ⟨ys, hp⟩ := ih
    exact ⟨_, .cons hbc hp⟩

/-- Every vault on a chain down to `x` is `x` or owns `x`. -/
theorem OwnerChain.owns_mem {st : State} {a x : VaultId} {ys : List VaultId} (hp : OwnerChain st a x ys) {y : VaultId}
    (hy : y ∈ ys) : y = x ∨ Relation.TransGen (OwnerOf st) y x := by
  induction hp with
  | one _ =>
    simp at hy
    exact .inl hy
  | cons hbx _ ih =>
    rcases List.mem_cons.1 hy with rfl | hy
    · exact .inl rfl
    · rcases ih hy with rfl | hyb
      · exact .inr (.single hbx)
      · exact .inr (.tail hyb hbx)

/-- Without cycles, a chain never passes a vault twice. -/
theorem OwnerChain.nodup {st : State} (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y) {a x : VaultId}
    {ys : List VaultId} (hp : OwnerChain st a x ys) : ys.Nodup := by
  induction hp with
  | one _ => simp
  | cons hbx hp ih =>
    refine List.nodup_cons.2 ⟨fun hx => ?_, ih⟩
    rcases hp.owns_mem hx with rfl | hxb
    · exact hacyc _ (.single hbx)
    · exact hacyc _ (.tail hxb hbx)

/-- A vault with an owner exists. -/
theorem OwnerOf.mem_ids {st : State} {b x : VaultId} (h : OwnerOf st b x) : x ∈ st.vaults.map (·.id) := by
  obtain ⟨vt, hx, _⟩ := h
  exact List.mem_map.2 ⟨vt, List.mem_of_find?_eq_some hx, vault?_id hx⟩

/-- Every vault on a chain exists. -/
theorem OwnerChain.mem_ids {st : State} {a x : VaultId} {ys : List VaultId} (hp : OwnerChain st a x ys) {y : VaultId}
    (hy : y ∈ ys) : y ∈ st.vaults.map (·.id) := by
  induction hp with
  | one hax =>
    simp at hy
    subst hy
    exact hax.mem_ids
  | cons hbx _ ih =>
    rcases List.mem_cons.1 hy with rfl | hy
    · exact hbx.mem_ids
    · exact ih hy

/-- A list without duplicates whose members all lie in `m` is no longer than `m`. -/
theorem length_le_of_nodup {α : Type} [BEq α] [LawfulBEq α] :
    ∀ {l m : List α}, l.Nodup → (∀ y ∈ l, y ∈ m) → l.length ≤ m.length
  | [], _, _, _ => by simp
  | y :: l, m, hnd, hsub => by
    rw [List.nodup_cons] at hnd
    have hy : y ∈ m := hsub y List.mem_cons_self
    have hle := length_le_of_nodup (m := m.erase y) hnd.2 fun z hz =>
      (List.mem_erase_of_ne fun (h : z = y) => hnd.1 (h ▸ hz)).2 (hsub z (List.mem_cons.2 (.inr hz)))
    rw [List.length_erase_of_mem hy] at hle
    have := List.length_pos_of_mem hy
    simp only [List.length_cons]
    omega

/-- A chain of length at most `n` is found by `ownsN` with fuel `n`. -/
theorem OwnerChain.ownsN {st : State} {a x : VaultId} {ys : List VaultId} (hp : OwnerChain st a x ys) :
    ∀ {n : Nat}, ys.length ≤ n → ownsN st a n x = true := by
  induction hp with
  | one hax =>
    intro n hn
    obtain ⟨vt, hx, ha⟩ := hax
    match n, hn with
    | n + 1, _ =>
      simp only [AvenDB.ownsN, hx]
      exact List.any_eq_true.2 ⟨_, ha, by simp⟩
  | cons hbx _ ih =>
    intro n hn
    obtain ⟨vt, hx, hb⟩ := hbx
    match n, hn with
    | n + 1, hn =>
      simp only [AvenDB.ownsN, hx]
      exact List.any_eq_true.2 ⟨_, hb, by simp [ih (by simp at hn; omega)]⟩

/-- Completeness of the cycle check: without cycles, `owns` finds every chain of owners. -/
theorem owns_of_transGen {st : State} (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y) {a x : VaultId}
    (h : Relation.TransGen (OwnerOf st) a x) : owns st a x = true := by
  obtain ⟨ys, hp⟩ := OwnerChain.of_transGen h
  apply hp.ownsN
  have hle := length_le_of_nodup (hp.nodup hacyc) fun y hy => hp.mem_ids hy
  simp only [List.length_map] at hle
  unfold State.depth
  omega

/-! ## One step keeps the owner graph acyclic -/

/-- Fewer edges, fewer chains. -/
theorem transGen_mono {α : Sort _} {r s : α → α → Prop} (hrs : ∀ a b, r a b → s a b) {a b : α}
    (h : Relation.TransGen r a b) : Relation.TransGen s a b := by
  induction h with
  | single hab => exact .single (hrs _ _ hab)
  | tail _ hbc ih => exact .tail ih (hrs _ _ hbc)

/-- A chain starts with an edge. -/
theorem transGen_head {α : Sort _} {r : α → α → Prop} {a b : α} (h : Relation.TransGen r a b) : ∃ c, r a c := by
  induction h with
  | single hab => exact ⟨_, hab⟩
  | tail _ _ ih => exact ih

/-- Adding the edge `x → w` to `r` adds only chains through it: from `x` or something above it, to `w` or
    something below it. -/
theorem transGen_split {α : Sort _} {r r' : α → α → Prop} {x w : α} (hr : ∀ a b, r' a b → r a b ∨ (a = x ∧ b = w))
    {a b : α} (h : Relation.TransGen r' a b) :
    Relation.TransGen r a b ∨ ((a = x ∨ Relation.TransGen r a x) ∧ (b = w ∨ Relation.TransGen r w b)) := by
  induction h with
  | single hab =>
    rcases hr _ _ hab with h | ⟨rfl, rfl⟩
    · exact .inl (.single h)
    · exact .inr ⟨.inl rfl, .inl rfl⟩
  | tail _ hbc ih =>
    rcases hr _ _ hbc with h | ⟨rfl, rfl⟩
    · rcases ih with ih | ⟨ha, hb⟩
      · exact .inl (.tail ih h)
      · refine .inr ⟨ha, .inr ?_⟩
        rcases hb with rfl | hb
        · exact .single h
        · exact .tail hb h
    · rcases ih with ih | ⟨ha, _⟩
      · exact .inr ⟨.inr ih, .inl rfl⟩
      · exact .inr ⟨ha, .inl rfl⟩

/-- Adding edges into a `v` that has none out of it adds no chain ending elsewhere. -/
theorem transGen_fresh {α : Sort _} {r r' : α → α → Prop} {v : α} (hr : ∀ a b, r' a b → b ≠ v → r a b)
    (hv : ∀ b, ¬ r' v b) {a b : α} (h : Relation.TransGen r' a b) (hb : b ≠ v) : Relation.TransGen r a b := by
  induction h with
  | single hab => exact .single (hr _ _ hab hb)
  | @tail m c _ hmc ih =>
    have hm : m ≠ v := fun e => hv c (e ▸ hmc)
    exact .tail (ih hm) (hr _ _ hmc hb)

/-- One step keeps the owner graph free of cycles, and every vault named as an owner existing. -/
theorem step_owners {st st' : State} {edit : Edit}
    (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y)
    (hex : ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome)
    (h : step st edit = some st') :
    (∀ y, ¬ Relation.TransGen (OwnerOf st') y y) ∧
    (∀ x vt, st'.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st'.vault? o).isSome) := by
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, hnone, hfit, -, hlook⟩ |
    ⟨v, vt, vt', hvt, hch, hlook⟩
  · -- every lookup is as before
    have hsub : ∀ a b, OwnerOf st' a b → OwnerOf st a b := fun a b ⟨u, hu, ha⟩ => ⟨u, hsame b ▸ hu, ha⟩
    refine ⟨fun y hy => hacyc y (transGen_mono hsub hy), fun x u hx o ho => ?_⟩
    rw [hsame] at hx ⊢
    exact hex x u hx o ho
  · -- genesis of a new vault `v`: it owns nothing, so every chain ending elsewhere is old
    have hold : ∀ x, x ≠ v → st'.vault? x = st.vault? x := fun x hx => by rw [hlook, ite_eq_right hx]
    have hnew : st'.vault? v = some ⟨v, kind, owners, threshold, [], root⟩ := by rw [hlook, ite_eq_left rfl]
    have hsome : ∀ o, (st.vault? o).isSome → (st'.vault? o).isSome := by
      intro o ho
      by_cases hov : o = v
      · subst hov; rw [hnew]; rfl
      · rw [hold o hov]; exact ho
    have hr : ∀ a b, OwnerOf st' a b → b ≠ v → OwnerOf st a b :=
      fun a b ⟨u, hu, ha⟩ hb => ⟨u, hold b hb ▸ hu, ha⟩
    have hv : ∀ b, ¬ OwnerOf st' v b := by
      intro b ⟨u, hu, hvu⟩
      by_cases hbv : b = v
      · subst hbv
        rw [hnew] at hu
        cases hu
        have := ownerFits_vault (hfit _ hvu)
        rw [hnone] at this
        exact Bool.noConfusion this
      · rw [hold b hbv] at hu
        have := hex b u hu v hvu
        rw [hnone] at this
        exact Bool.noConfusion this
    refine ⟨fun y hy => ?_, fun x u hx o ho => ?_⟩
    · by_cases hyv : y = v
      · subst hyv
        obtain ⟨c, hc⟩ := transGen_head hy
        exact hv c hc
      · exact hacyc y (transGen_fresh hr hv hy hyv)
    · by_cases hxv : x = v
      · subst hxv
        rw [hnew] at hx
        cases hx
        exact hsome o (ownerFits_vault (hfit _ ho))
      · rw [hold x hxv] at hx
        exact hsome o (hex x u hx o ho)
  · -- a change to the existing vault `v`
    have hold : ∀ x, x ≠ v → st'.vault? x = st.vault? x := fun x hx => by rw [hlook, ite_eq_right hx]
    have hnew : st'.vault? v = some vt' := by rw [hlook, ite_eq_left rfl]
    have hsome : ∀ o, (st.vault? o).isSome → (st'.vault? o).isSome := by
      intro o ho
      by_cases hov : o = v
      · subst hov; rw [hnew]; rfl
      · rw [hold o hov]; exact ho
    -- every vault `vt'` lists exists: the old owners did, and a new one must
    have hown : ∀ o, Principal.vault o ∈ vt'.owners → (st.vault? o).isSome := by
      intro o ho
      cases hch with
      | addOwner p _ hfit _ _ _ =>
        rcases List.mem_append.1 ho with ho | ho
        · exact hex _ _ hvt _ ho
        · rw [List.mem_singleton] at ho; subst ho; exact ownerFits_vault hfit
      | removeOwner p _ => exact hex _ _ hvt _ (List.mem_of_mem_erase ho)
      | setThreshold _ _ => exact hex _ _ hvt _ ho
      | addDevice _ _ _ _ => exact hex _ _ hvt _ ho
      | removeDevice _ _ => exact hex _ _ hvt _ ho
      | setRoot _ _ _ => exact hex _ _ hvt _ ho
    -- the only new edges point into `v`, from vaults `vt'` lists and `vt` didn't
    have hedge : ∀ a b, OwnerOf st' a b →
        OwnerOf st a b ∨ (b = v ∧ Principal.vault a ∈ vt'.owners ∧ Principal.vault a ∉ vt.owners) := by
      intro a b ⟨u, hu, ha⟩
      by_cases hbv : b = v
      · subst hbv
        rw [hnew] at hu
        cases hu
        by_cases hav : Principal.vault a ∈ vt.owners
        · exact .inl ⟨vt, hvt, hav⟩
        · exact .inr ⟨rfl, ha, hav⟩
      · exact .inl ⟨u, hold b hbv ▸ hu, ha⟩
    -- when no vault is added as an owner, every edge is old
    have hmono : (∀ a, Principal.vault a ∈ vt'.owners → Principal.vault a ∈ vt.owners) →
        ∀ y, ¬ Relation.TransGen (OwnerOf st') y y := by
      intro hsub y hy
      refine hacyc y (transGen_mono (fun a b hab => ?_) hy)
      rcases hedge a b hab with h | ⟨_, ha, hna⟩
      · exact h
      · exact absurd (hsub _ ha) hna
    refine ⟨?_, fun x u hx o ho => ?_⟩
    · cases hch with
      | addOwner p _ _ hcyc _ _ =>
        cases p with
        | signer s =>
          refine hmono fun a ha => ?_
          rcases List.mem_append.1 ha with ha | ha
          · exact ha
          · simp at ha
        | vault x =>
          -- a new cycle would run through the new edge `x → v`, so `v` would already own `x`
          have hsplit : ∀ a b, OwnerOf st' a b → OwnerOf st a b ∨ (a = x ∧ b = v) := by
            intro a b hab
            rcases hedge a b hab with h | ⟨rfl, ha, hna⟩
            · exact .inl h
            · rcases List.mem_append.1 ha with ha | ha
              · exact absurd ha hna
              · simp at ha
                exact .inr ⟨ha, rfl⟩
          intro y hy
          obtain ⟨hxv, hnown⟩ := hcyc x rfl
          have hvx : Relation.TransGen (OwnerOf st) v x := by
            rcases transGen_split hsplit hy with h | ⟨h1 | h1, h2 | h2⟩
            · exact absurd h (hacyc y)
            · exact absurd (h1.symm.trans h2) hxv
            · subst h1; exact h2
            · subst h2; exact h1
            · exact h2.trans h1
          rw [owns_of_transGen hacyc hvx] at hnown
          exact Bool.noConfusion hnown
      | removeOwner p _ => exact hmono fun a ha => List.mem_of_mem_erase ha
      | setThreshold _ _ => exact hmono fun a ha => ha
      | addDevice _ _ _ _ => exact hmono fun a ha => ha
      | removeDevice _ _ => exact hmono fun a ha => ha
      | setRoot _ _ _ => exact hmono fun a ha => ha
    · by_cases hxv : x = v
      · subst hxv
        rw [hnew] at hx
        cases hx
        exact hsome o (hown o ho)
      · rw [hold x hxv] at hx
        exact hsome o (hex x u hx o ho)

/-- `OwnsPlus` is a chain of `OwnerOf` links, the form the lemmas above work with. -/
theorem ownsPlus_iff {st : State} {a x : VaultId} : OwnsPlus st a x ↔ Relation.TransGen (OwnerOf st) a x := by
  constructor
  · intro h
    induction h with
    | direct hx ha => exact .single ⟨_, hx, ha⟩
    | trans _ _ ih₁ ih₂ => exact ih₁.trans ih₂
  · intro h
    induction h with
    | single hax =>
      obtain ⟨_, hx, ha⟩ := hax
      exact .direct hx ha
    | tail _ hbc ih =>
      obtain ⟨_, hx, hb⟩ := hbc
      exact .trans ih (.direct hx hb)

/-- One step keeps the vault graph acyclic and every named owner existing. -/
theorem T3_step {st st' : State} {edit : Edit} (hacyc : Acyclic st) (hex : OwnersExist st)
    (h : step st edit = some st') : Acyclic st' ∧ OwnersExist st' := by
  obtain ⟨hacyc', hex'⟩ := step_owners (fun y hy => hacyc y (ownsPlus_iff.2 hy)) hex h
  exact ⟨fun y hy => hacyc' y (ownsPlus_iff.1 hy), hex'⟩

/-! ## Vault kinds -/

/-- A change to a vault keeps its kind. -/
theorem VaultChange.kind {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : vt'.kind = vt.kind := by
  cases h <;> rfl

/-- After a step every vault that existed still does, of the same kind. -/
theorem step_kinds {st st' : State} {edit : Edit} (h : step st edit = some st') {o : VaultId} {ot : Vault}
    (ho : st.vault? o = some ot) : ∃ ot', st'.vault? o = some ot' ∧ ot'.kind = ot.kind := by
  rcases step_vault? h with hsame | ⟨v, _, _, _, _, hnone, -, -, hlook⟩ | ⟨v, vt, vt', hvt, hch, hlook⟩
  · exact ⟨ot, by rw [hsame]; exact ho, rfl⟩
  · have hov : o ≠ v := fun e => by rw [e, hnone] at ho; cases ho
    exact ⟨ot, by rw [hlook, ite_eq_right hov]; exact ho, rfl⟩
  · by_cases hov : o = v
    · subst hov
      rw [ho] at hvt
      cases hvt
      exact ⟨vt', by rw [hlook, ite_eq_left rfl], hch.kind⟩
    · exact ⟨ot, by rw [hlook, ite_eq_right hov]; exact ho, rfl⟩

/-- An owner that fits before a step still fits after it: vaults stay, and keep their kinds. -/
theorem ownerFits_step {st st' : State} {edit : Edit} (h : step st edit = some st') {k : Kind} {p : Principal}
    (hp : ownerFits st k p = true) : ownerFits st' k p = true := by
  have hown : ∀ o, ownsVaults st o = true → ownsVaults st' o = true := fun o ho => by
    unfold ownsVaults at ho ⊢
    cases hv : st.vault? o with
    | none => rw [hv] at ho; cases ho
    | some ot =>
      rw [hv] at ho
      obtain ⟨ot', hv', hk⟩ := step_kinds h hv
      rw [hv']
      dsimp only at ho ⊢
      rw [hk]
      exact ho
  cases k <;> cases p <;> simp only [ownerFits] at hp ⊢ <;> first | exact hp | exact hown _ hp

/-- One step keeps every vault the shape of its kind. -/
theorem kindsFit_step {st st' : State} {edit : Edit} (hk : KindsFit st) (h : step st edit = some st') :
    KindsFit st' := by
  intro x u hx
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, -, hfit, hroot, hlook⟩ |
    ⟨v, vt, vt', hvt, hch, hlook⟩
  · rw [hsame] at hx
    obtain ⟨ho, hd, hr⟩ := hk x u hx
    exact ⟨fun p hp => ownerFits_step h (ho p hp), hd, hr⟩
  · rw [hlook] at hx
    split at hx
    · -- the new vault: its owners fit, it has no devices yet, and only a human vault names a root
      cases hx
      refine ⟨fun p hp => ownerFits_step h (hfit p hp), fun hd => absurd rfl hd, fun hr => ?_⟩
      cases hroot' : root with
      | none => exact absurd hroot' hr
      | some r =>
        rw [hroot'] at hroot
        simp only [rootFits, Bool.and_eq_true, beq_iff_eq] at hroot
        exact hroot.1
    · obtain ⟨ho, hd, hr⟩ := hk x u hx
      exact ⟨fun p hp => ownerFits_step h (ho p hp), hd, hr⟩
  · rw [hlook] at hx
    split at hx
    · cases hx
      obtain ⟨ho, hd, hr⟩ := hk v vt hvt
      cases hch with
      | addOwner p _ hfit _ _ _ =>
        refine ⟨fun q hq => ?_, hd, hr⟩
        rcases List.mem_append.1 hq with hq | hq
        · exact ownerFits_step h (ho q hq)
        · rw [List.mem_singleton] at hq
          subst hq
          exact ownerFits_step h hfit
      | removeOwner p _ => exact ⟨fun q hq => ownerFits_step h (ho q (List.mem_of_mem_erase hq)), hd, hr⟩
      | setThreshold _ _ => exact ⟨fun q hq => ownerFits_step h (ho q hq), hd, hr⟩
      | addDevice _ hkd _ _ => exact ⟨fun q hq => ownerFits_step h (ho q hq), fun _ => hkd, hr⟩
      | removeDevice d _ =>
        refine ⟨fun q hq => ownerFits_step h (ho q hq), fun hne => hd fun hnil => hne ?_, hr⟩
        simp [hnil]
      | setRoot r hold _ =>
        refine ⟨fun q hq => ownerFits_step h (ho q hq), hd, fun _ => hr fun hnone => ?_⟩
        simp [hnone] at hold
    · obtain ⟨ho, hd, hr⟩ := hk x u hx
      exact ⟨fun p hp => ownerFits_step h (ho p hp), hd, hr⟩

/-! ## Looking up entries -/

/-- A lookup finds the entry with that id. -/
theorem entry?_id {st : State} {e : EntryId} {en : Entry} (h : st.entry? e = some en) : en.id = e := by
  simpa using List.find?_some h

/-- A lookup finds an entry of the state. -/
theorem entry?_mem {st : State} {e : EntryId} {en : Entry} (h : st.entry? e = some en) : en ∈ st.entries :=
  List.mem_of_find?_eq_some h

/-- Every entry's id finds an entry (the first with that id). -/
theorem entry?_of_mem {st : State} {en : Entry} (h : en ∈ st.entries) : ∃ x, st.entry? en.id = some x :=
  Option.isSome_iff_exists.1 (List.find?_isSome.2 ⟨en, h, by simp⟩)

/-- `setEntry` replaces the entries of the same id and leaves the others. -/
theorem setEntry_entry? (st : State) (en' : Entry) (e : EntryId) :
    (setEntry st en').entry? e = (st.entry? e).map (fun y => if y.id == en'.id then en' else y) := by
  unfold setEntry State.entry?
  simp only [List.find?_map]
  congr 2
  funext y
  simp only [Function.comp]
  split <;> simp_all

/-- `setEntry` keeps every entry's id. -/
theorem setEntry_ids (st : State) (en' : Entry) : ∀ y ∈ (setEntry st en').entries, ∃ x ∈ st.entries, x.id = y.id := by
  intro y hy
  obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hy
  refine ⟨x, hx, ?_⟩
  split
  · rename_i h
    exact beq_iff_eq.1 h
  · rfl

/-! ## What authorization reads

`authorized` reads the vaults (who acts for which), the caps, which of them are revoked, `narrow`, the entries (their
vault) and the cell each write was accepted in, and never the other writes, the thresholds, the roots or the keys. A
state that keeps all of these keeps every write authorized. -/

/-- `st'` keeps what `authorized` reads in `st`: every vault with its owners and devices, every cap, no cap revoked or
    cell narrowed that wasn't, and every entry with its vault and cell. -/
structure Keeps (st st' : State) : Prop where
  vaults : ∀ x vt, st.vault? x = some vt → ∃ vt', st'.vault? x = some vt' ∧
    (∀ p ∈ vt.owners, p ∈ vt'.owners) ∧ ∀ d ∈ vt.devices, d ∈ vt'.devices
  caps : ∀ c ∈ st.caps, c ∈ st'.caps
  revoked : ∀ c ∈ st'.revoked, c ∈ st.revoked
  narrow : ∀ x ∈ st'.narrow, x ∈ st.narrow
  entries : ∀ e en, st.entry? e = some en → ∃ en', st'.entry? e = some en' ∧ en'.vault = en.vault ∧ en'.cell = en.cell

/-- Keeping what `authorized` reads is transitive. -/
theorem Keeps.trans {a b c : State} (h₁ : Keeps a b) (h₂ : Keeps b c) : Keeps a c where
  vaults x vt hx := by
    obtain ⟨vt₁, hx₁, ho₁, hd₁⟩ := h₁.vaults x vt hx
    obtain ⟨vt₂, hx₂, ho₂, hd₂⟩ := h₂.vaults x vt₁ hx₁
    exact ⟨vt₂, hx₂, fun p hp => ho₂ p (ho₁ p hp), fun d hd => hd₂ d (hd₁ d hd)⟩
  caps c hc := h₂.caps c (h₁.caps c hc)
  revoked c hc := h₁.revoked c (h₂.revoked c hc)
  narrow x hx := h₁.narrow x (h₂.narrow x hx)
  entries e en h := by
    obtain ⟨en₁, h₁', hv₁, hc₁⟩ := h₁.entries e en h
    obtain ⟨en₂, h₂', hv₂, hc₂⟩ := h₂.entries e en₁ h₁'
    exact ⟨en₂, h₂', hv₂.trans hv₁, hc₂.trans hc₁⟩

/-- A state that changes none of what `authorized` reads but the entries, whose lookups it keeps, keeps it all. -/
theorem Keeps.of_entries {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow)
    (he : ∀ e en, st.entry? e = some en → st'.entry? e = some en) : Keeps st st' where
  vaults x vt hx := ⟨vt, by rw [vault?_congr hv]; exact hx, fun _ h => h, fun _ h => h⟩
  caps _ h := hc ▸ h
  revoked _ h := hr ▸ h
  narrow _ h := hn ▸ h
  entries e en h := ⟨en, he e en h, rfl, rfl⟩

/-- A state that changes none of what `authorized` reads keeps it. -/
theorem Keeps.of_eq {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow) (he : st'.entries = st.entries) : Keeps st st' :=
  .of_entries hv hc hr hn fun e en h => by simp only [State.entry?, he]; exact h

/-- Settling keys keeps everything. -/
theorem Keeps.settle (pre post : State) : Keeps post (settle pre post) :=
  .of_eq (settle_vaults pre post) (settle_caps pre post) (settle_revoked pre post) (settle_narrow pre post)
    (settle_entries pre post)

/-- A new vault keeps the others. -/
theorem Keeps.addVault (st : State) (vt : Vault) : Keeps st { st with vaults := st.vaults ++ [vt] } where
  vaults x y hy := ⟨y, by simp only [State.vault?, List.find?_append] at hy ⊢; rw [hy]; rfl,
    fun _ h => h, fun _ h => h⟩
  caps _ h := h
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- Changing one vault keeps the vaults when its owners and devices only grow. -/
theorem Keeps.setVault {st : State} {v : VaultId} {vt vt' : Vault} (hv : st.vault? v = some vt)
    (hid : vt'.id = vt.id) (ho : ∀ p ∈ vt.owners, p ∈ vt'.owners) (hd : ∀ d ∈ vt.devices, d ∈ vt'.devices) :
    Keeps st (setVault st vt') where
  vaults x y hy := by
    rw [setVault_vault?, hy]
    by_cases hyv : y.id = vt'.id
    · -- the changed vault
      have hx : x = v := by rw [← vault?_id hy, hyv, hid, vault?_id hv]
      subst hx
      rw [hv] at hy
      cases hy
      exact ⟨vt', by simp [hyv], ho, hd⟩
    · exact ⟨y, by simp [hyv], fun _ h => h, fun _ h => h⟩
  caps _ h := h
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- A new cap keeps the others. -/
theorem Keeps.addCap (st : State) (c : Cap) : Keeps st { st with caps := st.caps ++ [c] } where
  vaults _ vt hx := ⟨vt, hx, fun _ h => h, fun _ h => h⟩
  caps _ h := List.mem_append_left _ h
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- Changing an entry keeps the entries when it keeps its vault and its cell. -/
theorem Keeps.setEntry {st : State} {en en' : Entry} (hen : st.entry? en'.id = some en) (hv : en'.vault = en.vault)
    (hc : en'.cell = en.cell) : Keeps st (setEntry st en') where
  vaults _ vt hx := ⟨vt, hx, fun _ h => h, fun _ h => h⟩
  caps _ h := h
  revoked _ h := h
  narrow _ h := h
  entries e y hy := by
    rw [setEntry_entry?, hy]
    by_cases hid : y.id = en'.id
    · -- the changed entry: the lookup of its id found `en`
      have hye : e = en'.id := (entry?_id hy).symm.trans hid
      subst hye
      rw [hen] at hy
      cases hy
      exact ⟨en', by simp [hid], hv, hc⟩
    · exact ⟨y, by simp [hid], rfl, rfl⟩

/-- A state that keeps the entries keeps every id. -/
theorem Keeps.mem_entries {st st' : State} (hk : Keeps st st') {en : Entry} (hen : en ∈ st.entries) :
    ∃ en' ∈ st'.entries, en'.id = en.id := by
  obtain ⟨x, hx⟩ := entry?_of_mem hen
  obtain ⟨en', he', -, -⟩ := hk.entries _ x hx
  exact ⟨en', entry?_mem he', entry?_id he'⟩

/-- A state that keeps the vaults keeps every member. -/
theorem member_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} {v : VaultId}
    (h : member st s v = true) : member st' s v = true := by
  unfold member at h ⊢
  cases hv : st.vault? v with
  | none => rw [hv] at h; cases h
  | some vt =>
    obtain ⟨vt', hv', ho, hd⟩ := hk.vaults v vt hv
    rw [hv] at h
    rw [hv']
    simp only [Bool.or_eq_true, List.contains_iff_mem] at h ⊢
    exact h.imp (hd s) (ho _)

/-- A state that keeps the vaults keeps every owner. -/
theorem ownerOf_keeps {st st' : State} (hk : Keeps st st') {o v : VaultId}
    (h : ownerOf st o v = true) : ownerOf st' o v = true := by
  unfold ownerOf at h ⊢
  cases hv : st.vault? v with
  | none => rw [hv] at h; cases h
  | some vt =>
    obtain ⟨vt', hv', ho, -⟩ := hk.vaults v vt hv
    rw [hv] at h
    rw [hv']
    simp only [List.contains_iff_mem] at h ⊢
    exact ho _ h

/-- A state that keeps the vaults keeps every chain an edit names. -/
theorem actsVia_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} :
    ∀ {via : List VaultId} {v : VaultId}, actsVia st s via v = true → actsVia st' s via v = true
  | [], _, h => member_keeps hk h
  | o :: via, v, h => by
    simp only [actsVia, Bool.and_eq_true] at h ⊢
    exact ⟨ownerOf_keeps hk h.1, actsVia_keeps hk h.2⟩

/-- A state that keeps the caps and revokes none keeps every cap held. -/
theorem holdsCap_keeps {st st' : State} (hk : Keeps st st') {a : VaultId} {cp : Cap} {r : Role}
    (hcp : cp ∈ st.caps) (h : holdsCap st a cp r = true) : holdsCap st' a cp r = true := by
  unfold holdsCap State.live at h ⊢
  simp only [Bool.and_eq_true, Bool.not_eq_true', List.any_eq_true, beq_iff_eq] at h ⊢
  obtain ⟨⟨⟨-, hrev⟩, hg⟩, hr⟩ := h
  refine ⟨⟨⟨⟨cp, hk.caps cp hcp, rfl⟩, ?_⟩, hg⟩, hr⟩
  cases hc : st'.revoked.contains cp.id with
  | false => rfl
  | true =>
    rw [List.contains_iff_mem] at hc
    have := List.contains_iff_mem.2 (hk.revoked _ hc)
    rw [hrev] at this
    cases this

/-- A state that narrows no cell keeps every cap reaching an entry that keeps its vault, id and cell. -/
theorem inCell_keeps {st st' : State} (hk : Keeps st st') {cp : Cap} {en en' : Entry} (hid : en'.id = en.id)
    (hv : en'.vault = en.vault) (hc : en'.cell = en.cell) (h : inCell st cp en = true) : inCell st' cp en' = true := by
  unfold inCell at h ⊢
  rw [hid, hv, hc]
  simp only [Bool.and_eq_true, Bool.or_eq_true, List.all_eq_true] at h ⊢
  refine ⟨h.1, h.2.imp id fun h' => ⟨h'.1, fun x hx => h'.2 x (hk.narrow x hx)⟩⟩

/-- A state that keeps what `authorized` reads keeps every write authorized. -/
theorem authorized_keeps {st st' : State} (hk : Keeps st st') {w : Write} (h : authorized st w = true) :
    authorized st' w = true := by
  unfold authorized at h ⊢
  rw [Bool.and_eq_true] at h ⊢
  refine ⟨actsVia_keeps hk h.1, ?_⟩
  cases he : st.entry? w.entry with
  | none => rw [he] at h; exact absurd h.2 (by simp)
  | some en =>
    rw [he] at h
    obtain ⟨en', he', hv, -⟩ := hk.entries _ en he
    rw [he']
    dsimp only at h ⊢
    have hid : en'.id = en.id := (entry?_id he').trans (entry?_id he).symm
    unfold mayWrite at h ⊢
    simp only [Bool.or_eq_true, beq_iff_eq, List.any_eq_true, Bool.and_eq_true] at h ⊢
    exact h.2.imp (fun h => h.trans hv.symm) fun ⟨cp, hcp, hh, hin⟩ =>
      ⟨cp, hk.caps cp hcp, holdsCap_keeps hk hcp hh,
        inCell_keeps (en := { en with stays := [(w.stay, w.cell)] }) (en' := { en' with stays := [(w.stay, w.cell)] })
          hk hid hv rfl hin⟩

/-- Who acts for which vault reads only the vaults. -/
theorem actsVia_congr {st st' : State} (hv : st'.vaults = st.vaults) (s : SignerId) :
    ∀ via v, actsVia st' s via v = actsVia st s via v
  | [], v => by simp only [actsVia, member, vault?_congr hv]
  | o :: via, v => by simp only [actsVia, ownerOf, vault?_congr hv, actsVia_congr hv s via o]

/-- Authorization reads only the vaults, the caps, which are revoked, `narrow` and the write's entry. -/
theorem authorized_congr {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.caps = st.caps)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow) {w : Write}
    (he : st'.entry? w.entry = st.entry? w.entry) : authorized st' w = authorized st w := by
  unfold authorized
  rw [actsVia_congr hv, he]
  cases st.entry? w.entry with
  | none => rfl
  | some en => simp only [mayWrite, holdsCap, State.live, inCell, hc, hr, hn]

/-- Settling keys changes no write's authorization. -/
theorem authorized_settle (pre post : State) (w : Write) : authorized (settle pre post) w = authorized post w :=
  authorized_congr (settle_vaults pre post) (settle_caps pre post) (settle_revoked pre post) (settle_narrow pre post)
    (by simp only [State.entry?, settle_entries])

/-! ## Dropping what a removal hadn't seen -/

/-- Keeping the entries that pass a test every entry of id `e` passes keeps the lookup of `e`. -/
theorem find?_filter_of {l : List Entry} {p : Entry → Bool} {e : EntryId} (hp : ∀ x ∈ l, x.id = e → p x = true) :
    (l.filter p).find? (·.id == e) = l.find? (·.id == e) := by
  induction l with
  | nil => rfl
  | cons x l ih =>
    have ih := ih fun y hy => hp y (List.mem_cons_of_mem _ hy)
    by_cases hx : x.id = e
    · rw [List.filter_cons_of_pos (hp x List.mem_cons_self hx)]
      simp [hx]
    · rw [List.filter_cons]
      split <;> simp [hx, ih]

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

/-- `depsIn` holds when every dependency is an accepted write of the same entry. -/
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

/-- A write that survives `dropUnseen` was there before, and passed its filter: the removal had seen it, it wasn't
    authorized before, or it still is. -/
theorem dropUnseen_writes {pre post : State} {keep : List EditId} {w : Write}
    (hw : w ∈ (dropUnseen pre post keep).writes) :
    w ∈ post.writes ∧ (keep.contains w.edit || !authorized pre w || authorized post w) = true :=
  List.mem_filter.1 ((closeDeps_sublist _).subset (List.mem_filter.1 hw).1)

/-- An entry that survives `dropUnseen` was there before. -/
theorem dropUnseen_entries {pre post : State} {keep : List EditId} {en : Entry}
    (hen : en ∈ (dropUnseen pre post keep).entries) : en ∈ post.entries :=
  (List.mem_filter.1 hen).1

/-- A write that survives `dropUnseen` keeps its entry. -/
theorem dropUnseen_entry_of_write {pre post : State} {keep : List EditId} {w : Write}
    (hw : w ∈ (dropUnseen pre post keep).writes) : ∃ en ∈ (dropUnseen pre post keep).entries, en.id = w.entry := by
  have := (List.mem_filter.1 hw).2
  simp only [List.any_eq_true, beq_iff_eq] at this
  exact this

/-- `dropUnseen` keeps or drops all the entries of one id together, so an id some entry still has is looked up as
    before. -/
theorem dropUnseen_entry? {pre post : State} {keep : List EditId} {en : Entry}
    (hen : en ∈ (dropUnseen pre post keep).entries) :
    (dropUnseen pre post keep).entry? en.id = post.entry? en.id := by
  unfold State.entry?
  unfold dropUnseen at hen ⊢
  dsimp only at hen ⊢
  refine find?_filter_of fun x _ hx => ?_
  rw [hx]
  exact (List.mem_filter.1 hen).2

/-- A write that survives `dropUnseen` is authorized after it exactly when it is before it. -/
theorem authorized_dropUnseen {pre post : State} {keep : List EditId} {w : Write}
    (hw : w ∈ (dropUnseen pre post keep).writes) : authorized (dropUnseen pre post keep) w = authorized post w := by
  obtain ⟨en, hen, hid⟩ := dropUnseen_entry_of_write hw
  refine authorized_congr (st' := dropUnseen pre post keep) (st := post) rfl rfl rfl rfl ?_
  rw [← hid]
  exact dropUnseen_entry? hen

/-- The writes `dropUnseen` keeps are causally closed: `closeDeps` keeps them so, and a write's dependencies are of its
    own entry, which stays with it. -/
theorem dropUnseen_closed (pre post : State) (keep : List EditId) :
    ∀ w ∈ (dropUnseen pre post keep).writes, depsIn (dropUnseen pre post keep).writes w = true := by
  intro w hw
  have hws := closeDeps_closed _ w (List.mem_filter.1 hw).1
  rw [depsIn_iff] at hws ⊢
  intro d hd
  obtain ⟨x, hx, hxd, hxe⟩ := hws d hd
  refine ⟨x, List.mem_filter.2 ⟨hx, ?_⟩, hxd, hxe⟩
  rw [hxe]
  exact (List.mem_filter.1 hw).2

/-- After `dropUnseen`, every write's entry is there, and every entry's first write: an entry stays only with its
    first write, and a write only with its entry. -/
theorem dropUnseen_whole (pre post : State) (keep : List EditId) :
    (∀ w ∈ (dropUnseen pre post keep).writes, ∃ en ∈ (dropUnseen pre post keep).entries, en.id = w.entry) ∧
    (∀ en ∈ (dropUnseen pre post keep).entries, ∃ w ∈ (dropUnseen pre post keep).writes,
      w.entry = en.id ∧ w.first = true) := by
  refine ⟨fun w hw => dropUnseen_entry_of_write hw, fun en hen => ?_⟩
  have h := (List.mem_filter.1 hen).2
  simp only [List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at h
  obtain ⟨w, hw, hwe, hwf⟩ := h
  refine ⟨w, List.mem_filter.2 ⟨hw, ?_⟩, hwe, hwf⟩
  simp only [List.any_eq_true, beq_iff_eq]
  exact ⟨en, hen, hwe.symm⟩

/-! ## What one step does to the writes and the entries -/

/-- A check `a || !b` that failed passed `b`. -/
theorem of_not_or_not {a b : Bool} (h : ¬(a || !b) = true) : b = true := by
  cases a <;> cases b <;> simp_all

/-- A check `!b` that failed passed `b`. -/
theorem of_not_not {b : Bool} (h : ¬(!b) = true) : b = true := by
  cases b <;> simp_all

/-- An accepted edit keeps the writes and what `authorized` reads, and makes no new entry; or creates an entry with
    its first write, whose author acted for its actor, which may create there; or adds a write to an existing entry,
    which was authorized and whose dependencies were accepted; or it is a removal that drops writes (`dropUnseen`). -/
theorem apply_writes {st post : State} {edit : Edit} (h : apply st edit = some post) :
    (post.writes = st.writes ∧ Keeps st post ∧ ∀ en ∈ post.entries, ∃ x ∈ st.entries, x.id = en.id) ∨
    (∃ w en, post.writes = st.writes ++ [w] ∧ post.entries = st.entries ++ [en] ∧ Keeps st post ∧
      w.edit = edit.id ∧ w.entry = en.id ∧ w.first = true ∧ w.deps = [] ∧
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.cell = true) ∨
    (∃ w, post.writes = st.writes ++ [w] ∧ Keeps st post ∧ (∀ en ∈ post.entries, ∃ x ∈ st.entries, x.id = en.id) ∧
      w.first = false ∧ authorized st w = true ∧ depsIn st.writes w = true) ∨
    (∃ keep mid, edit.action.keep? = some keep ∧ post = dropUnseen st mid keep ∧ mid.writes = st.writes ∧
      ∀ en ∈ mid.entries, ∃ x ∈ st.entries, x.id = en.id) := by
  -- the entries of a state that keeps them
  have same : ∀ s : State, ∀ en ∈ s.entries, ∃ x ∈ s.entries, x.id = en.id := fun _ en h => ⟨en, h, rfl⟩
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .addVault _ _, same st⟩
  · -- addOwner
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => List.mem_append_left _ hp) (fun _ hd => hd), same st⟩
  · -- removeOwner
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- setThreshold
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => hd), same st⟩
  · -- addDevice
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => List.mem_append_left _ hd), same st⟩
  · -- removeDevice
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- setRoot: a removal by `keep?`, but it changes only a root, which authorization doesn't read
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => hd), same st⟩
  · -- cap
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .addCap _ _, same st⟩
  · -- revoke
    split at h
    · simp at h
    · rename_i keep _ heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- write
    rename_i v e actor stay gen deps proposal via create tags heq
    dsimp only at h
    split at h
    · cases h
    · rename_i hact
      have hact := of_not_or_not hact
      split at h
      · -- a new entry, with its first write
        rename_i x hdr
        simp at h
        obtain ⟨-, ⟨⟨-, hmc⟩, -⟩, rfl⟩ := h
        refine .inr (.inl ⟨_, _, rfl, rfl, .of_entries rfl rfl rfl rfl fun e' en' he => ?_, rfl, rfl, rfl, rfl,
          hact, hmc⟩)
        simp only [State.entry?, List.find?_append] at he ⊢
        rw [he]
        rfl
      · -- a write to an existing entry
        split at h
        · cases h
        · rename_i en hen
          split at h
          · cases h
          · rename_i hok
            have hok := of_not_or_not hok
            split at h
            · cases h
            · simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
              obtain ⟨-, hdeps, -, rfl⟩ := h
              refine .inr (.inr (.inl ⟨⟨edit.id, edit.author, actor, e, stay, gen, deps, proposal, via, false, en.cell⟩,
                ?_, ?_, ?_, rfl, ?_, of_not_not hdeps⟩))
              · split <;> rfl
              · split
                · -- only the tags change
                  have hk : Keeps st (setEntry st { en with attrs := { en.attrs with
                      tags := tags.apply en.attrs.tags } }) :=
                    Keeps.setEntry (en := en) (by show st.entry? en.id = some en; rw [entry?_id hen]; exact hen) rfl rfl
                  exact hk.trans (.of_eq rfl rfl rfl rfl rfl)
                · exact .of_eq rfl rfl rfl rfl rfl
              · split
                · exact setEntry_ids _ _
                · exact same st
              · simpa [authorized, hact, hen, mayWrite, inCell, Entry.cell] using hok
  · -- move
    split at h
    · simp at h
    · rename_i keep _ heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, setEntry_ids _ _⟩))
  · -- keys: change nothing
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_eq rfl rfl rfl rfl rfl, same st⟩
  · -- publish: only the lane
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_eq rfl rfl rfl rfl rfl, same st⟩
  · -- checkpoint: changes nothing
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, rfl⟩ := h
    exact .inl ⟨rfl, .of_eq rfl rfl rfl rfl rfl, same st⟩

/-- Every write's entry exists, and every entry's first write is accepted. -/
def EntriesWhole (st : State) : Prop :=
  (∀ w ∈ st.writes, ∃ en ∈ st.entries, en.id = w.entry) ∧
  (∀ en ∈ st.entries, ∃ w ∈ st.writes, w.entry = en.id ∧ w.first = true)

/-- One step keeps every write's entry and every entry's first write. -/
theorem entriesWhole_step {st st' : State} {edit : Edit} (hinv : EntriesWhole st) (h : step st edit = some st') :
    EntriesWhole st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  suffices hc : EntriesWhole post by
    unfold EntriesWhole
    rw [settle_writes, settle_entries]
    exact hc
  obtain ⟨hwe, hef⟩ := hinv
  -- an entry with the id of an old entry has that entry's first write
  have hfirst : ∀ ws : List Write, (∀ w ∈ st.writes, w ∈ ws) → ∀ en : Entry, (∃ x ∈ st.entries, x.id = en.id) →
      ∃ w ∈ ws, w.entry = en.id ∧ w.first = true := by
    intro ws hsub en ⟨x, hx, hxid⟩
    obtain ⟨w, hw, hwe', hwf⟩ := hef x hx
    exact ⟨w, hsub w hw, hwe'.trans hxid, hwf⟩
  rcases apply_writes hpost with ⟨hws, hk, hids⟩ | ⟨w', en', hws, hes, -, -, hent, hf, -⟩ |
    ⟨w', hws, hk, hids, -, hauth, -⟩ | ⟨keep, mid, -, rfl, -, -⟩
  · refine ⟨fun w hw => ?_, fun en hen => hfirst _ (fun w hw => hws ▸ hw) en (hids en hen)⟩
    obtain ⟨en, hen, hid⟩ := hwe w (hws ▸ hw)
    obtain ⟨en', hen', hid'⟩ := hk.mem_entries hen
    exact ⟨en', hen', hid'.trans hid⟩
  · -- a new entry with its first write
    unfold EntriesWhole
    rw [hws, hes]
    refine ⟨fun w hw => ?_, fun en hen => ?_⟩
    · rcases List.mem_append.1 hw with hw | hw
      · obtain ⟨en, hen, hid⟩ := hwe w hw
        exact ⟨en, List.mem_append_left _ hen, hid⟩
      · rw [List.mem_singleton] at hw
        subst hw
        exact ⟨en', List.mem_append_right _ (List.mem_singleton_self _), hent.symm⟩
    · rcases List.mem_append.1 hen with hen | hen
      · exact hfirst _ (fun w hw => List.mem_append_left _ hw) en ⟨en, hen, rfl⟩
      · rw [List.mem_singleton] at hen
        subst hen
        exact ⟨w', List.mem_append_right _ (List.mem_singleton_self _), hent, hf⟩
  · -- a write to an entry that was authorized, so its entry exists
    unfold EntriesWhole
    rw [hws]
    refine ⟨fun w hw => ?_, fun en hen => hfirst _ (fun w hw => List.mem_append_left _ hw) en (hids en hen)⟩
    rcases List.mem_append.1 hw with hw | hw
    · obtain ⟨en, hen, hid⟩ := hwe w hw
      obtain ⟨en', hen', hid'⟩ := hk.mem_entries hen
      exact ⟨en', hen', hid'.trans hid⟩
    · rw [List.mem_singleton] at hw
      subst hw
      unfold authorized at hauth
      cases he : st.entry? w.entry with
      | none => rw [he] at hauth; simp at hauth
      | some en =>
        obtain ⟨en', he', -, -⟩ := hk.entries _ en he
        exact ⟨en', entry?_mem he', entry?_id he'⟩
  · exact dropUnseen_whole _ _ _

/-! ## What one step does to the caps and the schema lane -/

/-- An accepted edit leaves the caps alone (a revocation only marks caps revoked), or adds one cap that names a vault or
    Public, Public only with read. -/
theorem apply_caps {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.caps = st.caps ∨
    (∃ c, post.caps = st.caps ++ [c] ∧ (∀ s, c.grantee ≠ .principal (.signer s)) ∧
      (c.grantee = .«public» → c.role = .read)) := by
  unfold apply at h
  split at h
  case h_8 c via _ =>
    simp at h
    obtain ⟨-, hname, -, -, rfl⟩ := h
    refine .inr ⟨c, rfl, fun s hs => ?_, fun hp => ?_⟩
    · rw [hs] at hname
      cases hname
    · rw [hp] at hname
      simpa using hname
  -- every other edit leaves the caps alone
  all_goals
    dsimp only at h
    repeat' split at h
    all_goals cases h
    all_goals exact .inl rfl

/-- An accepted edit leaves the lane alone, or publishes one blob into a vault's lane: its author acts for that vault
    or for a vault holding a wide owner cap over it. -/
theorem apply_lane {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.lane = st.lane ∨
    ∃ v actor blob via, edit.action = .publish v actor blob via ∧ actsVia st edit.author via actor = true ∧
      ownsLane st actor v = true ∧ post.lane = st.lane ++ [(v, blob)] := by
  unfold apply at h
  split at h
  case h_13 v actor blob via heq =>
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, hok, rfl⟩ := h
    have hok : actsVia st edit.author via actor = true ∧ ownsLane st actor v = true := by simpa using hok
    exact .inr ⟨v, actor, blob, via, heq, hok.1, hok.2, rfl⟩
  -- every other edit leaves the lane alone
  all_goals
    dsimp only at h
    repeat' split at h
    all_goals cases h
    all_goals exact .inl rfl

/-! ## The theorems -/

theorem T1_authorized_writes {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) (hfirst : w.first = false) : authorized st w = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_writes] at hw
  rcases apply_writes hpost with ⟨hws, -, -⟩ | ⟨w', _, hws, -, -, -, -, hf, -⟩ | ⟨w', hws, -, -, -, hauth, -⟩ |
    ⟨keep, mid, -, rfl, hmid, -⟩
  · exact absurd (hws ▸ hw) hnew
  · -- the first write of a new entry is the only write it adds
    rw [hws] at hw
    rcases List.mem_append.1 hw with hw | hw
    · exact absurd hw hnew
    · rw [List.mem_singleton] at hw
      subst hw
      rw [hf] at hfirst
      cases hfirst
  · rw [hws] at hw
    rcases List.mem_append.1 hw with hw | hw
    · exact absurd hw hnew
    · rw [List.mem_singleton] at hw
      subst hw
      exact hauth
  · -- a removal only drops writes
    exact absurd (hmid ▸ (dropUnseen_writes hw).1) hnew

theorem T1_created_entries {st st' : State} {edit : Edit} (h : step st edit = some st') {en : Entry}
    (hen : en ∈ st'.entries) (hnew : ∀ x ∈ st.entries, x.id ≠ en.id) :
    ∃ w ∈ st'.writes, w.edit = edit.id ∧ w.entry = en.id ∧ w.first = true ∧
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.cell = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_entries] at hen
  rw [settle_writes]
  rcases apply_writes hpost with ⟨-, -, hids⟩ | ⟨w, en', hws, hes, -, hid, hentry, hf, -, hact, hmc⟩ |
    ⟨-, -, -, hids, -⟩ | ⟨keep, mid, -, rfl, -, hids⟩
  · obtain ⟨x, hx, hxid⟩ := hids en hen
    exact absurd hxid (hnew x hx)
  · -- the new entry is the one the write created
    rw [hes] at hen
    rcases List.mem_append.1 hen with hen | hen
    · exact absurd rfl (hnew en hen)
    · rw [List.mem_singleton] at hen
      subst hen
      exact ⟨w, by rw [hws]; exact List.mem_append_right _ (List.mem_singleton_self _), hid, hentry, hf, hact, hmc⟩
  · obtain ⟨x, hx, hxid⟩ := hids en hen
    exact absurd hxid (hnew x hx)
  · -- a removal only drops entries
    obtain ⟨x, hx, hxid⟩ := hids en (dropUnseen_entries hen)
    exact absurd hxid (hnew x hx)

theorem T1_revocation_wins {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (_hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, edit.action.keep? = some keep ∧ w.edit ∈ keep := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [authorized_settle] at hnow
  rw [settle_writes] at hw
  -- if `post` keeps what `authorized` reads in a state where the write was authorized, it still is after the step
  have hstill : ∀ s, Keeps s post → authorized s w = true → False := fun s hk ha => by
    rw [authorized_keeps hk ha] at hnow
    cases hnow
  rcases apply_writes hpost with ⟨-, hk, -⟩ | ⟨_, _, -, -, hk, -⟩ | ⟨_, -, hk, -⟩ | ⟨keep, mid, hkeep, rfl, -, -⟩
  · exact (hstill st hk hwas).elim
  · exact (hstill st hk hwas).elim
  · exact (hstill st hk hwas).elim
  · -- the write passed `dropUnseen`'s filter but isn't authorized after the removal, so the removal kept it
    refine ⟨keep, hkeep, ?_⟩
    have hpass := (dropUnseen_writes hw).2
    rw [authorized_dropUnseen hw] at hnow
    simpa [hwas, hnow] using hpass

theorem T2_governance {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt')
    (hchg : vt.owners ≠ vt'.owners ∨ vt.threshold ≠ vt'.threshold ∨ vt.devices ≠ vt'.devices) :
    approves st edit.sigs (.vault v) = true ∨
    (∃ p, vt'.owners = vt.owners.erase p ∧ approves st edit.sigs p = true) ∨
    (∃ d, vt'.devices = vt.devices.erase d ∧ d ∈ edit.sigs) := by
  rcases step_vault?_old h h₁ h₂ with rfl | hch
  · simp at hchg
  · cases hch with
    | addOwner _ _ _ _ happ _ => exact .inl happ
    | removeOwner p happ =>
      rcases happ with happ | happ
      · exact .inl happ
      · exact .inr (.inl ⟨p, rfl, happ⟩)
    | setThreshold _ happ => exact .inl happ
    | addDevice _ _ happ _ => exact .inl happ
    | removeDevice d happ =>
      rcases happ with happ | hd
      · exact .inl happ
      · exact .inr (.inr ⟨d, rfl, hd⟩)
    | setRoot _ _ _ => simp at hchg

theorem T2_consent {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st edit.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ edit.sigs) := by
  rcases step_vault?_old h h₁ h₂ with rfl | hch
  · exact ⟨fun p hp hn => absurd hp hn, fun d hd hn => absurd hd hn⟩
  · cases hch with
    | addOwner p _ _ _ _ happ =>
      refine ⟨fun q hq hn => ?_, fun d hd hn => absurd hd hn⟩
      rcases List.mem_append.1 hq with hq | hq
      · exact absurd hq hn
      · rw [List.mem_singleton] at hq
        exact hq ▸ happ
    | removeOwner _ _ => exact ⟨fun q hq hn => absurd (List.mem_of_mem_erase hq) hn, fun d hd hn => absurd hd hn⟩
    | setThreshold _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd hd hn⟩
    | addDevice d _ _ hd =>
      refine ⟨fun q hq hn => absurd hq hn, fun d' hd' hn => ?_⟩
      rcases List.mem_append.1 hd' with hd' | hd'
      · exact absurd hd' hn
      · rw [List.mem_singleton] at hd'
        exact hd' ▸ hd
    | removeDevice _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd (List.mem_of_mem_erase hd) hn⟩
    | setRoot _ _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd hd hn⟩

theorem device_cannot_govern {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt)
    (hsig : ∀ p ∈ vt.owners, ∃ s, p = .signer s) (hth : 0 < vt.threshold) (sigs : List SignerId)
    (hnone : ∀ s ∈ sigs, Principal.signer s ∉ vt.owners) (hroot : ∀ r, vt.root = some r → r ∉ sigs) :
    approves st sigs (.vault v) = false := by
  -- no owner approves, so the owners that approve fall short of the threshold
  have hnil : vt.owners.filter (approvesN st sigs st.vaults.length) = [] := by
    refine List.filter_eq_nil_iff.2 fun p hp => ?_
    obtain ⟨s, rfl⟩ := hsig p hp
    simp only [approvesN, List.contains_iff_mem]
    exact fun hs => hnone s hs hp
  -- and the root didn't sign
  have hr : vt.root.any sigs.contains = false := by
    cases hvr : vt.root with
    | none => rfl
    | some r => simpa using hroot r hvr
  simp only [approves, State.depth, approvesN, h, hnil, hr, List.length_nil, Bool.false_or, decide_eq_false_iff_not]
  omega

theorem devices_cannot_govern {st : State} {sigs : List SignerId}
    (hnone : ∀ s ∈ sigs, ∀ v vt, st.vault? v = some vt → Principal.signer s ∉ vt.owners ∧ vt.root ≠ some s)
    (hth : ∀ v vt, st.vault? v = some vt → 0 < vt.threshold) : ∀ n v, approvesN st sigs n (.vault v) = false
  | 0, _ => rfl
  | n + 1, v => by
    simp only [approvesN]
    cases hv : st.vault? v with
    | none => rfl
    | some vt =>
      -- the root didn't sign
      have hr : vt.root.any sigs.contains = false := by
        cases hvr : vt.root with
        | none => rfl
        | some r =>
          simp only [Option.any_some]
          cases hs : sigs.contains r with
          | false => rfl
          | true => exact absurd hvr (hnone r (List.contains_iff_mem.1 hs) v vt hv).2
      -- and no owner approves: no owner signer signed, and no owner vault approves
      have hnil : vt.owners.filter (approvesN st sigs n) = [] := by
        refine List.filter_eq_nil_iff.2 fun p hp => ?_
        cases p with
        | signer s =>
          simp only [approvesN, List.contains_iff_mem]
          exact fun hs => (hnone s hs v vt hv).1 hp
        | vault o => simp [devices_cannot_govern hnone hth n o]
      simp only [hr, hnil, List.length_nil, Bool.false_or, decide_eq_false_iff_not]
      have := hth v vt hv
      omega

theorem T21_vault_kinds {st : State} (hr : Reachable st) : KindsFit st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv KindsFit (fun _ _ _ hk hs => kindsFit_step hk hs) edits {} ?_
  intro v vt hv
  simp [State.vault?] at hv

theorem T3_no_cycles (edits : List Edit) : Acyclic (replay {} edits) := by
  suffices h : ∀ st, Acyclic st → OwnersExist st → Acyclic (replay st edits) ∧ OwnersExist (replay st edits) by
    refine (h {} (fun v hv => ?_) (fun x vt hx => ?_)).1
    · obtain ⟨_, _, hx, _⟩ := transGen_head (ownsPlus_iff.1 hv)
      simp [State.vault?] at hx
    · simp [State.vault?] at hx
  induction edits with
  | nil => exact fun _ h₁ h₂ => ⟨h₁, h₂⟩
  | cons edit edits ih =>
    intro st h₁ h₂
    show Acyclic (replay ((step st edit).getD st) edits) ∧ OwnersExist (replay ((step st edit).getD st) edits)
    cases hs : step st edit with
    | none => exact ih st h₁ h₂
    | some st' =>
      obtain ⟨h₁', h₂'⟩ := T3_step h₁ h₂ hs
      exact ih st' h₁' h₂'

theorem T4_caps_name_vaults {st st' : State} {edit : Edit} (hinv : CapsNameVaults st) (h : step st edit = some st') :
    CapsNameVaults st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  intro c hc
  rw [settle_caps] at hc
  rcases apply_caps hpost with hcs | ⟨c', hcs, hname, -⟩
  · exact hinv c (hcs ▸ hc)
  · rw [hcs] at hc
    rcases List.mem_append.1 hc with hc | hc
    · exact hinv c hc
    · rw [List.mem_singleton] at hc
      subst hc
      exact hname

theorem T8_public_read_only {st st' : State} {edit : Edit} (hinv : PublicReadOnly st) (h : step st edit = some st') :
    PublicReadOnly st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  intro c hc
  rw [settle_caps] at hc
  rcases apply_caps hpost with hcs | ⟨c', hcs, -, hpub⟩
  · exact hinv c (hcs ▸ hc)
  · rw [hcs] at hc
    rcases List.mem_append.1 hc with hc | hc
    · exact hinv c hc
    · rw [List.mem_singleton] at hc
      subst hc
      exact hpub

theorem T17_lane_by_owners {st st' : State} {edit : Edit} (h : step st edit = some st') {x : VaultId × BlobId}
    (hx : x ∈ st'.lane) (hnew : x ∉ st.lane) :
    ∃ actor via, edit.action = .publish x.1 actor x.2 via ∧ actsVia st edit.author via actor = true ∧
      ownsLane st actor x.1 = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_lane] at hx
  rcases apply_lane hpost with hl | ⟨v, actor, blob, via, hact, hacts, hown, hl⟩
  · exact absurd (hl ▸ hx) hnew
  · rw [hl] at hx
    rcases List.mem_append.1 hx with hx | hx
    · exact absurd hx hnew
    · rw [List.mem_singleton] at hx
      subst hx
      exact ⟨actor, via, hact, hacts, hown⟩

theorem T14_causally_closed {st st' : State} {edit : Edit} (hinv : CausallyClosed st) (h : step st edit = some st') :
    CausallyClosed st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  have hpre : ∀ w ∈ st.writes, depsIn st.writes w = true := fun w hw => depsIn_iff.2 (hinv w hw)
  suffices hc : ∀ w ∈ post.writes, depsIn post.writes w = true by
    intro w hw
    rw [settle_writes] at hw ⊢
    exact depsIn_iff.1 (hc w hw)
  -- a write added to the writes builds on accepted writes
  have hadd : ∀ w', depsIn st.writes w' = true → ∀ w ∈ st.writes ++ [w'], depsIn (st.writes ++ [w']) w = true := by
    intro w' hw' w hw
    have hsub : ∀ x ∈ st.writes, x ∈ st.writes ++ [w'] := fun x hx => List.mem_append_left _ hx
    rcases List.mem_append.1 hw with hw | hw
    · exact depsIn_mono (hpre w hw) hsub
    · rw [List.mem_singleton] at hw
      subst hw
      exact depsIn_mono hw' hsub
  rcases apply_writes hpost with ⟨hws, -, -⟩ | ⟨w', _, hws, -, -, -, -, -, hdeps, -⟩ | ⟨w', hws, -, -, -, -, hdeps⟩ |
    ⟨keep, mid, -, rfl, -, -⟩
  · rw [hws]
    exact hpre
  · -- a new entry's first write builds on nothing
    rw [hws]
    exact hadd w' (by simp [depsIn, hdeps])
  · rw [hws]
    exact hadd w' hdeps
  · -- a removal keeps only writes whose dependencies it keeps
    exact dropUnseen_closed _ _ _

theorem T14_entries_whole {st : State} (hr : Reachable st) :
    (∀ w ∈ st.writes, ∃ en ∈ st.entries, en.id = w.entry) ∧
    (∀ en ∈ st.entries, ∃ w ∈ st.writes, w.entry = en.id ∧ w.first = true) := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv EntriesWhole (fun _ _ _ hi hs => entriesWhole_step hi hs) edits {} ⟨?_, ?_⟩
  · intro w hw
    simp at hw
  · intro en hen
    simp at hen

end AvenDB.Core
