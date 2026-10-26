# avenDB sync v2: clean primitives

Approved by Samuel on 2026-10-26. The audit, the target architecture and the plan are in the Claude Doc
[avenDB sync audit](https://claude.ai/artifact/CAuLQCnPqAoGSvVR4MX7MA). This file is the repository's short record of
it.

Base: main (Samuel, 2026-10-26 08:57). The paused PR #1277 stays open for reference only; a lane carries over a
piece of it only where its milestone needs that piece.

## The six primitives

| Primitive | Replaces |
| --- | --- |
| Interest: cap selector + tier (now, next, later, idle) + window + bindings + `by` signal | manifests walker, learned page lists, `near` brings, `freshen`, demand leases, `bringEntries`/`whenBrought`/`deviceRows` timeouts |
| Blind index: keyed per-audience tokens, `find` any peer answers | type discovery hints, whole-vault `bring {vaults}` |
| Coverage: `complete`, `partial`, `denied` on every read | readiness flags, the 4 ms hydration budget, the `completeQuery` loop |
| Live queries on indexes in the stored view | full-scan `query_candidates`, the global `refreshActiveView` re-run |
| One entry state: full, or owner-signed snapshot + suffix | warm, scratch, receipts, judgment slices, bootstrap suffix as states |
| Node actor + deterministic simulation | shared locks in avendb-net |

No caches (Samuel, 2026-10-26 08:15): a device keeps history and the stored view (replay, Lean M1) with its indexes.
A slow read gets an index, never a side cache.

## Freeze

While this runs, no new partial-state path (warm, scratch, suffix, judgment, receipt, lease or timeout) goes in. A
fix to an existing one is allowed only to keep CI green.

## Lanes

Each lane works Lean first and opens its PRs into `claude/project-thread-mp8hoa`, the integration branch. The
integration branch then goes to main as one PR.

| Lane | Steps |
| --- | --- |
| Coverage and live queries | P1, P2 |
| Interests and manifests v2 | P3 (its "Manifest, v2" schema goes in by AIP) |
| Blind index and sync v2 | P4, P5 |
| One entry state, no caches | P6 |
| Node actor and simulation | P7 |
| Batch signing and WebRTC | P8 |

Old ops keep working for one release after the new ones ship, then go.

## Baseline (P0)

From Samuel's iPhone report on release `7dc7c57a`
(docs/AVENDB_IPHONE_DIAGNOSTICS_2026-10-25.md):

| Measure | Baseline |
| --- | --- |
| Unlock, total | 8.885 s (3.311 s passkey, 5.551 s device open) |
| Query calls | median 88 ms, p95 1,779 ms (73 calls) |
| Manifest walks with entries | 0 of 17 |
| File reads | 0 of 54 succeeded |
| Logs held after unlock | 230 of 2,898 announced |

The final release is measured against these on the same iPhone. Target (Samuel, 2026-10-26): on a fresh iPhone,
Chat rooms show within 2 s of the passkey on a normal connection, with no history replay before the first view.

P0 deletes nothing: the learned page lists and `freshen` go in P3, when Interests replace them.
