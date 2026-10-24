/-! Eager cache eviction never changes a shown record/history. A scratch is an
optional reconstruction accelerator, not authority or persisted source data. -/
namespace AvenDB.ScratchRetention
structure Shown (α β : Type) where
  value : α
  scratch : Option β

def evict (s : Shown α β) : Shown α β := { s with scratch := none }

theorem evictionPreservesValue (s : Shown α β) : (evict s).value = s.value := rfl

-- Evicting a scratch that final selection already excludes leaves exactly the
-- same final selection. Rust keeps the last 32 distinct reconstructed entries.
def finish (keep : Bool) (s : Shown α β) : Shown α β := if keep then s else evict s

theorem excludedFinalEquivalent (s : Shown α β) : finish false (evict s) = finish false s := by
  cases s
  rfl

theorem evictionIdempotent (s : Shown α β) : evict (evict s) = evict s := by
  cases s
  rfl
def retained (recent : List α) : List α := recent.reverse.take 32

theorem retainedBound (recent : List α) : (retained recent).length ≤ 32 := by
  simp [retained]
  omega
end AvenDB.ScratchRetention
