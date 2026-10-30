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
- `honest_footprint`: so an honest writer's commit, its grants covering its footprint, passes the verdict's footprint
  part (`verdictFootprint`);
- `footprint_granted`: what passes it is granted, change by change.

With the docs layer's `ChangesAreDiff`, what an envelope says it does is `changesFrom` as a set, and these hold of it.
-/

namespace Aven.DB.Engine

open Aven.Core Aven.DB.Docs

/-- A minted Record id as bytes: the encoding of (writer, counter, index). -/
def NewId.bytes (i : NewId) : Bytes := encode (.array [.uint i.writer, .uint i.counter, .uint i.index])

/-- Equality of Values, as the engine compares them. -/
def valEq (a b : Value) : Bool := decide (a = b)

theorem valEq_refl (x : Value) : valEq x x = true := by simp [valEq]

/-- One Record as a change, given its type id. -/
def edited (ver : DocId → TypeId) (r0 r : Record Value) : RecordChange :=
  ⟨r.id.bytes, ver r.type, .edited, r.fields.filter fun (f, _) => !optEq valEq (get r0.fields f) (get r.fields f)⟩

/-- What a reader sees of one Record after: new, edited, or nothing when it is as it was. -/
def changeOf (ver : DocId → TypeId) (s : List (Record Value)) (r : Record Value) : Option RecordChange :=
  match s.find? (·.id == r.id) with
  | none => some ⟨r.id.bytes, ver r.type, .new, r.fields⟩
  | some r0 => if (edited ver r0 r).fields.isEmpty && r0.type == r.type then none else some (edited ver r0 r)

/-- The changes a reader sees from a Doc's Records before to after. `ver` gives the type id each type Doc is written
under. -/
def changesFrom (ver : DocId → TypeId) (s s' : List (Record Value)) : List RecordChange :=
  s'.filterMap (changeOf ver s) ++
  (s.filter fun r0 => !s'.any (·.id == r0.id)).map fun r0 => ⟨r0.id.bytes, ver r0.type, .gone, []⟩

/-- The footprint part of the verdict: every change is one the footprint makes. -/
def footprintOk (fp : List Step) (cs : List RecordChange) : Bool :=
  cs.all fun c => match c.kind with
    | .new => hasVerb fp c.type.type .putNew && c.names.all (fieldsOf fp c.type.type).contains
    | .edited => c.names.all (fieldsOf fp c.type.type).contains
    | .gone => hasVerb fp c.type.type .remove

/-- The verdict's footprint part for a commit: the grants cover the footprint, and the changes stay within it. -/
def verdictFootprint (grants : List Grant) (fp : List Step) (cs : List RecordChange) : Bool :=
  covers grants fp && footprintOk fp cs

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

/-- **A diff within the footprint passes the verdict's footprint part,** on a Doc whose Records have distinct ids. -/
theorem diff_footprint (ver : DocId → TypeId) (hver : ∀ t, (ver t).type = t) (fp : List Step)
    (s s' : List (Record Value)) (hn : (s.map (·.id)).Nodup) (h : diffWithin valEq fp s s' = true) :
    footprintOk fp (changesFrom ver s s') = true := by
  simp only [diffWithin, Bool.and_eq_true, List.all_eq_true, Bool.or_eq_true, List.any_eq_true] at h
  obtain ⟨hnow, hbefore⟩ := h
  simp only [footprintOk, changesFrom, List.all_eq_true, List.mem_append, List.mem_filterMap, List.mem_map,
    List.mem_filter]
  rintro c (⟨r, hr, hc⟩ | ⟨r0, ⟨hr0, hgone⟩, rfl⟩)
  · -- an edited Record, as its fields say
    have hedit : ∀ r0, (edited ver r0 r).names.all (fieldsOf fp (edited ver r0 r).type.type).contains = true →
        c = edited ver r0 r → (match c.kind with
          | .new => hasVerb fp c.type.type .putNew && c.names.all (fieldsOf fp c.type.type).contains
          | .edited => c.names.all (fieldsOf fp c.type.type).contains
          | .gone => hasVerb fp c.type.type .remove) = true := by
      rintro r0 h rfl; simpa [edited] using h
    unfold changeOf at hc
    rcases hnow r hr with ⟨r0, hr0, hok⟩ | hnew
    · -- an earlier Record with r's id: edited
      simp only [changedOk, Bool.and_eq_true, beq_iff_eq, List.all_eq_true, Bool.or_eq_true] at hok
      obtain ⟨⟨hid, hty⟩, hf⟩ := hok
      rw [find_id hn hr0 hid] at hc
      simp only at hc
      split at hc
      · cases hc
      · simp only [Option.some.injEq] at hc
        refine hedit r0 ?_ hc.symm
        simp only [edited, RecordChange.names, hver, List.all_eq_true, List.mem_map, List.mem_filter,
          List.contains_iff_mem]
        rintro f ⟨⟨f', v⟩, ⟨hfv, hne⟩, rfl⟩
        have := hf f' (List.mem_append_right _ (List.mem_map_of_mem (f := (·.1)) hfv))
        rcases this with h | h
        · simp [h] at hne
        · exact List.contains_iff_mem.mp h
    · simp only [newOk, Bool.and_eq_true, List.all_eq_true] at hnew
      obtain ⟨hv, hf⟩ := hnew
      cases hfind : s.find? (·.id == r.id) with
      | none =>
        rw [hfind] at hc
        simp only [Option.some.injEq] at hc
        subst hc
        simp only [hver, hv, Bool.true_and, RecordChange.names, List.all_eq_true, List.mem_map]
        rintro f ⟨⟨f', v⟩, hfv, rfl⟩
        exact hf (f', v) hfv
      | some r0 =>
        rw [hfind] at hc
        simp only at hc
        split at hc
        · cases hc
        · simp only [Option.some.injEq] at hc
          refine hedit r0 ?_ hc.symm
          simp only [edited, RecordChange.names, hver, List.all_eq_true, List.mem_map, List.mem_filter]
          rintro f ⟨⟨f', v⟩, ⟨hfv, _⟩, rfl⟩
          exact hf (f', v) hfv
  · rcases hbefore r0 hr0 with ⟨r, hr, hid⟩ | hrm
    · exfalso
      simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at hgone
      exact hgone r hr (by simpa using hid.1)
    · simpa [hver] using hrm

/-- **An honest writer passes the verdict's footprint part:** its grants cover its footprint and its commit ran as its
ops say, on a Doc whose Records have distinct ids. -/
theorem honest_footprint (ver : DocId → TypeId) (hver : ∀ t, (ver t).type = t) (ofId : NewId → Value) (w c : Nat)
    (grants : List Grant) (s s' : List (Record Value)) (ops : List (Op Value)) (hn : (s.map (·.id)).Nodup)
    (hg : covers grants (footprint ops) = true) (h : commit valEq ofId w c s ops = .ok s') :
    verdictFootprint grants (footprint ops) (changesFrom ver s s') = true := by
  simp only [verdictFootprint, hg, Bool.true_and]
  exact diff_footprint ver hver _ s s' hn (commit_within valEq valEq_refl ofId w c s s' ops h)

/-- **What passes is granted:** every change is made by a footprint step that some grant allows: a new Record by a
`put-new` of its type, with each of its fields written by a step of its type; an edit's fields likewise; a gone Record
by a `remove` of its type. -/
theorem footprint_granted (grants : List Grant) (fp : List Step) (cs : List RecordChange)
    (h : verdictFootprint grants fp cs = true) :
    (∀ st ∈ fp, ∃ g ∈ grants, g.allows st = true) ∧
    ∀ ch ∈ cs,
      (ch.kind = .new → ∃ st ∈ fp, st.type = ch.type.type ∧ st.verb = .putNew) ∧
      (ch.kind = .gone → ∃ st ∈ fp, st.type = ch.type.type ∧ st.verb = .remove) ∧
      (ch.kind ≠ .gone → ∀ f ∈ ch.names, ∃ st ∈ fp, st.type = ch.type.type ∧ f ∈ st.fields) := by
  simp only [verdictFootprint, Bool.and_eq_true] at h
  obtain ⟨hc, hf⟩ := h
  refine ⟨fun st hst => ?_, fun ch hch => ?_⟩
  · simp only [covers, List.all_eq_true, List.any_eq_true] at hc
    exact hc st hst
  · have := (List.all_eq_true.mp hf) ch hch
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

/-- **Every Record a merge changes on main is granted** (`merge_granted`; caps, "Checking"). A merge into main is
judged on `changesFrom ver main merged`: main's Records before the merge (the version its `prev` alone names) against
the merged Records, not on the commit that settles conflicts, whose changes are only the fixes. When that verdict
passes, every Record of main the merge changes or removes, and every Record it brings, is granted, field by field.
The same holds of any before and after; a merge only chooses which before. -/
theorem merge_granted (ver : DocId → TypeId) (hver : ∀ t, (ver t).type = t) (grants : List Grant) (fp : List Step)
    (main merged : List (Record Value)) (hn : (main.map (·.id)).Nodup)
    (h : verdictFootprint grants fp (changesFrom ver main merged) = true) :
    (∀ st ∈ fp, ∃ g ∈ grants, g.allows st = true) ∧
    -- a Record main had, changed: every field whose value differs is written by a step of its type
    (∀ r ∈ merged, ∀ r0 ∈ main, r0.id = r.id → ∀ f v, (f, v) ∈ r.fields →
      optEq valEq (get r0.fields f) (get r.fields f) = false →
        ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields) ∧
    -- a Record the merge brings: its type is created, and every field it carries is written by a step of its type
    (∀ r ∈ merged, (∀ r0 ∈ main, r0.id ≠ r.id) →
      (∃ st ∈ fp, st.type = r.type ∧ st.verb = .putNew) ∧
      ∀ f ∈ r.fields.map Prod.fst, ∃ st ∈ fp, st.type = r.type ∧ f ∈ st.fields) ∧
    -- a Record of main the merge removes: its type is removed
    (∀ r0 ∈ main, (∀ r ∈ merged, r.id ≠ r0.id) → ∃ st ∈ fp, st.type = r0.type ∧ st.verb = .remove) := by
  have ⟨hg, hc⟩ := footprint_granted grants fp _ h
  refine ⟨hg, ?_, ?_, ?_⟩
  · intro r hr r0 hr0 hid f v hfv hne
    have hfind := find_id hn hr0 hid
    -- the change the reader sees for r is an edit naming f
    have hmem : edited ver r0 r ∈ changesFrom ver main merged := by
      apply List.mem_append_left
      refine List.mem_filterMap.mpr ⟨r, hr, ?_⟩
      simp only [changeOf, hfind]
      split
      · rename_i hempty
        simp only [Bool.and_eq_true, List.isEmpty_iff] at hempty
        have : (f, v) ∈ (edited ver r0 r).fields := by
          simp only [edited, List.mem_filter]
          exact ⟨hfv, by simp [hne]⟩
        rw [hempty.1] at this; cases this
      · rfl
    have ⟨_, _, hf⟩ := hc _ hmem
    have := hf (by simp [edited]) f (by
      simp only [RecordChange.names, edited, List.mem_map, List.mem_filter]
      exact ⟨(f, v), ⟨hfv, by simp [hne]⟩, rfl⟩)
    simpa [edited, hver] using this
  · intro r hr hnone
    have hfind : main.find? (·.id == r.id) = none := by
      rw [List.find?_eq_none]
      intro r0 hr0
      simpa using hnone r0 hr0
    have hmem : (⟨r.id.bytes, ver r.type, .new, r.fields⟩ : RecordChange) ∈ changesFrom ver main merged := by
      apply List.mem_append_left
      exact List.mem_filterMap.mpr ⟨r, hr, by simp [changeOf, hfind]⟩
    have ⟨hnew, _, hf⟩ := hc _ hmem
    refine ⟨by simpa [hver] using hnew rfl, fun f hf' => ?_⟩
    simpa [hver] using hf (by simp) f hf'
  · intro r0 hr0 hgone
    have hmem : (⟨r0.id.bytes, ver r0.type, .gone, []⟩ : RecordChange) ∈ changesFrom ver main merged := by
      apply List.mem_append_right
      refine List.mem_map.mpr ⟨r0, List.mem_filter.mpr ⟨hr0, ?_⟩, rfl⟩
      simp only [Bool.not_eq_true', List.any_eq_false, beq_iff_eq]
      intro r hr e
      exact hgone r hr e
    have ⟨_, hrm, _⟩ := hc _ hmem
    simpa [hver] using hrm rfl

end Aven.DB.Engine
