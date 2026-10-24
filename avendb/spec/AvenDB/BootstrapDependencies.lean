/- Targeted repair only narrows an existing authorized reply. IDs and peers carry no
additional authority; delivery never replaces ordinary signature/current-policy checks. -/
namespace AvenDB.BootstrapDependencies
def selected (authorized requested sameEntry : Nat → Bool) (id : Nat) : Bool :=
  authorized id && requested id && sameEntry id
theorem selected_authorized (a r e : Nat → Bool) (id : Nat)
    (h : selected a r e id = true) : a id = true := by
  simp [selected, Bool.and_eq_true] at h
  exact h.1.1
theorem unrelated_refused (a r e : Nat → Bool) (id : Nat) (h : e id = false) :
    selected a r e id = false := by simp [selected,h]
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- Key recovery is an ordering hint on existing authorized logs, never an admission rule.
def keyPriority (active waiting authorized : Bool) : Bool := active && waiting && authorized
theorem keyPriority_requires_authority (a w p : Bool) (h : keyPriority a w p = true) : p = true := by
  simp [keyPriority, Bool.and_eq_true] at h
  exact h.2
theorem releasedView_has_no_key_priority (w p : Bool) : keyPriority false w p = false := by
  simp [keyPriority]
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- Digest equality models identical ordered lane bytes under collision resistance;
-- owner publication attests the complete lane at its accepted snapshot frontier.
def laneReady (attested : Option Nat) (localDigest : Nat) : Bool :=
  attested == some localDigest
theorem legacy_lane_not_writable (d : Nat) : laneReady none d = false := by simp [laneReady]
theorem different_lane_not_writable (a b : Nat) (h : a ≠ b) : laneReady (some a) b = false := by
  simp [laneReady, h]
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- Derived schema discovery remains a hint under the same live view lease.
def laneDemand (live authorized waiting : Bool) : Bool := live && authorized && waiting
theorem no_lane_demand_after_release (a w : Bool) : laneDemand false a w = false := by simp [laneDemand]
theorem lane_demand_needs_authority (l a w : Bool) (h : laneDemand l a w = true) : a = true := by
  simp [laneDemand, Bool.and_eq_true] at h
  exact h.1.2
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- Retirement is a separate canonical proof, never merely frontier ID presence.
def retire (bodiesComplete judgmentsAgree mainUsable noParked : Bool) : Bool :=
  bodiesComplete && judgmentsAgree && mainUsable && noParked
theorem missing_bodies_prevent_retirement (j m p : Bool) : retire false j m p = false := by simp [retire]
theorem retirement_needs_matching_judgments (b j m p : Bool) (h : retire b j m p = true) : j = true := by
  simp [retire, Bool.and_eq_true] at h
  exact h.1.1.2
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- Uncounted new suffix may mean incomplete semantic inputs, not a proven rejection.
def retireWithSuffix (baseSafe suffixCounted : Bool) : Bool := baseSafe && suffixCounted
theorem uncounted_suffix_prevents_retirement (b : Bool) : retireWithSuffix b false = false := by simp [retireWithSuffix]
end AvenDB.BootstrapDependencies

namespace AvenDB.BootstrapDependencies
-- This slice supports only already-authorized main writes with immutable grant
-- commitments. Group-dependent historical authority remains unsupported.
def sharedMainReady (currentAccepted main proofCommitted groupFree ordinaryCounts : Bool) : Bool :=
  currentAccepted && main && proofCommitted && groupFree && ordinaryCounts
theorem sharedMain_needs_policy (m p g c : Bool) : sharedMainReady false m p g c = false := by simp [sharedMainReady]
theorem sharedMain_needs_proof (a m g c : Bool) : sharedMainReady a m false g c = false := by simp [sharedMainReady]
theorem sharedMain_cannot_skip_counting (a m p g : Bool) : sharedMainReady a m p g false = false := by simp [sharedMainReady]
end AvenDB.BootstrapDependencies
