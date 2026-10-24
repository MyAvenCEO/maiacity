/-! Local discovery consumes canonical authorized query results. Broad world summaries and
remote feeds are not authorization evidence or prerequisites. This abstract model covers
separate dependencies and stale-owner rejection, not JavaScript scheduling latency. -/
namespace AvenDB.LocalDiscovery
structure Context where
  owner : Nat
  generation : Nat
  deriving DecidableEq

def publish (current reply : Context) (authorizedRows : List Nat) : List Nat :=
  if current = reply then authorizedRows else []

theorem same_context (ctx : Context) (rows : List Nat) : publish ctx ctx rows = rows := by
  simp [publish]

theorem stale_context (current reply : Context) (h : current ≠ reply) (rows : List Nat) :
    publish current reply rows = [] := by simp [publish, h]

def discover (current reply : Context) (authorizedRows : List Nat)
    (_worldReady _remoteReady : Bool) : List Nat := publish current reply authorizedRows

theorem independent_of_background (current reply : Context) (rows : List Nat)
    (w₁ w₂ r₁ r₂ : Bool) : discover current reply rows w₁ r₁ = discover current reply rows w₂ r₂ := rfl

theorem no_extra_rows (current reply : Context) (rows : List Nat) (id : Nat)
    (h : id ∈ publish current reply rows) : id ∈ rows := by
  unfold publish at h
  split at h
  · exact h
  · simp at h
end AvenDB.LocalDiscovery
