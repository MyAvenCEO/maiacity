<script>
	// What a tab shows while it follows an `update` refusal (update.svelte.js): "Updating…", over everything else.
	import { update } from './update.svelte.js';
</script>

{#if update.now}
	<div class="updating" data-testid="updating" role="status" aria-live="polite">Updating…</div>
{/if}

<style>
	/* nothing else shows meanwhile: the app is hidden, not only covered, in the same render as this */
	:global(body:has(.updating) #app) {
		display: none;
	}

	.updating {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-display);
		font-size: 22px;
	}
</style>
