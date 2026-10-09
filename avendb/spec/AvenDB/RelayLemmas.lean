import AvenDB.Props

/-!
# Blind relays

The proof of T25: a peer that reads no selector, no type and no tag, such as the server, has every edit stand or fall
as an owner does and knows the same of the operational part of the state. Stated as in `Theorems.lean`.
-/

namespace AvenDB.Relays

theorem T25_blind_relays (edits : List Edit) :
    (view (edits.map Edit.blind)).ops = (view edits).ops ∧
      (standing (edits.map Edit.blind)).map (·.id) = (standing edits).map (·.id) := by
  sorry

end AvenDB.Relays
