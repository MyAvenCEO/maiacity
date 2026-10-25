# Mac and iPhone diagnostic follow-up — 2026-10-25

Two user-supplied unified reports were inspected; account contents are not copied here.

| Evidence | Mac | iPhone |
|---|---|---|
| Frontend | 7dc7c57a | 24b8c4af |
| Incoming coverage at capture | 2897/2897 logs | 375/2899 logs |
| Local query p95 | 4295 ms | 2897 ms |
| entry_views p95 | 3715 ms | 2456 ms |
| World median / p95 | 6311 / 16479 ms | not recorded |
| File reads | 8 succeeded | 21 failed; generic reason only |
| Manifest observations | 12 runs; final run 59070 ms | 10 runs; all heldManifests=0, matchedLeaves=0, typeDiscoveryHints=0 |
| Playback | 0 frames; no recorded failure | 0 frames |

The iPhone bounded HTTP test measured 84.2 Mbps download, 26.9 Mbps upload,
and 35.5 Mbps Maia range download; these are not avenDB useful throughput or
maximum bandwidth. Peer transport RTT samples were 221–283 ms. Several 2.4–2.9s
local calls explicitly have hiddenMs=0. The short foreground timer test had
p95 5 ms; it does not rule out database-worker queuing or long operations.

The Mac's unavailable HTTP tests do not establish that the network was offline:
peer RTT samples were 39 and 99 ms. Unlock total was 25.648s including user
authentication. No frame/failure samples means this report cannot diagnose or
clear the Studio world bootstrap failure.

A read-only query through the existing live avenDB peer found 13 manifest
records. The iPhone's missing local catalog is therefore not evidence that no
catalog exists. The held catalog lacks Chat and sandbox8 declarations, and game
selectors are tag-only. Source declaration changes do not update owner-governed
live records automatically. Prepare proposed record updates; never bypass owner
review or authorization for faster discovery.

## Work tracking

- Done: inspect reports and distinguish actual foreground delay from suspension.
- Done in this commit: compact status pill to an inline view + incoming-sync
  summary, with short transfer/file counts only on tap. Svelte compile passed.
- Doing: retain same-selector discovered demand through lease renewal, so IDs
  are not discarded before authorization/history catches up.
- Doing: validate integrated metadata query prefilter and peer discovery queue
  improvements. No runtime speedup is claimed before measurement.
- Open: generic file-read failures still lack enough cause information here.
- Open: Studio-specific bootstrap failure capture and physical-device acceptance.

The compact pill describes local view reads and incoming peer log coverage;
it does not claim complete discovery, outgoing delivery, or file completeness.
