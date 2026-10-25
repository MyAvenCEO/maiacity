namespace AvenDB.WarmOrdinarySuffix
-- A stored own receipt is usable only on its authenticated ordered prefix.
-- Suffix effects must be ordinary entry-local writes; touched entries are never
-- reused. Current key and canonical fingerprint remain independent final gates.
def reuse (prefixOk ordinary untouched key fingerprint : Bool) : Bool :=
  prefixOk && ordinary && untouched && key && fingerprint
theorem touched_rebuilds (p o k f : Bool) : reuse p o false k f = false := by
  cases p <;> cases o <;> cases k <;> cases f <;> rfl
theorem unsafe_suffix_rebuilds (p u k f : Bool) : reuse p false u k f = false := by
  cases p <;> cases u <;> cases k <;> cases f <;> rfl
theorem prefix_required (p o u k f : Bool) (h : reuse p o u k f = true) : p = true := by
  cases p <;> simp_all [reuse]
theorem key_required (p o u k f : Bool) (h : reuse p o u k f = true) : k = true := by
  cases k <;> simp_all [reuse]
end AvenDB.WarmOrdinarySuffix
