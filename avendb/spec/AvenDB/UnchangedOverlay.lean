/- Process-local reuse only. Exact log/key/material/anchor identity and current
policy authorization are implementation premises. No peer-provided cache is trusted. -/
namespace AvenDB.UnchangedOverlay

def reuse (sameBasis authorized : Bool) : Bool := sameBasis && authorized

theorem changed_inactive (authorized : Bool) : reuse false authorized = false := by simp [reuse]
theorem revoked_inactive (same : Bool) : reuse same false = false := by simp [reuse]
theorem reuse_requires_authority (same authorized : Bool) (h : reuse same authorized = true) : authorized = true := by
  simp only [reuse, Bool.and_eq_true] at h
  exact h.2

def restore (same authorized : Bool) (derived canonical : α) : α :=
 if reuse same authorized then derived else canonical

theorem revoked_fallback (same : Bool) (derived canonical : α) : restore same false derived canonical = canonical := by
 simp [restore, reuse]
end AvenDB.UnchangedOverlay
