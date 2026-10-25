# Scoped authority frontier: requirement and current gap

## Current implementation

A `room` type query can request authenticated discovery without knowing entry IDs.
The provider checks current requester entitlement before returning bounded IDs.
The receiver retains IDs as scheduling hints and queues ordinary live transfer
before optional checkpoints. Neither hints nor checkpoints confer new authority.

The existing live receiver refuses entry transfer while any announced non-entry
log differs (`live.rs::pull_live`). This is deliberately broader than a room's
necessary dependencies. The receive path is not a quarantine: verified edits enter
the retained log; ordinary replay can materialize them using currently held policy.
Missing revocations must not be treated as irrelevant merely because local policy
still grants access.

## Exact runtime regression

`an_active_room_query_discovers_and_updates_without_unrelated_history` uses two
ordinary authenticated nodes. The receiving device starts with valid governance,
identity and schema state but without the requested room or unrelated entries.
All background page slots remain occupied. A type-only scoped query must populate
the room from discovery, then receive an exact signed update through reactive
notifications while unrelated entry history remains absent and sync is incomplete.
The room uses the fixture's document representation; this tests the generic entry
transport rather than the chat UI or browser paint timing. No target ID is passed
in the initial demand. This does not test absent authority or physical iOS timing.

The existing type-discovery fixture was extended, rather than duplicating its
expensive peer setup. The real-peer regression passed on the combined branch:1test,0failures,8.74s
including setup/shutdown. It proves unrelated entry-history independence under
preheld governance; it does not prove authority-history independence.

## Minimal safe scoped release contract

Before replacing the broad authority gate, the receiver needs:

1. An authenticated binding between requested entries and a bounded authority
   dependency set: owner/device standing, audience/key generations, capability
   chains, relevant schemas, and their causal dependencies.
2. Independently verifiable signed evidence for that dependency closure, including
   revocation state at the accepted frontier. A provider's unsigned list is a hint.
3. A stable generation/frontier receipt. Concurrent policy changes must invalidate
   preparation before materialization and publication.
4. If bytes arrive earlier, bounded staged retention separate from visible replay,
   with cancellation, eviction and durable-save semantics. Current `receive(false)`
   only defers replay and is not this staging boundary.
5. Ordinary peer authorization, signature checks and refusal behavior on every
   role. No hosted-peer exception and no automatic owner approval.

The current discovery wire response contains only `version`, `complete:false`
and entry IDs (`discovery.rs::response`). It carries no authority dependency set,
frontier or authenticated closure proof. Existing checkpoint evidence is bounded
and checked for its published entry cut, but does not establish a general scoped
revocation-complete frontier for arbitrary entry discovery.

`LivePriority.lean::ScopedAuthority` records the proposed abstract release
contract: dependency closure, current epoch and all required evidence verified.
Proofs show unknown closure or stale epoch cannot release. Independence from
unrelated history is conditional on those assumptions; the model does not claim
they are established by today's protocol. The deployed broad authority gate stays.

## Discovery lanes before optional checkpoint I/O

A second scheduling bottleneck existed inside each peer attempt: optional
checkpoints for explicit IDs ran before any typed query; then checkpoints for
one query ran before the next query. A slow kernel checkpoint could therefore
consume the peer's deadline before the room or game selector was sent.

All active selectors now queue their discovered entry IDs first. Up to eight
unique checkpoint candidates are retained for the subsequent optional phase.
The same per-peer deadline, demand cancellation, authorization and checkpoint
validation remain in force. This changes ordering, not access or completeness.
Lean `discovery_is_schedule_prefix` passes. Combined native discovery/room and
demand tests passed at987946f9; the later mutation scheduling change passed all
four scheduler regressions. Physical devices and final release remain pending.
## Implemented staging foundation (not enabled in transport yet)

`avendb-net/src/authority_stage.rs` now provides a separate two-slot staging
budget. Each slot owns at most 480 KiB of encoded input / 64 decoded signed edits
for one entry, with no auxiliary blobs. Its receipt copies at most 128 authority
logs plus that entry's frontier, with at most 512 frontier IDs. Capacity failure
leaves ordinary reconciliation as the fallback. Dropping a stage returns capacity;
it does not retain receive-page permits that authority catch-up needs.

Stages do not enter `Lab`, trigger replay, persist an apparent completed log, or
expose a record. Release requires the same authenticated peer, exact unchanged
announced authority/entry frontiers, and exact local agreement for every required
authority log. An omitted owning-vault log is rejected at capture. Changed, removed
or newly announced authority logs invalidate the old receipt. Released bytes must
still pass ordinary signature checking and current-policy admission.

The integration must take these inputs from authenticated holdings and fence
snapshot changes through admission. This helper alone does not provide cross-lock
atomicity, persist staged pages, or establish that a peer knows every revocation.
It is deliberately not hooked into live transport yet: doing so without the
admission fence would falsely imply the safety boundary was complete. The initial
required set conservatively includes **all announced non-entry logs**. Narrowing
it awaits actual policy dependency tracking including cross-vault group reads.

Lean stage release/currentness/refusal laws pass. Rust parsing passes. Added
adversarial tests for missing ownership evidence, stale/new/omitted authority
frontiers, identity replacement, bounded capacity and cancellation. Rust crate
compilation/runtime remain pending the coordinated compiler slot. Full task B
(scoped closure, admission-fenced integration, then elimination of unrelated
authority waits) is **open**, not completed by this foundation.

## Transport integration: overlap without authority bypass

The live path now starts bounded staging when demanded entry hints encounter a
non-empty authority difference. At most two ordinary `ASK_LOGS` first pages are
fetched using existing authenticated disclosure. Auxiliary key requests are left
to ordinary authority reconciliation. Signature checking uses the existing
native/background or cooperative WASM preparation path. The receive-page permit
is then released while the dedicated stage permit bounds retained memory.

A stage waits on actual change notifications, with a 15-second lifetime and normal
reconciliation fallback. Final admission runs inside the Lab transaction while
holding the authenticated holdings mutex through receipt comparison and
`receive_prepared(true)`. Both legacy announcements and range-completion updates
use this mutex, so they cannot change the checked frontier between check and
admission. Local policy cannot change concurrently because Lab is held. Changed,
missing or disconnected peer receipts are discarded. Ordinary signature/current
policy checks still determine which edits are accepted; stage readiness grants no
access. Duplicate decoded reply buffers are dropped before the authority wait.

Added `fetched_entry_stays_outside_replay_until_authority_receipt_matches`: real
peers transfer an entry while a real signed authority edit is withheld; the entry
is absent from the receiver's log after preparation and enters only after ordinary
signed authority receive completes. Syntax parsing passes; this integration and
its runtime regression **remain uncompiled/unrun** pending the shared compiler
slot. This enables transfer/authority overlap, but all announced non-entry
frontiers remain conservative prerequisites. Full scoped dependency tracking and
removal of unrelated authority waits remain open.

## Exact remaining dependency gap (2026-10-25)

The staged transport integration above is committed as `d467f136a`. It does not
remove the conservative authority gate. The following are actual policy reads,
not assumptions about which peers or vaults are normally related:

| Policy read | Evidence required before narrowing |
| --- | --- |
| `State::acts_via`, `acts_for`, `approves` | Current and historical owner/device/root changes of every traversed vault, including negative membership reads. |
| `State::read_shares`, `readers`, `public_key`, `targets` | All applicable wide grants as well as explicit audience members; complete grant ancestry and revocation frontiers. |
| `State::stale_keys` | Ownership/device authority of readers too: removing a reader's device can rotate another vault's audience key. |
| `State::group_at`, `groups_of`, `ops_on` | Defining cap-group entry cuts, recursive includes, and their own admission/decryption dependencies. |
| `Counter::judge` | The entry's causal writes, schema-fit readings, group versions at each write, and removal decisions. |

In particular, an empty audience is **not** an authority-independent private
entry. `read_shares` includes wide shares without putting them in the audience's
explicit share list. Revoking such a share, or a device of its reader vault,
changes the target audience's key epoch through `stale_keys`. The added `keys.rs`
regressions distinguish genuinely unrelated Carol authority from Bob authority
that becomes relevant through a wide read grant. An owner-only shortcut was
therefore rejected; no such bypass was implemented.

The current authenticated holdings inventory identifies share logs only by opaque
`ShareId`. A receiver missing the grant creation cannot tell which vault the log
is over, its parent, its recipient, or its cap group. Treating absent metadata as
an unrelated log would turn absence of evidence into authorization evidence.
The hash-identified, signature-verified grant creation can supply that classifier;
its current frontier must still be fenced through admission. This is the next
evidence dependency, not something existing checkpoint entry cuts already establish.
It need not add a wire message: existing scoped `ASK_LOGS` can request a share
log from its empty frontier, obtaining its signed creation through normal peer
disclosure. A bounded verified-creation index is still needed; held but not yet
materialized grant metadata must not be mistaken for accepted authority.

Required next implementation:

1. Fetch bounded signed grant-creation descriptors for announced share IDs; verify
   signatures and the creation hash against each requested ID. Unknown descriptors
   remain pending. Bind classification to the complete authenticated inventory
   revision, including additions/removals.
2. Trace actual owner/device, audience, grant-parent and cap-group reads during
   scoped replay. Record collection reads such as *all wide grants over V*, not
   just the positive share IDs that happen to be present. Retain historical reads
   because removals rejudge earlier writes.
3. Close the recorded queries against that classified inventory, recursively
   adding reader-owner and group dependencies. Missing/ambiguous or over-budget
   closure retains the existing conservative path.
4. Compare every required frontier at the existing atomic holdings/Lab fence;
   admit through unchanged signature and policy checks. Only then exclude
   classified unrelated authority logs.
5. Exercise a real peer with unrelated vault authority withheld while the scoped
   entry becomes visible, plus omitted-grant, wide-grant revocation, reader-device
   revocation, stale receipt and cap-group dependency counterexamples.

`classifiedScopeReady` in `LivePriority.lean` makes unknown classification and
changed inventory fail closed. Those abstract laws do not prove that the future
classifier/trace implementation is complete. Full task B remains **open**.

### Focused runtime evidence

On the isolated branch after `c16e709b4`:

- `cargo test -p avendb-net authority_stage --lib -- --nocapture` compiled
  successfully. The sandbox blocked socket binding for the transport test; the
  resulting test binary rerun with localhost socket permission passed all three
  staging tests, including the real peer transfer/admission fence (7.96 seconds).
- `cargo test -p avendb --test keys empty_audience -- --nocapture` passed both
  dependency counterexamples (2/2). This establishes that excluding reader-vault
  authority based only on the target entry's explicit audience would be wrong.
- `lake env lean AvenDB/LivePriority.lean` passed.

These checks validate bounded staging and the negative closure examples, not full
scoped-authority release or physical-device latency.

### Bounded direct-owner closure (`556a9445e`, integration pending)

The candidate classifies every share ID in a complete, connection-bound holdings
inventory by its independently verified creation. Unknown, unsigned,
checkpoint-covered-only, oversized, or changed inventories retain the conservative
path. The direct-owner case traces owning and reader vault/device ancestry, wide
read grants and their current parents/revocations, and the owning audience key
frontier. It does not trust remote metadata labels or change core admission.

The first real-peer regression exposed an actual scheduling omission: creating
the room after the receiver's prior sync introduces a new owning `Audience` key
log. The stage correctly refused it, but originally waited for broad background
authority sync instead of requesting this known related dependency. Diagnostic
output established complete inventory, current root, valid owner-entry shape,
and complete grant classification; the only missing authority was this audience
and the deliberately withheld unrelated coop. The fix requests known owning,
via-vault and audience dependencies through ordinary scoped transfer before
attempting the existing admission fence. The regression must prove the related
key log arrives while the unrelated coop and entry remain absent.

The scheduling correction compiled, and the real-peer first-visible-room plus
subsequent live-delta regression passed with unrelated coop authority and entry
history deliberately absent. Five classifier/stage unit tests also passed. The
old staging negative assumed related authority would never be fetched; it is now
explicitly a legacy/incomplete-inventory fallback test, preserving its refusal
assertion. Final focused execution passed all **8 authority tests in 6.05s**,
including that fallback and an actual signed grant-revocation test. The separate
partial/old-connection inventory regression also passed (1/1). `LivePriority.lean` and
`OwnerAuthorityScope.lean` both pass.

The candidate remains limited to at most 64 independently signed owner writes,
unchanged empty explicit audience, bounded authority metadata, and no Aven
global-cardinality or checkpoint-standing dependencies. Shared/cap-group writes,
long target histories, authenticated checkpoint-standing closure, and general
recursive missing-dependency fetching remain open. This is not a claim that the
physical fresh-phone problem is fully solved.

Exact final commands on `556a9445e`:

```sh
CARGO_TARGET_DIR=/private/tmp/avendb-resume-target RUSTC_WRAPPER= CC=cc CXX=c++ CARGO_BUILD_JOBS=2 cargo test -p avendb-net authority_ --lib --no-run
/private/tmp/avendb-resume-target/debug/deps/avendb_net-d9fcfac7c7e14740 authority_ --nocapture
/private/tmp/avendb-resume-target/debug/deps/avendb_net-d9fcfac7c7e14740 partial_or_old_connection_inventory --nocapture
```

Compilation passed in 2m08s. The authority binary was run with localhost socket
permission for its two real-peer fixtures. No device latency or combined-release
claim follows from these targeted checks. Full task B remains open at the scope
limits above.
## Explicit missing dependency scheduling

The collector now distinguishes a known missing current frontier from an
unclassified dependency. `owner_dependencies` returns bounded `required` and
`missing` sets; `owner_scope` still requires `missing` to be empty. Unknown grant
inventory members, unannounced dependencies, waiting frontiers, unsupported
shapes and missing independent provenance never become a negative result or an
admission permit.

After classification the stage fetches up to four successive dependency layers
through ordinary authorized `pull_expected`. This includes a wide reader's
vault, parent grant and owner ancestry once their preceding verified records
are available. The exact authenticated connection inventory is rechecked before
each hint collection. Repeated identical missing sets stop extra requests; the
existing 15-second stage timeout and log/byte budgets still apply. The final
atomic current receipt/frontier check remains the only release path. Deeper or
unavailable closures conservatively continue through ordinary reconciliation.

The real-peer regression now starts with a newer related wide-reader authority
frontier withheld alongside unrelated coop authority and entry history. It
requires the reader frontier to be supplied by scoped transfer, the room and
live delta to render, and unrelated work to remain withheld. Unit assertions
separate scheduling a missing reader/grant from admitting it. These new Rust
checks await the primary checkout compiler slot. New Lean scheduling lemmas
passed as a standalone extraction; the full imported model was not rebuilt in
this isolated tree.

## Active-query integration regression (source prepared)

The cold-demand fixture uses the application protocol (`Node::op` query and
`demand`), supplies no target entry IDs, and never calls staging directly.
Seventeen unrelated grant creations are already known; their later revocations
and an unrelated entry are withheld while background transfer permits are held.
The positive `room` selector must discover and render its payload without
fetching those authority frontiers. This closes the earlier fixture gap where
cold discovery started with all authority already current. Rust execution of
`cold_room_demand_renders_with_unrelated_authority_frontiers_withheld` is pending.

Source trace: Chat's scoped query is observed through `query-window`, which
publishes discovery before awaiting local results. The demand operation starts
`discovery`, which queues `live_announced`, whose `pull_live` starts bounded
entry staging before its broader authority wait. The test uses normal eager
nodes with background admission held; `lazy` nodes intentionally suppress
announcement-driven live pulls and would not exercise this production path.
Chat's sidebar collection no longer needs the broad world summary; actor/vault
labels and note-to-self lookup still use world identity metadata. This Rust
fixture does not claim browser paint or physical-device acceptance.
## Owner-authored shared audience / move closure (source candidate)

The next slice records every creation and `Mark` audience, named keep grant,
owner `via` path and stay reference in the bounded complete target cut. It keeps
historical audiences after a move, closes their explicit shares in addition to
wide readers, and requests each corresponding audience key frontier. Target-only
`Wraps`/entry-key links retain their signed stay dependencies; foreign-key links
remain unsupported. Existing `acts_via`, `audience_ok`, `may_box`, `sealed`,
signature, counted-write and current-policy checks remain in core admission.

This follows actual policy reads: `Mark` checks its owning vault, steward path,
canonical named audience and the named keep shares' vault/level/wide properties;
owner writes do not use a foreign actor's capability/group operations. Therefore
this slice still rejects non-owner-authored writes, proposals, checkpoints and
cuts exceeding the existing bounds. It is not the general shared-writer closure.

Source regressions cover a room moved by ordinary stewardship into a non-wide
share audience after the receiver snapshot, useful room content followed by a
live owner edit while unrelated authority/history stay absent, historical-audience
retention, omitted signed stays and a foreign-actor write. These Rust tests are
pending compiler-slot validation. The actual-policy owner lemmas and new Lean
historical/keep dependency retention lemmas pass.

The cold-demand fixture also renews the same public view lease, writes a live
update on the source, and waits through the receiver's reactive notification
channel for the new payload. All background permits remain held; all seventeen
unrelated revocation frontiers and the unrelated entry must remain missing both
after first view and after the live update. Neither phase invokes target staging
or an explicit transfer. Addresses are installed only after the background slots
are reserved. Phase/overall timeouts and error returns run both bounded shutdowns
before final assertions, so a failed view test does not leave peer tasks running.

## Demand-origin cancellation

Discovery-origin entry pulls now retain an immutable scope/revision/deadline
and a watch receiver. Replacing or closing the scope drops its sender, waking
queued live work and staged authority waits immediately. Lease expiry independently
cancels the same future. Cancelling drops page/staging permits and stops further
dependency rounds; bytes already admitted remain local and are not rolled back.
The final stage admission holds the demand mutex across the current-revision
check and ordinary receive, alongside the existing current-authority fence.
A synchronous admission already inside that critical section finishes normally.

Real peer announcements use a separate queue identity and bounded allocation
from view-origin hints. Closing a view therefore cannot erase an actual live
announcement for the same peer/entry. Existing background transfer limits and
the stage's two-page bound remain unchanged. Native signature work already
running off-lock may finish its bounded current verification batch before its
owned resources drop; cancellation does not kill a worker mid-crypto.

New source regressions cover two occupied obsolete staging slots released before
the fifteen-second deadline, immediate capacity for the next view, stale admission
refusal, and survival of an independently queued real live announcement. New Lean
cancellation lemmas passed standalone and changed Rust files passed rustfmt's
parser; Cargo/type/runtime checks await the shared primary compilation slot.
Required filters: `demand::tests`, `pulls::tests`, `authority_stage::tests`, then
`cold_room_demand_renders_with_unrelated_authority_frontiers_withheld` to confirm
the full active-view path still completes.
## Explicit accepted-base suffix bridge (source candidate; Rust unvalidated)

An already authenticated current owner base now supplies an opaque dependency
summary from its bounded entry Slice (at most 512 writes). This is not a raw
peer-provided policy state: the local active-base authority, overlay input
revision, recipient ownership/readability, snapshot standing and key checks run
again. The summary is used only to plan current authority dependencies. The
normal signature/current-policy receiver and owner-overlay suffix reconciliation
remain responsible for accepting each new edit.

Transport kind 22 explicitly names the entry, signed snapshot and up to 32
actually held suffix IDs. The provider validates the exact snapshot and current
recipient before selecting at most 64 post-base edits/480 KiB through ordinary
authorized reply selection. Using the snapshot cut internally to select a
response never writes it into either peer's holdings or coverage counters.
Session request limits, bounded response admission and dispatch are registered;
the live-demand path calls it before historical transfer, and accepting a judged
checkpoint wakes that live path to catch up from an older published snapshot.
The existing complete-inventory fence and bounded recursive current authority
closure apply immediately before suffix admission.

Tests added (not yet run): a core 80-write base transfers only one new edit,
without inventing held history, then rejects a revoked device; a public-demand
real-peer fixture uses an 80-write target while ordinary history pulls are held,
checks first-view restoration, receives a live suffix, keeps actual target-held
writes below 64 and unrelated history absent, and checks revocation. The explicit
wire parser bounds its independent cursor. Lean stale-base, missing-authority and
cursor-versus-history laws pass; Rust files parse with rustfmt.

Limits remain explicit: the accepted metadata envelope is capped at 512, a suffix
page must be complete within 64 edits, and this first bridge accepts owner-authored
main-line write suffixes only. New audience changes require a refreshed base or
ordinary bounded staging. Legacy checkpoint-covered authority still needs a
traced checkpoint-standing provenance closure; its signatures are not assumed
independently verified. Full generic shared-writer/checkpoint authorization task B
remains open. No deployment or device-latency acceptance is claimed.

A follow-up scheduling guard gives accepted-base suffixes two independent request
slots, while reusing the existing bounded page/signature budgets. Repeated hints
for the same entry coalesce and retry a changed frontier within four turns.
This matters because a live history worker can already be waiting for ordinary
pull admission when a checkpoint arrives. Accepted-base entries leave that
foreground history lane; background history still advances and reports real
coverage. The >64 public-demand fixture intentionally holds all ordinary pull
permits, so it tests this separation instead of relying on a shorter timeout.


### Accepted-base suffix queue and demand cancellation

Source follow-up to the accepted-base suffix bridge: the two dedicated workers
now drain a bounded FIFO rather than dropping hints when both permits are busy.
The queue retains at most 32 jobs (at most 16 view-origin jobs), coalesces repeated
hints, and puts a repeated running entry behind older waiting entries. Only
successfully queued IDs leave ordinary transfer hints; overflow retains fallback.
A queue lock covers final worker-permit release so concurrent enqueue cannot
strand work at worker exit. Demand-origin suffix requests start directly from
`live_demand`, cancel on replacement/release/expiry, and recheck the exact demand
revision under the demand lock immediately before normal admission. Independent
live announcements retain separate jobs and survive view cancellation.

Validation: Lean `OwnerAuthorityScope.lean` passes, including fallback retention;
Rust syntax formatted and `git diff --check` passed. Four focused Rust regressions
cover worker saturation, fair coalescing, overflow, and cancellation isolation.
These new Rust regressions await canonical combined compilation; no isolated
Cargo build was started. Existing accepted-base authority, inventory, signature,
and full-overlay fences remain unchanged. Queueing alone does not establish
successful transfer, physical-device latency, or broader writable bootstrap.

### Checkpoint-covered authority closure (source, runtime validation pending)

Scoped authority can now use a held bare body only when current replay says the
body stands, a later independently signed checkpoint stands and names it, and
historical `acts_for` covers all its signers. The checkpoint vault is added to
recursive current owner/device closure. Bare checkpoint chains cannot serve as
the independently signed anchor. Every final admission recomputes provenance
under the existing current inventory and Lab fences. Checkpoint actions are
permitted inside closed vault histories; unknown action shapes remain refused.

Covered grant classifiers retain a provenance requirement. Even an unrelated
negative classifier is revalidated during final closure, so revoking its witness
while network work is running cannot leave a stale negative classification.
Audience witness dependencies are collected before recursive vault traversal.

Lean stale/unsigned witness laws and Rust syntax checks pass. Added core tests
exercise a retained bare authority marker, missing signed anchor, and revoked
checkpoint; collector tests reject revoked classifier provenance. Rust execution
and a real withheld-history peer fixture remain pending. The witness lookup is
bounded (32,768 held replay edits, 2,048 IDs per checkpoint), but repeated lookup
cost requires measurement/indexing before physical latency claims. Independently
verified grant descriptors fetched directly from peers remain supported; missing
bare evidence still requires normal authenticated transfer and may fall back.

The provenance follow-up removes per-ID replay scans: each closure builds one
bounded index of independently held IDs and currently vouched bare IDs, then
looks up all dependency/classifier IDs in that map. Final admission constructs a
fresh index under its state lock. Total covered-ID visits are capped at 65,536;
exceeding the cap leaves remaining IDs unresolved. The real peer shared-room
fixture now has a checkpoint variant: grant creation becomes bare by ordinary
checkpoint publication after the receiver split; the room and subsequent live
owner edit must render while unrelated coop authority and document history stay
withheld. It asserts received provenance is genuinely checkpoint-backed. This
fixture is source-ready and still awaits canonical runtime validation.

### First covered-classifier recovery

Provider `trust` actually removes covered PQ signature bytes; ordinary replies
retain the stripped body. A new receiver therefore cannot verify that grant
before fetching its checkpoint. The classifier fetch now uses only hash-matched
creation fields as bounded transfer hints, requesting issuer/over/via vaults
through ordinary authorized transfer, then requesting the share itself. It
inserts a classifier only after local current provenance validates the exact
creation. Raw hints never answer negative scope queries or authorize admission.
The real checkpoint-covered shared-room fixture exercises this stripped-body
path without preseeded target authority. Covering checkpoint vaults outside the
hinted ancestry remain unresolved/conservative; no claim of universal witness
discovery is made by this increment. Rust runtime checks remain pending.

### Witness locations beyond grant ancestry

Protocol kind 23 requests one exact edit ID and returns at most four vault IDs,
bound to that ID. The serving peer discloses a location only when ordinary
reply authorization permits both the target and its independently signed,
standing covering checkpoint. Request/response bounds are 33/162 bytes; serving
uses existing checkpoint-response admission and a policy-revision fence.
Receiving locations adds transfer requests only. The ordinary vault/share pulls
and fresh local provenance remain mandatory. A forced paced catch-up after the
pulls avoids reading stale replay during its cooldown. Each optional locator
exchange has a two-second admission/network bound and remains inside the owning
future, so demand cancellation drops it without spawning detached work.

The new real-peer fixture covers a personal-vault grant with its owning coop's
checkpoint, outside the grant's issuer/over/via ancestry, while an unrelated
Carol authority update and document history remain withheld. It requires the
room plus subsequent live edit and actual checkpoint-backed received provenance.
Wire tests reject wrong target IDs, oversized counts and duplicate hints.
Runtime validation remains pending canonical Cargo; this commit does not claim
physical iPhone/iPad acceptance or deployed performance.

### Historical cap-group dependency discovery

`Lab::historical_group_dependencies` returns the union of includes from every
retained opened write body of a group, rather than its latest counted version.
It refuses partial bootstrap overlays, stale replay, unknown/non-group entries,
missing bodies and bounds overflow (512 writes/edges, 128 distinct includes).
A new per-entry signed-log index accessor avoids scanning unrelated logs.
Canonical `read_groups` and `group_at` remain the only permission interpretation;
this helper supplies dependencies only. The collector must still require exact
announced frontiers for all group entries, recursively close each group's writer,
audience and grant authority, and revalidate under the final admission fence.
The plain mixed-author increment intentionally refuses grouped chains until that
collector integration is complete. Lean historical-include retention passes;
Rust missing-body/redefinition fixture awaits canonical compilation.
