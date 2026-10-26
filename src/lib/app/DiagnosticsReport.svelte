<!--
	The diagnostics report: one report for startup, unlock, restarts, sync, responsiveness and connection speed, run and
	copied from here. The Performance page shows it once the vault is open (Samuel 2026-10-26: the top-left button folded
	into Performance), as a bar (`bar`) whose copy takes the whole page too (`extra`) and whose results the page shows in
	its sections (`onreport`); before unlock, ./Diagnostics.svelte opens it in a dialog. It captures every 5 s while `active`.
-->
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
 let { active = true, bar = false, extra, onreport }: { active?: boolean, bar?: boolean, extra?: () => object, onreport?: (report: any) => void } = $props();
 let fallback = $state<HTMLTextAreaElement>();
 let runner: ReturnType<typeof createDiagnosticRunner> | undefined;
 let capturesRemaining = 0;
 let mounted = $state(false);
 let running = $state(false), copied = $state(''), showText = $state(false), logs = $state('');
 let status = $state('Ready. Retained startup and restart details are included automatically.');
 function snapshot() {
  latencyJournal.flush();
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Mac/.test(ua) ? 'Mac' : 'other';
  return {viewReadiness:viewReadiness.snapshot(), ...diagnosticSnapshot({ phase: session.phase, build: version, device, journal: latencyJournal.snapshot(), lifecycle: lifecycle()?.snapshot(), calls: localTimings.snapshot(), manifests: manifestDiagnostics(), sync, playback: playbackMetrics.snapshot() })};
 }
 function refresh() {
  if (!runner) return;
  const report = runner.snapshot();
  onreport?.(report);
  logs = JSON.stringify(extra ? { ...extra(), diagnostics: report } : report, null, 2);
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
 // each time it becomes active: a fresh report and two minutes of captures; inactive, whatever runs is cancelled
 $effect(() => {
  if (!mounted) return;
  if (!active) { runner?.cancel(); return; }
  refresh(); capturesRemaining = 24; void runner?.capture();
 });
 onMount(() => {
  runner = createDiagnosticRunner({ ask: (op: object) => session.ask(op), currentOwner: () => session.device, isOpen: () => session.phase === 'open', snapshot,
   network: (signal: AbortSignal) => runNetworkDiagnostics({ signal }),
   armReactive: (owner: any) => reactiveObservation.arm(owner, (op: unknown) => owner.run(op)), onUpdate: refresh });
  mounted = true;
  const captureTimer = setInterval(() => {
   if (active && !document.hidden && !running && capturesRemaining > 0) { capturesRemaining--; void runner?.capture(); }
  }, 5000);
  const hidden = () => { if (document.hidden) runner?.cancel(); };
  document.addEventListener('visibilitychange', hidden);
  return () => { clearInterval(captureTimer); runner?.cancel(); document.removeEventListener('visibilitychange', hidden); };
 });
</script>

{#if !bar}<p>One report for startup, unlock, restarts, sync, responsiveness and connection speed. Available before and after unlock.</p>{/if}
<div class="actions">
 <button class="btn" data-pick onclick={run} disabled={running}>{running ? 'Running diagnostics…' : 'Run diagnostics'}</button>
 <button class="btn" onclick={copy}>{bar ? 'Copy all' : 'Copy logs'}</button>
</div>
<p role="status" aria-live="polite">{copied || status}</p>
{#if !bar}<p class="note">Keep the app open for up to 45 seconds. Connection checks use up to 13 MiB plus a small release lookup, through Maia City and Cloudflare. No messages or other account entries are created.</p>
<p class="note">For cross-device timing, run diagnostics on both devices, then make an ordinary edit. Compatible peers observe delivery for two minutes. No sample means unmeasured, not instant delivery.</p>{/if}
{#if showText}<textarea bind:this={fallback} aria-label="Diagnostic logs" readonly value={logs} rows="10"></textarea>{/if}

<style>
 .actions { display: flex; gap: .75rem; flex-wrap: wrap; }
 button:disabled { opacity: .6; cursor: default; }
 p { line-height: 1.5; } .note { font-size: .85rem; opacity: .85; }
 textarea { box-sizing: border-box; width: 100%; font-size: .75rem; }
</style>
