<script lang="ts">
 import { onMount } from 'svelte';
 import { lifecycle } from './lifecycle.js';
 import { restartEvidence } from './restart-evidence.js';
 let report = $state<ReturnType<NonNullable<ReturnType<typeof lifecycle>>['snapshot']> | null>(null);
 onMount(() => { report = lifecycle()?.snapshot() ?? null; });
 function exportReport() {
  report = lifecycle()?.snapshot() ?? null;
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, ...report}, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'maia-page-restarts.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
</script>

{#if report}
 <details class="lifecycle-report" ontoggle={() => { report = lifecycle()?.snapshot() ?? null; }}>
  <summary>Page restart details</summary>
  <p>{restartEvidence(report).text}</p>
  <p>This window has loaded {report.current.documents} document{report.current.documents === 1 ? '' : 's'}. Navigation: {report.navigation}.</p>
  {#if report.previous}
   <p>Previous page: {report.previous.phase}, {report.previous.visibility}. Page exit: {report.previous.exit}. Worker errors recorded: {report.previous.workerFailures}.</p>
  {:else}
   <p>No earlier page record is available in this window. The browser may discard this record when it ends the app.</p>
  {/if}
  {#if !report.storageAvailable}<p>This browser could not keep the restart record.</p>{/if}
  {#if !report.journalAvailable}<p>This browser could not persist the event history.</p>{/if}
  <button type="button" onclick={exportReport}>Export restart details</button>
  <p>Recent events (elapsed time within each document):</p>
  <ol>
   {#each report.events.slice(-16) as event}
    <li>Document {event.document} · {(event.ms / 1000).toFixed(1)}s · {event.event} · {event.phase}</li>
   {/each}
  </ol>
  <p>A missing exit event does not establish why a page restarted. The export contains up to 64 local event records, no account data, URLs or error text, and cannot unlock the app. An unrecorded browser or operating-system restart remains an unknown cause.</p>
 </details>
{/if}

<style>
 .lifecycle-report { max-width: 32rem; margin: 1rem auto; text-align: left; font-size: .8rem; color: var(--ink-soft); }
 summary { cursor: pointer; text-align: center; }
 button { min-height: 44px; border: 1px solid currentColor; border-radius: 1.5rem; padding: .5rem 1rem; background: transparent; color: inherit; font: inherit; cursor: pointer; }
 ol { padding-left: 1.2rem; overflow-wrap: anywhere; }
 p { margin: .6rem 0; line-height: 1.4; }
</style>
