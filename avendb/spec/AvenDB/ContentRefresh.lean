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

namespace AvenDB.ContentRefresh
-- Received fast tails go through the ordinary signature/current admission gate
-- before decryption; source/provider deployment role is not an input.
def receivedTail (verified currentPermission strictTail currentKey : Bool) : Bool :=
  verified && currentPermission && strictTail && currentKey

theorem receivedRequiresVerification (permission tail key : Bool) :
    receivedTail false permission tail key = false := by simp [receivedTail]
theorem receivedRequiresCurrentPermission (verified tail key : Bool) :
    receivedTail verified false tail key = false := by simp [receivedTail]
theorem receivedRequiresCurrentKey (verified permission tail : Bool) :
    receivedTail verified permission tail false = false := by simp [receivedTail]
end AvenDB.ContentRefresh

namespace ContentRefreshSteward
-- The canonical upkeep schedules marks only for a device acting for the vault,
-- with all share selectors read. Keep marks additionally require keep selectors.
def needsMark (actsFor readsShares caps wants readsKeeps : Bool) : Bool :=
  actsFor && readsShares && (caps || (wants && readsKeeps))
theorem noForeignSteward (readsShares caps wants readsKeeps : Bool) :
    needsMark false readsShares caps wants readsKeeps = false := by
  simp [needsMark]
theorem capsPreserved : needsMark true true true wants readsKeeps = true := by
  simp [needsMark]
theorem readableKeepPreserved : needsMark true true caps true true = true := by
  simp [needsMark]
end ContentRefreshSteward
