import Aven.ID.Rank
import Aven.ID.Name

/-! # Well-formed trees

Each id once; every vault has an owner, and every owner is a known key or vault; a device's vault has one owner, the
vault it serves, owns nothing, and has its own key, the key with its id, which owns nothing either; no cycles:
every owner stands strictly lower than what it owns; every vault has a valid name (`Aven.ID.Name`); and a coop's vault
is owned by people's or coops' vaults only, and holds no devices. `WF` is decidable, so the model checks a tree as it runs. -/

namespace Aven.ID

/-- A device's vault is owned by exactly one vault, the one it serves. -/
def Vault.servesOne (v : Vault) : Bool :=
  match v.owners with
  | [.vault _] => true
  | _ => false

namespace Tree

/-- What may own a coop: a person's or a coop's vault, never a key. -/
def coopOwner (t : Tree) : Owner → Bool
  | .vault a => t.kind? a == some .person || t.kind? a == some .coop
  | .key _ => false

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
  (∀ v ∈ t.vaults, ∀ k ∈ v.ownerKeys, t.kind? k ≠ some .device) ∧
  (∀ v ∈ t.vaults, validName v.name = true) ∧
  (∀ v ∈ t.vaults, v.kind = .coop → ∀ o ∈ v.owners, t.coopOwner o = true) ∧
  (∀ v ∈ t.vaults, v.kind = .device → ∀ a ∈ v.ownerVaults, t.kind? a ≠ some .coop) ∧
  (∀ v ∈ t.vaults, 1 ≤ v.threshold)

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
theorem WF.keyLeaf (w : t.WF) : ∀ v ∈ t.vaults, ∀ k ∈ v.ownerKeys, t.kind? k ≠ some .device :=
  w.2.2.2.2.2.2.2.1
theorem WF.named (w : t.WF) : ∀ v ∈ t.vaults, validName v.name = true := w.2.2.2.2.2.2.2.2.1
theorem WF.coopOwned (w : t.WF) : ∀ v ∈ t.vaults, v.kind = .coop → ∀ o ∈ v.owners, t.coopOwner o = true :=
  w.2.2.2.2.2.2.2.2.2.1
theorem WF.coopHolds (w : t.WF) : ∀ v ∈ t.vaults, v.kind = .device → ∀ a ∈ v.ownerVaults, t.kind? a ≠ some .coop :=
  w.2.2.2.2.2.2.2.2.2.2.1
/-- Every vault's threshold is at least one: no approval passes on no signatures. -/
theorem WF.quorum (w : t.WF) : ∀ v ∈ t.vaults, 1 ≤ v.threshold := w.2.2.2.2.2.2.2.2.2.2.2

/-- In a well-formed tree, every threshold the tree gives is at least one. -/
theorem WF.threshold_pos (w : t.WF) (id : String) : 1 ≤ t.threshold id := by
  unfold threshold
  cases g : t.get? id with
  | none => simp
  | some v => simpa using w.quorum v (get?_some g).1

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

/-- A coop holds no devices: no device's vault is owned by a coop. -/
theorem WF.coop_no_device (w : t.WF) {c d : String} (h : t.Owns c d) (k : t.kind? d = some .device) :
    t.kind? c ≠ some .coop := by
  obtain ⟨v, g, m⟩ := h.get?
  obtain ⟨mv, e⟩ := get?_some g
  have kv : v.kind = .device := by simpa [kind?, g] using k
  exact w.coopHolds v mv kv c m

/-- A coop's owners are people's or coops' vaults: no key owns a coop. -/
theorem WF.coop_owner (w : t.WF) {c : String} {v : Vault} (g : t.get? c = some v) (k : v.kind = .coop) :
    v.ownerKeys = [] ∧ ∀ a ∈ v.ownerVaults, t.kind? a = some .person ∨ t.kind? a = some .coop := by
  have all := w.coopOwned v (get?_some g).1 k
  constructor
  · apply List.eq_nil_iff_forall_not_mem.mpr
    intro x m
    obtain ⟨o, mo, e⟩ := List.mem_filterMap.mp m
    cases o with
    | key x => exact absurd (all _ mo) (by simp [coopOwner])
    | vault _ => simp [Owner.key?] at e
  · intro a m
    obtain ⟨o, mo, e⟩ := List.mem_filterMap.mp m
    cases o with
    | key _ => simp [Owner.vault?] at e
    | vault b =>
      simp only [Owner.vault?, Option.some.injEq] at e
      subst e
      simpa [coopOwner] using all _ mo

end Tree
end Aven.ID
