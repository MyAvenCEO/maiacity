# iPhone report after the unified diagnostics release

Report supplied by the user after deployment of `7dc7c57a57a8f535d242d4351b05c9d0f6dc62f3`. Raw account/device report remains outside the repository.

## Observations, not inferred causes

- The frontend and queried hosted release both identify `7dc7c57a`.
- Unlock reports 8.885 seconds total. Retained lifecycle landmarks separate approximately 3.311 seconds of passkey interaction from 5.551 seconds between device-open start and open. This is not a pure replay profile.
- 73 completed query calls: median 88 ms, p95 1,779 ms. Entry-view median 107 ms, p95 1,779 ms. These include queue and scheduling delays.
- All 54 recorded file reads failed; the old generic `failed` reason cannot establish missing blobs, authorization failure, or another cause.
- Incoming announced-log coverage: 230 of 2,898, 2,668 behind, four active requests, three peers. Logs are not equal-sized bytes or entries.
- All 17 manifest walks returned zero concrete entry IDs. That counter excludes type-discovery hints. Chat separately issues a scoped `room` query; a missing Chat manifest does not establish the cause of delayed room discovery.
- A 4 MiB Maia HTTP range download completed in 866 ms (38.75 Mbps). Cloudflare probes failed immediately. The page/native connect-src omitted the exact probe host, unlike the old standalone diagnostics document; fix the policy rather than interpreting this as zero bandwidth.
- Page timer delay peaked at 5 ms during only 19 samples. This short observation does not rule out worker contention during catch-up.
- Retained document 2 includes 126.889 seconds hidden. The 111-second entry-view call and 178-second bring call overlap that period; their old wall durations do not establish continuous foreground computation. Future samples record hidden and visible elapsed separately.
- Policy and reactive delivery sample arrays are empty. Actual cross-device message latency remains unmeasured.

## Follow-up implementation

Compact status uses numeric incoming-log coverage and local-read availability; it does not claim full manifest completeness. `sync-ring` avoids the Tailwind `ring` utility collision. Dock spacing uses the existing capped navigation clearance once.

Manifest observations now distinguish absent catalogs, unmatched routes, query leaves, type hints and returned rows. Operation timing records document/start/end plus hidden/visible elapsed. Lifecycle separately labels retained document sequence and session document count. Exact Cloudflare connect-src permission is covered by strict web/native policy tests.

The underlying new-device discovery/admission bottleneck remains under source audit. Do not mark it solved by these diagnostic changes. Mac dev delivery is a separate build with latest UI plus Studio diagnostics; website deployment does not establish native installation.
