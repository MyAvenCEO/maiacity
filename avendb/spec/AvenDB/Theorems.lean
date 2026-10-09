import AvenDB.Sync
import AvenDB.Doc
import AvenDB.Proposals
import AvenDB.Lens
import AvenDB.Lemmas
import AvenDB.KeyLemmas
import AvenDB.SyncLemmas

/-!
# The theorems

What must always hold, stated over the executable model, all of it proven. T9 (lenses) and T10 (proposals) are proven
in their own files. The proofs' helper lemmas are in `Lemmas.lean`, for the keys in `KeyLemmas.lean`, and for sync in
`SyncLemmas.lean`.

The assumptions are part of the model rather than axioms: an edit's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed or encrypted data reveals nothing without its key);
ids don't collide (a hypothesis where needed: `Nodup`, or that an id two peers both hold names one edit); and Loro's
laws are fields of `Loro`.
-/

namespace AvenDB

/-- A state some peer can be in: the replay of some edits from the empty state. -/
def Reachable (st : State) : Prop := ∃ edits, st = replay {} edits

/-! ## Writes -/

/-- T1 (authorized writes only): a step adds a write only if, just before it, the write's author acted for its
    vault through the owners the write names, and that vault held write on the entry. -/
theorem T1_authorized_writes {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
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
theorem T1_revocation_wins {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (_hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, edit.action.keep? = some keep ∧ w.edit ∈ keep := by
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

/-- T2 (governance threshold): when a step changes a vault's owners, threshold or devices, the edit carries the
    vault's approval (its threshold of owners, recursively down to signers), or an owner or a device removes
    itself. -/
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

/-- T2, consent: an owner or a device is added only with its own signature. -/
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

/-- Devices don't govern any vault: signatures by signers that own no vault and are no vault's root approve for no
    vault, as every vault's approval comes down to its root or its owner signers. So a server, a device of avenCEO,
    governs neither avenCEO nor anything else. -/
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

/-! ## Vault kinds -/

/-- Every vault has the shape of its kind: a human vault is owned by signers, its person's passkeys; a coop or an aven
    vault by human and coop vaults, never a signer; a coop has no devices; and only a human vault has a root. -/
def KindsFit (st : State) : Prop :=
  ∀ v vt, st.vault? v = some vt → (∀ p ∈ vt.owners, ownerFits st vt.kind p = true) ∧
    (vt.devices ≠ [] → vt.kind.hasDevices = true) ∧ (vt.root ≠ none → vt.kind = .human)

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
theorem KindsFit.step {st st' : State} {edit : Edit} (hk : KindsFit st) (h : step st edit = some st') :
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

/-- T21 (vaults by kind): in every reachable state, signers own human vaults only; coop and aven vaults are owned by
    human and coop vaults; a coop has no devices; and only a human vault has a root. So an edit for a coop always goes
    through a human vault its device or passkey belongs to (`ActsChain.of_actsVia`), and so does an edit for an aven
    vault that none of its own servers signs. -/
theorem T21_vault_kinds {st : State} (hr : Reachable st) : KindsFit st := by
  obtain ⟨edits, rfl⟩ := hr
  refine replay_inv KindsFit (fun _ _ _ hk hs => hk.step hs) edits {} ?_
  intro v vt hv
  simp [State.vault?] at hv

/-- `OwnsPlus st a x`: vault `a` owns vault `x`, directly or through a chain. -/
inductive OwnsPlus (st : State) : VaultId → VaultId → Prop where
  | direct {a x : VaultId} {vt : Vault} : st.vault? x = some vt → Principal.vault a ∈ vt.owners → OwnsPlus st a x
  | trans {a b x : VaultId} : OwnsPlus st a b → OwnsPlus st b x → OwnsPlus st a x

def Acyclic (st : State) : Prop := ∀ v, ¬ OwnsPlus st v v

/-- Every vault some vault lists as an owner exists. Genesis and addOwner only ever name existing vaults, and no edit
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
theorem T3_step {st st' : State} {edit : Edit} (hacyc : Acyclic st) (hex : OwnersExist st)
    (h : step st edit = some st') : Acyclic st' ∧ OwnersExist st' := by
  obtain ⟨hacyc', hex'⟩ := step_owners (fun y hy => hacyc y (ownsPlus_iff.2 hy)) hex h
  exact ⟨fun y hy => hacyc' y (ownsPlus_iff.1 hy), hex'⟩

/-- T3 (no ownership cycles): in every reachable state the vault graph is acyclic, so every chain ends in signers. -/
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

/-! ## Caps -/

def GrantsNameVaults (st : State) : Prop := ∀ g ∈ st.grants, ∀ s, g.grantee ≠ .principal (.signer s)

/-- T4 (grants name vaults): no step adds a grant that names a signer. -/
theorem T4_grants_name_vaults {st st' : State} {edit : Edit} (hinv : GrantsNameVaults st)
    (h : step st edit = some st') : GrantsNameVaults st' := by
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
theorem T8_public_read_only {st st' : State} {edit : Edit} (hinv : PublicReadOnly st) (h : step st edit = some st') :
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
    that blob into that space, and just before it, its author acted for a vault holding owner on the space, through
    the owners it names. -/
theorem T17_lane_by_owners {st st' : State} {edit : Edit} (h : step st edit = some st') {x : SpaceId × BlobId}
    (hx : x ∈ st'.lane) (hnew : x ∉ st.lane) :
    ∃ actor via, edit.action = .publish x.1 actor x.2 via ∧ actsVia st edit.author via actor = true ∧
      holds st actor (.space x.1) .owner = true := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_lane] at hx
  rcases apply_lane hpost with hl | ⟨sp, actor, blob, via, hact, hacts, hholds, hl⟩
  · exact absurd (hl ▸ hx) hnew
  · rw [hl] at hx
    rcases List.mem_append.1 hx with hx | hx
    · exact absurd hx hnew
    · rw [List.mem_singleton] at hx
      subst hx
      exact ⟨actor, via, hact, hacts, hholds⟩

/-! ## Causal closure -/

/-- Every accepted write's dependencies are accepted writes of its own entry. -/
def CausallyClosed (st : State) : Prop :=
  ∀ w ∈ st.writes, ∀ d ∈ w.deps, ∃ x ∈ st.writes, x.edit = d ∧ x.space = w.space ∧ x.entry = w.entry

/-- T14 (accepted writes are causally closed): no step accepts a write before what it builds on, and a removal that
    drops a write drops every write that builds on it. -/
theorem T14_causally_closed {st st' : State} {edit : Edit} (hinv : CausallyClosed st) (h : step st edit = some st') :
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

A peer's view replays the edits that stand, so everything that holds in every state the edits can reach holds in it. -/

/-- The view is the replay of the edits that stand in it. -/
theorem view_eq_replay (edits : List Edit) : view edits = replay {} (standing edits) := runFrom_fst _ _ _ _

theorem view_reachable (edits : List Edit) : Reachable (view edits) := ⟨_, view_eq_replay edits⟩

/-- T3, T4, T8 and T14 in every peer's view. -/
theorem view_invariants (edits : List Edit) :
    Acyclic (view edits) ∧ GrantsNameVaults (view edits) ∧ PublicReadOnly (view edits) ∧
      CausallyClosed (view edits) := by
  rw [view_eq_replay]
  -- each holds in the empty state, and every accepted step keeps it
  have h := replay_inv (fun st => GrantsNameVaults st ∧ PublicReadOnly st ∧ CausallyClosed st)
    (fun _ _ _ ⟨h₁, h₂, h₃⟩ h => ⟨T4_grants_name_vaults h₁ h, T8_public_read_only h₂ h, T14_causally_closed h₃ h⟩)
    (standing edits) {} (by simp [GrantsNameVaults, PublicReadOnly, CausallyClosed])
  exact ⟨T3_no_cycles _, h⟩

/-! ## Proposals

Every peer's writes come in an order their dependencies respect, so `Proposals.lean`'s T10f to T10h hold of what every
peer shows on every line. -/

/-- No step breaks the order of the writes: a new write builds only on accepted writes and brings a new id, and a
    removal keeps some of the writes, in order. -/
theorem writes_ordered_step {st st' : State} {edit : Edit} (hc : CausallyClosed st) (ho : Ordered st.writes)
    (h : step st edit = some st') : Ordered st'.writes := by
  unfold step at h
  obtain ⟨post, hpost, rfl⟩ := Option.map_eq_some_iff.1 h
  rw [settle_writes]
  obtain ⟨hnd, hpw, hself⟩ := ho
  rcases apply_writes hpost with ⟨hws, -⟩ | ⟨w, hws, -, hdeps, -, -, -, -, hfresh, -⟩ | ⟨keep, mid, -, rfl, hmid⟩
  · rw [hws]
    exact ⟨hnd, hpw, hself⟩
  · rw [hws]
    -- what the accepted writes build on is accepted already, so none builds on `w`, whose id is new
    have hnot : ∀ x ∈ st.writes, w.edit ∉ x.deps := fun x hx hd => by
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
theorem writes_ordered (edits : List Edit) : Ordered (view edits).writes := by
  rw [view_eq_replay]
  have h := replay_inv (fun st => CausallyClosed st ∧ Ordered st.writes)
    (fun _ _ _ ⟨h₁, h₂⟩ h => ⟨T14_causally_closed h₁ h, writes_ordered_step h₁ h₂ h⟩)
    (standing edits) {} (by simp [CausallyClosed, Ordered])
  exact h.2

/-! ## Strong removal -/

/-- T16 (strong removal), replaying `edits` with the removals `rem`: an edit stands only if `apply` accepts it on the
    state just before it (the replay of the edits that stood before it) with the facts hidden from it taken away; and
    those facts include everything each removal of `rem` after it takes away, unless that removal had seen it. -/
theorem T16_strong_removal (edits rem : List Edit) (pre post : List (Edit × Nat)) (x : Edit) (i : Nat)
    (_hsplit : edits.zipIdx = pre ++ (x, i) :: post)
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

/-- T16, the removals that stand: every removal `resolve` picks stands in the view. -/
theorem T16_resolved_removals_stand (edits : List Edit) :
    ∀ r ∈ resolve (order edits), (standing edits).any (·.id == r.id) :=
  resolve_stands (order edits)

/-! ## Once the curves fall -/

/-- T18 (post-quantum writes): a peer that no longer trusts the curves (`checkpointed`) counts a write only if its
    author vouched for it in a checkpoint, which carries the hash-based half of the author's signature: whoever broke
    the curves, and with them a device's classical key, writes nothing such a peer counts. -/
theorem T18_checkpointed_writes (edits : List Edit) {w : Write} (hw : w ∈ (view (checkpointed edits)).writes) :
    ∃ c ∈ edits, c.author = w.author ∧ ∃ sp e covers, c.action = .checkpoint sp e covers ∧ w.edit ∈ covers := by
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
theorem T5_confidentiality (edits : List Edit) (h : Holder) (k : KeyScope) (e : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.scoped k e)) : EverReads (trace {} edits) h k :=
  -- every seal along the history is justified, from the empty state on, and opening keys follows seals
  (knows_everReads (replay_mem_trace {} edits) (sealsRead_replay edits {} (fun _ hx => hx) (sealsRead_empty _)) hk).2
    k e rfl

/-- T6 (forward secrecy): in every reachable state a holder opens the current key of a family only while it is
    entitled to it, or the family is public. New edits use current keys, so nothing written after a removal reaches
    the removed device, nor anyone who joins a vault that lost its read. -/
theorem T6_forward_secrecy {st : State} (hr : Reachable st) (h : Holder) (k : KeyScope)
    (hk : Knows st (h.start st) (st.curKey k)) : h.entitled st k = true ∨ publicKey st k = true := by
  obtain ⟨edits, rfl⟩ := hr
  exact (keyInv_replay edits).fwd h k hk

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
theorem T7_blind_server (edits : List Edit) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} edits) (.signer srv) (.vault v) →
      ∀ st ∈ trace {} edits, ∀ sc, holds st v sc .read = false)
    {k : KeyScope} (hk : k.scope?.isSome) {e : Nat} (h : Knows (replay {} edits) [.signer srv] (.scoped k e)) :
    ∃ st ∈ trace {} edits, publicKey st k = true :=
  everReads_blind (T5_confidentiality edits (.signer srv) k e h) hblind hk

/-! ## Rotation follows revocation

A device writes an entry under the current key of that entry in what it knows, as the Lab does, so once a removal
stands in what it knows, the removed can't open what it writes. Peers don't check this of each other: a write builds
on its own entry's log, while the removal that rotated its key mostly sits in a space's or a vault's log, which the
write doesn't name; and a device that had seen the removal could pass the text on anyway. -/

/-- The epoch of an entry's key that a device holding `edits` writes under: the current one in what it knows. -/
def writeEpoch (edits : List Edit) (sp : SpaceId) (e : EntryId) : Nat := (view edits).epochOf (.entry sp e)

/-- T15 (rotation follows revocation): a holder opens the key a device writes an entry under (`writeEpoch`) only if
    what the device knows entitles it to the entry, or the entry is public: not a device or a vault that a removal
    the device has seen took the entry from, nor anyone who joins a vault that lost its read. -/
theorem T15_rotation_follows_revocation (edits : List Edit) (h : Holder) (sp : SpaceId) (e : EntryId)
    (hk : Knows (view edits) (h.start (view edits)) (.scoped (.entry sp e) (writeEpoch edits sp e))) :
    h.entitled (view edits) (.entry sp e) = true ∨ publicKey (view edits) (.entry sp e) = true :=
  T6_forward_secrecy (view_reachable edits) h _ hk

/-- T15, the epochs: a device writes under an epoch no older than any along the history of what it knows, so no
    older than the one each removal that stands in it started. -/
theorem T15_no_older_epoch (edits : List Edit) (sp : SpaceId) (e : EntryId) :
    ∀ st ∈ trace {} (standing edits), st.epochOf (.entry sp e) ≤ writeEpoch edits sp e := by
  intro st hst
  unfold writeEpoch
  rw [view_eq_replay]
  exact epochOf_le_replay _ {} _ st hst

/-! ## Convergence and sync -/

/-- T11 (convergence): peers holding the same edits, received in any order, end in the same state. Assumes ids don't
    collide: two edits a peer holds have two ids. -/
theorem T11_convergence {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    view edits₁ = view edits₂ := by
  unfold view
  rw [order_perm hperm hids]

/-- T11, the edits that stand: the same edits in any order, the same edits stand. -/
theorem T11_same_standing {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    standing edits₁ = standing edits₂ := by
  unfold standing
  rw [order_perm hperm hids]

/-- T12 (sync shares only what caps allow): every write or checkpoint a peer sends a device is on an entry that
    device may receive by the peer's view, and every auth edit it sends is about a scope that device reaches, or is a
    revocation that took one of its caps away. -/
theorem T12_sync_shares_only_caps (edits : List Edit) (d : SignerId) {edit : Edit} (h : edit ∈ respond edits d) :
    (∀ sp e, edit.item? = some (sp, e) → mayReceive (view edits) d sp e = true) ∧
    (∀ sc, edit.authScope? edits = some sc →
      reaches (view edits) d sc = true ∨ edit.takesFrom (view edits) edits d = true) := by
  obtain ⟨_, hw | ha | ⟨v, hv⟩⟩ := mem_respond h
  · obtain ⟨sp, e, hi, hr⟩ := hw
    refine ⟨fun sp' e' hi' => ?_, fun sc hsc => ?_⟩
    · rw [hi] at hi'
      cases hi'
      exact hr
    · rw [(item_not_auth hi edits).1] at hsc
      cases hsc
  · refine ⟨fun sp e hi => ?_, fun sc hsc => ?_⟩
    · rcases ha with ⟨sc, hsc, _⟩ | ht
      · rw [(item_not_auth hi edits).1] at hsc
        cases hsc
      · rw [takesFrom_not_item ht] at hi
        cases hi
    · rcases ha with ⟨sc', hsc', hr⟩ | ht
      · rw [hsc] at hsc'
        cases hsc'
        exact .inl hr
      · exact .inr ht
  · refine ⟨fun sp e hi => ?_, fun sc hsc => ?_⟩
    · rw [(vault_not_auth hv edits).2] at hi
      cases hi
    · rw [(vault_not_auth hv edits).1] at hsc
      cases hsc

/-- T12, by frontiers: a device that asks with what it holds of each log is sent part of what `respond` sends, so no
    more than its caps allow, whatever it says it holds. -/
theorem T12_since (edits : List Edit) (d : SignerId) (fr : Ask) {edit : Edit}
    (h : edit ∈ respondSince edits d fr) :
    (∀ sp e, edit.item? = some (sp, e) → mayReceive (view edits) d sp e = true) ∧
    (∀ sc, edit.authScope? edits = some sc →
      reaches (view edits) d sc = true ∨ edit.takesFrom (view edits) edits d = true) :=
  T12_sync_shares_only_caps edits d (respondSince_sub h)

/-- T19 (frontier sync loses nothing): a device that asks a peer with its frontier of each log it holds and a few edits
    further back, and the edits it holds outside them (`asks`), is sent every edit of the peer's answer that it lacks.
    The edits it names of a log are of the part whose whole past it holds, so whatever the peer finds at or below them,
    the device holds. Assumes ids don't collide: an id the device and the peer both hold names one edit. -/
theorem T19_frontier_sync (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ edit ∈ respond R d, edit ∈ A ∨ edit ∈ respondSince R d (asks A) :=
  fun _ h => respondSince_complete hid (asks_truthful A) h

/-- T19 by frontiers alone: sending only the frontiers loses nothing either, though a peer that lacks the latest edits
    then sends back what lies below them too. -/
theorem T19_frontiers_alone (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ edit ∈ respond R d, edit ∈ A ∨ edit ∈ respondSince R d ⟨frontiers A, []⟩ :=
  fun _ h => respondSince_complete hid (frontiers_truthful A) h

/-- T19, one hash per log: two peers whose frontiers of a log are equal hold the same closed part of it, so comparing
    one hash of each frontier tells whether there is anything to send. The two may place edits in logs differently
    (`lgA`, `lgR`). Assumes ids don't collide. -/
theorem T19_same_frontier (lgA lgR : Edit → Option LogId) (A R : List Edit) (l : LogId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (huA : ∀ a ∈ A, ∀ b ∈ A, a.id = b.id → a = b)
    (huR : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b) (hf : frontier lgA A l = frontier lgR R l) (x : Edit) :
    x ∈ closedPart lgA A l ↔ x ∈ closedPart lgR R l :=
  ⟨same_frontier_held lgR lgA (fun a ha b hb h => (hid b hb a ha h.symm).symm) huA hf.symm,
   same_frontier_held lgA lgR hid huR hf⟩

/-- T13 (sync converges per item): if each of two devices may receive an item by the other peer's view, then after
    each asked the other once (`asks`), both hold the same writes and checkpoints for that item: those
    either held before. What each then shows of the item also rests on the vault and auth logs its view counts, and
    the property tests check that two devices that synced both ways show the same item. Assumes ids don't collide. -/
theorem T13_sync_converges (editsP editsQ : List Edit) (dp dq : SignerId) (sp : SpaceId) (e : EntryId)
    (hid : ∀ a ∈ editsP, ∀ b ∈ editsQ, a.id = b.id → a = b)
    (hp : mayReceive (view editsQ) dp sp e = true) (hq : mayReceive (view editsP) dq sp e = true)
    (edit : Edit) (hop : edit.item? = some (sp, e)) :
    edit ∈ receive editsP (respondSince editsQ dp (asks editsP)) ↔
      edit ∈ receive editsQ (respondSince editsP dq (asks editsQ)) := by
  rw [item_after_sync hid hp hop, item_after_sync (fun a ha b hb h => (hid b hb a ha h.symm).symm) hq hop]
  exact Or.comm

/-- `closeVaults` of no vault is no vault. -/
theorem closeVaults_nil (st : State) : ∀ n, closeVaults st n [] = []
  | 0 => rfl
  | n + 1 => by simp [closeVaults, closeVaults_nil st n]

/-- T20 (linking hands out vault logs alone): every edit a peer hands a device whose passkey proved itself on their
    connection (`linkCard`) is an edit the peer holds of the log of a vault the passkey owns, or of one that owns such a
    vault, up the chains: never a write or a checkpoint, never an edit about a space or an entry. -/
theorem T20_link_shares_only_vault_logs (edits : List Edit) (p : SignerId) {edit : Edit} (h : edit ∈ linkCard edits p) :
    edit ∈ edits ∧
      (∃ v, edit.vaultOf? = some v ∧ v ∈ closeVaults (view edits) (view edits).depth (ownedBy (view edits) p)) ∧
      edit.item? = none ∧ edit.authScope? edits = none := by
  simp only [linkCard, List.mem_filter] at h
  obtain ⟨hm, hv⟩ := h
  split at hv
  · rename_i v hv'
    exact ⟨hm, ⟨v, hv', List.contains_iff_mem.1 hv⟩, (vault_not_auth hv' edits).2, (vault_not_auth hv' edits).1⟩
  · cases hv

/-- T20, for a stranger: a passkey that owns no vault in the peer's view is handed nothing. -/
theorem T20_stranger_gets_nothing (edits : List Edit) (p : SignerId) (h : ownedBy (view edits) p = []) :
    linkCard edits p = [] := by
  simp only [linkCard, h, closeVaults_nil]
  rw [List.filter_eq_nil_iff]
  intro edit _
  split <;> simp

end AvenDB
