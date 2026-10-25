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
expensive peer setup. Rust syntax parsing passed; compilation/runtime are pending
the coordinated compiler slot. No pass is claimed until the test actually runs.

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
