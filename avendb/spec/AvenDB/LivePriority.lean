import AvenDB.Logs

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

/-! ## Large answers in the order asked (Goal 6)

Shared in turns, a pull's two pages in flight ended together, and the link idled while the next two were asked
(`bench_live` phone_bulk: half a second at 0.55 of the link at each pair). Each request now takes a turn as it comes,
counted down from -1, and a large answer goes at its turn: the one asked first is sent whole first, and a page asked
ahead streams while the one before it is taken. Small answers stay ahead of all of them. Rust: session.rs `priority`. -/

/-- The send priority of an answer of `bytes` asked in turn `turn` (0 for a connection's first): higher goes first. -/
def sendPriority (bytes turn : Nat) : Int := if bytes ≤ smallAnswer then 1 else -((turn : Int) + 1)

/-- Of two large answers, the one asked first goes first. -/
theorem asked_first_sent_first (a b la lb : Nat) (ha : smallAnswer < la) (hb : smallAnswer < lb) (h : a < b) :
    sendPriority lb b < sendPriority la a := by
  simp only [sendPriority, Nat.not_le.mpr ha, Nat.not_le.mpr hb, ite_false]; omega

/-- A small answer goes before every large one, whenever either was asked. -/
theorem small_before_any_large (s l t u : Nat) (hs : s ≤ smallAnswer) (hl : smallAnswer < l) :
    sendPriority l t < sendPriority s u := by
  simp only [sendPriority, hs, Nat.not_le.mpr hl, ite_true, ite_false]; omega

/-! ## The larger of two controllers' windows (batch 5)

A round trip carries the least of the pages asked, the link's bandwidth × delay and the window its congestion
controller allows. Cubic, a loss-based controller, halves its window at a loss, so on a phone link (1 % lost, 40 ms) it
held a 20 MB catch-up to 6 % of the link (`bench_live` phone_bulk: 59.7 s, live p95 6.2 s). BBR v3 paces to the
bandwidth it measures (36.7 %, 9.8 s, live p95 216 ms), but treats a round with more than 2 % lost as too much in flight
and cuts toward 4 packets, where one loss is 25 %: under 11 % loss with reordering it stayed there (sim seed 1, no end in
150 s; Cubic 50 s). Every connection now feeds each event to both and sends at the larger window: never less than
either alone. Only the counting is modelled, not the controllers. Rust: avendb-net congestion.rs. -/

/-- A round trip carries the least of the pages asked, the link and the window. -/
def carried (asked link window : Nat) : Nat := min asked (min link window)

/-- Asking more pages carries no more than the window. -/
theorem asking_more_passes_no_window (asked link window : Nat) : carried asked link window ≤ window := by
  simp only [carried]; omega

/-- One period of a loss-based window: one packet more a round trip for `gap - 1` round trips, then halved. -/
def lossPeriod (window gap : Nat) : Nat := (window + (gap - 1)) / 2

/-- A loss every `gap` round trips holds a loss-based window within twice the gap, whatever the link. -/
theorem loss_holds_the_window (window gap : Nat) (h : window ≤ 2 * gap) : lossPeriod window gap ≤ 2 * gap := by
  simp only [lossPeriod]; omega

/-- The window of the pair: the larger. -/
def either (bbr cubic : Nat) : Nat := max bbr cubic

/-- The pair carries at least what either controller alone would. -/
theorem either_carries_no_less (asked link bbr cubic : Nat) :
    carried asked link bbr ≤ carried asked link (either bbr cubic) ∧
    carried asked link cubic ≤ carried asked link (either bbr cubic) := by
  simp only [carried, either]; omega

/-- And no more than the link: the pair's window never makes a round trip carry past it. -/
theorem either_within_the_link (asked link bbr cubic : Nat) : carried asked link (either bbr cubic) ≤ link := by
  simp only [carried]; omega

/-! ## A catch-up's pages and a live pull of the same peer

A catch-up asks every page with the request it began with, so edits a live pull of the same peer brought meanwhile
came again on its last page (`bench_live` phone_bulk at ten chat edits a second: 63 of a page's 94 edits). Each page
names them loose too, which the peer sends none of again (`Logs.lean` `respondSince`). Rust: lib.rs `pages`,
pulls.rs `Taken`. -/

/-- An asking's request for its next page, naming loose too the edits `taken` that another pull brought this device
    since the asking began, of the same peer (a live pull's chat edits during a catch-up) or of another (a stalled
    claim handed over). -/
def withTaken (a : Ask) (taken : List EditId) : Ask := { a with loose := a.loose ++ taken }

/-- The peer sends what it would have, less exactly the edits taken: none of them again, and nothing else held back. -/
theorem taken_not_sent_again (edits : List Edit) (d : SignerId) (a : Ask) (taken : List EditId) :
    respondSince edits d (withTaken a taken) = (respondSince edits d a).filter fun e => !taken.contains e.id := by
  unfold respondSince withTaken
  rw [List.filter_filter]
  congr 1
  funext e
  simp only [List.contains_append, Bool.not_or]
  cases e.log? <;> simp [Bool.and_comm, Bool.and_assoc]

theorem taken_is_never_sent (edits : List Edit) (d : SignerId) (a : Ask) (taken : List EditId) (e : Edit)
    (h : e ∈ respondSince edits d (withTaken a taken)) : taken.contains e.id = false := by
  rw [taken_not_sent_again] at h
  simpa using (List.mem_filter.mp h).2

theorem only_taken_is_held_back (edits : List Edit) (d : SignerId) (a : Ask) (taken : List EditId) (e : Edit)
    (h : e ∈ respondSince edits d a) (n : taken.contains e.id = false) : e ∈ respondSince edits d (withTaken a taken) := by
  rw [taken_not_sent_again]
  refine List.mem_filter.mpr ⟨h, ?_⟩
  simp only [n, Bool.not_false]


/-! ## A member that backs off on a queue, not on every loss

BBR v3 takes 7/10 of its short-term rate and inflight at every round with a loss outside its probes, so at a phone's
1 % random loss nearly every round cut it (`bench_live` phone_bulk: pacing 1.4-7.8 MB/s on a 6.25 MB/s link, 24-60 % of
it). The third member of the pair holds the largest window BBR or Cubic reached in a round with no queue, and takes a
round for congestion where its least round trip shows a queue past a target, or where it lost more than a tenth: a
sender that fills a shared queue still backs off, and a loss with no queue behind it cuts nothing. With no queue it
grows a sixteenth a round, to find where the queue begins. The pair keeps the largest window (`connWindow`, with its drains). Rust: avendb-net congestion.rs `Queue`. -/

/-- What one round trip told the queue-gated member (µs, bytes, packets): the least round trip it measured, the least
    ever, the larger of BBR's and Cubic's windows in it, the packets sent and lost in it, and whether the window
    bounded it (`full`): the connection's window was full while the member's was no larger, so what was in flight
    reached the member's (Rust: `on_cwnd_limited`). Not the application, the CPU or the pacer. -/
structure Round where
  rtt : Nat
  minRtt : Nat
  others : Nat
  sent : Nat
  lost : Nat
  full : Bool

/-- The queue a round shows: what its least round trip lies above the least ever. -/
def Round.queue (r : Round) : Nat := r.rtt - r.minRtt

/-- The queue it holds to: a quarter of the least round trip, 2 ms at least. -/
def Round.target (r : Round) : Nat := max (r.minRtt / 4) 2000

/-- A round is congested where it shows more queue than the target, or lost more than a tenth of what it sent. -/
def Round.congested (r : Round) : Bool := decide (r.target < r.queue) || decide (r.sent < 10 * r.lost)

/-- The window after a round: 7/10 of it when congested (a floor of `least`), else a sixteenth more where the window
    bounded the round, or what the others reached, if more. -/
def nextWindow (least w : Nat) (r : Round) : Nat :=
  if r.congested then max least (w * 7 / 10) else max (if r.full then w + w / 16 else w) r.others

/-- Congestion backs it off: past its floor, never more than before. -/
theorem backs_off_when_congested (least w : Nat) (r : Round) (h : r.congested = true) (hl : least ≤ w) :
    nextWindow least w r ≤ w := by
  simp only [nextWindow, h, ite_true]; omega

/-- A queue past the target is congestion, whatever was lost: a sender that fills a shared queue backs off. -/
theorem a_queue_is_congestion (r : Round) (h : r.target < r.queue) : r.congested = true := by
  simp [Round.congested, h]

/-- A random loss with no queue and under a tenth of the round cuts nothing. -/
theorem random_loss_keeps_the_window (least w : Nat) (r : Round)
    (hq : r.queue ≤ r.target) (hl : 10 * r.lost ≤ r.sent) : w ≤ nextWindow least w r := by
  have : r.congested = false := by
    have h1 : ¬ r.target < r.queue := Nat.not_lt.mpr hq
    have h2 : ¬ r.sent < 10 * r.lost := Nat.not_lt.mpr hl
    simp [Round.congested, h1, h2]
  simp only [nextWindow, this, Bool.false_eq_true, ite_false]; split <;> omega

/-- It grows slowly: past its floor, never more than a sixteenth a round past what it held or the others reached. -/
theorem grows_a_sixteenth_at_most (least w : Nat) (r : Round) (hl : least ≤ w) :
    nextWindow least w r ≤ max (w + w / 16) r.others := by
  simp only [nextWindow]; split <;> (try split) <;> omega

/-- A round that sent all it had shows nothing past it: the window grows no further than the others reached. A
    connection that grew its window in its hello's rounds drained at once, and sent its hello two packets a round. -/
theorem sent_all_grows_no_further (least w : Nat) (r : Round) (hl : least ≤ w) (h : r.full = false) :
    nextWindow least w r ≤ max w r.others := by
  simp only [nextWindow, h, Bool.false_eq_true, ite_false]; split <;> omega

/-- And it grows only with no queue: a round that shows one never leaves it more than it held. -/
theorem grows_only_with_no_queue (least w : Nat) (r : Round) (hl : least ≤ w) (h : r.target < r.queue) :
    nextWindow least w r ≤ w :=
  backs_off_when_congested least w r (a_queue_is_congestion r h) hl

/-! A queue is judged against the least round trip, which a flow that starts behind another's standing queue measures
with that queue in it, and then never sees the queue it adds. So every `DRAIN_EVERY` the connection drains: it sends at its
floor alone till what it sent before is acknowledged, which empties its own share of the queue, and then till a packet
sent after that is; that packet's round trip is its least. Until a drain has confirmed it, the member's window counts
for nothing. -/

/-- Whether a round's end begins a drain: only where the member's window leads the others', and its least round trip
    is unconfirmed or old. Where it doesn't lead, the connection sends at the others' window and a drain would only
    slow it. -/
def drainBegins (stale : Bool) (window others : Nat) : Bool := stale && decide (others < window)

/-- A member that doesn't lead never drains the connection. -/
theorem no_drain_unless_it_leads (stale : Bool) (window others : Nat) (h : window ≤ others) :
    drainBegins stale window others = false := by
  simp [drainBegins, Nat.not_lt.mpr h]

/-- A drain under way: the packet number it waits on, and whether its own queue is gone. -/
structure Drain where
  ends : Nat
  emptied : Bool

/-- What an ack does to a drain, `largest` the largest packet number sent: an older packet changes nothing; the first
    one past `ends` marks its queue gone and waits on the next packet sent; past that, the drain ends with the
    packet's round trip (`inr`). -/
def drainAck (d : Drain) (largest pn : Nat) : Drain ⊕ Unit :=
  if pn < d.ends then .inl d
  else if d.emptied then .inr ()
  else .inl { ends := largest + 1, emptied := true }

/-- A drain ends only on a packet sent once its queue was gone: never on the first ack that empties it. -/
theorem a_drain_ends_on_a_clean_packet (d : Drain) (largest pn : Nat) (h : drainAck d largest pn = .inr ()) :
    d.emptied = true ∧ d.ends ≤ pn := by
  unfold drainAck at h
  by_cases h1 : pn < d.ends
  · simp [h1] at h
  · by_cases h2 : d.emptied = true
    · exact ⟨h2, by omega⟩
    · simp [h1, h2] at h

/-- Emptying waits on a packet not yet sent: one sent after every packet that could still sit in its queue. -/
theorem emptied_waits_on_the_next_sent (d d' : Drain) (largest pn : Nat) (hd : d.emptied = false)
    (h : drainAck d largest pn = .inl d') (hp : d.ends ≤ pn) : d'.emptied = true ∧ largest < d'.ends := by
  unfold drainAck at h
  have h1 : ¬ pn < d.ends := by omega
  simp only [h1, hd, Bool.false_eq_true, ite_false] at h
  cases h; simp

/-- The connection's window: its floor while it drains, else the largest of BBR's, Cubic's, and the queue member's
    once a drain confirmed its least round trip. -/
def connWindow (drains confirmed : Bool) (least bbr cubic queue : Nat) : Nat :=
  if drains then least else max (max bbr cubic) (if confirmed then queue else 0)

/-- A drain sends at the floor alone, whatever the members hold: the queue it leaves is the others'. -/
theorem a_drain_sends_its_floor (confirmed : Bool) (least bbr cubic queue : Nat) :
    connWindow true confirmed least bbr cubic queue = least := by
  simp [connWindow]

/-- Unconfirmed, the member leads nowhere: the connection sends as BBR beside Cubic. -/
theorem unconfirmed_never_leads (least bbr cubic queue : Nat) :
    connWindow false false least bbr cubic queue = either bbr cubic := by
  simp [connWindow, either]

/-- Past a drain, the connection carries no less than BBR or Cubic alone would. -/
theorem past_a_drain_no_less (confirmed : Bool) (least bbr cubic queue : Nat) :
    either bbr cubic ≤ connWindow false confirmed least bbr cubic queue := by
  simp only [connWindow, either, Bool.false_eq_true, ite_false]; omega

/-- The pair with the queue-gated member: the largest of the three windows. -/
def either3 (bbr cubic queue : Nat) : Nat := max (max bbr cubic) queue

/-- It carries no less than BBR or Cubic alone, nor more than the link. -/
theorem either3_carries_no_less (asked link bbr cubic queue : Nat) :
    carried asked link (either bbr cubic) ≤ carried asked link (either3 bbr cubic queue) ∧
    carried asked link (either3 bbr cubic queue) ≤ link := by
  simp only [carried, either, either3]; omega

/-! ## A small change first on a new connection (Goal 6, G4)

On a connection it told nothing yet, a node tells a device all it holds again, which can take range rounds: four round
trips on a phone's link. Two nodes that know each other dial each other at once, and the crossed dial each keeps
is a new connection: the live edits written meanwhile waited behind that replacement (`bench_live` phone_bulk: the
first five live edits arrived together, 0.5-0.8 s after their writes). So a small change since what the device was
told on the connection before goes first, then all of it. A device that kept what it was told takes the change at once;
one that lost it (a restart) takes the change, then the replacement; either way it ends holding all of it. Holdings
by log, a frontier each. Rust: lib.rs `tell`. -/

/-- What a device holds once told `announce` (`Holdings::take`): that alone where it is all, else that over before. -/
def take (full : Bool) (held announce : Nat → Option Nat) : Nat → Option Nat :=
  fun l => match announce l with
    | some f => some f
    | none => if full then none else held l

/-- The change goes first: every log it names, the device holds as told at once, whatever it held before. -/
theorem change_heard_at_once (held change : Nat → Option Nat) (l f : Nat) (h : change l = some f) :
    take false held change l = some f := by
  simp [take, h]

/-- Then all it holds: the device ends holding exactly that, whatever the change or what it kept. -/
theorem change_first_ends_whole (held change all : Nat → Option Nat) :
    take true (take false held change) all = all := by
  funext l
  simp only [take]
  cases all l <;> simp

/-! ## A stalled claim hands over (S1, 2026-10-28)

A log that two peers hold more of is asked of one at a time (`Claims`, S5): the first asking takes it, and the other
peer is owed an asking once that one ends. Samuel's iPhone, over a 66-214 KB/s relay and backgrounded, had an asking
of the always-on peer land one page and then none for 9 minutes: it held every log the Mac advertised too, and the Mac
was never asked all evening. So a claim holds only while its asking's pages land: once none landed for `handover`,
a peer owed the log takes it, and every page asked after names loose what any pull took meanwhile (`withTaken`, from
any peer), so the stalled asking, if it comes back, sends none of it again. Rust: avendb-net lib.rs `Claims::take`,
`Claims::landed`, pulls.rs `Taken`. -/


/-! Since pages are sized to their asker (S1b, below), a page over a slow link lands in its couple of seconds too, so
a claim on a 20 KB/s relay never stalled: a browser took every log from its Mac at that rate while the server that held
them waited (sim `a_browser_takes_what_it_lacks_from_the_fast_peer`, 2026-10-28). So a claim holds only while its pages
also come at least a `slower`th as fast as the link of the peer owed the log (its pages lately, or a new peer's start
rate): a log comes from the peer that brings it faster. The faster peer's claim then holds when the slow one asks
again, so the log moves once (`a_faster_claim_is_kept`). Rust: `Claims::take` with `SLOWER`, `pulls::Rate::per_second`. -/

/-- A claim on a log: the peer asked for it, when its asking last landed a page (or began), and how fast its pages came
lately, in bytes a second, if any did. -/
structure Claim where
  peer : Nat
  landed : Nat
  rate : Option Nat := none

/-- Whether its pages come `slower` times slower than a link of `rate`. -/
def Claim.slow (slower rate : Nat) (c : Claim) : Bool := c.rate.any (fun r => r * slower < rate)

/-- Whether peer `me`, its link carrying `rate`, takes a log claimed so at `now`: unclaimed, its own, its asking
stalled `handover` long, or its pages `slower` times slower than `me`'s link. -/
def takes (handover slower now me rate : Nat) : Option Claim → Bool
  | none => true
  | some c => c.peer == me || decide (c.landed + handover ≤ now) || c.slow slower rate

/-- A claim whose pages land, about as fast as `me`'s link would bring them, is kept: no other peer is asked for its
log, nothing comes twice (S5). -/
theorem a_landing_claim_is_kept (handover slower now me rate : Nat) (c : Claim) (h : c.peer ≠ me)
    (fresh : now < c.landed + handover) (fast : c.slow slower rate = false) :
    takes handover slower now me rate (some c) = false := by
  simp [takes, h, Nat.not_le.mpr fresh, fast]

/-- A stalled claim is handed over: a peer owed the log asks for it once `handover` passed with no page. -/
theorem a_stalled_claim_hands_over (handover slower now me rate : Nat) (c : Claim) (h : c.landed + handover ≤ now) :
    takes handover slower now me rate (some c) = true := by
  simp [takes, h]

/-- A slow claim is handed over: a peer owed the log whose link is `slower` times as fast takes it, however its pages
land. -/
theorem a_slow_claim_hands_over (handover slower now me rate : Nat) (c : Claim) (h : c.slow slower rate = true) :
    takes handover slower now me rate (some c) = true := by
  simp [takes, h]

/-- The faster peer's claim holds when the slower one asks again: with `1 ≤ slower`, a claim at `r` that took the log
from a peer at `q < r` (`q * slower < r`) isn't slow to it, so the log moves once. -/
theorem a_faster_claim_is_kept (slower q r : Nat) (hs : 1 ≤ slower) (h : q * slower < r) (c : Claim)
    (hc : c.rate = some r) : c.slow slower q = false := by
  have : q ≤ r * slower := by
    have := Nat.le_mul_of_pos_right q hs
    have := Nat.le_mul_of_pos_right r hs
    omega
  simp [Claim.slow, hc]
  omega

/-- No log waits on a stalled asking for ever: an owed peer asking again at `landed + handover` takes it. -/
theorem no_log_waits_past_the_handover (handover slower me rate : Nat) (c : Option Claim) :
    ∃ t, ∀ now, t ≤ now → takes handover slower now me rate c = true := by
  match c with
  | none => exact ⟨0, fun _ _ => rfl⟩
  | some c => exact ⟨c.landed + handover, fun now h => a_stalled_claim_hands_over handover slower now me rate c h⟩

-- the sim's browser: the Mac's pages at 20 KB/s, the server new (128 KiB in 2 s), `SLOWER` 2
#guard takes 15 2 3 2 65536 (some { peer := 1, landed := 2, rate := some 20000 }) == true
#guard takes 15 2 3 2 40000 (some { peer := 1, landed := 2, rate := some 20000 }) == false
#guard takes 15 2 3 1 20000 (some { peer := 2, landed := 3, rate := some 65536 }) == false

/-- What the stalled asking sends if it comes back: none of what the peer that took over brought, by `withTaken`. -/
theorem the_stalled_asking_sends_none_of_it_again (edits : List Edit) (d : SignerId) (a : Ask) (taken : List EditId)
    (e : Edit) (h : e ∈ respondSince edits d (withTaken a taken)) : taken.contains e.id = false :=
  taken_is_never_sent edits d a taken e h

/-! ## Pages sized to their asker (S1b, 2026-10-28)

A peer made every page 4 MiB (`Options::page`). Samuel's iPhone took 66-214 KB/s through a relay, so one page was 20-60 s
on the wire, and a page in flight when the asking stopped (the app hidden, a reload, a lost path) was lost whole. An
asking now states its page budget, fixed for the whole asking (so its cuts and its pages end at the same places, both
by `pageLen`): the bytes its link carried in `PAGE_TIME` at the rate its pages last came, between `least` and the peer's
`most`. The peer sizes each page to it. An asker from before states none and is served `most`, as before. A page that
landed is taken whatever the asking does after, so a stop loses only the pages in flight, each within its budget.
Rust: avendb-net lib.rs `pages`, `Shared::sizes`, `Flight`; pulls.rs `Rate::budget`; session.rs `SIZED`, `SIZING`,
`served`, `authorized_request`; avendb lab.rs `page_end`. -/

/-- How many more edits of sizes `l` a page that holds `used` bytes takes, within `page` bytes. -/
def fitMore (page used : Nat) : List Nat → Nat
  | [] => 0
  | s :: rest => if used + s ≤ page then fitMore page (used + s) rest + 1 else 0

/-- How many edits of sizes `l` a page of `page` bytes holds: as many as fit, and at least one (`lab.rs` `page_end`). -/
def pageLen (page : Nat) : List Nat → Nat
  | [] => 0
  | s :: rest => fitMore page s rest + 1

theorem fitMore_within (page used : Nat) (l : List Nat) (h : used ≤ page) :
    used + (l.take (fitMore page used l)).sum ≤ page := by
  induction l generalizing used with
  | nil => simpa [fitMore] using h
  | cons s rest ih =>
    by_cases hs : used + s ≤ page
    · simp only [fitMore, hs, ite_true, List.take_succ_cons, List.sum_cons]
      have := ih (used + s) hs; omega
    · simp only [fitMore, hs, ite_false, List.take_zero, List.sum_nil]; omega

theorem fitMore_past (page used : Nat) (l : List Nat) (h : page < used) : fitMore page used l = 0 := by
  cases l with
  | nil => rfl
  | cons s rest => simp only [fitMore]; split <;> omega

/-- A page is within its budget, or one edit larger than it, alone. -/
theorem a_page_is_within_its_budget (page : Nat) (l : List Nat) :
    (l.take (pageLen page l)).sum ≤ max page (l.headD 0) := by
  cases l with
  | nil => simp [pageLen]
  | cons s rest =>
    simp only [pageLen, List.take_succ_cons, List.sum_cons, List.headD_cons]
    by_cases hs : s ≤ page
    · have := fitMore_within page s rest hs; omega
    · rw [fitMore_past page s rest (by omega)]; simp; omega

/-- Every page brings at least one edit, so an asking always moves on. -/
theorem a_page_moves_on (page : Nat) (l : List Nat) (h : l ≠ []) : 0 < pageLen page l := by
  cases l with
  | nil => exact absurd rfl h
  | cons s rest => simp [pageLen]

/-- The page a peer makes for an asking that states budget `b`, or none: between `least` and its `most`. -/
def served (least most : Nat) : Option Nat → Nat
  | none => most
  | some b => min most (max least b)

/-- An asker from before is served as before. -/
theorem an_old_asker_is_served_as_before (least most : Nat) : served least most none = most := rfl

/-- No asker makes a peer's page larger than its own. -/
theorem no_asker_makes_a_page_larger (least most : Nat) (b : Option Nat) : served least most b ≤ most := by
  cases b <;> simp only [served] <;> omega

/-- Nor smaller than `least`, so a budget of nothing costs the peer no more pages than `least` allows. -/
theorem no_asker_makes_a_page_smaller (least most : Nat) (b : Option Nat) (h : least ≤ most) :
    least ≤ served least most b := by
  cases b <;> simp [served] <;> omega

/-- The budget an asking states: what its link carried in `time` at the `rate` its pages last came. -/
def budget (rate time : Nat) : Nat := rate * time

/-- A page sized to the link lands within its time on that link: its bytes are at most `rate × time`, unless its first
edit alone is larger, or the link is slower than `least` a time. -/
theorem a_sized_page_lands_in_its_time (least most rate time : Nat) (l : List Nat)
    (hl : least ≤ budget rate time) (hd : l.headD 0 ≤ budget rate time) :
    (l.take (pageLen (served least most (some (budget rate time))) l)).sum ≤ budget rate time := by
  have := a_page_is_within_its_budget (served least most (some (budget rate time))) l
  have : served least most (some (budget rate time)) ≤ budget rate time := by simp [served]; omega
  omega

/-- What a stopped asking loses: the pages in flight, as the pages that landed are taken. -/
def lost (flying : List (List Nat)) : Nat := (flying.map List.sum).sum

/-- So a stop loses at most its pages in flight, each within the budget its asking stated. -/
theorem a_stop_loses_at_most_its_pages_in_flight (flying : List (List Nat)) (p : Nat)
    (h : ∀ page ∈ flying, page.sum ≤ p) : lost flying ≤ flying.length * p := by
  induction flying with
  | nil => simp [lost]
  | cons x rest ih =>
    simp only [lost, List.map_cons, List.sum_cons, List.length_cons] at *
    have hx := h x (List.mem_cons_self ..)
    have := ih (fun q hq => h q (List.mem_cons_of_mem _ hq))
    rw [Nat.succ_mul]; omega

end AvenDB.LivePriority
