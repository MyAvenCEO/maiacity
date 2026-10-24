# Device latency evidence

The global top-right diagnostics button exposes **Device latency report** before and after unlock. Select iPhone, iPad or Mac, then export a JSON report after exercising that device. Measurements are local to the actual device; desktop or automated-browser results do not substitute for physical iPhone/iPad measurements.

The device retains at most 120 samples in `avendb:latency:v1`, including generic engine reads and mutations. Writes to browser storage are coalesced every two seconds and flushed on page exit/export. Unlock completion/failure flushes once immediately, before its promise returns, so that boundary survives a document restart without an exit event. A sudden process kill may lose that final interval. A storage-denied browser reports that persistence is unavailable. Stored and exported fields are fixed stage names, numeric durations/timestamps and fixed outcomes; no operation arguments, account identifiers, keys, peer addresses or error text are retained. Imported stored records are validated and projected onto those fields.

- `call.*`: local engine call response time including queueing and any required signing ceremony. It is not UI-render or peer-acceptance latency.
- `unlock.total`: session-level unlock completion, including human authentication time when present.
- Active-view readiness and rendered-frame latency are not yet instrumented. A generic query response is deliberately not labelled a completed view.
- `peer.transport-rtt`: the engine's current selected authenticated connection RTT estimate, captured with **Capture peer connection RTT**. This reads connection telemetry; it does not send a write or claim remote acceptance/visibility.

For an actual-device comparison: export once after warm unlock and using a loaded view, once while catching up and making an ordinary permitted edit, and once on a fresh device's first view. The export button also displays the report as selectable text if file download is unavailable. Avoid clearing PWA storage; clearing it would invalidate warm-state measurements.

Accepted-entry acknowledgement RTT and remote rendered visibility remain unavailable until the engine provides correlated evidence. Internet speed-test results and transport RTT do not establish either metric. No physical-device measurements are claimed by adding these instruments.

## Remote edit acceptance: protocol gap and implementation boundary

Source review on 2026-10-24 found no per-edit acceptance receipt that a JS diagnostic can safely time:

- `session.rs::answer_body(ANNOUNCE)` calls `Shared::hear` and schedules a pull before returning an empty response. That response confirms receipt of an inventory, not receipt of the edit itself.
- `REQUEST`/`ASK_LOGS` replies deliver records to the requester. Completion of serving that reply does not establish that the requester validated or materialized them.
- `Lab::receive_prepared` returns a new-record count and affected owners. It does not return per-edit materialization results; the live path separately calls `materialize_live` after receiving records.
- Authenticated `Announce` frontiers and signed `Statement` frontiers describe retained records. An exact edit-head observation could measure **peer-reported retention**, with appropriate causal matching, but cannot stand in for policy application or rendered visibility. A forwarded signed statement also lacks a fresh round-trip challenge.
- `Traffic::Page.wait_ms` includes request admission, encoding and decoding; its pipeline interval can overlap another page. Neither is outgoing write acceptance RTT.

The smallest honest acceptance instrument therefore requires engine/protocol work, not a renamed frontend timer:

1. Track ordinary local mutation edit IDs and a monotonic start time in a bounded, expiring in-memory table. Do not create diagnostic entries in user vaults. Keep identifiers out of persisted/exported reports.
2. Specify three different outcomes: signed record retained, current-policy application completed (or waiting/rejected), and storage commit completed. Never emit the second merely because signature checking returned or a record was stored. Concurrent/revoked edits can legitimately stop at different stages.
3. Add a bounded, capability-negotiated receipt exchange over the existing hello-authenticated peer connection. Bind each request/receipt to an unpredictable correlation nonce, exact edit IDs and that connection's proven identity. The receiver must recheck the requester's current permission before disclosing any result. Unknown and unauthorized IDs must not become an existence oracle. Apply the same behavior to every peer, including the hosted node.
4. Produce the application outcome only after the generic materialization/policy barrier, using a core result that distinguishes applied, waiting and rejected records. Both sparse-range and legacy receive paths must feed this same result. A timeout or unsupported old peer remains unavailable, never zero milliseconds or success.
5. At the originating device, stop its monotonic timer only on the matched fresh receipt. Export redacted duration/stage/outcome through `network` and the bounded journal. Call the metric **local commit to peer application receipt**: it includes announcement, pull, validation, scheduling, policy work and return delivery, not just network RTT. A separate request-to-receipt timing is possible but excludes earlier propagation delay.
6. Test reordered/duplicate/stale receipts, wrong authenticated identity, reconnect, missing dependencies, revocation during validation, cancellation and bounded-table overflow. Specify receipt non-authority and stage separation in Lean before enabling the feature. Receipts are evidence reported by the authenticated peer, not a grant of access or proof that its UI rendered.
7. For rendered visibility, add a distinct local reactive-view/render hook on the receiving device; an engine receipt alone cannot measure that boundary. Run ordinary permitted edits on physical iPhone/iPad/Mac and export each device's actual report. Do not substitute simulated/browser automation timings for physical measurements.

Until these engine contracts exist, the diagnostics intentionally expose transport RTT and local call timing only. No remote acceptance measurement or physical-device result was added by this review.
