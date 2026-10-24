# Coalesced announcement completion wake

The generic announcer used to consume a durable-change notification while a peer
was already being told, skip that busy peer, and forget the skipped work. Successful
completion removed the busy flag without waking the announcer. The next frontier
then depended on the periodic retry interval (normally one second), even on an
otherwise healthy established connection.

Each existing in-flight peer slot now holds one Boolean obligation. Skipping busy
work sets it; successful completion removes it and wakes the ordinary announcer
once. Completion without a skipped pass does not wake itself. Failed completion
still records the normal retry backoff and does not trigger an immediate retry.
All slot updates share one mutex, preserving the completion/skip boundary.

The wake returns through normal news, durable holdings, permission filtering and
wire authentication. It does not resend the old captured holdings or establish
new permissions. All entry types and peer roles use the same path.

AnnounceOwed.lean specifies coalescing, success wake, failure and no-idle-loop
properties. It is a scheduling model, not an extracted proof or wall-clock SLA.
The held-announcement regression mutates an ordinary document, holds the production
scheduling slot, runs the real announce skip path twice, then completes the slot.
With retry set to 60 seconds it requires the coalesced notification within 100 ms,
and separately checks no redundant wake and preservation of failure backoff.
This isolates the scheduling boundary; it does not measure physical wire receipt,
remote rendering, bandwidth utilization or the complete 10–20 second report.

Validation: full Lean build passed 80 jobs. The six live/authentication tests passed
in 6.30s, including this regression, ordinary two-peer propagation with stalled
background pages, and private-entry rejection. Independent review approved the
shared-lock completion edge, coalescing, and unchanged failure-backoff path.
No pre-fix compiled RED run was performed; the runtime regression guards the new
explicit scheduling obligation and source inspection establishes the prior gap.
