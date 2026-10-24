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
end AvenDB.ReadCompleteness
