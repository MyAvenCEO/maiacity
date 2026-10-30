import Aven.DB.Engine.Query

/-!
# Sealed indexes (ARCHITECTURE.md, A26; decided 30 Oct 2026)

Search is local first (A21): a device searches what it holds. A **sealed index** lets it know which Docs to hold
without holding them all, and no one without the key can read it.

- **An index comes from a query's shape:** its equality fields, its range field and its order, over one type in one
  vault. Equal shapes share one index, named by the shape's hash. An actor's `loads` register the indexes they need in
  that vault, by the owners' act, up to a limit per directory (`register`).
- **Its entries** are, for every Record of the type in a Doc the directory lists at version V, the values of the
  shape's fields and the Doc (`build`). The docs layer keeps them as a few Values in a history-independent tree (a
  Prolly tree or a Merkle search tree): its root depends only on the set of entries (`Tree.root`, a parameter here with
  that law). The directory holds the entries since V, not yet folded in.
- **The lookup:** walk the index to the entries that match the probe, add the Docs of the directory's unfolded entries,
  want those Docs, and run the query on the device. A hit is only a hint: the query re-checks every Doc.

What it proves:
- `lookup_exact`: the lookup plus the local query returns exactly what the query returns over every Doc the directory
  lists, for an index built at V plus its unfolded entries;
- `complete_with_index`: so `complete` with an index means every candidate is held, the hits and the unfolded Docs.
  Without an index the candidates are every Doc of the target, as `Query.complete_iff` says;
- `same_root`: an index depends only on its entries, so two readers who build from the same version get the same root,
  whatever order they read the Docs in;
- `fold_eq_build`: folding the unfolded entries in equals building at the new version at once, and so (`fold_steps`)
  does folding in several steps. -/

namespace Aven.DB.Engine

open Aven.Core

/-- A query's shape. -/
structure Shape where
  vault : Bytes
  type : DocId
  eqs : List Bytes
  range : Option Bytes
  order : Option Bytes
  deriving DecidableEq, Repr

/-- A shape as a Value, so an index is named by its hash. -/
def Shape.value (s : Shape) : Value :=
  .array [.bytes s.vault, .bytes s.type.hash.bytes, .array (s.eqs.map .text),
    match s.range with | some f => .text f | none => .null,
    match s.order with | some f => .text f | none => .null]

/-- An index's name. -/
def Shape.name (H : Bytes → Hash) (s : Shape) : Hash := nameOf H s.value

/-- **Equal shapes share one index:** registering a shape twice keeps one, and a directory holds at most `limit`. -/
def register (limit : Nat) (have_ : List Shape) (s : Shape) : List Shape :=
  if s ∈ have_ ∨ have_.length ≥ limit then have_ else have_ ++ [s]

theorem register_limit (limit : Nat) (have_ : List Shape) (s : Shape) (h : have_.length ≤ limit) :
    (register limit have_ s).length ≤ limit := by
  simp only [register]
  split
  · exact h
  · rename_i hn
    simp only [not_or, Nat.not_le] at hn
    simp
    omega

theorem register_once (limit : Nat) (have_ : List Shape) (s : Shape) (h : have_.Nodup) :
    (register limit have_ s).Nodup := by
  simp only [register]
  split
  · exact h
  · rename_i hn
    simp only [not_or] at hn
    exact List.nodup_append.mpr ⟨h, by simp, by simp; intro a ha e; subst e; exact hn.1 ha⟩

variable {Val : Type}

/-- What a lookup asks: a value for each equality field, and bounds for the range field. -/
structure Probe (Val : Type) where
  eqs : List Val
  range : Option (Val × Val)

/-- An entry: the values of the shape's fields (the equality fields, then the range field) and the Doc. -/
structure Entry (Val : Type) where
  key : List Val
  doc : DocId

/-- A Record's key under a shape, when it has every field the shape names. -/
def keyOf (sh : Shape) (r : Rec Val) : Option (List Val) :=
  (sh.eqs ++ sh.range.toList).mapM (get r.fields)

def keyMatch (V : Vals Val) (sh : Shape) (p : Probe Val) (k : List Val) : Bool :=
  (k.take sh.eqs.length).length == p.eqs.length &&
    ((k.take sh.eqs.length).zip p.eqs).all (fun (a, b) => V.eq a b) &&
    match p.range, k[sh.eqs.length]? with
    | none, _ => true
    | some (lo, hi), some x => (V.eq lo x || V.lt lo x) && (V.eq x hi || V.lt x hi)
    | some _, none => false

/-- A Record the query of this shape and probe returns. -/
def matches' (V : Vals Val) (sh : Shape) (p : Probe Val) (r : Rec Val) : Bool :=
  r.type == sh.type && match keyOf sh r with
    | some k => keyMatch V sh p k
    | none => false

/-- The query of a shape over some Docs: the matching Records of those Docs, in the database's order. -/
def select (V : Vals Val) (sh : Shape) (p : Probe Val) (db : List (Rec Val)) (docs : List DocId) : List (Rec Val) :=
  db.filter fun r => docs.contains r.doc && matches' V sh p r

/-- An index built from the Records of the Docs a directory lists. -/
def build (sh : Shape) (db : List (Rec Val)) (docs : List DocId) : List (Entry Val) :=
  (db.filter fun r => docs.contains r.doc && r.type == sh.type).filterMap fun r =>
    (keyOf sh r).map fun k => ⟨k, r.doc⟩

/-- The Docs an index names for a probe. -/
def hits (V : Vals Val) (sh : Shape) (p : Probe Val) (idx : List (Entry Val)) : List DocId :=
  (idx.filter fun e => keyMatch V sh p e.key).map (·.doc)

/-- The Docs to want and query: the hits and the unfolded Docs, among those the directory lists now. -/
def candidates (V : Vals Val) (sh : Shape) (p : Probe Val) (idx : List (Entry Val)) (unfolded now : List DocId) :
    List DocId :=
  (hits V sh p idx ++ unfolded).filter now.contains

/-- **The lookup is exact.** An index built at version V from `dbV` over `docsV`; since then the Docs `unfolded` moved.
Every Doc the directory lists now was listed at V or is unfolded, and every Doc not unfolded holds what it held at V.
Then the query over the candidates returns exactly what it returns over every Doc listed now. -/
theorem lookup_exact (V : Vals Val) (sh : Shape) (p : Probe Val) (db dbV : List (Rec Val))
    (docsV unfolded now : List DocId)
    (hnow : ∀ d ∈ now, d ∉ unfolded → d ∈ docsV)
    (hsame : ∀ r, r.doc ∉ unfolded → (r ∈ db → r ∈ dbV)) :
    select V sh p db (candidates V sh p (build sh dbV docsV) unfolded now) = select V sh p db now := by
  unfold select
  apply List.filter_congr
  intro r hr
  cases hm : matches' V sh p r
  · simp
  · simp only [Bool.and_true]
    rw [Bool.eq_iff_iff]
    simp only [candidates, List.contains_iff_mem, List.mem_filter, List.mem_append]
    constructor
    · exact fun h => h.2
    · intro hn
      refine ⟨?_, hn⟩
      by_cases hu : r.doc ∈ unfolded
      · exact .inr hu
      · refine .inl ?_
        have hrV := hsame r hu hr
        have hdV := hnow r.doc hn hu
        simp only [matches', Bool.and_eq_true, beq_iff_eq] at hm
        obtain ⟨hty, hk⟩ := hm
        cases hkey : keyOf sh r with
        | none => rw [hkey] at hk; cases hk
        | some k =>
          rw [hkey] at hk
          simp only [hits, build, List.mem_map, List.mem_filter, List.mem_filterMap]
          refine ⟨⟨k, r.doc⟩, ⟨⟨r, ⟨hrV, ?_⟩, by simp [hkey]⟩, hk⟩, rfl⟩
          simp [hdV, hty]

/-- **`complete` with an index:** when every candidate is held, the query over the held candidates returns exactly
what it returns over every Doc the directory lists. -/
theorem complete_with_index (V : Vals Val) (sh : Shape) (p : Probe Val) (db dbV : List (Rec Val))
    (docsV unfolded now : List DocId) (held : DocId → Bool)
    (hnow : ∀ d ∈ now, d ∉ unfolded → d ∈ docsV)
    (hsame : ∀ r, r.doc ∉ unfolded → (r ∈ db → r ∈ dbV))
    (hheld : ∀ d ∈ candidates V sh p (build sh dbV docsV) unfolded now, held d = true) :
    select V sh p db ((candidates V sh p (build sh dbV docsV) unfolded now).filter held) = select V sh p db now := by
  rw [← lookup_exact V sh p db dbV docsV unfolded now hnow hsame]
  congr 1
  apply List.filter_eq_self.mpr
  exact hheld

/-! ## Roots: an index depends only on its entries -/

/-- The docs layer's tree over a set of entries: its root depends only on which entries it holds. -/
structure Tree (Val : Type) where
  root : List (Entry Val) → Hash
  independent : ∀ a b : List (Entry Val), (∀ e, e ∈ a ↔ e ∈ b) → root a = root b

/-- **Same entries, same root:** two readers who build from the same version get the same root, whatever order they
list the Docs and Records in. -/
theorem same_root (T : Tree Val) (sh : Shape) (db db' : List (Rec Val)) (docs docs' : List DocId)
    (hdb : ∀ r, r ∈ db ↔ r ∈ db') (hdocs : ∀ d, d ∈ docs ↔ d ∈ docs') :
    T.root (build sh db docs) = T.root (build sh db' docs') := by
  apply T.independent
  intro e
  simp only [build, List.mem_filterMap, List.mem_filter, List.contains_iff_mem, Bool.and_eq_true, hdb, hdocs]

/-- Folding the unfolded Docs in: their old entries go, their current ones come. -/
def fold (sh : Shape) (idx : List (Entry Val)) (db : List (Rec Val)) (unfolded now : List DocId) : List (Entry Val) :=
  idx.filter (fun e => ! unfolded.contains e.doc) ++ build sh db (unfolded.filter now.contains)

/-- **Folding in equals building at once:** folding the unfolded Docs into an index built at V gives the entries an
index built now from scratch has. -/
theorem fold_eq_build (sh : Shape) (db dbV : List (Rec Val)) (docsV unfolded now : List DocId)
    (hnow : ∀ d, d ∉ unfolded → (d ∈ now ↔ d ∈ docsV))
    (hsame : ∀ r, r.doc ∉ unfolded → (r ∈ db ↔ r ∈ dbV)) :
    ∀ e, e ∈ fold sh (build sh dbV docsV) db unfolded now ↔ e ∈ build sh db now := by
  intro e
  simp only [fold, build, List.mem_append, List.mem_filter, List.mem_filterMap, List.contains_iff_mem,
    Bool.and_eq_true, Bool.not_eq_true', Option.map_eq_some_iff]
  constructor
  · rintro (⟨⟨r, ⟨hr, hd, hty⟩, k, hk, rfl⟩, hu⟩ | ⟨r, ⟨hr, ⟨hu, hn⟩, hty⟩, k, hk, rfl⟩)
    · have hu' : r.doc ∉ unfolded := by simpa using hu
      exact ⟨r, ⟨(hsame r hu').mpr hr, (hnow r.doc hu').mpr hd, hty⟩, k, hk, rfl⟩
    · exact ⟨r, ⟨hr, hn, hty⟩, k, hk, rfl⟩
  · rintro ⟨r, ⟨hr, hn, hty⟩, k, hk, rfl⟩
    by_cases hu : r.doc ∈ unfolded
    · exact .inr ⟨r, ⟨hr, ⟨by simpa using hu, hn⟩, hty⟩, k, hk, rfl⟩
    · exact .inl ⟨⟨r, ⟨(hsame r hu).mp hr, (hnow r.doc hu).mp hn, hty⟩, k, hk, rfl⟩, by simpa using hu⟩

/-- Folding depends only on which entries the index holds. -/
theorem fold_congr (sh : Shape) (a b : List (Entry Val)) (db : List (Rec Val)) (unfolded now : List DocId)
    (h : ∀ e, e ∈ a ↔ e ∈ b) : ∀ e, e ∈ fold sh a db unfolded now ↔ e ∈ fold sh b db unfolded now := by
  intro e
  simp only [fold, List.mem_append, List.mem_filter, h]

/-- So the folded index has the root a fresh build has. -/
theorem fold_root (T : Tree Val) (sh : Shape) (db dbV : List (Rec Val)) (docsV unfolded now : List DocId)
    (hnow : ∀ d, d ∉ unfolded → (d ∈ now ↔ d ∈ docsV))
    (hsame : ∀ r, r.doc ∉ unfolded → (r ∈ db ↔ r ∈ dbV)) :
    T.root (fold sh (build sh dbV docsV) db unfolded now) = T.root (build sh db now) :=
  T.independent _ _ (fold_eq_build sh db dbV docsV unfolded now hnow hsame)

/-- **Folding in steps equals building at once:** fold what moved from V to V₁, then what moved from V₁ to V₂, and the
root is a fresh build's at V₂. -/
theorem fold_steps (T : Tree Val) (sh : Shape) (db₀ db₁ db₂ : List (Rec Val)) (docs₀ docs₁ docs₂ u₁ u₂ : List DocId)
    (h₁ : ∀ d, d ∉ u₁ → (d ∈ docs₁ ↔ d ∈ docs₀)) (s₁ : ∀ r, r.doc ∉ u₁ → (r ∈ db₁ ↔ r ∈ db₀))
    (h₂ : ∀ d, d ∉ u₂ → (d ∈ docs₂ ↔ d ∈ docs₁)) (s₂ : ∀ r, r.doc ∉ u₂ → (r ∈ db₂ ↔ r ∈ db₁)) :
    T.root (fold sh (fold sh (build sh db₀ docs₀) db₁ u₁ docs₁) db₂ u₂ docs₂) = T.root (build sh db₂ docs₂) := by
  apply T.independent
  intro e
  rw [← fold_eq_build sh db₂ db₁ docs₁ u₂ docs₂ h₂ s₂ e]
  exact fold_congr sh _ _ db₂ u₂ docs₂ (fold_eq_build sh db₁ db₀ docs₀ u₁ docs₁ h₁ s₁) e

end Aven.DB.Engine
