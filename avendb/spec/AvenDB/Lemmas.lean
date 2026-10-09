import AvenDB.Sync

/-!
# Lemmas

Helpers for the proofs in `Theorems.lean`. Settling keys changes only the keys, so a step changes the vaults only
through `apply`: it adds a vault or changes one (`VaultChange`). Without cycles, `owns` finds every chain of owners,
so the check in `addOwner` refuses every owner that would close a cycle. Authorization reads only the vaults, the
spaces' founders and the grants, so an op that only adds to them keeps every write authorized (`Keeps`), and only a
removal drops writes. Only a publish by an owner of the space adds to its schema lane. `closeDeps` keeps writes
causally closed, and a run with removals ends in the replay of the ops that stood.
-/

namespace AvenDB

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

/-- Rotating, sealing and publishing keys leave alone whatever `get` reads besides the epochs, the seals and what is
    published. -/
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
  unfold settle sealAll
  rw [foldl_same get _ ?_, foldl_same get bump (fun st _ => he st _ _)]
  intro acc k
  simp only
  split
  · rw [hpub, foldl_same get _ (fun a _ => hseal a _)]
  · rw [foldl_same get _ (fun a _ => hseal a _)]

theorem settle_vaults (pre post : State) : (settle pre post).vaults = post.vaults :=
  settle_same State.vaults (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

theorem settle_spaces (pre post : State) : (settle pre post).spaces = post.spaces :=
  settle_same State.spaces (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

theorem settle_grants (pre post : State) : (settle pre post).grants = post.grants :=
  settle_same State.grants (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

theorem settle_writes (pre post : State) : (settle pre post).writes = post.writes :=
  settle_same State.writes (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

theorem settle_lane (pre post : State) : (settle pre post).lane = post.lane :=
  settle_same State.lane (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

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
  | addDevice (d : SignerId) : vt.kind.hasDevices = true → approves st sigs (.vault v) = true → d ∈ sigs →
      VaultChange st sigs v vt { vt with devices := vt.devices ++ [d] }
  | removeDevice (d : SignerId) : (approves st sigs (.vault v) = true ∨ d ∈ sigs) →
      VaultChange st sigs v vt { vt with devices := vt.devices.erase d }
  /-- The root hands itself on, or steps down: the current root signed, and so did the new one. -/
  | setRoot (r : Option SignerId) : vt.root.any sigs.contains = true → r.all sigs.contains = true →
      VaultChange st sigs v vt { vt with root := r }

theorem VaultChange.id {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : vt'.id = vt.id := by
  cases h <;> rfl

/-- An accepted op leaves the vaults as they were, appends a new one, or changes one existing vault. -/
theorem apply_vaults {st post : State} {op : Op} (h : apply st op = some post) :
    post.vaults = st.vaults ∨
    (∃ v kind owners threshold root, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      rootFits kind op.sigs root = true ∧ post.vaults = st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩]) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st op.sigs v vt vt' ∧
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
      obtain ⟨⟨hk, -⟩, ⟨happ, hd⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .addDevice d hk happ hd, rfl⟩)
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
  · -- setRoot
    split at h
    · simp at h
    · rename_i v r keep _ _ vt hv
      simp at h
      obtain ⟨⟨hroot, hnew⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .setRoot r hroot hnew, rfl⟩)
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
      obtain ⟨-, -, -, -, -, rfl⟩ := h
      left
      split <;> rfl
  · -- keys: change nothing
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, rfl⟩ := h
    exact .inl rfl
  · -- publish: only the lane
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, rfl⟩ := h
    exact .inl rfl
  · -- checkpoint: changes nothing
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, rfl⟩ := h
    exact .inl rfl

/-- What a step does to the vaults, told by lookups: nothing, a new vault with a free id and existing owners, or
    one existing vault changed as `VaultChange` says. -/
theorem step_vault? {st st' : State} {op : Op} (h : step st op = some st') :
    (∀ x, st'.vault? x = st.vault? x) ∨
    (∃ v kind owners threshold root, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      rootFits kind op.sigs root = true ∧
      ∀ x, st'.vault? x = if x = v then some ⟨v, kind, owners, threshold, [], root⟩ else st.vault? x) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st op.sigs v vt vt' ∧
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
theorem step_vault?_old {st st' : State} {op : Op} (h : step st op = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') : vt' = vt ∨ VaultChange st op.sigs v vt vt' := by
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
theorem step_owners {st st' : State} {op : Op}
    (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y)
    (hex : ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome)
    (h : step st op = some st') :
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

/-! ## What authorization reads

`authorized` reads the vaults (who acts for which), the spaces' founders and the grants, and never the writes, the
thresholds or the roots. A state that keeps all of these keeps every write authorized. -/

/-- `st'` keeps what `authorized` reads in `st`: every vault with its kind, owners and devices, the chain bound,
    every space's founder and every grant. -/
structure Keeps (st st' : State) : Prop where
  vaults : ∀ x vt, st.vault? x = some vt → ∃ vt', st'.vault? x = some vt' ∧ vt'.kind = vt.kind ∧
    (∀ p ∈ vt.owners, p ∈ vt'.owners) ∧ ∀ d ∈ vt.devices, d ∈ vt'.devices
  depth : st.depth ≤ st'.depth
  founders : ∀ sp v, st.founder? sp = some v → st'.founder? sp = some v
  grants : ∀ g ∈ st.grants, g ∈ st'.grants

theorem Keeps.trans {a b c : State} (h₁ : Keeps a b) (h₂ : Keeps b c) : Keeps a c where
  vaults x vt hx := by
    obtain ⟨vt₁, hx₁, hk₁, ho₁, hd₁⟩ := h₁.vaults x vt hx
    obtain ⟨vt₂, hx₂, hk₂, ho₂, hd₂⟩ := h₂.vaults x vt₁ hx₁
    exact ⟨vt₂, hx₂, hk₂.trans hk₁, fun p hp => ho₂ p (ho₁ p hp), fun d hd => hd₂ d (hd₁ d hd)⟩
  depth := Nat.le_trans h₁.depth h₂.depth
  founders sp v h := h₂.founders sp v (h₁.founders sp v h)
  grants g hg := h₂.grants g (h₁.grants g hg)

/-- A state with the same vaults keeps them. -/
theorem Keeps.of_vaults {st st' : State} (hv : st'.vaults = st.vaults)
    (hf : ∀ sp v, st.founder? sp = some v → st'.founder? sp = some v) (hg : ∀ g ∈ st.grants, g ∈ st'.grants) :
    Keeps st st' where
  vaults x vt hx := ⟨vt, by rw [vault?_congr hv]; exact hx, rfl, fun _ h => h, fun _ h => h⟩
  depth := by simp [State.depth, hv]
  founders := hf
  grants := hg

/-- Settling keys keeps everything. -/
theorem Keeps.settle (pre post : State) : Keeps post (settle pre post) :=
  .of_vaults (settle_vaults pre post) (fun _ _ h => by simpa [State.founder?, State.space?, settle_spaces] using h)
    (fun _ hg => by rw [settle_grants]; exact hg)

/-- Dropping writes keeps everything. -/
theorem Keeps.dropUnseen (pre post : State) (keep : List OpId) : Keeps post (dropUnseen pre post keep) :=
  .of_vaults rfl (fun _ _ h => h) (fun _ h => h)

/-- A new vault keeps the others. -/
theorem Keeps.addVault (st : State) (vt : Vault) : Keeps st { st with vaults := st.vaults ++ [vt] } where
  vaults x y hy := ⟨y, by simp only [State.vault?, List.find?_append] at hy ⊢; rw [hy]; rfl, rfl,
    fun _ h => h, fun _ h => h⟩
  depth := by simp [State.depth]
  founders _ _ h := h
  grants _ h := h

/-- Changing one vault keeps the vaults when its kind stays and its owners and devices only grow. -/
theorem Keeps.setVault {st : State} {v : VaultId} {vt vt' : Vault} (hv : st.vault? v = some vt)
    (hid : vt'.id = vt.id) (hkind : vt'.kind = vt.kind) (ho : ∀ p ∈ vt.owners, p ∈ vt'.owners)
    (hd : ∀ d ∈ vt.devices, d ∈ vt'.devices) : Keeps st (setVault st vt') where
  vaults x y hy := by
    rw [setVault_vault?, hy]
    by_cases hyv : y.id = vt'.id
    · -- the changed vault
      have hx : x = v := by rw [← vault?_id hy, hyv, hid, vault?_id hv]
      subst hx
      rw [hv] at hy
      cases hy
      exact ⟨vt', by simp [hyv], hkind, ho, hd⟩
    · exact ⟨y, by simp [hyv], rfl, fun _ h => h, fun _ h => h⟩
  depth := by simp [State.depth, AvenDB.setVault]
  founders _ _ h := h
  grants _ h := h

/-- Founding a space keeps the founders of the others. -/
theorem Keeps.addSpace (st : State) (s : Space) : Keeps st { st with spaces := st.spaces ++ [s] } :=
  .of_vaults rfl (fun sp v h => by
    simp only [State.founder?, State.space?, List.find?_append] at h ⊢
    cases hs : st.spaces.find? (·.id == sp) with
    | none => rw [hs] at h; cases h
    | some x => rw [hs] at h; rw [Option.some_or]; exact h) (fun _ h => h)

/-- Changing the spaces without changing any id or founder keeps the founders. -/
theorem Keeps.mapSpaces {st st' : State} {f : Space → Space} (hv : st'.vaults = st.vaults)
    (hs : st'.spaces = st.spaces.map f) (hg : st'.grants = st.grants) (hid : ∀ s, (f s).id = s.id)
    (hf : ∀ s, (f s).founder = s.founder) : Keeps st st' :=
  .of_vaults hv (fun sp v h => by
    simp only [State.founder?, State.space?, hs, List.find?_map, Option.map_map] at h ⊢
    have hfind : ((fun x : Space => x.id == sp) ∘ f) = fun x => x.id == sp := funext fun x => by simp [hid]
    have hfounder : ((fun x : Space => x.founder) ∘ f) = fun x => x.founder := funext fun x => by simp [hf]
    rw [hfind, hfounder]
    exact h) (fun _ h => by rw [hg]; exact h)

/-- A state that keeps the vaults keeps every chain of acting, and more fuel finds every chain less fuel found. -/
theorem actsForN_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} : ∀ {n m : Nat} {v : VaultId}, n ≤ m →
    actsForN st s n v = true → actsForN st' s m v = true
  | 0, _, _, _, h => by simp [actsForN] at h
  | _ + 1, 0, _, hnm, _ => absurd hnm (by omega)
  | n + 1, m + 1, v, hnm, h => by
    simp only [actsForN] at h ⊢
    cases hv : st.vault? v with
    | none => rw [hv] at h; cases h
    | some vt =>
      obtain ⟨vt', hv', -, ho, hd⟩ := hk.vaults v vt hv
      rw [hv] at h
      rw [hv']
      dsimp only at h ⊢
      simp only [Bool.or_eq_true, List.contains_iff_mem] at h ⊢
      rcases h with (h | h) | h
      · exact .inl (.inl (hd s h))
      · exact .inl (.inr (ho _ h))
      · obtain ⟨p, hp, hpo⟩ := List.any_eq_true.1 h
        refine .inr (List.any_eq_true.2 ⟨p, ho p hp, ?_⟩)
        cases p with
        | vault o => exact actsForN_keeps hk (by omega) hpo
        | signer _ => exact hpo

theorem actsFor_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} {v : VaultId}
    (h : actsFor st s v = true) : actsFor st' s v = true :=
  actsForN_keeps hk hk.depth h

/-- A state that keeps the vaults keeps every member. -/
theorem member_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} {v : VaultId}
    (h : member st s v = true) : member st' s v = true := by
  unfold member at h ⊢
  cases hv : st.vault? v with
  | none => rw [hv] at h; cases h
  | some vt =>
    obtain ⟨vt', hv', -, ho, hd⟩ := hk.vaults v vt hv
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
    obtain ⟨vt', hv', -, ho, -⟩ := hk.vaults v vt hv
    rw [hv] at h
    rw [hv']
    simp only [List.contains_iff_mem] at h ⊢
    exact ho _ h

/-- A state that keeps the vaults keeps every chain an op names. -/
theorem actsVia_keeps {st st' : State} (hk : Keeps st st') {s : SignerId} :
    ∀ {via : List VaultId} {v : VaultId}, actsVia st s via v = true → actsVia st' s via v = true
  | [], _, h => member_keeps hk h
  | o :: via, v, h => by
    simp only [actsVia, Bool.and_eq_true] at h ⊢
    exact ⟨ownerOf_keeps hk h.1, actsVia_keeps hk h.2⟩

theorem holds_keeps {st st' : State} (hk : Keeps st st') {v : VaultId} {sc : Scope} {r : Role}
    (h : holds st v sc r = true) : holds st' v sc r = true := by
  unfold holds at h ⊢
  simp only [Bool.or_eq_true, beq_iff_eq, List.any_eq_true] at h ⊢
  rcases h with h | ⟨g, hg, hgx⟩
  · exact .inl (hk.founders _ _ h)
  · exact .inr ⟨g, hk.grants g hg, hgx⟩

/-- A state that keeps what `authorized` reads keeps every write authorized. -/
theorem authorized_keeps {st st' : State} (hk : Keeps st st') {w : Write} (h : authorized st w = true) :
    authorized st' w = true := by
  unfold authorized at h ⊢
  rw [Bool.and_eq_true] at h ⊢
  exact ⟨actsVia_keeps hk h.1, holds_keeps hk h.2⟩

/-! ## Causally closed writes -/

theorem depsIn_iff {ws : List Write} {w : Write} :
    depsIn ws w = true ↔ ∀ d ∈ w.deps, ∃ x ∈ ws, x.op = d ∧ x.space = w.space ∧ x.entry = w.entry := by
  simp [depsIn, List.all_eq_true, List.any_eq_true, and_assoc]

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

/-! ## What one step does to the writes and the grants -/

/-- An accepted op leaves the writes alone, or is a write op adding its own write, which was authorized, whose
    dependencies were accepted, whose id is new and which extends its line, and either way keeps what `authorized`
    reads; or it is a removal that drops writes (`dropUnseen`). -/
theorem apply_writes {st post : State} {op : Op} (h : apply st op = some post) :
    (post.writes = st.writes ∧ Keeps st post) ∨
    (∃ w, post.writes = st.writes ++ [w] ∧ authorized st w = true ∧ depsIn st.writes w = true ∧
      Keeps st post ∧ w.op = op.id ∧ w.author = op.author ∧
      op.action = .write w.space w.entry w.actor w.epoch w.deps w.branch w.via ∧
      (∀ x ∈ st.writes, x.op ≠ w.op) ∧ onBranch st.writes w = true) ∨
    (∃ keep mid, op.action.keep? = some keep ∧ post = dropUnseen st mid keep ∧ mid.writes = st.writes) := by
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .addVault _ _⟩
  · -- addOwner
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl rfl (fun _ hp => List.mem_append_left _ hp) (fun _ hd => hd)⟩
  · -- removeOwner
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl⟩)
  · -- setThreshold
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl rfl (fun _ hp => hp) (fun _ hd => hd)⟩
  · -- addDevice
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl rfl (fun _ hp => hp) (fun _ hd => List.mem_append_left _ hd)⟩
  · -- removeDevice
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl⟩)
  · -- setRoot
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl rfl (fun _ hp => hp) (fun _ hd => hd)⟩
  · -- foundSpace
    simp at h
    obtain ⟨-, rfl⟩ := h
    exact .inl ⟨rfl, .addSpace _ _⟩
  · -- grant
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_vaults rfl (fun _ _ h => h) (fun _ hg => List.mem_append_left _ hg)⟩
  · -- revoke
    split at h
    · simp at h
    · rename_i keep _ heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl⟩)
  · -- write: the space may gain the entry
    rename_i heq
    split at h
    · simp at h
    · simp at h
      obtain ⟨hfresh, ⟨hact, hhold⟩, -, hdeps, hbr, rfl⟩ := h
      refine .inr (.inl ⟨_, ?_, by simp [authorized, hact, hhold], hdeps, ?_, rfl, rfl, heq, hfresh, hbr⟩)
      · split <;> rfl
      · split
        · exact .of_vaults rfl (fun _ _ h => h) (fun _ h => h)
        · exact .mapSpaces rfl rfl rfl (fun _ => by split <;> rfl) (fun _ => by split <;> rfl)
  · -- keys
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_vaults rfl (fun _ _ h => h) (fun _ h => h)⟩
  · -- publish
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_vaults rfl (fun _ _ h => h) (fun _ h => h)⟩
  · -- checkpoint
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, rfl⟩ := h
    exact .inl ⟨rfl, .of_vaults rfl (fun _ _ h => h) (fun _ h => h)⟩

/-- An accepted op only takes grants away, or adds one grant that names a vault or Public, Public only with read. -/
theorem apply_grants {st post : State} {op : Op} (h : apply st op = some post) :
    (∀ g ∈ post.grants, g ∈ st.grants) ∨
    (∃ g, post.grants = st.grants ++ [g] ∧ (∀ s, g.grantee ≠ .principal (.signer s)) ∧
      (g.grantee = .«public» → g.role = .read)) := by
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨-, -, -, -, rfl⟩ := h
    exact .inl fun _ h => h
  · -- addOwner
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, -, rfl⟩ := h
      exact .inl fun _ h => h
  · -- removeOwner
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl fun _ h => h
  · -- setThreshold
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl fun _ h => h
  · -- addDevice
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl fun _ h => h
  · -- removeDevice
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl fun _ h => h
  · -- setRoot
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl fun _ h => h
  · -- foundSpace
    simp at h
    obtain ⟨-, rfl⟩ := h
    exact .inl fun _ h => h
  · -- grant
    rename_i g _ _
    simp at h
    obtain ⟨-, hname, -, -, rfl⟩ := h
    refine .inr ⟨g, rfl, fun s hs => ?_, fun hp => ?_⟩
    · rw [hs] at hname
      cases hname
    · rw [hp] at hname
      simpa using hname
  · -- revoke: the grant and those resting on it end
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl fun _ h => (List.mem_filter.1 h).1
  · -- write
    split at h
    · simp at h
    · simp at h
      obtain ⟨-, -, -, -, -, rfl⟩ := h
      left
      split
      · exact fun _ h => h
      · exact fun _ h => h
  · -- keys
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, rfl⟩ := h
    exact .inl fun _ h => h
  · -- publish
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, rfl⟩ := h
    exact .inl fun _ h => h
  · -- checkpoint
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, rfl⟩ := h
    exact .inl fun _ h => h

/-! ## What one step does to the schema lane -/

/-- An accepted op leaves the lane alone, or publishes one blob into a space's lane: its author acts for a vault
    holding owner on the space. -/
theorem apply_lane {st post : State} {op : Op} (h : apply st op = some post) :
    post.lane = st.lane ∨
    ∃ sp actor blob via, op.action = .publish sp actor blob via ∧ actsVia st op.author via actor = true ∧
      holds st actor (.space sp) .owner = true ∧ post.lane = st.lane ++ [(sp, blob)] := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try exact .inl rfl)
  -- only an accepted publish is left
  rename_i sp actor blob via heq _ hok
  simp only [Bool.or_eq_true, Bool.not_eq_true', not_or, Bool.not_eq_false] at hok
  exact .inr ⟨sp, actor, blob, via, heq, hok.1, hok.2, rfl⟩

/-! ## Replay, runs and resolve -/

/-- What holds at the start and is kept by every accepted step holds after any replay. -/
theorem replay_inv (P : State → Prop) (hstep : ∀ st st' op, P st → step st op = some st' → P st') :
    ∀ (ops : List Op) (st : State), P st → P (replay st ops)
  | [], _, h => h
  | op :: ops, st, h => by
    show P (replay ((step st op).getD st) ops)
    cases hs : step st op with
    | none => exact replay_inv P hstep ops st h
    | some st' => exact replay_inv P hstep ops st' (hstep st st' op h hs)

/-- A run ends in the replay of the ops that stood in it. -/
theorem runFrom_fst (rem : List Op) (cs : List (Nat × List OpId × List Fact)) :
    ∀ (st : State) (l : List (Op × Nat)), (runFrom rem cs st l).1 = replay st (runFrom rem cs st l).2
  | _, [] => rfl
  | st, (op, i) :: rest => by
    unfold runFrom
    split
    · exact runFrom_fst rem cs st rest
    · split
      · rename_i st' _ hs
        show _ = replay ((step st op).getD st) _
        rw [hs]
        exact runFrom_fst rem cs st' rest
      · exact runFrom_fst rem cs st rest

/-- The ops that stand in a run are among the ops it ran. -/
theorem runFrom_snd_mem (rem : List Op) (cs : List (Nat × List OpId × List Fact)) :
    ∀ (st : State) (l : List (Op × Nat)), ∀ o ∈ (runFrom rem cs st l).2, o ∈ l.map Prod.fst
  | _, [] => by simp [runFrom]
  | st, (op, i) :: rest => by
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

/-- The ops that stand in what a peer knows are among the ops it holds. -/
theorem standing_mem (ops : List Op) : ∀ o ∈ standing ops, o ∈ ops := fun o ho => by
  have h := runFrom_snd_mem _ _ _ _ o ho
  rw [List.zipIdx_map_fst] at h
  exact (List.mem_filter.1 (List.mem_mergeSort.1 h)).1

/-- Every write a replay holds was there at the start, or a write op it replayed made it, with the op's id and
    author. -/
theorem replay_writes_from :
    ∀ (l : List Op) (st : State) (w : Write), w ∈ (replay st l).writes → w ∈ st.writes ∨
      ∃ o ∈ l, o.id = w.op ∧ o.author = w.author ∧
        o.action = .write w.space w.entry w.actor w.epoch w.deps w.branch w.via
  | [], _, _, h => .inl h
  | op :: ops, st, w, h => by
    change w ∈ (replay ((step st op).getD st) ops).writes at h
    rcases replay_writes_from ops _ w h with h | ⟨o, ho, hrest⟩
    · cases hs : step st op with
      | none => rw [hs] at h; exact .inl h
      | some st' =>
        rw [hs] at h
        unfold step at hs
        obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 hs
        change w ∈ (settle st post).writes at h
        rw [settle_writes] at h
        rcases apply_writes hpost with ⟨hws, -⟩ | ⟨w', hws, -, -, -, hid, hauth, hact, -⟩ | ⟨keep, mid, -, rfl, hmid⟩
        · exact .inl (hws ▸ h)
        · rw [hws] at h
          rcases List.mem_append.1 h with h | h
          · exact .inl h
          · rw [List.mem_singleton] at h
            subst h
            exact .inr ⟨op, List.mem_cons_self, hid.symm, hauth.symm, hact⟩
        · exact .inl (hmid ▸ (List.mem_filter.1 ((closeDeps_sublist _).subset h)).1)
    · exact .inr ⟨o, List.mem_cons_of_mem _ ho, hrest⟩

/-- Every removal `resolve` picks stands in the run with the removals it picks: the fold only ever keeps a list
    whose run accepts all of it. -/
theorem resolve_stands (ops : List Op) :
    ∀ r ∈ resolve ops, (runWith ops (resolve ops)).2.any (·.id == r.id) = true := by
  unfold resolve
  refine foldl_inv (fun rem => ∀ r ∈ rem, (runWith ops rem).2.any (·.id == r.id) = true) _ (fun rem r h => ?_) _ []
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

end AvenDB
