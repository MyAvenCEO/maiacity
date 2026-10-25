/-! Ordinary content-only refresh. Runtime guards establish unchanged policy,
key schedule, selectors, schema lane and cap groups. This model does not prove
those Rust guards or a timing bound; it proves reuse preserves the judgment
result once those dependencies are equal. Signatures/replay are never omitted. -/
namespace AvenDB.ContentRefresh
structure Context (P K L G : Type) where
  policy : P
  keys : K
  lane : L
  groups : G

theorem reuseContext (judge : Context P K L G → W → R)
    (before after : Context P K L G) (write : W)
    (policy : before.policy = after.policy)
    (keys : before.keys = after.keys)
    (lane : before.lane = after.lane)
    (groups : before.groups = after.groups) :
    judge before write = judge after write := by
  cases before
  cases after
  simp_all

theorem fallbackPreserves (guard : Bool) (fast full : R) (same : fast = full) :
    (if guard then fast else full) = full := by simp [same]
end AvenDB.ContentRefresh

namespace AvenDB.ContentRefresh
-- Creation may add one entry and a locally derived entry key, while retaining
-- its already-active audience epoch and all global authorization inputs.
theorem freshEntryDoesNotChangeOtherJudgments (judge : C → E → R)
    (before after : C) (sameContext : before = after) (entry : E) :
    judge before entry = judge after entry := by rw [sameContext]
end AvenDB.ContentRefresh
