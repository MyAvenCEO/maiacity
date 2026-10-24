# Device latency evidence

The global **top-left** Diagnostics circle exposes the device report before and after unlock. Matching native/WASM builds are required for the peer protocols. Desktop and automated-browser measurements do not substitute for physical iPhone/iPad runs.

## What is measured

| Export field / stage | Actual boundary | Does not establish |
| --- | --- | --- |
| `samples`: `call.*` | Local engine call through response, including queueing and required signing | Render, remote acceptance or durable save |
| `samples`: `unlock.total` | Unlock request through session completion; includes human authentication | Time attributable only to replay |
| `samples`: `query.first-nonempty-emission` | New query subscription through its first nonempty consumer callback completion, spanning empty/refused replies and revisions | Manifest start, paint, whole-view readiness or complete discovery |
| `samples`: `query.first-nonempty-emission.readonly` | The same event when a returned row is read-only | Checkpoint origin, write authority or completeness |
| `samples`: `peer.transport-rtt` | Selected authenticated connection's RTT estimate at capture | Write propagation or useful bandwidth |
| `policyObservations` | Local mutation completion through matched authenticated peer policy receipt | UI consumption, paint or durable save |
| `reactiveObservations` | Local mutation completion through matched authenticated peer receipt after instrumented query-consumer delivery | Paint, durable save or every write in a multi-edit mutation |
| `lifecycle` | Bounded local document/phase/worker/navigation events | Cause of an unobserved browser/OS termination |
| `peerLogCoverage` | Current announced-peer log counts | Files, complete queries or outgoing replication |
| `scenario` | User-selected already-synced or fresh/catching-up label | Verified device completeness or measured whole-view readiness |

Fresh devices now have a real **first useful nonempty query emission** measurement; it must not be described as uninstrumented. However, the export correctly retains `scenario.firstViewReadiness: "unmeasured"`: the entire app view, its files and paint are not timed. Empty-but-complete queries do not produce the nonempty-emission sample. Partial read-only results can produce it. No sample means unmeasured, not zero milliseconds.

One local monotonic clock measures each duration. Do not subtract timestamps from different devices: their wall clocks are not calibrated. Receipt duration includes the return trip and up to a 500 ms polling interval, not just propagation. Report median/p95 only over observed samples and disclose missing samples; exact-head matching can bias the sample set.

## Physical-device procedure

1. On iPhone and iPad, open the Home Screen PWA. Keep both foreground during the propagation test. Use the same authorized collection/view on both devices. Do not clear storage or reset an account.
2. For a warm run, reopen an already-synced device, unlock and visit the target view. Open Diagnostics, select its device label and **Already-synced peers**. For a genuinely new/catching-up device, choose **Fresh / catching-up peer** instead; record actual log coverage separately. The label does not create or reset a device.
3. On **both** devices press **Observe reactive delivery for 2 minutes**. Optionally arm **Observe entry propagation for 2 minutes** as a separate engine-policy measure. Close Diagnostics and make an ordinary permitted edit represented by the other device's active query. No diagnostic chat messages or synthetic vault entries are required.
4. Once the other view updates, reopen Diagnostics on the **originating device**, press **Capture peer propagation and RTT**, then immediately **Export latency and restart report**. Repeat in the opposite direction. Capture/export in the same dialog opening: peer captures are component-local snapshots, not retained by closing the dialog. Recapture after changing devices/accounts. The receiver's query-emission sample is a separate local metric, not a sender-to-receiver clock subtraction.
5. For fresh-device bootstrap, export after its first useful query result while unrelated history is still catching up. Compare `query.first-nonempty-emission`, its optional `.readonly` companion and `peerLogCoverage`. Read-only checkpoint results can be useful before full history; the current reactive receipt intentionally excludes them and does not invent a remote-visibility measurement for them.
6. For the iPhone restart loop, after a recurrence open Diagnostics **before unlocking again** and export **Page restart details**, or the combined latency/restart report. Preserve the preceding `unlock.total` and lifecycle sequence. Test remaining open untouched, then separately background/reopen. Missing page exit is not proof of out-of-memory termination.
7. Share the exported JSON from each device, identifying test direction and whether the result was warm or fresh/catching-up. The combined export also displays selectable report text when downloading is inconvenient. Internet download/upload tests remain a separate Network diagnostics action; those rates alone do not establish avenDB throughput.

## Protocol and coverage limits

Policy stream 18 reports the exact edit's current replay/policy outcome only after current disclosure permission checks. Reactive stream **20** is separate; 19 belongs to checkpoint delivery. It additionally requires the receiver's opted-in consumer registration. Only complete, non-read-only main-head frontiers matching the node's authorized current item/history are registered, at most 64 heads for 30 seconds. The frontend sends at most one registration at a time plus 64 coalesced pending rows. Checkpoint bases, truncated frontiers and quickly superseded writes conservatively remain unmeasured.

Both protocols bind an unpredictable nonce, edit, authenticated peer and connection; check current permission; expire after 30 seconds; target at most three connected peers; and retain at most 64 redacted outcomes. Opt-in lasts two minutes. Timeout, disconnect, unsupported peer and lack of permission never become successful samples. Receipts report the instrumented peer's behavior, not cryptographic proof that a human saw a rendered frame. The generic sampler observes the latest new entry edit per mutation, not every edit in a batch. All peers follow the same rules, including hosted nodes.

The reactive callback measures the subscribed consumer boundary, not arbitrary consumers outside that plumbing. Checkpoint/fresh-view and physical-device acceptance therefore remain separate checks. Lean contracts describe gating, boundedness and non-authority; they do not prove wall-clock latency. Release acceptance records contain the current integrated validation results.

## Persistence and privacy

At most 120 local latency samples survive reload in `avendb:latency:v1`. Ordinary storage writes are coalesced for two seconds and flushed on page exit/export; unlock completion/failure flushes immediately. Abrupt termination may lose pending ordinary samples. Lifecycle history stores at most 64 enum events and elapsed document times. Neither journal contains account identifiers, entry contents, keys, routes, peer addresses or error text. Opaque revision identifiers used in live correlation are ephemeral and are excluded from exported timing samples. Storage denial is reported and never blocks unlock.

Peer samples live in node memory until captured/exported. Existing samples may precede the current scenario label; that label is user-declared context, not a per-sample cohort identifier. Use capture/export immediately after the controlled run and disclose that limitation rather than claiming isolated experimental cohorts.

Implementation lineage: policy receipts [91065a9b](https://github.com/MyAvenCEO/maiacity/commit/91065a9b) and permission checks [6d019c4d](https://github.com/MyAvenCEO/maiacity/commit/6d019c4d); first reactive emission [628a82816](https://github.com/MyAvenCEO/maiacity/commit/628a82816); reactive acknowledgement [e98bc73d5](https://github.com/MyAvenCEO/maiacity/commit/e98bc73d5), with UI-only activation correction [b14e9289a](https://github.com/MyAvenCEO/maiacity/commit/b14e9289a). Integration and deployment are tracked separately; these source changes alone do not claim physical iPhone/iPad success.
