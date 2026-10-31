import Aven.ID.Network
import Aven.ID.Types

/-! # The tree, a Doc of Core envelopes (A30, A39)

The tree is a Doc of type `tree` in Maia City's vault (`facts`). Each of its statements is a Core envelope, and a peer
stores each under its name (`Named`), so settling never computes a hash. `read` reads an envelope as the statement it
carries:
- it belongs to the tree Doc every member pins;
- its signatures sit beside its name (A30): the first is its signer's, the rest are approvals of the same act (k of
  n); every key is UTF-8 text;
- its parents are Core's (`Aven.Core.Past.parents`): the one before it in its writer's log and the tips it saw;
- its body is the call of a `tree/1` op it makes (`TreeSays.ofValue`, A32).

The setup is no envelope here: it is the root Record the Doc's first envelope writes, avenDOCS' `core/1` put, and the
replay starts from its Value (`root`, A213).

An envelope that doesn't read doesn't count, and neither does one that fails its own checks (`ok`: its name is its
hash, its signature verifies). The settle rule is `Aven.ID.settle`'s, over the statements read (`settleDoc`), and its
past is Core's. Settling the envelopes that carry a set of statements is settling those statements
(`settleDoc_envelopes`). -/

namespace Aven.ID
namespace TreeDoc

open Core Body

/-- The tree's type (A39): a built-in type, named as caps names its own (`Aven.ID.builtinType`), until the register
moves with caps into avenCAPS. -/
def treeType : DocId := builtinType "tree"

/-- The tree Doc's facts: its id, Maia City's vault, and its type. -/
def facts (doc : DocId) (coop : String) : Facts := ⟨doc, vaultId coop, treeType⟩

/-- An envelope as a peer stores it: under its name. -/
structure Named where
  name : Hash
  env : Envelope

/-- The statement an envelope of the tree Doc carries, if it reads as one. -/
def read (H : Bytes → Hash) (doc : DocId) (n : Named) : Option TreeStatement :=
  if n.env.doc = doc then
    match n.env.sigs, TreeSays.ofValue H n.env.body with
    | x :: xs, some says => do
      pure ⟨n.name, ← ofUtf8 x.signer, Core.Past.parents n.env, says, ← xs.mapM (ofUtf8 ·.signer)⟩
    | _, _ => none
  else none

/-- The tree from the setup and the envelopes a peer stores: `root` is the setup, the root Record the Doc's first
envelope writes, taken as data (A213); `ok` is each envelope's own checks, `doc` the tree Doc and `pinned` its genesis's
name, both of which every member pins. -/
def settleDoc (H : Bytes → Hash) (ok : Named → Bool) (doc : DocId) (pinned : Hash) (root : Option TreeStatement)
    (E : List Named) : Settled :=
  settle pinned (root.toList ++ E.filterMap fun n => if ok n then read H doc n else none)

/-- A statement as an envelope of the tree Doc, for the examples and vectors, when it calls an op: the tips it saw are
its dependencies. The tree reads neither the writer nor the sequence number: its order is its parents. -/
def envelope (H : Bytes → Hash) (doc : DocId) (s : TreeStatement) : Option Envelope :=
  (s.says.toValue H).map fun body =>
    { doc, branch := mainBranch, writer := 0, seq := 0, prev := none, deps := s.parents, body,
      sigs := s.keys.map fun k => (⟨Body.utf8 k, []⟩ : Core.Sig) }

/-- An envelope made from a statement reads back as that statement. -/
theorem read_envelope {H : Bytes → Hash} (d : TreeOp.distinct H) (doc : DocId) (s : TreeStatement)
    (h : s.says.refsOk = true) {e : Envelope} (he : envelope H doc s = some e) : read H doc ⟨s.name, e⟩ = some s := by
  have ap : ∀ l : List String,
      List.mapM (fun x : Core.Sig => ofUtf8 x.signer) (l.map fun k => (⟨Body.utf8 k, []⟩ : Core.Sig)) = some l := by
    intro l
    induction l with
    | nil => rfl
    | cons k l ih => simp [List.mapM_cons, ofUtf8_utf8, ih]
  cases hv : s.says.toValue H with
  | none => simp [envelope, hv] at he
  | some v =>
    simp only [envelope, hv, Option.map_some, Option.some.injEq] at he
    subst he
    simp [read, TreeStatement.keys, ofUtf8_utf8, TreeSays.ofValue_toValue d _ h hv, Core.Past.parents_envelope, ap]

/-- **Settling the envelopes is settling the statements:** whatever the setup and a set of op statements settle to,
the setup and the envelopes that carry them, stored under the statements' names, settle to the same. -/
theorem settleDoc_envelopes {H : Bytes → Hash} (d : TreeOp.distinct H) (doc : DocId) (pinned : Hash)
    (root : Option TreeStatement) (S : List TreeStatement) (h : ∀ s ∈ S, s.says.refsOk = true) :
    settleDoc H (fun _ => true) doc pinned root (S.filterMap fun s => (envelope H doc s).map (⟨s.name, ·⟩)) =
      settle pinned (root.toList ++ S.filter fun s => (envelope H doc s).isSome) := by
  unfold settleDoc
  congr 2
  simp only [ite_true]
  induction S with
  | nil => rfl
  | cons s S ih =>
    have ih' := ih fun x m => h x (List.mem_cons_of_mem _ m)
    cases he : envelope H doc s with
    | none => simp [List.filterMap_cons, he, ih']
    | some e =>
      simp [List.filterMap_cons, he, read_envelope d doc s (h s (List.mem_cons_self ..)) he, ih']

end TreeDoc
end Aven.ID
