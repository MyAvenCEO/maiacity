# Fresh iPhone sync evidence — 25 October 2026

User-supplied export: `maia-latency-iPhone-1792909502789.json`, SHA-256 `db93bf2b23cc5c013ad9d1d84d4891630ad28d4aeaf7175cf35c40d8f56f66ce`. Raw file remains outside the repository. This is real device evidence, but the report contains no exact deployed build identifier. Do not attribute it to the current unshipped integration branch.

The retained 120 call samples span 77.441 seconds. Nearest-rank p95; milliseconds:

| Operation | Samples | Median | p95 | Maximum | Failed |
| --- | ---: | ---: | ---: | ---: | ---: |
| entry_views | 42 | 51 | 260 | 306 | 0 |
| cap_groups | 9 | 51 | 298 | 298 | 0 |
| bring | 8 | 60047 | 61038 | 61038 | 0 |
| read_file | 26 | 0 | 97 | 183 | 26 |
| synced | 35 | 24 | 1736 | 2017 | 0 |

Five bring calls took 60–61 seconds. A local engine response includes queueing and any operation-specific wait; it is not bandwidth, UI paint, or cross-device delivery latency. Most read_file failures were immediate; this report lacks reason codes, so it cannot distinguish missing local data from other failures.

Coverage was 60 of 2,896 announced logs, with two peers and four pulls. The lifecycle journal records one document and an open event at 23.637 seconds after startup; that interval includes authentication and is not a replay-only measurement. It does not reproduce the reload loop in this capture. Policy/reactive observations are null and first-view readiness is unmeasured. Successful calls do not establish complete views.

## Direct follow-up

- Replace the fragmented diagnostics UI with Run diagnostics and Copy logs, producing one bounded report with explicit unavailable sections.
- Preserve startup milestones separately from the rolling call ring; include exact build identity, current sync/demand state, local responsiveness, safe refusal codes and available peer observations.
- Fix the identified source scheduling duplication: useView registers scoped demand but still awaits legacy bringEntries, which can hold subsequent dependency ranks until the 60-second bring deadline. Accepted modern demand should schedule without that redundant wait; older-node compatibility remains explicit.
- Validate actual active-view readiness during fresh catch-up, then local/remote update latency on the devices. This export does not close those acceptance gates.
