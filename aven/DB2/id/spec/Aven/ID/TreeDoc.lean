import Aven.ID.Network

/-! # The tree, a Doc of Core envelopes (A30, A39)

The tree is a Doc of type `tree` in Maia City's vault (`facts`). Each of its statements is a Core envelope, and a peer
stores each under its name (`Named`), so settling never computes a hash. `read` reads an envelope as the statement it
carries:
- it belongs to the tree Doc every member pins;
- its signer's key is UTF-8 text;
- its parents are Core's (`Aven.Core.Past.parents`): the one before it in its writer's log and the tips it saw;
- its body is what it says (`TreeSays.ofValue`).

An envelope that doesn't read doesn't count, and neither does one that fails its own checks (`ok`: its name is its
hash, its signature verifies). The settle rule is `Aven.ID.settle`'s, over the statements read (`settleDoc`), and its
past is Core's. Settling the envelopes that carry a set of statements is settling those statements
(`settleDoc_envelopes`). -/

namespace Aven.ID
namespace TreeDoc

open Core Body

/-- The tree's type (A39). -/
def treeType : DocId := ⟨⟨utf8 "tree"⟩⟩

/-- The tree Doc's facts: its id, Maia City's vault, and its type. -/
def facts (doc : DocId) (coop : String) : Facts := ⟨doc, vaultId coop, treeType⟩

/-- An envelope as a peer stores it: under its name. -/
structure Named where
  name : Hash
  env : Envelope

/-- The statement an envelope of the tree Doc carries, if it reads as one. -/
def read (doc : DocId) (n : Named) : Option TreeStatement :=
  if n.env.doc = doc then
    match ofUtf8 n.env.signer, TreeSays.ofValue n.env.body with
    | some signer, some says => some ⟨n.name, signer, Core.Past.parents n.env, says⟩
    | _, _ => none
  else none

/-- The tree from the envelopes a peer stores: `ok` is each one's own checks, `doc` the tree Doc and `pinned` its
genesis's name, both of which every member pins. -/
def settleDoc (ok : Named → Bool) (doc : DocId) (pinned : Hash) (E : List Named) : Settled :=
  settle pinned (E.filterMap fun n => if ok n then read doc n else none)

/-- A statement as an envelope of the tree Doc, for the examples and vectors: the tips it saw are its dependencies.
The tree reads neither the writer nor the sequence number: its order is its parents. -/
def envelope (doc : DocId) (s : TreeStatement) : Envelope :=
  { doc, branch := mainBranch, writer := 0, seq := 0, prev := none, deps := s.parents, body := s.says.toValue,
    signer := utf8 s.signer, sig := [] }

/-- An envelope made from a statement reads back as that statement. -/
theorem read_envelope (doc : DocId) (s : TreeStatement) (h : s.says.refsOk = true) :
    read doc ⟨s.name, envelope doc s⟩ = some s := by
  simp [read, envelope, ofUtf8_utf8, TreeSays.ofValue_toValue _ h, Core.Past.parents_envelope]

/-- **Settling the envelopes is settling the statements:** whatever a set of statements settles to, the envelopes that
carry them, stored under the statements' names, settle to the same. -/
theorem settleDoc_envelopes (doc : DocId) (pinned : Hash) (S : List TreeStatement)
    (h : ∀ s ∈ S, s.says.refsOk = true) :
    settleDoc (fun _ => true) doc pinned (S.map fun s => ⟨s.name, envelope doc s⟩) =
      settle pinned S := by
  unfold settleDoc
  congr 1
  simp only [ite_true]
  induction S with
  | nil => rfl
  | cons s S ih =>
    simp only [List.map_cons, List.filterMap_cons, read_envelope doc s (h s (List.mem_cons_self ..))]
    rw [ih fun x m => h x (List.mem_cons_of_mem _ m)]

end TreeDoc
end Aven.ID
