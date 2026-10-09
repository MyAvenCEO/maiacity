import AvenDB.Lemmas

/-!
# Key lemmas

Helpers for the key theorems in `Theorems.lean`. An accepted op leaves the key schedule alone; settling then rotates
the stale families, seals each current key to its targets and publishes the public ones (`settle_seals`). `opens`
finds every key `Knows` gives, so `staleKeys` sees whatever a holder could open. Without cycles, acting for a vault
carries over to every coop it owns, so whoever may open a target may open what is sealed to it.

T6 holds in every reachable state as part of an invariant (`KeyInv`): after a step, a holder opens only what it
opened before, what the previous key of a family it may open now opened, and the new keys of families it may open now
(`MayKnow`), and each current key among these belongs to a family it may open. T5 follows the history instead: every
seal is justified by what was readable at some point (`SealsRead`), and opening keys follows the seals.
-/

namespace AvenDB

/-! ## What a step does to the keys -/

/-- What holds at the start of a fold and is kept by each step on a member of the list holds at its end. -/
theorem foldl_inv_mem {α β : Type} (P : β → Prop) (f : β → α → β) :
    ∀ (l : List α), (∀ b, ∀ a ∈ l, P b → P (f b a)) → ∀ b, P b → P (l.foldl f b)
  | [], _, _, h => h
  | a :: l, hf, b, h =>
    foldl_inv_mem P f l (fun b' a' ha' => hf b' a' (List.mem_cons_of_mem _ ha')) (f b a)
      (hf b a List.mem_cons_self h)

/-- An accepted op leaves the key schedule alone: the epochs, the seals and what is published. -/
theorem apply_keys {st post : State} {op : Op} (h : apply st op = some post) :
    post.epochs = st.epochs ∧ post.seals = st.seals ∧ post.published = st.published := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try exact ⟨rfl, rfl, rfl⟩)

/-- The key families: each vault's, each space's, and each of its entries'. -/
theorem mem_keyScopes {st : State} {k : KeyScope} :
    k ∈ keyScopes st ↔ (∃ v ∈ st.vaults, k = .vault v.id) ∨
      ∃ s ∈ st.spaces, k = .space s.id ∨ ∃ e ∈ s.entries, k = .entry s.id e := by
  unfold keyScopes
  simp only [List.mem_append, List.mem_map, List.mem_flatMap, List.mem_cons]
  constructor
  · rintro (⟨v, hv, rfl⟩ | ⟨s, hs, rfl | ⟨e, he, rfl⟩⟩)
    · exact .inl ⟨v, hv, rfl⟩
    · exact .inr ⟨s, hs, .inl rfl⟩
    · exact .inr ⟨s, hs, .inr ⟨e, he, rfl⟩⟩
  · rintro (⟨v, hv, rfl⟩ | ⟨s, hs, rfl | ⟨e, he, rfl⟩⟩)
    · exact .inl ⟨v, hv, rfl⟩
    · exact .inr ⟨s, hs, .inl rfl⟩
    · exact .inr ⟨s, hs, .inr ⟨e, he, rfl⟩⟩

/-- A state that keeps every vault id, and every space with its entries, keeps every key family. -/
theorem keyScopes_mono {st st' : State} (hv : ∀ v ∈ st.vaults, ∃ v' ∈ st'.vaults, v'.id = v.id)
    (hs : ∀ s ∈ st.spaces, ∃ s' ∈ st'.spaces, s'.id = s.id ∧ ∀ e ∈ s.entries, e ∈ s'.entries)
    {k : KeyScope} (hk : k ∈ keyScopes st) : k ∈ keyScopes st' := by
  rw [mem_keyScopes] at hk ⊢
  rcases hk with ⟨v, hv', rfl⟩ | ⟨s, hs', hk⟩
  · obtain ⟨v', hv'', hid⟩ := hv v hv'
    exact .inl ⟨v', hv'', by rw [hid]⟩
  · obtain ⟨s', hs'', hid, he⟩ := hs s hs'
    rcases hk with rfl | ⟨e, hes, rfl⟩
    · exact .inr ⟨s', hs'', .inl (by rw [hid])⟩
    · exact .inr ⟨s', hs'', .inr ⟨e, he e hes, by rw [hid]⟩⟩

/-- Changing a vault keeps every vault id. -/
theorem setVault_ids (st : State) (vt' : Vault) :
    ∀ v ∈ st.vaults, ∃ v' ∈ (setVault st vt').vaults, v'.id = v.id :=
  fun v hv => ⟨if v.id == vt'.id then vt' else v, List.mem_map_of_mem hv, by split <;> simp_all⟩

/-- An accepted op keeps every key family: no vault, space or entry goes away. -/
theorem keyScopes_apply {st post : State} {op : Op} (h : apply st op = some post) {k : KeyScope}
    (hk : k ∈ keyScopes st) : k ∈ keyScopes post := by
  unfold apply at h
  dsimp only at h
  split at h <;> (repeat' split at h) <;> (try cases h) <;> (try exact hk) <;>
    refine keyScopes_mono (st := st) ?_ ?_ hk <;>
    (try exact setVault_ids _ _) <;> (try exact fun s hs => ⟨s, hs, rfl, fun _ he => he⟩) <;>
    (try exact fun v hv => ⟨v, hv, rfl⟩)
  · exact fun v hv => ⟨v, List.mem_append_left _ hv, rfl⟩
  · exact fun s hs => ⟨s, List.mem_append_left _ hs, rfl, fun _ he => he⟩
  · refine fun s hs => ⟨_, List.mem_map_of_mem hs, ?_⟩
    split <;> simp_all

/-! ### What the key rules read

Who may open what reads only the vaults, the spaces and the grants; the targets read the epochs too. -/

/-- The current key reads only the epochs. -/
theorem curKey_congr {st st' : State} (he : st'.epochs = st.epochs) (k : KeyScope) :
    st'.curKey k = st.curKey k := by
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

/-- Holding a cap reads only the spaces' founders and the grants. -/
theorem holds_congr {st st' : State} (hs : st'.spaces = st.spaces) (hg : st'.grants = st.grants) (v : VaultId)
    (sc : Scope) (r : Role) : holds st' v sc r = holds st v sc r := by
  simp only [holds, State.founder?, State.space?, hs, hg]

/-- Being public reads only the grants. -/
theorem publicKey_congr {st st' : State} (hg : st'.grants = st.grants) (k : KeyScope) :
    publicKey st' k = publicKey st k := by
  simp only [publicKey, isPublic, hg]

/-- Being entitled reads only the vaults, the spaces and the grants. -/
theorem Holder.entitled_congr {st st' : State} (hv : st'.vaults = st.vaults) (hs : st'.spaces = st.spaces)
    (hg : st'.grants = st.grants) (h : Holder) (k : KeyScope) : h.entitled st' k = h.entitled st k := by
  have hd : st'.depth = st.depth := by simp [State.depth, hv]
  cases h <;> cases k <;> simp only [Holder.entitled, AvenDB.entitled, entitledV, actsFor, owns, hd,
    actsForN_congr hv, ownsN_congr hv, holds_congr hs hg, hv, publicKey_congr hg]

/-- The targets read only the vaults, the spaces, the grants and the epochs. -/
theorem targets_congr {st st' : State} (hv : st'.vaults = st.vaults) (hs : st'.spaces = st.spaces)
    (hg : st'.grants = st.grants) (he : st'.epochs = st.epochs) (k : KeyScope) :
    targets st' k = targets st k := by
  cases k <;> simp only [targets, vault?_congr hv, hv, hg, curKey_congr he, holds_congr hs hg]

/-! ### Rotating -/

/-- Rotating `k` raises its epoch by one and leaves the others. -/
theorem epochOf_bump (st : State) (k k' : KeyScope) :
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
theorem epochOf_foldl_bump (k : KeyScope) : ∀ (l : List KeyScope) (st : State),
    (l.foldl bump st).epochOf k = st.epochOf k + l.count k
  | [], _ => by simp
  | k' :: l, st => by
    rw [List.foldl_cons, epochOf_foldl_bump k l, epochOf_bump, List.count_cons]
    by_cases hk : k' = k <;> simp [hk] <;> omega

/-- Rotating adds only seals of one epoch of a rotated family to the next. -/
theorem foldl_bump_seals : ∀ (l : List KeyScope) (st : State) {s : Seal}, s ∈ (l.foldl bump st).seals →
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

/-! ### Sealing -/

/-- One family's turn in `sealAll`. -/
def sealOne (acc : State) (k : KeyScope) : State :=
  let acc := (targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc
  if publicKey acc k then publish acc (acc.curKey k) else acc

/-- `sealAll` takes one family's turn after another. -/
theorem sealAll_eq (st : State) : sealAll st = (keyScopes st).foldl sealOne st := rfl

/-- Sealing and publishing leave alone whatever `get` reads besides the seals and what is published. -/
theorem sealOne_same {β : Type} (get : State → β)
    (hs : ∀ (st : State) ss, get { st with seals := ss } = get st)
    (hp : ∀ (st : State) ps, get { st with published := ps } = get st) (acc : State) (k : KeyScope) :
    get (sealOne acc k) = get acc := by
  have hseal : ∀ st s, get (addSeal st s) = get st := fun st s => by
    unfold addSeal
    split
    · rfl
    · exact hs _ _
  have hpub : ∀ st x, get (publish st x) = get st := fun st x => by
    unfold publish
    split
    · rfl
    · exact hp _ _
  unfold sealOne
  dsimp only
  split
  · rw [hpub, foldl_same get _ (fun a _ => hseal a _)]
  · rw [foldl_same get _ (fun a _ => hseal a _)]

/-- The schedule `sealAll` reads: the vaults, the spaces, the grants and the epochs. -/
structure SameSched (st st' : State) : Prop where
  vaults : st'.vaults = st.vaults
  spaces : st'.spaces = st.spaces
  grants : st'.grants = st.grants
  epochs : st'.epochs = st.epochs

/-- Keeping the schedule chains. -/
theorem SameSched.trans {a b c : State} (h₁ : SameSched a b) (h₂ : SameSched b c) : SameSched a c :=
  ⟨h₂.vaults.trans h₁.vaults, h₂.spaces.trans h₁.spaces, h₂.grants.trans h₁.grants,
    h₂.epochs.trans h₁.epochs⟩

/-- One family's turn keeps the schedule. -/
theorem sameSched_sealOne (acc : State) (k : KeyScope) : SameSched acc (sealOne acc k) :=
  ⟨sealOne_same State.vaults (fun _ _ => rfl) (fun _ _ => rfl) acc k,
    sealOne_same State.spaces (fun _ _ => rfl) (fun _ _ => rfl) acc k,
    sealOne_same State.grants (fun _ _ => rfl) (fun _ _ => rfl) acc k,
    sealOne_same State.epochs (fun _ _ => rfl) (fun _ _ => rfl) acc k⟩

/-- Sealing to the targets keeps the schedule and what is published, and adds only seals of the current key to a
    target. -/
theorem foldl_addSeal (acc : State) (k : KeyScope) :
    SameSched acc ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc) ∧
    ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).published = acc.published ∧
    ∀ s ∈ ((targets acc k).foldl (fun a t => addSeal a ⟨a.curKey k, t⟩) acc).seals,
      s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩ := by
  refine foldl_inv_mem (fun a : State => SameSched acc a ∧ a.published = acc.published ∧
      ∀ s ∈ a.seals, s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩) _ _ ?_ acc
    ⟨⟨rfl, rfl, rfl, rfl⟩, rfl, fun s hs => .inl hs⟩
  intro a t ht ⟨hsame, hpub, hseals⟩
  unfold addSeal
  split
  · exact ⟨hsame, hpub, hseals⟩
  · refine ⟨⟨hsame.vaults, hsame.spaces, hsame.grants, hsame.epochs⟩, hpub, fun s hs => ?_⟩
    rcases List.mem_append.1 hs with hs | hs
    · exact hseals s hs
    · rw [List.mem_singleton] at hs
      subst hs
      exact .inr ⟨t, ht, by rw [curKey_congr hsame.epochs]⟩

/-- One family's turn adds only seals of its current key to one of its targets. -/
theorem sealOne_seals {acc : State} {k : KeyScope} {s : Seal} (hs : s ∈ (sealOne acc k).seals) :
    s ∈ acc.seals ∨ ∃ t ∈ targets acc k, s = ⟨acc.curKey k, t⟩ := by
  obtain ⟨-, -, hseals⟩ := foldl_addSeal acc k
  unfold sealOne at hs
  dsimp only at hs
  split at hs
  · unfold publish at hs
    split at hs <;> exact hseals s hs
  · exact hseals s hs

/-- One family's turn publishes only its current key, and only if the family is public. -/
theorem sealOne_published {acc : State} {k : KeyScope} {x : KeyName} (hx : x ∈ (sealOne acc k).published) :
    x ∈ acc.published ∨ (publicKey acc k = true ∧ x = acc.curKey k) := by
  obtain ⟨hsame, hpub, -⟩ := foldl_addSeal acc k
  unfold sealOne at hx
  dsimp only at hx
  split at hx
  · rename_i hk
    unfold publish at hx
    split at hx
    · exact .inl (hpub ▸ hx)
    · rcases List.mem_append.1 hx with hx | hx
      · exact .inl (hpub ▸ hx)
      · rw [List.mem_singleton] at hx
        rw [publicKey_congr hsame.grants] at hk
        exact .inr ⟨hk, by rw [hx, curKey_congr hsame.epochs]⟩
  · exact .inl (hpub ▸ hx)

/-- What is published stays published. -/
theorem sealOne_published_mono {acc : State} {k : KeyScope} {x : KeyName} (hx : x ∈ acc.published) :
    x ∈ (sealOne acc k).published := by
  obtain ⟨-, hpub, -⟩ := foldl_addSeal acc k
  unfold sealOne
  dsimp only
  split
  · unfold publish
    split
    · exact hpub ▸ hx
    · exact List.mem_append_left _ (hpub ▸ hx)
  · exact hpub ▸ hx

/-- A public family's turn publishes its current key. -/
theorem sealOne_publishes {acc : State} {k : KeyScope} (hk : publicKey acc k = true) :
    acc.curKey k ∈ (sealOne acc k).published := by
  obtain ⟨hsame, -, -⟩ := foldl_addSeal acc k
  unfold sealOne
  dsimp only
  split
  · rw [← curKey_congr hsame.epochs]
    unfold publish
    split
    · rename_i h
      exact List.contains_iff_mem.1 h
    · exact List.mem_append_right _ (List.mem_singleton_self _)
  · rename_i hn
    exact absurd (by rw [publicKey_congr hsame.grants]; exact hk) hn

/-- What sealing everything adds: seals of a current key to one of its targets, and the current keys of public
    families. -/
theorem sealAll_spec (st : State) : SameSched st (sealAll st) ∧
    (∀ s ∈ (sealAll st).seals, s ∈ st.seals ∨
      ∃ k ∈ keyScopes st, ∃ t ∈ targets st k, s = ⟨st.curKey k, t⟩) ∧
    (∀ x ∈ (sealAll st).published, x ∈ st.published ∨
      ∃ k ∈ keyScopes st, publicKey st k = true ∧ x = st.curKey k) := by
  rw [sealAll_eq]
  refine foldl_inv_mem (fun acc : State => SameSched st acc ∧
      (∀ s ∈ acc.seals, s ∈ st.seals ∨
        ∃ k ∈ keyScopes st, ∃ t ∈ targets st k, s = ⟨st.curKey k, t⟩) ∧
      (∀ x ∈ acc.published, x ∈ st.published ∨
        ∃ k ∈ keyScopes st, publicKey st k = true ∧ x = st.curKey k))
    _ _ ?_ st ⟨⟨rfl, rfl, rfl, rfl⟩, fun s hs => .inl hs, fun x hx => .inl hx⟩
  intro acc k hk ⟨hsame, hseals, hpub⟩
  refine ⟨hsame.trans (sameSched_sealOne acc k), fun s hs => ?_, fun x hx => ?_⟩
  · rcases sealOne_seals hs with hs | ⟨t, ht, rfl⟩
    · exact hseals s hs
    · rw [targets_congr hsame.vaults hsame.spaces hsame.grants hsame.epochs] at ht
      exact .inr ⟨k, hk, t, ht, by rw [curKey_congr hsame.epochs]⟩
  · rcases sealOne_published hx with hx | ⟨hkp, rfl⟩
    · exact hpub x hx
    · rw [publicKey_congr hsame.grants] at hkp
      exact .inr ⟨k, hk, hkp, by rw [curKey_congr hsame.epochs]⟩

/-- `sealAll` publishes the current key of every public family. -/
theorem sealAll_publishes {st : State} {k : KeyScope} (hk : k ∈ keyScopes st)
    (hpub : publicKey st k = true) : st.curKey k ∈ (sealAll st).published := by
  rw [sealAll_eq]
  suffices h : ∀ (l : List KeyScope) (acc : State), SameSched st acc → k ∈ l →
      st.curKey k ∈ (l.foldl sealOne acc).published from h _ st ⟨rfl, rfl, rfl, rfl⟩ hk
  intro l
  induction l with
  | nil => intro _ _ h; cases h
  | cons k' l ih =>
    intro acc hsame hmem
    rw [List.foldl_cons]
    rcases List.mem_cons.1 hmem with rfl | hmem
    · have h₀ : st.curKey k ∈ (sealOne acc k).published := by
        rw [← curKey_congr hsame.epochs]
        exact sealOne_publishes (by rw [publicKey_congr hsame.grants]; exact hpub)
      exact foldl_inv (fun a : State => st.curKey k ∈ a.published) _ (fun _ _ h => sealOne_published_mono h) l _
        h₀
    · exact ih _ (hsame.trans (sameSched_sealOne acc k')) hmem

/-! ### Settling -/

/-- Rotating changes only the epochs and the seals. -/
theorem sameSched_foldl_bump (l : List KeyScope) (st : State) :
    (l.foldl bump st).vaults = st.vaults ∧ (l.foldl bump st).spaces = st.spaces ∧
    (l.foldl bump st).grants = st.grants ∧ (l.foldl bump st).published = st.published :=
  ⟨foldl_same State.vaults bump (fun _ _ => rfl) l st, foldl_same State.spaces bump (fun _ _ => rfl) l st,
    foldl_same State.grants bump (fun _ _ => rfl) l st, foldl_same State.published bump (fun _ _ => rfl) l st⟩

/-- Settling raises the epoch of each stale family, by how often it is stale. -/
theorem epochOf_settle (pre post : State) (k : KeyScope) :
    (settle pre post).epochOf k = post.epochOf k + (staleKeys pre post).count k := by
  unfold settle
  rw [← epochOf_foldl_bump]
  simp only [State.epochOf, (sealAll_spec _).1.epochs]

/-- Settling keeps the key families. -/
theorem keyScopes_settle (pre post : State) : keyScopes (settle pre post) = keyScopes post := by
  simp only [keyScopes, settle_vaults, settle_spaces]

/-- Settling keeps who is entitled to what. -/
theorem Holder.entitled_settle (pre post : State) (h : Holder) (k : KeyScope) :
    h.entitled (settle pre post) k = h.entitled post k :=
  Holder.entitled_congr (settle_vaults pre post) (settle_spaces pre post) (settle_grants pre post) h k

/-- Settling keeps what is public. -/
theorem publicKey_settle (pre post : State) (k : KeyScope) :
    publicKey (settle pre post) k = publicKey post k :=
  publicKey_congr (settle_grants pre post) k

/-- The seals after settling: the ones before, the seal of each old epoch of a rotated family to the next, and seals
    of current keys to their targets. -/
theorem settle_seals {pre post : State} {s : Seal} (hs : s ∈ (settle pre post).seals) :
    s ∈ post.seals ∨
    (∃ k e, k ∈ staleKeys pre post ∧ post.epochOf k ≤ e ∧ e < (settle pre post).epochOf k ∧
      s = ⟨.scoped k e, .scoped k (e + 1)⟩) ∨
    (∃ k ∈ keyScopes post, ∃ t ∈ targets (settle pre post) k, s = ⟨(settle pre post).curKey k, t⟩) := by
  have hmid := sameSched_foldl_bump (staleKeys pre post) post
  obtain ⟨hsame, hseals, -⟩ := sealAll_spec ((staleKeys pre post).foldl bump post)
  unfold settle at hs ⊢
  rcases hseals s hs with hs | ⟨k, hk, t, ht, rfl⟩
  · rcases foldl_bump_seals _ _ hs with hs | ⟨k, hk, e, he1, he2, rfl⟩
    · exact .inl hs
    · refine .inr (.inl ⟨k, e, hk, he1, ?_, rfl⟩)
      simp only [State.epochOf, hsame.epochs] at he2 ⊢
      exact he2
  · refine .inr (.inr ⟨k, ?_, t, ?_, ?_⟩)
    · simpa only [keyScopes, hmid.1, hmid.2.1] using hk
    · rw [targets_congr hsame.vaults hsame.spaces hsame.grants hsame.epochs]
      exact ht
    · rw [curKey_congr hsame.epochs]

/-- What is published after settling: what was before, and the current keys of public families. -/
theorem settle_published {pre post : State} {x : KeyName} (hx : x ∈ (settle pre post).published) :
    x ∈ post.published ∨ ∃ k ∈ keyScopes post, publicKey post k = true ∧ x = (settle pre post).curKey k := by
  have hmid := sameSched_foldl_bump (staleKeys pre post) post
  obtain ⟨hsame, -, hpub⟩ := sealAll_spec ((staleKeys pre post).foldl bump post)
  unfold settle at hx ⊢
  rcases hpub x hx with hx | ⟨k, hk, hkp, rfl⟩
  · exact .inl (hmid.2.2.2 ▸ hx)
  · refine .inr ⟨k, ?_, ?_, ?_⟩
    · simpa only [keyScopes, hmid.1, hmid.2.1] using hk
    · rw [publicKey_congr hmid.2.2.1] at hkp
      exact hkp
    · rw [curKey_congr hsame.epochs]

/-- Settling publishes the current key of every public family. -/
theorem settle_publishes {pre post : State} {k : KeyScope} (hk : k ∈ keyScopes post)
    (hpub : publicKey post k = true) : (settle pre post).curKey k ∈ (settle pre post).published := by
  have hmid := sameSched_foldl_bump (staleKeys pre post) post
  obtain ⟨hsame, -, -⟩ := sealAll_spec ((staleKeys pre post).foldl bump post)
  unfold settle
  rw [curKey_congr hsame.epochs]
  refine sealAll_publishes ?_ ?_
  · simpa only [keyScopes, hmid.1, hmid.2.1] using hk
  · rw [publicKey_congr hmid.2.2.1]
    exact hpub

/-! ## `opens` finds what `Knows` gives

Each round of `openRound` that changes the list opens the secret of some seal not open before, so after one round
per seal nothing new opens: the list is closed under the seals. -/

/-- Whatever is sealed to a key in `known` is in `known`. -/
def SealClosed (st : State) (known : List KeyName) : Prop := ∀ s ∈ st.seals, s.to ∈ known → s.secret ∈ known

/-- A list that holds the start and what is published, and is closed under the seals, holds every key `Knows`
    gives. -/
theorem Knows.mem {st : State} {start known : List KeyName} (hs : ∀ x ∈ start, x ∈ known)
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
  exact List.contains_iff_mem.2 (h.mem (fun y hy => hsub y (List.mem_append_left _ hy))
    (fun y hy => hsub y (List.mem_append_right _ hy)) hc)

/-! ## Acting for a vault, through chains

Without cycles, a chain of owners never visits a vault twice, so `actsFor` finds every chain, and acting for a vault
carries over to every vault it owns. -/

/-- A chain by which signer `s` acts for vault `v`, listing the vaults it passes through, `v` first: up through the
    owners, to a vault `s` is a member of (one of its devices or owner signers). -/
inductive ActsChain (st : State) (s : SignerId) : VaultId → List VaultId → Prop where
  | member {v : VaultId} {vt : Vault} : st.vault? v = some vt →
      (vt.devices.contains s || vt.owners.contains (.signer s)) = true → ActsChain st s v [v]
  | owner {v o : VaultId} {vt : Vault} {ys : List VaultId} : st.vault? v = some vt →
      Principal.vault o ∈ vt.owners → ActsChain st s o ys → ActsChain st s v (v :: ys)

/-- Whatever `actsForN` finds is a chain. -/
theorem ActsChain.of_actsForN {st : State} {s : SignerId} :
    ∀ {n : Nat} {v : VaultId}, actsForN st s n v = true → ∃ ys, ActsChain st s v ys
  | 0, _, h => by simp [actsForN] at h
  | n + 1, v, h => by
    simp only [actsForN] at h
    cases hv : st.vault? v with
    | none => rw [hv] at h; cases h
    | some vt =>
      rw [hv] at h
      dsimp only at h
      cases hm : (vt.devices.contains s || vt.owners.contains (.signer s)) with
      | true => exact ⟨_, .member hv hm⟩
      | false =>
        rw [hm, Bool.false_or] at h
        obtain ⟨p, hp, hpo⟩ := List.any_eq_true.1 h
        cases p with
        | vault o =>
          obtain ⟨ys, hys⟩ := ActsChain.of_actsForN hpo
          exact ⟨_, .owner hv hp hys⟩
        | signer _ => cases hpo

/-- A chain no longer than `n` is found by `actsForN` with fuel `n`. -/
theorem ActsChain.actsForN {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : ActsChain st s v ys) : ∀ {n : Nat}, ys.length ≤ n → actsForN st s n v = true := by
  induction h with
  | member hv hs =>
    intro n hn
    match n, hn with
    | n + 1, _ =>
      simp only [AvenDB.actsForN, hv, hs, Bool.true_or]
  | owner hv ho _ ih =>
    intro n hn
    match n, hn with
    | n + 1, hn =>
      simp only [AvenDB.actsForN, hv]
      rw [List.any_eq_true.2 ⟨_, ho, ih (by simp at hn; omega)⟩, Bool.or_true]

/-- Every vault on a chain for `v` is `v` or owns `v`. -/
theorem ActsChain.owns_mem {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : ActsChain st s v ys) {y : VaultId} (hy : y ∈ ys) : y = v ∨ Relation.TransGen (OwnerOf st) y v := by
  induction h with
  | member _ _ =>
    simp at hy
    exact .inl hy
  | @owner v o vt ys hv ho _ ih =>
    rcases List.mem_cons.1 hy with rfl | hy
    · exact .inl rfl
    · have hov : OwnerOf st o v := ⟨vt, hv, ho⟩
      rcases ih hy with rfl | hyo
      · exact .inr (.single hov)
      · exact .inr (.tail hyo hov)

/-- Without cycles, a chain never passes a vault twice. -/
theorem ActsChain.nodup {st : State} (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y) {s : SignerId}
    {v : VaultId} {ys : List VaultId} (h : ActsChain st s v ys) : ys.Nodup := by
  induction h with
  | member _ _ => simp
  | @owner v o vt ys hv ho hys ih =>
    refine List.nodup_cons.2 ⟨fun hmem => ?_, ih⟩
    have hov : OwnerOf st o v := ⟨vt, hv, ho⟩
    rcases hys.owns_mem hmem with rfl | hvo
    · exact hacyc _ (.single hov)
    · exact hacyc _ (.tail hvo hov)

/-- Every vault on a chain exists. -/
theorem ActsChain.mem_ids {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : ActsChain st s v ys) {y : VaultId} (hy : y ∈ ys) : y ∈ st.vaults.map (·.id) := by
  induction h with
  | member hv _ =>
    simp at hy
    subst hy
    exact List.mem_map.2 ⟨_, List.mem_of_find?_eq_some hv, vault?_id hv⟩
  | owner hv _ _ ih =>
    rcases List.mem_cons.1 hy with rfl | hy
    · exact List.mem_map.2 ⟨_, List.mem_of_find?_eq_some hv, vault?_id hv⟩
    · exact ih hy

/-- A signer that acts for a vault is listed by some vault. -/
theorem ActsChain.listed {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : ActsChain st s v ys) : s ∈ signers st := by
  induction h with
  | @member v vt hv hs =>
    unfold signers
    refine List.mem_flatMap.2 ⟨vt, List.mem_of_find?_eq_some hv, ?_⟩
    simp only [Bool.or_eq_true, List.contains_iff_mem] at hs
    rcases hs with hs | hs
    · exact List.mem_append_left _ hs
    · exact List.mem_append_right _ (List.mem_filterMap.2 ⟨_, hs, rfl⟩)
  | owner _ _ _ ih => exact ih

/-- The chain an op names is a chain: a member of the last vault it names, up through owners to the vault it acts
    for. -/
theorem ActsChain.of_actsVia {st : State} {s : SignerId} :
    ∀ {via : List VaultId} {v : VaultId}, actsVia st s via v = true → ActsChain st s v (v :: via)
  | [], v, h => by
    simp only [actsVia, AvenDB.member] at h
    cases hv : st.vault? v with
    | none => rw [hv] at h; cases h
    | some vt => rw [hv] at h; exact .member hv h
  | o :: via, v, h => by
    simp only [actsVia, Bool.and_eq_true, ownerOf] at h
    obtain ⟨ho, hvia⟩ := h
    cases hv : st.vault? v with
    | none => rw [hv] at ho; cases ho
    | some vt =>
      rw [hv] at ho
      exact .owner hv (List.contains_iff_mem.1 ho) (ActsChain.of_actsVia hvia)

/-- Every chain is one an op can name. -/
theorem ActsChain.actsVia {st : State} {s : SignerId} {v : VaultId} {ys : List VaultId}
    (h : ActsChain st s v ys) : actsVia st s ys.tail v = true := by
  induction h with
  | member hv hs => simp only [List.tail_cons, AvenDB.actsVia, AvenDB.member, hv, hs]
  | @owner v o vt ys hv ho hys ih =>
    cases hys with
    | member _ _ =>
      simp only [List.tail_cons, AvenDB.actsVia, ownerOf, hv, List.contains_iff_mem.2 ho, Bool.true_and]
      exact ih
    | owner _ _ _ =>
      simp only [List.tail_cons, AvenDB.actsVia, ownerOf, hv, List.contains_iff_mem.2 ho, Bool.true_and]
      exact ih

/-- Completeness of `actsFor`: without cycles, it finds every chain, whatever its length. -/
theorem actsFor_of_actsForN {st : State} (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y) {s : SignerId}
    {n : Nat} {v : VaultId} (h : actsForN st s n v = true) : actsFor st s v = true := by
  obtain ⟨ys, hys⟩ := ActsChain.of_actsForN h
  apply hys.actsForN
  have hle := length_le_of_nodup (hys.nodup hacyc) fun y hy => hys.mem_ids hy
  simp only [List.length_map] at hle
  unfold State.depth
  omega

/-- A signer entitled to anything is listed by some vault. -/
theorem entitled_listed {st : State} {s : SignerId} {k : KeyScope} (h : entitled st s k = true) :
    s ∈ signers st := by
  cases k with
  | vault v => exact (ActsChain.of_actsForN h).choose_spec.listed
  | space sp | entry sp e =>
    simp only [entitled, List.any_eq_true, Bool.and_eq_true] at h
    obtain ⟨_, _, hact, _⟩ := h
    exact (ActsChain.of_actsForN hact).choose_spec.listed

/-- `ownsN` follows only chains of owners. -/
theorem transGen_of_ownsN {st : State} {a : VaultId} : ∀ {n : Nat} {x : VaultId}, ownsN st a n x = true →
    Relation.TransGen (OwnerOf st) a x
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
        · exact .single ⟨vt, hx, hp⟩
        · exact .tail (transGen_of_ownsN hpo) ⟨vt, hx, hp⟩
      | signer _ => cases hpo

/-- The facts about vaults the key proofs rely on: no cycles, and every named owner exists. -/
structure VaultFacts (st : State) : Prop where
  acyclic : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y
  ownersExist : ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome

/-- Without cycles, owning chains. -/
theorem VaultFacts.owns_trans {st : State} (hf : VaultFacts st) {a b c : VaultId} (h₁ : owns st a b = true)
    (h₂ : owns st b c = true) : owns st a c = true :=
  owns_of_transGen hf.acyclic ((transGen_of_ownsN h₁).trans (transGen_of_ownsN h₂))

/-- Being a vault or owning it chains. -/
theorem VaultFacts.self_or_owns_trans {st : State} (hf : VaultFacts st) {a b c : VaultId}
    (h₁ : (a == b || owns st a b) = true) (h₂ : (b == c || owns st b c) = true) :
    (a == c || owns st a c) = true := by
  simp only [Bool.or_eq_true, beq_iff_eq] at h₁ h₂ ⊢
  rcases h₁ with rfl | h₁
  · exact h₂
  · rcases h₂ with rfl | h₂
    · exact .inr h₁
    · exact .inr (hf.owns_trans h₁ h₂)

/-- Acting for an owner of a vault is acting for the vault. -/
theorem actsFor_owner {st : State} (hacyc : ∀ y, ¬ Relation.TransGen (OwnerOf st) y y) {s : SignerId}
    {v o : VaultId} {vt : Vault} (hv : st.vault? v = some vt) (ho : Principal.vault o ∈ vt.owners)
    (h : actsFor st s o = true) : actsFor st s v = true := by
  refine actsFor_of_actsForN hacyc (n := st.depth + 1) ?_
  simp only [actsForN, hv]
  rw [List.any_eq_true.2 ⟨_, ho, h⟩, Bool.or_true]

/-- Acting for a vault is acting for every vault it owns. -/
theorem VaultFacts.actsFor_owns {st : State} (hf : VaultFacts st) {s : SignerId} {a x : VaultId}
    (h : actsFor st s a = true) (hax : owns st a x = true) : actsFor st s x = true := by
  have hchain := transGen_of_ownsN hax
  induction hchain with
  | single hab =>
    obtain ⟨vt, hv, ho⟩ := hab
    exact actsFor_owner hf.acyclic hv ho h
  | tail _ hbc ih =>
    obtain ⟨vt, hv, ho⟩ := hbc
    exact actsFor_owner hf.acyclic hv ho (ih (owns_of_transGen hf.acyclic ‹_›))

/-- Acting for a vault is acting for itself and every vault it owns. -/
theorem VaultFacts.actsFor_self_or_owns {st : State} (hf : VaultFacts st) {s : SignerId} {a x : VaultId}
    (h : actsFor st s a = true) (hax : (a == x || owns st a x) = true) : actsFor st s x = true := by
  simp only [Bool.or_eq_true, beq_iff_eq] at hax
  rcases hax with rfl | hax
  · exact h
  · exact hf.actsFor_owns h hax

/-! ## Who may open a family's current key -/

/-- `h` may open the current key of `k` in `st`: it is entitled to it, or the family is public. -/
def MayOpen (st : State) (h : Holder) (k : KeyScope) : Prop :=
  h.entitled st k = true ∨ publicKey st k = true

/-- Whoever may open a vault's key may open what that vault may open. -/
theorem VaultFacts.mayOpen_via {st : State} (hf : VaultFacts st) {h : Holder} {v : VaultId} {k : KeyScope}
    (hv : h.entitled st (.vault v) = true) (hk : MayOpen st (.vault v) k) : MayOpen st h k := by
  rcases hk with hk | hk
  · left
    cases h with
    | signer s =>
      simp only [Holder.entitled, entitled] at hv
      cases k with
      | vault x => exact hf.actsFor_self_or_owns hv hk
      | space sp | entry sp e =>
        simp only [Holder.entitled, entitled, entitledV, List.any_eq_true, Bool.and_eq_true] at hk ⊢
        obtain ⟨y, hy, hown, hread⟩ := hk
        exact ⟨y, hy, hf.actsFor_self_or_owns hv hown, hread⟩
    | vault w =>
      simp only [Holder.entitled, entitledV] at hv
      cases k with
      | vault x => exact hf.self_or_owns_trans hv hk
      | space sp | entry sp e =>
        simp only [Holder.entitled, entitledV, List.any_eq_true, Bool.and_eq_true] at hk ⊢
        obtain ⟨y, hy, hown, hread⟩ := hk
        exact ⟨y, hy, hf.self_or_owns_trans hv hown, hread⟩
    | everyone => simp [Holder.entitled, publicKey, KeyScope.scope?] at hv
  · exact .inr hk

/-- Family `k` lies within family `f`: it is `f`, or an entry of the space `f`. -/
def Within : KeyScope → KeyScope → Prop
  | .space sp, k => k = .space sp ∨ ∃ e, k = .entry sp e
  | .entry sp e, k => k = .entry sp e
  | .vault v, k => k = .vault v

/-- A family lies within itself. -/
theorem Within.refl (f : KeyScope) : Within f f := by
  cases f <;> simp [Within]

/-- Lying within chains. -/
theorem Within.trans {f k k' : KeyScope} (h₁ : Within f k) (h₂ : Within k k') : Within f k' := by
  cases f <;> simp only [Within] at h₁ ⊢
  · subst h₁; exact h₂
  · rcases h₁ with rfl | ⟨e, rfl⟩
    · exact h₂
    · exact .inr ⟨e, h₂⟩
  · subst h₁; exact h₂

/-- A cap on a space covers each of its entries. -/
theorem holds_entry {st : State} {v : VaultId} {sp : SpaceId} {r : Role} (e : EntryId)
    (h : holds st v (.space sp) r = true) : holds st v (.entry sp e) r = true := by
  simp only [holds, Scope.spaceOf, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true] at h ⊢
  rcases h with h | ⟨g, hg, ⟨hgv, hcov⟩, hr⟩
  · exact .inl h
  · refine .inr ⟨g, hg, ⟨hgv, ?_⟩, hr⟩
    cases hsc : g.scope with
    | space s => rw [hsc] at hcov; simpa [Scope.covers, Scope.spaceOf] using hcov
    | entry s f => rw [hsc] at hcov; simp [Scope.covers] at hcov

/-- The entries of a public space are public. -/
theorem isPublic_entry {st : State} {sp : SpaceId} (e : EntryId) (h : isPublic st (.space sp) = true) :
    isPublic st (.entry sp e) = true := by
  simp only [isPublic, List.any_eq_true, Bool.and_eq_true] at h ⊢
  obtain ⟨g, hg, hpub, hcov⟩ := h
  refine ⟨g, hg, hpub, ?_⟩
  cases hsc : g.scope with
  | space s => rw [hsc] at hcov; simpa [Scope.covers, Scope.spaceOf] using hcov
  | entry s f => rw [hsc] at hcov; simp [Scope.covers] at hcov

/-- Whoever is entitled to a space's key is entitled to the keys of its entries. -/
theorem Holder.entitled_entry {st : State} {h : Holder} {sp : SpaceId} (e : EntryId)
    (hf : h.entitled st (.space sp) = true) : h.entitled st (.entry sp e) = true := by
  cases h with
  | signer s =>
    simp only [Holder.entitled, AvenDB.entitled, List.any_eq_true, Bool.and_eq_true] at hf ⊢
    obtain ⟨x, hx, hact, hread⟩ := hf
    exact ⟨x, hx, hact, holds_entry e hread⟩
  | vault w =>
    simp only [Holder.entitled, entitledV, List.any_eq_true, Bool.and_eq_true] at hf ⊢
    obtain ⟨x, hx, hown, hread⟩ := hf
    exact ⟨x, hx, hown, holds_entry e hread⟩
  | everyone => exact isPublic_entry e hf

/-- Whoever may open a space's key may open the keys of its entries. -/
theorem mayOpen_within {st : State} {h : Holder} {f k : KeyScope} (hfk : Within f k) (hf : MayOpen st h f) :
    MayOpen st h k := by
  cases f with
  | vault v => simp only [Within] at hfk; subst hfk; exact hf
  | entry sp e => simp only [Within] at hfk; subst hfk; exact hf
  | space sp =>
    simp only [Within] at hfk
    rcases hfk with rfl | ⟨e, rfl⟩
    · exact hf
    · exact hf.imp (Holder.entitled_entry e) (isPublic_entry e)

/-- Whom the current key of `k` is sealed to: a signer acting for the vault `k`, the current key of a vault entitled
    to `k` (an owner of the vault `k`, or a vault that reads `k`), or for an entry the current key of its space. -/
theorem mem_targets {st : State} {k : KeyScope} {t : KeyName} (ht : t ∈ targets st k) :
    (∃ d v, t = .signer d ∧ k = .vault v ∧ actsFor st d v = true) ∨
    (∃ x, t = st.curKey (.vault x) ∧ entitledV st x k = true ∧
      ((∃ y ∈ st.vaults, y.id = x) ∨ ∃ v vt, st.vault? v = some vt ∧ Principal.vault x ∈ vt.owners)) ∨
    (∃ sp e, t = st.curKey (.space sp) ∧ k = .entry sp e) := by
  cases k with
  | vault v =>
    simp only [targets] at ht
    cases hv : st.vault? v with
    | none => rw [hv] at ht; cases ht
    | some vt =>
      rw [hv] at ht
      dsimp only at ht
      rcases List.mem_append.1 ht with ht | ht
      · obtain ⟨d, hd, rfl⟩ := List.mem_map.1 ht
        refine .inl ⟨d, v, rfl, rfl, ?_⟩
        unfold actsFor State.depth
        simp only [actsForN, hv, Bool.or_eq_true, List.contains_iff_mem]
        rcases List.mem_append.1 hd with hd | hd
        · exact .inl (.inl hd)
        · obtain ⟨p, hp, hpd⟩ := List.mem_filterMap.1 hd
          cases p with
          | signer s => cases hpd; exact .inl (.inr hp)
          | vault _ => cases hpd
      · obtain ⟨p, hp, hpt⟩ := List.mem_filterMap.1 ht
        cases p with
        | vault o =>
          cases hpt
          refine .inr (.inl ⟨o, rfl, ?_, .inr ⟨v, vt, hv, hp⟩⟩)
          simp only [entitledV, Bool.or_eq_true, beq_iff_eq]
          right
          unfold owns State.depth
          simp only [ownsN, hv]
          exact List.any_eq_true.2 ⟨_, hp, by simp⟩
        | signer _ => cases hpt
  | space sp =>
    simp only [targets] at ht
    obtain ⟨x, hx, hxt⟩ := List.mem_filterMap.1 ht
    split at hxt
    · rename_i hread
      cases hxt
      refine .inr (.inl ⟨x.id, rfl, ?_, .inl ⟨x, hx, rfl⟩⟩)
      simp only [entitledV]
      exact List.any_eq_true.2 ⟨x, hx, by simp [hread]⟩
    · cases hxt
  | entry sp e =>
    simp only [targets] at ht
    rcases List.mem_cons.1 ht with rfl | ht
    · exact .inr (.inr ⟨sp, e, rfl, rfl⟩)
    · obtain ⟨x, hx, hxt⟩ := List.mem_filterMap.1 ht
      split at hxt
      · rename_i hg
        cases hxt
        refine .inr (.inl ⟨x.id, rfl, ?_, .inl ⟨x, hx, rfl⟩⟩)
        simp only [entitledV]
        refine List.any_eq_true.2 ⟨x, hx, ?_⟩
        simp only [beq_self_eq_true, Bool.true_or, Bool.true_and]
        simp only [List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at hg
        obtain ⟨g, hgm, ⟨hgx, hsc⟩, hr⟩ := hg
        simp only [holds, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
        exact .inr ⟨g, hgm, ⟨hgx, by simp [hsc, Scope.covers]⟩, hr⟩
      · cases hxt

/-- With every named owner existing, a target of an existing family is a signer's key or the current key of an
    existing family. -/
theorem target_exists {st : State} (hf : VaultFacts st) {k : KeyScope} (hk : k ∈ keyScopes st) {t : KeyName}
    (ht : t ∈ targets st k) : (∃ d, t = .signer d) ∨ ∃ k' ∈ keyScopes st, t = st.curKey k' := by
  rcases mem_targets ht with ⟨d, -, rfl, -, -⟩ | ⟨x, rfl, -, hx⟩ | ⟨sp, e, rfl, rfl⟩
  · exact .inl ⟨d, rfl⟩
  · refine .inr ⟨.vault x, ?_, rfl⟩
    rw [mem_keyScopes]
    rcases hx with ⟨y, hy, rfl⟩ | ⟨v, vt, hv, ho⟩
    · exact .inl ⟨y, hy, rfl⟩
    · obtain ⟨y, hy⟩ := Option.isSome_iff_exists.1 (hf.ownersExist v vt hv x ho)
      exact .inl ⟨y, List.mem_of_find?_eq_some hy, by rw [vault?_id hy]⟩
  · refine .inr ⟨.space sp, ?_, rfl⟩
    rw [mem_keyScopes] at hk ⊢
    rcases hk with ⟨_, _, h⟩ | ⟨s, hs, h | ⟨_, _, h⟩⟩
    · cases h
    · cases h
    · cases h
      exact .inr ⟨s, hs, .inl rfl⟩

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

/-- A family that didn't rotate, isn't public after the change, and whose key a holder opened before it: that holder
    may open it after. -/
theorem entitled_of_not_stale {pre post : State} {k : KeyScope} (hk : k ∈ keyScopes post)
    (hS : k ∉ staleKeys pre post) (hpub : publicKey post k = false) {h : Holder} (hh : h ∈ holders pre)
    (ho : (opens pre (h.start pre)).contains (pre.curKey k) = true) : h.entitled post k = true := by
  cases hent : h.entitled post k
  · refine absurd (List.mem_filter.2 ⟨hk, ?_⟩) hS
    simp only [hpub, Bool.not_false, Bool.true_and, List.any_map, List.any_eq_true]
    exact ⟨h, hh, by simp [List.contains_iff_mem.1 ho, hent]⟩
  · rfl

/-! ## T6, kept by every step -/

/-- One step keeps the vault facts. -/
theorem VaultFacts.step {st st' : State} {op : Op} (hf : VaultFacts st) (h : step st op = some st') :
    VaultFacts st' := by
  obtain ⟨hacyc, hex⟩ := step_owners hf.acyclic hf.ownersExist h
  exact ⟨hacyc, hex⟩

/-- A key name a seal or a publication may hold in `st`: a signer's key, or a key of an existing family at an epoch
    it has reached. -/
def KeyIn (st : State) : KeyName → Prop
  | .signer _ => True
  | .scoped k e => k ∈ keyScopes st ∧ e ≤ st.epochOf k

/-- What every reachable state keeps about its keys: T6 for every holder; seals and publications hold only keys
    that exist; what is sealed to a space's or an entry's key lies within it; and the current key of every public
    family is published. -/
structure KeyInv (st : State) : Prop where
  facts : VaultFacts st
  fwd : ∀ h k, Knows st (h.start st) (st.curKey k) → MayOpen st h k
  sealed : ∀ s ∈ st.seals, KeyIn st s.to ∧ ∃ k e, s.secret = .scoped k e ∧ KeyIn st s.secret
  published : ∀ x ∈ st.published, ∃ k e, x = .scoped k e ∧ KeyIn st x
  within : ∀ s ∈ st.seals, ∀ f e, s.to = .scoped f e → f.scope?.isSome = true →
    ∃ k e', s.secret = .scoped k e' ∧ Within f k
  «public» : ∀ k ∈ keyScopes st, publicKey st k = true → st.curKey k ∈ st.published

/-- A key one opens is one it started with, or one that a seal or a publication holds. -/
theorem KeyInv.knows_old {st : State} (hinv : KeyInv st) {start : List KeyName} {x : KeyName}
    (h : Knows st start x) :
    x ∈ start ∨ ∃ k e, x = .scoped k e ∧ k ∈ keyScopes st ∧ e ≤ st.epochOf k := by
  cases h with
  | own hx => exact .inl hx
  | published hx =>
    obtain ⟨k, e, rfl, hk⟩ := hinv.published _ hx
    exact .inr ⟨k, e, rfl, hk⟩
  | «unseal» hs _ =>
    obtain ⟨-, k, e, heq, hk⟩ := hinv.sealed _ hs
    rw [heq] at hk ⊢
    exact .inr ⟨k, e, rfl, hk⟩

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

/-- What lies within a space's or an entry's family is a space's or an entry's family. -/
theorem Within.scope {f k : KeyScope} (h : Within f k) (hf : f.scope?.isSome = true) :
    k.scope?.isSome = true := by
  cases f with
  | vault v => simp [KeyScope.scope?] at hf
  | space sp =>
    rcases h with rfl | ⟨e, rfl⟩
    · rfl
    · rfl
  | entry sp e =>
    simp only [Within] at h
    subst h
    rfl

/-- From a space's or an entry's key one opens keys within it, and what everyone opens. -/
theorem KeyInv.knows_within {st : State} (hinv : KeyInv st) {f : KeyScope} (hf : f.scope?.isSome = true)
    {x : KeyName} (h : Knows st [st.curKey f] x) :
    (∃ k e, x = .scoped k e ∧ Within f k) ∨ Knows st [] x := by
  induction h with
  | own hx =>
    rw [List.mem_singleton] at hx
    exact .inl ⟨f, _, hx, Within.refl f⟩
  | published hx => exact .inr (.published hx)
  | «unseal» hs _ ih =>
    rcases ih with ⟨k, e, hto, hfk⟩ | ih
    · obtain ⟨k', e', hsec, hkk'⟩ := hinv.within _ hs k e hto (hfk.scope hf)
      exact .inl ⟨k', e', hsec, hfk.trans hkk'⟩
    · exact .inr (.unseal hs ih)

/-- A step raises the epoch of each stale family, by how often it is stale. -/
theorem epochOf_step {pre post : State} {op : Op} (hpost : apply pre op = some post) (k : KeyScope) :
    (settle pre post).epochOf k = pre.epochOf k + (staleKeys pre post).count k := by
  rw [epochOf_settle]
  simp only [State.epochOf, (apply_keys hpost).1]

/-- A family that isn't stale keeps its current key. -/
theorem curKey_step {pre post : State} {op : Op} (hpost : apply pre op = some post) {k : KeyScope}
    (hS : k ∉ staleKeys pre post) : (settle pre post).curKey k = pre.curKey k := by
  simp only [State.curKey, epochOf_step hpost, List.count_eq_zero.2 hS, Nat.add_zero]

/-- A stale family moves to a later epoch. -/
theorem epochOf_step_lt {pre post : State} {op : Op} (hpost : apply pre op = some post) {k : KeyScope}
    (hS : k ∈ staleKeys pre post) : pre.epochOf k < (settle pre post).epochOf k := by
  rw [epochOf_step hpost]
  have := List.count_pos_iff.2 hS
  omega

/-- A vault holder may open its own key. -/
theorem mayOpen_self (st : State) (v : VaultId) : MayOpen st (.vault v) (.vault v) :=
  .inl (by simp [Holder.entitled, entitledV])

/-- Before the step, a holder opened the current key of a family that doesn't rotate only if it may open it after:
    holders listed before are checked by `staleKeys`; a signer listed nowhere opened only public keys, which everyone
    opened; and a vault that didn't exist opened only its own key and what everyone opened. -/
theorem KeyInv.base_mayOpen {pre post : State} {op : Op} (hinv : KeyInv pre) (hpost : apply pre op = some post)
    {h : Holder} {k : KeyScope} (hS : k ∉ staleKeys pre post) (hx : Knows pre (h.start pre) (pre.curKey k)) :
    MayOpen (settle pre post) h k := by
  rcases hinv.knows_old hx with hstart | ⟨k', e, heq, hk', -⟩
  · cases h with
    | signer s => simp [Holder.start, State.curKey] at hstart
    | vault v =>
      simp only [Holder.start, List.mem_singleton, State.curKey, KeyName.scoped.injEq] at hstart
      obtain ⟨rfl, -⟩ := hstart
      exact mayOpen_self _ _
    | everyone => simp [Holder.start] at hstart
  · simp only [State.curKey, KeyName.scoped.injEq] at heq
    obtain ⟨rfl, -⟩ := heq
    have hk : k ∈ keyScopes post := keyScopes_apply hpost hk'
    rw [MayOpen, Holder.entitled_settle, publicKey_settle]
    cases hpub : publicKey post k
    · left
      -- what everyone opened is public now
      have hev : ¬ Knows pre [] (pre.curKey k) := fun hev => by
        have := entitled_of_not_stale hk hS hpub (everyone_mem_holders pre) (opens_complete hev)
        simp [Holder.entitled, hpub] at this
      by_cases hh : h ∈ holders pre
      · exact entitled_of_not_stale hk hS hpub hh (opens_complete hx)
      · cases h with
        | signer s =>
          rcases hinv.fwd (.signer s) k hx with hent | hpre
          · exact absurd (signer_mem_holders.2 (entitled_listed hent)) hh
          · exact (hev (.published (hinv.public k hk' hpre))).elim
        | vault v =>
          have hfresh : ∀ s ∈ pre.seals, s.to ≠ pre.curKey (.vault v) := by
            intro s hs hto
            have hin := (hinv.sealed s hs).1
            rw [hto] at hin
            obtain ⟨hvk, -⟩ := hin
            rcases mem_keyScopes.1 hvk with ⟨y, hy, hyv⟩ | ⟨_, _, h | ⟨_, _, h⟩⟩
            · cases hyv
              exact hh (vault_mem_holders.2 (List.mem_map.2 ⟨y, hy, rfl⟩))
            · cases h
            · cases h
          rcases knows_fresh hfresh hx with heq | hev'
          · simp only [State.curKey, KeyName.scoped.injEq] at heq
            obtain ⟨rfl, -⟩ := heq
            simp [Holder.entitled, entitledV]
          · exact (hev hev').elim
        | everyone => exact absurd (everyone_mem_holders pre) hh
    · exact .inr rfl

/-- Before the step, the previous key of a family a holder may open now opened only current keys of families it may
    open now, if they don't rotate: a vault's key opens what the vault may open, and a space's or an entry's key
    opens keys within it, and what everyone opens. -/
theorem KeyInv.closure_mayOpen {pre post : State} {op : Op} (hinv : KeyInv pre)
    (hpost : apply pre op = some post) (hf' : VaultFacts (settle pre post)) {h : Holder} {f k : KeyScope}
    (hS : k ∉ staleKeys pre post) (hf : MayOpen (settle pre post) h f)
    (hx : Knows pre [pre.curKey f] (pre.curKey k)) : MayOpen (settle pre post) h k := by
  cases hfs : f.scope? with
  | none =>
    cases f with
    | vault v =>
      have hv := hinv.base_mayOpen hpost (h := .vault v) hS hx
      rcases hf with hf | hf
      · exact hf'.mayOpen_via hf hv
      · simp [publicKey, KeyScope.scope?] at hf
    | space _ => simp [KeyScope.scope?] at hfs
    | entry _ _ => simp [KeyScope.scope?] at hfs
  | some sc =>
    rcases hinv.knows_within (by simp [hfs]) hx with ⟨k', e, heq, hfk⟩ | hev
    · simp only [State.curKey, KeyName.scoped.injEq] at heq
      obtain ⟨rfl, -⟩ := heq
      exact mayOpen_within hfk hf
    · rcases hinv.base_mayOpen hpost (h := .everyone) hS hev with h1 | h1
      · exact .inr h1
      · exact .inr h1

/-- What holder `h` may open after the step from `pre` that settles as `st'`: what it opened before, what the previous
    key of a family it may open now opened before, and the new keys of families it may open now. -/
def MayKnow (pre st' : State) (h : Holder) (x : KeyName) : Prop :=
  Knows pre (h.start pre) x ∨ (∃ f, MayOpen st' h f ∧ Knows pre [pre.curKey f] x) ∨
  ∃ k e, x = .scoped k e ∧ pre.epochOf k < e ∧ MayOpen st' h k

/-- A key newer than any before the step is one of a family the holder may open now. -/
theorem KeyInv.mayKnow_new {pre st' : State} (hinv : KeyInv pre) {h : Holder} {k : KeyScope} {e : Nat}
    (hx : MayKnow pre st' h (.scoped k e)) (he : pre.epochOf k < e) : MayOpen st' h k := by
  rcases hx with hx | ⟨f, -, hx⟩ | ⟨k', e', heq, -, hk⟩
  · rcases hinv.knows_old hx with hstart | ⟨k', e', heq, -, he'⟩
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
  · rcases hinv.knows_old hx with hstart | ⟨k', e', heq, -, he'⟩
    · simp only [List.mem_singleton, State.curKey, KeyName.scoped.injEq] at hstart
      obtain ⟨rfl, rfl⟩ := hstart
      omega
    · simp only [KeyName.scoped.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      omega
  · simp only [KeyName.scoped.injEq] at heq
    obtain ⟨rfl, rfl⟩ := heq
    exact hk

/-- A current key the holder may know after the step is one of a family it may open. -/
theorem KeyInv.mayKnow_cur {pre post : State} {op : Op} (hinv : KeyInv pre) (hpost : apply pre op = some post)
    (hf' : VaultFacts (settle pre post)) {h : Holder} {k : KeyScope}
    (hx : MayKnow pre (settle pre post) h ((settle pre post).curKey k)) : MayOpen (settle pre post) h k := by
  by_cases hS : k ∈ staleKeys pre post
  · exact hinv.mayKnow_new hx (epochOf_step_lt hpost hS)
  · rw [curKey_step hpost hS] at hx
    rcases hx with hx | ⟨f, hf, hx⟩ | ⟨k', e, heq, he, -⟩
    · exact hinv.base_mayOpen hpost hS hx
    · exact hinv.closure_mayOpen hpost hf' hS hf hx
    · simp only [State.curKey, KeyName.scoped.injEq] at heq
      obtain ⟨rfl, rfl⟩ := heq
      omega

/-- The current key of a family the holder may open is one it may know. -/
theorem mayKnow_of_mayOpen {pre post : State} {op : Op} (hpost : apply pre op = some post) {h : Holder}
    {k : KeyScope} (hk : MayOpen (settle pre post) h k) :
    MayKnow pre (settle pre post) h ((settle pre post).curKey k) := by
  by_cases hS : k ∈ staleKeys pre post
  · exact .inr (.inr ⟨k, _, rfl, epochOf_step_lt hpost hS, hk⟩)
  · rw [curKey_step hpost hS]
    exact .inr (.inl ⟨k, hk, .own (List.mem_singleton_self _)⟩)

/-- Only a signer may know its own key. -/
theorem KeyInv.mayKnow_signer {pre st' : State} (hinv : KeyInv pre) {h : Holder} {d : SignerId}
    (hx : MayKnow pre st' h (.signer d)) : h = .signer d := by
  rcases hx with hx | ⟨f, -, hx⟩ | ⟨k, e, heq, -, -⟩
  · rcases hinv.knows_old hx with hstart | ⟨_, _, heq, -⟩
    · cases h with
      | signer s =>
        simp only [Holder.start, List.mem_singleton, KeyName.signer.injEq] at hstart
        rw [hstart]
      | vault v => simp [Holder.start, State.curKey] at hstart
      | everyone => simp [Holder.start] at hstart
    · cases heq
  · rcases hinv.knows_old hx with hstart | ⟨_, _, heq, -⟩
    · simp [State.curKey] at hstart
    · cases heq
  · cases heq

/-- Everything a holder opens after the step is a key it may know: `MayKnow` holds the holder's start and what is
    published, and is closed under every seal, old, rotated or new. -/
theorem KeyInv.mayKnow_closed {pre post : State} {op : Op} (hinv : KeyInv pre) (hpost : apply pre op = some post)
    (hf' : VaultFacts (settle pre post)) {h : Holder} {x : KeyName}
    (hx : Knows (settle pre post) (h.start (settle pre post)) x) : MayKnow pre (settle pre post) h x := by
  obtain ⟨-, hseals, hpubs⟩ := apply_keys hpost
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
    · exact mayKnow_of_mayOpen hpost (.inr (by rw [publicKey_settle]; exact hpub))
  | «unseal» hs _ ih =>
    rcases settle_seals hs with hs | ⟨k, e, hS, he, -, rfl⟩ | ⟨k, -, t, ht, rfl⟩
    · -- an old seal stays within what was open before
      rw [hseals] at hs
      rcases ih with ih | ⟨f, hf, ih⟩ | ⟨k, e, hto, he, -⟩
      · exact .inl (.unseal hs ih)
      · exact .inr (.inl ⟨f, hf, .unseal hs ih⟩)
      · have hin := (hinv.sealed _ hs).1
        rw [hto] at hin
        exact absurd hin.2 (by omega)
    · -- a rotated family: whoever may open its new key may open it, and so the previous one
      have hpe : post.epochOf k = pre.epochOf k := by simp only [State.epochOf, (apply_keys hpost).1]
      rw [hpe] at he
      have hk := hinv.mayKnow_new ih (by omega)
      dsimp only
      by_cases hlt : pre.epochOf k < e
      · exact .inr (.inr ⟨k, e, rfl, hlt, hk⟩)
      · have : e = pre.epochOf k := by omega
        subst this
        exact .inr (.inl ⟨k, hk, .own (List.mem_singleton_self _)⟩)
    · -- a current key sealed to a target the holder may know
      dsimp only at ih ⊢
      refine mayKnow_of_mayOpen hpost ?_
      rcases mem_targets ht with ⟨d, v, rfl, rfl, hact⟩ | ⟨y, rfl, hy, -⟩ | ⟨sp, e, rfl, rfl⟩
      · rw [hinv.mayKnow_signer ih]
        exact .inl hact
      · have hv := hinv.mayKnow_cur hpost hf' ih
        rcases hv with hv | hv
        · exact hf'.mayOpen_via hv (.inl hy)
        · simp [publicKey, KeyScope.scope?] at hv
      · exact mayOpen_within (f := .space sp) (Or.inr ⟨e, rfl⟩) (hinv.mayKnow_cur hpost hf' ih)

/-- Key families and epochs only grow, so what a seal may hold before a step it may hold after. -/
theorem keyIn_step {pre post : State} {op : Op} (hpost : apply pre op = some post) {x : KeyName}
    (hx : KeyIn pre x) : KeyIn (settle pre post) x := by
  cases x with
  | signer _ => trivial
  | «scoped» k e =>
    obtain ⟨hk, he⟩ := hx
    refine ⟨by rw [keyScopes_settle]; exact keyScopes_apply hpost hk, ?_⟩
    rw [epochOf_step hpost]
    omega

/-- One step keeps `KeyInv`. -/
theorem KeyInv.step {st st' : State} {op : Op} (hinv : KeyInv st) (h : step st op = some st') : KeyInv st' := by
  have hf' := hinv.facts.step h
  unfold AvenDB.step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  obtain ⟨-, hseals, hpubs⟩ := apply_keys hpost
  refine ⟨hf', fun h k hk => hinv.mayKnow_cur hpost hf' (hinv.mayKnow_closed hpost hf' hk), ?_, ?_, ?_, ?_⟩
  · intro s hs
    rcases settle_seals hs with hs | ⟨k, e, hS, -, he, rfl⟩ | ⟨k, hk, t, ht, rfl⟩
    · rw [hseals] at hs
      obtain ⟨hto, k, e, hsec, hin⟩ := hinv.sealed s hs
      exact ⟨keyIn_step hpost hto, k, e, hsec, keyIn_step hpost hin⟩
    · have hk : k ∈ keyScopes (settle st post) := by rw [keyScopes_settle]; exact (List.mem_filter.1 hS).1
      exact ⟨⟨hk, he⟩, k, e, rfl, hk, by omega⟩
    · have hk' : k ∈ keyScopes (settle st post) := by rw [keyScopes_settle]; exact hk
      refine ⟨?_, k, _, rfl, hk', Nat.le_refl _⟩
      rcases target_exists hf' hk' ht with ⟨d, rfl⟩ | ⟨k', hk'', rfl⟩
      · trivial
      · exact ⟨hk'', Nat.le_refl _⟩
  · intro x hx
    rcases settle_published hx with hx | ⟨k, hk, -, rfl⟩
    · rw [hpubs] at hx
      obtain ⟨k, e, rfl, hin⟩ := hinv.published _ hx
      exact ⟨k, e, rfl, keyIn_step hpost hin⟩
    · exact ⟨k, _, rfl, by rw [keyScopes_settle]; exact hk, Nat.le_refl _⟩
  · intro s hs f e hto hf
    rcases settle_seals hs with hs | ⟨k, e', -, -, -, rfl⟩ | ⟨k, -, t, ht, rfl⟩
    · rw [hseals] at hs
      exact hinv.within s hs f e hto hf
    · simp only [KeyName.scoped.injEq] at hto
      obtain ⟨rfl, -⟩ := hto
      exact ⟨_, e', rfl, Within.refl _⟩
    · dsimp only at hto ⊢
      rcases mem_targets ht with ⟨d, v, rfl, -, -⟩ | ⟨y, rfl, -, -⟩ | ⟨sp, e', rfl, rfl⟩
      · cases hto
      · simp only [State.curKey, KeyName.scoped.injEq] at hto
        obtain ⟨rfl, -⟩ := hto
        simp [KeyScope.scope?] at hf
      · simp only [State.curKey, KeyName.scoped.injEq] at hto
        obtain ⟨rfl, -⟩ := hto
        exact ⟨_, _, rfl, Or.inr ⟨e', rfl⟩⟩
  · intro k hk hpub
    rw [keyScopes_settle] at hk
    rw [publicKey_settle] at hpub
    exact settle_publishes hk hpub

/-- The empty state has no vaults, no seals and nothing published. -/
theorem keyInv_empty : KeyInv {} := by
  have hstart : ∀ (h : Holder) x, Knows {} (h.start {}) x → x ∈ h.start {} := fun h x hx => by
    cases hx with
    | own hx => exact hx
    | published hx => cases hx
    | «unseal» hs _ => cases hs
  refine ⟨⟨fun y hy => ?_, fun x vt hx => ?_⟩, fun h k hk => ?_, fun s hs => ?_,
    fun x hx => ?_, fun s hs => ?_, fun k hk => ?_⟩
  · obtain ⟨_, _, hx, _⟩ := transGen_head hy
    simp [State.vault?] at hx
  · simp [State.vault?] at hx
  · have hx := hstart h _ hk
    cases h with
    | signer s => simp [Holder.start, State.curKey] at hx
    | vault v =>
      simp only [Holder.start, List.mem_singleton, State.curKey, KeyName.scoped.injEq] at hx
      obtain ⟨rfl, -⟩ := hx
      exact mayOpen_self _ _
    | everyone => simp [Holder.start] at hx
  · cases hs
  · cases hx
  · cases hs
  · simp [keyScopes] at hk

/-- Every reachable state keeps `KeyInv`. -/
theorem keyInv_replay (ops : List Op) : KeyInv (replay {} ops) :=
  replay_inv KeyInv (fun _ _ _ h hs => h.step hs) ops {} keyInv_empty

/-! ## T5, along the history

Every seal is justified by the history: a key sealed to a signer's key is one that signer could read, a key sealed to
another family's key is one whoever could read that family could read, and a published key is one of a family that
was public. Opening keys follows seals, so whoever opens a key could read its family. -/

/-- Over the history `sts`, holder `h` could read key family `k` at some point: it was entitled to `k` then, `k` was
    public then, or it was then entitled to the key of a vault that could read `k` at some point of the history,
    before or after. Whoever joins a vault inherits what the vault could read. -/
inductive EverReads (sts : List State) : Holder → KeyScope → Prop where
  | entitled {h : Holder} {k : KeyScope} {st : State} : st ∈ sts → h.entitled st k = true → EverReads sts h k
  | «public» {h : Holder} {k : KeyScope} {st : State} : st ∈ sts → publicKey st k = true → EverReads sts h k
  | via {h : Holder} {v : VaultId} {k : KeyScope} {st : State} : st ∈ sts → h.entitled st (.vault v) = true →
      EverReads sts (.vault v) k → EverReads sts h k

/-- Whoever could read a vault's key could read whatever that vault could read. -/
theorem EverReads.trans_vault {sts : List State} {h : Holder} {v : VaultId} {k : KeyScope}
    (h₁ : EverReads sts h (.vault v)) (h₂ : EverReads sts (.vault v) k) : EverReads sts h k := by
  generalize hk : KeyScope.vault v = kv at h₁
  induction h₁ generalizing v with
  | entitled hst hent => subst hk; exact .via hst hent h₂
  | «public» _ hpub => subst hk; simp [publicKey, KeyScope.scope?] at hpub
  | via hst hent _ ih => exact .via hst hent (ih h₂ hk)

/-- Whoever could read a space could read its entries. -/
theorem EverReads.entry {sts : List State} {h : Holder} {sp : SpaceId} (e : EntryId)
    (hr : EverReads sts h (.space sp)) : EverReads sts h (.entry sp e) := by
  generalize hk : KeyScope.space sp = ks at hr
  induction hr with
  | entitled hst hent => subst hk; exact .entitled hst (Holder.entitled_entry e hent)
  | «public» hst hpub => subst hk; exact .public hst (isPublic_entry e hpub)
  | via hst hent _ ih => exact .via hst hent (ih hk)

/-- Over the history `sts`, every seal and every published key of `st` is justified. -/
def SealsRead (sts : List State) (st : State) : Prop :=
  (∀ s ∈ st.seals, ∃ a e, s.secret = .scoped a e ∧
    (∀ d, s.to = .signer d → EverReads sts (.signer d) a) ∧
    (∀ b e', s.to = .scoped b e' → ∀ h, EverReads sts h b → EverReads sts h a)) ∧
  (∀ x ∈ st.published, ∃ a e, x = .scoped a e ∧ ∃ st₀ ∈ sts, publicKey st₀ a = true)

/-- A step whose result is part of the history keeps every seal justified: a rotation seals a family's key to its
    own next key, and a current key is sealed only to those entitled to it then. -/
theorem SealsRead.step {sts : List State} {st st' : State} {op : Op} (hinv : SealsRead sts st)
    (h : step st op = some st') (hst' : st' ∈ sts) : SealsRead sts st' := by
  unfold AvenDB.step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  obtain ⟨-, hseals, hpubs⟩ := apply_keys hpost
  refine ⟨fun s hs => ?_, fun x hx => ?_⟩
  · rcases settle_seals hs with hs | ⟨k, e, -, -, -, rfl⟩ | ⟨k, -, t, ht, rfl⟩
    · exact hinv.1 s (hseals ▸ hs)
    · refine ⟨k, e, rfl, (fun d hd => by cases hd), fun b e' hb h hr => ?_⟩
      simp only [KeyName.scoped.injEq] at hb
      obtain ⟨rfl, -⟩ := hb
      exact hr
    · refine ⟨k, _, rfl, fun d hd => ?_, fun b e' hb h hr => ?_⟩
      · dsimp only at hd
        subst hd
        rcases mem_targets ht with ⟨d, v, heq, rfl, hact⟩ | ⟨y, heq, -, -⟩ | ⟨sp, e, heq, -⟩
        · cases heq
          exact .entitled hst' hact
        · cases heq
        · cases heq
      · dsimp only at hb
        subst hb
        rcases mem_targets ht with ⟨d, v, heq, -, -⟩ | ⟨y, heq, hy, -⟩ | ⟨sp, e, heq, rfl⟩
        · cases heq
        · simp only [State.curKey, KeyName.scoped.injEq] at heq
          obtain ⟨rfl, -⟩ := heq
          exact hr.trans_vault (.entitled hst' hy)
        · simp only [State.curKey, KeyName.scoped.injEq] at heq
          obtain ⟨rfl, -⟩ := heq
          exact hr.entry e
  · rcases settle_published hx with hx | ⟨k, -, hpub, rfl⟩
    · exact hinv.2 x (hpubs ▸ hx)
    · exact ⟨k, _, rfl, _, hst', by rw [publicKey_settle]; exact hpub⟩

/-- The empty state has no seals and publishes nothing. -/
theorem sealsRead_empty (sts : List State) : SealsRead sts {} :=
  ⟨(fun _ hs => by cases hs), (fun _ hx => by cases hx)⟩

/-- A trace holds the state it starts from. -/
theorem mem_trace_self (st : State) : ∀ ops, st ∈ trace st ops
  | [] => List.mem_singleton_self _
  | _ :: _ => List.mem_cons_self

/-- A trace holds the state it ends in. -/
theorem replay_mem_trace : ∀ (st : State) (ops : List Op), replay st ops ∈ trace st ops
  | _, [] => List.mem_singleton_self _
  | st, op :: ops => List.mem_cons_of_mem _ (replay_mem_trace ((step st op).getD st) ops)

/-- A step never lowers an epoch. -/
theorem epochOf_le_step (st : State) (op : Op) (k : KeyScope) : st.epochOf k ≤ ((step st op).getD st).epochOf k := by
  unfold step
  cases hp : apply st op with
  | none => exact Nat.le_refl _
  | some post =>
    show st.epochOf k ≤ (settle st post).epochOf k
    rw [epochOf_step hp]
    exact Nat.le_add_right _ _

/-- Epochs only grow along a replay: no state of its trace has an epoch beyond the one where the replay ends. -/
theorem epochOf_le_replay (k : KeyScope) : ∀ (st : State) (ops : List Op), ∀ x ∈ trace st ops,
    x.epochOf k ≤ (replay st ops).epochOf k
  | _, [], _, hx => by rw [List.mem_singleton.1 hx]; exact Nat.le_refl _
  | st, op :: ops, x, hx => by
    rcases List.mem_cons.1 hx with rfl | hx
    · exact Nat.le_trans (epochOf_le_step x op k) (epochOf_le_replay k _ ops _ (mem_trace_self _ ops))
    · exact epochOf_le_replay k _ ops x hx

/-- Along a replay whose states are all part of the history, every seal stays justified. -/
theorem sealsRead_replay {sts : List State} : ∀ (ops : List Op) (st : State), (∀ x ∈ trace st ops, x ∈ sts) →
    SealsRead sts st → SealsRead sts (replay st ops)
  | [], _, _, h => h
  | op :: ops, st, htr, h => by
    have htr' : ∀ x ∈ trace ((step st op).getD st) ops, x ∈ sts := fun x hx => htr x (List.mem_cons_of_mem _ hx)
    show SealsRead sts (replay ((step st op).getD st) ops)
    cases hs : step st op with
    | none =>
      rw [hs] at htr'
      exact sealsRead_replay ops st htr' h
    | some st' =>
      rw [hs] at htr'
      exact sealsRead_replay ops st' htr' (h.step hs (htr' st' (mem_trace_self st' ops)))

/-- With every seal justified, a holder opens a signer's key only if it is that signer, and a key of a family only if
    it could read that family. -/
theorem knows_everReads {sts : List State} {st : State} (hst : st ∈ sts) (hinv : SealsRead sts st) {h : Holder}
    {x : KeyName} (hx : Knows st (h.start st) x) :
    (∀ d, x = .signer d → h = .signer d) ∧ (∀ k e, x = .scoped k e → EverReads sts h k) := by
  induction hx with
  | own hx =>
    cases h with
    | signer s =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      exact ⟨(fun d hd => by cases hd; rfl), (fun k e hk => by cases hk)⟩
    | vault v =>
      simp only [Holder.start, List.mem_singleton] at hx
      subst hx
      refine ⟨(fun d hd => by cases hd), fun k e hk => ?_⟩
      simp only [State.curKey, KeyName.scoped.injEq] at hk
      obtain ⟨rfl, -⟩ := hk
      exact .entitled hst (by simp [Holder.entitled, entitledV])
    | everyone => simp [Holder.start] at hx
  | published hx =>
    obtain ⟨a, e, rfl, st₀, hst₀, hpub⟩ := hinv.2 _ hx
    refine ⟨(fun d hd => by cases hd), fun k e' hk => ?_⟩
    simp only [KeyName.scoped.injEq] at hk
    obtain ⟨rfl, -⟩ := hk
    exact .public hst₀ hpub
  | «unseal» hs _ ih =>
    obtain ⟨a, e, hsec, hsig, hsc⟩ := hinv.1 _ hs
    rw [hsec]
    refine ⟨(fun d hd => by cases hd), fun k e' hk => ?_⟩
    simp only [KeyName.scoped.injEq] at hk
    obtain ⟨rfl, -⟩ := hk
    rename_i s _
    cases hto : s.to with
    | signer d =>
      rw [ih.1 d hto]
      exact hsig d hto
    | «scoped» b e'' => exact hsc b e'' hto h (ih.2 b e'' hto)

end AvenDB
