<script>
 import { manifestDiagnostics } from '../../../game/code/sources/manifests.js';
 import { onMount } from 'svelte';
 import { localTimings } from './local-timings.js';
 import { playbackMetrics } from '$lib/studio/playback-metrics.js';
 import { session } from './session.svelte.js';
 import { sync } from './sync.svelte.js';
 let manifests = $state(manifestDiagnostics());
 let playback = $state(playbackMetrics.snapshot());
 let measuring = $state(false), result = $state('');
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
 onMount(() => { const timer = setInterval(() => { rows = localTimings.snapshot(); manifests = manifestDiagnostics(); playback = playbackMetrics.snapshot(); }, 500); return () => clearInterval(timer); });
 /** @param {number | null} value */
 const ms = (value) => value === null ? '—' : `${Math.round(value)} ms`;
</script>
<section aria-label="Local loading and peer sync">
 <h3>Studio playback · target 30 FPS</h3>
 <p>{playback.frames} measured world frames · {playback.fps === null ? 'FPS unavailable' : `${playback.fps.toFixed(1)} FPS`} · render p95 {ms(playback.renderP95)} · frame gap p95 {ms(playback.gapP95)}.</p>
 <p>{playback.cuts} measured cuts · cut gap p95 {ms(playback.cutP95)} · {playback.longGaps} gaps over 50 ms · {playback.failures} draw failures. Pauses are excluded; these measurements do not cover native video playback.</p>
 <h3>App manifest scheduling</h3>
 <p>{manifests.pending} pending plans. {#if manifests.runs.length}Last plan: {ms(manifests.runs.at(-1)?.ms ?? null)} · {manifests.runs.at(-1)?.requested} requested entries · {manifests.runs.at(-1)?.state}.{:else}No plan measured in this page yet.{/if} Scheduling completion does not prove files have arrived.</p>
 <h3>Local loading and peer sync</h3>
 <button onclick={measure} disabled={measuring || session.phase !== 'open'}>Measure local summary</button>
 {#if result}<p role="status">{result}</p>{/if}
 <p>Local device calls, including time waiting for the engine. Target: under 1,000 ms. Last 100 completed calls per operation in this page.</p>
 {#if rows.length}
 <table><thead><tr><th>Local call</th><th>Median</th><th>p95</th><th>Waiting now</th><th>Failures</th></tr></thead>
 <tbody>{#each rows as row}<tr><th>{row.op}</th><td>{ms(row.median)}</td><td>{ms(row.p95)}</td><td>{row.pending ? `${row.pending} · ${ms(row.waiting)}` : '—'}</td><td>{row.failed}</td></tr>{/each}</tbody></table>
 {:else}<p>No local-call measurements yet.</p>{/if}
 <p>{sync.known ? `${sync.peers} connected peers · ${sync.behind} announced logs need updates · ${sync.pulling} active requests.` : 'Peer state unavailable.'}</p>
 <p>Log coverage does not confirm file availability or outgoing replication. Peer acceptance round-trip, remote visibility, and manifest file completeness: unavailable until measured by the sync engine.</p>
</section>
<style>
 button { padding: .6rem 1rem; border: 1px solid #d9d1bf; border-radius: 2rem; background: #244c35; color: white; font: inherit; cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
 section { margin-top: 1rem; } p { color: #526557; line-height: 1.5; } table { width: 100%; font-size: .85rem; border-collapse: collapse; } th, td { text-align: left; padding: .4rem; border-bottom: 1px solid #d9d1bf; } h3 { margin-bottom: .5rem; }
</style>
