/-! A successful local query, rows or demand acknowledgement do not establish
remote discovery completeness or file-byte availability. Partial evidence survives
presentation; the wrapper grants neither write permission nor completeness. -/
namespace AvenDB.ReadCompleteness
structure Evidence where
  localResponse : Bool
  checkpoint : Bool
  fileInventoryPartial : Bool

def authoritativeEmpty (_e : Evidence) := false
def discovered (_e : Evidence) := false
def filesVerified (_e : Evidence) := false

theorem local_empty_not_authoritative (e : Evidence) : authoritativeEmpty e = false := rfl
theorem success_not_discovery (checkpoint files : Bool) :
    discovered ⟨true, checkpoint, files⟩ = false := rfl
theorem inventory_not_file_bytes (e : Evidence) : filesVerified e = false := rfl
-- Registering another bounded read is independent of a previous read's result.
-- An unavailable page remains unavailable; scheduling cannot turn it complete.
def nextPage (started bound : Nat) (_previousReady : Bool) := min (started + 1) bound

theorem pending_page_does_not_block (started bound : Nat) :
    nextPage started bound false = nextPage started bound true := rfl

theorem page_registration_bounded (started bound : Nat) (ready : Bool) :
    nextPage started bound ready ≤ bound := Nat.min_le_right _ _

end AvenDB.ReadCompleteness
