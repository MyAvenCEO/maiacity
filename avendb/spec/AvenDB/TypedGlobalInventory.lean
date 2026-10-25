namespace AvenDB.TypedGlobalInventory
-- Global discovery requires an explicit nonempty bounded type request.
def admissible (explicit nonempty bounded : Bool) := explicit && nonempty && bounded
-- No authorization is inferred from discovery; projection needs current read authority.
def project (request selectedType currentRead : Bool) := request && selectedType && currentRead
theorem omitted_rejected (n b : Bool) : admissible false n b = false := by simp [admissible]
theorem empty_rejected (e b : Bool) : admissible e false b = false := by simp [admissible]
theorem unrelated_not_materialized (r a : Bool) : project r false a = false := by simp [project]
theorem unreadable_not_projected (r t : Bool) : project r t false = false := by simp [project]
end AvenDB.TypedGlobalInventory
