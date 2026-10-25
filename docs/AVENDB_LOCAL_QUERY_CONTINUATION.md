# Bounded local query continuation

Cold universal queries can yield with `ok.readiness.deferredCandidates > 0`. Their provisional count and page must not become an empty/final collection: `ok.countExact` and `ok.pageComplete` explicitly describe these limits.

The shared JavaScript continuation reissues the identical local operation, yielding 8 ms between progressing slices and backing off unchanged deferred counts up to 250 ms. It does not concatenate provisional rows; the final query supplies canonical ordering, count and page. Node materialization retains progress across calls/revisions. Only explicit local deferred work is retried: unavailable remote dependencies do not create a polling loop. An AbortSignal cancels the timer and suppresses further calls/results.

Mounted read windows remain pending with copied readiness diagnostics while this runs; route/device/window replacement cancels it. Studio collection enumeration and both manifest catalog and leaf queries use the same helper, so provisional zero counts cannot truncate them. Collection enumeration accepts an optional signal and refuses explicit inexact results without continuable local work. Existing callers without a signal still finish their local work; this does not claim their entire surrounding lifecycle is cancellable.

Validation: 60 focused JS regressions passed, including cold empty catalog/leaf continuation, exact final replacement, cancellation, unchanged-progress backoff, no remote polling, and collection count safeguards. Rust bounded-query implementation and combined application/device acceptance are separate validation owned by integration.

## Studio lifecycle follow-up

Studio now owns collection controllers by initial load, timeline reload and library reload. Replacement cancels the previous same-class read; destruction cancels all active reads. Signals pass through avenLibrary/libraryFromDevice/listCuts/listStories to collectionEntries. No new pages or metadata reads start after cancellation; unavoidable already-issued native calls may finish but cannot publish through the lifecycle owner. Shared transcript promises are not aborted globally because another consumer may own them. Tests exercise actual collection enumeration on destroy and vault replacement, beyond a helper-only timer test.

## Immediate provisional first view

The generic read window forwards each bounded provisional page through observedWindow to the reactive observer while local continuation proceeds. Pages replace prior rows; they are never concatenated. Readiness remains pending and each answer retains countExact/pageComplete/deferredCandidates. Provisional delivery does not advance the fully-observed revision/timing acknowledgment. Query/owner replacement and close guard both provisional and final callbacks. Empty partial entry collections stay loading, while nonempty partial rows are usable with their completeness limits. 35 focused observer/window tests pass, including immediate partial rows, stale callback cancellation, and exact final replacement.

## Write-adjacent direct callers

One-shot session.ask/run queries now finish only explicitly deferred local work, with an owner check before every resumed call; observed scopes retain immediate provisional delivery. Direct DM lookup refuses to infer absence from an inexact count, preventing an incomplete lookup from triggering duplicate creation. Measuring-logic lookup normalizes its unwrapped answer into the same continuation and refuses incomplete uniqueness decisions. Low-level native/AI protocol consumers retain countExact/pageComplete/readiness fields; these fields are not stripped or claimed complete by the bridge. Missing remote dependencies never trigger the local retry loop. 28 focused consumer/readiness regressions pass, including owner changes between yielded slices; the session rune module compiles.
