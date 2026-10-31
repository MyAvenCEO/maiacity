import Aven.DB.Engine.Footprint
import Aven.DB.Docs.Changes

/-!
# The footprint over what an envelope does (architecture, rule 4: one reader verdict)

Every reader's verdict on an envelope is one conjunction: its signature, its chain of caps, its footprint and its fit
(`Aven.Architecture`). The footprint and fit parts read one view of the envelope, `Aven.DB.Docs.RecordChange`: one
entry per Record it touches, with the Record's id as bytes, its type id, whether it is new, edited or gone, and the new
value of each field it writes.

- `changesFrom` is that view as a reader computes it from a Doc's Records before and after. An engine Record's id is a
  `NewId`, one way to mint a Record id as bytes (`NewId.bytes`).
- `footprintOk` is the footprint part over it: a new Record's type has a `put-new` step and its fields are fields the
  footprint writes; an edited Record changed only such fields; a gone Record's type has a `remove` step.

What it proves:
- `diff_footprint`: a diff that passes `diffWithin` passes `footprintOk` on `changesFrom`, on a Doc whose Records have
  distinct ids;
- `honest_footprint`: so an honest writer's commit, under a fresh counter (`Fresh`), passes the verdict's footprint part
  (`verdictFootprint`), which also refuses a Record that changes its type (`typesKept`, `commit_types_kept`);
- `footprint_steps`: what passes it is made by the footprint's steps, change by change. The footprint is the lowering of
  the ops the envelope calls; whether its caps let it call them is caps' part (`Aven.ID.Authorized`, A32).

With the docs layer's `ChangesAreDiff`, what an envelope says it does is `changesFrom` as a set, and these hold of it.
-/

namespace Aven.DB.Engine

open Aven.Core Aven.DB.Docs

/-- A minted Record id as bytes: the encoding of (writer, counter, index). -/
def NewId.bytes (i : NewId) : Bytes := encode (.array [.uint i.writer, .uint i.counter, .uint i.index])

/-- Equality of Values, as the engine compares them. -/
def valEq (a b : Value) : Bool := decide (a = b)

theorem valEq_refl (x : Value) : valEq x x = true := by simp [valEq]

/-- The fields an edit writes: those whose value differs, with their new values, then those it removes, with none. -/
def editedFields (r0 r : Record Value) : List (Bytes × Option Value) :=
  (r.fields.filter fun (f, _) => !optEq valEq (get r0.fields f) (get r.fields f)).map (fun (f, v) => (f, some v)) ++
  (r0.fields.filter fun (f, _) => (get r.fields f).isNone).map fun (f, _) => (f, none)

/-- One Record as an edit, given its type id. -/
def edited (ver : DocId → Version) (r0 r : Record Value) : RecordChange :=
  ⟨r.id.bytes, ver r.type, .edited, editedFields r0 r⟩

/-- What a reader sees of one Record after: new, edited, or nothing when no field of it changed. A Record's type is fixed
at birth (docs, "A Doc"); the verdict refuses a change of it (`typesKept`), so the change view never shows one. -/
def changeOf (ver : DocId → Version) (s : List (Record Value)) (r : Record Value) : Option RecordChange :=
  match s.find? (·.id == r.id) with
  | none => some ⟨r.id.bytes, ver r.type, .new, r.fields.map fun (f, v) => (f, some v)⟩
  | some r0 => if (edited ver r0 r).fields.isEmpty then none else some (edited ver r0 r)

/-- The changes a reader sees from a Doc's Records before to after. `ver` gives the type id each type Doc is written
under. -/
def changesFrom (ver : DocId → Version) (s s' : List (Record Value)) : List RecordChange :=
  s'.filterMap (changeOf ver s) ++
  (s.filter fun r0 => !s'.any (·.id == r0.id)).map fun r0 => ⟨r0.id.bytes, ver r0.type, .gone, []⟩

/-- The footprint part of the verdict: every change is one the footprint makes. -/
def footprintOk (fp : List Step) (cs : List RecordChange) : Bool :=
  cs.all fun c => match c.kind with
    | .new => hasVerb fp c.type.type .putNew && c.names.all (fieldsOf fp c.type.type).contains
    | .edited => c.names.all (fieldsOf fp c.type.type).contains
    | .gone => hasVerb fp c.type.type .remove

/-- Every Record after that has an id from before keeps its type: a Record's type is fixed at birth (docs, "A Doc"). -/
def typesKept (s s' : List (Record Value)) : Bool :=
  s'.all fun r => s.all fun r0 => r0.id != r.id || r0.type == r.type

/-- The verdict's footprint part for a commit from Records `s` to `s'`: no Record changes its type, and the changes stay
within the footprint of the ops it calls. -/
def verdictFootprint (ver : DocId → Version) (fp : List Step) (s s' : List (Record Value)) : Bool :=
  typesKept s s' && footprintOk fp (changesFrom ver s s')

theorem verdictFootprint_iff {ver : DocId → Version} {fp : List Step} {s s' : List (Record Value)} :
    verdictFootprint ver fp s s' = true ↔ typesKept s s' = true ∧ footprintOk fp (changesFrom ver s s') = true := by
  simp [verdictFootprint]

/-- Under `typesKept`, a Record with an id from before has the type it had. -/
theorem typesKept_type {s s' : List (Record Value)} (h : typesKept s s' = true) {r0 r : Record Value} (h0 : r0 ∈ s)
    (hr : r ∈ s') (hid : r0.id = r.id) : r0.type = r.type := by
  simp only [typesKept, List.all_eq_true, Bool.or_eq_true, bne_iff_ne, ne_eq, beq_iff_eq] at h
  rcases h r hr r0 h0 with h | h
  · exact absurd hid h
  · exact h

/-- **An edited change names at least one field:** the change view leaves a Record none of whose fields changed out. -/
theorem changesFrom_edited_names {ver : DocId → Version} {s s' : List (Record Value)} {ch : RecordChange}
    (m : ch ∈ changesFrom ver s s') (k : ch.kind = .edited) : ch.names ≠ [] := by
  simp only [changesFrom, List.mem_append, List.mem_filterMap, List.mem_map, List.mem_filter] at m
  rcases m with ⟨r, _, hc⟩ | ⟨r0, _, rfl⟩
  · unfold changeOf at hc
    split at hc
    · simp only [Option.some.injEq] at hc; subst hc; cases k
    · split at hc
      · cases hc
      · next hne =>
        simp only [Option.some.injEq] at hc; subst hc
        simpa [RecordChange.names, List.isEmpty_iff] using hne
  · cases k

theorem find_id {s : List (Record Value)} (hn : (s.map (·.id)).Nodup) {r0 r : Record Value} (h0 : r0 ∈ s)
    (hid : r0.id = r.id) : s.find? (·.id == r.id) = some r0 := by
  induction s with
  | nil => simp at h0
  | cons a s ih =>
    have ⟨ha, hs⟩ := List.nodup_cons.mp hn
    simp only [List.find?_cons]
    cases List.mem_cons.mp h0 with
    | inl e => subst e; simp [hid]
    | inr e =>
      have : (a.id == r.id) = false := by
        simp only [beq_eq_false_iff_ne]
        intro hx
        exact ha (by show a.id ∈ s.map (·.id); rw [hx, ← hid]; exact List.mem_map_of_mem e)
      simp only [this]
      exact ih hs e

/-- Every field an edit writes is one of the Record's, before or after, whose value it changed or removed. -/
theorem editedFields_names {r0 r : Record Value} {f : Bytes} (h : f ∈ (editedFields r0 r).map Prod.fst) :
    f ∈ r0.fields.map (·.1) ++ r.fields.map (·.1) ∧ optEq valEq (get r0.fields f) (get r.fields f) = false := by
  simp only [editedFields, List.map_append, List.map_map, List.mem_append, List.mem_map, List.mem_filter,
    Function.comp_def] at h
  rcases h with ⟨⟨g, v⟩, ⟨hg, hne⟩, rfl⟩ | ⟨⟨g, v⟩, ⟨hg, hnone⟩, rfl⟩
  · exact ⟨List.mem_append_right _ (List.mem_map_of_mem (f := (·.1)) hg), by simpa using hne⟩
  · refine ⟨List.mem_append_left _ (List.mem_map_of_mem (f := (·.1)) hg), ?_⟩
    have hs : (get r0.fields g).isSome = true := lookup_of_mem _ g v hg
    simp only [Option.isNone_iff_eq_none] at hnone
    cases h0 : get r0.fields g with
    | none => rw [h0] at hs; cases hs
    | some x => simp [optEq, hnone]

/-- A field the Record has after with a changed value is one an edit writes. -/
theorem mem_editedFields_of_ne {r0 r : Record Value} {f : Bytes} {v : Value} (hfv : (f, v) ∈ r.fields)
    (hne : optEq valEq (get r0.fields f) (get r.fields f) = false) : f ∈ (editedFields r0 r).map Prod.fst := by
  simp only [editedFields, List.map_append, List.mem_append, List.map_map, List.mem_map, List.mem_filter,
    Function.comp_def]
  exact .inl ⟨(f, v), ⟨hfv, by simp [hne]⟩, rfl⟩

/-- A field the Record had and no longer has is one an edit writes. -/
theorem mem_editedFields_of_removed {r0 r : Record Value} {f : Bytes} (hf : f ∈ r0.fields.map Prod.fst)
    (hnone : get r.fields f = none) : f ∈ (editedFields r0 r).map Prod.fst := by
  obtain ⟨⟨g, v⟩, hg, rfl⟩ := List.mem_map.mp hf
  simp only [editedFields, List.map_append, List.mem_append, List.map_map, List.mem_map, List.mem_filter,
    Function.comp_def]
  exact .inr ⟨(g, v), ⟨hg, by simp [hnone]⟩, rfl⟩

/-- **A diff within the footprint passes the verdict's footprint part,** on a Doc whose Records have distinct ids. -/
theorem diff_footprint (ver : DocId → Version) (hver : ∀ t, (ver t).type = t) (fp : List Step)
    (s s' : List (Record Value)) (hn : (s.map (·.id)).Nodup) (h : diffWithin valEq fp s s' = true) :
    footprintOk fp (changesFrom ver s s') = true := by
  have wr : ∀ ty f, Writes fp ty f → (fieldsOf fp ty).contains f = true := by
    rintro ty f ⟨st, hst, hty, hf⟩
    simp only [fieldsOf, List.contains_iff_mem, List.mem_flatMap, List.mem_filter, beq_iff_eq]
    exact ⟨st, ⟨hst, hty⟩, hf⟩
  simp only [diffWithin, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, List.any_eq_true] at h
  obtain ⟨hnow, hbefore⟩ := h
  simp only [footprintOk, changesFrom, List.all_eq_true, List.mem_append, List.mem_filterMap, List.mem_map,
    List.mem_filter]
  rintro c (⟨r, hr, hc⟩ | ⟨r0, ⟨hr0, hgone⟩, rfl⟩)
  · rcases hnow r hr with ⟨r0, hr0, hok⟩ | ⟨hnew, hfresh⟩
    · -- an earlier Record with r's id: an edit, of fields the footprint writes
      simp only [changedOk, Bool.and_eq_true, beq_iff_eq, List.all_eq_true, Bool.or_eq_true] at hok
      obtain ⟨⟨hid, _⟩, hf⟩ := hok
      simp only [changeOf, find_id hn hr0 hid] at hc
      split at hc
      · cases hc
      · simp only [Option.some.injEq] at hc
        subst hc
        simp only [edited, RecordChange.names, hver, List.all_eq_true]
        intro f hf'
        obtain ⟨hmem, hne⟩ := editedFields_names hf'
        rcases hf f hmem with h | h
        · rw [hne] at h; cases h
        · exact h
    · -- no earlier Record with r's id: new, with fields the footprint writes
      simp only [newOk, Bool.and_eq_true, List.all_eq_true] at hnew
      obtain ⟨hv, hf⟩ := hnew
      have hfind : s.find? (·.id == r.id) = none := by
        rw [List.find?_eq_none]
        intro r0 hr0 e
        simp only [Bool.not_eq_true', List.any_eq_false] at hfresh
        exact hfresh r0 hr0 e
      simp only [changeOf, hfind, Option.some.injEq] at hc
      subst hc
      simp only [hver, hv, Bool.true_and, RecordChange.names, List.all_eq_true, List.map_map, List.mem_map,
        Function.comp_def]
      rintro f ⟨⟨f', v⟩, hfv, rfl⟩
      exact hf (f', v) hfv
  · rcases hbefore r0 hr0 with ⟨r, hr, hid⟩ | hrm
    · exfalso
      simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at hgone
      exact hgone r hr (by simpa using hid.1)
    · simpa [hver] using hrm

/-! ## An honest commit keeps every Record's type -/

/-- Every Record of `cur` whose id is one of `s`'s has the type it had in `s`. -/
def KeepsTypes (s cur : List (Record Value)) : Prop := ∀ r ∈ cur, ∀ r0 ∈ s, r0.id = r.id → r0.type = r.type

theorem keepsTypes_refl {s : List (Record Value)} (hn : (s.map (·.id)).Nodup) : KeepsTypes s s := by
  intro r hr r0 h0 hid
  rw [show r0 = r from Option.some.inj ((find_id hn h0 hid).symm.trans (find_id hn hr rfl))]

theorem keepsTypes_map {s cur : List (Record Value)} (h : KeepsTypes s cur) (p : Record Value → Bool)
    (set : List (Bytes × Value)) :
    KeepsTypes s (cur.map fun r => if p r then { r with fields := setFields r.fields set } else r) := by
  intro r hr r0 h0 hid
  obtain ⟨r1, h1, rfl⟩ := List.mem_map.mp hr
  by_cases hp : p r1 = true
  · simp only [hp, ite_true] at hid ⊢; exact h r1 h1 r0 h0 hid
  · simp only [hp] at hid ⊢; exact h r1 h1 r0 h0 hid

theorem steps_keep_types (ofId : NewId → Value) (w c : Nat) (s : List (Record Value)) (fresh : Fresh w c s) :
    ∀ (ops : List (Op Value)) (i : Nat) (cur s' : List (Record Value)), KeepsTypes s cur →
      stepsFrom valEq ofId w c i cur ops = .ok s' → KeepsTypes s s'
  | [], _, cur, s', h, hs => by
    simp only [stepsFrom, Except.ok.injEq] at hs; subst hs; exact h
  | op :: ops, i, cur, s', h, hs => by
    simp only [stepsFrom] at hs
    cases h1 : step valEq ofId w c i cur op with
    | error e => rw [h1] at hs; cases hs
    | ok s1 =>
      rw [h1] at hs
      refine steps_keep_types ofId w c s fresh ops (i + 1) s1 s' ?_ hs
      cases op with
      | put ty fs =>
        simp only [step, Except.ok.injEq] at h1; subst h1
        intro r hr r0 h0 hid
        rcases List.mem_append.mp hr with hr | hr
        · exact h r hr r0 h0 hid
        · simp only [List.mem_singleton] at hr; subst hr
          exact absurd ⟨by rw [hid], by rw [hid]⟩ (fresh r0 h0)
      | patch ty wh set =>
        simp only [step, Except.ok.injEq] at h1; subst h1
        exact keepsTypes_map h _ set
      | remove ty wh =>
        simp only [step, Except.ok.injEq] at h1; subst h1
        exact fun r hr => h r (List.mem_filter.mp hr).1
      | edit ty id f v =>
        simp only [step] at h1
        split at h1
        · simp only [Except.ok.injEq] at h1; subst h1
          exact keepsTypes_map h _ [(f, v)]
        · cases h1

/-- **An honest commit keeps every Record's type,** on a Doc whose Records have distinct ids, under a fresh counter. -/
theorem commit_types_kept (ofId : NewId → Value) (w c : Nat) (s s' : List (Record Value)) (ops : List (Op Value))
    (hn : (s.map (·.id)).Nodup) (fresh : Fresh w c s) (h : commit valEq ofId w c s ops = .ok s') :
    typesKept s s' = true := by
  simp only [commit] at h
  split at h
  · have k := steps_keep_types ofId w c s fresh ops 0 s s' (keepsTypes_refl hn) h
    simp only [typesKept, List.all_eq_true, Bool.or_eq_true, bne_iff_ne, ne_eq, beq_iff_eq]
    intro r hr r0 h0
    by_cases hid : r0.id = r.id
    · exact .inr (k r hr r0 h0 hid)
    · exact .inl hid
  · cases h

/-- **An honest writer passes the verdict's footprint part:** its commit ran as its ops say, on a Doc whose Records
have distinct ids, under a fresh counter (`Fresh`, the engine's one statement of it). -/
theorem honest_footprint (ver : DocId → Version) (hver : ∀ t, (ver t).type = t) (ofId : NewId → Value) (w c : Nat)
    (s s' : List (Record Value)) (ops : List (Op Value)) (hn : (s.map (·.id)).Nodup) (fresh : Fresh w c s)
    (h : commit valEq ofId w c s ops = .ok s') :
    verdictFootprint ver (footprint ops) s s' = true :=
  verdictFootprint_iff.mpr ⟨commit_types_kept ofId w c s s' ops hn fresh h,
    diff_footprint ver hver _ s s' hn (commit_within valEq valEq_refl ofId w c s s' ops fresh h)⟩

/-- **What passes is the footprint's:** every change is made by a footprint step: a new Record by a `put-new` of its
type, with each of its fields written by a step of its type; an edit's fields likewise; a gone Record by a `remove` of
its type. -/
theorem footprint_steps (fp : List Step) (cs : List RecordChange) (h : footprintOk fp cs = true) :
    ∀ ch ∈ cs,
      (ch.kind = .new → ∃ st ∈ fp, st.type = ch.type.type ∧ st.verb = .putNew) ∧
      (ch.kind = .gone → ∃ st ∈ fp, st.type = ch.type.type ∧ st.verb = .remove) ∧
      (ch.kind ≠ .gone → ∀ f ∈ ch.names, ∃ st ∈ fp, st.type = ch.type.type ∧ f ∈ st.fields) := by
  intro ch hch
  have := (List.all_eq_true.mp h) ch hch
  have wr : ∀ f, (fieldsOf fp ch.type.type).contains f = true → ∃ st ∈ fp, st.type = ch.type.type ∧ f ∈ st.fields := by
    intro f hf
    simp only [fieldsOf, List.contains_iff_mem, List.mem_flatMap, List.mem_filter, beq_iff_eq] at hf
    obtain ⟨st, ⟨hst, hty⟩, hm⟩ := hf
    exact ⟨st, hst, hty, hm⟩
  have hv : ∀ v, hasVerb fp ch.type.type v = true → ∃ st ∈ fp, st.type = ch.type.type ∧ st.verb = v := by
    intro v hv
    simp only [hasVerb, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at hv
    exact hv
  cases hk : ch.kind <;> rw [hk] at this <;> simp only [Bool.and_eq_true, List.all_eq_true] at this
  · exact ⟨fun _ => hv _ this.1, (fun h => nomatch h), fun _ f hf' => wr f (this.2 f hf')⟩
  · exact ⟨(fun h => nomatch h), (fun h => nomatch h), fun _ f hf' => wr f (this f hf')⟩
  · exact ⟨(fun h => nomatch h), (fun _ => hv _ this), fun h => absurd rfl h⟩

/-! ## A merge into main is judged on the whole merge -/

/-- **Every Record a merge changes on main is made by the footprint's steps** (`merge_steps`; caps, "Checking"). A
merge into main is judged on `changesFrom ver main merged`: main's Records before the merge (the version its `prev`
alone names) against the merged Records, not on the commit that settles conflicts, whose changes are only the fixes.
`fp` is the lowering of every call the merge brings onto main, which caps' part checks the merger may call
(`Aven.ID.merge_covered`). When the verdict passes, every Record of main the merge changes or removes, and every Record
it brings, is made by those steps, field by field. The same holds of any before and after; a merge only chooses which
before. -/
theorem merge_steps (ver : DocId → Version) (hver : ∀ t, (ver t).type = t) (fp : List Step)
    (main merged : List (Record Value)) (hn : (main.map (·.id)).Nodup)
    (h : verdictFootprint ver fp main merged = true) :
    -- a Record main had, changed: every field whose value differs is written by a step of its type
    (∀ r ∈ merged, ∀ r0 ∈ main, r0.id = r.id → ∀ f v, (f, v) ∈ r.fields →
      optEq valEq (get r0.fields f) (get r.fields f) = false →
        ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields) ∧
    -- a Record main had, a field removed: written by a step of its type too
    (∀ r ∈ merged, ∀ r0 ∈ main, r0.id = r.id → ∀ f ∈ r0.fields.map Prod.fst, get r.fields f = none →
        ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields) ∧
    -- a Record the merge brings: its type is created, and every field it carries is written by a step of its type
    (∀ r ∈ merged, (∀ r0 ∈ main, r0.id ≠ r.id) →
      (∃ st ∈ fp, st.type = r.type ∧ st.verb = .putNew) ∧
      ∀ f ∈ r.fields.map Prod.fst, ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields) ∧
    -- a Record of main the merge removes: its type is removed
    (∀ r0 ∈ main, (∀ r ∈ merged, r.id ≠ r0.id) → ∃ st ∈ fp, st.type = r0.type ∧ st.verb = .remove) := by
  have hc := footprint_steps fp _ (verdictFootprint_iff.mp h).2
  -- an edit's every field is written by a step of its type
  have hedit : ∀ r ∈ merged, ∀ r0 ∈ main, r0.id = r.id → ∀ f ∈ (editedFields r0 r).map Prod.fst,
      ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields := by
    intro r hr r0 hr0 hid f hf
    have hmem : edited ver r0 r ∈ changesFrom ver main merged := by
      apply List.mem_append_left
      refine List.mem_filterMap.mpr ⟨r, hr, ?_⟩
      simp only [changeOf, find_id hn hr0 hid]
      split
      · rename_i hempty
        simp only [List.isEmpty_iff] at hempty
        have e : editedFields r0 r = [] := hempty
        rw [e] at hf
        simp at hf
      · rfl
    have ⟨_, _, hw⟩ := hc _ hmem
    simpa [edited, hver] using hw (by simp [edited]) f (by simpa [RecordChange.names, edited] using hf)
  refine ⟨?_, ?_, ?_, ?_⟩
  · intro r hr r0 hr0 hid f v hfv hne
    exact hedit r hr r0 hr0 hid f (mem_editedFields_of_ne hfv hne)
  · intro r hr r0 hr0 hid f hf hnone
    exact hedit r hr r0 hr0 hid f (mem_editedFields_of_removed hf hnone)
  · intro r hr hnone
    have hfind : main.find? (·.id == r.id) = none := by
      rw [List.find?_eq_none]
      intro r0 hr0
      simpa using hnone r0 hr0
    have hmem : (⟨r.id.bytes, ver r.type, .new, r.fields.map fun (f, v) => (f, some v)⟩ : RecordChange) ∈
        changesFrom ver main merged := by
      apply List.mem_append_left
      exact List.mem_filterMap.mpr ⟨r, hr, by simp [changeOf, hfind]⟩
    have ⟨hnew, _, hf⟩ := hc _ hmem
    refine ⟨by simpa [hver] using hnew rfl, fun f hf' => ?_⟩
    simpa [hver] using hf (by simp) f (by simpa [RecordChange.names, List.map_map, Function.comp_def] using hf')
  · intro r0 hr0 hgone
    have hmem : (⟨r0.id.bytes, ver r0.type, .gone, []⟩ : RecordChange) ∈ changesFrom ver main merged := by
      apply List.mem_append_right
      refine List.mem_map.mpr ⟨r0, List.mem_filter.mpr ⟨hr0, ?_⟩, rfl⟩
      simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq]
      intro r hr e
      exact hgone r hr e
    have ⟨_, hrm, _⟩ := hc _ hmem
    simpa [hver] using hrm rfl

/-! ## A Record's id as a key -/

/-- One hex digit, lowercase. -/
def keyDigit (n : Nat) : Char := if n < 10 then Char.ofNat (48 + n) else Char.ofNat (87 + n)

/-- A hex digit's value: `0`–`9` and `a`–`f` only. -/
def keyDigitValue (c : Char) : Option Nat :=
  if 48 ≤ c.toNat ∧ c.toNat ≤ 57 then some (c.toNat - 48)
  else if 97 ≤ c.toNat ∧ c.toNat ≤ 102 then some (c.toNat - 87)
  else none

def keyChars : Bytes → List Char
  | [] => []
  | b :: bs => keyDigit (b.toNat / 16) :: keyDigit (b.toNat % 16) :: keyChars bs

def keyBytes? : List Char → Option Bytes
  | [] => some []
  | a :: b :: rest => do
    let x ← keyDigitValue a
    let y ← keyDigitValue b
    pure ((16 * x + y).toUInt8 :: (← keyBytes? rest))
  | [_] => none

/-- **A Record's id as a key:** the lowercase hex of its bytes, the key the docs layer writes it under in a Doc's
`records` map (Loro's map keys are text). One encoding: it reads back (`idOfKey_idKey`), so two ids have two keys
(`idKey_inj`), and a reader refuses a key that isn't lowercase hex of whole bytes. -/
def idKey (id : Bytes) : String := String.ofList (keyChars id)

def idOfKey? (key : String) : Option Bytes := keyBytes? key.toList

theorem keyDigitValue_keyDigit : ∀ n, n < 16 → keyDigitValue (keyDigit n) = some n := by
  decide

theorem keyBytes_keyChars : ∀ bs : Bytes, keyBytes? (keyChars bs) = some bs
  | [] => rfl
  | b :: bs => by
    have h1 := keyDigitValue_keyDigit (b.toNat / 16) (by have := b.toNat_lt; omega)
    have h2 := keyDigitValue_keyDigit (b.toNat % 16) (Nat.mod_lt _ (by decide))
    simp only [keyChars, keyBytes?, h1, h2, keyBytes_keyChars bs, Option.bind_eq_bind, Option.bind_some,
      Option.pure_def, Option.some.injEq, List.cons.injEq, and_true]
    rw [Nat.div_add_mod]
    exact UInt8.ofNat_toNat

theorem idOfKey_idKey (id : Bytes) : idOfKey? (idKey id) = some id := by
  simp [idOfKey?, idKey, keyBytes_keyChars]

theorem idKey_inj {a b : Bytes} (h : idKey a = idKey b) : a = b := by
  have := idOfKey_idKey a
  rw [h, idOfKey_idKey b] at this
  exact (Option.some.inj this).symm

-- the key is the hex every vector writes
#guard idKey [0x00, 0x0f, 0xa5, 0xff] = "000fa5ff"
#guard idOfKey? "000FA5FF" = none
#guard idOfKey? "abc" = none

end Aven.DB.Engine
