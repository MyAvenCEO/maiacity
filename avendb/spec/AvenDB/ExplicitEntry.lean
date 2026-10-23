/-!
# An explicit view target does not depend on local availability

UI mapping: Docs.svelte selects `entry || docs[0]?.e.entry`, then looks up metadata for that exact target.
Note.svelte reads its explicit `entry` without requiring a world row first. Both use the existing read window;
that window registers positive entry IDs before the local read and refuses stale device/read generations.
Keys model valid entry IDs: Shell.parse validates explicit route IDs and queryEntries validates demand IDs.

This model proves selection and publication identity only. The API still checks read authorization, and a
missing local row is not evidence of remote absence or query completeness. No authority or content is cached
by `target` or `demand`. Runtime component tests cover the JS/Svelte correspondence and window cleanup.
-/
namespace AvenDB.ExplicitEntry

variable {Key Value : Type}

def target (explicit : Option Key) (held : List Key) : Option Key :=
  match explicit with
  | some id => some id
  | none => held.head?

theorem explicit_survives_missing_local (id : Key) (held : List Key) :
    target (some id) held = some id := rfl

theorem local_changes_cannot_replace_explicit (id : Key) (before after : List Key) :
    target (some id) before = target (some id) after := rfl

theorem default_only_without_explicit (held : List Key) :
    target none held = held.head? := rfl

def demand (selected : Option Key) : List Key :=
  match selected with
  | some id => [id]
  | none => []

theorem explicit_demand_is_independent_of_local (id : Key) (held : List Key) :
    demand (target (some id) held) = [id] := rfl

/-- The response remains bound to the target it was read for. This is separate from the read window's
generation/device checks; neither check grants permission to read a record. -/
def shown [DecidableEq Key] (selected : Key) (result : Option (Key × Value)) : Option Value :=
  match result with
  | none => none
  | some (readFor, value) => if readFor = selected then some value else none

theorem other_target_is_never_shown [DecidableEq Key] (selected readFor : Key) (value : Value)
    (different : readFor ≠ selected) : shown selected (some (readFor, value)) = none := by
  simp [shown, different]

theorem current_target_preserves_answer [DecidableEq Key] (selected : Key) (value : Value) :
    shown selected (some (selected, value)) = some value := by
  simp [shown]

end AvenDB.ExplicitEntry
