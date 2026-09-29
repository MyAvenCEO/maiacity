<!--
	Conform (Grade tab): what the grade is made on. Every media clip goes back to its original (through its input
	transform); every world clip is rendered by the worker as an ACEScct plate per delivery shape. This only shows how
	far that is — the worker does the work (plate jobs, C6) — and which preview LUTs the viewer has.
-->
<script lang="ts">
	import ColorBadge from './ColorBadge.svelte';
	import { ODT, profileFor, profileInfo } from './color';
	import { SHAPES, clockText, isWorld, type Studio } from './studio.svelte';

	let { s }: { s: Studio } = $props();

	const v1 = $derived(s.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start));
	const plate = (clipId: string, shape: string) =>
		[...s.plateJobs].sort((a, b) => Date.parse(b.created) - Date.parse(a.created)).find((j) => j.clip_id === clipId && j.shape === shape);
	/** the preview LUTs the viewer needs for this timeline's pictures */
	const needed = $derived.by(() => {
		const names = new Set<string>([ODT]);
		for (const c of v1) {
			const p = s.profileOfClip(c);
			const idt = profileInfo(p).idt;
			if (idt) names.add(idt);
		}
		return [...names];
	});
	const worldCount = $derived(v1.filter((c) => isWorld(c)).length);
</script>

<aside class="conform">
	<h3>Conform</h3>
	<p class="sum">
		{v1.length - worldCount} media clip{v1.length - worldCount === 1 ? '' : 's'} on originals{#if worldCount} · {worldCount} world clip{worldCount === 1 ? '' : 's'}: a plate per shape{/if}
	</p>
	<div class="seg" role="tablist" aria-label="The viewer plays">
		<button role="tab" aria-selected={s.gradeOn === 'originals'} class:on={s.gradeOn === 'originals'} onclick={() => (s.gradeOn = 'originals')}>Originals</button>
		<button role="tab" aria-selected={s.gradeOn === 'proxies'} class:on={s.gradeOn === 'proxies'} onclick={() => (s.gradeOn = 'proxies')}>Proxies (faster)</button>
	</div>
	<ul>
		{#each v1 as c (c.id)}
			{@const m = c.cid ? s.byCid.get(c.cid) : undefined}
			<li class:on={s.selected === c.id}>
				<button class="row" onclick={() => ((s.selected = c.id), s.seek(c.start))}>
					<span class="t">{clockText(c.start)}</span>
					<span class="nm">{s.clipName(c)}</span>
					{#if c.grade}<b class="gr" title="Graded">◐</b>{/if}
				</button>
				<div class="st">
					{#if isWorld(c)}
						{#each SHAPES as sh (sh)}
							{@const j = plate(c.id, sh)}
							<span class="plate {j?.status ?? 'none'}" title={j ? `${sh} plate: ${j.status}${j.note ? ` — ${j.note}` : ''}` : `${sh} plate: not rendered yet`}>
								{sh} {j ? (j.status === 'rendering' ? `${Math.round(j.progress * 100)}%` : j.status === 'done' ? '✓' : j.status) : '–'}
							</span>
						{/each}
					{:else if m}
						<ColorBadge {s} {m} />
						<span class="orig">{m.kind === 'image' ? 'still' : 'original'} ✓</span>
						{#if m.kind === 'video'}<span class="px">{s.proxy(m).cid ? 'proxy ✓' : 'no proxy'}</span>{/if}
						{#if profileFor(m).profile === 'unknown'}<span class="warn">colour unknown</span>{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	{#if worldCount && !s.jobsKnown}
		<p class="note">The plates' progress shows once the API lists jobs (<code>GET /api/renders?kind=plate</code>).</p>
	{/if}
	<h3>Preview LUTs</h3>
	<p class="sum">
		{s.lutFrom === 'api' ? 'from the worker (GET /api/film/luts)' : s.lutFrom === 'library' ? 'found in the library (role:lut)' : 'none yet — the viewer uses formula transforms'}
	</p>
	<ul class="luts">
		{#each needed as n (n)}
			<li><span class:ok={!!s.luts[n]} class="dot"></span>{n} {s.luts[n] ? `· ${s.luts[n]!.size}³` : '· missing'}</li>
		{/each}
	</ul>
</aside>

<style>
	.conform {
		grid-area: bin;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 0;
		padding: 0.8rem;
		overflow: auto;
		background: var(--panel);
	}

	h3 {
		margin: 0.3rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.sum,
	.note {
		margin: 0;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.note code {
		font-size: 0.66rem;
	}

	.seg {
		display: flex;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
	}

	.seg button {
		flex: 1;
		padding: 0.2rem 0.4rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--dim);
		cursor: pointer;
	}

	.seg button.on {
		background: var(--ink);
		color: #fff;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 0.3rem 0.35rem;
		border-radius: 8px;
	}

	li.on {
		background: #f3e3c1;
	}

	.row {
		display: flex;
		gap: 0.45rem;
		align-items: baseline;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.t {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.64rem;
		color: var(--dim);
	}

	.nm {
		flex: 1;
		overflow: hidden;
		font-size: 0.78rem;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.gr {
		font-size: 0.66rem;
		color: #a8741a;
	}

	.st {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		margin-top: 0.2rem;
		font-size: 0.64rem;
	}

	.orig,
	.px {
		color: #2f7d4f;
	}

	.warn {
		color: #9c3b26;
	}

	.plate {
		padding: 0 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: #fff;
		color: var(--dim);
	}

	.plate.done {
		border-color: #7fa98f;
		color: #2f7d4f;
	}

	.plate.rendering,
	.plate.queued {
		border-color: #d4a64a;
		color: #a8741a;
	}

	.plate.failed {
		border-color: #d49a8a;
		color: #9c3b26;
	}

	.luts li {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		padding: 0.1rem 0;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.68rem;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #d49a8a;
	}

	.dot.ok {
		background: #2f7d4f;
	}
</style>
