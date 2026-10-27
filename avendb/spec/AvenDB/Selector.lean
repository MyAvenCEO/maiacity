import AvenDB.Basic

/-!
# Selectors: one grammar for what caps, queries, footprints and Interests pick

`doc:docs/avendb` §8 and the one query engine plan (task A1). A selector picks entries of a vault by their labels: what
their first write says of them (their type, the vault that created them, their id, when they were created) and their
tags now. Groups of entries are never named: a slice is whatever a selector picks. Every part of the engine that picks
entries picks by this one type: a share's or a cap's slice (`Rules.lean`), a query's plan (`Ops.lean`, `Where.cover`),
a mutation's footprint (`Mutation.lean`), an actor method's footprint (`Address.lean`) and what a view wants
(`Interest.lean`).

- **Closed under intersection and union.** `both` picks what two selectors both pick and `either` what either picks
  (`both_matches`, `either_matches`), so a cap narrowed by a query, or a footprint narrowed by a cap, is a selector
  again. `both` is commutative and associative in what it picks, and narrows each side (`both_within_left`,
  `both_within_right`).
- **Within, decided.** `fits s t` decides, test by test, that `s` picks no entry `t` doesn't (`fits_sound`): how the
  engine checks that a footprint lies inside a cap without enumerating entries.
- **Its labels part matches blind.** A peer that holds only tokens of labels (`BlindIndex.lean`: a keyed hash per
  audience of `type:<t>` and `tag:<g>`) finds what a selector picks by the labels `blind` names: every entry the
  selector picks carries one of them (`blind_sound`), so a `find` for their tokens misses none (`find_complete`).
- **Bounded.** A peer accepts a selector of at most 8 conjunctions of 16 tests, each listing at most 1,000 ids or
  names, so matching stays linear (`bounded`).

Rust: `avendb::selector`.
-/

namespace AvenDB

/-- What a selector tests of an entry. -/
structure Attrs where
  type    : Sym
  author  : VaultId
  entry   : EntryId
  created : Nat
  tags    : List Sym
  deriving DecidableEq, Repr

/-- One test. `typeIn [t]` is `type == t`. -/
inductive Atom where
  | typeIn     (ts : List Sym)
  | authorIn   (vs : List VaultId)
  | entryIn    (es : List EntryId)
  /-- Created in `[lo, hi)`. -/
  | createdIn  (lo hi : Nat)
  | tagHas     (t : Sym)
  | tagNone    (ts : List Sym)
  | tagsWithin (ts : List Sym)
  deriving DecidableEq, Repr

def Atom.test (a : Attrs) : Atom → Bool
  | .typeIn ts      => ts.contains a.type
  | .authorIn vs    => vs.contains a.author
  | .entryIn es     => es.contains a.entry
  | .createdIn lo hi => decide (lo ≤ a.created) && decide (a.created < hi)
  | .tagHas t       => a.tags.contains t
  | .tagNone ts     => !ts.any a.tags.contains
  | .tagsWithin ts  => a.tags.all ts.contains

/-- The whole vault, or the entries that pass every test of at least one of the conjunctions. The wire shares a selector
    at 8 conjunctions of 16 tests and an `entryIn` at 1,000 ids, so matching stays linear. -/
inductive Selector where
  | all
  | anyOf (ds : List (List Atom))
  deriving DecidableEq, Repr

def Selector.matches (a : Attrs) : Selector → Bool
  | .all      => true
  | .anyOf ds => ds.any fun d => d.all (·.test a)

/-- Entries both selectors pick. -/
def Selector.both : Selector → Selector → Selector
  | .all, s => s
  | .anyOf ds, .all => .anyOf ds
  | .anyOf ds, .anyOf es => .anyOf (ds.flatMap fun d => es.map fun e => d ++ e)

/-- Entries either selector picks. -/
def Selector.either : Selector → Selector → Selector
  | .anyOf ds, .anyOf es => .anyOf (ds ++ es)
  | _, _ => .all

theorem any_and_any {α β : Type} (xs : List α) (ys : List β) (P : α → Bool) (Q : β → Bool) :
    (xs.any fun x => ys.any fun y => P x && Q y) = (xs.any P && ys.any Q) := by
  apply Bool.eq_iff_iff.2
  simp only [List.any_eq_true, Bool.and_eq_true]
  constructor
  · rintro ⟨x, hx, y, hy, px, qy⟩
    exact ⟨⟨x, hx, px⟩, ⟨y, hy, qy⟩⟩
  · rintro ⟨⟨x, hx, px⟩, ⟨y, hy, qy⟩⟩
    exact ⟨x, hx, y, hy, px, qy⟩

theorem both_matches (s t : Selector) (a : Attrs) : (s.both t).matches a = (s.matches a && t.matches a) := by
  cases s with
  | all => simp [Selector.both, Selector.matches]
  | anyOf ds =>
    cases t with
    | all => simp [Selector.both, Selector.matches]
    | anyOf es =>
      simp only [Selector.both, Selector.matches, List.any_flatMap, List.any_map, Function.comp_def,
        List.all_append]
      exact any_and_any ds es _ _

theorem either_matches (s t : Selector) (a : Attrs) : (s.either t).matches a = (s.matches a || t.matches a) := by
  cases s <;> cases t <;> simp [Selector.either, Selector.matches, List.any_append]

/-- The most conjunctions a selector has, the most tests in one, and the most ids or names a test lists. -/
def maxConjunctions : Nat := 8
def maxTests : Nat := 16
def maxIds : Nat := 1000

def Atom.bounded : Atom → Bool
  | .typeIn xs | .authorIn xs | .entryIn xs | .tagNone xs | .tagsWithin xs => decide (xs.length ≤ maxIds)
  | .createdIn _ _ | .tagHas _ => true

/-- Within the bounds a peer accepts of a cap's selector (`selector::Selector::bounded`). -/
def Selector.bounded : Selector → Bool
  | .all => true
  | .anyOf ds => decide (ds.length ≤ maxConjunctions) && ds.all fun d => decide (d.length ≤ maxTests) && d.all Atom.bounded



/-! ## Closure

`both` and `either` are the intersection and the union of what two selectors pick. -/

/-- `s` picks no entry `t` doesn't. -/
def Selector.Within (s t : Selector) : Prop := ∀ a, s.matches a = true → t.matches a = true

theorem both_comm_matches (s t : Selector) (a : Attrs) : (s.both t).matches a = (t.both s).matches a := by
  rw [both_matches, both_matches, Bool.and_comm]

theorem both_assoc_matches (s t u : Selector) (a : Attrs) :
    ((s.both t).both u).matches a = (s.both (t.both u)).matches a := by
  simp only [both_matches, Bool.and_assoc]

theorem both_within_left (s t : Selector) : (s.both t).Within s := by
  intro a h; rw [both_matches] at h; simp only [Bool.and_eq_true] at h; exact h.1

theorem both_within_right (s t : Selector) : (s.both t).Within t := by
  intro a h; rw [both_matches] at h; simp only [Bool.and_eq_true] at h; exact h.2

/-- What is within two selectors is within what both pick. -/
theorem within_both {r s t : Selector} (hs : r.Within s) (ht : r.Within t) : r.Within (s.both t) := by
  intro a h; rw [both_matches, hs a h, ht a h]; rfl

theorem within_trans {r s t : Selector} (h1 : r.Within s) (h2 : s.Within t) : r.Within t :=
  fun a h => h2 a (h1 a h)

theorem within_all (s : Selector) : s.Within .all := fun _ _ => rfl

/-! ## Within, decided -/

/-- A test that passes only where `x` passes: the same test, or one that asks no less of an entry: its types, its
    vaults, its entries or its tags within `x`'s, its time inside `x`'s, or fewer tags it may not carry. -/
def Atom.implies : Atom → Atom → Bool
  | .typeIn ys, .typeIn xs => ys.all xs.contains
  | .authorIn ys, .authorIn xs => ys.all xs.contains
  | .entryIn ys, .entryIn xs => ys.all xs.contains
  | .createdIn lo hi, .createdIn lo' hi' => decide (lo' ≤ lo) && decide (hi ≤ hi')
  | .tagHas t, .tagHas t' => t == t'
  | .tagNone ys, .tagNone xs => xs.all ys.contains
  | .tagsWithin ys, .tagsWithin xs => ys.all xs.contains
  | _, _ => false

theorem Atom.implies_sound (y x : Atom) (a : Attrs) (h : y.implies x = true) (hy : y.test a = true) :
    x.test a = true := by
  cases y <;> cases x <;> simp only [Atom.implies, reduceCtorEq] at h <;>
    simp only [Atom.test, List.all_eq_true, List.elem_eq_mem,
      Bool.and_eq_true, decide_eq_true_eq, Bool.not_eq_true', List.any_eq_false, beq_iff_eq] at h hy ⊢
  all_goals first
    | exact h _ hy
    | omega
    | exact h ▸ hy
    | exact fun t ht => h t (hy t ht)
    | exact fun t ht hx => hy t (h t ht) hx
    | skip

/-- `s` lies within `t`, test by test: `t` is the whole vault, or every conjunction of `s` holds, for some conjunction
    of `t`, a test implying each of its tests. Sound (`fits_sound`), never complete: a `false` only says it can't
    tell. -/
def Selector.fits : Selector → Selector → Bool
  | _, .all => true
  | .all, .anyOf _ => false
  | .anyOf ds, .anyOf es => ds.all fun d => es.any fun e => e.all fun x => d.any fun y => y.implies x

theorem fits_sound (s t : Selector) (h : s.fits t = true) : s.Within t := by
  intro a hs
  match s, t with
  | _, .all => rfl
  | .all, .anyOf _ => simp [Selector.fits] at h
  | .anyOf ds, .anyOf es =>
    simp only [Selector.fits, List.all_eq_true, List.any_eq_true] at h
    simp only [Selector.matches, List.any_eq_true, List.all_eq_true] at hs ⊢
    obtain ⟨d, hd, hda⟩ := hs
    obtain ⟨e, he, hed⟩ := h d hd
    exact ⟨e, he, fun x hx => by
      obtain ⟨y, hy, hyx⟩ := hed x hx
      exact Atom.implies_sound y x a hyx (hda y hy)⟩

/-! ## The labels part, matched blind -/

/-- A label a blind peer holds a token of: an entry's type, or one of its tags. -/
inductive Label where
  | type (t : Sym)
  | tag  (g : Sym)
  deriving DecidableEq, Repr

/-- The labels an entry carries. -/
def Attrs.labels (a : Attrs) : List Label := .type a.type :: a.tags.map .tag

/-- The labels a test asks one of: a `typeIn` its types, a `tagHas` its tag; none for another test. -/
def Atom.label? : Atom → Option (List Label)
  | .typeIn ts => some (ts.map .type)
  | .tagHas t => some [.tag t]
  | _ => none

/-- The labels a selector can be found by blind: of each conjunction, the labels of its first test that names some;
    none where a conjunction has no such test, or for the whole vault. -/
def Selector.blind : Selector → Option (List Label)
  | .all => none
  | .anyOf ds => (ds.mapM fun (d : List Atom) => d.findSome? Atom.label?).map List.flatten

theorem Atom.label_sound (x : Atom) (a : Attrs) (ls : List Label) (h : x.label? = some ls) (hx : x.test a = true) :
    ∃ l ∈ ls, l ∈ a.labels := by
  cases x with
  | typeIn ts =>
    simp only [Atom.label?, Option.some.injEq] at h
    subst h
    simp only [Atom.test, List.elem_eq_mem, decide_eq_true_eq] at hx
    exact ⟨.type a.type, List.mem_map.2 ⟨_, hx, rfl⟩, by simp [Attrs.labels]⟩
  | tagHas t =>
    simp only [Atom.label?, Option.some.injEq] at h
    subst h
    simp only [Atom.test, List.elem_eq_mem, decide_eq_true_eq] at hx
    exact ⟨.tag t, by simp, by simp [Attrs.labels]; exact hx⟩
  | _ => simp [Atom.label?] at h

theorem mapM_some_mem {α β : Type} (f : α → Option β) :
    ∀ (xs : List α) (ys : List β), xs.mapM f = some ys → ∀ x ∈ xs, ∃ y ∈ ys, f x = some y
  | [], _, _, x, hx => by simp at hx
  | x :: xs, ys, h, z, hz => by
    rw [List.mapM_cons] at h
    cases hy : f x with
    | none => simp [hy] at h
    | some y =>
    cases hys' : xs.mapM f with
    | none => simp [hy, hys'] at h
    | some ys' =>
    simp only [hy, hys'] at h
    cases h
    rcases List.mem_cons.1 hz with rfl | hz
    · exact ⟨y, List.mem_cons_self, hy⟩
    · obtain ⟨w, hw, hfw⟩ := mapM_some_mem f xs ys' hys' z hz
      exact ⟨w, List.mem_cons_of_mem _ hw, hfw⟩

/-- Every entry a selector picks carries one of the labels `blind` names: a `find` for their tokens misses none. -/
theorem blind_sound (s : Selector) (ls : List Label) (a : Attrs) (h : s.blind = some ls) (hs : s.matches a = true) :
    ∃ l ∈ ls, l ∈ a.labels := by
  match s with
  | .all => simp [Selector.blind] at h
  | .anyOf ds =>
    simp only [Selector.blind, Option.map_eq_some_iff] at h
    obtain ⟨lss, hm, rfl⟩ := h
    simp only [Selector.matches, List.any_eq_true, List.all_eq_true] at hs
    obtain ⟨d, hd, hda⟩ := hs
    obtain ⟨ld, hld, hdl⟩ := mapM_some_mem _ ds lss hm d hd
    obtain ⟨x, hx, hxl⟩ := List.exists_of_findSome?_eq_some hdl
    obtain ⟨l, hl, hla⟩ := Atom.label_sound x a ld hxl (hda x hx)
    exact ⟨l, List.mem_flatten.2 ⟨ld, hld, hl⟩, hla⟩

-- Bob's work todos lie within his todos and within the work tag, and are found by the todo type's token
#guard (Selector.anyOf [[.typeIn [1], .tagHas 2]]).fits (.anyOf [[.typeIn [1]]])
#guard (Selector.anyOf [[.typeIn [1], .tagHas 2]]).fits (.anyOf [[.tagHas 2]])
#guard !(Selector.anyOf [[.typeIn [1]]]).fits (.anyOf [[.typeIn [1], .tagHas 2]])
#guard (Selector.anyOf [[.typeIn [1]]]).fits (.anyOf [[.typeIn [1, 3]]]) && !(Selector.anyOf [[.typeIn [1, 3]]]).fits (.anyOf [[.typeIn [1]]])
#guard (Selector.anyOf [[.createdIn 5 9]]).fits (.anyOf [[.createdIn 0 10]]) && !(Selector.anyOf [[.createdIn 0 10]]).fits (.anyOf [[.createdIn 5 9]])
#guard !(Selector.all).fits (.anyOf [[.typeIn [1]]]) && (Selector.anyOf []).fits (.anyOf [])
#guard (Selector.anyOf [[.typeIn [1], .tagHas 2]]).blind == some [.type 1]
#guard (Selector.anyOf [[.tagHas 2], [.typeIn [1, 3]]]).blind == some [.tag 2, .type 1, .type 3]
#guard (Selector.anyOf [[.createdIn 0 9]]).blind == none && Selector.all.blind == none

end AvenDB
