import VaultSpec.Sync
import VaultSpec.Doc
import VaultSpec.Lens
import VaultSpec.Lemmas

/-!
# The theorems

What must always hold, stated over the executable model. T9 (lenses) and T10 (branches) are proven in their own
files. A `sorry` below marks a theorem whose proof belongs to a later phase (see `README.md`); a phase is merged only
once its theorems are proven. The proofs' helper lemmas are in `Lemmas.lean`.

The assumptions are part of the model rather than axioms: an op's signers are the keys that signed it (signatures
can't be forged); keys are learned only through `Knows` (sealed or encrypted data reveals nothing without its key);
ids don't collide (a `Nodup` hypothesis where needed); and Loro's laws are fields of `Loro`.
-/

namespace VaultSpec

/-- A state some peer can be in: the replay of some ops from the empty state. -/
def Reachable (st : State) : Prop := ∃ ops, st = replay {} ops

/-! ## Writes -/

/-- T1 (authorized writes only): a step adds a write only if, just before it, the write's author acted for its
    vault and that vault held write on the entry. -/
theorem T1_authorized_writes {st st' : State} {op : Op} (h : step st op = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) : authorized st w = true := by
  sorry -- P2

/-- T1, second half (revocation wins): an older write that a step takes the authorization from survives only if
    the step is a removal that had seen it. -/
theorem T1_revocation_wins {st st' : State} {op : Op} (h : step st op = some st') {w : Write}
    (hw : w ∈ st'.writes) (hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, op.action.keep? = some keep ∧ w.op ∈ keep := by
  sorry -- P2

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

/-- Devices don't govern: signatures that include no owner signer never approve for a human vault. -/
theorem device_cannot_govern {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt)
    (hsig : ∀ p ∈ vt.owners, ∃ s, p = .signer s) (hth : 0 < vt.threshold) (sigs : List SignerId)
    (hnone : ∀ s ∈ sigs, Principal.signer s ∉ vt.owners) : approves st sigs (.vault v) = false := by
  -- no owner approves, so the owners that approve fall short of the threshold
  have hnil : vt.owners.filter (approvesN st sigs st.vaults.length) = [] := by
    refine List.filter_eq_nil_iff.2 fun p hp => ?_
    obtain ⟨s, rfl⟩ := hsig p hp
    simp only [approvesN, List.contains_iff_mem]
    exact fun hs => hnone s hs hp
  simp only [approves, State.depth, approvesN, h, hnil, List.length_nil, decide_eq_false_iff_not]
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
  sorry -- P2

def PublicReadOnly (st : State) : Prop := ∀ g ∈ st.grants, g.grantee = .«public» → g.role = .read

/-- T8 (Public is read-only): Public only ever gets read. It can't write or grant either, since writes and grants
    act for a vault. -/
theorem T8_public_read_only {st st' : State} {op : Op} (hinv : PublicReadOnly st) (h : step st op = some st') :
    PublicReadOnly st' := by
  sorry -- P2

/-! ## Keys -/

/-- T5 (confidentiality): after any history, a device can open a key of some epoch only if, at some point of that
    history, it was entitled to the key's family, or the family was public, while the family's epoch was that one
    or a later one. -/
theorem T5_confidentiality (ops : List Op) (d : SignerId) (k : KeyScope) (e : Nat)
    (h : Knows (replay {} ops) [.device d] (.scoped k e)) :
    ∃ st ∈ trace {} ops, e ≤ st.epochOf k ∧ (entitled st d k = true ∨ publicKey st k = true) := by
  sorry -- P3

/-- T6 (forward secrecy): in every reachable state a device can open the current key of a family only while it is
    entitled to it, or the family is public. New edits use current keys, so nothing written after a removal
    reaches the removed device. -/
theorem T6_forward_secrecy {st : State} (hr : Reachable st) (d : SignerId) (k : KeyScope)
    (h : Knows st [.device d] (st.curKey k)) : entitled st d k = true ∨ publicKey st k = true := by
  sorry -- P3

/-- T7 (blind server): a device whose vaults never hold read anywhere, such as the server with its relay caps,
    opens no space or entry key unless that key was public at some point. -/
theorem T7_blind_server (ops : List Op) (srv : SignerId)
    (hhost : ∀ st ∈ trace {} ops, ∀ v, actsFor st srv v = true → ∀ sc, holds st v sc .read = false)
    {k : KeyScope} (hk : k.scope?.isSome) {e : Nat} (h : Knows (replay {} ops) [.device srv] (.scoped k e)) :
    ∃ st ∈ trace {} ops, publicKey st k = true := by
  obtain ⟨st, hst, _, hent | hpub⟩ := T5_confidentiality ops srv k e h
  · exfalso
    cases k with
    | vault v => simp [KeyScope.scope?] at hk
    | space sp =>
      simp only [entitled, List.any_eq_true, Bool.and_eq_true] at hent
      obtain ⟨x, _, hact, hread⟩ := hent
      simp [hhost st hst x.id hact] at hread
    | entry sp en =>
      simp only [entitled, List.any_eq_true, Bool.and_eq_true] at hent
      obtain ⟨x, _, hact, hread⟩ := hent
      simp [hhost st hst x.id hact] at hread
  · exact ⟨st, hst, hpub⟩

/-! ## Convergence and sync -/

/-- T11 (convergence): peers holding the same ops, received in any order, end in the same state. -/
theorem T11_convergence {ops₁ ops₂ : List Op} (hperm : ops₁.Perm ops₂) (hids : (ops₁.map Op.id).Nodup) :
    view ops₁ = view ops₂ := by
  sorry -- P6

/-- T12 (sync shares only what caps allow): every write a peer sends a device is on an entry that device may
    receive by the peer's view, and every auth op it sends is about a scope that device reaches. -/
theorem T12_sync_shares_only_caps (ops : List Op) (d : SignerId) {op : Op} (h : op ∈ respond ops d) :
    (∀ sp e, op.writeTarget? = some (sp, e) → mayReceive (view ops) d sp e = true) ∧
    (∀ sc, op.authScope? ops = some sc → reaches (view ops) d sc = true) := by
  sorry -- P6

/-- T13 (sync converges per item): if each of two devices may receive an item by the other peer's view, then after
    each peer answered the other once, both hold the same writes for that item. -/
theorem T13_sync_converges (opsP opsQ : List Op) (dp dq : SignerId) (sp : SpaceId) (e : EntryId)
    (hids : ((opsP ++ opsQ).map Op.id).Nodup)
    (hp : mayReceive (view opsQ) dp sp e = true) (hq : mayReceive (view opsP) dq sp e = true) :
    (itemWrites (view (receive opsP (respond opsQ dp))) sp e).Perm
      (itemWrites (view (receive opsQ (respond opsP dq))) sp e) := by
  sorry -- P6

end VaultSpec
