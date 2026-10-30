import Aven.Core

/-! # Sealed indexes: caps' part (A26, caps rule 36)

An index and its directory are one Prolly tree in the docs model (`Aven.DB.Docs.Index`), sealed under the key of the
directory. avenID sits below the docs layer, whose checks use caps, so this module doesn't import it. It states caps'
side over an abstract index, each entry tagged with the key it was read under, and takes the root as a parameter that
depends only on the set of entries. `Aven.Architecture`, which requires every spec, joins the two: there the root is
the docs model's, and `root_set` is its theorem.

What caps says:
- an index under a key holds only entries read under keys every holder of that key holds, so a Doc with fewer readers
  never enters it (`index_within_key`, `index_skips`);
- a node is named by the hash of its sealing, and the sealing's nonce is keyed by the key and the node, so equal nodes
  under one key are sealed alike: two readers that rebuild an index from the same entries get the same root, and can
  compare it (`sealed_roots_agree`);
- sealed nodes are padded (D18): the sealing's length depends only on the padded length of the node (`sealed_padded`);
- only a vault that may write the directory folds in recent entries and publishes a root a reader takes
  (`root_by_writer`).

The sealing and the padding are parameters, taken as sound, as Core takes signatures. -/

namespace Aven.ID.Sealed

open Aven.Core

/-- An index entry: its encoding (key first, as the docs model writes it), and the key of the Doc it was read from. -/
structure Entry where
  bytes : Bytes
  readUnder : String
  deriving DecidableEq, Repr

/-- Who holds each key: the readers it is sealed to, as the keys' layers give them. -/
abbrev Holders := String → List String

/-- An entry may go into an index under `key` only if every holder of `key` holds the key it was read under. -/
def admissible (holders : Holders) (key : String) (e : Entry) : Bool :=
  (holders key).all ((holders e.readUnder).contains ·)

/-- What an index under `key` folds: the encodings of its admissible entries. -/
def contents (holders : Holders) (key : String) (es : List Entry) : List Bytes :=
  (es.filter (admissible holders key)).map (·.bytes)

/-- No index holds an entry from outside its key: each was read under a key every holder of the index's key holds. -/
theorem index_within_key {holders : Holders} {key : String} {es : List Entry} {b : Bytes}
    (h : b ∈ contents holders key es) :
    ∃ e ∈ es, e.bytes = b ∧ ∀ r ∈ holders key, r ∈ holders e.readUnder := by
  simp only [contents, List.mem_map, List.mem_filter] at h
  obtain ⟨e, ⟨m, a⟩, rfl⟩ := h
  simp only [admissible, List.all_eq_true, List.contains_iff_mem] at a
  exact ⟨e, m, rfl, a⟩

/-- An entry some holder of the index's key can't read changes nothing in the index. -/
theorem index_skips {holders : Holders} {key : String} {e : Entry} {es : List Entry}
    (h : admissible holders key e = false) : contents holders key (e :: es) = contents holders key es := by
  simp [contents, h]

/-- A root built from a set of entries, each node named by a hash function: the docs model's `root`, which
`Aven.Architecture` supplies with its `root_set`. -/
abbrev Root := (Bytes → Hash) → List Bytes → Hash

/-- An index's root, each node named by the hash of its sealing under `key`. -/
def sealedRoot (root : Root) (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) (holders : Holders) (key : String)
    (es : List Entry) : Hash :=
  root (fun b => H (sealer key.toUTF8.toList b)) (contents holders key es)

/-- Two readers that hold the same admissible entries, in any order and from any copies, rebuild the same sealed root
under one key, so each can check the root a writer published. -/
theorem sealed_roots_agree {root : Root} (root_set : ∀ H a b, (∀ x, x ∈ a ↔ x ∈ b) → root H a = root H b)
    (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) {holders : Holders} {key : String} {e₁ e₂ : List Entry}
    (h : ∀ x, x ∈ contents holders key e₁ ↔ x ∈ contents holders key e₂) :
    sealedRoot root H sealer holders key e₁ = sealedRoot root H sealer holders key e₂ :=
  root_set _ _ _ h

/-- A sealing that pads: its length is the padded length of what it seals (D18), so two nodes whose lengths pad alike
are sealed to the same length, and the length shows nothing more. -/
theorem sealed_padded {sealer : Bytes → Bytes → Bytes} {pad : Nat → Nat}
    (pads : ∀ k b, (sealer k b).length = pad b.length) {k a b : Bytes} (same : pad a.length = pad b.length) :
    (sealer k a).length = (sealer k b).length := by
  rw [pads, pads, same]

/-- A root published for a directory: the device, its vault, and the root. -/
structure Publish where
  device : String
  vault : String
  root : Hash

/-- The roots a reader takes: only those published by a vault that may write the directory. -/
def taken (writers : List String) (pubs : List Publish) : List Publish := pubs.filter fun p => writers.contains p.vault

/-- Only a vault that may write the directory folds in recent entries and publishes a root a reader takes. -/
theorem root_by_writer {writers : List String} {pubs : List Publish} {p : Publish} (h : p ∈ taken writers pubs) :
    p ∈ pubs ∧ p.vault ∈ writers := by
  simp only [taken, List.mem_filter, List.contains_iff_mem] at h
  exact h

end Aven.ID.Sealed
