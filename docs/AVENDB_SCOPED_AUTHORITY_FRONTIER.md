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
