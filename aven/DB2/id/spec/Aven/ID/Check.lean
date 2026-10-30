import Aven.ID.WF

/-! # Why a tree is not well formed

`check` names the first rule a tree breaks, in the order aven-id's `Tree::new` reports it: two vaults with one id
first; then, vault by vault in the tree's order, a name that is none, no owner, an unknown owner, a device not owned
by exactly one vault, a device among the owners, a device without its key, a device's key among the owners, a coop
owned by anything but a person's or a coop's vault, a device held by a coop; and a cycle last. `check_iff`
proves it names nothing exactly when the tree is well formed. -/

namespace Aven.ID

inductive Invalid where
  | duplicate (id : String)
  | unowned (id : String)
  | unknown (vault : String) (owner : Owner)
  | deviceOwners (id : String)
  | deviceOwns (device vault : String)
  | deviceKeyless (id : String)
  | deviceKeyOwns (device vault : String)
  | name (id : String)
  | coopOwner (coop : String) (owner : Owner)
  | coopDevice (coop device : String)
  | cycle
  deriving DecidableEq, Repr

/-- The first id seen before, or none. -/
def firstDup (seen : List String) : List String → Option String
  | [] => none
  | x :: xs => if x ∈ seen then some x else firstDup (x :: seen) xs

theorem firstDup_none {seen : List String} : ∀ {l : List String},
    firstDup seen l = none ↔ l.Nodup ∧ ∀ x ∈ l, x ∉ seen
  | [] => by simp [firstDup]
  | x :: xs => by
    unfold firstDup
    by_cases h : x ∈ seen
    · simp only [h, ↓reduceIte, reduceCtorEq, false_iff]
      exact fun ⟨_, a⟩ => a x (by simp) h
    · simp only [h, ↓reduceIte]
      rw [firstDup_none]
      constructor
      · rintro ⟨n, a⟩
        refine ⟨List.nodup_cons.mpr ⟨fun m => a x m (by simp), n⟩, fun y m => ?_⟩
        rcases List.mem_cons.mp m with rfl | m
        · exact h
        · exact fun s => a y m (by simp [s])
      · rintro ⟨n, a⟩
        obtain ⟨nx, n⟩ := List.nodup_cons.mp n
        refine ⟨n, fun y m s => ?_⟩
        rcases List.mem_cons.mp s with rfl | s
        · exact nx m
        · exact a y (by simp [m]) s

/-- The first of two answers that names something. -/
def orElse {α : Type} : Option α → Option α → Option α
  | some a, _ => some a
  | none, b => b

@[simp] theorem orElse_none {α : Type} {a b : Option α} : orElse a b = none ↔ a = none ∧ b = none := by
  cases a <;> simp [orElse]

namespace Tree

/-- The first rule one vault breaks, as aven-id checks them. -/
def problem (t : Tree) (v : Vault) : Option Invalid :=
  orElse (if validName v.name = false then some (.name v.id) else none) <|
  orElse (if v.owners = [] then some (.unowned v.id) else none) <|
  orElse ((v.owners.find? fun o => !t.knows o).map (.unknown v.id)) <|
  orElse (if v.kind = .device ∧ v.servesOne = false then some (.deviceOwners v.id) else none) <|
  orElse ((v.ownerVaults.find? fun a => t.kind? a == some .device).map (.deviceOwns · v.id)) <|
  orElse (if v.kind = .device ∧ t.keys.contains v.id = false then some (.deviceKeyless v.id) else none) <|
  orElse ((v.ownerKeys.find? fun k => t.kind? k == some .device).map (.deviceKeyOwns · v.id)) <|
  orElse (if v.kind = .coop then (v.owners.find? fun o => !t.coopOwner o).map (.coopOwner v.id) else none) <|
  if v.kind = .device then (v.ownerVaults.find? fun a => t.kind? a == some .coop).map (.coopDevice · v.id) else none

def acyclic (t : Tree) : Bool := t.vaults.all fun v => v.ownerVaults.all fun a => t.rank a < t.rank v.id

def check (t : Tree) : Option Invalid :=
  match firstDup [] t.ids with
  | some d => some (.duplicate d)
  | none => match t.vaults.findSome? t.problem with
    | some p => some p
    | none => if t.acyclic then none else some .cycle

theorem problem_none {t : Tree} {v : Vault} : t.problem v = none ↔
    validName v.name = true ∧ v.owners ≠ [] ∧ (∀ o ∈ v.owners, t.knows o = true) ∧ (v.kind = .device → v.servesOne = true) ∧
    (∀ a ∈ v.ownerVaults, t.kind? a ≠ some .device) ∧ (v.kind = .device → t.keys.contains v.id = true) ∧
    (∀ k ∈ v.ownerKeys, t.kind? k ≠ some .device) ∧ (v.kind = .coop → ∀ o ∈ v.owners, t.coopOwner o = true) ∧
    (v.kind = .device → ∀ a ∈ v.ownerVaults, t.kind? a ≠ some .coop) := by
  by_cases hc : v.kind = .coop <;> by_cases hd : v.kind = .device <;>
    simp_all [problem, List.find?_eq_none]

/-- `check` names nothing exactly when the tree is well formed. -/
theorem check_iff (t : Tree) : t.check = none ↔ t.WF := by
  have each : t.vaults.findSome? t.problem = none ↔ ∀ v ∈ t.vaults, t.problem v = none :=
    List.findSome?_eq_none_iff
  have cyc : t.acyclic = true ↔ ∀ v ∈ t.vaults, ∀ a ∈ v.ownerVaults, t.rank a < t.rank v.id := by
    simp [acyclic]
  constructor
  · intro h
    unfold check at h
    split at h
    · cases h
    next hd =>
    split at h
    · cases h
    next hp =>
    have n := (firstDup_none.mp hd).1
    have all := fun v m => problem_none.mp ((each.mp hp) v m)
    have c : t.acyclic = true := by cases e : t.acyclic <;> simp_all
    exact ⟨n, fun v m => (all v m).2.1, fun v m => (all v m).2.2.1, fun v m => (all v m).2.2.2.1,
      fun v m => (all v m).2.2.2.2.1, cyc.mp c, fun v m => (all v m).2.2.2.2.2.1,
      fun v m => (all v m).2.2.2.2.2.2.1, fun v m => (all v m).1, fun v m => (all v m).2.2.2.2.2.2.2.1,
      fun v m => (all v m).2.2.2.2.2.2.2.2⟩
  · intro ⟨n, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10⟩
    have hd : firstDup [] t.ids = none := firstDup_none.mpr ⟨n, by simp⟩
    have hp : t.vaults.findSome? t.problem = none :=
      each.mpr fun v m => problem_none.mpr ⟨a8 v m, a1 v m, a2 v m, a3 v m, a4 v m, a6 v m, a7 v m, a9 v m, a10 v m⟩
    simp [check, hd, hp, cyc.mpr a5]

end Tree
end Aven.ID
