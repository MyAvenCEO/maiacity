# Device latency evidence

The global top-right diagnostics button exposes **Device latency report** before and after unlock. Select iPhone, iPad or Mac, then export a JSON report after exercising that device. Measurements are local to the actual device; desktop or automated-browser results do not substitute for physical iPhone/iPad measurements.

The device retains at most 120 samples in `avendb:latency:v1`, including generic engine reads and mutations. Writes to browser storage are coalesced every two seconds and flushed on page exit/export. A sudden process kill may lose that final interval. A storage-denied browser reports that persistence is unavailable. Stored and exported fields are fixed stage names, numeric durations/timestamps and fixed outcomes; no operation arguments, account identifiers, keys, peer addresses or error text are retained. Imported stored records are validated and projected onto those fields.

- `call.*`: local engine call response time including queueing and any required signing ceremony. It is not UI-render or peer-acceptance latency.
- `unlock.total`: session-level unlock completion, including human authentication time when present.
- `view.first-local-answer`: first local answer for the active view; potentially partial, not a completeness or rendered-frame claim.
- `peer.transport-rtt`: the engine's current selected authenticated connection RTT estimate, captured with **Capture peer connection RTT**. This reads connection telemetry; it does not send a write or claim remote acceptance/visibility.

For an actual-device comparison: export once after warm unlock and using a loaded view, once while catching up and making an ordinary permitted edit, and once on a fresh device's first view. The export button also displays the report as selectable text if file download is unavailable. Avoid clearing PWA storage; clearing it would invalidate warm-state measurements.

Accepted-entry acknowledgement RTT and remote rendered visibility remain unavailable until the engine provides correlated evidence. Internet speed-test results and transport RTT do not establish either metric. No physical-device measurements are claimed by adding these instruments.
