# Bounded owner suffix reconstruction — candidate, Rust checks pending

The former 512-write ceiling discarded an otherwise valid adopted base. Core now
retains a validated prefix and admits at most 32 suffix writes per anchor per
`advance_owner_bases` call. There are at most 16 anchors. Judgment/history/items
move from the displayed Shown into the next turn; previously admitted suffixes
are not verified/decrypted/judged again for an unchanged input basis. Completed
anchors retain their cursor too, so another pending anchor cannot reset them.

The original base scratch remains available for concurrent dependency subsets.
Log, key, anchor, warm/forget and material identity changes invalidate the cursor;
reconstruction restarts from the authenticated base under the existing policy,
owner and supported-suffix gates. Changed policy or unsupported suffix still
fails closed. No arbitrary suffix-count ceiling remains.

While suffix work remains, query/get expose `checkpoint.pendingSuffix`, partial
history/file semantics and readOnly=true; core write admission also refuses it.
Validated prefix reads remain available. Only fully processed held suffix enables
the existing narrow owner-main-line writes. This is not global completeness.

The Node coordinator must call the public core advance operation in its background
lane and yield between calls. This commit does not add that pump. Durable signed
log plus authenticated anchor reconstruct progress after restart; the process-local
cursor is not serialized or trusted. Restart therefore repeats bounded turns.

Remaining performance limit: initial suffix discovery/order still scans and clones
held entry edits under the core call. This change bounds signature verification,
decryption and judgment per turn, not that initial preparation, individual edit
cost, or all history/item bookkeeping. Moving preparation outside the shared lock
requires an exact-revision checked plan. Do not claim a hard millisecond deadline.

Lean BootstrapBatch proves prefix partition preservation and pending read-only
semantics under authorization/ordering premises. It passed. Rust parser checks
passed. Added a 513-suffix/restart/write-blocking/final-equality regression; existing
concurrent suffix and policy-refusal regressions remain. Cargo tests pending the
coordinator's queue. No device/deployment result is claimed.

## Concurrent dependency-cut correction

A suffix can build on an earlier version than the checkpoint. The latest full
CRDT snapshot cannot be used as that historical version merely because it contains
those changes. Restoration now hydrates omitted historical bodies only from
locally held authenticated opened edits. Ordinary judgment can then reconstruct
that dependency cut. If it still cannot judge the suffix, adoption fails closed;
it must not install a writable base while silently ignoring that write.

General fresh-peer recovery of such a cut remains incomplete. The next API should
expose the selected suffix's dependency closure entries whose authenticated bodies
are absent, request those exact IDs with ordinary peer authorization, and retry on
arrival. Alternatively authenticated per-write CRDT frontier metadata could permit
safe snapshot checkout. The current implementation does neither automatically.

The ordinary local-write replay fast path also excludes active bootstrap overlays:
a derived checkpoint view must never be stepped and cached as canonical signed-log
replay. The canonical equality assertion remains intact.

Focused Rust validation after the corrections: **8/8 bootstrap_store tests passed**
(11.08 seconds test runtime), including 513 suffix writes with restart, older-depth
concurrent writes, normal owner write/reopen/convergence, actual later narrow-share
audience movement, proposal refusal and fixed-size durable-frontier recovery.
No full-suite, physical-device or Node background-pump validation is implied.
