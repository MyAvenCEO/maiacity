import Aven.ID.Approve

/-! # Recovery

Who can get a vault back (`id/caps/README.md`, "Recovery"). Owners act k of n through approvals (`Aven.ID.Approve`).
Two more rules are modelled here:

- **MaiaCityGuardian's exit** (D12): one act per vault removes it as an owner and rotates the keyring, so no keyring
  epoch made after it is sealed to the guardian (`guardian_exit`). It leaves before the network opens beyond the
  founding circle; until then it is an owner like any other.
- **Removals that clash:** owners removing each other at once all stand, unless together they would leave the vault
  with no owner; then none does, and its recovery owners decide (`never_ownerless`, `removals_win`). No owner outranks
  another by seniority. -/

namespace Aven.ID

/-- A vault's keyring as its next rotation sees it: the device keys and the owners' seal keys (the passkeys' PRF-derived
ones, MaiaCityGuardian's during the evaluation phase) it is sealed to. -/
structure Keyring where
  devices : List String
  sealers : List String
  deriving DecidableEq, Repr

/-- What a rotation seals the keyring's next epoch to. -/
def Keyring.rotate (r : Keyring) : List String := r.devices ++ r.sealers

/-- MaiaCityGuardian's exit from one vault: its seal key goes, and the keyring rotates. -/
def Keyring.exit (guardian : String) (r : Keyring) : Keyring := { r with sealers := r.sealers.filter (· != guardian) }

/-- After its exit, no keyring epoch is sealed to MaiaCityGuardian. -/
theorem guardian_exit {guardian : String} {r : Keyring} (notDevice : guardian ∉ r.devices) :
    guardian ∉ (r.exit guardian).rotate := by
  simp [Keyring.rotate, Keyring.exit, notDevice]

/-- The owners left when `removed` are removed at once: all of them, unless none would be left. -/
def settleRemovals (owners removed : List String) : List String :=
  if owners.filter (· ∉ removed) = [] then owners else owners.filter (· ∉ removed)

/-- No set of removals leaves a vault without an owner. -/
theorem never_ownerless {owners removed : List String} (h : owners ≠ []) : settleRemovals owners removed ≠ [] := by
  unfold settleRemovals
  split
  · exact h
  · assumption

/-- When removals take effect, they all do: no removed owner stays, whoever removed whom first. -/
theorem removals_win {owners removed : List String} (h : settleRemovals owners removed ≠ owners) :
    ∀ x ∈ removed, x ∉ settleRemovals owners removed := by
  intro x xr xm
  unfold settleRemovals at h xm
  split at xm
  · rename_i c
    simp only [c, ↓reduceIte] at h
    exact h rfl
  · have := (List.mem_filter.mp xm).2
    simp at this
    exact this xr

end Aven.ID
