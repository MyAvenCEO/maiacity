import Aven.ID.WF

/-! # Governs

A vault owns what is directly below it and governs everything below it (README, "Terms"). Authority runs only down:
in a well-formed tree, `Governs` is irreflexive, asymmetric and transitive, and neither a device nor its key governs
anything. -/

namespace Aven.ID
namespace Tree

/-- `Governs t a c`: `c` is below `a`, through a line of owners. -/
inductive Governs (t : Tree) : String → String → Prop
  | owns {a b : String} : t.Owns a b → Governs t a b
  | step {a b c : String} : t.Owns a b → Governs t b c → Governs t a c

/-- The same relation, grown from the bottom: the form `chain` walks. -/
inductive GovernsUp (t : Tree) : String → String → Prop
  | owns {a b : String} : t.Owns a b → GovernsUp t a b
  | snoc {a b c : String} : GovernsUp t a b → t.Owns b c → GovernsUp t a c

variable {t : Tree}

theorem GovernsUp.cons {a b c : String} (o : t.Owns a b) (h : t.GovernsUp b c) : t.GovernsUp a c := by
  induction h with
  | owns o' => exact .snoc (.owns o) o'
  | snoc _ o' ih => exact .snoc ih o'

theorem Governs.up {a c : String} (h : t.Governs a c) : t.GovernsUp a c := by
  induction h with
  | owns o => exact .owns o
  | step o _ ih => exact ih.cons o

theorem governs_trans {a b c : String} (h : t.Governs a b) (g : t.Governs b c) : t.Governs a c := by
  induction h with
  | owns o => exact .step o g
  | step o _ ih => exact .step o (ih g)

theorem Governs.tail {a b c : String} (h : t.Governs a b) (o : t.Owns b c) : t.Governs a c :=
  governs_trans h (.owns o)

theorem GovernsUp.down {a c : String} (h : t.GovernsUp a c) : t.Governs a c := by
  induction h with
  | owns o => exact .owns o
  | snoc _ o ih => exact ih.tail o

theorem Governs.head {a c : String} (h : t.Governs a c) : ∃ b, t.Owns a b := by
  cases h with
  | owns o => exact ⟨_, o⟩
  | step o _ => exact ⟨_, o⟩

theorem Governs.rank_lt (w : t.WF) {a c : String} (h : t.Governs a c) : t.rank a < t.rank c := by
  induction h with
  | owns o => exact w.rank_lt o
  | step o _ ih => exact Nat.lt_trans (w.rank_lt o) ih

/-- Authority never runs back to where it starts. -/
theorem governs_irrefl (w : t.WF) (a : String) : ¬ t.Governs a a :=
  fun h => Nat.lt_irrefl _ (h.rank_lt w)

/-- Authority runs one way: what a vault governs never governs it. -/
theorem governs_asymm (w : t.WF) {a b : String} (h : t.Governs a b) : ¬ t.Governs b a :=
  fun g => governs_irrefl w a (governs_trans h g)

/-- A device governs nothing. -/
theorem device_governs_nothing (w : t.WF) {d x : String} (h : t.kind? d = some .device) : ¬ t.Governs d x :=
  fun g => let ⟨_, o⟩ := g.head; w.not_device o h

/-- `KeyGoverns t k x`: the key `k` owns `x`, or a vault that governs `x`. -/
def KeyGoverns (t : Tree) (k x : String) : Prop := ∃ v, t.KeyOwns k v ∧ (x = v ∨ t.Governs v x)

/-- A device's key governs nothing: it signs for the vault its device serves, and owns no vault. -/
theorem device_key_governs_nothing (w : t.WF) {k x : String} (h : t.kind? k = some .device) :
    ¬ t.KeyGoverns k x :=
  fun ⟨_, o, _⟩ => w.not_device_key o h

end Tree
end Aven.ID
