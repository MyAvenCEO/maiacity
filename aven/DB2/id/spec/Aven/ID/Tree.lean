/-! # Keys, vaults and owners

A tree is the keys it knows and its vaults, in order. A vault has a name, a kind and its owners, each a key or another
vault (SANDBOX.md, "Vaults own vaults"). A coop's vault is owned by people's or coops' vaults and holds no devices:
its people act for it through their own (PRODUCTION.md, Part C). Every lookup is by id; a well-formed tree (`Aven.ID.WF`) has each id once. -/

namespace Aven.ID

/-- The kinds of vault. An **agent's** vault (Aven) is usually an LLM agent's: owned by the vault that runs it, it acts
through its own devices within the rights its owner gives it, and no person ever switches into it. It was called a
network's vault until 30 Oct 2026 (Samuel), with the same rules. -/
inductive Kind where
  | person
  | agent
  | coop
  | device
  deriving DecidableEq, Repr

/-- An owner is a key or a vault, written `key:<id>` or `vault:<id>` in the cast. A vault's id is a `V` (A210): the
32-byte name of its genesis (`Aven.ID.VaultName`) in every format, a readable handle in the cast's fixtures; a key's id
is its text. -/
inductive Owner (V : Type) where
  | key (id : String)
  | vault (id : V)
  deriving DecidableEq, Repr

variable {V : Type}

def Owner.vault? : Owner V → Option V
  | .vault id => some id
  | .key _ => none

def Owner.key? : Owner V → Option String
  | .key id => some id
  | .vault _ => none

/-- A vault: its id, name, kind and owners, and its threshold, how many of its owners approve for it (D14, A28; k of n).
A device's vault names its key (A211), the one its device signs with. -/
structure Vault (V : Type) where
  id : V
  name : String
  kind : Kind
  owners : List (Owner V)
  threshold : Nat := 1
  key : Option String := none
  deriving DecidableEq, Repr

/-- The vaults among a vault's owners. -/
def Vault.ownerVaults (v : Vault V) : List V := v.owners.filterMap Owner.vault?

/-- The keys among a vault's owners. -/
def Vault.ownerKeys (v : Vault V) : List String := v.owners.filterMap Owner.key?

structure Tree (V : Type) where
  keys : List String
  vaults : List (Vault V)
  deriving Repr

namespace Tree

variable [DecidableEq V]

def ids (t : Tree V) : List V := t.vaults.map (·.id)

def get? (t : Tree V) (id : V) : Option (Vault V) := t.vaults.find? (·.id == id)

def kind? (t : Tree V) (id : V) : Option Kind := (t.get? id).map (·.kind)

/-- A vault's threshold as the tree stores it: how many of its owners approve for it. A vault the tree doesn't hold has
none to meet, and `approves` refuses it anyway. -/
def threshold (t : Tree V) (id : V) : Nat := ((t.get? id).map (·.threshold)).getD 1

/-- The vaults that own the vault `b` directly. -/
def ownersOf (t : Tree V) (b : V) : List V := ((t.get? b).map (·.ownerVaults)).getD []

/-- `k` owns `b`: the key `k` is one of `b`'s owners. -/
def KeyOwns (t : Tree V) (k : String) (b : V) : Prop := ∃ v, t.get? b = some v ∧ k ∈ v.ownerKeys

/-- `a` owns `b`: the vault `a` is one of `b`'s owners. -/
def Owns (t : Tree V) (a b : V) : Prop := a ∈ t.ownersOf b

theorem get?_some {t : Tree V} {x : V} {v : Vault V} (h : t.get? x = some v) : v ∈ t.vaults ∧ v.id = x :=
  ⟨List.mem_of_find?_eq_some h, by simpa using List.find?_some h⟩

theorem ownersOf_of_get? {t : Tree V} {b : V} {v : Vault V} (h : t.get? b = some v) :
    t.ownersOf b = v.ownerVaults := by
  simp [ownersOf, h]

/-- What `b`'s owners are depends on the vault found for `b`. -/
theorem Owns.get? {t : Tree V} {a b : V} (h : t.Owns a b) :
    ∃ v, t.get? b = some v ∧ a ∈ v.ownerVaults := by
  unfold Owns ownersOf at h
  cases g : t.get? b with
  | none => simp [g] at h
  | some v => exact ⟨v, rfl, by simpa [g] using h⟩

theorem Owns.mem_ids {t : Tree V} {a b : V} (h : t.Owns a b) : b ∈ t.ids := by
  obtain ⟨v, g, _⟩ := h.get?
  obtain ⟨m, e⟩ := get?_some g
  exact List.mem_map.mpr ⟨v, m, e⟩

/-- In a tree with each id once, a vault it holds is the one found by its id. -/
theorem find?_id_of_mem : ∀ {l : List (Vault V)} {v : Vault V}, (l.map (·.id)).Nodup → v ∈ l →
    l.find? (·.id == v.id) = some v
  | [], _, _, h => by simp at h
  | u :: l, v, n, h => by
    simp only [List.map_cons, List.nodup_cons] at n
    rcases List.mem_cons.mp h with rfl | h
    · simp
    · have ne : u.id ≠ v.id := fun e => n.1 (e ▸ List.mem_map.mpr ⟨v, h, rfl⟩)
      simp [ne, find?_id_of_mem n.2 h]

/-- In a tree with each id once, a vault it holds is the one found by its id. -/
theorem get?_of_mem {t : Tree V} {v : Vault V} (n : t.ids.Nodup) (h : v ∈ t.vaults) : t.get? v.id = some v :=
  find?_id_of_mem n h

/-- Vaults put in among a tree's, none with an id it has, change no vault it had. -/
theorem get?_insert {t t' : Tree V} {pre post new : List (Vault V)} (e : t.vaults = pre ++ post)
    (e' : t'.vaults = pre ++ new ++ post) (fresh : ∀ v ∈ new, v.id ∉ t.ids) : ∀ x ∈ t.ids, t'.get? x = t.get? x := by
  intro x mx
  have none_ : new.find? (·.id == x) = none :=
    List.find?_eq_none.mpr fun v mv h => fresh v mv (by simpa using (beq_iff_eq.mp h) ▸ mx)
  unfold get?
  rw [e', e, List.find?_append, List.find?_append, List.find?_append, none_]
  simp

end Tree
end Aven.ID
