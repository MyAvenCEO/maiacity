import Aven.ID.SealedIndex
import Aven.DB.Docs.Index

/-! # Sealed indexes: caps' side joined to the docs model's index

Caps states its side of a sealed index (A26, caps rule 36) over an abstract root that depends only on the set of
entries (`Aven.ID.SealedIndex`); avenID sits below the docs layer and doesn't import it. Here the root is the docs
model's Prolly tree root (`Aven.DB.Docs.Index`), and its `root_set` discharges caps' hypothesis (`docsRoot_set`), so
caps' theorems hold of the real index. Each theorem has one copy, caps': the rules cite `ID.Sealed.index_within_key`,
`ID.Sealed.sealed_roots_agree` (with `docsRoot_set`) and `ID.Sealed.root_by_writer` directly.
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

end Aven.Architecture.Sealed
