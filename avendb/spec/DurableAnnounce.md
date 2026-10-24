# Durable edit announcement scheduling

A locally accepted entry wakes the saver. Previously `save_on` persisted its
journal and signer receipts, then computed and stored optional restart summaries
(warmed keys/view and range summaries), and only the outer saver notified the
announcer. A slow optional store operation therefore delayed the event that
advertised an already durable frontier. Periodic reconciliation could mask this
edge, but should not be required for live propagation.

The scheduling boundary is after journal and any enabled signer persistence and
before optional derived work. Holdings, permissions, wire validation and remote
materialization remain unchanged. All peer roles and entry types use this path.
No unsaved edit is advertised as durable, and no optimistic UI value is invented.

`AvenDB/DurableAnnounce.lean` was checked before implementation. It proves only
the Boolean scheduling contract: authoritative journal and receipt readiness
are required; optional derived state does not affect eligibility. It is not an
extraction proof, durability theorem, or elapsed-time guarantee.

The generic note regression holds optional view persistence, verifies the
journal frontier is durable, and requires a notification while that optional I/O
is still held. It disables unrelated node background tasks to avoid periodic
reconciliation rescuing the tested wakeup. The same regression failed at the intended notification assertion on the old
behavior, then passed after the six-line notification change. It does not rely
on an observed 10-second network wait or claim a measured remote latency.

This boundary test does not explain every observed 10–20 second delivery delay.
Small-entry latency also includes persistence, announcement scheduling, network
RTT, authentication and causal replay. Bandwidth utilization is meaningful for
bulk transfer; maximizing a bandwidth percentage is not a latency acceptance
criterion for a small message. Physical-device phase timings remain necessary.

Runtime validation: eight persistence regressions passed, including interrupted
saves, lineage replacement, recovery and invalidated snapshot retry; five live
priority regressions passed, including a generic entry arriving during stalled
background pages and refusal to disclose a private entry. These are local
authenticated-peer fixtures, not measurements from the user’s physical devices.

Full Lean build passed (78 jobs). Independent source review approved the
persistence boundary and regression isolation. No physical-device speed claim
follows from these checks.
