<script>
 import { manifestDiagnostics } from '../../../game/code/sources/manifests.js';
 import { onMount } from 'svelte';
 import { localTimings } from './local-timings.js';
 import { latencyJournal, recordPeerTimings, policyObservations } from './latency-journal.js';
 import { playbackMetrics } from '$lib/studio/playback-metrics.js';
 import { session } from './session.svelte.js';
 import { sync } from './sync.svelte.js';
 import { lifecycle } from './lifecycle.js';
 import { reactiveObservation } from './reactive-observation.js';
 let manifests = $state(manifestDiagnostics());
 let playback = $state(playbackMetrics.snapshot());
 let measuring = $state(false), result = $state('');
 let evidence = $state(latencyJournal.snapshot());
 let exported = $state('');
 let deviceLabel = $state('This device');
 let scenario = $state('already-synced');
 /** @type {ReturnType<typeof policyObservations>} */
 let policy = $state(null);
 /** @type {ReturnType<typeof policyObservations>} */
 let reactive = $state(null);
 async function armReactive() {
  if (measuring || session.phase !== 'open') return;
  measuring = true;
  try {
   const owner = session.device;
   const answer = await session.ask({op:'measure_peer_visibility'});
   if (answer?.ok?.enabled && owner === session.device) {
    reactiveObservation.arm(owner, op => owner.run(op));
    result = 'Observe on both devices, then make an ordinary edit in the current subscribed view. Captures consumer delivery, not paint; exact main-head matches only.';
   } else result = 'Reactive observation is unavailable on this build.';
  } catch { result = 'Reactive observation is unavailable.'; }
  finally { measuring = false; }
 }
 async function armPolicy() {
  if (measuring || session.phase !== 'open') return;
  measuring = true;
  try {
   const answer = await session.ask({ op: 'measure_peer_policy' });
   result = answer?.ok?.enabled ? 'Observing ordinary entry edits for two minutes. Make an edit, then capture the peer measurements.' : 'This build does not support peer policy observations.';
  } catch { result = 'Peer policy observations are unavailable on this build.'; }
  finally { measuring = false; }
 }

 async function measurePeers() {
  if (measuring || session.phase !== 'open') return;
  measuring = true;
  try {
   const answer = await session.ask({ op: 'network' });
   const count = recordPeerTimings(answer?.ok);
   policy = policyObservations(answer?.ok);
   reactive = policyObservations({policy_observations: answer?.ok?.reactive_observations}, 'local-completion-to-peer-reactive-consumer');
   result = `Captured ${count} transport RTT estimates and ${policy?.samples.length ?? 0} policy observations.`;
   evidence = latencyJournal.snapshot();
  } catch { result = 'Peer connection timings are unavailable.'; }
  finally { measuring = false; }
 }
 function exportReport() {
  latencyJournal.flush();
  evidence = latencyJournal.snapshot();
  exported = JSON.stringify({ ...evidence, device: deviceLabel, exportedAt: Date.now(), policyObservations: policy, reactiveObservations: reactive,
   scenario: { declared: scenario, source: 'user-selected', firstViewReadiness: 'unmeasured' },
   peerLogCoverage: sync.known ? { peers: sync.peers, logs: sync.logs, behind: sync.behind, pulling: sync.pulling } : null,
   lifecycle: lifecycle()?.snapshot() ?? null,
   semantics: { calls: 'Local engine response including queue and any signing ceremony; not rendered or remotely replicated.', unlock: 'User unlock request to completion; includes authentication interaction.', view: 'View readiness and rendered frames are not instrumented by this report.', peer: 'Authenticated connection transport RTT estimate; not edit acceptance or remote visibility.' } }, null, 2);
  const url = URL.createObjectURL(new Blob([exported], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `maia-latency-${deviceLabel.replace(/ /g, '-')}-${Date.now()}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
 async function measure() {
  if (measuring || session.phase !== 'open') return;
  measuring = true; result = 'Reading the local summary…';
  const start = performance.now();
  try {
   const answer = await session.ask({ op: 'world' });
   result = answer?.ok ? `Local summary answered in ${Math.round(performance.now() - start)} ms.` : 'Local summary read was refused.';
  } catch { result = 'Local summary read failed.'; }
  finally { measuring = false; }
 }
 let rows = $state(localTimings.snapshot());
 onMount(() => { const timer = setInterval(() => { rows = localTimings.snapshot(); evidence = latencyJournal.snapshot(); manifests = manifestDiagnostics(); playback = playbackMetrics.snapshot(); }, 500); return () => clearInterval(timer); });
 /** @param {number | null} value */
 const ms = (value) => value === null ? '—' : `${Math.round(value)} ms`;
</script>
<section aria-label="Local loading and peer sync">
 <h3>Device latency report</h3>
 <p>Retains the last 120 measured operations across reloads on this device. Contains only fixed stage names, durations and outcomes; no account data, entry IDs or contents.</p>
 <label>Device <select bind:value={deviceLabel}><option>This device</option><option>iPhone</option><option>iPad</option><option>Mac</option></select></label>
 <label>Test scenario <select bind:value={scenario}><option value="already-synced">Already-synced peers</option><option value="fresh-catching-up">Fresh / catching-up peer</option></select></label>
 <p>This is your test label, not a completeness claim. Run the observation on connected devices, make an ordinary edit, then capture and export. Fresh-device first-view readiness: unmeasured.</p>
 <button onclick={exportReport}>Export latency and restart report</button>
 <button onclick={armReactive} disabled={measuring || session.phase !== 'open'}>Observe reactive delivery for 2 minutes</button>
 <button onclick={armPolicy} disabled={measuring || session.phase !== 'open'}>Observe entry propagation for 2 minutes</button>
 <button onclick={measurePeers} disabled={measuring || session.phase !== 'open'}>Capture peer propagation and RTT</button>
 <p>{evidence.samples.length} retained samples. {evidence.storageAvailable ? 'Available here before unlock.' : 'Persistent storage unavailable; these samples may be lost on reload.'}</p>
 {#if exported}<details open><summary>Report text</summary><textarea aria-label="Latency report JSON" readonly value={exported} rows="8"></textarea></details>{/if}
 {#if evidence.samples.length}
 <table><thead><tr><th>Recent stage</th><th>Duration</th><th>Result</th></tr></thead><tbody>
 {#each evidence.samples.slice(-12).reverse() as sample}<tr><td>{sample.stage}</td><td>{ms(sample.ms)}</td><td>{sample.outcome}</td></tr>{/each}
 </tbody></table>{/if}
 {#if reactive}<p>{reactive.samples.length} reactive consumer acknowledgements. Includes network and polling delay; excludes paint and durable-save acknowledgement. Checkpoint or superseded frontiers may remain unmeasured.</p>{/if}
 {#if policy}<p>{policy.samples.length} policy observations captured. Local completion to authenticated peer policy observation includes sync, replay and up to 500 ms polling delay. A standing edit is not proof of rendered UI or durable storage.</p>{/if}
 <p>Local call completion is not a rendered frame or remote acknowledgement. Transport RTT is the connection estimate, not write propagation. Unlock totals include authentication time. View readiness and rendered-frame latency are not measured here.</p>
 <h3>Studio playback · target 30 FPS</h3>
 <p>{playback.frames} measured world frames · {playback.fps === null ? 'FPS unavailable' : `${playback.fps.toFixed(1)} FPS`} · render p95 {ms(playback.renderP95)} · frame gap p95 {ms(playback.gapP95)}.</p>
 <p>{playback.cuts} measured cuts · cut gap p95 {ms(playback.cutP95)} · {playback.longGaps} gaps over 50 ms · {playback.failures} draw failures. Pauses are excluded; these measurements do not cover native video playback.</p>
 <h3>App manifest scheduling</h3>
 <p>{manifests.pending} pending plans. {#if manifests.runs.length}Last plan: {ms(manifests.runs.at(-1)?.ms ?? null)} · {manifests.runs.at(-1)?.requested} requested entries · {manifests.runs.at(-1)?.state}.{:else}No plan measured in this page yet.{/if} Scheduling completion does not prove files have arrived.</p>
 <h3>Local loading and peer sync</h3>
 <button onclick={measure} disabled={measuring || session.phase !== 'open'}>Measure local summary</button>
 {#if result}<p role="status">{result}</p>{/if}
 <p>Local device calls, including time waiting for the engine. Last 100 completed calls per operation in this page; generic mutations are included. Signing ceremonies, when required, are part of the call duration.</p>
 {#if rows.length}
 <table><thead><tr><th>Local call</th><th>Median</th><th>p95</th><th>Waiting now</th><th>Failures</th></tr></thead>
 <tbody>{#each rows as row}<tr><th>{row.op}</th><td>{ms(row.median)}</td><td>{ms(row.p95)}</td><td>{row.pending ? `${row.pending} · ${ms(row.waiting)}` : '—'}</td><td>{row.failed}</td></tr>{/each}</tbody></table>
 {:else}<p>No local-call measurements yet.</p>{/if}
 <p>{sync.known ? `${sync.peers} connected peers · ${sync.behind} announced logs need updates · ${sync.pulling} active requests.` : 'Peer state unavailable.'}</p>
 <p>Log coverage does not confirm file availability or outgoing replication. Peer policy observations require opting in above and compatible peers. Remote visibility and manifest file completeness remain unavailable.</p>
</section>
<style>
 textarea { width: 100%; box-sizing: border-box; } select { font: inherit; margin: .5rem; } button { margin: .2rem; padding: .6rem 1rem; border: 1px solid #d9d1bf; border-radius: 2rem; background: #244c35; color: white; font: inherit; cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
 section { margin-top: 1rem; } p { color: #526557; line-height: 1.5; } table { width: 100%; font-size: .85rem; border-collapse: collapse; } th, td { text-align: left; padding: .4rem; border-bottom: 1px solid #d9d1bf; } h3 { margin-bottom: .5rem; }
</style>
