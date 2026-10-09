import AvenDB.Props

/-!
# Caps, cells, removals and relays

The proofs of the theorems about cap chains and cells (T22, T23), the replay and strong removal (T16, T18, the view,
the order of writes, the generations along a replay for T15), stated as in `Theorems.lean`.
-/

namespace AvenDB.Caps

theorem T22_slices_narrow {st : State} (hr : Reachable st) {c pc : Cap} (hc : c ∈ st.caps) (hp : c.parent = some pc.id)
    (hpc : pc ∈ st.caps) :
    pc.over = c.over ∧ pc.role = .owner ∧ pc.grantee = .principal (.vault c.issuer) ∧
      (∀ a, effSelects st c a = true → effSelects st pc a = true) ∧ (c.wide = true → pc.wide = true) := by
  sorry

theorem T23_cells_mean_slices {st : State} (hr : Reachable st) (en : Entry) (hcell : liveCell st en = semCell st en)
    (a : VaultId) : mayWrite st a en = semWrite st a en := by
  sorry

theorem T23_creations (st : State) (a v : VaultId) (x : Cell) (attrs : Attrs) (h : admits st a v x attrs = true) :
    mayCreate st a v x = true := by
  sorry

theorem view_eq_replay (edits : List Edit) : view edits = replay {} (standing edits) := by
  sorry

theorem writes_ordered (edits : List Edit) : Ordered (view edits).writes := by
  sorry

theorem T16_strong_removal (edits rem : List Edit) (pre post : List (Edit × Nat)) (x : Edit) (i : Nat)
    (hsplit : edits.zipIdx = pre ++ (x, i) :: post)
    (hstood : (runFrom rem (cuts edits rem) (runFrom rem (cuts edits rem) {} pre).1 [(x, i)]).2 = [x]) :
    (apply (hide (replay {} (runFrom rem (cuts edits rem) {} pre).2) (hiddenAt (cuts edits rem) i x)) x).isSome ∧
    ∀ r j, edits[j]? = some r → rem.any (·.id == r.id) → i < j → x.id ∉ r.action.keep?.getD [] →
      ∀ f ∈ removes edits r, f ∈ hiddenAt (cuts edits rem) i x := by
  sorry

theorem T16_resolved_removals_stand (edits : List Edit) :
    ∀ r ∈ resolve (order edits), (standing edits).any (·.id == r.id) := by
  sorry

theorem T18_checkpointed_writes (edits : List Edit) {w : Write} (hw : w ∈ (view (checkpointed edits)).writes) :
    ∃ c ∈ edits, c.author = w.author ∧ ∃ e covers, c.action = .checkpoint e covers ∧ w.edit ∈ covers := by
  sorry

theorem T15_no_older_epoch (edits : List Edit) (k : KeyFam) :
    ∀ st ∈ trace {} (standing edits), st.epochOf k ≤ (view edits).epochOf k := by
  sorry

end AvenDB.Caps
