# Reuse judged materialization on startup

## Root cause and implementation

`Judging::judge` imports an entry's updates into a Loro scratch document to evaluate schema and authorization rules. Previously, `Judging::shown_on` imported the same selected history a second time whenever it had no previous shown item. This occurs during reconstruction, including warm-view reopening.

The new production fallback asks `Scratch::shown_for` for a fork of the already materialized item. It is eligible only when the scratch holds exactly the selected canonical history, every selected change currently counts, at least one selected write carries a content update, and no updates are parked awaiting dependencies. Otherwise it uses the original canonical importer. Existing incremental reuse of a prior shown item is unchanged.

Judgment and authorization still run. Rejected changes never become visible through this optimization. Draft/line selection remains upstream. The fork selects the requesting device's line peer, preserving subsequent editing. No persisted format, key ownership, authority, live store or checkpoint trust changes.

## Validation and boundaries

The Lean specification `AvenDB/ShownScratch.lean` establishes conditional projection equivalence and canonical fallback. Its explicit agreement premise is exercised against real Loro in native tests; the proof does not verify Loro or establish a timing claim.

Native checks cover record and version equality, subsequent edits by three signers, rejected-change and selected-subset fallback, authorization revocation/restoration, and parked dependency detection. The microbenchmark compares ten reconstructions and guarded forks of the same eligible histories. End-to-end synthetic warm restore separately checks retained records and stored-view selection.

**Current status: implementation prepared; native validation pending in the combined integration checkout.** Standalone Lean check passed using `.elan/bin/lake env lean AvenDB/ShownScratch.lean`. No native speedup is claimed for this change until the parity tests and comparable-history benchmark execute. This change removes duplicate materialization, not canonical judgment, key reconstruction, or fresh-device bootstrap. It must not be reported as solving the entire multi-second unlock complaint.
