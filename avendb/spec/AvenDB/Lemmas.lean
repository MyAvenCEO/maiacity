import AvenDB.Claims

/-!
# Vaults and writes

The proofs of the theorems about vaults (T2, T3, T21 and that devices don't govern), about who writes (T1), the shares'
grantees (T4, T8), causal closure (T14) and the schema lane, read off the entries (T17), stated as in `Theorems.lean`.

Settling keys changes only the epochs, the seals and what is published, so a step changes everything else only through
`apply`: it adds a vault or changes one (`VaultChange`), adds a share, an entry or a write, or drops writes and entries
(`dropUnseen`). Without cycles, `owns` finds every chain of owners, so the check on a new owner refuses every owner that
would close a cycle. Authorization reads only the vaults, the shares, which shares are revoked, `narrow` and the
entries' vaults and audiences, so an edit that only adds to these keeps every write authorized (`Keeps`); every other
edit is a removal, and `dropUnseen` keeps a write that lost its authorization only if the removal had seen it.
`dropUnseen` keeps or drops all the entries of one id together, so no lemma here needs entry ids to be unique, but
that a write leaves the lane alone (T17), which a write's change to the one entry of its id gives.
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

/-- Settling keys leaves the shares alone. -/
theorem settle_shares (pre post : State) : (settle pre post).shares = post.shares :=
  settle_same State.shares (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys revokes nothing. -/
theorem settle_revoked (pre post : State) : (settle pre post).revoked = post.revoked :=
  settle_same State.revoked (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the entries alone. -/
theorem settle_entries (pre post : State) : (settle pre post).entries = post.entries :=
  settle_same State.entries (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves the writes alone. -/
theorem settle_writes (pre post : State) : (settle pre post).writes = post.writes :=
  settle_same State.writes (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

/-- Settling keys leaves alone which writes readers don't count. -/
theorem settle_uncounted (pre post : State) : (settle pre post).uncounted = post.uncounted :=
  settle_same State.uncounted (fun _ _ _ => rfl) (fun _ _ => rfl) (fun _ _ => rfl) pre post

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

/-- A vault fits as an owner only if it exists. -/
theorem ownerFits_vault {st : State} {k : Kind} {o : VaultId} (h : ownerFits st k (.vault o) = true) :
    (st.vault? o).isSome = true := by
  simp only [ownerFits] at h
  cases ho : st.vault? o with
  | none => rw [ho] at h; cases h
  | some _ => rfl

/-- What a genesis checks of its first owners by the kind's table: there is one at least, no more than the kind takes,
    and each may own one more of the kind. -/
def OwnersFit (st : State) (kind : Kind) (owners : List Principal) : Prop :=
  owners ≠ [] ∧ kind.rules.takes owners.length = true ∧ ∀ p ∈ owners, roomFor st kind p = true

/-! ## What one step does to the vaults -/

/-- How an accepted edit changes an existing vault `vt` of id `v` into `vt'`, with what the edit had to carry. -/
inductive VaultChange (st : State) (sigs : List SignerId) (v : VaultId) (vt : Vault) : Vault → Prop where
  | shareOwner (p : Principal) : p ∉ vt.owners → ownerFits st vt.kind p = true →
      vt.kind.rules.takes (vt.owners.length + 1) = true → roomFor st vt.kind p = true →
      (∀ x, p = .vault x → x ≠ v ∧ owns st v x = false) →
      approves st sigs (.vault v) = true → approves st sigs p = true →
      VaultChange st sigs v vt { vt with owners := vt.owners ++ [p] }
  | revokeOwner (p : Principal) : p ∈ vt.owners → 1 < vt.owners.length →
      (approves st sigs (.vault v) = true ∨ approves st sigs p = true) →
      VaultChange st sigs v vt
        { vt with owners := vt.owners.erase p, threshold := min vt.threshold (vt.owners.erase p).length }
  | settingsThreshold (n : Nat) : approves st sigs (.vault v) = true →
      VaultChange st sigs v vt { vt with threshold := n }
  | shareDevice (d : SignerId) : vt.kind.hasDevices = true → approves st sigs (.vault v) = true → d ∈ sigs →
      VaultChange st sigs v vt { vt with devices := vt.devices ++ [d] }
  | revokeDevice (d : SignerId) : (approves st sigs (.vault v) = true ∨ d ∈ sigs) →
      VaultChange st sigs v vt { vt with devices := vt.devices.erase d }
  /-- The owners hand the root on, or it steps down: the vault's threshold approved, and the new root signed. -/
  | settingsRoot (r : Option SignerId) : approves st sigs (.vault v) = true → r.all sigs.contains = true →
      (r.isSome = true → vt.kind = .human) → VaultChange st sigs v vt { vt with root := r }

/-- A change to a vault keeps its id. -/
theorem VaultChange.id {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : vt'.id = vt.id := by
  cases h <;> rfl

/-- An accepted edit leaves the vaults as they were, appends a new one, or changes one existing vault. -/
theorem apply_vaults {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.vaults = st.vaults ∨
    (∃ v kind owners threshold root, st.vault? v = none ∧ (∀ p ∈ owners, ownerFits st kind p = true) ∧
      rootFits kind edit.sigs root = true ∧ OwnersFit st kind owners ∧
      post.vaults = st.vaults ++ [⟨v, kind, owners, threshold, [], root⟩]) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st edit.sigs v vt vt' ∧
      post.vaults = (setVault st vt').vaults) := by
  unfold apply at h
  split at h
  · -- genesis
    simp at h
    obtain ⟨⟨⟨hnone, hne⟩, -⟩, ⟨hfit, hroot⟩, ⟨htakes, hroom⟩, -, -, rfl⟩ := h
    exact .inr (.inl ⟨_, _, _, _, _, hnone, hfit, hroot, ⟨hne, htakes, hroom⟩, rfl⟩)
  · -- a new owner
    split at h
    · simp at h
    · rename_i v p _ _ vt hv
      simp at h
      obtain ⟨⟨hnot, hfit⟩, ⟨htakes, hroom⟩, hcyc, ⟨hv', hp⟩, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .shareOwner p hnot hfit htakes hroom ?_ hv' hp, rfl⟩)
      intro x hx
      subst hx
      simpa using hcyc
  · -- an owner revoked
    split at h
    · simp at h
    · rename_i v p keep _ _ vt hv
      simp at h
      obtain ⟨⟨hmem, hlen⟩, happ, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .revokeOwner p hmem hlen ?_, rfl⟩)
      cases h1 : approves st edit.sigs (.vault v)
      · exact .inr (happ h1)
      · exact .inl rfl
  · -- the threshold
    split at h
    · simp at h
    · rename_i v n _ _ vt hv
      simp at h
      obtain ⟨⟨-, happ⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .settingsThreshold n happ, rfl⟩)
  · -- a new device
    split at h
    · simp at h
    · rename_i v d _ _ vt hv
      simp at h
      obtain ⟨⟨hk, -⟩, ⟨happ, hd⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .shareDevice d hk happ hd, rfl⟩)
  · -- a device revoked
    split at h
    · simp at h
    · rename_i v d keep _ _ vt hv
      simp at h
      obtain ⟨-, happ, rfl⟩ := h
      refine .inr (.inr ⟨v, vt, _, hv, .revokeDevice d ?_, rfl⟩)
      cases h1 : approves st edit.sigs (.vault v)
      · exact .inr (happ h1)
      · exact .inl rfl
  · -- the root
    split at h
    · simp at h
    · rename_i v r keep _ _ vt hv
      simp at h
      obtain ⟨⟨⟨hroot, hnew⟩, hhuman⟩, rfl⟩ := h
      exact .inr (.inr ⟨v, vt, _, hv, .settingsRoot r hroot hnew hhuman, rfl⟩)
  case h_13 =>
    -- a claim changes one share alone
    obtain ⟨-, -, -, -, -, -, -, -, -, rfl⟩ := applyClaim_some h
    exact .inl rfl
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
      rootFits kind edit.sigs root = true ∧ OwnersFit st kind owners ∧
      ∀ x, st'.vault? x = if x = v then some ⟨v, kind, owners, threshold, [], root⟩ else st.vault? x) ∨
    (∃ v vt vt', st.vault? v = some vt ∧ VaultChange st edit.sigs v vt vt' ∧
      ∀ x, st'.vault? x = if x = v then some vt' else st.vault? x) := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  have hs : ∀ x, (settle st post).vault? x = post.vault? x := vault?_congr (settle_vaults st post)
  rcases apply_vaults hpost with hv | ⟨v, kind, owners, threshold, root, hnone, hfit, hroot, hcount, hv⟩ |
    ⟨v, vt, vt', hvt, hch, hv⟩
  · exact .inl fun x => by rw [hs, vault?_congr hv]
  · refine .inr (.inl ⟨v, kind, owners, threshold, root, hnone, hfit, hroot, hcount, fun x => ?_⟩)
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
  rcases step_vault? h with hsame | ⟨w, _, _, _, _, hw, -, -, -, hlook⟩ | ⟨w, vtw, vtw', hw, hch, hlook⟩
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
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, hnone, hfit, -, -, hlook⟩ |
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
      | shareOwner p _ hfit _ _ _ _ _ =>
        rcases List.mem_append.1 ho with ho | ho
        · exact hex _ _ hvt _ ho
        · rw [List.mem_singleton] at ho; subst ho; exact ownerFits_vault hfit
      | revokeOwner p _ _ _ => exact hex _ _ hvt _ (List.mem_of_mem_erase ho)
      | settingsThreshold _ _ => exact hex _ _ hvt _ ho
      | shareDevice _ _ _ _ => exact hex _ _ hvt _ ho
      | revokeDevice _ _ => exact hex _ _ hvt _ ho
      | settingsRoot _ _ _ _ => exact hex _ _ hvt _ ho
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
      | shareOwner p _ _ _ _ hcyc _ _ =>
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
      | revokeOwner p _ _ _ => exact hmono fun a ha => List.mem_of_mem_erase ha
      | settingsThreshold _ _ => exact hmono fun a ha => ha
      | shareDevice _ _ _ _ => exact hmono fun a ha => ha
      | revokeDevice _ _ => exact hmono fun a ha => ha
      | settingsRoot _ _ _ => exact hmono fun a ha => ha
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
  rcases step_vault? h with hsame | ⟨v, _, _, _, _, hnone, -, -, -, hlook⟩ | ⟨v, vt, vt', hvt, hch, hlook⟩
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
  cases p with
  | signer _ => exact hp
  | vault o =>
    simp only [ownerFits] at hp ⊢
    cases hv : st.vault? o with
    | none => rw [hv] at hp; cases hp
    | some ot =>
      rw [hv] at hp
      obtain ⟨ot', hv', hk⟩ := step_kinds h hv
      rw [hv']
      simp only [Option.any_some] at hp ⊢
      rw [hk]
      exact hp

/-- One step keeps every vault the shape of its kind. -/
theorem kindsFit_step {st st' : State} {edit : Edit} (hk : KindsFit st) (h : step st edit = some st') :
    KindsFit st' := by
  intro x u hx
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, -, hfit, hroot, -, hlook⟩ |
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
      | shareOwner p _ hfit _ _ _ _ _ =>
        refine ⟨fun q hq => ?_, hd, hr⟩
        rcases List.mem_append.1 hq with hq | hq
        · exact ownerFits_step h (ho q hq)
        · rw [List.mem_singleton] at hq
          subst hq
          exact ownerFits_step h hfit
      | revokeOwner p _ _ _ => exact ⟨fun q hq => ownerFits_step h (ho q (List.mem_of_mem_erase hq)), hd, hr⟩
      | settingsThreshold _ _ => exact ⟨fun q hq => ownerFits_step h (ho q hq), hd, hr⟩
      | shareDevice _ hkd _ _ => exact ⟨fun q hq => ownerFits_step h (ho q hq), fun _ => hkd, hr⟩
      | revokeDevice d _ =>
        refine ⟨fun q hq => ownerFits_step h (ho q hq), fun hne => hd fun hnil => hne ?_, hr⟩
        simp [hnil]
      | settingsRoot r _ _ hhuman =>
        refine ⟨fun q hq => ownerFits_step h (ho q hq), hd, fun hne => hhuman ?_⟩
        cases r with
        | none => exact absurd rfl hne
        | some _ => rfl
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

`authorized` reads the vaults (who acts for which), the shares, which of them are revoked, `narrow`, the entries (their
vault) and the audience each write was accepted in, and never the other writes, the thresholds, the roots or the keys. A
state that keeps all of these keeps every write authorized. -/

/-- `st'` keeps what `authorized` reads in `st`: every vault with its owners and devices, every share, no share revoked
    or audience narrowed that wasn't, and every entry with its vault and audience. -/
structure Keeps (st st' : State) : Prop where
  vaults : ∀ x vt, st.vault? x = some vt → ∃ vt', st'.vault? x = some vt' ∧
    (∀ p ∈ vt.owners, p ∈ vt'.owners) ∧ ∀ d ∈ vt.devices, d ∈ vt'.devices
  /-- Every share but one naming an invite key, which a claim may turn into a vault's. -/
  shares : ∀ c ∈ st.shares, c.who.invite? = none → c ∈ st'.shares
  revoked : ∀ c ∈ st'.revoked, c ∈ st.revoked
  narrow : ∀ x ∈ st'.narrow, x ∈ st.narrow
  entries : ∀ e en, st.entry? e = some en →
    ∃ en', st'.entry? e = some en' ∧ en'.vault = en.vault ∧ en'.audience = en.audience

/-- Keeping what `authorized` reads is transitive. -/
theorem Keeps.trans {a b c : State} (h₁ : Keeps a b) (h₂ : Keeps b c) : Keeps a c where
  vaults x vt hx := by
    obtain ⟨vt₁, hx₁, ho₁, hd₁⟩ := h₁.vaults x vt hx
    obtain ⟨vt₂, hx₂, ho₂, hd₂⟩ := h₂.vaults x vt₁ hx₁
    exact ⟨vt₂, hx₂, fun p hp => ho₂ p (ho₁ p hp), fun d hd => hd₂ d (hd₁ d hd)⟩
  shares c hc hi := h₂.shares c (h₁.shares c hc hi) hi
  revoked c hc := h₁.revoked c (h₂.revoked c hc)
  narrow x hx := h₁.narrow x (h₂.narrow x hx)
  entries e en h := by
    obtain ⟨en₁, h₁', hv₁, hc₁⟩ := h₁.entries e en h
    obtain ⟨en₂, h₂', hv₂, hc₂⟩ := h₂.entries e en₁ h₁'
    exact ⟨en₂, h₂', hv₂.trans hv₁, hc₂.trans hc₁⟩

/-- A state that changes none of what `authorized` reads but the entries, whose lookups it keeps, keeps it all. -/
theorem Keeps.of_entries {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.shares = st.shares)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow)
    (he : ∀ e en, st.entry? e = some en → st'.entry? e = some en) : Keeps st st' where
  vaults x vt hx := ⟨vt, by rw [vault?_congr hv]; exact hx, fun _ h => h, fun _ h => h⟩
  shares _ h _ := hc ▸ h
  revoked _ h := hr ▸ h
  narrow _ h := hn ▸ h
  entries e en h := ⟨en, he e en h, rfl, rfl⟩

/-- A state that changes none of what `authorized` reads keeps it. -/
theorem Keeps.of_eq {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.shares = st.shares)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow) (he : st'.entries = st.entries) : Keeps st st' :=
  .of_entries hv hc hr hn fun e en h => by simp only [State.entry?, he]; exact h

/-- Settling keys keeps everything. -/
theorem Keeps.settle (pre post : State) : Keeps post (settle pre post) :=
  .of_eq (settle_vaults pre post) (settle_shares pre post) (settle_revoked pre post) (settle_narrow pre post)
    (settle_entries pre post)

/-- A new vault keeps the others. -/
theorem Keeps.addVault (st : State) (vt : Vault) : Keeps st { st with vaults := st.vaults ++ [vt] } where
  vaults x y hy := ⟨y, by simp only [State.vault?, List.find?_append] at hy ⊢; rw [hy]; rfl,
    fun _ h => h, fun _ h => h⟩
  shares _ h _ := h
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
  shares _ h _ := h
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- A new share keeps the others. -/
theorem Keeps.addShare (st : State) (c : Share) : Keeps st { st with shares := st.shares ++ [c] } where
  vaults _ vt hx := ⟨vt, hx, fun _ h => h, fun _ h => h⟩
  shares _ h _ := List.mem_append_left _ h
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- A claim keeps every share but the invite it turns into a vault's. -/
theorem Keeps.claim (st : State) (c : ShareId) (v : VaultId) : Keeps st (st.claimShare c v) where
  vaults _ vt hx := ⟨vt, hx, fun _ h => h, fun _ h => h⟩
  shares x hx hi := List.mem_map.2 ⟨x, hx, claimed_self hi⟩
  revoked _ h := h
  narrow _ h := h
  entries _ en h := ⟨en, h, rfl, rfl⟩

/-- A share a vault holds names that vault, and no invite key. -/
theorem holdsShare_invite {st : State} {a : VaultId} {cp : Share} {r : Level} (h : holdsShare st a cp r = true) :
    cp.who.invite? = none := by
  unfold holdsShare at h
  simp only [Bool.and_eq_true, beq_iff_eq] at h
  rw [h.1.2]; rfl

/-- Changing an entry keeps the entries when it keeps its vault and its audience. -/
theorem Keeps.setEntry {st : State} {en en' : Entry} (hen : st.entry? en'.id = some en) (hv : en'.vault = en.vault)
    (hc : en'.audience = en.audience) : Keeps st (setEntry st en') where
  vaults _ vt hx := ⟨vt, hx, fun _ h => h, fun _ h => h⟩
  shares _ h _ := h
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

/-- A state that keeps the shares and revokes none keeps every share held. -/
theorem holdsShare_keeps {st st' : State} (hk : Keeps st st') {a : VaultId} {cp : Share} {r : Level}
    (hcp : cp ∈ st.shares) (h : holdsShare st a cp r = true) : holdsShare st' a cp r = true := by
  unfold holdsShare State.live at h ⊢
  simp only [Bool.and_eq_true, Bool.not_eq_true', List.any_eq_true, beq_iff_eq] at h ⊢
  obtain ⟨⟨⟨-, hrev⟩, hg⟩, hr⟩ := h
  refine ⟨⟨⟨⟨cp, hk.shares cp hcp (by rw [hg]; rfl), rfl⟩, ?_⟩, hg⟩, hr⟩
  cases hc : st'.revoked.contains cp.id with
  | false => rfl
  | true =>
    rw [List.contains_iff_mem] at hc
    have := List.contains_iff_mem.2 (hk.revoked _ hc)
    rw [hrev] at this
    cases this

/-- A state that narrows no audience keeps every share reaching an entry that keeps its vault, id and audience. -/
theorem inAudience_keeps {st st' : State} (hk : Keeps st st') {cp : Share} {en en' : Entry} (hid : en'.id = en.id)
    (hv : en'.vault = en.vault) (hc : en'.audience = en.audience) (h : inAudience st cp en = true) :
    inAudience st' cp en' = true := by
  unfold inAudience at h ⊢
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
      ⟨cp, hk.shares cp hcp (holdsShare_invite hh), holdsShare_keeps hk hcp hh,
        inAudience_keeps (en := { en with stays := [(w.stay, w.audience)] })
          (en' := { en' with stays := [(w.stay, w.audience)] }) hk hid hv rfl hin⟩

/-- Who acts for which vault reads only the vaults. -/
theorem actsVia_congr {st st' : State} (hv : st'.vaults = st.vaults) (s : SignerId) :
    ∀ via v, actsVia st' s via v = actsVia st s via v
  | [], v => by simp only [actsVia, member, vault?_congr hv]
  | o :: via, v => by simp only [actsVia, ownerOf, vault?_congr hv, actsVia_congr hv s via o]

/-- Authorization reads only the vaults, the shares, which are revoked, `narrow` and the write's entry. -/
theorem authorized_congr {st st' : State} (hv : st'.vaults = st.vaults) (hc : st'.shares = st.shares)
    (hr : st'.revoked = st.revoked) (hn : st'.narrow = st.narrow) {w : Write}
    (he : st'.entry? w.entry = st.entry? w.entry) : authorized st' w = authorized st w := by
  unfold authorized
  rw [actsVia_congr hv, he]
  cases st.entry? w.entry with
  | none => rfl
  | some en => simp only [mayWrite, holdsShare, State.live, inAudience, hc, hr, hn]

/-- Settling keys changes no write's authorization. -/
theorem authorized_settle (pre post : State) (w : Write) : authorized (settle pre post) w = authorized post w :=
  authorized_congr (settle_vaults pre post) (settle_shares pre post) (settle_revoked pre post) (settle_narrow pre post)
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
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.audience = true) ∨
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
    obtain ⟨-, -, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .addVault _ _, same st⟩
  · -- a new owner
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, -, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => List.mem_append_left _ hp) (fun _ hd => hd), same st⟩
  · -- an owner revoked
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- the threshold
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => hd), same st⟩
  · -- a new device
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => List.mem_append_left _ hd), same st⟩
  · -- a device revoked
    split at h
    · simp at h
    · rename_i keep heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- the root: a removal by `keep?`, but it changes only a root, which authorization doesn't read
    split at h
    · simp at h
    · rename_i hv
      simp at h
      obtain ⟨-, rfl⟩ := h
      exact .inl ⟨rfl, .setVault hv rfl (fun _ hp => hp) (fun _ hd => hd), same st⟩
  · -- a grant
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, -, -, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .addShare _ _, same st⟩
  · -- revoke
    split at h
    · simp at h
    · rename_i keep _ heq _ _ _
      simp at h
      obtain ⟨-, -, rfl⟩ := h
      exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, same st⟩))
  · -- write
    rename_i v e actor stay epoch deps proposal via create tags proof touches fits defines heq
    dsimp only at h
    split at h
    · cases h
    · rename_i hact
      have hact := of_not_or_not hact
      split at h
      · -- a new entry, with its first write
        rename_i x hdr
        simp at h
        obtain ⟨-, ⟨-, hmc⟩, rfl⟩ := h
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
              obtain ⟨hdeps, -, rfl⟩ := h
              refine .inr (.inr (.inl ⟨⟨edit.id, edit.author, actor, e, stay, epoch, deps, proposal, via, false,
                en.audience⟩, ?_, ?_, ?_, rfl, ?_, of_not_not hdeps⟩))
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
              · simpa [authorized, hact, hen, mayWrite, inAudience, Entry.audience] using hok
  · -- a mark: a removal where it takes the entry to another audience, else only the wants change
    split at h
    · simp at h
    · rename_i keep _ heq _ _ _
      -- each check refuses, or the mark ends in one of four ways
      split at h
      · cases h
      split at h
      · cases h
      split at h
      · cases h
      split at h
      · cases h
      split at h
      · cases h
        exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, setEntry_ids _ _⟩))
      · cases h
        exact .inr (.inr (.inr ⟨keep, _, by rw [heq]; rfl, rfl, rfl, setEntry_ids _ _⟩))
      · cases h
        exact .inl ⟨rfl, .of_eq rfl rfl rfl rfl rfl, same st⟩
      · cases h
  · -- keys: change nothing
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, -, -, rfl⟩ := h
    exact .inl ⟨rfl, .of_eq rfl rfl rfl rfl rfl, same st⟩
  · -- a claim changes one share alone
    obtain ⟨-, -, -, -, -, -, -, -, -, rfl⟩ := applyClaim_some h
    exact .inl ⟨rfl, .claim _ _ _, same st⟩

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

/-! ## What one step does to the shares -/

/-- An accepted edit leaves the shares alone (a revocation only marks shares revoked), or adds one share that names a
    vault or everyone, or is a keep share and names a device of its issuer; everyone only with read. -/
theorem apply_shares {st post : State} {edit : Edit} (h : apply st edit = some post) :
    post.shares = st.shares ∨
    (∃ c, post.shares = st.shares ++ [c] ∧ c.who.isDevice = c.level.isKeep ∧
      (∀ d, c.who = .device d → isDevice st d c.issuer = true) ∧ (c.who = .everyone → c.level = .read)) ∨
    (∃ c v, post.shares = st.shares.map (Share.claimed c v)) := by
  unfold apply at h
  split at h
  case h_8 c via _ =>
    simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
    obtain ⟨-, hkd, hname, -, hdev, -, -, rfl⟩ := h
    refine .inr (.inl ⟨c, rfl, (by simpa using hkd : c.level.isKeep = c.who.isDevice).symm, fun d hd => ?_,
      fun hp => ?_⟩)
    · rw [hd] at hdev
      simpa [Who.device?] using hdev
    · rw [hp] at hname
      simpa using hname
  case h_13 =>
    -- a claim turns one invite into a vault's share
    obtain ⟨-, -, -, -, -, -, -, -, -, rfl⟩ := applyClaim_some h
    exact .inr (.inr ⟨_, _, rfl⟩)
  -- every other edit leaves the shares alone
  all_goals
    dsimp only at h
    repeat' split at h
    all_goals cases h
    all_goals exact .inl rfl

/-! ## What one step does to the schema lane

The lane reads, of the entries, their ids, vaults, types and blobs, and which of their first writes readers count
(`inLane`). Only a creation sets a type or a blob, and readers never start counting a write they didn't. -/

theorem mem_counted {st : State} {w : Write} : w ∈ st.counted ↔ w ∈ st.writes ∧ w.edit ∉ st.uncounted := by
  simp [State.counted]

/-- Readers keep not counting what they didn't count. -/
theorem counting_sup (st : State) (ok : Bool) (i : EditId) {d : EditId} (hd : d ∈ st.uncounted) :
    d ∈ st.counting ok i := by
  unfold State.counting
  split
  · exact hd
  · exact List.mem_append_left _ hd

theorem mem_counting {st : State} {ok : Bool} {i d : EditId} (hd : d ≠ i) :
    d ∈ st.counting ok i ↔ d ∈ st.uncounted := by
  unfold State.counting
  split
  · exact Iff.rfl
  · simp [hd]

theorem inLane_iff {st : State} {v : VaultId} {en : Entry} :
    inLane st v en = true ↔ en.vault = v ∧ en.attrs.type ∈ schemaTypes ∧
      ∃ w ∈ st.counted, w.entry = en.id ∧ w.first = true ∧ w.actor = v ∧ w.proposal = .main := by
  simp only [inLane, Bool.and_eq_true, beq_iff_eq, List.contains_eq_mem, decide_eq_true_eq, List.any_eq_true,
    and_assoc]

theorem mem_laneOf {st : State} {v : VaultId} {b : BlobId} :
    b ∈ laneOf st v ↔ ∃ en ∈ st.entries, inLane st v en = true ∧ en.blob = b := by
  simp only [laneOf, List.mem_eraseDups, List.mem_map, List.mem_filter, and_assoc]

/-- The lane reads only the entries, the writes and which of them readers don't count. -/
theorem laneOf_congr {st st' : State} (he : st'.entries = st.entries) (hw : st'.writes = st.writes)
    (hu : st'.uncounted = st.uncounted) : laneOf st' = laneOf st := by
  have hin : inLane st' = inLane st := by
    funext v en
    simp only [inLane, State.counted, hw, hu]
  funext v
  simp only [laneOf, hin, he]

/-- Settling keys leaves every lane alone. -/
theorem laneOf_settle (pre post : State) : laneOf (settle pre post) = laneOf post :=
  laneOf_congr (settle_entries pre post) (settle_writes pre post) (settle_uncounted pre post)

/-- A write that isn't a first write, with a new id, leaves every lane alone, whether its readers count it or not. -/
theorem laneOf_addWrite {st : State} {w : Write} {ok : Bool} {i : EditId} {acc : List EditId}
    {df : List (EditId × CapGroup)} (hf : w.first = false) (hfresh : ∀ x ∈ st.writes, x.edit ≠ i) :
    laneOf { st with writes := st.writes ++ [w], uncounted := st.counting ok i, accepts := acc, defs := df } =
      laneOf st := by
  have hin : ∀ v,
      inLane { st with writes := st.writes ++ [w], uncounted := st.counting ok i, accepts := acc, defs := df } v =
        inLane st v := by
    intro v
    funext en
    apply Bool.eq_iff_iff.2
    simp only [inLane_iff, mem_counted, List.mem_append, List.mem_singleton]
    refine and_congr_right fun _ => and_congr_right fun _ => ⟨?_, ?_⟩
    · rintro ⟨x, ⟨hx | rfl, hxu⟩, hxe, hxf, hxa⟩
      · exact ⟨x, ⟨hx, fun hu => hxu ((mem_counting (hfresh x hx)).2 hu)⟩, hxe, hxf, hxa⟩
      · rw [hf] at hxf
        cases hxf
    · rintro ⟨x, ⟨hx, hxu⟩, hxe, hxf, hxa⟩
      exact ⟨x, ⟨.inl hx, fun hu => hxu ((mem_counting (hfresh x hx)).1 hu)⟩, hxe, hxf, hxa⟩
  funext v
  simp only [laneOf, hin]

/-- Mapping entries to ones a filter judges alike and with the same blobs keeps the blobs it lets through. -/
theorem filter_map_blob {l : List Entry} {f : Entry → Entry} {p : Entry → Bool}
    (h : ∀ x ∈ l, p (f x) = p x ∧ (f x).blob = x.blob) :
    ((l.map f).filter p).map (·.blob) = (l.filter p).map (·.blob) := by
  induction l with
  | nil => rfl
  | cons x xs ih =>
    obtain ⟨hp, hb⟩ := h x (List.mem_cons_self ..)
    have ih := ih fun y hy => h y (List.mem_cons_of_mem _ hy)
    simp only [List.map_cons, List.filter_cons, hp]
    split
    · simp only [List.map_cons, hb, ih]
    · exact ih

/-- Changing the one entry of its id leaves every lane alone when it keeps its id, vault, type and blob. -/
theorem laneOf_setEntry {st : State} {en en' : Entry} (hone : ∀ x ∈ st.entries, x.id = en'.id → x = en)
    (hid : en'.id = en.id) (hv : en'.vault = en.vault) (ht : en'.attrs.type = en.attrs.type)
    (hb : en'.blob = en.blob) : laneOf (setEntry st en') = laneOf st := by
  funext v
  show ((((st.entries.map fun x => if x.id == en'.id then en' else x).filter (inLane st v)).map (·.blob))).eraseDups =
    (((st.entries.filter (inLane st v)).map (·.blob))).eraseDups
  rw [filter_map_blob fun x hx => ?_]
  split
  · rename_i hx'
    obtain rfl := hone x hx (beq_iff_eq.1 hx')
    refine ⟨?_, hb⟩
    simp only [inLane, hid, hv, ht]
  · exact ⟨rfl, rfl⟩

/-- `post` keeps what the lane reads of `st`: each entry of `post` has one in `st` with its id, vault, type and blob,
    and readers counted in `st` each first write they count in `post`. -/
structure LaneKeeps (st post : State) : Prop where
  entries : ∀ en ∈ post.entries, ∃ x ∈ st.entries, x.id = en.id ∧ x.vault = en.vault ∧ x.attrs.type = en.attrs.type ∧
    x.blob = en.blob
  counted : ∀ w ∈ post.counted, w.first = true → w ∈ st.counted

/-- What is in a lane after is in it before. -/
theorem LaneKeeps.mem_lane {st post : State} (hk : LaneKeeps st post) {v : VaultId} {b : BlobId}
    (hb : b ∈ laneOf post v) : b ∈ laneOf st v := by
  obtain ⟨en, hen, hin, rfl⟩ := mem_laneOf.1 hb
  obtain ⟨hev, het, w, hw, hwe, hwf, hwa⟩ := inLane_iff.1 hin
  obtain ⟨x, hx, hid, hv, ht, hbl⟩ := hk.entries en hen
  exact mem_laneOf.2 ⟨x, hx, inLane_iff.2 ⟨hv.trans hev, ht ▸ het, w, hk.counted w hw hwf, hwe.trans hid.symm, hwf,
    hwa⟩, hbl⟩

theorem LaneKeeps.of_eq {st post : State} (he : post.entries = st.entries) (hw : post.writes = st.writes)
    (hu : post.uncounted = st.uncounted) : LaneKeeps st post where
  entries en hen := ⟨en, he ▸ hen, rfl, rfl, rfl, rfl⟩
  counted w hw' _ := by
    rw [mem_counted, hw, hu] at hw'
    exact mem_counted.2 hw'

theorem LaneKeeps.trans {a b c : State} (h₁ : LaneKeeps a b) (h₂ : LaneKeeps b c) : LaneKeeps a c where
  entries en hen := by
    obtain ⟨y, hy, hid, hv, ht, hb⟩ := h₂.entries en hen
    obtain ⟨x, hx, hid', hv', ht', hb'⟩ := h₁.entries y hy
    exact ⟨x, hx, hid'.trans hid, hv'.trans hv, ht'.trans ht, hb'.trans hb⟩
  counted w hw hf := h₁.counted w (h₂.counted w hw hf) hf

/-- A removal keeps what the lane reads: it only drops entries and writes. -/
theorem LaneKeeps.drop (pre post : State) (keep : List EditId) : LaneKeeps post (dropUnseen pre post keep) where
  entries en hen := ⟨en, dropUnseen_entries hen, rfl, rfl, rfl, rfl⟩
  counted w hw _ := by
    rw [mem_counted] at hw ⊢
    exact ⟨(dropUnseen_writes hw.1).1, hw.2⟩

/-- Changing an entry keeps what the lane reads when it keeps its vault, type and blob. -/
theorem LaneKeeps.setEntry {st : State} {en en' : Entry} (hen : st.entry? en'.id = some en)
    (hv : en'.vault = en.vault) (ht : en'.attrs.type = en.attrs.type) (hb : en'.blob = en.blob) :
    LaneKeeps st (setEntry st en') where
  entries y hy := by
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hy
    split
    · exact ⟨en, entry?_mem hen, entry?_id hen, hv.symm, ht.symm, hb.symm⟩
    · exact ⟨x, hx, rfl, rfl, rfl, rfl⟩
  counted _ hw _ := hw

/-- A write that isn't a first write keeps what the lane reads, while readers keep not counting what they didn't. -/
theorem LaneKeeps.addWrite {st : State} {w : Write} {u acc : List EditId} {df : List (EditId × CapGroup)}
    (hf : w.first = false) (hu : ∀ d ∈ st.uncounted, d ∈ u) :
    LaneKeeps st { st with writes := st.writes ++ [w], uncounted := u, accepts := acc, defs := df } where
  entries en hen := ⟨en, hen, rfl, rfl, rfl, rfl⟩
  counted x hx hxf := by
    rw [mem_counted] at hx
    obtain ⟨hx, hxu⟩ := hx
    rcases List.mem_append.1 hx with hx | hx
    · exact mem_counted.2 ⟨hx, fun h => hxu (hu _ h)⟩
    · rw [List.mem_singleton] at hx
      subst hx
      rw [hf] at hxf
      cases hxf

/-- An accepted edit keeps what the lane reads, or creates an entry with its first write, on the main line or as a draft
    starting its own line, whose author acted for its actor, while readers keep not counting what they didn't. -/
theorem apply_lane {st post : State} {edit : Edit} (h : apply st edit = some post) :
    LaneKeeps st post ∨
    ∃ v e actor epoch proposal via x hdr tags proof touches fits defines,
      edit.action = .write v e actor none epoch [] proposal via (some (x, hdr)) tags proof touches fits defines ∧
      proposal.isOn = false ∧ actsVia st edit.author via actor = true ∧ st.entry? e = none ∧
      (∃ en : Entry, en.id = e ∧ en.vault = v ∧ en.attrs.type = hdr.type ∧ en.blob = hdr.blob ∧
        post.entries = st.entries ++ [en]) ∧
      post.writes = st.writes ++ [⟨edit.id, edit.author, actor, e, none, epoch, [], proposal, via, true, x⟩] ∧
      post.uncounted = st.counting (creates st actor v x ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩ proof
        (proposal == .main) fits) edit.id := by
  unfold apply at h
  split at h
  case h_10 v e actor stay epoch deps proposal via create tags proof touches fits defines heq =>
    dsimp only at h
    split at h
    · cases h
    rename_i hact
    have hact := of_not_or_not hact
    split at h
    · -- a new entry, with its first write
      rename_i x hdr
      split at h
      · cases h
      rename_i hnew
      split at h
      · cases h
      cases h
      -- a creation of an entry there wasn't, on the main line or a draft's own, building on nothing
      have hnone : st.entry? e = none := by
        cases hx : st.entry? e
        · rfl
        · simp [hx] at hnew
      have hstay : stay = none := by
        cases stay
        · rfl
        · simp at hnew
      have hdeps : deps = [] := by
        cases deps
        · rfl
        · simp at hnew
      have hprop : proposal.isOn = false := by
        cases hp : proposal.isOn
        · rfl
        · simp [hp] at hnew
      subst hstay hdeps
      exact .inr ⟨v, e, actor, epoch, proposal, via, x, hdr, tags, proof, touches, fits, defines, heq, hprop, hact, hnone,
        ⟨_, rfl, rfl, rfl, rfl, rfl⟩, rfl, rfl⟩
    · -- a write to an existing entry: it sets no type nor blob, and isn't a first write
      split at h
      · cases h
      rename_i en hen
      have hen' : st.entry? en.id = some en := by rw [entry?_id hen]; exact hen
      split at h
      · cases h
      split at h
      · cases h
      simp only [Option.ite_none_left_eq_some, Option.some.injEq] at h
      obtain ⟨-, -, -, rfl⟩ := h
      refine .inl (LaneKeeps.trans ?_ (.addWrite (by rfl) fun d hd => counting_sup _ _ _ hd))
      split
      · exact .setEntry hen' rfl rfl rfl
      · exact .of_eq rfl rfl rfl
  case h_11 =>
    dsimp only at h
    split at h
    · cases h
    rename_i en hen
    have hen' : st.entry? en.id = some en := by rw [entry?_id hen]; exact hen
    repeat' split at h
    all_goals (try cases h)
    all_goals first
      | exact .inl (.of_eq rfl rfl rfl)
      | (refine .inl (LaneKeeps.trans ?_ (.drop _ _ _)); exact .setEntry hen' rfl rfl rfl)
      | (refine .inl (((LaneKeeps.trans ?_ (.setEntry (en := en) ?_ (by rfl) (by rfl) (by rfl)))).trans (.drop _ _ _)))
          <;> first | exact .of_eq rfl rfl rfl | exact hen'
  case h_13 =>
    -- a claim changes one share alone
    obtain ⟨-, -, -, -, -, -, -, -, -, rfl⟩ := applyClaim_some h
    exact .inl (.of_eq rfl rfl rfl)
  -- every other edit leaves the entries and the writes alone, or is a removal
  all_goals
    dsimp only at h
    repeat' split at h
    all_goals (try cases h)
    all_goals first
      | exact .inl (.of_eq rfl rfl rfl)
      | (refine .inl (LaneKeeps.trans ?_ (.drop _ _ _)); exact .of_eq rfl rfl rfl)

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
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.audience = true := by
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
    | shareOwner _ _ _ _ _ _ happ _ => exact .inl happ
    | revokeOwner p _ _ happ =>
      rcases happ with happ | happ
      · exact .inl happ
      · exact .inr (.inl ⟨p, rfl, happ⟩)
    | settingsThreshold _ happ => exact .inl happ
    | shareDevice _ _ happ _ => exact .inl happ
    | revokeDevice d happ =>
      rcases happ with happ | hd
      · exact .inl happ
      · exact .inr (.inr ⟨d, rfl, hd⟩)
    | settingsRoot _ _ _ => simp at hchg

theorem T2_consent {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st edit.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ edit.sigs) := by
  rcases step_vault?_old h h₁ h₂ with rfl | hch
  · exact ⟨fun p hp hn => absurd hp hn, fun d hd hn => absurd hd hn⟩
  · cases hch with
    | shareOwner p _ _ _ _ _ _ happ =>
      refine ⟨fun q hq hn => ?_, fun d hd hn => absurd hd hn⟩
      rcases List.mem_append.1 hq with hq | hq
      · exact absurd hq hn
      · rw [List.mem_singleton] at hq
        exact hq ▸ happ
    | revokeOwner _ _ _ _ => exact ⟨fun q hq hn => absurd (List.mem_of_mem_erase hq) hn, fun d hd hn => absurd hd hn⟩
    | settingsThreshold _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd hd hn⟩
    | shareDevice d _ _ hd =>
      refine ⟨fun q hq hn => absurd hq hn, fun d' hd' hn => ?_⟩
      rcases List.mem_append.1 hd' with hd' | hd'
      · exact absurd hd' hn
      · rw [List.mem_singleton] at hd'
        exact hd' ▸ hd
    | revokeDevice _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd (List.mem_of_mem_erase hd) hn⟩
    | settingsRoot _ _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd hd hn⟩

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

/-! ## Owners by the kind table

Every vault keeps at least one owner and no more than its kind takes, and where the table lets one owner own one vault
of a kind, none owns two: an aven has one owner, a coop, and a coop owns one aven at most. -/

/-- Fewer owners than a kind takes are taken too. -/
theorem takes_mono {r : KindRules} {m n : Nat} (hmn : m ≤ n) (h : r.takes n = true) : r.takes m = true := by
  unfold KindRules.takes at *
  cases hm : r.most with
  | none => rfl
  | some k =>
    rw [hm] at h
    simp only [Option.all_some, decide_eq_true_eq] at h ⊢
    omega

/-- A change keeps a vault's owners at least one and no more than its kind takes. -/
theorem VaultChange.count {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') (hne : vt.owners ≠ []) (ht : vt.kind.rules.takes vt.owners.length = true) :
    vt'.owners ≠ [] ∧ vt'.kind.rules.takes vt'.owners.length = true := by
  cases h with
  | shareOwner q _ _ htakes _ _ _ _ => exact ⟨by simp, by simpa using htakes⟩
  | revokeOwner q hq hlen _ =>
    have hl := List.length_erase_of_mem hq
    refine ⟨fun he => ?_, takes_mono (by simp only; omega) ht⟩
    have : (vt.owners.erase q).length = 0 := by simp only at he; rw [he]; rfl
    omega
  | settingsThreshold _ _ => exact ⟨hne, ht⟩
  | shareDevice _ _ _ _ => exact ⟨hne, ht⟩
  | revokeDevice _ _ => exact ⟨hne, ht⟩
  | settingsRoot _ _ _ => exact ⟨hne, ht⟩

/-- An owner a change adds may own one more vault of the vault's kind; every other owner was there. -/
theorem VaultChange.owners_new {st : State} {sigs : List SignerId} {v : VaultId} {vt vt' : Vault}
    (h : VaultChange st sigs v vt vt') : ∀ p ∈ vt'.owners, p ∈ vt.owners ∨ roomFor st vt.kind p = true := by
  intro p hp
  cases h with
  | shareOwner q _ _ _ hroom _ _ _ =>
    rcases List.mem_append.1 hp with hp | hp
    · exact .inl hp
    · rw [List.mem_singleton] at hp; subst hp; exact .inr hroom
  | revokeOwner q _ _ _ => exact .inl (List.mem_of_mem_erase hp)
  | settingsThreshold _ _ => exact .inl hp
  | shareDevice _ _ _ _ => exact .inl hp
  | revokeDevice _ _ => exact .inl hp
  | settingsRoot _ _ _ => exact .inl hp

/-- One step keeps every vault's owners at least one and no more than its kind takes. -/
theorem ownersCount_step {st st' : State} {edit : Edit} (hc : OwnersCount st) (h : step st edit = some st') :
    OwnersCount st' := by
  intro x u hx
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, -, -, -, ⟨hne, htakes, -⟩, hlook⟩ |
    ⟨v, vt, vt', hvt, hch, hlook⟩
  · rw [hsame] at hx; exact hc x u hx
  · rw [hlook] at hx
    split at hx
    · cases hx; exact ⟨hne, htakes⟩
    · exact hc x u hx
  · rw [hlook] at hx
    split at hx
    · cases hx
      obtain ⟨hne, ht⟩ := hc v vt hvt
      exact hch.count hne ht
    · exact hc x u hx

/-- Where one owner may own one vault of kind `k`, an owner with room for one more owns none of them yet. -/
theorem roomFor_one {st : State} {k : Kind} {p : Principal} (he : k.rules.each = some 1)
    (h : roomFor st k p = true) : ∀ x ∈ st.vaults, x.kind = k → p ∉ x.owners := by
  intro x hx hk hp
  unfold roomFor at h
  rw [he] at h
  simp only [Option.all_some, decide_eq_true_eq, Nat.lt_one_iff, List.length_eq_zero_iff,
    List.filter_eq_nil_iff] at h
  have := h x hx
  simp [hk, hp] at this

/-- One step keeps every owner owning one vault at most of a kind the table lets one owner own one of. -/
theorem oneEach_step {st st' : State} {edit : Edit} (ho : OneEach st) (h : step st edit = some st') :
    OneEach st' := by
  intro k he x y vx vy p hx hy hkx hky hpx hpy
  have mem : ∀ z vz, st.vault? z = some vz → vz ∈ st.vaults := fun _ _ hz => List.mem_of_find?_eq_some hz
  rcases step_vault? h with hsame | ⟨v, kind, owners, threshold, root, -, -, -, ⟨-, -, hroom⟩, hlook⟩ |
    ⟨v, vt, vt', hvt, hch, hlook⟩
  · rw [hsame] at hx hy; exact ho k he x y vx vy p hx hy hkx hky hpx hpy
  · -- a new vault: its owners owned none of its kind before
    rw [hlook] at hx hy
    have hnew : ∀ z vz, st.vault? z = some vz → vz.kind = k → kind = k → p ∈ owners → p ∈ vz.owners → False :=
      fun z vz hz hzk hk hpo hpz => roomFor_one he (hk ▸ hroom p hpo) vz (mem z vz hz) hzk hpz
    split at hx <;> split at hy
    · rename_i h1 h2; exact h1.trans h2.symm
    · cases hx; exact (hnew y vy hy hky hkx hpx hpy).elim
    · cases hy; exact (hnew x vx hx hkx hky hpy hpx).elim
    · exact ho k he x y vx vy p hx hy hkx hky hpx hpy
  · -- a changed vault: an owner it adds owned none of its kind before
    rw [hlook] at hx hy
    have hk' : vt'.kind = vt.kind := hch.kind
    have hold : ∀ z vz, z ≠ v → st.vault? z = some vz → vz.kind = k → vt'.kind = k → p ∈ vt'.owners →
        p ∈ vz.owners → z = v := fun z vz _ hz hzk hk hp' hpz => by
      rcases hch.owners_new p hp' with hpo | hroom
      · exact ho k he z v vz vt p hz hvt hzk (hk'.symm.trans hk) hpz hpo
      · exact (roomFor_one he ((hk'.symm.trans hk) ▸ hroom) vz (mem z vz hz) hzk hpz).elim
    split at hx <;> split at hy
    · rename_i h1 h2; exact h1.trans h2.symm
    · rename_i h1 h2; cases hx; exact h1.trans (hold y vy h2 hy hky hkx hpx hpy).symm
    · rename_i h1 h2; cases hy; exact (hold x vx h1 hx hkx hky hpy hpx).trans h2.symm
    · exact ho k he x y vx vy p hx hy hkx hky hpx hpy

/-- In every reachable state every vault has an owner, and no more owners than its kind takes. -/
theorem ownersCount_reachable {st : State} (hr : Reachable st) : OwnersCount st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv OwnersCount (fun _ _ _ hc hs => ownersCount_step hc hs) edits {} ?_
  intro v vt hv
  simp [State.vault?] at hv

/-- In every reachable state no owner owns two vaults of a kind the table lets one owner own one of. -/
theorem oneEach_reachable {st : State} (hr : Reachable st) : OneEach st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv OneEach (fun _ _ _ ho hs => oneEach_step ho hs) edits {} ?_
  intro _ _ x _ vx _ _ hx
  simp [State.vault?] at hx

/-- In every reachable state an aven has exactly one owner, and it is a coop. -/
theorem aven_owner {st : State} (hr : Reachable st) {v : VaultId} {vt : Vault} (hv : st.vault? v = some vt)
    (hk : vt.kind = .aven) : ∃ h ht, vt.owners = [.vault h] ∧ st.vault? h = some ht ∧ ht.kind = .coop := by
  obtain ⟨hne, ht⟩ := ownersCount_reachable hr v vt hv
  have hfit := (T21_vault_kinds hr v vt hv).1
  rw [hk] at ht hfit
  match ho : vt.owners with
  | [] => exact absurd ho hne
  | [q] =>
    have hq := hfit q (by rw [ho]; exact List.mem_singleton_self q)
    cases q with
    | signer s => simp [ownerFits, Kind.rules, OwnedBy.bySigners] at hq
    | vault h =>
      simp only [ownerFits] at hq
      cases hh : st.vault? h with
      | none => rw [hh] at hq; cases hq
      | some ht' =>
        rw [hh] at hq
        simp [Kind.rules, OwnedBy.byKind] at hq
        exact ⟨h, ht', rfl, hh, hq⟩
  | _ :: _ :: _ => rw [ho] at ht; simp [KindRules.takes, Kind.rules] at ht

/-- In every reachable state a coop, or any vault, owns one aven at most. -/
theorem one_aven {st : State} (hr : Reachable st) {o x y : VaultId} {vx vy : Vault} (hx : st.vault? x = some vx)
    (hy : st.vault? y = some vy) (hkx : vx.kind = .aven) (hky : vy.kind = .aven)
    (hox : Principal.vault o ∈ vx.owners) (hoy : Principal.vault o ∈ vy.owners) : x = y :=
  oneEach_reachable hr .aven rfl x y vx vy _ hx hy hkx hky hox hoy

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

theorem T4_shares_name_vaults {st st' : State} {edit : Edit} (hinv : SharesNameVaults st)
    (h : step st edit = some st') :
    SharesNameVaults st' ∧
      ∀ c ∈ st'.shares, c ∉ st.shares → ∀ d, c.who = .device d → isDevice st d c.issuer = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  unfold SharesNameVaults
  simp only [settle_shares]
  rcases apply_shares hpost with hcs | ⟨c', hcs, hname, hdev, -⟩ | ⟨cid, v, hcs⟩
  · rw [hcs]
    exact ⟨hinv, fun c hc hn => absurd hc hn⟩
  · rw [hcs]
    refine ⟨fun c hc => ?_, fun c hc hn => ?_⟩
    · rcases List.mem_append.1 hc with hc | hc
      · exact hinv c hc
      · rw [List.mem_singleton] at hc
        subst hc
        exact hname
    · rcases List.mem_append.1 hc with hc | hc
      · exact absurd hc hn
      · rw [List.mem_singleton] at hc
        subst hc
        exact hdev
  · -- a claim names a vault, so it changes no share that names a device
    rw [hcs]
    refine ⟨fun c hc => ?_, fun c hc hn d hd => ?_⟩
    · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hc
      rw [claimed_isDevice, claimed_level]
      exact hinv x hx
    · obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hc
      exact absurd (by rw [claimed_device hd]; exact hx) hn

theorem T8_everyone_read_only {st st' : State} {edit : Edit} (hinv : EveryoneReadOnly st)
    (h : step st edit = some st') : EveryoneReadOnly st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  intro c hc
  rw [settle_shares] at hc
  rcases apply_shares hpost with hcs | ⟨c', hcs, -, -, hpub⟩ | ⟨cid, v, hcs⟩
  · exact hinv c (hcs ▸ hc)
  · rw [hcs] at hc
    rcases List.mem_append.1 hc with hc | hc
    · exact hinv c hc
    · rw [List.mem_singleton] at hc
      subst hc
      exact hpub
  · -- a claim names a vault, so it changes no share to everyone
    rw [hcs] at hc
    obtain ⟨x, hx, rfl⟩ := List.mem_map.1 hc
    intro he
    have hx' := claimed_everyone he
    rw [hx'] at he ⊢
    exact hinv x hx he

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

theorem T17_lane_from_creations {st st' : State} (hr : Reachable st) {edit : Edit} (h : step st edit = some st')
    {v : VaultId} {b : BlobId} (hb : b ∈ laneOf st' v) :
    b ∈ laneOf st v ∨ ∃ e epoch via x hdr tags proof touches defines,
      edit.action = .write v e v none epoch [] .main via (some (x, hdr)) tags proof touches true defines ∧
      hdr.type ∈ schemaTypes ∧ hdr.blob = b ∧ actsVia st edit.author via v = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [laneOf_settle] at hb
  rcases apply_lane hpost with hk | ⟨v', e, actor, epoch, proposal, via, x, hdr, tags, proof, touches, fits, defines,
      hact, -,
      hacts, hnone, ⟨en, hid, hv, ht, hbl, hes⟩, hws, hus⟩
  · exact .inl (hk.mem_lane hb)
  -- a creation: the blob is of an entry whose first write readers count
  obtain ⟨y, hy, hin, rfl⟩ := mem_laneOf.1 hb
  obtain ⟨hyv, hyt, w, hw, hwe, hwf, hwa⟩ := inLane_iff.1 hin
  rw [mem_counted, hws, List.mem_append, List.mem_singleton] at hw
  rw [hes, List.mem_append, List.mem_singleton] at hy
  obtain ⟨hw | rfl, hwu⟩ := hw
  · -- an old write, which readers counted before too, and so of an old entry
    have hwc : w ∈ st.counted := mem_counted.2 ⟨hw, fun hu => hwu (by rw [hus]; exact counting_sup _ _ _ hu)⟩
    rcases hy with hy | rfl
    · exact .inl (mem_laneOf.2 ⟨y, hy, inLane_iff.2 ⟨hyv, hyt, w, hwc, hwe, hwf, hwa⟩, rfl⟩)
    · obtain ⟨z, hz, hzid⟩ := (T14_entries_whole hr).1 w hw
      obtain ⟨z', hz'⟩ := entry?_of_mem hz
      rw [hzid, hwe, hid, hnone] at hz'
      cases hz'
  · -- the creation's own write, of the new entry, by `v`, on the main line: a draft joins no lane
    have hwe : e = y.id := hwe
    obtain ⟨hwa, hwm⟩ := hwa
    have hwa : actor = v := hwa
    have hwm : proposal = .main := hwm
    rcases hy with hy | rfl
    · obtain ⟨z, hz⟩ := entry?_of_mem hy
      rw [← hwe, hnone] at hz
      cases hz
    · -- its readers count it, so it fits
      subst hwm
      have hc : creates st actor v' x ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩ proof true fits = true := by
        cases hcr : creates st actor v' x ⟨hdr.type, actor, e, hdr.created, tags.apply []⟩ proof true fits
        · rw [hus] at hwu
          simp only [beq_self_eq_true, hcr] at hwu
          exact absurd (by simp [State.counting]) hwu
        · rfl
      have hfits : fits = true := by
        simp only [creates, Bool.and_eq_true] at hc
        exact hc.1
      have hvv : v' = v := hv.symm.trans hyv
      subst hfits hvv hwa
      exact .inr ⟨e, epoch, via, x, hdr, tags, proof, touches, defines, hact, ht ▸ hyt, hbl.symm, hacts⟩

theorem T17_writes_ignored {st st' : State} (hone : ∀ x ∈ st.entries, ∀ y ∈ st.entries, x.id = y.id → x = y)
    {edit : Edit} (h : step st edit = some st') {v e actor stay epoch deps proposal via tags proof touches fits defines}
    (ha : edit.action = .write v e actor stay epoch deps proposal via none tags proof touches fits defines) :
    laneOf st' = laneOf st := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [laneOf_settle]
  unfold apply at hpost
  rw [ha] at hpost
  dsimp only at hpost
  split at hpost
  · cases hpost
  rename_i hnew
  -- the write's id is new
  have hfresh : ∀ x ∈ st.writes, x.edit ≠ edit.id := by
    intro x hx hxe
    simp only [Bool.or_eq_true, List.any_eq_true, beq_iff_eq] at hnew
    exact hnew (.inl ⟨x, hx, hxe⟩)
  split at hpost
  · cases hpost
  rename_i en hen
  split at hpost
  · cases hpost
  split at hpost
  · cases hpost
  simp only [Option.ite_none_left_eq_some, Option.some.injEq] at hpost
  obtain ⟨-, -, -, rfl⟩ := hpost
  split
  · -- only the tags change
    refine (laneOf_addWrite ?_ ?_).trans (laneOf_setEntry (en := en) (fun z hz hzid => ?_) rfl rfl rfl rfl)
    · rfl
    · exact hfresh
    · exact hone z hz en (entry?_mem hen) hzid
  · refine laneOf_addWrite ?_ ?_
    · rfl
    · exact hfresh

end AvenDB.Core
