import AvenDB.ShownView

/-!
# The show rules kept showings are sealed to

A device seals each pack of the showings it keeps (`ShownView.lean`) to the number of the show rules it judged them
under, `showRules`, never to the build of the engine that judged them. Until 2026-10-28 it sealed them to the engine's
own hash, of every source file of the engine, so any release that changed any of them, however far from judging,
left every device's kept showings shut: its first unlock after a release judged every entry anew (5.7 s of an
iPhone-size vault in WebAssembly, of an unlock that took 0.6 s with them). Stored views had the same fault and the
same fix (`ViewRules.lean`).

`showRules` names what judging an entry gives of its inputs (`ShownView.Inputs`): its items and its history, as
`show_items` builds them, with the cap groups it judges by and the lanes it reads. Bump it in the same change as any
edit to those that changes what they give (the Rust core's pinned showings, `tests/all/show_rules.rs`, fail until it is
bumped). A change of how a showing is written down is not a change of the rules: the pack's own format line names that
(`KEPT_SHOWN` in `lab/shown_map.rs`).

The engine reads the number from this file as it builds (`crates/avendb/build.rs`), so this line is its one source.

- SR1: a pack opens the same whatever build sealed it (`SR1_any_build`), and where it was sealed under these rules by
  an engine that judges as this one does, what a device opens of it is each entry judged anew (`SR1_opens_judged`).
- SR2: a pack sealed under other rules never opens, and the device judges anew (`SR2_other_rules_judge`).
-/

namespace AvenDB.ShowRules

open AvenDB.ShownView

variable {W L G P S : Type}

/-- The number of the show rules. -/
def showRules : Nat := 1

/-- A kept showing as a device seals it: the rules it was judged under, the build that judged it, and the showing. -/
structure Sealed (P S : Type) where
  rules  : Nat
  engine : Nat
  kept   : Kept P S

/-- What a device opens of a sealed showing: the showing where it was sealed under these rules, else none. The build
    that sealed it is not read. -/
def opensKept (s : Sealed P S) : Option (Kept P S) :=
  if s.rules = showRules then some s.kept else none

/-- SR1: one build opens what any other sealed under these rules, as it opens its own. -/
theorem SR1_any_build (k : Kept P S) (e₁ e₂ : Nat) :
    opensKept ⟨showRules, e₁, k⟩ = opensKept ⟨showRules, e₂, k⟩ := rfl

/-- SR1: where a pack was sealed by an engine that judges as this one does under the rules it sealed it under
    (`judged`), what a device opens of it is the showing judged anew, whatever build sealed it. -/
theorem SR1_opens_judged [DecidableEq P] (judge judged : Inputs W L G → S) (print : Inputs W L G → P)
    (hs : Sound print) (s : Sealed P S) (hrules : s.rules = showRules → judged = judge)
    (hk : Honest judged print s.kept) (now : Inputs W L G) :
    openShown judge print now (opensKept s) = judge now := by
  unfold opensKept
  split
  · rename_i h
    obtain rfl := hrules h
    exact SV1_open _ print hs now s.kept hk
  · rfl

/-- SR2: a pack sealed under other rules stays shut, and the device judges the entry anew. -/
theorem SR2_other_rules_judge [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P)
    (s : Sealed P S) (hr : s.rules ≠ showRules) (now : Inputs W L G) :
    opensKept s = none ∧ openShown judge print now (opensKept s) = judge now := by
  unfold opensKept
  simp [hr, openShown]

end AvenDB.ShowRules
