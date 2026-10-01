<!--
	The card of the cue under the pointer (the source monitor's bar, the timeline's marks): its kind and what that means,
	its label, where it is in the file and how long, its note and why, the take and its rank, how sure the analysis is.
-->
<script>
	import { CUE_MEANING, cueEnd } from './analysis.js';
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();
	const h = $derived(s.cueHover);
	const q = $derived(h?.q);
	const span = $derived(q ? cueEnd(q) - q.s : 0);
	// beside the pointer, kept on the screen
	const left = $derived(h ? Math.min(h.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 300) : 0);
	const top = $derived(h ? Math.max(8, h.y - 120) : 0);
</script>

{#if q}
	<div class="card" style:left="{left}px" style:top="{top}px" role="tooltip">
		<p class="head"><i class="cue-kind {q.kind}" class:best={q.best}></i><b>{q.kind}</b> · {q.label}</p>
		<p class="when">{clockText(q.s)}{span >= 0.05 ? ` → ${clockText(cueEnd(q))} · ${span.toFixed(1)} s` : ''} in the file</p>
		{#if q.kind === 'take' && q.take}<p>Take {q.take}{q.rank ? ` · rank ${q.rank}` : ''}{q.best ? ' · the best' : ''}</p>{/if}
		{#if q.note}<p>{q.note}</p>{/if}
		{#if q.why}<p class="why">{q.why}</p>{/if}
		<p class="meaning">{CUE_MEANING[q.kind] ?? ''}{typeof q.confidence === 'number' ? ` · ${Math.round(q.confidence * 100)} % sure` : ''}</p>
	</div>
{/if}

<style>
	.card {
		position: fixed;
		z-index: 300;
		width: 18rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: var(--panel, #0b1626);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		font-size: 0.75rem;
		line-height: 1.35;
		pointer-events: none;
	}

	p {
		margin: 0 0 0.25rem;
	}

	.head {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.8rem;
	}

	.head i {
		flex: none;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
	}

	.when,
	.meaning {
		color: var(--ink-soft);
	}

	.why {
		font-style: italic;
	}

	.meaning {
		margin: 0.35rem 0 0;
		font-size: 0.7rem;
	}
</style>
