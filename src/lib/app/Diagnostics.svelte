<!--
	The diagnostics button, top left, before the vault is open: the sign-in and unlock screens have no Performance page,
	so the report (./DiagnosticsReport.svelte) opens here in a dialog. Once open, it lives on the Performance page alone.
-->
<script lang="ts">
 import { screenSlot } from './screen-slots.js';
 import DiagnosticsReport from './DiagnosticsReport.svelte';
 let dialog: HTMLDialogElement, trigger: HTMLButtonElement;
 let open = $state(false);
 const id = $props.id();
 function close() { dialog?.close(); }
 function outside(event: PointerEvent) {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
 }
</script>

<button use:screenSlot={'diagnostics'} bind:this={trigger} class="diagnostics-trigger" aria-label="Open diagnostics" aria-haspopup="dialog" aria-controls={id} onclick={() => { dialog.showModal(); open = true; }}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" stroke-linecap="round" stroke-linejoin="round" /></svg>
</button>
<dialog bind:this={dialog} {id} aria-labelledby="{id}-title" onpointerdown={outside} onclose={() => { open = false; trigger?.focus(); }}>
 <header><h2 id="{id}-title">Diagnostics</h2><button class="close" aria-label="Close diagnostics" onclick={close}>×</button></header>
 <DiagnosticsReport active={open} />
</dialog>

<style>
 /* Fixed top-left on its own; the app's top bar (.screen-chrome [data-screen-slot]) places it in the bar instead. */
 .diagnostics-trigger { position: fixed; top: calc(.75rem + env(safe-area-inset-top, 0px)); left: calc(.75rem + env(safe-area-inset-left, 0px)); z-index: 1100; flex: none; display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid #d9d1bf; border-radius: 50%; color: #263c2e; background: var(--overlay-paper); box-shadow: 0 3px 16px #18271e26; cursor: pointer; }
 @media (pointer: coarse) { .diagnostics-trigger { width: 44px; height: 44px; } }
 dialog { box-sizing: border-box; width: min(36rem, calc(100vw - 1.5rem)); max-height: calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); padding: 1.2rem; border: 1px solid #d9d1bf; border-radius: 1.25rem; background: #faf8f0; color: #263c2e; overflow: auto; }
 dialog::backdrop { background: #18271e70; }
 header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
 h2 { margin: 0; font-size: 1.4rem; }
 button { color: inherit; cursor: pointer; font: inherit; }
 .close { width: 44px; height: 44px; border: 0; border-radius: 50%; background: #eee9dd; font-size: 1.75rem; }
 dialog :global(.btn) { min-height: 48px; padding: .7rem 1.1rem; border: 1px solid #244c35; border-radius: 2rem; background: transparent; color: inherit; cursor: pointer; font: inherit; }
 dialog :global(.btn[data-pick]) { background: #244c35; color: white; }
 dialog :global(p) { color: #526557; }
 button:focus-visible, dialog :global(.btn:focus-visible) { outline: 3px solid #c88721; outline-offset: 3px; }
</style>
