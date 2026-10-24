/-! File inventory projects canonical authorized local rows. Authorization and
query-to-row correspondence remain engine premises, not established by this model.
Unavailable inventory must not invalidate a previously usable local URL. -/
namespace AvenDB.LocalFileInventory

def retainOnUnavailable (previous : Option α) (inventory : Option (Option α)) : Option α :=
  inventory.getD previous

theorem unavailableRetains (previous : Option α) :
    retainOnUnavailable previous none = previous := rfl

theorem confirmedMissingClears (previous : Option α) :
    retainOnUnavailable previous (some none) = none := rfl

def fileRows (rows : List α) (isFile : α → Bool) : List α := rows.filter isFile

theorem noNewRows (rows : List α) (isFile : α → Bool) (row : α)
    (held : row ∈ fileRows rows isFile) : row ∈ rows := by
  exact (List.mem_filter.mp held).1

end AvenDB.LocalFileInventory
