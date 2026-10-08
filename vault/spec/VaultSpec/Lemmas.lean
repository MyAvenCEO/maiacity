import VaultSpec.Sync

/-!
# Lemmas

Helpers for the proofs in `Theorems.lean`. Settling keys leaves the vaults alone, so a step changes the vaults only
through `apply`: it adds a vault or changes one (`VaultChange`). Without cycles, `owns` finds every chain of owners,
so the check in `addOwner` refuses every owner that would close a cycle.
-/

namespace VaultSpec

/-! ## Settling keys leaves the vaults alone -/

/-- A fold of steps that each leave the vaults alone leaves them alone. -/
theorem foldl_vaults {α : Type} (f : State → α → State) (hf : ∀ s a, (f s a).vaults = s.vaults) :
    ∀ (l : List α) (s : State), (l.foldl f s).vaults = s.vaults
  | [], _ => rfl
  | a :: l, s => by rw [List.foldl_cons, foldl_vaults f hf l, hf]

theorem addSeal_vaults (st : State) (s : Seal) : (addSeal st s).vaults = st.vaults := by
  unfold addSeal; split <;> rfl

theorem publish_vaults (st : State) (k : KeyName) : (publish st k).vaults = st.vaults := by
  unfold publish; split <;> rfl

theorem sealAll_vaults (st : State) : (sealAll st).vaults = st.vaults := by
  unfold sealAll
  apply foldl_vaults
  intro acc k
  simp only
  split
  · rw [publish_vaults, foldl_vaults _ (fun a _ => addSeal_vaults a _)]
  · rw [foldl_vaults _ (fun a _ => addSeal_vaults a _)]

/-- Rotating, sealing and publishing keys leaves the vaults alone. -/
theorem settle_vaults (pre post : State) : (settle pre post).vaults = post.vaults := by
  unfold settle
  rw [sealAll_vaults, foldl_vaults bump (fun _ _ => rfl)]

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

theorem setVault_vault?_ne {st : State} {vt' : Vault} {x : VaultId} (hx : x ≠ vt'.id) :
    (setVault st vt').vault? x = st.vault? x := by
  rw [setVault_vault?]
  cases h : st.vault? x with
  | none => rfl
  | some y =>
    have := vault?_id h
    subst this
    simp [hx]

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

/-- A vault fits as an owner only if it exists. -/
theorem ownerFits_vault {st : State} {k : Kind} {o : VaultId} (h : ownerFits st k (.vault o) = true) :
    (st.vault? o).isSome = true := by
  cases k <;> simp_all [ownerFits]

/-! ## What one step does to the vaults -/

/-- How an accepted op changes an existing vault `vt` of id `v` into `vt'`, with what the op had to carry. -/
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
  | addDevice (d : SignerId) : approves st sigs (.vault v) = true → d ∈ sigs →
      VaultChange st sigs v vt { vt with devices := vt.devices ++ [d] }
  | removeDevice (d : SignerId) : (approves st sigs (.vault v) = true ∨ d ∈ sigs) →
      VaultChange st sigs v vt { vt with devices := vt.devices.erase d }

theorem VaultChange.id {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : vt'.id = vt.id := by
  cases h <;> rfl

/-- An accepted op leaves the vaults as they were, appends a new one, or changes one existing vault. -/
theorem apply_vaults {st post : State} {op : Op} (h : apply st op = some post) :
    post.vaults = st.vaults ∨
    (∃ v kind owners threshold, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      post.vaults = st.vaults ++ [⟨v, kind, owners, threshold, []⟩]) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st op.sigs v vt vt' ∧
      post.vaults = (setVault st vt').vaults) := by
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨⟨⟨hnone, -⟩, -⟩, hfit, -, -, rfl⟩ := h
    exact .inr (.inl ⟨_, _, _, _, hnone, hfit, rfl⟩)
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
      cases h1 : approves st op.sigs (.vault v)
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
      obtain ⟨-, ⟨happ, hd⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .addDevice d happ hd, rfl⟩)
  · -- removeDevice
    split at h
    · simp at h
    · rename_i v d keep _ _ vt hv
      simp at h
      obtain ⟨-, happ, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .removeDevice d ?_, rfl⟩)
      cases h1 : approves st op.sigs (.vault v)
      · exact .inr (happ h1)
      · exact .inl rfl
  · -- foundSpace
    simp at h
    obtain ⟨-, rfl⟩ := h
    exact .inl rfl
  · -- grant
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl rfl
  · -- revoke
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl rfl
  · -- write
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, -, rfl⟩ := h
      left
      dsimp only
      split <;> rfl

/-- What a step does to the vaults, told by lookups: nothing, a new vault with a free id and existing owners, or
    one existing vault changed as `VaultChange` says. -/
theorem step_vault? {st st' : State} {op : Op} (h : step st op = some st') :
    (∀ x, st'.vault? x = st.vault? x) ∨
    (∃ v kind owners threshold, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      ∀ x, st'.vault? x = if x = v then some ⟨v, kind, owners, threshold, []⟩ else st.vault? x) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st op.sigs v vt vt' ∧
      ∀ x, st'.vault? x = if x = v then some vt' else st.vault? x) := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  have hs : ∀ x, (settle st post).vault? x = post.vault? x := vault?_congr (settle_vaults st post)
  rcases apply_vaults hpost with hv | ⟨v, kind, owners, threshold, hnone, hfit, hv⟩ | ⟨v, vt, vt', hvt, hch, hv⟩
  · exact .inl fun x => by rw [hs, vault?_congr hv]
  · refine .inr (.inl ⟨v, kind, owners, threshold, hnone, hfit, fun x => ?_⟩)
    rw [hs, vault?_congr (st := { st with vaults := st.vaults ++ [⟨v, kind, owners, threshold, []⟩] }) hv]
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
theorem step_vault?_old {st st' : State} {op : Op} (h : step st op = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') : vt' = vt ∨ VaultChange st op.sigs v vt vt' := by
  rcases step_vault? h with hsame | ⟨w, _, _, _, hw, -, hlook⟩ | ⟨w, vtw, vtw', hw, hch, hlook⟩
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
      simp only [VaultSpec.ownsN, hx]
      exact List.any_eq_true.2 ⟨_, ha, by simp⟩
  | cons hbx _ ih =>
    intro n hn
    obtain ⟨vt, hx, hb⟩ := hbx
    match n, hn with
    | n + 1, hn =>
      simp only [VaultSpec.ownsN, hx]
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
theorem step_owners {st st' : State} {op : Op}
    (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y)
    (hex : ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome)
    (h : step st op = some st') :
    (∀ y, ¬ Relation.TransGen (OwnerOf st') y y) ∧
    (∀ x vt, st'.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st'.vault? o).isSome) := by
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, hnone, hfit, hlook⟩ |
    ⟨v, vt, vt', hvt, hch, hlook⟩
  · -- every lookup is as before
    have hsub : ∀ a b, OwnerOf st' a b → OwnerOf st a b := fun a b ⟨u, hu, ha⟩ => ⟨u, hsame b ▸ hu, ha⟩
    refine ⟨fun y hy => hacyc y (transGen_mono hsub hy), fun x u hx o ho => ?_⟩
    rw [hsame] at hx ⊢
    exact hex x u hx o ho
  · -- genesis of a new vault `v`: it owns nothing, so every chain ending elsewhere is old
    have hold : ∀ x, x ≠ v → st'.vault? x = st.vault? x := fun x hx => by rw [hlook, ite_eq_right hx]
    have hnew : st'.vault? v = some ⟨v, kind, owners, threshold, []⟩ := by rw [hlook, ite_eq_left rfl]
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
      | addDevice _ _ _ => exact hex _ _ hvt _ ho
      | removeDevice _ _ => exact hex _ _ hvt _ ho
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
      | addDevice _ _ _ => exact hmono fun a ha => ha
      | removeDevice _ _ => exact hmono fun a ha => ha
    · by_cases hxv : x = v
      · subst hxv
        rw [hnew] at hx
        cases hx
        exact hsome o (hown o ho)
      · rw [hold x hxv] at hx
        exact hsome o (hex x u hx o ho)

end VaultSpec
