import AvenDB.Logs

/-!
Availability of a file read across ordinary peers.

This is a specification of `avendb-net/src/files.rs::receive_file/get_from`, not an extraction
of Rust, QUIC, the store or its timers. The clock is abstract monotone ticks. Before a new wait,
an expired idle deadline ends that attempt; an observed payload count renews it only if it
strictly increases. The model assumes the runtime timeout and dropping the owned receive
stream release that attempt. It proves no wall-clock bound or scheduler fairness.

Payload progress and retained verified ranges are deliberately separate. In pinned
iroh-blobs 0.103.1, api/remote.rs:915–924 reports payload progress before sending the decoded
item to the importer; :934–942 awaits importer completion. A progress event therefore says
nothing about import acknowledgement, durable storage or whole-file completeness.

`held` denotes verified ranges already retained by the local store, not all bytes read.
Their survival across cancellation/failure assumes the store's verified-range retention
contract and absence of unrelated eviction. These laws do not prove crash/fsync durability.
The store/crypto implementation must establish `verified`; no remote claim can establish it.
Provider order is only availability policy. Every selected provider uses the existing
authenticated-connection/current-vault-permission `Node.hands` gate (Logs.lean, T27); choosing
a provider adds no grant and no server role is privileged.

Rust correspondence:
* an_idle_provider_is_dropped_not_left_downloading: expiry plus owned receive-stream drop.
* progressing_files_outlive_the_idle_window: increasing counters renew, no total deadline.
* duplicate_progress_does_not_extend_a_stalled_provider: equal/decreasing counters do not renew.
* cancelling_a_file_read_drops_its_receive_future: cancellation ends the owned attempt.
* a_stalled_file_provider_yields_to_an_authorized_peer: fallback through the unchanged gate,
  exact plaintext, and surviving sync connection. It does NOT yet exercise a first provider
  importing partial ranges before stalling; preservation/resume remains a store assumption
  here, requiring that additional runtime scenario. No Rust test is claimed executed here.
-/

namespace AvenDB.FileAvailability

structure Attempt where
  payloadSeen : Nat
  deadline : Nat
  deriving DecidableEq, Repr

def start (now idle : Nat) : Attempt := ⟨0, now + idle⟩

/-- A progress item observed during a live attempt. Expiry is checked before waiting again.
An event/timeout race at the runtime boundary is outside this discrete model. -/
def progress (a : Attempt) (now idle payload : Nat) : Option Attempt :=
  if now < a.deadline then
    some (if a.payloadSeen < payload then ⟨payload, now + idle⟩ else a)
  else none

theorem expired_attempt_ends (a : Attempt) (now idle payload : Nat)
    (h : a.deadline ≤ now) : progress a now idle payload = none := by
  simp [progress, Nat.not_lt.mpr h]

theorem nonadvancing_payload_keeps_deadline (a : Attempt) (now idle payload : Nat)
    (live : now < a.deadline) (sameOrLess : payload ≤ a.payloadSeen) :
    progress a now idle payload = some a := by
  simp [progress, live, Nat.not_lt.mpr sameOrLess]

theorem advancing_payload_renews (a : Attempt) (now idle payload : Nat)
    (live : now < a.deadline) (grows : a.payloadSeen < payload) :
    progress a now idle payload = some ⟨payload, now + idle⟩ := by
  simp [progress, live, grows]

/-- Like the Rust duplicate-progress scenario: the first advance renews until tick four;
equal or lower counters do not keep the provider alive beyond it. -/
theorem duplicate_progress_scenario :
    progress (start 0 3) 1 3 16 = some ⟨16, 4⟩ ∧
    progress ⟨16, 4⟩ 2 3 16 = some ⟨16, 4⟩ ∧
    progress ⟨16, 4⟩ 3 3 8 = some ⟨16, 4⟩ ∧
    progress ⟨16, 4⟩ 4 3 16 = none := by decide

/-- A transfer may continue past its original idle window while new payload keeps arriving.
This is a finite trace, not a guarantee that any real network eventually makes progress. -/
theorem progressing_transfer_outlives_initial_window :
    progress (start 0 5) 4 5 1 = some ⟨1, 9⟩ ∧
    progress ⟨1, 9⟩ 8 5 2 = some ⟨2, 13⟩ ∧
    progress ⟨2, 13⟩ 12 5 3 = some ⟨3, 17⟩ ∧
    progress ⟨3, 17⟩ 16 5 4 = some ⟨4, 21⟩ ∧
    progress ⟨4, 21⟩ 20 5 5 = some ⟨5, 25⟩ ∧ 24 < 25 := by decide

/-- Range identities include their blob/hash context, so a range of another blob is not equal.
This model abstracts verified byte/chunk ranges, not avenDB log-ID reconciliation ranges. -/
abbrev Ranges (K : Type) := K → Bool

structure ReadState (K : Type) where
  held : Ranges K
  attempt : Option Attempt

def observe (s : ReadState K) (now idle payload : Nat) : ReadState K :=
  { s with attempt := s.attempt.bind fun a => progress a now idle payload }

/-- Progress counters cannot manufacture local availability. -/
theorem progress_does_not_import (s : ReadState K) (now idle payload : Nat) :
    (observe s now idle payload).held = s.held := rfl

inductive EndReason where
  | idle | failed | cancelled | finished
  deriving DecidableEq, Repr

/-- These outcomes terminate the request, not the authenticated sync connection. Runtime drop
ownership is an assumption; the model does not contain a detached receive task. -/
def finish (_reason : EndReason) (s : ReadState K) : ReadState K :=
  { s with attempt := none }

theorem ended_attempt_has_no_receiver (reason : EndReason) (s : ReadState K) :
    (finish reason s).attempt = none := rfl

theorem failure_preserves_verified_ranges (s : ReadState K) :
    (finish .failed s).held = s.held := rfl

theorem cancellation_preserves_verified_ranges (s : ReadState K) :
    (finish .cancelled s).held = s.held := rfl

theorem idle_preserves_verified_ranges (s : ReadState K) :
    (finish .idle s).held = s.held := rfl

/-- Only independently verified imports can add retained ranges. In the implementation this
predicate is established by the content-addressed store's proof decoder/importer, not a peer. -/
def importRanges (s : ReadState K) (offered verified : Ranges K) : ReadState K :=
  { s with held := fun k => s.held k || (offered k && verified k) }

theorem existing_range_survives_import (s : ReadState K) (offered verified : Ranges K)
    (k : K) (h : s.held k = true) : (importRanges s offered verified).held k = true := by
  simp [importRanges, h]

theorem unverified_range_not_added (s : ReadState K) (offered verified : Ranges K)
    (k : K) (h : verified k = false) : (importRanges s offered verified).held k = s.held k := by
  simp [importRanges, h]

def missing (s : ReadState K) (requested : Ranges K) : Ranges K :=
  fun k => requested k && !s.held k

theorem next_provider_does_not_request_retained_range (s : ReadState K) (requested : Ranges K)
    (reason : EndReason) (k : K) (h : s.held k = true) :
    missing (finish reason s) requested k = false := by
  simp [missing, finish, h]

theorem next_provider_requests_only_requested_ranges (s : ReadState K) (requested : Ranges K)
    (k : K) (h : missing s requested k = true) : requested k = true := by
  simp only [missing, Bool.and_eq_true] at h
  exact h.1

/-- Explicit retained-partial-range trace: import then fail then recompute what is missing.
This proves the abstract retention contract; the existing stalled-provider test starts empty. -/
theorem partial_import_survives_failed_attempt (s : ReadState K) (offered verified requested : Ranges K)
    (k : K) (ho : offered k = true) (hv : verified k = true) :
    missing (finish .failed (importRanges s offered verified)) requested k = false := by
  simp [missing, finish, importRanges, ho, hv]

def complete (s : ReadState K) (requested : List K) : Bool := requested.all s.held

/-- Even a successful receive result is not the source of completeness; get_from checks the
local store again, also after failure. Conversely, failure cannot erase completed local data. -/
theorem receive_outcome_does_not_define_completeness (s : ReadState K) (requested : List K)
    (reason : EndReason) : complete (finish reason s) requested = complete s requested := rfl

def nextProvider (providers : List EndpointId) : List EndpointId := providers.tail

/-- Each provider has its own current validated state. This is the SERVING peer's decision
about the authenticated requester, not a requester claiming its own permission. -/
def selectedGate (states : EndpointId → Node) (providers : List EndpointId)
    (requester : EndpointId) (blob : FileBlob) (follow : List VaultId := []) : Bool :=
  match providers.head? with
  | none => false
  | some provider => (states provider).hands requester blob follow

theorem no_provider_grants_nothing (states : EndpointId → Node) (requester : EndpointId)
    (blob : FileBlob) (follow : List VaultId) :
    selectedGate states [] requester blob follow = false := rfl

theorem next_selection_uses_existing_gate (states : EndpointId → Node)
    (first next : EndpointId) (rest : List EndpointId) (requester : EndpointId)
    (blob : FileBlob) (follow : List VaultId) :
    selectedGate states (nextProvider (first :: next :: rest)) requester blob follow =
      (states next).hands requester blob follow := rfl

theorem fallback_does_not_grant_rights (states : EndpointId → Node)
    (first next : EndpointId) (rest : List EndpointId) (requester : EndpointId)
    (blob : FileBlob) (follow : List VaultId)
    (denied : (states next).hands requester blob follow = false) :
    selectedGate states (nextProvider (first :: next :: rest)) requester blob follow = false := by
  exact denied

/-- Claimed holdings may change the availability ordering, but cannot change the same selected
peer's gate. This directly reuses the existing Node.hands definition; it does not re-prove T27. -/
theorem holdings_do_not_change_gate (n : Node) (heard : List (Conn × Announce))
    (files : List (FileId × FileHold)) (requester : EndpointId) (blob : FileBlob)
    (follow : List VaultId) :
    { n with heard, files }.hands requester blob follow = n.hands requester blob follow := rfl

end AvenDB.FileAvailability
