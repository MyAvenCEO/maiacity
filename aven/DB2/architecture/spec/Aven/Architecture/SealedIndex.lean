import Aven.DB.Docs.Index

/-! # Sealed indexes: caps' part (A26, caps rule 36)

Moved here from `Aven.ID` (30 Oct 2026): it joins caps' keys and readers with the docs layer's index, so it is a
cross-part theorem, and avenID, below docs, never requires docs.


An index and its directory are one Prolly tree (`Aven.DB.Docs.Index`), sealed under the key of the directory. Caps says
what may go in and who may change it:
- an index holds fields only from Docs every reader of its directory can read, so a Doc with fewer readers never enters
  it (`index_within_key`, `index_skips`);
- a node is named by the hash of its sealing, and the sealing's nonce is keyed by the key and the node, so equal nodes
  under one key are sealed alike: two readers that rebuild an index from the same entries get the same root, and can
  compare it (`sealed_roots_agree`);
- sealed nodes are padded (D18): the seal's length depends only on the padded length of the node (`sealed_padded`);
- only a device of a vault that may write the directory folds in recent entries and publishes a new root
  (`root_by_writer`).

The seal and the padding are parameters, taken as sound, as Core takes signatures. -/

namespace Aven.Architecture.Sealed

open Aven.Core Aven.DB.Docs.Index

/-- A Doc as an index sees it: its id, the vaults that may read it, and the entries its fields give the index (each
an encoding, key first). -/
structure Source where
  doc : DocId
  readers : List String
  entries : List Bytes

/-- A directory: its Doc, the readers of its key, and the vaults that may write it. -/
structure Directory where
  doc : DocId
  readers : List String
  writers : List String

/-- A Doc may feed the directory's index only if every reader of the directory may read it. -/
def admissible (dir : Directory) (src : Source) : Bool := dir.readers.all (src.readers.contains ·)

/-- What an index of `dir` folds: the entries of the admissible Docs, as the docs model folds them. -/
def indexEntries (dir : Directory) (srcs : List Source) : List Bytes :=
  entries ((srcs.filter (admissible dir)).flatMap (·.entries))

/-- No index holds an entry from outside its key: each comes from a Doc every reader of the directory can read. -/
theorem index_within_key {dir : Directory} {srcs : List Source} {e : Bytes} (h : e ∈ indexEntries dir srcs) :
    ∃ src ∈ srcs, e ∈ src.entries ∧ ∀ r ∈ dir.readers, r ∈ src.readers := by
  simp only [indexEntries, entries_mem, List.mem_flatMap, List.mem_filter] at h
  obtain ⟨src, ⟨m, a⟩, e⟩ := h
  simp only [admissible, List.all_eq_true, List.contains_iff_mem] at a
  exact ⟨src, m, e, a⟩

/-- A Doc some reader of the directory can't read changes nothing in its index. -/
theorem index_skips {dir : Directory} {src : Source} {srcs : List Source} (h : admissible dir src = false) :
    indexEntries dir (src :: srcs) = indexEntries dir srcs := by
  simp [indexEntries, h]

variable (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat)

/-- An index's root, each node named by the hash of its sealing under `key`. -/
def sealedRoot (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) (key : Bytes) (dir : Directory)
    (srcs : List Source) : Hash :=
  root boundary size limit (fun b => H (sealer key b)) ((srcs.filter (admissible dir)).flatMap (·.entries))

/-- The entries of the admissible Docs, before the fold. -/
def admitted (dir : Directory) (srcs : List Source) : List Bytes := (srcs.filter (admissible dir)).flatMap (·.entries)

/-- Two readers that hold the same admissible entries, in any order and from any copies, rebuild the same sealed root
under one key, so each can check the root a writer published. -/
theorem sealed_roots_agree (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) (key : Bytes) {dir : Directory}
    {s₁ s₂ : List Source} (h : ∀ x, x ∈ admitted dir s₁ ↔ x ∈ admitted dir s₂) :
    sealedRoot boundary size limit H sealer key dir s₁ = sealedRoot boundary size limit H sealer key dir s₂ :=
  root_set boundary size limit _ h

/-- A sealing that pads: its length is the padded length of what it seals (D18), so two nodes whose lengths pad alike
are sealed to the same length, and the length shows nothing more. -/
theorem sealed_padded {sealer : Bytes → Bytes → Bytes} {pad : Nat → Nat}
    (pads : ∀ k b, (sealer k b).length = pad b.length) {k a b : Bytes} (same : pad a.length = pad b.length) : (sealer k a).length = (sealer k b).length := by
  rw [pads, pads, same]

/-- A root published for a directory: the device, its vault, and the root. -/
structure Publish where
  device : String
  vault : String
  root : Hash

/-- The roots a reader takes for `dir`: only those published by a vault that may write the directory. -/
def taken (dir : Directory) (pubs : List Publish) : List Publish := pubs.filter fun p => dir.writers.contains p.vault

/-- Only a vault that may write the directory folds in recent entries and publishes a root a reader takes. -/
theorem root_by_writer {dir : Directory} {pubs : List Publish} {p : Publish} (h : p ∈ taken dir pubs) :
    p ∈ pubs ∧ p.vault ∈ dir.writers := by
  simp only [taken, List.mem_filter, List.contains_iff_mem] at h
  exact h

end Aven.Architecture.Sealed
