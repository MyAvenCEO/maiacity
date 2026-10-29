/-! # Keys, vaults and owners

A tree is the keys it knows and its vaults, in order. A vault has a kind and its owners, each a key or another vault
(SANDBOX.md, "Vaults own vaults"). Every lookup is by id; a well-formed tree (`Aven.ID.WF`) has each id once. -/

namespace Aven.ID

inductive Kind where
  | person
  | network
  | device
  deriving DecidableEq, Repr

/-- An owner is a key or a vault, written `key:<id>` or `vault:<id>` in the cast. -/
inductive Owner where
  | key (id : String)
  | vault (id : String)
  deriving DecidableEq, Repr

def Owner.vault? : Owner → Option String
  | .vault id => some id
  | .key _ => none

structure Vault where
  id : String
  kind : Kind
  owners : List Owner
  deriving DecidableEq, Repr

/-- The vaults among a vault's owners. -/
def Vault.ownerVaults (v : Vault) : List String := v.owners.filterMap Owner.vault?

structure Tree where
  keys : List String
  vaults : List Vault
  deriving Repr

namespace Tree

def ids (t : Tree) : List String := t.vaults.map (·.id)

def get? (t : Tree) (id : String) : Option Vault := t.vaults.find? (·.id == id)

def kind? (t : Tree) (id : String) : Option Kind := (t.get? id).map (·.kind)

/-- The vaults that own the vault `b` directly. -/
def ownersOf (t : Tree) (b : String) : List String := ((t.get? b).map (·.ownerVaults)).getD []

/-- `a` owns `b`: the vault `a` is one of `b`'s owners. -/
def Owns (t : Tree) (a b : String) : Prop := a ∈ t.ownersOf b

theorem get?_some {t : Tree} {x : String} {v : Vault} (h : t.get? x = some v) : v ∈ t.vaults ∧ v.id = x :=
  ⟨List.mem_of_find?_eq_some h, by simpa using List.find?_some h⟩

theorem ownersOf_of_get? {t : Tree} {b : String} {v : Vault} (h : t.get? b = some v) :
    t.ownersOf b = v.ownerVaults := by
  simp [ownersOf, h]

/-- What `b`'s owners are depends on the vault found for `b`. -/
theorem Owns.get? {t : Tree} {a b : String} (h : t.Owns a b) :
    ∃ v, t.get? b = some v ∧ a ∈ v.ownerVaults := by
  unfold Owns ownersOf at h
  cases g : t.get? b with
  | none => simp [g] at h
  | some v => exact ⟨v, rfl, by simpa [g] using h⟩

theorem Owns.mem_ids {t : Tree} {a b : String} (h : t.Owns a b) : b ∈ t.ids := by
  obtain ⟨v, g, _⟩ := h.get?
  obtain ⟨m, e⟩ := get?_some g
  exact List.mem_map.mpr ⟨v, m, e⟩

end Tree
end Aven.ID
