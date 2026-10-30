import Aven.ID.SealedIndex
import Aven.DB.Docs.Index

/-! # Sealed indexes: caps' side joined to the docs model's index

Caps states its side of a sealed index (A26, caps rule 36) over an abstract root that depends only on the set of
entries (`Aven.ID.SealedIndex`); avenID sits below the docs layer and doesn't import it. Here the root is the docs
model's Prolly tree root (`Aven.DB.Docs.Index`), and its `root_set` discharges caps' hypothesis, so caps' theorems hold
of the real index:

- `index_within_key`: an index under a key holds only entries read under keys every holder of that key holds;
- `sealed_roots_agree`: two readers holding the same admissible entries rebuild the same sealed root;
- `root_by_writer`: a reader takes a root only from a vault that may write the directory.
-/

namespace Aven.Architecture.Sealed

open Aven.Core

variable (boundary : Bytes → Bool) (size : Bytes → Nat) (limit : Nat)

/-- The docs model's root, as caps' abstract root. -/
def docsRoot : ID.Sealed.Root := DB.Docs.Index.root boundary size limit

/-- The docs model's root depends only on the set of entries: caps' hypothesis, from `root_set`. -/
theorem docsRoot_set (H : Bytes → Hash) (a b : List Bytes) (h : ∀ x, x ∈ a ↔ x ∈ b) :
    docsRoot boundary size limit H a = docsRoot boundary size limit H b :=
  DB.Docs.Index.root_set boundary size limit H h

/-- A sealed index's root, its nodes cut and named as the docs model does. -/
def sealedRoot (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) (holders : ID.Sealed.Holders) (key : String)
    (es : List ID.Sealed.Entry) : Hash :=
  ID.Sealed.sealedRoot (docsRoot boundary size limit) H sealer holders key es

/-- Two readers holding the same admissible entries rebuild the same sealed root of the docs model's index. -/
theorem sealed_roots_agree (H : Bytes → Hash) (sealer : Bytes → Bytes → Bytes) {holders : ID.Sealed.Holders}
    {key : String} {e₁ e₂ : List ID.Sealed.Entry}
    (h : ∀ x, x ∈ ID.Sealed.contents holders key e₁ ↔ x ∈ ID.Sealed.contents holders key e₂) :
    sealedRoot boundary size limit H sealer holders key e₁ = sealedRoot boundary size limit H sealer holders key e₂ :=
  ID.Sealed.sealed_roots_agree (docsRoot_set boundary size limit) H sealer h

/-- No index holds an entry from outside its key (caps' theorem, over what the docs model's root folds). -/
theorem index_within_key {holders : ID.Sealed.Holders} {key : String} {es : List ID.Sealed.Entry} {b : Bytes}
    (h : b ∈ ID.Sealed.contents holders key es) :
    ∃ e ∈ es, e.bytes = b ∧ ∀ r ∈ holders key, r ∈ holders e.readUnder :=
  ID.Sealed.index_within_key h

/-- A reader takes a root only from a vault that may write the directory. -/
theorem root_by_writer {writers : List String} {pubs : List ID.Sealed.Publish} {p : ID.Sealed.Publish}
    (h : p ∈ ID.Sealed.taken writers pubs) : p ∈ pubs ∧ p.vault ∈ writers :=
  ID.Sealed.root_by_writer h

end Aven.Architecture.Sealed
