/-! A transient grouping of held-log file roots preserves each entry's receipt order.
This specification does not replace policy authorization or prove the Rust container implementation.
Native differential tests connect the implementation to the original scan. -/
namespace AvenDB.EntryFilesBatch
variable {Entry Root : Type} [DecidableEq Entry]

-- One visit per held edit, grouping only the selected entries.
def group (selected : Entry → Bool) : List (Entry × List Root) → Entry → List Root
  | [], _ => []
  | (entry, roots) :: rest, wanted =>
    if selected entry && decide (entry = wanted) then roots ++ group selected rest wanted
    else group selected rest wanted

def scan (wanted : Entry) : List (Entry × List Root) → List Root
  | [] => []
  | (entry, roots) :: rest =>
    if entry = wanted then roots ++ scan wanted rest else scan wanted rest

theorem selected_parity (selected : Entry → Bool) (wanted : Entry) (h : selected wanted = true)
    (edits : List (Entry × List Root)) : group selected edits wanted = scan wanted edits := by
  induction edits with
  | nil => rfl
  | cons edit rest ih =>
    rcases edit with ⟨entry, roots⟩
    by_cases eq : entry = wanted
    · subst entry
      simp [group, scan, h, ih]
    · simp [group, scan, eq, ih]

theorem unselected_empty (selected : Entry → Bool) (wanted : Entry) (h : selected wanted = false)
    (edits : List (Entry × List Root)) : group selected edits wanted = [] := by
  induction edits with
  | nil => rfl
  | cons edit rest ih =>
    rcases edit with ⟨entry, roots⟩
    by_cases eq : entry = wanted
    · subst entry
      simp [group, h, ih]
    · simp [group, eq, ih]

-- The same first-occurrence deduplication and current-device length lookup follows either path.
-- Keeping that postprocessing identical also preserves missing-key/unknown-length results.
theorem resolved_parity (selected : Entry → Bool) (wanted : Entry) (h : selected wanted = true)
    (edits : List (Entry × List Root)) (resolve : List Root → Result) :
    resolve (group selected edits wanted) = resolve (scan wanted edits) := by
  rw [selected_parity selected wanted h]
end AvenDB.EntryFilesBatch
