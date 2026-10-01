<!--
	The cue kinds a file has, each in its colour with how many and what it means (on hover) — the key to the coloured
	marks on the source monitor's bar and on the timeline.
-->
<script>
	import { CUE_KINDS, CUE_MEANING } from './analysis.js';

	/** @type {{ cues: import('./analysis.js').Cue[] }} */
	let { cues } = $props();
	const counts = $derived(CUE_KINDS.map((k) => [k, cues.filter((q) => q.kind === k).length]).filter(([, n]) => n));
</script>

{#if counts.length}
	<p class="legend">
		{#each counts as [k, n] (k)}
			<span title={CUE_MEANING[k]}><i class="cue-kind {k}"></i>{k} {n}</span>
		{/each}
	</p>
{/if}

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.7rem;
		margin: 0.3rem 0 0;
		font-size: 0.68rem;
		color: var(--ink-soft);
	}

	span {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		cursor: help;
	}

	i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}
</style>
