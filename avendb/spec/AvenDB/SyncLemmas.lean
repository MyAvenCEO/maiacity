import AvenDB.Props

/-!
# Convergence and sync

The proofs of convergence (T11) and of sync (T12, T13, T19, T20), stated as in `Theorems.lean`.
-/

namespace AvenDB.Syncing

theorem T11_convergence {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    view edits₁ = view edits₂ := by
  sorry

theorem T11_same_standing {edits₁ edits₂ : List Edit} (hperm : edits₁.Perm edits₂) (hids : (edits₁.map Edit.id).Nodup) :
    standing edits₁ = standing edits₂ := by
  sorry

theorem T12_sync_shares_only_caps (edits : List Edit) (d : SignerId) {o : Edit} (h : o ∈ respond edits d) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) := by
  sorry

theorem T12_since (edits : List Edit) (d : SignerId) (fr : Ask) {o : Edit} (h : o ∈ respondSince edits d fr) :
    o ∈ edits ∧ ∃ l, o.log? = some l ∧ (mayReceiveLog (view edits) d l = true ∨ ∃ v, l = .vault v) := by
  sorry

theorem T19_frontier_sync (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d, o ∈ A ∨ o ∈ respondSince R d (asks A) := by
  sorry

theorem T19_frontiers_alone (A R : List Edit) (d : SignerId) (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) :
    ∀ o ∈ respond R d, o ∈ A ∨ o ∈ respondSince R d ⟨frontiers A, []⟩ := by
  sorry

theorem T19_same_frontier (lgA lgR : Edit → Option LogId) (A R : List Edit) (l : LogId)
    (hid : ∀ a ∈ A, ∀ b ∈ R, a.id = b.id → a = b) (huA : ∀ a ∈ A, ∀ b ∈ A, a.id = b.id → a = b)
    (huR : ∀ a ∈ R, ∀ b ∈ R, a.id = b.id → a = b) (hf : frontier lgA A l = frontier lgR R l) (x : Edit) :
    x ∈ closedPart lgA A l ↔ x ∈ closedPart lgR R l := by
  sorry

theorem T13_sync_converges (editsP editsQ : List Edit) (dp dq : SignerId) (e : EntryId)
    (hid : ∀ a ∈ editsP, ∀ b ∈ editsQ, a.id = b.id → a = b)
    (hp : mayReceive (view editsQ) dp e = true) (hq : mayReceive (view editsP) dq e = true)
    (o : Edit) (hop : o.log? = some (.entry e)) :
    o ∈ receive editsP (respondSince editsQ dp (asks editsP)) ↔
      o ∈ receive editsQ (respondSince editsP dq (asks editsQ)) := by
  sorry

theorem T20_link_shares_only_vault_logs (edits : List Edit) (p : SignerId) {o : Edit} (h : o ∈ linkCard edits p) :
    o ∈ edits ∧ ∃ v, o.log? = some (.vault v) ∧ v ∈ closeVaults (view edits) (view edits).depth (ownedBy (view edits) p) := by
  sorry

theorem T20_stranger_gets_nothing (edits : List Edit) (p : SignerId) (h : ownedBy (view edits) p = []) :
    linkCard edits p = [] := by
  sorry

end AvenDB.Syncing
