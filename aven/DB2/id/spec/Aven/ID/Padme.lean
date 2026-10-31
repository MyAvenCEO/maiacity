/-! # Padmé (PURBs; caps D18)

Everything a keeper or a member who doesn't read sees the size of is padded with Padmé: a length keeps its
`⌊log₂ ⌊log₂ l⌋⌋ + 1` most significant bits and rounds the rest up, so it leaks `O(log log l)` bits and grows by at most
an eighth, about 12 %. One definition for every use: the seal's plaintext (`Aven.ID.Seal`, in bytes) and an epoch's
stanza list (`Aven.ID.KeyFormats`, in entries).

`padme` is the identity below 8, and rounds up from there (9 → 10, 17 → 18, 129 → 144, 1000 → 1024).

What it proves: `padme_ge` (it never shrinks), `padme_le` (it adds at most an eighth); a padded length pads to itself,
checked for every length below 2¹⁶. -/

namespace Aven.ID.Padme


/-- Padmé's length for `l`: the low bits of `l` rounded up, keeping `⌊log₂ ⌊log₂ l⌋⌋ + 1` significant bits. -/
def zeroBits (l : Nat) : Nat := l.log2 - (l.log2.log2 + 1)

def padme (l : Nat) : Nat :=
  if l < 2 then l else (l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l * 2 ^ zeroBits l

theorem padme_ge (l : Nat) : l ≤ padme l := by
  unfold padme
  split
  · exact Nat.le_refl _
  · have hp : 0 < 2 ^ zeroBits l := Nat.two_pow_pos _
    have := Nat.div_add_mod (l + 2 ^ zeroBits l - 1) (2 ^ zeroBits l)
    have := Nat.mod_lt (l + 2 ^ zeroBits l - 1) hp
    have : (l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l * 2 ^ zeroBits l =
        2 ^ zeroBits l * ((l + 2 ^ zeroBits l - 1) / 2 ^ zeroBits l) := Nat.mul_comm _ _
    omega

/-- Rounding up adds less than one unit. -/
theorem padme_lt (l : Nat) (h : 2 ≤ l) : padme l < l + 2 ^ zeroBits l := by
  unfold padme
  simp only [show ¬ l < 2 from by omega, ↓reduceIte]
  have hp : 0 < 2 ^ zeroBits l := Nat.two_pow_pos _
  have := Nat.div_mul_le_self (l + 2 ^ zeroBits l - 1) (2 ^ zeroBits l)
  omega

/-- From 16 up, a unit is at most an eighth of the length. -/
theorem unit_le (l : Nat) (h : 16 ≤ l) : 8 * 2 ^ zeroBits l ≤ l := by
  have hl : l ≠ 0 := by omega
  have he : 4 ≤ l.log2 := (Nat.le_log2 hl).mpr (by simpa using h)
  have hs : 2 ≤ l.log2.log2 := (Nat.le_log2 (by omega)).mpr (by simpa using he)
  have hz : zeroBits l + 3 ≤ l.log2 := by unfold zeroBits; omega
  calc 8 * 2 ^ zeroBits l = 2 ^ (zeroBits l + 3) := by rw [Nat.pow_add]; omega
    _ ≤ 2 ^ l.log2 := Nat.pow_le_pow_right (by decide) hz
    _ ≤ l := Nat.log2_self_le hl

/-- Padmé adds at most an eighth: about 12 %. -/
theorem padme_le (l : Nat) : padme l ≤ l + l / 8 := by
  by_cases h : 16 ≤ l
  · have := padme_lt l (by omega)
    have := unit_le l h
    omega
  · exact (by decide : ∀ m, m < 16 → padme m ≤ m + m / 8) l (by omega)

-- A padded length pads to itself, checked for every length up to 2¹⁶.
#guard (List.range 65536).all fun l => padme (padme l) == padme l

#guard (List.range 8).all fun l => padme l == l
#guard padme 0 = 0 ∧ padme 1 = 1 ∧ padme 9 = 10 ∧ padme 17 = 18 ∧ padme 129 = 144 ∧ padme 1000 = 1024

end Aven.ID.Padme
