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
