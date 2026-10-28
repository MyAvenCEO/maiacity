/-!
# A show judges the cap groups again only where what they are judged on changed (P1)

Before it shows any entry, a show judges the writes of every cap group entry, one after the other in the order they
were accepted, each by the groups in force before it: what they say is what every write through a share naming a group
is judged by (`show_items` in lab.rs, `policy::State::read_groups`). Until 2026-10-28 it did so at every call, and a step
of a catch-up calls it twice (`refresh_with`, then `show_more`): a catch-up of `k` steps judged the same unchanged cap
groups `2k` times, and built their items as often.

What it judges of them follows from what it is judged on alone: their writes in their order, the bodies it opened of
them, and their lanes, which a print covers (`Store::shown_caps`), as an entry's showing follows from its writes, its
bodies, its lane and the cap groups (`show_items`' `print`). A removal may change what a write builds on, so after one
it judges them again whatever the print. So a show keeps what it judged where the print is the one it judged at
(`judge`), and what it keeps is what judging again makes (`kept_sound`). While they don't change, a catch-up judges them
once however many calls it makes (`once`, `run_same`); it judges them again at each change of the print, and never more
often than the old rule (`run_le`).
-/

namespace AvenDB.CapGroupsOnce

/-- One show of cap groups of `n` writes, whose print is `now`, having last judged them at `last`: the writes it judges,
    and the print it judged at after. -/
def judge (n : Nat) (last : Option Nat) (now : Nat) : Nat × Option Nat :=
  if last = some now then (0, last) else (n, some now)

/-- The writes a run of shows judges, each with the print of its call, from `last`. -/
def run (n : Nat) : Option Nat → List Nat → Nat
  | _, [] => 0
  | last, p :: ps => (judge n last p).1 + run n (judge n last p).2 ps

/-- The rule before 2026-10-28: every show judged them. -/
def old (n : Nat) (ps : List Nat) : Nat := n * ps.length

/-- What a show holds of them: what it kept, where it judged them at the print it shows them at, else them judged anew. -/
def kept {α : Type} (f : Nat → α) (last : Option Nat) (cached : α) (now : Nat) : α :=
  if last = some now then cached else f now

/-- What it keeps is what judging them again makes, where it kept what it judged. -/
theorem kept_sound {α : Type} (f : Nat → α) (l now : Nat) (cached : α) (h : cached = f l) :
    kept f (some l) cached now = f now := by
  unfold kept
  split
  · rename_i he; cases he; exact h
  · rfl

/-- Shows at the print it judged at judge nothing. -/
theorem run_same (n p : Nat) (ps : List Nat) (h : ∀ q ∈ ps, q = p) : run n (some p) ps = 0 := by
  induction ps with
  | nil => rfl
  | cons q qs ih =>
    have hq : q = p := h q (List.mem_cons_self ..)
    subst hq
    simp only [run, judge, ↓reduceIte, Nat.zero_add]
    exact ih fun r hr => h r (List.mem_cons_of_mem _ hr)

/-- A catch-up whose cap groups don't change judges them once, however many shows it makes. -/
theorem once (n p : Nat) (ps : List Nat) (h : ∀ q ∈ ps, q = p) : run n none (p :: ps) = n := by
  simp only [run, judge, reduceCtorEq, ↓reduceIte]
  rw [run_same n p ps h, Nat.add_zero]

/-- Never more than the old rule. -/
theorem run_le (n : Nat) (last : Option Nat) (ps : List Nat) : run n last ps ≤ old n ps := by
  induction ps generalizing last with
  | nil => simp [run, old]
  | cons p ps ih =>
    have := ih (judge n last p).2
    have hj : (judge n last p).1 ≤ n := by unfold judge; split <;> simp
    simp only [run, old, List.length_cons, Nat.mul_succ] at *
    omega

namespace Examples

-- 3 cap groups of 40 writes in all; a catch-up of 30 steps, two shows a step, then a write to a group: 41 writes
#guard run 40 none (List.replicate 60 7) == 40
#guard old 40 (List.replicate 60 7) == 2400
#guard run 41 none (List.replicate 60 7 ++ List.replicate 4 8) == 82
-- a print that moves at every show is judged at every show, as before
#guard run 40 none [1, 2, 3] == old 40 [1, 2, 3]

end Examples

end AvenDB.CapGroupsOnce
