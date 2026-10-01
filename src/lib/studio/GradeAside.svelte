<!--
	The Grade tab's aside, the full height beside the picture: the stack chosen on the timeline (a click on its lane) —
	the selected shot's base correction or clip look, its scene's look, the timeline's look, the finishing — as its tools
	(ToolStack: every tool from the one registry, masks as groups of their own tools), its strength, a tool added from
	the menu; or the shot's framing. The lanes' names above switch it.
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
</script>

<aside class="grade-aside" aria-label="Grade controls">
	<nav class="layers" aria-label="Stacks">
		{#each [...LAYERS].reverse() as l (l.id)}
			<button class:on={s.gradeLayer === l.id} onclick={() => (s.gradeLayer = l.id)}>{l.label}</button>
		{/each}
	</nav>

	<header>
		<h3>{layer.label}</h3>
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
			<p class="empty">Click a shot's cell on the {layer.label.toLowerCase()} lane.</p>
		{:else if layer.id === 'scene' && !scene}
			<p class="empty">Pick a shot that belongs to a scene: its scene's look is set here, for every shot of the scene.</p>
		{:else if layer.id === 'frame'}
			{#if clip && isWorld(clip)}
				<p class="empty">A world shot is framed in its own camera.</p>
			{:else if clip}
				<h4>In {s.shape}</h4>
				{#each FRAME as [k, lo, hi, d] (k)}
					<label class="sl" title="double-click: {d}">
						<span>{k}</span>
						<input {@attach fine()} type="range" min={lo} max={hi} step="0.01" value={frame[k]} oninput={(e) => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: Number(e.currentTarget.value) })} ondblclick={() => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: d })} />
						<output>{frame[k].toFixed(2)}</output>
					</label>
				{/each}
			{/if}
		{:else}
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

	.layers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.6rem 0.7rem;
		border-bottom: 1px solid var(--edge);
	}

	.layers button {
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.layers button.on {
		border-color: var(--accent);
		background: var(--chosen);
		color: var(--ink);
	}

	header {
		padding: 0.7rem 0.9rem 0.3rem;
	}

	h3 {
		margin: 0;
		font-size: 0.95rem;
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

	h4 {
		margin: 0.35rem 0 0.1rem;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--dim);
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
