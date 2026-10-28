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

/-! ## One asking per log (F12, batch 5)

A live pull and the backlog asked the SAME logs of the same peer at once: the backlog's request named what the device
held before the live pull took the edit, so the peer sent it twice (Mac `network.recent`, batch 3: a live edit pulled
new, then again with new 0, its duplicate's check up to 5.9 s). The live lane now claims its hinted logs as it is
admitted, before the backlog is stirred; the backlog's asking leaves every live-claimed log out and is owed an asking
again once the live pull ends, however it ends. Rust: avendb-net lib.rs `Claims::take` / `Claims::live` /
`Claims::live_done`, live.rs `LiveClaimed`. -/

/-- The backlog's share of `differing` while `live` is claimed: the logs it asks now, and whether it is owed another
asking for those it left to the live lane. -/
def backlogTake (live differing : List Nat) : List Nat × Bool :=
  (differing.filter (fun l => !live.contains l), differing.any (fun l => live.contains l))

theorem backlog_never_asks_a_live_log (live differing : List Nat) (l : Nat) (h : l ∈ live) :
    l ∉ (backlogTake live differing).1 := by
  simp [backlogTake, List.mem_filter, h]

theorem backlog_asks_only_what_differs (live differing : List Nat) (l : Nat)
    (h : l ∈ (backlogTake live differing).1) : l ∈ differing := by
  simp [backlogTake, List.mem_filter] at h
  exact h.1

/-- Nothing is dropped: a differing log is asked by the backlog now, or the backlog is owed an asking again, which
the live pull's end gives it (`Claims::live_done`) whether the live pull took the log, timed out or failed. -/
theorem no_differing_log_is_lost (live differing : List Nat) (l : Nat) (h : l ∈ differing) :
    l ∈ (backlogTake live differing).1 ∨ (backlogTake live differing).2 = true := by
  by_cases hl : l ∈ live
  · right
    simp only [backlogTake, List.any_eq_true]
    exact ⟨l, h, by simp [hl]⟩
  · left
    simp [backlogTake, List.mem_filter, h, hl]

/-- With nothing live-claimed, the backlog asks exactly as before. -/
theorem no_live_claim_changes_nothing (differing : List Nat) :
    backlogTake [] differing = (differing, false) := by
  simp [backlogTake]

/-! ## A bounded live view (F2, batch 5)

A live pull brought its view up to date by draining the WHOLE pending catch-up (`materialize_live` looped
`Lab::catch_up_step` until caught), so during a bulk catch-up, or while a catch-up never settled, the live lane never
ended and held its peer's slot (batch 4: one live start on the Mac in 25 min, never recorded). It now steps the view
for at most `LIVE_VIEW`, and the background catch-up takes the rest. The same steps are done, only by another owner. -/

/-- `work` steps of catch-up, of which the live lane takes at most `budget`. -/
def liveSteps (work budget : Nat) : Nat := min work budget
def backgroundSteps (work budget : Nat) : Nat := work - budget

theorem live_view_is_bounded (work budget : Nat) : liveSteps work budget ≤ budget := Nat.min_le_right _ _

theorem split_view_does_all_the_work (work budget : Nat) :
    liveSteps work budget + backgroundSteps work budget = work := by
  simp only [liveSteps, backgroundSteps]; omega

/-! ## One asking of a peer at a time (F12, batch 5)

A peer answers an asking with what it holds beyond what the request names. Two askings of one peer at once named the
same holdings, so the second brought all the first took again (sync_bench `bench_live`, 1,352 edits pulled for 675
new). The second now waits for the first's turn to end and names what it took. Rust: pulls.rs `Budget::one_asking`. -/

/-- What a peer holding `theirs` sends to a request naming `named`. -/
def reply (theirs named : List Nat) : List Nat := theirs.filter (fun e => !named.contains e)

/-- The second asking, made once the first's reply is held: it brings nothing the first brought. -/
theorem one_asking_resends_nothing (theirs held : List Nat) (e : Nat)
    (first : e ∈ reply theirs held) : e ∉ reply theirs (held ++ reply theirs held) := by
  simp [reply, List.mem_filter] at *
  intro _ _
  exact first

/-! ## A live edit's pages told at the step that shows it (batch 5)

The Lab shows a live edit's entries in the first steps of a catch-up (Writes.lean `live_in_first_step`). The live lane
now stirs the pages after every step it takes (`Shared::catch_up_steps` with a deadline), so a reader is told then,
not once after the whole catch-up was caught, as before. Its steps stay bounded by `live_view_is_bounded`. -/

/-! ## A live pull asks no witness this device holds (batch 5)

A live pull asks each hinted log for all this device lacks of it. The hint names the logs an announcement changed and,
for a new audience key, the log of an earlier creation in that audience, its witness (`live_witnesses`), repeated
unchanged. Asked of a device that already holds that creation, the witness brought the rest of its log, the backlog,
with the change: during a bulk catch-up one chat edit's live pull carried 86 bulk edits, 2.0 s (`bench_live` phone, T1
traces). A witness is now asked only of a device that holds none of its log (the creation is a log's first edit); a log
any hint changed is asked as before. A log left out stays with the backlog, which still asks it
(`backlog_asks_unclaimed`). Rust: live.rs `in_step`, pulls.rs `note_witnesses`. -/

/-- A hinted log: whether every hint coalesced into the pull repeated it unchanged (a witness), and whether this device
holds any of it. -/
def inStep (witness heldAny : Bool) : Bool := !witness || !heldAny

/-- A witness this device holds some of is never asked live. -/
theorem held_witness_is_not_live : inStep true true = false := rfl

/-- A log a hint changed is asked live, whatever this device holds of it. -/
theorem changed_is_live (heldAny : Bool) : inStep false heldAny = true := rfl

/-- A witness it holds none of is asked live: it needs the creation for the change. -/
theorem missing_witness_is_live : inStep true false = true := rfl

/-- The live logs: the hinted logs in step. -/
def liveOf (hinted : List (Nat × Bool × Bool)) : List Nat :=
  (hinted.filter (fun h => inStep h.2.1 h.2.2)).map (·.1)

/-- A hinted log left out of the live pull is not claimed, so the backlog asks it if it differs. -/
theorem backlog_asks_unclaimed (hinted : List (Nat × Bool × Bool)) (differing : List Nat) (l : Nat)
    (h : l ∈ differing) (out : l ∉ liveOf hinted) : l ∈ (backlogTake (liveOf hinted) differing).1 := by
  simp only [backlogTake, List.mem_filter]
  exact ⟨h, by simp [out]⟩

/-! ## A live pull waits for no key; one fetch of a key at a time (batch 5)

The McEliece keys a pull's edits name come after its pages; a device needs one only to seal to its signer, so what
the edits say shows without it. A live pull waited for them all the same, and the backlog fetched the same two keys at
once (`bench_live` phone: 1.7 s of a chat edit's 1.8 s, 2 MB twice). A live pull now brings its keys after it ends;
a fetch of a key another fetch holds waits for that one and brings only what is still lacking, the law of
`one_asking_resends_nothing` with keys for edits. Rust: lib.rs `pull_expected`, `bring_keys`, pulls.rs
`Budget::fetching`. -/

/-- What a fetch brings: the keys asked that are not held once its turn comes. -/
def fetched (asked held : List Nat) : List Nat := asked.filter (fun k => !held.contains k)

/-- A second fetch, whose turn comes once the first's keys are held, brings none of them again. -/
theorem one_fetch_of_a_key (asked held : List Nat) (k : Nat) (first : k ∈ fetched asked held) :
    k ∉ fetched asked (held ++ fetched asked held) := by
  simp [fetched, List.mem_filter] at *
  intro _ _
  exact first

/-! ## Small answers first on a connection (batch 5)

A peer answers each request on its own stream of one connection. A catch-up's page (up to 4 MiB) and a live pull's few
edits shared the connection's sending in turn, so the live answer waited on what was queued of the page: on a phone link
the first live pull of a catch-up took 450-650 ms for 2-3 edits (`bench_live` phone, 10 runs, T1 traces). An answer of
at most `SMALL_ANSWER` bytes is now sent ahead of larger ones. Two levels only: within each, streams keep their turns,
so no page waits on another page longer than before. Rust: session.rs `priority`, `serve`. -/

def smallAnswer : Nat := 65536

/-- The send priority of an answer of `bytes`: higher goes first. -/
def priority (bytes : Nat) : Nat := if bytes ≤ smallAnswer then 1 else 0

/-- A small answer never waits behind a large one's queued bytes. -/
theorem small_goes_before_large (small large : Nat) (h : small ≤ smallAnswer) (h' : smallAnswer < large) :
    priority large < priority small := by
  simp [priority, h, Nat.not_le.mpr h']

/-- Two answers of one size class keep their turns: neither goes before the other. -/
theorem same_class_same_priority (a b : Nat) (ha : a ≤ smallAnswer) (hb : b ≤ smallAnswer) :
    priority a = priority b := by
  simp [priority, ha, hb]

end AvenDB.LivePriority
