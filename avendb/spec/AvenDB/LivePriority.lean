/-!
Live edits are ordinary signed edits. Local priority hints only choose the order of the same authorized
reconciliation; they never authorize data, certify closure, or replace validation. Full inventories remain
background work. Runtime FIFO semaphore behavior and finite completion/cancellation of admitted work are
assumptions tested in Rust. The FIFO laws below rule out overtaking by later arrivals, conditional on service;
they do not claim a wall-clock latency bound or prove the absence of CPU/network stalls.

Rust mapping: avendb-net/src/pulls.rs LiveWork/Budget and live.rs pull_live. All peers use the same rules;
there is no server authority input. Interactive tests use actual ordinary peer connections without a server.
-/
namespace AvenDB.LivePriority

/-- An established-connection delta can hint at most `limit` logs. -/
def eligible (full : Bool) (count limit : Nat) : Bool :=
  !full && decide (0 < count ∧ count ≤ limit)

theorem full_is_not_interactive (count limit : Nat) : eligible true count limit = false := by
  simp [eligible]

theorem oversized_is_not_interactive (count limit : Nat) (h : limit < count) :
    eligible false count limit = false := by
  simp [eligible, Nat.not_le.mpr h]

/-- Coalescing may retain fewer distinct IDs; it must never retain more than this bound. -/
def retained (pending added limit : Nat) : Nat := min limit (pending + added)

theorem hints_are_bounded (pending added limit : Nat) : retained pending added limit ≤ limit := by
  exact Nat.min_le_left _ _

/-- A small delta may repeat a causal witness frontier only alongside an actual change. Replaying an identical
frame does not fabricate new priority. Rust maps this to announced_hints before updating holdings. -/
def admitDelta (full changed : Bool) (count limit : Nat) : Bool := eligible full count limit && changed

theorem duplicate_only_frame_has_no_priority (full : Bool) (count limit : Nat) :
    admitDelta full false count limit = false := by simp [admitDelta]

/-- Witness candidates are intersected with the SAME permission-redacted outgoing holdings and share the total
hint budget. They are availability hints, not permission evidence. Rust selects one earlier original-audience
creation as a witness for initial audience keys; complex moves are left to normal reconciliation. This model
does not prove that such a witness closes arbitrary cross-log causality or extract the Rust selection algorithm. -/
def witnessHint (candidate permitted space : Bool) : Bool := candidate && permitted && space

theorem witness_never_expands_disclosure (candidate permitted space : Bool)
    (h : witnessHint candidate permitted space = true) : permitted = true := by
  cases candidate <;> cases permitted <;> cases space <;> simp_all [witnessHint]

theorem full_hint_budget_adds_no_witness (candidate permitted : Bool) :
    witnessHint candidate permitted false = false := by simp [witnessHint]

/-- The output retains the complete `(log, frontier)` pairs and has strictly ascending log IDs.
This is an abstract postcondition, not an extracted implementation or a proof of Rust's sort.
The Rust round-trip regression must establish the concrete decoder ordering contract. -/
def canonicalHints (before after : List (Nat × F)) : Prop :=
  before.Perm after ∧ after.Pairwise (fun a b => a.1 < b.1)

theorem canonical_hint_pairs_preserved (before after : List (Nat × F))
    (h : canonicalHints before after) (log : Nat) (frontier : F) :
    (log, frontier) ∈ after ↔ (log, frontier) ∈ before := by
  exact h.1.mem_iff.symm

theorem canonical_hint_bound_preserved (before after : List (Nat × F))
    (h : canonicalHints before after) (limit : Nat) (bound : before.length ≤ limit) :
    after.length ≤ limit := by
  rw [← h.1.length_eq]
  exact bound

theorem canonical_hints_satisfy_order (before after : List (Nat × F))
    (h : canonicalHints before after) : after.Pairwise (fun a b => a.1 < b.1) := h.2

/-- `missing` is the ordinary peer-scoped difference, already filtered for disclosure. Hints do not expand it.
Actual response acceptance still independently checks signatures, authorization and causal requirements. -/
def selected (hint missing dependenciesReady : Bool) : Bool := hint && missing && dependenciesReady

theorem priority_does_not_widen (hint missing dependenciesReady : Bool)
    (h : selected hint missing dependenciesReady = true) : missing = true := by
  cases hint <;> cases missing <;> cases dependenciesReady <;> simp_all [selected]

theorem dependencies_first (hint missing : Bool) : selected hint missing false = false := by
  simp [selected]

def accepted (selected valid authorized : Bool) : Bool := selected && valid && authorized

theorem invalid_never_accepted (selected authorized : Bool) : accepted selected false authorized = false := by
  simp [accepted]

theorem unauthorized_never_accepted (selected valid : Bool) : accepted selected valid false = false := by
  simp [accepted]

/-- A priority scope is bound to the authenticated signer that announced it, even if an endpoint reconnects. -/
def acceptedFrom (announcer connected : Nat) (selected valid authorized : Bool) : Bool :=
  if announcer = connected then accepted selected valid authorized else false

theorem identity_change_yields_nothing (announcer connected : Nat) (selected valid authorized : Bool)
    (h : announcer ≠ connected) : acceptedFrom announcer connected selected valid authorized = false := by
  simp [acceptedFrom, h]

/-- A completed/cancelled worker can remove its own queue generation only. -/
def finish (owner : Nat) (queued : Option (Nat × List K)) : Option (Nat × List K) :=
  match queued with
  | none => none
  | some (current, _logs) => if owner = current then none else queued

theorem old_worker_keeps_replacement (old fresh : Nat) (logs : List K) (h : old ≠ fresh) :
    finish old (some (fresh, logs)) = some (fresh, logs) := by
  simp [finish, h]

/-- Normal and interactive admissions use a shared FIFO service queue after their bounded class admission. -/
def arrive (queue : List K) (job : K) : List K := queue ++ [job]

def serve (queue : List K) : List K := queue.tail

theorem later_arrival_cannot_overtake (first new : K) (rest : List K) :
    (arrive (first :: rest) new).head? = some first := by
  simp [arrive]

theorem service_preserves_waiters (first new : K) (rest : List K) :
    serve (arrive (first :: rest) new) = arrive rest new := by
  simp [serve, arrive]

/-- Once all earlier work is serviced, a queued background request is next regardless of later interactive
arrivals. This is a conditional progress claim, requiring those earlier operations to finish or be cancelled. -/
theorem queued_background_eventually_first (before after : List K) (background : K) :
    ((before ++ background :: after).drop before.length).head? = some background := by
  simp

/-- Abstract publication order: an earlier receive wake can precede materialization. The completion barrier
must publish the current view even when an earlier catch-up already applied it. These revisions stand for
observable ordering, not the runtime watch channel's numeric value or a proof of subscriber scheduling. -/
structure Publication where
  applied : Nat
  notified : Nat

def publish (s : Publication) : Publication := { s with notified := s.applied }

theorem publication_closes_materialization_gap (s : Publication) :
    (publish s).notified = (publish s).applied := rfl

/-- Catch-up returning "no further change" does not mean the consumer saw an earlier replay. -/
theorem earlier_catch_up_still_gets_a_wake (old current : Nat) :
    (publish ⟨current, old⟩).notified = current := rfl

/-- Queueing a discovered ID does not await an optional checkpoint. Actual selection
still requires ordinary missing-log membership and authority readiness. -/
def discoveredQueue (ids : List Nat) (_checkpointReady : Bool) := ids

theorem discovery_queue_independent_of_checkpoint (ids : List Nat) :
    discoveredQueue ids false = discoveredQueue ids true := rfl

theorem queued_hint_still_requires_authority (hint missing : Bool) :
    selected hint missing false = false := dependencies_first hint missing

end AvenDB.LivePriority
