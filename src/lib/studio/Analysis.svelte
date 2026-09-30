<!--
	A file's shot analysis: what it shows, where it serves an edit best, its tags, and its cues (takes, actions,
	emotions, cut points, transitions, highlights, problems). A cue inside `range` (the part a clip plays; none: the
	whole file) goes there on a click; `onmark` offers to mark it as the part to use (the source monitor's In and Out).
	The kinds' colours are `.cue-kind` (global), shared with the timeline's marks.
-->
<script>
	import { analysisOf, cueEnd, cuesOf, tagsOf } from './analysis.js';

	/**
	 * @type {{
	 *   m: import('$lib/auth/client').MediaItem | undefined,
	 *   range?: { from: number, to: number } | null,
	 *   onseek?: (t: number) => void,
	 *   onmark?: (from: number, to: number) => void,
	 * }}
	 */
	let { m, range = null, onseek, onmark } = $props();

	const a = $derived(analysisOf(m));
	const cues = $derived(cuesOf(m));
	const tags = $derived(tagsOf(m));
	/** @param {import('./analysis.js').Cue} q */
	const inside = (q) => !range || (q.s <= range.to && cueEnd(q) >= range.from);
</script>

{#if a}
	<div class="analysis">
		{#if a.summary?.line}<p class="line">{a.summary.line}</p>{/if}
		{#if a.summary?.best_use}<p class="use">Best use: {a.summary.best_use}</p>{/if}
		{#if tags.length}
			<p class="tags">{#each tags as t (t)}<span>{t}</span>{/each}</p>
		{/if}
		{#if cues.length}
			<ul class="cues">
				{#each cues as q, i (i)}
					{@const ok = inside(q)}
					<li class:out={!ok}>
						<button class="go" disabled={!ok || !onseek} onclick={() => onseek?.(range ? Math.min(Math.max(q.s, range.from), range.to) : q.s)} title={ok ? 'Go there' : 'Outside the part this clip plays'}>
							<i class="cue-kind {q.kind}" class:best={q.best}></i>
							<span class="t">{q.s.toFixed(1)}{cueEnd(q) > q.s + 0.05 ? `–${cueEnd(q).toFixed(1)}` : ''} s</span>
							<span class="l"
								><b>{q.kind}</b> {q.label}{q.kind === 'take' && q.take ? ` · take ${q.take}${q.rank ? ` (rank ${q.rank}${q.best ? ', best' : ''})` : ''}` : ''}{#if q.note || q.why}<small>{[q.note, q.why].filter(Boolean).join(' — ')}</small>{/if}</span
							>
						</button>
						{#if onmark && cueEnd(q) > q.s + 0.05}<button class="mark" onclick={() => onmark(q.s, cueEnd(q))} title="Mark it as the part to use (In and Out)">Mark</button>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.analysis {
		font-size: 0.78rem;
	}

	.line {
		margin: 0 0 0.2rem;
		color: var(--ink, #e6eef7);
	}

	.use {
		margin: 0 0 0.3rem;
		color: var(--ink-soft, #b4c4d6);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0.2rem 0 0.4rem;
	}

	.tags span {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		font-size: 0.68rem;
		background: var(--raised, #10243b);
		color: var(--ink-soft, #b4c4d6);
	}

	.cues {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 14rem;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
	}

	li.out {
		opacity: 0.45;
	}

	.go {
		flex: 1;
		display: grid;
		grid-template-columns: 0.5rem 4.2rem 1fr;
		gap: 0.4rem;
		align-items: baseline;
		padding: 0.2rem 0.3rem;
		text-align: left;
		font: inherit;
		font-size: 0.74rem;
		color: inherit;
		background: transparent;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}

	.go:hover:not(:disabled) {
		background: var(--hover, #16304d);
	}

	.go:disabled {
		cursor: default;
	}

	.t {
		font-variant-numeric: tabular-nums;
		color: var(--dim, #8ba1b9);
	}

	.l b {
		font-weight: 600;
		color: var(--ink-soft, #b4c4d6);
	}

	small {
		display: block;
		color: var(--dim, #8ba1b9);
		font-size: 0.68rem;
	}

	.mark {
		padding: 0.1rem 0.45rem;
		font: inherit;
		font-size: 0.68rem;
		color: inherit;
		background: var(--raised, #10243b);
		border: 1px solid var(--edge, #1f3d5f);
		border-radius: 999px;
		cursor: pointer;
	}

	.cue-kind {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
	}

	/* the kinds' colours, one place for the studio (the timeline's marks use them too) */
	:global(.cue-kind) {
		background: var(--dim, #8ba1b9);
	}
	:global(.cue-kind.take) {
		background: var(--cyan, #4cc9d9);
	}
	:global(.cue-kind.take.best) {
		background: var(--accent, #e8a83a);
	}
	:global(.cue-kind.action) {
		background: #6f8fd6;
	}
	:global(.cue-kind.emotion) {
		background: #d67fb1;
	}
	:global(.cue-kind.cut) {
		background: #e8e0c8;
	}
	:global(.cue-kind.transition) {
		background: #3fae96;
	}
	:global(.cue-kind.highlight) {
		background: #f2c14e;
	}
	:global(.cue-kind.problem) {
		background: var(--rec, #ff5a4c);
	}
</style>
