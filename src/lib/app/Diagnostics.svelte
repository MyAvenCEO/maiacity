<script lang="ts">
 import { base } from '$app/paths';
 import LocalPerformance from '$lib/avendb/LocalPerformance.svelte';
 import LifecycleReport from '$lib/avendb/LifecycleReport.svelte';
 let dialog: HTMLDialogElement;
 let trigger: HTMLButtonElement;
 let network = $state(false);
 let opened = $state(false);
 const id = $props.id();
 function close() { dialog?.close(); }
 function outside(event: PointerEvent) {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
 }
</script>

<button bind:this={trigger} class="diagnostics-trigger" aria-label="Open diagnostics" aria-haspopup="dialog" aria-controls={id} onclick={() => { opened = true; dialog.showModal(); }}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
<dialog bind:this={dialog} {id} aria-labelledby="{id}-title" onpointerdown={outside} onclose={() => { opened = false; network = false; trigger?.focus(); }}>
 <header>
  <h2 id="{id}-title">Diagnostics</h2>
  <button class="close" aria-label="Close diagnostics" onclick={close}>×</button>
 </header>
 {#if network}
  <button class="back" onclick={() => { network = false; }}>← All diagnostics</button>
  <iframe title="This device’s network check" src="{base}/diagnostics/network/index.html"></iframe>
 {:else}
  <p>Checks for this device, available before you unlock.</p>
  <button class="network" onclick={() => { network = true; }}>Network diagnostics</button>
  {#if opened}<LocalPerformance />{/if}
  <LifecycleReport />
 {/if}
</dialog>

<style>
 .diagnostics-trigger { position: fixed; top: calc(.75rem + env(safe-area-inset-top, 0px)); left: calc(.75rem + env(safe-area-inset-left, 0px)); z-index: 1100; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid #d9d1bf; border-radius: 50%; color: #263c2e; background: #faf8f0; box-shadow: 0 3px 16px #18271e26; cursor: pointer; }
 dialog { box-sizing: border-box; width: min(48rem, calc(100vw - 1.5rem)); max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); padding: 1rem; border: 1px solid #d9d1bf; border-radius: 1.25rem; background: #faf8f0; color: #263c2e; overflow: auto; }
 dialog::backdrop { background: #18271e70; }
 header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
 h2 { margin: 0; font-size: 1.4rem; }
 button { color: inherit; cursor: pointer; }
 .close { width: 44px; height: 44px; border: 0; border-radius: 50%; background: #eee9dd; font-size: 1.75rem; }
 .network { min-height: 48px; padding: .7rem 1.1rem; border: 0; border-radius: 2rem; background: #244c35; color: white; font: inherit; }
 .back { min-height: 44px; padding: .5rem 0; border: 0; background: transparent; font: inherit; }
 iframe { display: block; width: 100%; height: 65dvh; min-height: 18rem; border: 1px solid #d9d1bf; border-radius: .8rem; background: #f2f0e8; }
 button:focus-visible { outline: 3px solid #c88721; outline-offset: 3px; }
 p { color: #526557; line-height: 1.5; }
</style>
