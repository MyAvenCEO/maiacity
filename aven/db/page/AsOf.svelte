<!--
	The line beside every action (approve, accept, decline, delete): what it acts on, as of when (./fresh.js
	`actionLine`, aven/db/spec/AvenDB/Freshness.lean). Never a gate: the action goes on what the device holds, at once,
	and syncs on (local first). On current data nothing shows.
-->
<script>
	import { actionLine } from './fresh.js';

	/** @type {{ fresh: ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf> }} */
	let { fresh } = $props();
	const line = $derived(actionLine(fresh));
</script>

{#if line}
	<p class="as-of" role="status">{line}</p>
{/if}

<style>
	.as-of {
		margin: 0.5rem 0;
		padding: 0.55rem 0.8rem;
		border-radius: 0.7rem;
		background: var(--surface-2, rgb(0 0 0 / 0.05));
		font-size: 0.85rem;
	}
</style>
