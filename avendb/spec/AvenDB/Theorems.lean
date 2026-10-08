import AvenDB.Sync
import AvenDB.Doc
import AvenDB.Branches
import AvenDB.Lens
import AvenDB.Lemmas
import AvenDB.KeyLemmas
import AvenDB.SyncLemmas

/-!
# The theorems

What must always hold, stated over the executable model, all of it proven. T9 (lenses) and T10 (branches) are proven
in their own files. The proofs' helper lemmas are in `Lemmas.lean`, for the keys in `KeyLemmas.lean`, and for sync in
`SyncLemmas.lean`.

The assumptions are part of the model rather than axioms: an op's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed or encrypted data reveals nothing without its key);
ids don't collide (a hypothesis where needed: `Nodup`, or that an id two peers both hold names one op); and Loro's
laws are fields of `Loro`.
-/

namespace AvenDB

/-- A state some peer can be in: the replay of some ops from the empty state. -/
def Reachable (st : State) : Prop := ∃ ops, st = replay {} ops

/-! ## Writes -/

/-- T1 (authorized writes only): a step adds a write only if, just before it, the write's author acted for its
    vault and that vault held write on the entry. -/
theorem T1_authorized_writes {st st' : State} {op : Op} (h : step st op = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) : authorized st w = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_writes] at hw
  rcases apply_writes hpost with ⟨hws, -⟩ | ⟨w', hws, hauth, -, -⟩ | ⟨keep, mid, -, rfl, hmid⟩
  · exact absurd (hws ▸ hw) hnew
  · rw [hws] at hw
    rcases List.mem_append.1 hw with hw | hw
    · exact absurd hw hnew
    · rw [List.mem_singleton] at hw
      subst hw
      exact hauth
  · -- a removal only drops writes
    exact absurd (hmid ▸ (List.mem_filter.1 ((closeDeps_sublist _).subset hw)).1) hnew

/-- T1, second half (revocation wins): an older write that a step takes the authorization from survives only if
    the step is a removal that had seen it. -/
theorem T1_revocation_wins {st st' : State} {op : Op} (h : step st op = some st') {w : Write}
    (hw : w ∈ st'.writes) (_hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, op.action.keep? = some keep ∧ w.op ∈ keep := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  -- if `post` keeps what `authorized` reads in a state where the write was authorized, it still is after the step
  have hstill : ∀ s, Keeps s post → authorized s w = true → False := fun s hk ha => by
    rw [authorized_keeps (hk.trans (Keeps.settle st post)) ha] at hnow
    cases hnow
  rcases apply_writes hpost with ⟨-, hk⟩ | ⟨_, -, -, -, hk, -⟩ | ⟨keep, mid, hkeep, rfl, -⟩
  · exact (hstill st hk hwas).elim
  · exact (hstill st hk hwas).elim
  · -- the write passed `dropUnseen`'s filter, and it isn't authorized after the removal, so the removal kept it
    refine ⟨keep, hkeep, ?_⟩
    rw [settle_writes] at hw
    have hpass := (List.mem_filter.1 ((closeDeps_sublist _).subset hw)).2
    cases hmid : authorized mid w
    · simpa [hwas, hmid] using hpass
    · exact (hstill mid (Keeps.dropUnseen st mid keep) hmid).elim

/-! ## Vaults -/

/-- T2 (governance threshold): when a step changes a vault's owners, threshold or devices, the op carries the
    vault's approval (its threshold of owners, recursively down to signers), or an owner or a device removes
    itself. -/
theorem T2_governance {st st' : State} {op : Op} (h : step st op = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt')
    (hchg : vt.owners ≠ vt'.owners ∨ vt.threshold ≠ vt'.threshold ∨ vt.devices ≠ vt'.devices) :
    approves st op.sigs (.vault v) = true ∨
    (∃ p, vt'.owners = vt.owners.erase p ∧ approves st op.sigs p = true) ∨
    (∃ d, vt'.devices = vt.devices.erase d ∧ d ∈ op.sigs) := by
  rcases step_vault?_old h h₁ h₂ with rfl | hch
  · simp at hchg
  · cases hch with
    | addOwner _ _ _ _ happ _ => exact .inl happ
    | removeOwner p happ =>
      rcases happ with happ | happ
      · exact .inl happ
      · exact .inr (.inl ⟨p, rfl, happ⟩)
    | setThreshold _ happ => exact .inl happ
    | addDevice _ happ _ => exact .inl happ
    | removeDevice d happ =>
      rcases happ with happ | hd
      · exact .inl happ
      · exact .inr (.inr ⟨d, rfl, hd⟩)
    | setRoot _ _ _ => simp at hchg

/-- T2, consent: an owner or a device is added only with its own signature. -/
theorem T2_consent {st st' : State} {op : Op} (h : step st op = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st op.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ op.sigs) := by
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
    | addDevice d _ hd =>
      refine ⟨fun q hq hn => absurd hq hn, fun d' hd' hn => ?_⟩
      rcases List.mem_append.1 hd' with hd' | hd'
      · exact absurd hd' hn
      · rw [List.mem_singleton] at hd'
        exact hd' ▸ hd
    | removeDevice _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd (List.mem_of_mem_erase hd) hn⟩
    | setRoot _ _ _ => exact ⟨fun q hq hn => absurd hq hn, fun d hd hn => absurd hd hn⟩

/-- Devices don't govern: signatures that include neither an owner signer nor the root never approve for a human
    vault. -/
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

/-- `OwnsPlus st a x`: vault `a` owns vault `x`, directly or through a chain. -/
inductive OwnsPlus (st : State) : VaultId → VaultId → Prop where
  | direct {a x : VaultId} {vt : Vault} : st.vault? x = some vt → Principal.vault a ∈ vt.owners → OwnsPlus st a x
  | trans {a b x : VaultId} : OwnsPlus st a b → OwnsPlus st b x → OwnsPlus st a x

def Acyclic (st : State) : Prop := ∀ v, ¬ OwnsPlus st v v

/-- Every vault some vault lists as an owner exists. Genesis and addOwner only ever name existing vaults, and no op
    removes a vault, so this holds in every reachable state. -/
def OwnersExist (st : State) : Prop :=
  ∀ x vt, st.vault? x = some vt → ∀ o, Principal.vault o ∈ vt.owners → (st.vault? o).isSome

/-- `OwnsPlus` is a chain of `OwnerOf` links, the form `Lemmas.lean` works with. -/
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
theorem T3_step {st st' : State} {op : Op} (hacyc : Acyclic st) (hex : OwnersExist st) (h : step st op = some st') :
    Acyclic st' ∧ OwnersExist st' := by
  obtain ⟨hacyc', hex'⟩ := step_owners (fun y hy => hacyc y (ownsPlus_iff.2 hy)) hex h
  exact ⟨fun y hy => hacyc' y (ownsPlus_iff.1 hy), hex'⟩

/-- T3 (no ownership cycles): in every reachable state the vault graph is acyclic, so every chain ends in signers. -/
theorem T3_no_cycles (ops : List Op) : Acyclic (replay {} ops) := by
  suffices h : ∀ st, Acyclic st → OwnersExist st → Acyclic (replay st ops) ∧ OwnersExist (replay st ops) by
    refine (h {} (fun v hv => ?_) (fun x vt hx => ?_)).1
    · obtain ⟨_, _, hx, _⟩ := transGen_head (ownsPlus_iff.1 hv)
      simp [State.vault?] at hx
    · simp [State.vault?] at hx
  induction ops with
  | nil => exact fun _ h₁ h₂ => ⟨h₁, h₂⟩
  | cons op ops ih =>
    intro st h₁ h₂
    show Acyclic (replay ((step st op).getD st) ops) ∧ OwnersExist (replay ((step st op).getD st) ops)
    cases hs : step st op with
    | none => exact ih st h₁ h₂
    | some st' =>
      obtain ⟨h₁', h₂'⟩ := T3_step h₁ h₂ hs
      exact ih st' h₁' h₂'

/-! ## Caps -/

def GrantsNameVaults (st : State) : Prop := ∀ g ∈ st.grants, ∀ s, g.grantee ≠ .principal (.signer s)

/-- T4 (grants name vaults): no step adds a grant that names a signer. -/
theorem T4_grants_name_vaults {st st' : State} {op : Op} (hinv : GrantsNameVaults st) (h : step st op = some st') :
    GrantsNameVaults st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  intro g hg
  rw [settle_grants] at hg
  rcases apply_grants hpost with hsub | ⟨g', hgs, hname, -⟩
  · exact hinv g (hsub g hg)
  · rw [hgs] at hg
    rcases List.mem_append.1 hg with hg | hg
    · exact hinv g hg
    · rw [List.mem_singleton] at hg
      subst hg
      exact hname

def PublicReadOnly (st : State) : Prop := ∀ g ∈ st.grants, g.grantee = .«public» → g.role = .read

/-- T8 (Public is read-only): Public only ever gets read. It can't write or grant either, since writes and grants
    act for a vault. -/
theorem T8_public_read_only {st st' : State} {op : Op} (hinv : PublicReadOnly st) (h : step st op = some st') :
    PublicReadOnly st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  intro g hg
  rw [settle_grants] at hg
  rcases apply_grants hpost with hsub | ⟨g', hgs, -, hpub⟩
  · exact hinv g (hsub g hg)
  · rw [hgs] at hg
    rcases List.mem_append.1 hg with hg | hg
    · exact hinv g hg
    · rw [List.mem_singleton] at hg
      subst hg
      exact hpub

/-! ## The schema lane -/

/-- T17: only a space's owners publish its schemas and lenses. A step adds an entry to the lane only if it publishes
    that blob into that space, and just before it, its author acted for a vault holding owner on the space. -/
theorem T17_lane_by_owners {st st' : State} {op : Op} (h : step st op = some st') {x : SpaceId × BlobId}
    (hx : x ∈ st'.lane) (hnew : x ∉ st.lane) :
    ∃ actor, op.action = .publish x.1 actor x.2 ∧ actsFor st op.author actor = true ∧
      holds st actor (.space x.1) .owner = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_lane] at hx
  rcases apply_lane hpost with hl | ⟨sp, actor, blob, hact, hacts, hholds, hl⟩
  · exact absurd (hl ▸ hx) hnew
  · rw [hl] at hx
    rcases List.mem_append.1 hx with hx | hx
    · exact absurd hx hnew
    · rw [List.mem_singleton] at hx
      subst hx
      exact ⟨actor, hact, hacts, hholds⟩

/-! ## Causal closure -/

/-- Every accepted write's dependencies are accepted writes of its own entry. -/
def CausallyClosed (st : State) : Prop :=
  ∀ w ∈ st.writes, ∀ d ∈ w.deps, ∃ x ∈ st.writes, x.op = d ∧ x.space = w.space ∧ x.entry = w.entry

/-- T14 (accepted writes are causally closed): no step accepts a write before what it builds on, and a removal that
    drops a write drops every write that builds on it. -/
theorem T14_causally_closed {st st' : State} {op : Op} (hinv : CausallyClosed st) (h : step st op = some st') :
    CausallyClosed st' := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  have hpre : ∀ w ∈ st.writes, depsIn st.writes w = true := fun w hw => depsIn_iff.2 (hinv w hw)
  suffices hc : ∀ w ∈ post.writes, depsIn post.writes w = true by
    intro w hw
    rw [settle_writes] at hw ⊢
    exact depsIn_iff.1 (hc w hw)
  rcases apply_writes hpost with ⟨hws, -⟩ | ⟨w', hws, -, hdeps, -⟩ | ⟨keep, mid, -, rfl, -⟩
  · rw [hws]
    exact hpre
  · -- the new write builds on accepted writes
    rw [hws]
    have hsub : ∀ x ∈ st.writes, x ∈ st.writes ++ [w'] := fun x hx => List.mem_append_left _ hx
    intro w hw
    rcases List.mem_append.1 hw with hw | hw
    · exact depsIn_mono (hpre w hw) hsub
    · rw [List.mem_singleton] at hw
      subst hw
      exact depsIn_mono hdeps hsub
  · -- a removal keeps only writes whose dependencies it keeps
    exact closeDeps_closed _

/-! ## What a peer knows

A peer's view replays the ops that stand, so everything that holds in every state the ops can reach holds in it. -/

/-- The view is the replay of the ops that stand in it. -/
theorem view_eq_replay (ops : List Op) : view ops = replay {} (standing ops) := runFrom_fst _ _ _ _

theorem view_reachable (ops : List Op) : Reachable (view ops) := ⟨_, view_eq_replay ops⟩

/-- T3, T4, T8 and T14 in every peer's view. -/
theorem view_invariants (ops : List Op) :
    Acyclic (view ops) ∧ GrantsNameVaults (view ops) ∧ PublicReadOnly (view ops) ∧ CausallyClosed (view ops) := by
  rw [view_eq_replay]
  -- each holds in the empty state, and every accepted step keeps it
  have h := replay_inv (fun st => GrantsNameVaults st ∧ PublicReadOnly st ∧ CausallyClosed st)
    (fun _ _ _ ⟨h₁, h₂, h₃⟩ h => ⟨T4_grants_name_vaults h₁ h, T8_public_read_only h₂ h, T14_causally_closed h₃ h⟩)
    (standing ops) {} (by simp [GrantsNameVaults, PublicReadOnly, CausallyClosed])
  exact ⟨T3_no_cycles _, h⟩

/-! ## Branches

Every peer's writes come in an order their dependencies respect, so `Branches.lean`'s T10f to T10h hold of what every
peer shows on every line. -/

/-- No step breaks the order of the writes: a new write builds only on accepted writes and brings a new id, and a
    removal keeps some of the writes, in order. -/
theorem writes_ordered_step {st st' : State} {op : Op} (hc : CausallyClosed st) (ho : Ordered st.writes)
    (h : step st op = some st') : Ordered st'.writes := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_writes]
  obtain ⟨hnd, hpw, hself⟩ := ho
  rcases apply_writes hpost with ⟨hws, -⟩ | ⟨w, hws, -, hdeps, -, -, -, -, hfresh, -⟩ | ⟨keep, mid, -, rfl, hmid⟩
  · rw [hws]
    exact ⟨hnd, hpw, hself⟩
  · rw [hws]
    -- what the accepted writes build on is accepted already, so none builds on `w`, whose id is new
    have hnot : ∀ x ∈ st.writes, w.op ∉ x.deps := fun x hx hd => by
      obtain ⟨y, hy, hyd, -⟩ := hc x hx _ hd
      exact hfresh y hy hyd
    refine ⟨?_, ?_, ?_⟩
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
  · -- a removal keeps some of the writes, in order
    have hsub : (dropUnseen st mid keep).writes.Sublist st.writes :=
      (closeDeps_sublist _).trans (hmid ▸ List.filter_sublist)
    exact ⟨(hsub.map _).nodup hnd, hpw.sublist hsub, fun x hx => hself x (hsub.subset hx)⟩

/-- Every peer's writes come in an order their dependencies respect, so T10f to T10h hold of what it shows. -/
theorem writes_ordered (ops : List Op) : Ordered (view ops).writes := by
  rw [view_eq_replay]
  have h := replay_inv (fun st => CausallyClosed st ∧ Ordered st.writes)
    (fun _ _ _ ⟨h₁, h₂⟩ h => ⟨T14_causally_closed h₁ h, writes_ordered_step h₁ h₂ h⟩)
    (standing ops) {} (by simp [CausallyClosed, Ordered])
  exact h.2

/-! ## Strong removal -/

/-- T16 (strong removal), replaying `ops` with the removals `rem`: an op stands only if `apply` accepts it on the
    state just before it (the replay of the ops that stood before it) with the facts hidden from it taken away; and
    those facts include everything each removal of `rem` after it takes away, unless that removal had seen it. -/
theorem T16_strong_removal (ops rem : List Op) (pre post : List (Op × Nat)) (x : Op) (i : Nat)
    (_hsplit : ops.zipIdx = pre ++ (x, i) :: post)
    (hstood : (runFrom rem (cuts ops rem) (runFrom rem (cuts ops rem) {} pre).1 [(x, i)]).2 = [x]) :
    (apply (hide (replay {} (runFrom rem (cuts ops rem) {} pre).2) (hiddenAt (cuts ops rem) i x)) x).isSome ∧
    ∀ r j, ops[j]? = some r → rem.any (·.id == r.id) → i < j → x.id ∉ r.action.keep?.getD [] →
      ∀ f ∈ removes ops r, f ∈ hiddenAt (cuts ops rem) i x := by
  refine ⟨?_, fun r j hr hrem hij hkeep f hf => ?_⟩
  · -- the op stood after the ops before it, so `apply` accepted it with its hidden facts taken away
    rw [← runFrom_fst]
    generalize (runFrom rem (cuts ops rem) {} pre).1 = st at hstood ⊢
    unfold runFrom at hstood
    split at hstood
    · simp [runFrom] at hstood
    · split at hstood
      · rename_i hap _
        rw [hap]
        rfl
      · simp [runFrom] at hstood
  · -- the removal is among the cuts, after the op, and hadn't seen it
    unfold hiddenAt cuts
    refine List.mem_flatMap.2 ⟨(j, r.action.keep?.getD [], removes ops r), List.mem_filter.2 ⟨List.mem_filterMap.2
      ⟨(r, j), List.mem_zipIdx_iff_getElem?.2 hr, by simp [hrem]⟩, by simp [hij, hkeep]⟩, hf⟩

/-- T16, the removals that stand: every removal `resolve` picks stands in the view. -/
theorem T16_resolved_removals_stand (ops : List Op) :
    ∀ r ∈ resolve (order ops), (standing ops).any (·.id == r.id) :=
  resolve_stands (order ops)

/-! ## Once the curves fall -/

/-- T18 (post-quantum writes): a peer that no longer trusts the curves (`checkpointed`) counts a write only if its
    author vouched for it in a checkpoint, which carries the hash-based half of the author's signature: whoever broke
    the curves, and with them a device's classical key, writes nothing such a peer counts. -/
theorem T18_checkpointed_writes (ops : List Op) {w : Write} (hw : w ∈ (view (checkpointed ops)).writes) :
    ∃ c ∈ ops, c.author = w.author ∧ ∃ sp e covers, c.action = .checkpoint sp e covers ∧ w.op ∈ covers := by
  rw [view_eq_replay] at hw
  rcases replay_writes_from _ {} w hw with h | ⟨o, ho, hid, hauth, hact⟩
  · simp at h
  · obtain ⟨-, hkeep⟩ := List.mem_filter.1 (standing_mem _ o ho)
    rw [hact] at hkeep
    obtain ⟨c, hc, hv⟩ := List.any_eq_true.1 hkeep
    simp only [vouches, Bool.and_eq_true, beq_iff_eq] at hv
    obtain ⟨hca, hcov⟩ := hv
    split at hcov
    · rename_i sp e covers heq
      exact ⟨c, hc, hca.trans hauth, sp, e, covers, heq, hid ▸ List.contains_iff_mem.1 hcov⟩
    · cases hcov

/-! ## Keys

`EverReads`, what a holder could read over a history, is in `KeyLemmas.lean`. -/

/-- T5 (confidentiality): after any history, a holder (a signer, whoever holds a vault's key, or everyone) opens a
    key of some family, of any epoch, only if over that history it could read the family. -/
theorem T5_confidentiality (ops : List Op) (h : Holder) (k : KeyScope) (e : Nat)
    (hk : Knows (replay {} ops) (h.start (replay {} ops)) (.scoped k e)) : EverReads (trace {} ops) h k :=
  -- every seal along the history is justified, from the empty state on, and opening keys follows seals
  (knows_everReads (replay_mem_trace {} ops) (sealsRead_replay ops {} (fun _ hx => hx) (sealsRead_empty _)) hk).2
    k e rfl

/-- T6 (forward secrecy): in every reachable state a holder opens the current key of a family only while it is
    entitled to it, or the family is public. New edits use current keys, so nothing written after a removal reaches
    the removed device, nor anyone who joins a vault that lost its read. -/
theorem T6_forward_secrecy {st : State} (hr : Reachable st) (h : Holder) (k : KeyScope)
    (hk : Knows st (h.start st) (st.curKey k)) : h.entitled st k = true ∨ publicKey st k = true := by
  obtain ⟨ops, rfl⟩ := hr
  exact (keyInv_replay ops).fwd h k hk

/-- A holder that never reads anything through its vaults, whatever vault it held at whatever point, reads a space
    or entry only while it is public. -/
theorem everReads_blind {sts : List State} {h : Holder} {k : KeyScope} (hr : EverReads sts h k)
    (hblind : ∀ v, EverReads sts h (.vault v) → ∀ st ∈ sts, ∀ sc, holds st v sc .read = false)
    (hk : k.scope?.isSome) : ∃ st ∈ sts, publicKey st k = true := by
  induction hr with
  | @entitled h k st hst hent =>
    cases k with
    | vault v => simp [KeyScope.scope?] at hk
    | space sp =>
      cases h with
      | signer s =>
        simp only [Holder.entitled, entitled, List.any_eq_true, Bool.and_eq_true] at hent
        obtain ⟨x, _, hact, hread⟩ := hent
        have hx := hblind x.id (.entitled hst (by simp [Holder.entitled, entitled, hact])) st hst (.space sp)
        simp [hx] at hread
      | vault y =>
        simp only [Holder.entitled, entitledV, List.any_eq_true, Bool.and_eq_true] at hent
        obtain ⟨x, _, hown, hread⟩ := hent
        have hx := hblind x.id (.entitled hst (by simpa [Holder.entitled, entitledV] using hown)) st hst (.space sp)
        simp [hx] at hread
      | everyone => exact ⟨st, hst, hent⟩
    | entry sp en =>
      cases h with
      | signer s =>
        simp only [Holder.entitled, entitled, List.any_eq_true, Bool.and_eq_true] at hent
        obtain ⟨x, _, hact, hread⟩ := hent
        have hx := hblind x.id (.entitled hst (by simp [Holder.entitled, entitled, hact])) st hst (.entry sp en)
        simp [hx] at hread
      | vault y =>
        simp only [Holder.entitled, entitledV, List.any_eq_true, Bool.and_eq_true] at hent
        obtain ⟨x, _, hown, hread⟩ := hent
        have hx := hblind x.id (.entitled hst (by simpa [Holder.entitled, entitledV] using hown)) st hst (.entry sp en)
        simp [hx] at hread
      | everyone => exact ⟨st, hst, hent⟩
  | «public» hst hpub => exact ⟨_, hst, hpub⟩
  | via hst hent _ ih => exact ih (fun w hw => hblind w (.via hst hent hw)) hk

/-- T7 (blind server): a device that never held, directly or through vaults it held at any point, the key of a
    vault that ever holds read anywhere, such as the server with its relay caps, opens no space or entry key unless
    that key was public at some point. -/
theorem T7_blind_server (ops : List Op) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} ops) (.signer srv) (.vault v) →
      ∀ st ∈ trace {} ops, ∀ sc, holds st v sc .read = false)
    {k : KeyScope} (hk : k.scope?.isSome) {e : Nat} (h : Knows (replay {} ops) [.signer srv] (.scoped k e)) :
    ∃ st ∈ trace {} ops, publicKey st k = true :=
  everReads_blind (T5_confidentiality ops (.signer srv) k e h) hblind hk

/-! ## Rotation follows revocation

A device writes an entry under the current key of that entry in what it knows, as the Lab does, so once a removal
stands in what it knows, the removed can't open what it writes. Peers don't check this of each other: a write builds
on its own entry's log, while the removal that rotated its key mostly sits in a space's or a vault's log, which the
write doesn't name; and a device that had seen the removal could pass the text on anyway. -/

/-- The epoch of an entry's key that a device holding `ops` writes under: the current one in what it knows. -/
def writeEpoch (ops : List Op) (sp : SpaceId) (e : EntryId) : Nat := (view ops).epochOf (.entry sp e)

/-- T15 (rotation follows revocation): a holder opens the key a device writes an entry under (`writeEpoch`) only if
    what the device knows entitles it to the entry, or the entry is public: not a device or a vault that a removal
    the device has seen took the entry from, nor anyone who joins a vault that lost its read. -/
theorem T15_rotation_follows_revocation (ops : List Op) (h : Holder) (sp : SpaceId) (e : EntryId)
    (hk : Knows (view ops) (h.start (view ops)) (.scoped (.entry sp e) (writeEpoch ops sp e))) :
    h.entitled (view ops) (.entry sp e) = true ∨ publicKey (view ops) (.entry sp e) = true :=
  T6_forward_secrecy (view_reachable ops) h _ hk

/-- T15, the epochs: a device writes under an epoch no older than any along the history of what it knows, so no
    older than the one each removal that stands in it started. -/
theorem T15_no_older_epoch (ops : List Op) (sp : SpaceId) (e : EntryId) :
    ∀ st ∈ trace {} (standing ops), st.epochOf (.entry sp e) ≤ writeEpoch ops sp e := by
  intro st hst
  unfold writeEpoch
  rw [view_eq_replay]
  exact epochOf_le_replay _ {} _ st hst

/-! ## Convergence and sync -/

/-- T11 (convergence): peers holding the same ops, received in any order, end in the same state. Assumes ids don't
    collide: two ops a peer holds have two ids. -/
theorem T11_convergence {ops₁ ops₂ : List Op} (hperm : ops₁.Perm ops₂) (hids : (ops₁.map Op.id).Nodup) :
    view ops₁ = view ops₂ := by
  unfold view
  rw [order_perm hperm hids]

/-- T11, the ops that stand: the same ops in any order, the same ops stand. -/
theorem T11_same_standing {ops₁ ops₂ : List Op} (hperm : ops₁.Perm ops₂) (hids : (ops₁.map Op.id).Nodup) :
    standing ops₁ = standing ops₂ := by
  unfold standing
  rw [order_perm hperm hids]

/-- T12 (sync shares only what caps allow): every write or checkpoint a peer sends a device is on an entry that
    device may receive by the peer's view, and every auth op it sends is about a scope that device reaches, or is a
    revocation that took one of its caps away. -/
theorem T12_sync_shares_only_caps (ops : List Op) (d : SignerId) {op : Op} (h : op ∈ respond ops d) :
    (∀ sp e, op.item? = some (sp, e) → mayReceive (view ops) d sp e = true) ∧
    (∀ sc, op.authScope? ops = some sc → reaches (view ops) d sc = true ∨ op.takesFrom (view ops) ops d = true) := by
  obtain ⟨_, hw | ha | ⟨v, hv⟩⟩ := mem_respond h
  · obtain ⟨sp, e, hi, hr⟩ := hw
    refine ⟨fun sp' e' hi' => ?_, fun sc hsc => ?_⟩
    · rw [hi] at hi'
      cases hi'
      exact hr
    · rw [(item_not_auth hi ops).1] at hsc
      cases hsc
  · refine ⟨fun sp e hi => ?_, fun sc hsc => ?_⟩
    · rcases ha with ⟨sc, hsc, _⟩ | ht
      · rw [(item_not_auth hi ops).1] at hsc
        cases hsc
      · rw [takesFrom_not_item ht] at hi
        cases hi
    · rcases ha with ⟨sc', hsc', hr⟩ | ht
      · rw [hsc] at hsc'
        cases hsc'
        exact .inl hr
      · exact .inr ht
  · refine ⟨fun sp e hi => ?_, fun sc hsc => ?_⟩
    · rw [(vault_not_auth hv ops).2] at hi
      cases hi
    · rw [(vault_not_auth hv ops).1] at hsc
      cases hsc

/-- T12, by frontiers: a device that asks with what it holds of each log is sent part of what `respond` sends, so no
    more than its caps allow, whatever it says it holds. -/
theorem T12_since (ops : List Op) (d : SignerId) (fr : Ask) {op : Op}
    (h : op ∈ respondSince ops d fr) :
    (∀ sp e, op.item? = some (sp, e) → mayReceive (view ops) d sp e = true) ∧
    (∀ sc, op.authScope? ops = some sc → reaches (view ops) d sc = true ∨ op.takesFrom (view ops) ops d = true) :=
  T12_sync_shares_only_caps ops d (respondSince_sub h)

/-- T19 (frontier sync loses nothing): a device that asks a peer with its frontier of each log it holds and a few ops
    further back, and the ops it holds outside them (`asks`), is sent every op of the peer's answer that it lacks. The
    ops it names of a log are of the part whose whole past it holds, so whatever the peer finds at or below them, the
    device holds. Assumes ids don't collide: an id the device and the peer both hold names one op. -/
theorem T19_frontier_sync (A R : List Op) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ op ∈ respond R d, op ∈ A ∨ op ∈ respondSince R d (asks A) :=
  fun _ h => respondSince_complete hid (asks_truthful A) h

/-- T19 by frontiers alone: sending only the frontiers loses nothing either, though a peer that lacks the latest ops
    then sends back what lies below them too. -/
theorem T19_frontiers_alone (A R : List Op) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ op ∈ respond R d, op ∈ A ∨ op ∈ respondSince R d ⟨frontiers A, []⟩ :=
  fun _ h => respondSince_complete hid (frontiers_truthful A) h

/-- T19, one hash per log: two peers whose frontiers of a log are equal hold the same closed part of it, so comparing
    one hash of each frontier tells whether there is anything to send. The two may place ops in logs differently
    (`lgA`, `lgR`). Assumes ids don't collide. -/
theorem T19_same_frontier (lgA lgR : Op → Option LogId) (A R : List Op) (l : LogId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (huA : ∀ a ∈ A, ∀ b ∈ A, a.id = b.id → a = b)
    (huR : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b) (hf : frontier lgA A l = frontier lgR R l) (x : Op) :
    x ∈ closedPart lgA A l ↔ x ∈ closedPart lgR R l :=
  ⟨same_frontier_held lgR lgA (fun a ha b hb h => (hid b hb a ha h.symm).symm) huA hf.symm,
   same_frontier_held lgA lgR hid huR hf⟩

/-- T13 (sync converges per item): if each of two devices may receive an item by the other peer's view, then after
    each asked the other once (`asks`), both hold the same writes and checkpoints for that item: those
    either held before. What each then shows of the item also rests on the vault and auth logs its view counts, and
    the property tests check that two devices that synced both ways show the same item. Assumes ids don't collide. -/
theorem T13_sync_converges (opsP opsQ : List Op) (dp dq : SignerId) (sp : SpaceId) (e : EntryId)
    (hid : ∀ a ∈ opsP, ∀ b ∈ opsQ, a.id = b.id → a = b)
    (hp : mayReceive (view opsQ) dp sp e = true) (hq : mayReceive (view opsP) dq sp e = true)
    (op : Op) (hop : op.item? = some (sp, e)) :
    op ∈ receive opsP (respondSince opsQ dp (asks opsP)) ↔
      op ∈ receive opsQ (respondSince opsP dq (asks opsQ)) := by
  rw [item_after_sync hid hp hop, item_after_sync (fun a ha b hb h => (hid b hb a ha h.symm).symm) hq hop]
  exact Or.comm

end AvenDB
