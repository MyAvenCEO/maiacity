import AvenDB.State

/-!
The narrow owner-write scope uses the actual executable policy model. These
lemmas justify excluding share-op/cap-group evaluation from that one branch;
they do NOT justify excluding wide-reader key-epoch authority, or assert that
an incomplete network inventory establishes a complete authorization closure.
-/
namespace AvenDB.OwnerAuthorityScope

theorem owner_may_write (st : State) (en : Entry) :
    mayWrite st en.vault en = true := by
  simp [mayWrite]

theorem owner_may_create (st : State) (v : VaultId) (audience : Audience) :
    mayCreate st v v audience = true := by
  simp [mayCreate]

/-- Owner writes still need schema fit and counted causal dependencies. They do
not inspect a grant's group operations, proposal acceptance or share selector. -/
theorem owner_counts_reduce (st : State) (en : Entry) (deps : List EditId)
    (proof : Option ShareId) (main : Bool) (touches : List Touch) (fits : Bool) :
    counts st en.vault en deps proof main touches fits =
      (fits && deps.all (fun d => !st.uncounted.contains d)) := by
  simp [counts]

end AvenDB.OwnerAuthorityScope

namespace OwnerDependencyScheduling
-- A missing frontier is only a normal-transfer request; it never licenses
-- admission. Admission still requires every discovered frontier to be current.
def admissible (unknown : Bool) (missing : List α) : Bool := !unknown && missing.isEmpty
theorem missingNeverAdmits (unknown : Bool) (head : α) (tail : List α) :
    admissible unknown (head :: tail) = false := by simp [admissible]
theorem unknownNeverAdmits (missing : List α) :
    admissible true missing = false := by simp [admissible]
end OwnerDependencyScheduling

namespace AvenDB.OwnerAudienceClosure
/-- Every historical audience and named keep grant remains a required dependency.
A later move does not erase the authority needed to rejudge earlier writes. -/
def requiredShares (audiences : List Audience) (keeps : List ShareId) : List ShareId :=
  audiences.flatten ++ keeps

theorem historicalShareRetained (before after : List Audience) (keeps : List ShareId)
    (share : ShareId) (h : share ∈ before.flatten) :
    share ∈ requiredShares (before ++ after) keeps := by
  simp only [requiredShares, List.flatten_append, List.mem_append]
  exact Or.inl (Or.inl h)

theorem keepShareRetained (audiences : List Audience) (keeps : List ShareId)
    (share : ShareId) (h : share ∈ keeps) :
    share ∈ requiredShares audiences keeps := by
  simp only [requiredShares, List.mem_append]
  exact Or.inr h
end AvenDB.OwnerAudienceClosure

namespace AvenDB.AcceptedBaseSuffix
/-- A retained base is only a suffix starting point. It is never held history. -/
structure Evidence where
  currentBase : Bool
  currentAuthority : Bool
  signaturesValid : Bool
  localHistory : Nat

def mayReceive (e : Evidence) : Bool := e.currentBase && e.currentAuthority && e.signaturesValid
def historyCoverageAfterRequest (e : Evidence) : Nat := e.localHistory

theorem staleBaseRefused (e : Evidence) (h : e.currentBase = false) : mayReceive e = false := by
  simp [mayReceive, h]
theorem missingAuthorityRefused (e : Evidence) (h : e.currentAuthority = false) : mayReceive e = false := by
  simp [mayReceive, h]
theorem requestingSuffixDoesNotInventHistory (e : Evidence) :
    historyCoverageAfterRequest e = e.localHistory := rfl
end AvenDB.AcceptedBaseSuffix

namespace AvenDB.SuffixQueue
/-- Overflow preserves the ordinary request; only retained work leaves fallback. -/
def fallback (requested queued : List α) [DecidableEq α] : List α :=
  requested.filter (fun entry => !queued.contains entry)
theorem unqueuedRetainsFallback [DecidableEq α] (requested queued : List α)
    (entry : α) (h : entry ∈ requested) (hq : entry ∉ queued) :
    entry ∈ fallback requested queued := by
  simp [fallback, h, hq]
end AvenDB.SuffixQueue

namespace AvenDB.CheckpointProvenance
structure Witness where
  replayCurrent : Bool
  coveredStands : Bool
  checkpointStands : Bool
  checkpointSigned : Bool
  orderedBefore : Bool
  historicalActs : Bool
def valid (w : Witness) : Bool := w.replayCurrent && w.coveredStands &&
  w.checkpointStands && w.checkpointSigned && w.orderedBefore && w.historicalActs
theorem revokedRefused (w : Witness) (h : w.checkpointStands = false) : valid w = false := by
  simp [valid, h]
theorem bareCycleRefused (w : Witness) (h : w.checkpointSigned = false) : valid w = false := by
  simp [valid, h]
end AvenDB.CheckpointProvenance

namespace AvenDB.GrantRecovery
/-- Unverified fields may select ordinary transfer work but never classify. -/
def classify (verifiedSignature currentProvenance : Bool) : Bool :=
  verifiedSignature || currentProvenance
theorem hintAloneCannotClassify : classify false false = false := rfl
end AvenDB.GrantRecovery

namespace AvenDB.WitnessLocation
/-- A remote location only changes requested work. Admission still requires the
locally reconstructed current provenance, even if the location is authenticated. -/
def admitted (_hintReceived : Bool) (locallyVerified : Bool) : Bool := locallyVerified
theorem locationAddsNoAuthority (hint : Bool) : admitted hint false = false := rfl
end AvenDB.WitnessLocation

namespace MixedActorPlainScope
-- Actor identities enlarge required authority; they do not authorize writes.
def actorsClosed (actors held : List Nat) : Prop := ∀ a ∈ actors, a ∈ held
def admissible (actors held : List Nat) (plain current canonical : Bool) : Prop :=
  actorsClosed actors held ∧ plain = true ∧ current = true ∧ canonical = true
theorem groupedRejected (actors held : List Nat) (current canonical : Bool) :
    ¬ admissible actors held false current canonical := by simp [admissible]
theorem canonicalStillRequired (actors held : List Nat) (plain current : Bool) :
    ¬ admissible actors held plain current false := by simp [admissible]
theorem missingActorRejected (actors held : List Nat) (a : Nat)
    (member : a ∈ actors) (missing : a ∉ held) (plain current canonical : Bool) :
    ¬ admissible actors held plain current canonical := by
  intro h
  exact missing (h.1 a member)
end MixedActorPlainScope
namespace AvenDB.HistoricalGroups
/-- Closure uses all historical definitions, never only the latest version. -/
def includes (versions : List (List α)) : List α := versions.flatten
theorem earlierIncludeRetained (before after : List (List α)) (entry : α)
    (h : entry ∈ includes before) : entry ∈ includes (before ++ after) := by
  simp only [includes, List.flatten_append, List.mem_append] at *
  exact Or.inl h
end AvenDB.HistoricalGroups

namespace MixedOwnerBaseSuffix
-- An accepted base's writer summary grows monotonically with admitted suffixes.
-- It schedules actor authority; it never substitutes for grant/proof judgment.
def extend (base suffix : List Nat) := base ++ suffix
theorem retainsBaseActor (base suffix : List Nat) (actor : Nat) (h : actor ∈ base) :
    actor ∈ extend base suffix := List.mem_append.mpr (Or.inl h)
theorem retainsSuffixActor (base suffix : List Nat) (actor : Nat) (h : actor ∈ suffix) :
    actor ∈ extend base suffix := List.mem_append.mpr (Or.inr h)
end MixedOwnerBaseSuffix

namespace AvenDB.GroupClosure
/-- Missing group histories never become an admission result. Normal replay
still judges every write at its own place after dependency closure succeeds. -/
def ready (missing : List α) (authorityClosed : Bool) : Bool := missing.isEmpty && authorityClosed
theorem missingHistoryBlocks (group : α) (rest : List α) (authorityClosed : Bool) :
    ready (group :: rest) authorityClosed = false := by simp [ready]
end AvenDB.GroupClosure

namespace AvenDB.GroupReadScope
/-- Owner-only group writes never read another grant's group permissions. -/
def required (foreignWriter : Bool) (referenced : List α) : List α :=
  if foreignWriter then referenced else []
theorem ownerDoesNotWiden (groups : List α) : required false groups = [] := rfl
end AvenDB.GroupReadScope

namespace AvenDB.SemanticGroups
def mayMark (selectorsKnown matchingGroupsKnown : Bool) : Bool := selectorsKnown && matchingGroupsKnown
theorem unresolvedGroupCannotMark (known : Bool) : mayMark known false = false := by simp [mayMark]
end AvenDB.SemanticGroups

namespace AvenDB.GroupTransferLane
/-- Scheduling evidence selects bounded dependency bytes, never admission. -/
def allowed (requested verified : List α) : Prop := ∀ id ∈ requested, id ∈ verified
def admit (canonical current : Bool) : Bool := canonical && current
theorem outsideReferenceRejected (requested verified : List α) (id : α)
    (asked : id ∈ requested) (outside : id ∉ verified) : ¬ allowed requested verified := by
  intro h
  exact outside (h id asked)
theorem schedulingCannotAuthorize (current : Bool) : admit false current = false := by simp [admit]
end AvenDB.GroupTransferLane
