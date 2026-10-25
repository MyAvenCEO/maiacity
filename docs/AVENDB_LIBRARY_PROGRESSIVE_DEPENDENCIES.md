# Library dependencies beyond the first page

The first scoped Library implementation sorted completed-task dependency IDs
and truncated them to 512. Related files beyond that prefix could never appear,
even when fully held and authorized locally.

The Library now splits unique dependency IDs into requests of at most 512,
with at most eight active pages (4096 IDs). Opening a file prioritizes its family.
It starts one new page only after the preceding local read first settles, with
a browser task boundary between starts. Already returned pages remain visible
and reactive. Every page keeps the original acting identity and semantic file
kind; canonical entry_views authorization remains unchanged.

Context replacement/unmount releases all observers and demand leases, cancels
the queued next-page timer, and rejects late callbacks. Page replacement
removes revoked/missing rows instead of merging them permanently into a cache.
A failed page is visible as an error but does not strand subsequent pages.
No peer/global completeness is inferred from completing local reads.

Regression: 1100 related IDs, a useful authorized local response in the second
page, bounded per-request IDs, browser-turn scheduling, subsequent removal,
disposal, late callbacks and page errors. Six focused JS tests passed including
Library component compilation. Full app typecheck is recorded with the commit.
Beyond eight pages the UI explicitly reports incomplete dependency discovery;
it does not silently claim completeness or consume the node’s 128-scope budget.
A fully scalable visible-window dependency policy remains open. This fixes the
first-512 regression; task discovery scope is a separate change.

Full app typecheck: zero errors, 27 existing warnings in 11 files. The focused
suite also covers loss of the local view (`ok:null`), which clears that page and
returns it to loading rather than displaying a settled empty result.
