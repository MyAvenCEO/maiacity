import Aven.DB.Engine.Mutate

/-!
# Footprints, and every reader's check of a diff (caps, "Footprints"; ARCHITECTURE.md, A18 and A19)

Every lowered op has a **footprint** step (`Aven.Core.Step`): the type it writes, its verb and its fields. A cap names
the ops a holder may call, never steps (A32): the steps are the op's lowering, which every reader computes from the call
an envelope names, so every reader works out the same footprint, and then checks what the envelope actually changed
against it:

- a Record that is new, no Record before having its id: a `put-new` of its type is in the footprint, and every field
  it carries is a field the footprint writes for its type;
- a Record that changed: it keeps its id and type, and every field whose value changed is a field the footprint writes
  for its type;
- a Record that is gone: a `remove` of its type is in the footprint.

What it proves: a commit that ran as its ops say, under a (writer, counter) the Doc hasn't seen, always passes that check
(`commit_within`), so an honest writer is accepted by every reader (`honest_passes`). Its counter is fresh because a
writer's counter only grows (A18): a commit that reused one would make an id the Doc already holds; whether its caps let it call those ops is caps' part of the verdict
(`Aven.ID.Authorized`). -/

namespace Aven.DB.Engine

open Aven.Core

variable {Val : Type}

/-- One op's footprint step. -/
def Op.step : Op Val → Step
  | .put ty fs => ⟨ty, .putNew, fs.map (·.1)⟩
  | .patch ty _ set => ⟨ty, .patch, set.map (·.1)⟩
  | .remove ty _ => ⟨ty, .remove, []⟩
  | .edit ty _ f _ => ⟨ty, .edit, [f]⟩

/-- A commit's footprint, known from its ops before it runs. -/
def footprint (ops : List (Op Val)) : List Step := ops.map Op.step

/-- The fields a footprint writes for a type. -/
def fieldsOf (fp : List Step) (ty : DocId) : List Bytes := (fp.filter (·.type == ty)).flatMap (·.fields)

def hasVerb (fp : List Step) (ty : DocId) (v : StepVerb) : Bool := fp.any fun st => st.type == ty && st.verb == v

def optEq (eq : Val → Val → Bool) : Option Val → Option Val → Bool
  | some a, some b => eq a b
  | none, none => true
  | _, _ => false

/-- A Record that kept its id and type, and changed only fields the footprint writes for its type. -/
def changedOk (eq : Val → Val → Bool) (fp : List Step) (r0 r : Record Val) : Bool :=
  r0.id == r.id && r0.type == r.type &&
    (r0.fields.map (·.1) ++ r.fields.map (·.1)).all fun f =>
      optEq eq (get r0.fields f) (get r.fields f) || (fieldsOf fp r.type).contains f

/-- A new Record: its type is created, with only fields the footprint writes. Whether its id is new is the diff's. -/
def newOk (fp : List Step) (r : Record Val) : Bool :=
  hasVerb fp r.type .putNew && r.fields.all fun (f, _) => (fieldsOf fp r.type).contains f

/-- What every reader checks: the Doc before, the Doc after, and the footprint. -/
def diffWithin (eq : Val → Val → Bool) (fp : List Step) (s s' : List (Record Val)) : Bool :=
  s'.all (fun r => s.any (changedOk eq fp · r) || (newOk fp r && !s.any (·.id == r.id))) &&
    s.all fun r0 => s'.any (fun r => r.id == r0.id && r.type == r0.type) || hasVerb fp r0.type .remove

/-- A reader accepts a commit's diff when it stays within the footprint of the ops it lowers to. -/
def check (eq : Val → Val → Bool) (ops : List (Op Val)) (s s' : List (Record Val)) : Bool :=
  diffWithin eq (footprint ops) s s'

/-! ## Lemmas on fields -/

theorem lookup_isSome_mem : ∀ (t : Tuple Val) (f : Bytes), (t.lookup f).isSome = true → f ∈ t.map (·.1)
  | [], _, h => by simp at h
  | (k, v) :: t, f, h => by
    simp only [List.lookup_cons] at h
    by_cases hk : f = k
    · subst hk; simp
    · have : (f == k) = false := by simp [hk]
      rw [this] at h
      simp only at h
      exact List.mem_cons_of_mem _ (lookup_isSome_mem t f h)

theorem lookup_of_mem : ∀ (t : Tuple Val) (f : Bytes) (v : Val), (f, v) ∈ t → (t.lookup f).isSome = true
  | [], _, _, h => by simp at h
  | (k, w) :: t, f, v, h => by
    simp only [List.lookup_cons]
    by_cases hk : f = k
    · subst hk; simp
    · have : (f == k) = false := by simp [hk]
      rw [this]
      simp only
      cases List.mem_cons.mp h with
      | inl e => cases e; exact absurd rfl hk
      | inr e => exact lookup_of_mem t f v e

theorem lookup_filter_ne (t : Tuple Val) (f c : Bytes) (h : f ≠ c) :
    (t.filter (·.1 != c)).lookup f = t.lookup f := by
  induction t with
  | nil => rfl
  | cons a t ih =>
    obtain ⟨k, v⟩ := a
    simp only [List.filter_cons, List.lookup_cons]
    by_cases hk : k = c
    · subst hk
      have : (f == k) = false := by simp [h]
      simp [this, ih]
    · have hkc : (k != c) = true := by simp [hk]
      simp only [hkc, ite_true, List.lookup_cons]
      by_cases hf : f = k
      · subst hf; simp
      · have : (f == k) = false := by simp [hf]
        simp [this, ih]

theorem get_setFields_of_not_mem (f : Bytes) : ∀ (t : Tuple Val) (set : List (Bytes × Val)),
    f ∉ set.map (·.1) → get (setFields t set) f = get t f
  | t, [], _ => rfl
  | t, (c, v) :: rest, h => by
    simp only [List.map_cons, List.mem_cons, not_or] at h
    simp only [setFields]
    rw [get_setFields_of_not_mem f _ rest h.2]
    simp only [get, List.lookup_cons]
    have : (f == c) = false := by simp [h.1]
    rw [this]
    exact lookup_filter_ne t f c h.1

theorem optEq_refl (eq : Val → Val → Bool) (heq : ∀ x, eq x x = true) : ∀ o : Option Val, optEq eq o o = true
  | some a => heq a
  | none => rfl

/-! ## The invariant a commit keeps -/

/-- The footprint writes field `f` for type `ty`. -/
def Writes (fp : List Step) (ty : DocId) (f : Bytes) : Prop := ∃ st ∈ fp, st.type = ty ∧ f ∈ st.fields

/-- What every Record after holds against the Records before, as the reader's check asks it. -/
structure Within (eq : Val → Val → Bool) (fp : List Step) (s0 s : List (Record Val)) : Prop where
  now : ∀ r ∈ s,
    (∃ r0 ∈ s0, r0.id = r.id ∧ r0.type = r.type ∧
      ∀ f, optEq eq (get r0.fields f) (get r.fields f) = false → Writes fp r.type f) ∨
    ((∃ st ∈ fp, st.type = r.type ∧ st.verb = .putNew) ∧ (∀ f, (get r.fields f).isSome = true → Writes fp r.type f) ∧
      ∀ r0 ∈ s0, r0.id ≠ r.id)
  before : ∀ r0 ∈ s0,
    (∃ r ∈ s, r.id = r0.id ∧ r.type = r0.type) ∨ (∃ st ∈ fp, st.type = r0.type ∧ st.verb = .remove)

theorem within_refl (eq : Val → Val → Bool) (heq : ∀ x, eq x x = true) (fp : List Step) (s : List (Record Val)) :
    Within eq fp s s :=
  ⟨fun r hr => .inl ⟨r, hr, rfl, rfl, fun f h => by rw [optEq_refl eq heq] at h; cases h⟩,
   fun r hr => .inl ⟨r, hr, rfl, rfl⟩⟩

theorem found_type {eq : Val → Val → Bool} {ty : DocId} {wh : List (Bytes × Val)} {r : Record Val}
    (h : found eq ty wh r = true) : r.type = ty := by
  simp only [found, Bool.and_eq_true, beq_iff_eq] at h
  exact h.1

theorem edits_type {ty : DocId} {id : NewId} {r : Record Val} (h : edits ty id r = true) : r.type = ty := by
  simp only [edits, Bool.and_eq_true, beq_iff_eq] at h
  exact h.2

/-- Changing the fields of the Records `p` picks, in a way that touches only fields the footprint writes for type `ty`,
which every picked Record has, keeps the invariant. -/
theorem within_map (eq : Val → Val → Bool) (fp : List Step) (s0 s : List (Record Val)) (h : Within eq fp s0 s)
    (p : Record Val → Bool) (ty : DocId) (hp : ∀ r, p r = true → r.type = ty) (set : List (Bytes × Val))
    (hset : ∀ f ∈ set.map (·.1), Writes fp ty f) :
    Within eq fp s0 (s.map fun r => if p r then { r with fields := setFields r.fields set } else r) := by
  constructor
  · intro r1 hr1
    obtain ⟨r, hr, rfl⟩ := List.mem_map.mp hr1
    by_cases hpr : p r = true
    · simp only [hpr, ite_true]
      have hty := hp r hpr
      rcases h.now r hr with ⟨r0, hr0, hid, hty0, hf⟩ | ⟨hc, hf⟩
      · refine .inl ⟨r0, hr0, hid, hty0, fun f hne => ?_⟩
        by_cases hs : f ∈ set.map (·.1)
        · simpa [hty] using hset f hs
        · rw [get_setFields_of_not_mem f _ _ hs] at hne
          exact hf f hne
      · refine .inr ⟨hc, fun f hsome => ?_, hf.2⟩
        by_cases hs : f ∈ set.map (·.1)
        · simpa [hty] using hset f hs
        · rw [get_setFields_of_not_mem f _ _ hs] at hsome
          exact hf.1 f hsome
    · have : p r = false := by simpa using hpr
      simp only [this]
      exact h.now r hr
  · intro r0 hr0
    rcases h.before r0 hr0 with ⟨r, hr, hid, hty⟩ | hrm
    · refine .inl ⟨_, List.mem_map.mpr ⟨r, hr, rfl⟩, ?_⟩
      by_cases hpr : p r = true <;> simp [hpr, hid, hty]
    · exact .inr hrm

/-- No Record of the Doc was made under this writer's counter. -/
def Fresh (w c : Nat) (s0 : List (Record Val)) : Prop := ∀ r0 ∈ s0, ¬(r0.id.writer = w ∧ r0.id.counter = c)

theorem within_step (eq : Val → Val → Bool) (ofId : NewId → Val) (w c i : Nat) (fp : List Step)
    (s0 s s1 : List (Record Val)) (hfresh : Fresh w c s0) (op : Op Val) (hop : op.step ∈ fp) (h : Within eq fp s0 s)
    (hs : step eq ofId w c i s op = .ok s1) : Within eq fp s0 s1 := by
  cases op with
  | put ty fs =>
    simp only [step, Except.ok.injEq] at hs
    subst hs
    constructor
    · intro r hr
      rcases List.mem_append.mp hr with hr | hr
      · exact h.now r hr
      · simp only [List.mem_singleton] at hr
        subst hr
        refine .inr ⟨⟨_, hop, rfl, rfl⟩, fun f hsome => ⟨_, hop, rfl, ?_⟩, fun r0 hr0 e => hfresh r0 hr0 ?_⟩
        · have := lookup_isSome_mem _ f hsome
          simpa [Op.step, List.map_map, Function.comp_def] using this
        · simp [e]
    · intro r0 hr0
      rcases h.before r0 hr0 with ⟨r, hr, hid⟩ | hrm
      · exact .inl ⟨r, List.mem_append_left _ hr, hid⟩
      · exact .inr hrm
  | patch ty wh set =>
    simp only [step, Except.ok.injEq] at hs
    subst hs
    exact within_map eq fp s0 s h _ ty (fun r hr => found_type hr) set
      (fun f hf => ⟨_, hop, rfl, by simpa [Op.step] using hf⟩)
  | remove ty wh =>
    simp only [step, Except.ok.injEq] at hs
    subst hs
    constructor
    · intro r hr
      exact h.now r (List.mem_filter.mp hr).1
    · intro r0 hr0
      rcases h.before r0 hr0 with ⟨r, hr, hid, hty⟩ | hrm
      · by_cases hf : found eq ty wh r = true
        · refine .inr ⟨_, hop, ?_, rfl⟩
          simp only [Op.step]
          rw [← hty, found_type hf]
        · exact .inl ⟨r, List.mem_filter.mpr ⟨hr, by simpa using hf⟩, hid, hty⟩
      · exact .inr hrm
  | edit ty id f v =>
    simp only [step] at hs
    split at hs
    · simp only [Except.ok.injEq] at hs
      subst hs
      exact within_map eq fp s0 s h _ ty (fun r hr => edits_type hr) [(f, v)]
        (fun g hg => ⟨_, hop, rfl, by simpa [Op.step] using hg⟩)
    · cases hs

theorem within_steps (eq : Val → Val → Bool) (ofId : NewId → Val) (w c : Nat) (fp : List Step)
    (s0 : List (Record Val)) (hfresh : Fresh w c s0) :
    ∀ (ops : List (Op Val)) (i : Nat) (s s' : List (Record Val)), (∀ op ∈ ops, op.step ∈ fp) → Within eq fp s0 s →
      stepsFrom eq ofId w c i s ops = .ok s' → Within eq fp s0 s'
  | [], _, s, s', _, h, hs => by
    simp only [stepsFrom, Except.ok.injEq] at hs
    subst hs; exact h
  | op :: ops, i, s, s', hfp, h, hs => by
    simp only [stepsFrom] at hs
    cases h1 : step eq ofId w c i s op with
    | error e => rw [h1] at hs; cases hs
    | ok s1 =>
      rw [h1] at hs
      exact within_steps eq ofId w c fp s0 hfresh ops (i + 1) s1 s'
        (fun o ho => hfp o (List.mem_cons_of_mem _ ho))
        (within_step eq ofId w c i fp s0 s s1 hfresh op (hfp op List.mem_cons_self) h h1) hs

theorem within_check (eq : Val → Val → Bool) (fp : List Step) (s s' : List (Record Val)) (h : Within eq fp s s') :
    diffWithin eq fp s s' = true := by
  have wr : ∀ ty f, Writes fp ty f → (fieldsOf fp ty).contains f = true := by
    rintro ty f ⟨st, hst, hty, hf⟩
    simp only [fieldsOf, List.contains_iff_mem, List.mem_flatMap, List.mem_filter, beq_iff_eq]
    exact ⟨st, ⟨hst, hty⟩, hf⟩
  simp only [diffWithin, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, List.any_eq_true]
  constructor
  · intro r hr
    rcases h.now r hr with ⟨r0, hr0, hid, hty, hf⟩ | ⟨⟨st, hst, hty, hv⟩, hf⟩
    · refine .inl ⟨r0, hr0, ?_⟩
      simp only [changedOk, Bool.and_eq_true, beq_iff_eq, List.all_eq_true, Bool.or_eq_true]
      refine ⟨⟨hid, hty⟩, fun f _ => ?_⟩
      cases ho : optEq eq (get r0.fields f) (get r.fields f)
      · exact .inr (wr _ _ (hf f ho))
      · exact .inl rfl
    · refine .inr ?_
      simp only [newOk, hasVerb, Bool.and_eq_true, List.any_eq_true, beq_iff_eq, List.all_eq_true,
        Bool.not_eq_true', List.any_eq_false]
      exact ⟨⟨⟨st, hst, hty, hv⟩, fun ⟨f, x⟩ hx => wr _ _ (hf.1 f (lookup_of_mem _ f x hx))⟩, hf.2⟩
  · intro r0 hr0
    rcases h.before r0 hr0 with ⟨r, hr, hid, hty⟩ | ⟨st, hst, hty, hv⟩
    · exact .inl ⟨r, hr, by simp [hid, hty]⟩
    · refine .inr ?_
      simp only [hasVerb, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]
      exact ⟨st, hst, hty, hv⟩

/-- **A commit that ran as its ops say, under a fresh counter, passes every reader's check of its diff.** -/
theorem commit_within (eq : Val → Val → Bool) (heq : ∀ x, eq x x = true) (ofId : NewId → Val) (w c : Nat)
    (s s' : List (Record Val)) (ops : List (Op Val)) (hfresh : Fresh w c s) (h : commit eq ofId w c s ops = .ok s') :
    diffWithin eq (footprint ops) s s' = true := by
  simp only [commit] at h
  split at h
  · exact within_check eq _ s s' (within_steps eq ofId w c (footprint ops) s hfresh ops 0 s s'
      (fun op hop => List.mem_map.mpr ⟨op, hop, rfl⟩) (within_refl eq heq _ s) h)
  · cases h

/-- **An honest writer is accepted by every reader:** its commit ran as its ops say, under a fresh counter. -/
theorem honest_passes (eq : Val → Val → Bool) (heq : ∀ x, eq x x = true) (ofId : NewId → Val) (w c : Nat)
    (s s' : List (Record Val)) (ops : List (Op Val)) (hfresh : Fresh w c s) (h : commit eq ofId w c s ops = .ok s') :
    check eq ops s s' = true :=
  commit_within eq heq ofId w c s s' ops hfresh h

end Aven.DB.Engine
