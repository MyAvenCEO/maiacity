import Aven.Core

/-! # avenID's built-in types (A39)

Every Doc has a type, always (A39, Samuel, 31 Oct 2026: "no doc can be without type ever"): a Doc's genesis fixes its
root type with its vault (docs D11), and a type Doc's own type is Core's built-in type of types
(`Aven.Core.typeOfTypes`). avenID's built-in types are the root types of the Docs caps makes, `keyring`, `safe`,
`group` and `collection` (A32), and the types of the Records in a Doc's access map, `cap`, `revoke` and `epoch` (caps
README, "Terms"). Each id is the name of a fixed label, as the type of types' is, so every reader knows them without
fetching anything. Each is a type Doc (`builtin_typed`), and no two are one, nor the type of types. -/

namespace Aven.ID

open Aven.Core

/-- An avenID built-in type, named by the hash of its label `avenID <name> 1`: Core's `builtinType` in avenID's
namespace (A45). -/
def builtinType (name : String) : DocId := Core.builtinType blake3 "avenID" name

def keyringType : DocId := builtinType "keyring"
def safeType : DocId := builtinType "safe"
def groupType : DocId := builtinType "group"
def collectionType : DocId := builtinType "collection"
def capType : DocId := builtinType "cap"
def revokeType : DocId := builtinType "revoke"
def epochType : DocId := builtinType "epoch"

/-- Every built-in type, by its name. -/
def builtinTypes : List (String × DocId) :=
  ["keyring", "safe", "group", "collection", "cap", "revoke", "epoch"].map fun n => (n, builtinType n)

/-- A built-in type's own facts: built in, in no vault, and a type Doc. -/
def builtinFacts (t : DocId) : Facts := ⟨t, [], typeOfTypes blake3⟩

/-- Each built-in type is a type Doc: its own type is the type of types. -/
theorem builtin_typed (t : DocId) : (builtinFacts t).isType blake3 = true := by
  simp [builtinFacts, Facts.isType]

#guard (typeOfTypes blake3 :: builtinTypes.map (·.2)).Nodup

end Aven.ID
