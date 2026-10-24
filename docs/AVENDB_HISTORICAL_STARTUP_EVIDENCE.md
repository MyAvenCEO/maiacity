# Historical copied-store startup measurement

The timing fixture at `571899da` completed successfully on 2026-10-24 against a
fresh, manifest-verified clone of the preserved historical Mac store. Its core
baseline is `23286402`; this predates the subsequent world-serialization changes.
The original preserved store and the live writer were untouched. One explicit
Touch ID ceremony unlocked only the disposable copy. No production peer was used.

The test passed identity, metadata, immutable-history and exact inventory checks
through cold opening, two same-build warm openings, and deliberately corrupted
derived-slot recovery: **63,647 edits, 85 keys, 2,281 visible records**. Both warm
openings loaded their saved replay. Four derived slots were damaged only on the
copy before recovery. The complete aggregate evidence is in
[evidence/avendb-historical-startup-2026-10-24.json](evidence/avendb-historical-startup-2026-10-24.json).

| Phase | Open wall time | Saved replay used | Replay timer | Open-key timer | Show-items timer |
| --- | ---: | --- | ---: | ---: | ---: |
| Cold | 7,929 ms | No | 2,051 ms | 814 ms | 922 ms |
| Warm 1 | 3,889 ms | Yes | 0.007 ms | 821 ms | 938 ms |
| Warm 2 | 3,595 ms | Yes | 0.494 ms | 782 ms | 824 ms |
| Corrupted-slot recovery | 16,897 ms | No | 2,120 ms | 10,930 ms | 899 ms |

`open_ms` excludes the authentication ceremony, metrics capture, and inventory
observation. The timers nest: refresh includes replay, key work, read, show and
upkeep; they must not be added to each other or to open wall time. Open also
includes work outside these inner timers, including store loading and node setup.
This is one sample per phase, not a percentile or device-wide guarantee.

The two warm runs checked no signatures again, reused 5,134 opened keys from the
shelf, performed one refresh round each, and reported no whole-replay fallback.
This demonstrates that saved replay worked on this historical copy. Its remaining
3.6–3.9-second open cost cannot be attributed to replaying the complete policy
history: key/index reconstruction and showing items still cost hundreds of
milliseconds each, alongside other startup work.

Recovery, with both key and view slots deliberately invalidated, checked all
63,647 edits and reopened 5,134 keys. Key opening dominated that run at 10.93 s.
This identifies an expensive fallback to distinguish in future evidence; it does
not establish that the iPhone is losing its saved keys or explain its restarts.
The cold run's missing usable view alone cannot distinguish an incompatible
engine version from another reason a view failed to open.

Diagnostics themselves were expensive: the first metrics capture took
2,576 ms cold, 2,207 ms warm 1, 1,626 ms warm 2 and 1,630 ms recovery. Inventory
observation took 209–262 ms. Its measured replay/key/read/show counter deltas were
all zero; the inventory reads did not cause another refresh in this fixture.
`Lab::perf` also constructs aggregate history breakdowns while holding the Lab
lock, so these capture times should not be presented as free instrumentation or
inserted into a latency-critical user flow. They include scheduling/lock wait and
aggregation, which this report does not separate.

Remaining evidence gaps: current-data startup on the final build, actual physical
PWA startup and foreground restart cause, browser memory pressure, and sustained
end-to-end mutation-to-visible latency. No fix for those gaps is claimed here.
