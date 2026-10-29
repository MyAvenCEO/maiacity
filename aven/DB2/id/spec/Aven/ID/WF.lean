import Aven.ID.Rank

/-! # Well-formed trees

Each id once; every vault has an owner, and every owner is a known key or vault; a device's vault has one owner, the
vault it serves, owns nothing, and has its own key, the key with its id, which owns nothing either; and no cycles:
every owner stands strictly lower than what it owns. `WF` is decidable, so the model checks a tree as it runs. -/

namespace Aven.ID

/-- A device's vault is owned by exactly one vault, the one it serves. -/
def Vault.servesOne (v : Vault) : Bool :=
  match v.owners with
  | [.vault _] => true
  | _ => false

namespace Tree

def knows (t : Tree) : Owner → Bool
  | .key k => t.keys.contains k
  | .vault a => t.ids.contains a

def WF (t : Tree) : Prop :=
  t.ids.Nodup ∧
  (∀ v ∈ t.vaults, v.owners ≠ []) ∧
  (∀ v ∈ t.vaults, ∀ o ∈ v.owners, t.knows o = true) ∧
  (∀ v ∈ t.vaults, v.kind = .device → v.servesOne = true) ∧
  (∀ v ∈ t.vaults, ∀ a ∈ v.ownerVaults, t.kind? a ≠ some .device) ∧
  (∀ v ∈ t.vaults, ∀ a ∈ v.ownerVaults, t.rank a < t.rank v.id) ∧
  (∀ v ∈ t.vaults, v.kind = .device → t.keys.contains v.id = true) ∧
  (∀ v ∈ t.vaults, ∀ k ∈ v.ownerKeys, t.kind? k ≠ some .device)

instance (t : Tree) : Decidable t.WF := by unfold WF; infer_instance

variable {t : Tree}

theorem WF.nodup (w : t.WF) : t.ids.Nodup := w.1
theorem WF.owned (w : t.WF) : ∀ v ∈ t.vaults, v.owners ≠ [] := w.2.1
theorem WF.known (w : t.WF) : ∀ v ∈ t.vaults, ∀ o ∈ v.owners, t.knows o = true := w.2.2.1
theorem WF.device (w : t.WF) : ∀ v ∈ t.vaults, v.kind = .device → v.servesOne = true := w.2.2.2.1
theorem WF.leaf (w : t.WF) : ∀ v ∈ t.vaults, ∀ a ∈ v.ownerVaults, t.kind? a ≠ some .device := w.2.2.2.2.1
theorem WF.acyclic (w : t.WF) : ∀ v ∈ t.vaults, ∀ a ∈ v.ownerVaults, t.rank a < t.rank v.id := w.2.2.2.2.2.1
theorem WF.deviceKey (w : t.WF) : ∀ v ∈ t.vaults, v.kind = .device → t.keys.contains v.id = true :=
  w.2.2.2.2.2.2.1
theorem WF.keyLeaf (w : t.WF) : ∀ v ∈ t.vaults, ∀ k ∈ v.ownerKeys, t.kind? k ≠ some .device := w.2.2.2.2.2.2.2

/-- An owner stands strictly lower than what it owns. -/
theorem WF.rank_lt (w : t.WF) {a b : String} (h : t.Owns a b) : t.rank a < t.rank b := by
  obtain ⟨v, g, m⟩ := h.get?
  obtain ⟨mv, e⟩ := get?_some g
  exact e ▸ w.acyclic v mv a m

/-- No device's vault owns anything. -/
theorem WF.not_device (w : t.WF) {a b : String} (h : t.Owns a b) : t.kind? a ≠ some .device := by
  obtain ⟨v, g, m⟩ := h.get?
  exact w.leaf v (get?_some g).1 a m

/-- No device's key owns anything. -/
theorem WF.not_device_key (w : t.WF) {k b : String} (h : t.KeyOwns k b) : t.kind? k ≠ some .device := by
  obtain ⟨v, g, m⟩ := h
  exact w.keyLeaf v (get?_some g).1 k m

end Tree
end Aven.ID
