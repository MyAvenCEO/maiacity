/-!
# A sliced upkeep always moves on (F1)

A device's upkeep makes the edits its view calls for. A refresh looks at `k` entries at most (`UPKEEP_SLICE`), in
creation order, and leaves the rest due for its next look (`UpkeepDue` in lab.rs). The next look covers the entries
that changed since, and the ones left. It looks at every entry again only if one that changed is global: a lane, or a
cap group, which every entry's upkeep reads.

Being left for later is no change. So an entry left over is never a reason to start over (`next`). Then, with no new
change, every look leaves strictly fewer entries (`next_shrinks`), and the upkeep ends within as many looks as it has
slices (`ends_within`). Until 2026-10-27 the rule counted a global entry among those left as a change, so a device whose
entries put a lane after the first slice looked at the same first slice forever (`Examples`, `old`). An iPhone did
this some 40 times a second, and never caught up.
-/

namespace AvenDB.UpkeepSlices

/-- What a look leaves due: the entries left for the next one, `none` before the first look of a pass. -/
abbrev Left := Option (List Nat)

/-- One look at `k` entries at most: of every entry (`all`) if nothing was left or a change is global (`global`), else of
    the entries changed and those left. What it leaves. -/
def next (k : Nat) (all : List Nat) (global : Bool) (changed : List Nat) : Left → List Nat
  | none => all.drop k
  | some left => if global then all.drop k else (changed ++ left).drop k

/-- The rule before the fix: a global entry among those left was counted as a change. -/
def old (k : Nat) (all : List Nat) (isGlobal : Nat → Bool) : Left → List Nat
  | none => all.drop k
  | some left => if left.any isGlobal then all.drop k else left.drop k

/-- With no change, a look leaves fewer entries than were left, while any were. -/
theorem next_shrinks (k : Nat) (hk : 0 < k) (all left : List Nat) (h : left ≠ []) :
    (next k all false [] (some left)).length < left.length := by
  simp only [next, Bool.false_eq_true, ↓reduceIte, List.nil_append, List.length_drop]
  have : 0 < left.length := List.length_pos_iff.mpr h
  omega

/-- `n` looks with no change, from `left`. -/
def looks (k : Nat) (all : List Nat) : Nat → List Nat → List Nat
  | 0, left => left
  | n + 1, left => looks k all n (next k all false [] (some left))

theorem looks_length (k : Nat) (all : List Nat) (n : Nat) (left : List Nat) :
    (looks k all n left).length = left.length - n * k := by
  induction n generalizing left with
  | zero => simp [looks]
  | succ n ih =>
    simp only [looks, ih, next, Bool.false_eq_true, ↓reduceIte, List.nil_append, List.length_drop]
    rw [Nat.succ_mul, Nat.sub_sub, Nat.add_comm k]

/-- With no change, the upkeep leaves nothing within `⌈left / k⌉` looks: it ends. -/
theorem ends_within (k : Nat) (hk : 0 < k) (all left : List Nat) :
    looks k all ((left.length + k - 1) / k) left = [] := by
  apply List.eq_nil_of_length_eq_zero
  rw [looks_length]
  have hd := Nat.div_add_mod (left.length + k - 1) k
  have hm := Nat.mod_lt (left.length + k - 1) hk
  have : left.length ≤ (left.length + k - 1) / k * k := by
    rw [Nat.mul_comm]
    omega
  omega

namespace Examples

-- 200 entries, a lane at entry 150, slices of 64
def all : List Nat := List.range 200
def isGlobal (e : Nat) : Bool := e == 150

-- the old rule starts over at every look: what it leaves never shrinks
#guard old 64 all isGlobal (some (all.drop 64)) == all.drop 64
#guard (old 64 all isGlobal (some (old 64 all isGlobal (some (all.drop 64))))).length == 136
-- the rule now goes on with what it left, and ends in four looks
#guard next 64 all false [] (some (all.drop 64)) == all.drop 128
#guard looks 64 all 3 (all.drop 64) == []

end Examples

end AvenDB.UpkeepSlices
