import VaultSpec.Sync
import VaultSpec.Doc
import VaultSpec.Lens

/-!
# The theorems

What must always hold, stated over the executable model. T9 (lenses) and T10 (branches) are proven in their own
files. A `sorry` below marks a theorem whose proof belongs to a later phase (see `README.md`); a phase is merged only
once its theorems are proven.

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
  sorry -- P1

/-- T2, consent: an owner or a device is added only with its own signature. -/
theorem T2_consent {st st' : State} {op : Op} (h : step st op = some st') {v : VaultId} {vt vt' : Vault}
    (h₁ : st.vault? v = some vt) (h₂ : st'.vault? v = some vt') :
    (∀ p ∈ vt'.owners, p ∉ vt.owners → approves st op.sigs p = true) ∧
    (∀ d ∈ vt'.devices, d ∉ vt.devices → d ∈ op.sigs) := by
  sorry -- P1

/-- Devices don't govern: signatures that include no owner signer never approve for a human vault. -/
theorem device_cannot_govern {st : State} {v : VaultId} {vt : Vault} (h : st.vault? v = some vt)
    (hsig : ∀ p ∈ vt.owners, ∃ s, p = .signer s) (hth : 0 < vt.threshold) (sigs : List SignerId)
    (hnone : ∀ s ∈ sigs, Principal.signer s ∉ vt.owners) : approves st sigs (.vault v) = false := by
  sorry -- P1

/-- `OwnsPlus st a x`: vault `a` owns vault `x`, directly or through a chain. -/
inductive OwnsPlus (st : State) : VaultId → VaultId → Prop where
  | direct {a x : VaultId} {vt : Vault} : st.vault? x = some vt → Principal.vault a ∈ vt.owners → OwnsPlus st a x
  | trans {a b x : VaultId} : OwnsPlus st a b → OwnsPlus st b x → OwnsPlus st a x

def Acyclic (st : State) : Prop := ∀ v, ¬ OwnsPlus st v v

/-- T3 (no ownership cycles): every step keeps the vault graph acyclic, so every chain ends in signers. -/
theorem T3_no_cycles {st st' : State} {op : Op} (hacyc : Acyclic st) (h : step st op = some st') : Acyclic st' := by
  sorry -- P1

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
