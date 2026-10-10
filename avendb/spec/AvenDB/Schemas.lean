import AvenDB.Ops

/-!
# Schemas: writes that fit them

`avendb/docs/OPS.md`, writes that fit their schemas. Every reader of an entry judges each write it opens by the record
before it and after it, on the version it builds on, under the schemas the entry was written under up to it, which
must be in the vault's lane or built in and all of one kind (`lens::Lane::fits`): each place the write changed holds a
value one of them lets it hold there; each list of records it changed is one they name, holding no copy of a row it
didn't hold before (copies are what two devices adding a row with one id at once make, never one write); each row it
added or changed reads under one of them, so holds what that schema requires of a row; and the record's own fields
read under one of them where it changed one of them or added or dropped a list. A write that doesn't fit counts for no
reader, nor anything built on it (`State.counts`): every device keeps the last record that fit, whatever a patched app
writes.

S1: a write is judged by what it changed alone (`fits_iff`), on the record or row around each change: a value it
didn't change, which two devices' writes at once may have left behind, holds it back nowhere else. S2: a record that
fits keeps fitting through writes that fit
(`fits_clean`), from the first write on (`fits_new`). S3 and S4, about the state, are in `Theorems.lean`.
-/

namespace AvenDB.Ops

/-- What the schemas a write is judged under let a record hold:
    - `leaf p v`: one of them lets place `p` hold `v`;
    - `rows f old new`: one of them names `f` a list of records, and `new` holds no copy of a row `old` (`none`: no
      list) doesn't;
    - `top r`: `r`'s own fields read under one of them: they hold what it requires;
    - `row f k r`: row `k` of list `f` of `r` reads under one of them: it holds what that schema requires of a row.
    `top` reads only a record's own fields and which lists it holds, and `row` only the row's fields; and rows a write
    could make of no list it could make of rows it could make so (`rows_fresh`): a write may keep or move the copies
    a list holds, never make one. -/
structure Fit (V : Type) where
  leaf  : Path → V → Bool
  rows  : String → Option (List Key) → List Key → Bool
  top   : Record V → Bool
  row   : String → Key → Record V → Bool
  rows_fresh : ∀ f a b, rows f none a = true → rows f (some a) b = true → rows f none b = true
  top_local : ∀ r s : Record V, (∀ f, r.leaf (.top f) = s.leaf (.top f)) →
    (∀ f, (r.rows f).isSome = (s.rows f).isSome) → top r = top s
  row_local : ∀ f k (r s : Record V), (∀ g, r.leaf (.row f k g) = s.leaf (.row f k g)) → row f k r = row f k s

section

variable {V : Type}

/-- Row `k` is in list `f` of `r`. -/
def Record.holds (r : Record V) (f : String) (k : Key) : Bool := ((r.rows f).getD []).contains k

/-- The record before an entry's first write: nothing. -/
def Record.empty : Record V := ⟨fun _ => none, fun _ => none⟩

/-- Each field of a row is a field of a row its list holds, as in every record a JSON object flattens to. -/
def Record.Formed (r : Record V) : Prop := ∀ f k g v, r.leaf (.row f k g) = some v → r.holds f k = true

/-- A change the write from `r` to `s` made fits: the value it puts at a place, the rows it gives a list; the record's
    own fields read where it changed one of them, or added or dropped a list; and a row reads where it changed one of
    its fields, or added it. -/
def Fit.change (fit : Fit V) (r s : Record V) : Change V → Bool
  | .set (.top f) v     => v.all (fit.leaf (.top f)) && fit.top s
  | .set (.row f k g) v => v.all (fit.leaf (.row f k g)) && (!s.holds f k || fit.row f k s)
  | .order _ none       => fit.top s
  | .order f (some ks)  => fit.rows f (r.rows f) ks && ((r.rows f).isSome || fit.top s) &&
      ks.all fun k => r.holds f k || fit.row f k s

/-- The write from `r` to `s` fits the schemas: each change of its diff does. -/
def Fit.fits [DecidableEq V] (fit : Fit V) (ps : List Path) (fs : List String) (r s : Record V) : Bool :=
  (diff ps fs r s).all (fit.change r s)

/-- A record fits: each place holds a value the schemas let it, each list rows a write could make of none, its own
    fields read, and so does each row of each list. -/
def Fit.Clean (fit : Fit V) (r : Record V) : Prop :=
  (∀ p v, r.leaf p = some v → fit.leaf p v = true) ∧ (∀ f ks, r.rows f = some ks → fit.rows f none ks = true) ∧
    fit.top r = true ∧ ∀ f k, r.holds f k = true → fit.row f k r = true

/-- S1 (a write is judged by what it changed): the write from `r` to `s` fits exactly when each change of what it
    changed does, on the record or row around it: what it didn't change holds it back nowhere else. -/
theorem fits_iff [DecidableEq V] {fit : Fit V} {ps : List Path} {fs : List String} {r s : Record V}
    (h : Reaches ps fs r s) :
    fit.fits ps fs r s = true ↔
      (∀ p, r.leaf p ≠ s.leaf p → fit.change r s (.set p (s.leaf p)) = true) ∧
      (∀ f, r.rows f ≠ s.rows f → fit.change r s (.order f (s.rows f)) = true) := by
  simp only [Fit.fits, List.all_eq_true]
  constructor
  · intro hc
    exact ⟨fun p hp => hc _ ((diff_complete h).1 p hp), fun f hf => hc _ ((diff_complete h).2 f hf)⟩
  · rintro ⟨hl, hr⟩ c hc
    have hd := diff_sound hc
    cases c with
    | set p v => rw [hd.2]; exact hl p hd.1
    | order f ks => rw [hd.2]; exact hr f hd.1

/-- S2 (fitting records stay so): a record that fits keeps fitting through a write that fits. -/
theorem fits_clean [DecidableEq V] {fit : Fit V} {ps : List Path} {fs : List String} {r s : Record V}
    (h : Reaches ps fs r s) (hr : fit.Clean r) (hw : fit.fits ps fs r s = true) : fit.Clean s := by
  obtain ⟨hl, hrw⟩ := (fits_iff h).1 hw
  obtain ⟨cl, crows, ctop, crow⟩ := hr
  refine ⟨fun p v hv => ?_, fun f ks hk => ?_, ?_, fun f k hk => ?_⟩
  · by_cases e : r.leaf p = s.leaf p
    · exact cl p v (e ▸ hv)
    · have := hl p e
      cases p with
      | top f => simp [Fit.change, hv] at this; exact this.1
      | row f k g => simp [Fit.change, hv] at this; exact this.1
  · by_cases e : r.rows f = s.rows f
    · exact crows f ks (e ▸ hk)
    · have := hrw f e
      simp only [Fit.change, hk, Bool.and_eq_true] at this
      have hf := this.1.1
      cases ha : r.rows f with
      | none => simpa [ha] using hf
      | some a => exact fit.rows_fresh f a ks (crows f a ha) (by simpa [ha] using hf)
  · by_cases et : (∀ f, r.leaf (.top f) = s.leaf (.top f)) ∧ (∀ f, (r.rows f).isSome = (s.rows f).isSome)
    · exact (fit.top_local r s et.1 et.2) ▸ ctop
    · rcases Classical.not_and_iff_not_or_not.1 et with et | et <;> obtain ⟨f, hf⟩ := Classical.not_forall.1 et
      · have := hl (.top f) hf
        simp only [Fit.change, Bool.and_eq_true] at this
        exact this.2
      · have hne : r.rows f ≠ s.rows f := fun e => hf (e ▸ rfl)
        have := hrw f hne
        cases hs : s.rows f with
        | none => simpa [Fit.change, hs] using this
        | some ks =>
          have hrn : r.rows f = none := by
            cases hra : r.rows f with
            | none => rfl
            | some _ => simp [hra, hs] at hf
          simp only [Fit.change, hs, hrn, Option.isSome_none, Bool.false_or, Bool.and_eq_true] at this
          exact this.1.2
  · by_cases eo : r.holds f k = true ∧ ∀ g, r.leaf (.row f k g) = s.leaf (.row f k g)
    · exact (fit.row_local f k r s eo.2) ▸ crow f k eo.1
    · rcases Classical.not_and_iff_not_or_not.1 eo with hn | eo
      · -- a row the write added: its list changed
        have hne : r.rows f ≠ s.rows f := fun e => hn (by simpa [Record.holds, e] using hk)
        have := hrw f hne
        cases hs : s.rows f with
        | none => simp [Record.holds, hs] at hk
        | some ks =>
          simp only [Fit.change, hs, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true] at this
          have hkm : k ∈ ks := by simpa [Record.holds, hs] using hk
          rcases this.2 k hkm with h' | h'
          · exact absurd h' hn
          · exact h'
      · -- a row one of whose fields the write changed
        obtain ⟨g, hg⟩ := Classical.not_forall.1 eo
        have := hl (.row f k g) hg
        simp only [Fit.change, Bool.and_eq_true, Bool.or_eq_true, Bool.not_eq_true'] at this
        rcases this.2 with h' | h'
        · simp [h'] at hk
        · exact h'

/-- S2, the first write: a write that fits makes a record that fits of nothing, if it makes anything. -/
theorem fits_new [DecidableEq V] {fit : Fit V} {ps : List Path} {fs : List String} {s : Record V}
    (h : Reaches ps fs Record.empty s) (hs : s.Formed) (hne : s ≠ Record.empty)
    (hw : fit.fits ps fs Record.empty s = true) : fit.Clean s := by
  obtain ⟨hl, hrw⟩ := (fits_iff h).1 hw
  -- each list it holds the write made: its rows are fresh and read, and so do the record's own fields
  have hlist : ∀ f ks, s.rows f = some ks →
      fit.rows f none ks = true ∧ fit.top s = true ∧ ∀ k ∈ ks, fit.row f k s = true := by
    intro f ks hk
    have := hrw f (by simp [Record.empty, hk])
    simp only [Fit.change, hk, Record.empty, Record.holds, Option.isSome_none, Bool.false_or, Bool.and_eq_true,
      List.all_eq_true, Option.getD_none, List.contains_nil] at this
    exact ⟨this.1.1, this.1.2, this.2⟩
  refine ⟨fun p v hv => ?_, fun f ks hk => (hlist f ks hk).1, ?_, fun f k hk => ?_⟩
  · have := hl p (by simp [Record.empty, hv])
    cases p with
    | top f => simp [Fit.change, hv] at this; exact this.1
    | row f k g => simp [Fit.change, hv] at this; exact this.1
  · -- it holds something: a list, or a value of its own, as a field of a row is one of a row of a list it holds
    have hsome : (∃ f ks, s.rows f = some ks) ∨ ∃ f v, s.leaf (.top f) = some v := by
      apply Classical.byContradiction
      intro hn
      apply hne
      apply Record.ext
      · funext p
        cases p with
        | top f =>
          cases hv : s.leaf (.top f) with
          | none => rfl
          | some v => exact absurd (.inr ⟨f, v, hv⟩) hn
        | row f k g =>
          cases hv : s.leaf (.row f k g) with
          | none => rfl
          | some v =>
            have hh := hs f k g v hv
            cases hk : s.rows f with
            | none => simp [Record.holds, hk] at hh
            | some ks => exact absurd (.inl ⟨f, ks, hk⟩) hn
      · funext f
        cases hk : s.rows f with
        | none => rfl
        | some ks => exact absurd (.inl ⟨f, ks, hk⟩) hn
    rcases hsome with ⟨f, ks, hk⟩ | ⟨f, v, hv⟩
    · exact (hlist f ks hk).2.1
    · have := hl (.top f) (by simp [Record.empty, hv])
      simp only [Fit.change, Bool.and_eq_true] at this
      exact this.2
  · cases hk' : s.rows f with
    | none => simp [Record.holds, hk'] at hk
    | some ks => exact (hlist f ks hk').2.2 k (by simpa [Record.holds, hk'] using hk)

end

end AvenDB.Ops
