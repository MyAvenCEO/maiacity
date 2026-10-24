/-! Own-shelf derived materialization. Cryptographic authentication, canonical
capture and codec roundtrips are implementation premises, not proved here.
Any changed frontier or body availability forces canonical reconstruction. -/
namespace AvenDB.WarmMaterialization
structure Basis where
  engine : Nat
  frontier : List Nat
  bodies : List Nat
  deriving DecidableEq

def restore (saved current : Basis) (cached canonical : α) : α :=
  if saved = current then cached else canonical

theorem changedFallback (saved current : Basis) (h : saved ≠ current) (cached canonical : α) :
    restore saved current cached canonical = canonical := by simp [restore, h]

theorem equivalent (saved current : Basis) (cached canonical : α)
    (capture : saved = current → cached = canonical) :
    restore saved current cached canonical = canonical := by
  by_cases h : saved = current
  · simp [restore, h, capture h]
  · simp [restore, h]
def closeDue (replayed held saved : Nat) : Prop :=
  replayed > 0 ∧ replayed = held ∧ replayed ≠ saved

theorem unchangedClose (held : Nat) : ¬ closeDue held held held := by
  simp [closeDue]

theorem recentDurableClose (held saved : Nat) (nonempty : held > 0) (changed : held ≠ saved) :
    closeDue held held saved := by simp [closeDue, nonempty, changed]

-- Deferring only materialization preserves already validated history and authority.
-- Snapshot decoding failure selects canonical construction.
def lazyRead (snapshot : Option α) (canonical : α) : α := snapshot.getD canonical

theorem lazyFallback (canonical : α) : lazyRead none canonical = canonical := rfl

theorem lazyEquivalent (snapshot : Option α) (canonical : α)
    (valid : ∀ value, snapshot = some value → value = canonical) :
    lazyRead snapshot canonical = canonical := by
  cases snapshot with
  | none => rfl
  | some value => exact valid value rfl

end AvenDB.WarmMaterialization
