import Aven.ID.Tree

/-! # Generated trees

Random trees for the vectors, from a seeded xorshift, so `lake exe vectors` writes the same file on every run. Vaults
are `v0`, `v1`, … in a shuffled order; owners mostly point at earlier vaults, so many trees are well formed, and now
and then at any vault, an unknown one, an unknown key or a device's key, and now and then a device lacks its key, so
many are not. A coop's keys become earlier vaults, which may be networks or devices, and now and then a name is
empty or two lines: aven-id's property test (`id/core/tests/model.rs`) draws trees the same way. -/

namespace Aven.ID

deriving instance Inhabited for Kind

/-- xorshift64: a failing case is named by its seed and replays. -/
structure Rng where
  s : UInt64

namespace Rng

def seed (n : Nat) : Rng := ⟨(n.toUInt64 * 0x9e3779b97f4a7c15) ||| 1⟩

def next (r : Rng) : UInt64 × Rng :=
  let x := r.s ^^^ (r.s <<< 13)
  let x := x ^^^ (x >>> 7)
  let x := x ^^^ (x <<< 17)
  (x, ⟨x⟩)

/-- A number below `n` (`n > 0`). -/
def below (r : Rng) (n : Nat) : Nat × Rng :=
  let (x, r) := r.next
  (x.toNat % n, r)

/-- `n` numbers, each below `k`. -/
def belows (r : Rng) (k : Nat) : Nat → List Nat × Rng
  | 0 => ([], r)
  | n + 1 =>
    let (x, r) := r.below k
    let (xs, r) := r.belows k n
    (x :: xs, r)

/-- Fisher–Yates. -/
def shuffle {α : Type} (r : Rng) (l : List α) : List α × Rng := Id.run do
  let mut a := l.toArray
  let mut r := r
  for i in [0:a.size] do
    let j := a.size - 1 - i
    let (k, r') := r.below (j + 1)
    r := r'
    a := a.swapIfInBounds j k
  return (a.toList, r)

end Rng

structure Spec where
  kind : Kind
  simple : Nat
  owners : List (Nat × Nat)
  up : Nat
  named : Nat
  deriving Inhabited

def randomSpec (r : Rng) : Spec × Rng :=
  let (k, r) := r.below 4
  let (simple, r) := r.below 4
  let (n, r) := r.below 3
  let (tags, r) := r.belows 40 (n + 1)
  let (ats, r) := r.belows 8 (n + 1)
  let (up, r) := r.below 8
  let (named, r) := r.below 24
  (⟨[Kind.person, .network, .coop, .device][k]!, simple, tags.zip ats, up, named⟩, r)

def randomTree (seed : Nat) : Tree := Id.run do
  let mut r := Rng.seed seed
  let (n, r') := r.below 7
  r := r'
  let n := n + 1
  let mut specs : Array Spec := #[]
  for _ in [0:n] do
    let (s, r') := randomSpec r
    r := r'
    specs := specs.push s
  let kinds := specs.map (·.kind)
  let devices := (List.range n).filter fun j => kinds[j]! == .device
  let earlier (i at_ : Nat) (any : Bool) : Option Owner :=
    let owners := (List.range i).filter fun j => any || kinds[j]! != .device
    owners[at_ % max owners.length 1]?.map fun j => .vault s!"v{j}"
  let vaults := (List.range n).map fun i =>
    let s := specs[i]!
    let single := if s.kind == .device && s.simple > 0 then earlier i s.up (s.simple == 1) else none
    let owners := match single with
      | some o => [o]
      | none =>
        if s.simple == 0 && s.up == 0 then [] else
        s.owners.map fun (tag, at_) =>
          if tag < 12 then
            if s.kind == .coop then (earlier i at_ false).getD (.key "k0") else .key (["k0", "k1"][at_ % 2]!)
          else if tag == 12 then .key "k9"
          else if tag == 13 then
            (devices[at_ % max devices.length 1]?.map fun j => Owner.key s!"v{j}").getD (.key "k9")
          else if tag < 38 then (earlier i at_ (tag == 14)).getD (.key "k0")
          else .vault s!"v{at_ % (n + 1)}"
    let name := if s.named == 0 then "" else if s.named == 1 then s!"v{i}\nv{i}" else s!"v{i}"
    ({ id := s!"v{i}", name, kind := s.kind, owners } : Vault)
  let keys := ["k0", "k1"] ++ ((vaults.zip specs.toList).filter fun (v, s) => v.kind == .device && s.up != 7).map
    (·.1.id)
  let (vaults, _) := r.shuffle vaults
  return ⟨keys, vaults⟩

end Aven.ID
