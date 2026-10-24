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
