/-! Reusing a judged scratch item is permitted only for the exact canonical line
history and a fully imported document. Authentication and counted-history selection
remain upstream; a failed guard rebuilds through the canonical importer.
The projection-agreement premise is the Loro/history law exercised by native
record/version parity regressions, not an assertion that Lean verifies Rust/Loro. -/
namespace AvenDB.ShownScratch

def select (eligible : Bool) (scratch canonical : α) : α :=
  if eligible then scratch else canonical

theorem guarded_projection (eligible : Bool) (scratch canonical : α)
    (agreement : eligible = true → scratch = canonical) :
    select eligible scratch canonical = canonical := by
  cases eligible <;> simp_all [select]

theorem fallback (scratch canonical : α) : select false scratch canonical = canonical := rfl
end AvenDB.ShownScratch
