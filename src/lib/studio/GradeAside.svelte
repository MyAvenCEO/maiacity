<!--
	The Grade tab's aside, the full height beside the picture. On top: what the picture is judged on (its 4K still, its
	proxy, its original). Under it, the stack chosen on the timeline (a click on its bar) — the selected shot's base
	correct or clip look (with the shot's framing in the shape seen), its scene's look, the timeline's look — as its
	tools (ToolStack: every tool from the one registry, masks as groups of their own tools), its strength, a tool added
	from the menu.
-->
<script>
	import { fine } from './fine.js';
	import { isWorld } from './studio.svelte.js';
	import ToolStack from './ToolStack.svelte';
	import { LAYERS, ofShot, setStack, stackOf } from './grade.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const pics = $derived(s.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start));
	const clip = $derived(s.sel?.track === 'V1' ? s.sel : null);
	const shotNo = $derived(clip ? pics.findIndex((c) => c.id === clip.id) + 1 : 0);
	const scene = $derived(clip?.script?.scene || null);
	const layer = $derived(LAYERS.find((l) => l.id === s.gradeLayer) ?? LAYERS[LAYERS.length - 1]);
	const needsShot = $derived(ofShot(layer.id) || layer.id === 'scene');
	const stack = $derived(stackOf(s, layer.id, clip));
	/** @param {import('$lib/auth/client').GradeTool[]} tools */
	const putTools = (tools) => setStack(s, layer.id, clip, { ...(stack?.strength !== undefined ? { strength: stack.strength } : {}), tools });
	/** @param {number} k */
	const putStrength = (k) => setStack(s, layer.id, clip, { strength: k, tools: stack?.tools ?? [] });

	/** @type {['x' | 'y' | 'zoom', number, number, number][]} */
	const FRAME = [['x', -1, 1, 0], ['y', -1, 1, 0], ['zoom', 1, 3, 1]];
	const frame = $derived(clip?.frame?.[s.shape] ?? { x: 0, y: 0, zoom: 1 });
	const framed = $derived(!!clip?.frame?.[s.shape]);
	let frameOpen = $state(false);

	const still = $derived(s.stillOf(s.picture));
</script>

<aside class="grade-aside" aria-label="Grade controls" style:--hue={layer.hue}>
	<!-- what the grade is judged on: its 4K still (a frame of the original), its proxy, its original — one control,
	     each choice saying what it shows -->
	<div class="top">
		<span class="src" role="tablist" aria-label="What the grade is judged on">
			<i>Picture</i>
			<button role="tab" aria-selected={s.gradeOn === 'stills'} class:on={s.gradeOn === 'stills'} class:warn={!!still && !still.inside} onclick={() => (s.gradeOn = 'stills')} title={still ? `The grading still: a 4K frame of the original at ${still.t.toFixed(1)} s${still.inside ? '' : ' — outside this cut'}` : 'No grading still for this shot yet'}>Still{#if still}<small>{still.t.toFixed(1)} s{still.inside ? '' : ' ⚠'}</small>{/if}</button>
			<button role="tab" aria-selected={s.gradeOn === 'proxies'} class:on={s.gradeOn === 'proxies'} onclick={() => (s.gradeOn = 'proxies')} title="The HD proxy: plays light">Proxy</button>
			<button role="tab" aria-selected={s.gradeOn === 'originals'} class:on={s.gradeOn === 'originals'} onclick={() => (s.gradeOn = 'originals')} title="The original file: full quality, heavy">Original</button>
		</span>
	</div>

	<header>
		<h3><i class="dot"></i>{layer.label}</h3>
		<p>
			{#if ofShot(layer.id)}
				{clip ? `Shot ${shotNo} · ${clip.script?.description ?? s.clipName(clip)}` : 'Pick a shot on the timeline'}
			{:else if layer.id === 'scene'}
				{scene ?? (clip ? 'This shot has no scene in the script' : 'Pick a shot on the timeline')}
			{:else}
				{layer.what}
			{/if}
		</p>
	</header>

	<div class="controls">
		{#if needsShot && !clip}
			<p class="empty">Click a shot's {layer.label} bar on the timeline.</p>
		{:else if layer.id === 'scene' && !scene}
			<p class="empty">Pick a shot that belongs to a scene: its scene's look is set here, for every shot of the scene.</p>
		{:else}
			{#if layer.id === 'clip' && clip && !isWorld(clip)}
				<!-- the shot's place in the frame of the shape seen: a layer of its clip look (not a grade) -->
				<section class="framing" class:open={frameOpen}>
					<button class="fhead" onclick={() => (frameOpen = !frameOpen)} aria-expanded={frameOpen}>
						<span class="caret">{frameOpen ? '▾' : '▸'}</span>
						<b>Framing</b>
						<small>{s.shape}{framed ? ` · ${frame.zoom.toFixed(2)}×` : ''}</small>
					</button>
					{#if frameOpen}
						{#each FRAME as [k, lo, hi, d] (k)}
							<label class="sl" title="double-click: {d}">
								<span>{k}</span>
								<input {@attach fine()} type="range" min={lo} max={hi} step="0.01" value={frame[k]} oninput={(e) => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: Number(e.currentTarget.value) })} ondblclick={() => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: d })} />
								<output>{frame[k].toFixed(2)}</output>
							</label>
						{/each}
					{/if}
				</section>
			{/if}
			{#if stack?.tools.length}
				<label class="sl strength" title="How much of the whole stack — double-click: all of it">
					<span>strength</span>
					<input {@attach fine()} type="range" min="0" max="1" step="0.01" value={stack.strength ?? 1} oninput={(e) => putStrength(Number(e.currentTarget.value))} ondblclick={() => putStrength(1)} />
					<output>{Math.round((stack.strength ?? 1) * 100)} %</output>
				</label>
			{/if}
			<ToolStack tools={stack?.tools ?? []} onchange={putTools} />
		{/if}
	</div>
</aside>

<style>
	.grade-aside {
		grid-area: aside;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
	}

	.top {
		display: flex;
		justify-content: center;
		padding: 0.55rem 0.7rem;
		border-bottom: 1px solid var(--edge);
	}

	.src {
		display: inline-flex;
		padding: 1px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
	}

	.src button {
		padding: 0.1rem 0.6rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.7rem;
		color: var(--dim);
		cursor: pointer;
	}

	.src i {
		align-self: center;
		padding: 0 0.45rem 0 0.6rem;
		font-style: normal;
		font-size: 0.62rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.src button small {
		margin-left: 0.3rem;
		font-size: 0.6rem;
		color: var(--dim);
	}

	.src button.on small {
		color: var(--ink-soft);
	}

	.src button.warn small {
		color: var(--warn);
	}

	.src button.on {
		background: var(--sel);
		color: var(--ink);
	}

	header {
		padding: 0.7rem 0.9rem 0.3rem;
	}

	h3 {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		margin: 0;
		font-size: 0.95rem;
	}

	/* the stack's colour, as its bar on the timeline */
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
		background: var(--hue);
	}

	header p {
		margin: 0.15rem 0 0;
		overflow: hidden;
		font-size: 0.72rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.controls {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		overflow: auto;
		padding: 0.3rem 0.9rem 1.2rem;
	}

	.sl {
		display: grid;
		grid-template-columns: 6.2rem minmax(3rem, 1fr) 2.9rem;
		gap: 0.45rem;
		align-items: center;
		font-size: 0.74rem;
		color: var(--ink-soft);
	}

	.sl input {
		width: 100%;
		accent-color: var(--accent);
	}

	.sl output {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		text-align: right;
		color: var(--ink);
	}

	/* the framing: the clip look's first layer, folded like a tool */
	.framing {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--raised);
	}

	.framing.open {
		padding-bottom: 0.6rem;
	}

	.fhead {
		display: flex;
		gap: 0.45rem;
		align-items: baseline;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.76rem;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.fhead small {
		font-size: 0.68rem;
		color: var(--dim);
	}

	.caret {
		font-size: 0.6rem;
		color: var(--dim);
	}

	.strength {
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--edge);
	}

	.empty {
		margin: 0.4rem 0;
		font-size: 0.76rem;
		color: var(--dim);
	}
</style>
