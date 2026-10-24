# Local room discovery without a broad world snapshot

Chat now mounts when the local device is open. It discovers locally readable room entries through the existing universal `query` operation, then requests the canonical `entry_views` projection for those IDs. The selected room remains included when the sidebar page changes. All messages still use the existing authorized `room` operation and shared `observe` lifecycle; there is no new Chat backend, authority cache or special peer role.

The sidebar requests 50 entries per page, with at most one additional selected entry. Room heads use cancellable observers instead of detached ask promises. Query/API changes, revocation, refusal and lock/reopen invalidate their previous results. A ready local empty collection is distinguished from loading or refusal; it does not assert that every remote room has arrived. Reader IDs come from canonical metadata, with explicit name-loading text until vault names arrive. Creating a note to self consults a separate own-vault query, never absence from one sidebar page.

Mutations still wait for canonical acting-vault metadata. They never infer signing authority from a read result. Names and people lists also retain their existing world dependency. The universal query currently scans/materializes before applying its output limit; the page size bounds output and demand, not all core CPU work. Per-room head refresh and selected-record projection remain measurable costs. Native replay, lock tenure, full manifest scheduling and physical-device latency are separate work.

## Evidence

- `avendb/spec/AvenDB/LocalDiscovery.lean`: abstract invariants for canonical-result-only publication, stale-context rejection and independence from world/remote readiness. This is not a proof of JavaScript scheduling or a physical latency bound.
- `bun scripts/test-avendb-local-write.mjs --browser chromium --cold-chat` and the equivalent WebKit invocation: actual Chat and session with synthetic device boundary, first world snapshot held. Baseline failed to discover the room; the changed component passes discovery, message refresh, pagination with retained selected room, refusal, revocation/restore and lock/reopen while an old query is pending.
- Existing actual-session Chromium accepted/refused Chat and non-Chat writes remain green with later world refresh held.
- `bun test src/lib/chat/rooms.test.js src/lib/avendb/query-window.test.js src/lib/avendb/reactive-read.test.js`: 25 passed, including null-world title fallback and shared observer/query lifecycle tests.

These browser fixtures are not physical Mac/iPhone/iPad timing results. No account, live store, native binary or deployment was changed by this slice.

## Release repair: reuse DMs beyond the visible page

Before merge, review caught a pagination regression: selecting a person searched only visible DMs and could create a duplicate when the existing DM was on another page. The repair performs a bounded-page canonical local DM query, reads canonical reader metadata for each page through a component-owned read window, and opens the matching existing room. Refusal, cancellation or missing/mismatched metadata produces a retry state rather than proving absence. Leaving the composer closes the window; late results cannot pick or create a room in a replacement context. This establishes local lookup behavior, not global uniqueness across concurrent/offline devices.

Validation: extended Lean absence/refusal/page-independence contract; 27 shared unit tests; actual Chat `--dm-reuse` scenarios in Chromium and WebKit with 51 DMs, target beyond page one, and zero mutation writes. Both existing kernel browser jobs now run this focused regression.
