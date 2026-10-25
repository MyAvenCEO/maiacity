# Bounded local query continuation

Cold universal queries can yield with `ok.readiness.deferredCandidates > 0`. Their provisional count and page must not become an empty/final collection: `ok.countExact` and `ok.pageComplete` explicitly describe these limits.

The shared JavaScript continuation reissues the identical local operation, yielding 8 ms between progressing slices and backing off unchanged deferred counts up to 250 ms. It does not concatenate provisional rows; the final query supplies canonical ordering, count and page. Node materialization retains progress across calls/revisions. Only explicit local deferred work is retried: unavailable remote dependencies do not create a polling loop. An AbortSignal cancels the timer and suppresses further calls/results.

Mounted read windows remain pending with copied readiness diagnostics while this runs; route/device/window replacement cancels it. Studio collection enumeration and both manifest catalog and leaf queries use the same helper, so provisional zero counts cannot truncate them. Collection enumeration accepts an optional signal and refuses explicit inexact results without continuable local work. Existing callers without a signal still finish their local work; this does not claim their entire surrounding lifecycle is cancellable.

Validation: 60 focused JS regressions passed, including cold empty catalog/leaf continuation, exact final replacement, cancellation, unchanged-progress backoff, no remote polling, and collection count safeguards. Rust bounded-query implementation and combined application/device acceptance are separate validation owned by integration.
