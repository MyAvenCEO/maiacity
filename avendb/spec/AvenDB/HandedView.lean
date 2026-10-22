import AvenDB.StoredView

/-!
# Handed views

The proof of V7: a new device of a person starts from the stored view another device of the same passkey handed it
(M6 of the master plan), not from a replay of every edit. The view is of the edits the giver held, in whatever order
it took them; the new device holds those edits and others, in whatever order it took them. The view of all it holds is
the handed view with the others stepped on one by one, in the replay order, and the edits that stand are those that
stood with the others that step, where the others are writes, each deeper than every edit the view is of, and none of
those builds on one of them (`V7_handed_view`). Else the device steps them on as V4 says, or replays them all.

The replay order sorts any arrangement of the same edits, with distinct ids, into one list (T11), so the order each
device took them in counts for nothing; V1 does the rest. That the handed view is the giver's view of those edits is
trust, not a theorem: only a device that holds the passkey opens or makes it, and the passkey already signs as the
vault's owner.
-/

namespace AvenDB.Handed

open Syncing

/-- A handed view is of a set of edits: two devices that hold the same edits, with distinct ids, in any order, hand
    the same view, with the same edits standing. -/
theorem handed_any_order {held held' : List Edit} (hperm : held.Perm held') (hids : (held.map Edit.id).Nodup) :
    view held = view held' ∧ standing held = standing held' :=
  ⟨T11_convergence hperm hids, T11_same_standing hperm hids⟩

/-- V7: a device that holds the edits a view is of and new ones, in any order, knows what replaying every edit would
    tell it by stepping the new ones on the view, where they are writes, each deeper than every edit the view is of,
    and no edit the view is of builds on one of them. -/
theorem V7_handed_view (held new mine : List Edit) (hperm : mine.Perm (held ++ new))
    (hw : ∀ n ∈ new, n.action.isWrite = true) (hd : ∀ e ∈ held, ∀ n ∈ new, e.depth < n.depth)
    (hp : ∀ e ∈ held, ∀ n ∈ new, n.id ∉ e.parents) (hids : (mine.map Edit.id).Nodup) :
    view mine = (stepsOn (view held) (order new)).1 ∧
      standing mine = standing held ++ (stepsOn (view held) (order new)).2 := by
  have hids' : ((held ++ new).map Edit.id).Nodup := ((hperm.map Edit.id).nodup_iff).1 hids
  rw [T11_convergence hperm hids, T11_same_standing hperm hids]
  exact Stored.V1_view_steps_on held new hw hd hp hids'

/-- V7, nothing new: a device that holds just the edits a view is of, in any order, knows what replaying them would
    tell it from the view alone. -/
theorem V7_handed_whole {held mine : List Edit} (hperm : mine.Perm held) (hids : (mine.map Edit.id).Nodup) :
    view mine = view held ∧ standing mine = standing held :=
  handed_any_order hperm hids

end AvenDB.Handed
