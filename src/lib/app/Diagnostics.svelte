<script lang="ts">
 import { viewReadiness } from '$lib/avendb/view-readiness.js';
 import { version } from '$app/environment';
 import { onMount, tick } from 'svelte';
 import { manifestDiagnostics } from '../../../game/code/sources/device.js';
 import { localTimings } from '$lib/avendb/local-timings.js';
 import { latencyJournal } from '$lib/avendb/latency-journal.js';
 import { lifecycle } from '$lib/avendb/lifecycle.js';
 import { session } from '$lib/avendb/session.svelte.js';
 import { sync } from '$lib/avendb/sync.svelte.js';
 import { reactiveObservation } from '$lib/avendb/reactive-observation.js';
 import { playbackMetrics } from '$lib/studio/playback-metrics.js';
 import { createDiagnosticRunner, diagnosticSnapshot } from '$lib/avendb/diagnostics-report.js';
 import { runNetworkDiagnostics } from '$lib/avendb/network-diagnostics.js';
 let dialog: HTMLDialogElement, trigger: HTMLButtonElement;
 let fallback = $state<HTMLTextAreaElement>();
 let runner: ReturnType<typeof createDiagnosticRunner> | undefined;
 let capturesRemaining = 0;
 let running = $state(false), copied = $state(''), showText = $state(false), logs = $state('');
 let status = $state('Ready. Retained startup and restart details are included automatically.');
 const id = $props.id();
 function snapshot() {
  latencyJournal.flush();
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Mac/.test(ua) ? 'Mac' : 'other';
  return {viewReadiness:viewReadiness.snapshot(), ...diagnosticSnapshot({ phase: session.phase, build: version, device, journal: latencyJournal.snapshot(), lifecycle: lifecycle()?.snapshot(), calls: localTimings.snapshot(), manifests: manifestDiagnostics(), sync, playback: playbackMetrics.snapshot() })};
 }
 function refresh() { if (runner) logs = JSON.stringify(runner.snapshot(), null, 2); }
 function close() { runner?.cancel(); dialog?.close(); }
 function outside(event: PointerEvent) {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
 }
 async function run() {
  if (!runner || running) return;
  running = true; copied = ''; showText = false;
  status = 'Running device, sync and connection checks…';
  try { await runner.run(); status = 'Checks captured. Copy logs to share this report. Missing measurements are marked unavailable.'; }
  catch { status = 'Some checks could not finish. Copy logs includes the available evidence.'; }
  finally { running = false; refresh(); }
 }
 async function copy() {
  // Keep clipboard.writeText inside the click's activation on iOS.
  refresh();
  try { await navigator.clipboard.writeText(logs); copied = 'Logs copied.'; }
  catch { showText = true; copied = 'Clipboard unavailable. The report is selected below for copying.'; await tick(); fallback?.focus(); fallback?.select(); }
 }
 onMount(() => {
  runner = createDiagnosticRunner({ ask: (op: object) => session.ask(op), currentOwner: () => session.device, isOpen: () => session.phase === 'open', snapshot,
   network: (signal: AbortSignal) => runNetworkDiagnostics({ signal }),
   armReactive: (owner: any) => reactiveObservation.arm(owner, (op: unknown) => owner.run(op)), onUpdate: refresh });
  const captureTimer = setInterval(() => {
   if (dialog?.open && !document.hidden && !running && capturesRemaining > 0) { capturesRemaining--; void runner?.capture(); }
  }, 5000);
  const hidden = () => { if (document.hidden) runner?.cancel(); };
  document.addEventListener('visibilitychange', hidden);
  return () => { clearInterval(captureTimer); runner?.cancel(); document.removeEventListener('visibilitychange', hidden); };
 });
</script>

<button bind:this={trigger} class="diagnostics-trigger" aria-label="Open diagnostics" aria-haspopup="dialog" aria-controls={id} onclick={() => { refresh(); dialog.showModal(); capturesRemaining = 24; void runner?.capture(); }}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
<dialog bind:this={dialog} {id} aria-labelledby="{id}-title" onpointerdown={outside} onclose={() => { runner?.cancel(); trigger?.focus(); }}>
 <header><h2 id="{id}-title">Diagnostics</h2><button class="close" aria-label="Close diagnostics" onclick={close}>×</button></header>
 <p>One report for startup, unlock, restarts, sync, responsiveness and connection speed. Available before and after unlock.</p>
 <div class="actions">
  <button class="primary" onclick={run} disabled={running}>{running ? 'Running diagnostics…' : 'Run diagnostics'}</button>
  <button class="secondary" onclick={copy}>Copy logs</button>
 </div>
 <p role="status" aria-live="polite">{copied || status}</p>
 <p class="note">Keep the app open for up to 45 seconds. Connection checks use up to 13 MiB plus a small release lookup, through Maia City and Cloudflare. No messages or other account entries are created.</p>
 <p class="note">For cross-device timing, run diagnostics on both devices, then make an ordinary edit. Compatible peers observe delivery for two minutes. No sample means unmeasured, not instant delivery.</p>
 {#if showText}<textarea bind:this={fallback} aria-label="Diagnostic logs" readonly value={logs} rows="10"></textarea>{/if}
</dialog>

<style>
 .diagnostics-trigger { position: fixed; top: calc(.75rem + env(safe-area-inset-top, 0px)); left: calc(.75rem + env(safe-area-inset-left, 0px)); z-index: 1100; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid #d9d1bf; border-radius: 50%; color: #263c2e; background: #faf8f0; box-shadow: 0 3px 16px #18271e26; cursor: pointer; }
 dialog { box-sizing: border-box; width: min(36rem, calc(100vw - 1.5rem)); max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); padding: 1.2rem; border: 1px solid #d9d1bf; border-radius: 1.25rem; background: #faf8f0; color: #263c2e; overflow: auto; }
 dialog::backdrop { background: #18271e70; }
 header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
 h2 { margin: 0; font-size: 1.4rem; }
 button { color: inherit; cursor: pointer; font: inherit; }
 .close { width: 44px; height: 44px; border: 0; border-radius: 50%; background: #eee9dd; font-size: 1.75rem; }
 .actions { display: flex; gap: .75rem; flex-wrap: wrap; }
 .primary, .secondary { min-height: 48px; padding: .7rem 1.1rem; border: 1px solid #244c35; border-radius: 2rem; }
 .primary { background: #244c35; color: white; } .secondary { background: transparent; }
 button:disabled { opacity: .6; cursor: default; }
 button:focus-visible { outline: 3px solid #c88721; outline-offset: 3px; }
 p { color: #526557; line-height: 1.5; } .note { font-size: .85rem; }
 textarea { box-sizing: border-box; width: 100%; font-size: .75rem; }
</style>
