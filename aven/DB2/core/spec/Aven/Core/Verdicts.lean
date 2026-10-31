import Aven.Core.Past
import Aven.Core.ValueEq

/-!
# Splits, discounting, counting and versions, decided

`Log` states `Split`, `Closed`, `Discounted`, `Counts` and `Version.holds` as propositions; `Past` decides `Before` for what a
reader holds. This module decides the four for a reader holding `S`, so the running model (`aven-core-model`) and the
vectors (`counts.json`) answer exactly them:

- `splitB_iff`, `closedB_iff`, `discountedB_iff`, `countsB_iff`, `holdsB_iff`: each decision is its proposition.
-/

namespace Aven.Core

open Past

deriving instance DecidableEq for Envelope

variable (nm : Envelope → Hash)

instance (a b : Envelope) : Decidable (SameLog a b) := by unfold SameLog; infer_instance

instance (a b : Envelope) : Decidable (Split nm a b) := by unfold Split; infer_instance

def splitB (a b : Envelope) : Bool := decide (Split nm a b)

/-- Some envelope of `S` makes a split with `x`. -/
def splitIn (S : List Envelope) (x : Envelope) : Bool := S.any (splitB nm x)

def discountedB (S : List Envelope) (e : Envelope) : Bool :=
  splitIn nm S e || S.any fun x => inPast nm S e x && splitIn nm S x

/-- Every parent `x` names is the name of an envelope of `S`. -/
def parentsHeld (S : List Envelope) (x : Envelope) : Bool :=
  (x.prev.toList ++ x.deps).all fun h => S.any fun y => nm y == h

/-- `e`'s whole past is held. -/
def closedB (S : List Envelope) (e : Envelope) : Bool :=
  parentsHeld nm S e && S.all fun x => !inPast nm S e x || parentsHeld nm S x

def countsB (fit authorized : Envelope → Bool) (S : List Envelope) (e : Envelope) : Bool :=
  closedB nm S e && (fit e && authorized e) && !splitIn nm S e &&
    S.all fun x => !inPast nm S e x || ((fit x && authorized x) && !splitIn nm S x)

def holdsB (S : List Envelope) (v : Version) (e : Envelope) : Bool :=
  S.any fun t => v.contains (nm t) && (decide (t = e) || (S.contains e && inPast nm S t e))

variable {nm}

theorem splitB_iff {a b : Envelope} : splitB nm a b = true ↔ Split nm a b := by simp [splitB]

theorem splitIn_iff {S : List Envelope} {x : Envelope} : splitIn nm S x = true ↔ ∃ y ∈ S, Split nm x y := by
  simp [splitIn, splitB]

theorem splitIn_false {S : List Envelope} {x : Envelope} : splitIn nm S x = false ↔ ∀ y ∈ S, ¬ Split nm x y := by
  simp [splitIn, splitB]

/-- What `e` reaches among `S`: itself, or something of `S` the rounds find in its past. -/
theorem reaches_decided {S : List Envelope} {e x : Envelope} :
    Reaches nm S e x ↔ x = e ∨ (x ∈ S ∧ inPast nm S e x = true) := by
  rw [reaches_iff]
  constructor
  · rintro (h | h)
    · exact .inl h
    · exact .inr ⟨h.mem, (inPast_iff h.mem).mpr h⟩
  · rintro (h | ⟨m, h⟩)
    · exact .inl h
    · exact .inr ((inPast_iff m).mp h)

theorem discountedB_iff {S : List Envelope} {e : Envelope} : discountedB nm S e = true ↔ Discounted nm S e := by
  simp only [discountedB, Bool.or_eq_true, List.any_eq_true, Bool.and_eq_true, splitIn_iff]
  constructor
  · rintro (⟨y, hy, hs⟩ | ⟨x, hx, hp, y, hy, hs⟩)
    · exact ⟨e, y, .refl _, hy, hs⟩
    · exact ⟨x, y, reaches_decided.mpr (.inr ⟨hx, hp⟩), hy, hs⟩
  · rintro ⟨x, y, hr, hy, hs⟩
    rcases reaches_decided.mp hr with rfl | ⟨hx, hp⟩
    · exact .inl ⟨y, hy, hs⟩
    · exact .inr ⟨x, hx, hp, y, hy, hs⟩

theorem parentsHeld_iff {S : List Envelope} {x : Envelope} :
    parentsHeld nm S x = true ↔ ∀ h, (x.prev = some h ∨ h ∈ x.deps) → ∃ y ∈ S, nm y = h := by
  simp only [parentsHeld, List.all_eq_true, List.mem_append, Option.mem_toList, List.any_eq_true, beq_iff_eq]

theorem closedB_iff {S : List Envelope} {e : Envelope} : closedB nm S e = true ↔ Closed nm S e := by
  simp only [closedB, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, Bool.not_eq_true', parentsHeld_iff]
  constructor
  · rintro ⟨he, hall⟩ x hr
    rcases reaches_decided.mp hr with rfl | ⟨hx, hp⟩
    · exact he
    · rcases hall x hx with h | h
      · simp [hp] at h
      · exact h
  · intro h
    refine ⟨h e (.refl _), fun x hx => ?_⟩
    cases hp : inPast nm S e x
    · exact .inl rfl
    · exact .inr (h x (reaches_decided.mpr (.inr ⟨hx, hp⟩)))

theorem countsB_iff {fit authorized : Envelope → Bool} {S : List Envelope} {e : Envelope} :
    countsB nm fit authorized S e = true ↔ Counts nm (fun x => fit x = true) (fun x => authorized x = true) S e := by
  simp only [countsB, Bool.and_eq_true, Bool.not_eq_true', List.all_eq_true, Bool.or_eq_true, splitIn_false,
    closedB_iff]
  constructor
  · rintro ⟨⟨⟨hc, hok⟩, hs⟩, hall⟩
    refine ⟨hc, fun x hr => ?_⟩
    rcases reaches_decided.mp hr with rfl | ⟨hx, hp⟩
    · exact ⟨hok, hs⟩
    · rcases hall x hx with h | ⟨h₁, h₂⟩
      · simp [hp] at h
      · exact ⟨h₁, h₂⟩
  · rintro ⟨hc, h⟩
    refine ⟨⟨⟨hc, (h e (.refl _)).1⟩, (h e (.refl _)).2⟩, fun x hx => ?_⟩
    cases hp : inPast nm S e x
    · exact .inl rfl
    · exact .inr (h x (reaches_decided.mpr (.inr ⟨hx, hp⟩)))

theorem holdsB_iff {S : List Envelope} {v : Version} {e : Envelope} :
    holdsB nm S v e = true ↔ Version.holds nm S v e := by
  simp only [holdsB, List.any_eq_true, Bool.and_eq_true, Bool.or_eq_true, decide_eq_true_eq, List.contains_iff_mem,
    Version.holds]
  constructor
  · rintro ⟨t, ht, hv, h | ⟨m, hp⟩⟩
    · exact ⟨t, ht, hv, h ▸ .refl _⟩
    · exact ⟨t, ht, hv, reaches_decided.mpr (.inr ⟨m, hp⟩)⟩
  · rintro ⟨t, ht, hv, hr⟩
    rcases reaches_decided.mp hr with h | ⟨m, hp⟩
    · exact ⟨t, ht, hv, .inl h.symm⟩
    · exact ⟨t, ht, hv, .inr ⟨m, hp⟩⟩

end Aven.Core
