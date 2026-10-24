<script lang="ts">
 import { onMount } from 'svelte';
 import { lifecycle } from './lifecycle.js';
 let report = $state<ReturnType<NonNullable<ReturnType<typeof lifecycle>>['snapshot']> | null>(null);
 onMount(() => { report = lifecycle()?.snapshot() ?? null; });
</script>

{#if report}
 <details class="lifecycle-report" ontoggle={() => { report = lifecycle()?.snapshot() ?? null; }}>
  <summary>Page restart details</summary>
  <p>This window has loaded {report.current.documents} document{report.current.documents === 1 ? '' : 's'}. Navigation: {report.navigation}.</p>
  {#if report.previous}
   <p>Previous page: {report.previous.phase}, {report.previous.visibility}. Page exit: {report.previous.exit}. Worker errors recorded: {report.previous.workerFailures}.</p>
  {:else}
   <p>No earlier page record is available in this window. The browser may discard this record when it ends the app.</p>
  {/if}
  {#if !report.storageAvailable}<p>This browser could not keep the restart record.</p>{/if}
  <p>A missing exit event does not establish why a page restarted. These local counters contain no account data and cannot unlock the app.</p>
 </details>
{/if}

<style>
 .lifecycle-report { max-width: 32rem; margin: 1rem auto; text-align: left; font-size: .8rem; color: var(--ink-soft); }
 summary { cursor: pointer; text-align: center; }
 p { margin: .6rem 0; line-height: 1.4; }
</style>
