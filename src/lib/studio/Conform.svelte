<!--
	Conform (Grade tab): what the grade is made on. Every media clip goes back to its original (through its input
	transform); every world clip is rendered by the worker as an ACEScct plate per delivery shape. The worker does it
	while it renders (C6): this shows what the last render's report says it used — originals swapped in for proxies,
	plates rendered or reused from the cache — and which LUTs this Mac baked for the viewer.
-->
<script>
	import ColorBadge from './ColorBadge.svelte';
	import HeroFrame from './HeroFrame.svelte';
	import { ODT, profileFor, profileInfo } from './color.js';
	import { SHAPES, clockText, isWorld } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const v1 = $derived(s.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start));
	/** A world clip's plate in a shape, as the last render made it (or found it in the cache). @param {string} clipId @param {string} shape */
	const plate = (clipId, shape) => s.lastReport?.plates?.find((p) => p.clip === clipId && p.aspect === shape);
	/** Did the last render swap this clip's proxy for its original? @param {string} clipId */
	const swapped = (clipId) => s.lastReport?.conformed?.some((x) => x.clip === clipId);
	/** the LUTs the viewer needs for this timeline's pictures */
	const needed = $derived.by(() => {
		const names = new Set([ODT]);
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
		{v1.length - worldCount} media clip{v1.length - worldCount === 1 ? '' : 's'} on originals{#if worldCount}&nbsp;· {worldCount} world clip{worldCount === 1 ? '' : 's'}: a plate per shape{/if}
	</p>
	<div class="seg" role="tablist" aria-label="The viewer plays">
		<button role="tab" aria-selected={s.gradeOn === 'originals'} class:on={s.gradeOn === 'originals'} onclick={() => (s.gradeOn = 'originals')}>Originals</button>
		<button role="tab" aria-selected={s.gradeOn === 'proxies'} class:on={s.gradeOn === 'proxies'} onclick={() => (s.gradeOn = 'proxies')}>Proxies (faster)</button>
	</div>
	<ul>
		{#each v1 as c (c.id)}
			{@const m = c.hash ? s.byHash.get(c.hash) : undefined}
			<li class:on={s.selected === c.id}>
				<button class="row" onclick={() => ((s.selected = c.id), s.seek(c.start))}>
					<span class="t">{clockText(c.start)}</span>
					<span class="nm">{s.clipName(c)}</span>
					{#if c.grade}<b class="gr" title="Graded">◐</b>{/if}
				</button>
				<div class="st">
					{#if isWorld(c)}
						{#each SHAPES as sh (sh)}
							{@const p = plate(c.id, sh)}
							<span class="plate" class:done={!!p} title={p ? `${sh} plate ${p.reused ? 'reused from the cache' : 'rendered'} by the last render` : `${sh} plate: not rendered yet`}>
								{sh} {p ? (p.reused ? '↺' : '✓') : '–'}
							</span>
						{/each}
					{:else if m}
						<ColorBadge {s} {m} />
						<span class="orig" title={swapped(c.id) ? 'The last render swapped the proxy cut in for this original' : ''}>{m.kind === 'image' ? 'still' : 'original'} ✓{swapped(c.id) ? ' (conformed)' : ''}</span>
						{#if m.kind === 'video'}<span class="px">{s.proxy(m).hash ? 'proxy ✓' : 'no proxy'}</span>{/if}
						{#if profileFor(m).profile === 'unknown'}<span class="warn">colour unknown</span>{/if}
					{/if}
				</div>
			</li>
		{/each}
	</ul>
	{#if worldCount && !s.lastReport}
		<p class="note">The plates are rendered with the film (Render tab); their status shows here after the first render.</p>
	{/if}
	{#if s.lastReport?.warnings?.length}
		<ul class="warn">{#each s.lastReport.warnings as w, i (i)}<li>{w}</li>{/each}</ul>
	{/if}
	<h3>Viewer LUTs</h3>
	<p class="sum">
		{s.lutFrom === 'mac' ? 'baked by this Mac (the proxies’ journeys in, ACES 2.0 out)' : 'not baked yet — the viewer shows the signal as it is'}
	</p>
	<ul class="luts">
		{#each needed as n (n)}
			<li><span class:ok={!!s.luts[n]} class="dot"></span>{n} {s.luts[n] ? `· ${s.luts[n]?.size}³` : '· missing'}</li>
		{/each}
	</ul>
	<HeroFrame {s} />
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

	ul.warn {
		padding: 0.4rem 0.5rem 0.4rem 1.2rem;
		border-radius: 6px;
		background: #fbf1dc;
		list-style: disc;
		font-size: 0.68rem;
		color: #7a5a17;
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
