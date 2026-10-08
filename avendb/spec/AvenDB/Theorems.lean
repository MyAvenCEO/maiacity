import AvenDB.Sync
import AvenDB.Doc
import AvenDB.Lens
import AvenDB.Lemmas
import AvenDB.KeyLemmas

/-!
# The theorems

What must always hold, stated over the executable model. T9 (lenses) and T10 (branches) are proven in their own
files. A `sorry` below marks a theorem whose proof belongs to a later phase (see `README.md`); a phase is merged only
once its theorems are proven. The proofs' helper lemmas are in `Lemmas.lean`, and for the keys in `KeyLemmas.lean`.

The assumptions are part of the model rather than axioms: an op's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed or encrypted data reveals nothing without its key);
ids don't collide (a `Nodup` hypothesis where needed); and Loro's laws are fields of `Loro`.
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
  rcases apply_writes hpost with ⟨-, hk⟩ | ⟨_, -, -, -, hk⟩ | ⟨keep, mid, hkeep, rfl, -⟩
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

/-! ## Convergence and sync -/

/-- T11 (convergence): peers holding the same ops, received in any order, end in the same state. -/
theorem T11_convergence {ops₁ ops₂ : List Op} (hperm : ops₁.Perm ops₂) (hids : (ops₁.map Op.id).Nodup) :
    view ops₁ = view ops₂ := by
  sorry -- P6

/-- T12 (sync shares only what caps allow): every write a peer sends a device is on an entry that device may
    receive by the peer's view, and every auth op it sends is about a scope that device reaches, or is a revocation
    that took one of its caps away. -/
theorem T12_sync_shares_only_caps (ops : List Op) (d : SignerId) {op : Op} (h : op ∈ respond ops d) :
    (∀ sp e, op.writeTarget? = some (sp, e) → mayReceive (view ops) d sp e = true) ∧
    (∀ sc, op.authScope? ops = some sc → reaches (view ops) d sc = true ∨ op.takesFrom (view ops) ops d = true) := by
  sorry -- P6

/-- T13 (sync converges per item): if each of two devices may receive an item by the other peer's view, then after
    each peer answered the other once, both hold the same writes for that item. -/
theorem T13_sync_converges (opsP opsQ : List Op) (dp dq : SignerId) (sp : SpaceId) (e : EntryId)
    (hids : ((opsP ++ opsQ).map Op.id).Nodup)
    (hp : mayReceive (view opsQ) dp sp e = true) (hq : mayReceive (view opsP) dq sp e = true) :
    (itemWrites (view (receive opsP (respond opsQ dp))) sp e).Perm
      (itemWrites (view (receive opsQ (respond opsP dq))) sp e) := by
  sorry -- P6

end AvenDB
