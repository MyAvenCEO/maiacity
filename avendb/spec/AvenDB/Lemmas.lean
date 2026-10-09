import AvenDB.Props

/-!
# Vaults and writes

The proofs of the theorems about vaults (T2, T3, T21 and that devices don't govern), about who writes (T1), the caps'
grantees (T4, T8), the schema lane (T17) and causal closure (T14), stated as in `Theorems.lean`.
-/

namespace AvenDB.Core

theorem T1_authorized_writes {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hnew : w ∉ st.writes) (hfirst : w.first = false) : authorized st w = true := by
  sorry

theorem T1_created_entries {st st' : State} {edit : Edit} (h : step st edit = some st') {en : Entry}
    (hen : en ∈ st'.entries) (hnew : ∀ x ∈ st.entries, x.id ≠ en.id) :
    ∃ w ∈ st'.writes, w.edit = edit.id ∧ w.entry = en.id ∧ w.first = true ∧
      actsVia st w.author w.via w.actor = true ∧ mayCreate st w.actor en.vault en.cell = true := by
  sorry

theorem T1_revocation_wins {st st' : State} {edit : Edit} (h : step st edit = some st') {w : Write}
    (hw : w ∈ st'.writes) (hold : w ∈ st.writes) (hwas : authorized st w = true)
    (hnow : authorized st' w = false) : ∃ keep, edit.action.keep? = some keep ∧ w.edit ∈ keep := by
  sorry

theorem T2_governance {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt')
    (hchg : vt.owners ≠ vt'.owners ∨ vt.threshold ≠ vt'.threshold ∨ vt.devices ≠ vt'.devices) :
    approves st edit.sigs (.vault v) = true ∨
    (∃ p, vt'.owners = vt.owners.erase p ∧ approves st edit.sigs p = true) ∨
    (∃ d, vt'.devices = vt.devices.erase d ∧ d ∈ edit.sigs) := by
  sorry

theorem T2_consent {st st' : State} {edit : Edit} (h : step st edit = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st edit.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ edit.sigs) := by
  sorry

theorem device_cannot_govern {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt)
    (hsig : ∀ p ∈ vt.owners, ∃ s, p = .signer s) (hth : 0 < vt.threshold) (sigs : List SignerId)
    (hnone : ∀ s ∈ sigs, Principal.signer s ∉ vt.owners) (hroot : ∀ r, vt.root = some r → r ∉ sigs) :
    approves st sigs (.vault v) = false := by
  sorry

theorem devices_cannot_govern {st : State} {sigs : List SignerId}
    (hnone : ∀ s ∈ sigs, ∀ v vt, st.vault? v = some vt → Principal.signer s ∉ vt.owners ∧ vt.root ≠ some s)
    (hth : ∀ v vt, st.vault? v = some vt → 0 < vt.threshold) : ∀ n v, approvesN st sigs n (.vault v) = false := by
  sorry

theorem T21_vault_kinds {st : State} (hr : Reachable st) : KindsFit st := by
  sorry

theorem T3_no_cycles (edits : List Edit) : Acyclic (replay {} edits) := by
  sorry

theorem T4_caps_name_vaults {st st' : State} {edit : Edit} (hinv : CapsNameVaults st) (h : step st edit = some st') :
    CapsNameVaults st' := by
  sorry

theorem T8_public_read_only {st st' : State} {edit : Edit} (hinv : PublicReadOnly st) (h : step st edit = some st') :
    PublicReadOnly st' := by
  sorry

theorem T17_lane_by_owners {st st' : State} {edit : Edit} (h : step st edit = some st') {x : VaultId × BlobId}
    (hx : x ∈ st'.lane) (hnew : x ∉ st.lane) :
    ∃ actor via, edit.action = .publish x.1 actor x.2 via ∧ actsVia st edit.author via actor = true ∧
      ownsLane st actor x.1 = true := by
  sorry

theorem T14_causally_closed {st st' : State} {edit : Edit} (hinv : CausallyClosed st) (h : step st edit = some st') :
    CausallyClosed st' := by
  sorry

theorem T14_entries_whole {st : State} (hr : Reachable st) :
    (∀ w ∈ st.writes, ∃ en ∈ st.entries, en.id = w.entry) ∧
    (∀ en ∈ st.entries, ∃ w ∈ st.writes, w.entry = en.id ∧ w.first = true) := by
  sorry

end AvenDB.Core
