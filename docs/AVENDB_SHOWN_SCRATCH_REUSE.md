# Reuse judged materialization on startup

## Root cause and implementation

`Judging::judge` imports an entry's updates into a Loro scratch document to evaluate schema and authorization rules. Previously, `Judging::shown_on` imported the same selected history a second time whenever it had no previous shown item. This occurs during reconstruction, including warm-view reopening.

The new production fallback asks `Scratch::shown_for` for a fork of the already materialized item. It is eligible only when the scratch holds exactly the selected canonical history, every selected change currently counts, at least one selected write carries a content update, and no updates are parked awaiting dependencies. Otherwise it uses the original canonical importer. Existing incremental reuse of a prior shown item is unchanged.

Judgment and authorization still run. Rejected changes never become visible through this optimization. Draft/line selection remains upstream. The fork selects the requesting device's line peer, preserving subsequent editing. No persisted format, key ownership, authority, live store or checkpoint trust changes.

## Validation and boundaries

The Lean specification `AvenDB/ShownScratch.lean` establishes conditional projection equivalence and canonical fallback. Its explicit agreement premise is exercised against real Loro in native tests; the proof does not verify Loro or establish a timing claim.

Native checks cover record and version equality, subsequent edits by three signers, rejected-change and selected-subset fallback, authorization revocation/restoration, and parked dependency detection. The microbenchmark compares ten reconstructions and guarded forks of the same eligible histories. End-to-end synthetic warm restore separately checks retained records and stored-view selection.

**Current status: implemented; combined focused native warm suite passed 4/4.** Standalone Lean check passed using `.elan/bin/lake env lean AvenDB/ShownScratch.lean`. The combined run passed real-Loro record/version and successor-write parity (including a proposal line), denied/subset fallback, revoked/restored authorization parity, and synthetic stored-view reopening. The separate parked-update assertion belongs to the doc suite; this four-test result alone does not establish that suite passed. This change removes duplicate materialization, not canonical judgment, key reconstruction, or fresh-device bootstrap. It must not be reported as solving the entire multi-second unlock complaint.

Implementation: [1ecb09bc](https://github.com/MyAvenCEO/maiacity/commit/1ecb09bc). Focused native evidence is below. Release CI, deployment and physical-device acceptance remain pending.


## Combined focused results — 24 October 2026

Command: `cargo test -p avendb --lib upkeep_family_tests -- --test-threads=1 --nocapture` in the combined performance checkout. **4 passed, 0 failed**, 17.02 seconds after compilation. Operational log: `/private/tmp/avendb-combined-warm-final.log`.

For the **same seven eligible histories, ten repetitions each**, canonical materialization totaled **43.421002 ms**, versus **10.000128 ms** for the guarded fork, about **4.34 times faster for this isolated operation**. This comparison includes the guard/fork and uses identical eligible inputs. It is not a measurement of complete account unlock or a physical iPhone/iPad result.

The separate synthetic same-engine restore retained all 32 records across three reopenings (166 edits, four key boxes, 1,752 box payload bytes). Whole restore times were **29.574666, 69.874125 and 63.4465 ms**. These are current-build observations, **not a controlled before/after comparison**; machine load and fixture scale preclude comparing them to older log timings. The fixture's tiny key set does not represent a large historical account. Canonical judgment remains the largest measured show phase in these trials.

## Follow-up: unchanged warm-open save baseline

Source inspection found that a successfully validated unchanged warm view already restores `view_given`, `replayed`, `view_lineage` and `view_wholes`; empty replay preserves these, and restored key receipts avoid dirtying keys merely by reopening. The first regression fixture failed because a freshly founding device generated keys but had not yet reopened their sealed boxes: its first restore legitimately opened two boxes and dirtied the key receipt. Diagnostic values showed `replayed = saved = 5` and `wholes = saved_wholes = 0`; the view itself was clean. The corrected fixture first restores before capturing the already-warm baseline. No speculative production dirty-baseline change was made. Engine mismatch, corrupt views or actual new state correctly require rebuilding/saving.

A focused regression now asserts no capture/encoding after unchanged restore, subsequent mutation retention across reopening, and regeneration after a corrupt derived view. Corrected native execution passed in the six-test warm suite (9.63 seconds). `WarmRestoreNoop.lean` passed before the change; it specifies the due-state arithmetic and sequential fold equivalence, not browser lifecycle or memory exhaustion.

The concrete production change decodes and merges encrypted key slots one at a time instead of collecting every fully decoded slot first. Slot order and validation are unchanged; this reduces transient allocations, without an unmeasured claim about total unlock latency or the iPhone reload cause. Actual browser worker restoration and snapshot encoding are still synchronous where performed and remain separate scheduling work.


## Eager scratch retention during reconstruction

A concrete peak-memory issue was found in `show_items`: every ordinary entry kept its additional scratch Loro document until the final sweep, which only then reduced the cache to 32. A large restart could temporarily retain a scratch for every reconstructed entry alongside the shown items.

`retain_recent_shown` now releases scratches that have fallen outside the final last-32 selection as each entry finishes. Records, versions, authorization judgments and retained histories are unchanged. The existing final sweep remains. On reconstruction from an empty shown map, at most 32 completed ordinary-entry scratches remain; a currently constructed item is additional, and an existing cache or separate capability-group preparation has its own temporary state. This is not a bound on all database memory.

`ScratchRetention.lean` passes value-preservation, final-exclusion equivalence, idempotence and last-32 size bounds. A 71-note regression checks the actual helper before the final sweep, preserving every record/version and matching the original final cache selection. Native execution passed: 71 reconstructed ordinary notes retained a peak of 32 completed scratch documents before the final sweep, with all records/versions unchanged. The six-test warm suite passed in 9.63 seconds; log `/private/tmp/avendb-warm-memory-final.log`. No claim is made that this explains or fixes the observed physical iPhone reload without device evidence.


The same follow-up run measured guarded materialization at 9.970505 ms rebuilding versus 2.05954 ms guarded fork (seven eligible histories × ten repetitions). Its synthetic restore observations were 14.712666 / 14.202 / 14.141208 ms. These are another run's synthetic observations under different load, not an attributable before/after improvement against the earlier timings. The substantive new deterministic result is bounded retained scratch count during reconstruction.
