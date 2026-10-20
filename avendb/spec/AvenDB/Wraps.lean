import AvenDB.Examples

/-!
# A move's wraps in one edit

A move takes an entry to another audience, and leaves the keys of the entry's earlier stays to be wrapped under the
key of its stay now (`linkAll`). Each wrap was a `keys` edit of its own, with a signature of its own: in Maia City,
11,686 of 18,955 edits, 189 MB of 316 MB, were these. A `wraps` edit carries all of one entry's at once. It is
accepted exactly where each of its wraps would be as a `keys` edit of its own, the entry's own keys alone, and like
those it changes nothing in the state (`wraps_iff`, `wraps_same`): only the boxes travel, and one signature.
-/

namespace AvenDB

/-- Key `s` is one of entry `e`'s. -/
def entryKeyOf (e : EntryId) : KeyName → Bool
  | .entry x _ _ => x == e
  | _ => false

/-- A `keys` edit of one wrap is accepted where its signer may open the key and the schedule seals it there. -/
theorem keys_one (st : State) (o : Edit) (s t : KeyName) (h : o.action = .keys s [t] false) :
    (apply st o).isSome = (mayBox st o.author s && st.seals.contains ⟨s, t⟩) := by
  unfold apply
  rw [h]
  by_cases hm : mayBox st o.author s <;> simp [hm] <;> split <;> simp_all

/-- A `wraps` edit is accepted exactly where it wraps something, only entry `e`'s keys, and each wrap would be accepted
    as a `keys` edit of its own by the same signer. -/
theorem wraps_iff (st : State) (o : Edit) (e : EntryId) (ws : List (KeyName × KeyName))
    (h : o.action = .wraps e ws) :
    (apply st o).isSome =
      (!ws.isEmpty && ws.all fun w => entryKeyOf e w.1 && (apply st { o with action := .keys w.1 [w.2] }).isSome) := by
  have hw : ∀ w : KeyName × KeyName, wrapOk st o.author e w =
      (entryKeyOf e w.1 && (apply st { o with action := .keys w.1 [w.2] }).isSome) := by
    intro w
    rw [keys_one st _ w.1 w.2 rfl]
    unfold wrapOk entryKeyOf
    cases w.1 <;> simp [Bool.and_assoc]
  have hall : ws.all (wrapOk st o.author e) =
      ws.all (fun w => entryKeyOf e w.1 && (apply st { o with action := .keys w.1 [w.2] }).isSome) := by
    congr 1
    funext w
    exact hw w
  have ha : apply st o = if (!ws.isEmpty && ws.all (wrapOk st o.author e)) = true then some st else none := by
    simp only [apply, h]
  rw [ha, hall]
  generalize (!ws.isEmpty && _) = c
  cases c <;> rfl

/-- And like a `keys` edit, it changes nothing. -/
theorem wraps_same {st post : State} {o : Edit} {e : EntryId} {ws : List (KeyName × KeyName)}
    (h : o.action = .wraps e ws) (ha : apply st o = some post) : post = st := by
  simp only [apply, h] at ha
  split at ha
  · exact (Option.some.inj ha).symm
  · cases ha

end AvenDB
namespace AvenDB.Examples

-- Welcome moved to Carol's audience: its old key goes under its new one, in one edit as in a `keys` edit
def welcomeWrap : KeyName × KeyName := (.entry welcome none 0, .entry welcome (some 51) 0)
#guard accepted s6 (attempt macA [] (.wraps welcome [welcomeWrap]))
#guard accepted s6 (attempt macA [] (.keys welcomeWrap.1 [welcomeWrap.2]))
-- not with nothing in it, nor a key of another entry, nor a wrap the schedule doesn't seal, nor by a stranger
#guard !accepted s6 (attempt macA [] (.wraps welcome []))
#guard !accepted s6 (attempt macA [] (.wraps onboarding [welcomeWrap]))
#guard !accepted s6 (attempt macA [] (.wraps welcome [(.entry welcome (some 51) 0, .entry welcome none 0)]))
#guard !accepted s6 (attempt stranger [] (.wraps welcome [welcomeWrap]))
-- one wrap it may not make refuses the whole edit
#guard !accepted s6 (attempt macA [] (.wraps welcome [welcomeWrap, (.entry welcome none 0, .entry welcome none 1)]))

end AvenDB.Examples
