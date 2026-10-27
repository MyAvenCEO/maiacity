<!--
	The diagnostics report on the Performance page: one report for startup, unlock, restarts, sync, responsiveness and
	connection speed. Nobody runs or copies it (Samuel 2026-10-27: "you fully automated this anyhow"): the checks run as
	the page opens, at most once each `EVERY`, the report with the whole page (`extra`) goes to the server for its person
	(./diagnostics-send.js), and the page shows the results in its sections (`onreport`). It captures every 5 s while
	`active`.
-->
<script lang="ts">
 import { onMount, untrack } from 'svelte';
 import { session } from '$lib/avendb/session.svelte.js';
 import { reactiveObservation } from '$lib/avendb/reactive-observation.js';
 import { createDiagnosticRunner } from '$lib/avendb/diagnostics-report.js';
 import { runNetworkDiagnostics } from '$lib/avendb/network-diagnostics.js';
 import { keepReports, sendReport, snapshot } from '$lib/avendb/diagnostics-send.js';
 let { active = true, extra, onreport }: { active?: boolean, extra?: () => object, onreport?: (report: any) => void } = $props();
 /** the least time between two runs of the checks, which take up to 13 MiB of the connection (ms) */
 const EVERY = 10 * 60_000;
 /** where this browser keeps when it last ran them */
 const LAST = 'maia:diagnostics:ran';
 let runner: ReturnType<typeof createDiagnosticRunner> | undefined;
 let capturesRemaining = 0;
 let mounted = $state(false);
 let running = $state(false);
 let status = $state('');
 const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 const lastRun = () => { try { return Number(localStorage.getItem(LAST)) || 0; } catch { return 0; } };
 function refresh() {
  if (!runner) return null;
  const report = runner.snapshot();
  onreport?.(report);
  return extra ? { ...extra(), diagnostics: report } : report;
 }
 async function run() {
  if (!runner || running) return;
  running = true;
  status = 'Running device, sync and connection checks…';
  try { localStorage.setItem(LAST, String(Date.now())); } catch { /* private mode: runs on each open */ }
  let done = true;
  try { await runner.run(); } catch { done = false; }
  finally { running = false; }
  const report = refresh();
  const sent = session.phase === 'open' && report ? await sendReport({ page: 'performance', ...report }).catch(() => false) : false;
  if (sent) void keepReports();
  status = `${done ? 'Checks ran' : 'Some checks could not finish'} at ${clock(Date.now())}${sent ? ', report sent.' : ', not sent.'}`;
 }
 // each time it becomes active: a fresh report, two minutes of captures, and the checks if they are due
 $effect(() => {
  if (!mounted) return;
  if (!active) { runner?.cancel(); return; }
  untrack(() => {
   refresh(); capturesRemaining = 24; void runner?.capture();
   const last = lastRun();
   if (Date.now() - last >= EVERY) void run();
   else status = `Checks ran at ${clock(last)}; next after ${clock(last + EVERY)}.`;
  });
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

<p role="status" aria-live="polite">{status}</p>

<style>
 p { line-height: 1.5; margin: 0; }
</style>
