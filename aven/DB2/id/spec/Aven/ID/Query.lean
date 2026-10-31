import Aven.ID.Governs

/-! # Queries

What avenOS asks avenID, as the model computes it. Lists keep the tree's order; `governs` is depth first, so a vault
followed by `governs` is its tree as the Vault app shows it. `Aven.ID.Correct` proves each against the relations. -/

namespace Aven.ID

/-- Each element once, at its first place. -/
def dedup {α : Type} [DecidableEq α] : List α → List α
  | [] => []
  | x :: xs => x :: (dedup xs).filter (· != x)

theorem mem_dedup {α : Type} [DecidableEq α] {x : α} : ∀ {l : List α}, x ∈ dedup l ↔ x ∈ l
  | [] => by simp [dedup]
  | y :: ys => by
    simp only [dedup, List.mem_cons, List.mem_filter, bne_iff_ne, ne_eq, mem_dedup]
    by_cases e : x = y <;> simp [e]

namespace Tree

variable {V : Type} [DecidableEq V]

def isPerson (t : Tree V) (x : V) : Bool := t.kind? x == some .person
def isDevice (t : Tree V) (x : V) : Bool := t.kind? x == some .device

/-- The vaults `a` owns directly. -/
def owned (t : Tree V) (a : V) : List V := t.ids.filter fun b => (t.ownersOf b).contains a

def below (t : Tree V) : Nat → V → List V
  | 0, _ => []
  | f + 1, a => (t.owned a).flatMap fun b => b :: t.below f b

def above (t : Tree V) : Nat → V → List V
  | 0, _ => []
  | f + 1, b => (t.ownersOf b).flatMap fun a => a :: t.above f a

/-- Everything below `a`, depth first. -/
def governs (t : Tree V) (a : V) : List V := dedup (t.below t.vaults.length a)

/-- The vaults above `b`, nearest first. -/
def chain (t : Tree V) (b : V) : List V := dedup (t.above t.vaults.length b)

/-- The vault a device serves: its device vault's one owner. -/
def actsFor (t : Tree V) (d : V) : Option V :=
  match t.get? d with
  | some v => if v.kind = .device then v.ownerVaults.head? else none
  | none => none

/-- A vault's own devices: the device vaults it owns directly (Aven acts through the Aven Peer). -/
def actsThrough (t : Tree V) (a : V) : List V := (t.owned a).filter t.isDevice

/-- Whom a device may act as in avenOS, or the box (`none`), which holds every test key: people only. -/
def accounts (t : Tree V) : Option V → List V
  | some d => match t.actsFor d with
    | some s => if t.isPerson s then [s] else []
    | none => []
  | none => t.ids.filter t.isPerson

/-- The peers `a`'s Control Room shows: the devices it governs. -/
def sees (t : Tree V) (a : V) : List V := (t.governs a).filter t.isDevice

/-- A device may act on a vault when the vault it serves is that vault or governs it. -/
def mayActOn (t : Tree V) (d v : V) : Bool :=
  match t.actsFor d with
  | some s => s == v || (t.governs s).contains v
  | none => false

end Tree
end Aven.ID
