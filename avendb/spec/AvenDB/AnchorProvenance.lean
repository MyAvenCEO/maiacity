/- Active owner bases remain partial even when ordinary writes are enabled.
Current authority and exact held log are implementation premises, not inferred
from a retained optimization hint. -/
namespace AvenDB.AnchorProvenance

def hint (active current authorized : Bool) : Bool := active && current && authorized

theorem revoked_no_hint (a c : Bool) : hint a c false = false := by simp [hint]
theorem pending_no_hint (a p : Bool) : hint a false p = false := by simp [hint]

def historyComplete (_active : Bool) : Bool := false

theorem writable_not_complete : historyComplete true = false := rfl
end AvenDB.AnchorProvenance
