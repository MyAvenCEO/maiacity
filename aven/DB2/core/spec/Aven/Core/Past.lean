import Aven.Core.Log

/-! # The past, decided

Readers read an envelope's past: caps' revocations and expiry (an envelope that had seen a revocation never counts,
and a revocation keeps what its own past holds), the docs layer's logs and counts. `Log` states the past as `Reaches`,
a proposition. This module decides it for the envelopes a reader holds: rounds of names, each adding the envelopes
that something already found builds on, until a round adds nothing. That takes no more rounds than there are
envelopes.

- `reaches_iff`: Core's past is the envelope itself and what is `Before` it;
- `found_iff`, `inPast_iff`: `past` finds exactly the names of what is before an envelope, and `inPast` decides
  `Before`.

Envelopes are found by name, as Core's `BuildsOn` finds them: two envelopes of `S` with one name are both in the past
or neither is (`Before.rename`). -/

namespace Aven.Core.Past

/-- The names an envelope builds on, its parents: the one before it in its log, and the tips of other logs it names. -/
def parents (e : Envelope) : List Hash := e.prev.toList ++ e.deps

variable (nm : Envelope → Hash)

theorem buildsOn_iff {a b : Envelope} : BuildsOn nm a b ↔ nm b ∈ parents a := by
  simp [BuildsOn, parents]

/-- `b` is in `a`'s past among `S`, `a` itself left out: `a` builds on it, or on something whose past holds it. -/
inductive Before (S : List Envelope) (a : Envelope) : Envelope → Prop
  | parent {b : Envelope} : b ∈ S → nm b ∈ parents a → Before S a b
  | step {b c : Envelope} : Before S a b → c ∈ S → nm c ∈ parents b → Before S a c

/-- Each name once, the first time it comes. -/
def dedup : List Hash → List Hash
  | [] => []
  | x :: xs => if (dedup xs).contains x then dedup xs else x :: dedup xs

/-- The names one round adds: of envelopes of `S` not yet known, built on by one already known. -/
def fresh (S : List Envelope) (K : List Hash) : List Hash :=
  dedup ((S.filter fun c =>
    !K.contains (nm c) && S.any fun b => K.contains (nm b) && (parents b).contains (nm c)).map nm)

/-- The names in `a`'s past among `S` after `n + 1` rounds. -/
def pastNames (S : List Envelope) (a : Envelope) : Nat → List Hash
  | 0 => dedup ((S.filter fun b => (parents a).contains (nm b)).map nm)
  | n + 1 => pastNames S a n ++ fresh nm S (pastNames S a n)

/-- The names in `a`'s past among `S`: as many rounds as `S` has envelopes find them all. -/
def past (S : List Envelope) (a : Envelope) : List Hash := pastNames nm S a (S.length + 1)

/-- `b` is before `a` among `S`, decided. -/
def inPast (S : List Envelope) (a b : Envelope) : Bool := (past nm S a).contains (nm b)

variable {nm} {S S' : List Envelope} {a b c : Envelope}

theorem Before.mem (h : Before nm S a b) : b ∈ S := by
  cases h with
  | parent m _ => exact m
  | step _ m _ => exact m

theorem Before.trans (h₁ : Before nm S a b) (h₂ : Before nm S b c) : Before nm S a c := by
  induction h₂ with
  | parent m t => exact .step h₁ m t
  | step _ m t ih => exact .step ih m t

theorem Before.mono (hs : ∀ x ∈ S, x ∈ S') (h : Before nm S a b) : Before nm S' a b := by
  induction h with
  | parent m t => exact .parent (hs _ m) t
  | step _ m t ih => exact .step ih (hs _ m) t

/-- Another envelope of `S` with the same name is in the past too. -/
theorem Before.rename (h : Before nm S a b) (m : c ∈ S) (n : nm c = nm b) : Before nm S a c := by
  cases h with
  | parent _ t => exact .parent m (n ▸ t)
  | step h' _ t => exact .step h' m (n ▸ t)

/-- Core's past is the envelope itself and what is before it. -/
theorem reaches_iff : Reaches nm S a b ↔ b = a ∨ Before nm S a b := by
  constructor
  · intro h
    induction h with
    | refl => exact .inl rfl
    | step hb hab _ ih =>
      have t := (buildsOn_iff nm).mp hab
      rcases ih with rfl | p
      · exact .inr (.parent hb t)
      · exact .inr ((Before.parent hb t).trans p)
  · rintro (rfl | h)
    · exact .refl _
    · induction h with
      | parent m t => exact .step m ((buildsOn_iff nm).mpr t) (.refl _)
      | step _ m t ih => exact reaches_trans nm ih (.step m ((buildsOn_iff nm).mpr t) (.refl _))

theorem mem_dedup {x : Hash} : ∀ {l : List Hash}, x ∈ dedup l ↔ x ∈ l
  | [] => by simp [dedup]
  | y :: ys => by
    simp only [dedup]
    split
    · rename_i h
      simp only [List.contains_iff_mem, mem_dedup] at h
      simp only [mem_dedup, List.mem_cons]
      constructor
      · exact .inr
      · rintro (rfl | m)
        · exact h
        · exact m
    · simp [mem_dedup]

theorem nodup_dedup : ∀ (l : List Hash), (dedup l).Nodup
  | [] => by simp [dedup]
  | y :: ys => by
    simp only [dedup]
    split
    · exact nodup_dedup ys
    · rename_i h
      simp only [List.contains_iff_mem] at h
      refine List.nodup_cons.mpr ⟨?_, nodup_dedup ys⟩
      intro m
      simp_all

theorem pastNames_mono {n m : Nat} {x : Hash} (le : n ≤ m) (h : x ∈ pastNames nm S a n) :
    x ∈ pastNames nm S a m := by
  induction le with
  | refl => exact h
  | step _ ih => exact List.mem_append_left _ ih

theorem pastNames_sub : ∀ {n : Nat} {x : Hash}, x ∈ pastNames nm S a n → x ∈ S.map nm
  | 0, x, h => by
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter] at h ⊢
    obtain ⟨b, ⟨m, _⟩, e⟩ := h
    exact ⟨b, m, e⟩
  | n + 1, x, h => by
    simp only [pastNames, List.mem_append] at h
    rcases h with h | h
    · exact pastNames_sub h
    · simp only [fresh, mem_dedup, List.mem_map, List.mem_filter] at h ⊢
      obtain ⟨c, ⟨m, _⟩, e⟩ := h
      exact ⟨c, m, e⟩

theorem pastNames_nodup : ∀ (n : Nat), (pastNames nm S a n).Nodup
  | 0 => nodup_dedup _
  | n + 1 => by
    simp only [pastNames]
    refine List.nodup_append.mpr ⟨pastNames_nodup n, nodup_dedup _, ?_⟩
    intro x hx y hy e
    subst e
    simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, Bool.not_eq_true'] at hy
    obtain ⟨c, ⟨_, ⟨nk, _⟩⟩, rfl⟩ := hy
    rw [List.contains_iff_mem.mpr hx] at nk
    cases nk

/-- Every name found is the name of an envelope of `S` before `a`. -/
theorem pastNames_sound : ∀ {n : Nat} {x : Hash}, x ∈ pastNames nm S a n → ∃ b ∈ S, nm b = x ∧ Before nm S a b
  | 0, x, h => by
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter, List.contains_iff_mem] at h
    obtain ⟨b, ⟨m, t⟩, e⟩ := h
    exact ⟨b, m, e, .parent m t⟩
  | n + 1, x, h => by
    simp only [pastNames, List.mem_append] at h
    rcases h with h | h
    · exact pastNames_sound h
    · simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true,
        List.contains_iff_mem] at h
      obtain ⟨c, ⟨mc, ⟨_, ⟨b, mb, kb, tb⟩⟩⟩, rfl⟩ := h
      obtain ⟨b', mb', e, pb'⟩ := pastNames_sound kb
      exact ⟨c, mc, rfl, .step (pb'.rename mb e.symm) mc tb⟩

/-- Once a round adds nothing, everything before `a` has been found. -/
theorem pastNames_closed {j : Nat} (hj : fresh nm S (pastNames nm S a j) = []) (h : Before nm S a b) :
    nm b ∈ pastNames nm S a j := by
  induction h with
  | parent m t =>
    refine pastNames_mono (Nat.zero_le j) ?_
    simp only [pastNames, mem_dedup, List.mem_map, List.mem_filter, List.contains_iff_mem]
    exact ⟨_, ⟨m, t⟩, rfl⟩
  | @step b c hb m t ih =>
    apply Classical.byContradiction
    intro nk
    have : nm c ∈ fresh nm S (pastNames nm S a j) := by
      simp only [fresh, mem_dedup, List.mem_map, List.mem_filter, Bool.and_eq_true, List.any_eq_true,
        List.contains_iff_mem, Bool.not_eq_true']
      refine ⟨c, ⟨m, ⟨?_, ⟨b, hb.mem, ih, t⟩⟩⟩, rfl⟩
      simpa using nk
    rw [hj] at this
    exact absurd this (by simp)

/-- Each round that adds a name makes the list longer, and the list is never longer than `S`. -/
theorem pastNames_grows : ∀ (m : Nat), (∀ j < m, fresh nm S (pastNames nm S a j) ≠ []) →
    m ≤ (pastNames nm S a m).length
  | 0, _ => Nat.zero_le _
  | m + 1, h => by
    have ih := pastNames_grows m fun j hj => h j (by omega)
    have ne := h m (by omega)
    simp only [pastNames, List.length_append]
    have : 0 < (fresh nm S (pastNames nm S a m)).length := List.length_pos_iff.mpr ne
    omega

theorem pastNames_short (n : Nat) : (pastNames nm S a n).length ≤ S.length := by
  have := (pastNames_nodup (nm := nm) (S := S) (a := a) n).length_le_of_subset fun x m => pastNames_sub m
  simpa using this

/-- `past` finds exactly the names of the envelopes of `S` before `a`. -/
theorem found_iff {x : Hash} : (past nm S a).contains x = true ↔ ∃ y ∈ S, nm y = x ∧ Before nm S a y := by
  simp only [past, List.contains_iff_mem]
  constructor
  · exact pastNames_sound
  · rintro ⟨y, _, rfl, h⟩
    have : ∃ j, j ≤ S.length ∧ fresh nm S (pastNames nm S a j) = [] := by
      apply Classical.byContradiction
      intro no
      have g := pastNames_grows (nm := nm) (S := S) (a := a) (S.length + 1) fun j hj e => no ⟨j, by omega, e⟩
      have := pastNames_short (nm := nm) (S := S) (a := a) (S.length + 1)
      omega
    obtain ⟨j, le, hj⟩ := this
    exact pastNames_mono (by omega) (pastNames_closed hj h)

/-- `inPast` decides `Before` for an envelope of `S`. -/
theorem inPast_iff (m : b ∈ S) : inPast nm S a b = true ↔ Before nm S a b := by
  rw [inPast, found_iff]
  constructor
  · rintro ⟨y, _, e, p⟩
    exact p.rename m e.symm
  · exact fun h => ⟨b, m, rfl, h⟩

end Aven.Core.Past
