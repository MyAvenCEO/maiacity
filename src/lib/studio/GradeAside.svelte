<!--
	The Grade tab's aside, the full height beside the picture: the controls of the layer chosen on the timeline (a click
	on its lane) — the selected shot's base correction, secondaries, clip look or framing, its scene's look, or the whole
	timeline's look and finishing. The layers above it switch it; each control's double-click puts it back.
-->
<script>
	import { BALANCE_NODES, NEUTRAL, NEUTRAL_BALANCE, cleanBalance, isNeutral } from './color.js';
	import { fine } from './fine.js';
	import { isWorld } from './studio.svelte.js';
	import {
		FINISH_SLIDERS,
		LAYERS,
		LOOK_SLIDERS,
		NEW_KEY,
		NEW_WINDOW,
		lookValue,
		secGroups,
		secText,
		sceneLook,
		setFinish,
		setLook,
		setSecondaries,
		timelineLook,
		withValue
	} from './grade.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const pics = $derived(s.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start));
	const clip = $derived(s.sel?.track === 'V1' ? s.sel : null);
	const shotNo = $derived(clip ? pics.findIndex((c) => c.id === clip.id) + 1 : 0);
	const scene = $derived(clip?.script?.scene || null);
	const layer = $derived(LAYERS.find((l) => l.id === s.gradeLayer) ?? LAYERS[LAYERS.length - 1]);
	const needsShot = $derived(['clip', 'sec', 'base', 'frame'].includes(layer.id));

	/** groups of slider rows @template T @param {readonly T[]} list @param {(x: T) => string} by */
	const grouped = (list, by) => {
		/** @type {{ group: string, items: T[] }[]} */
		const out = [];
		for (const x of list) {
			const g = by(x);
			const last = out[out.length - 1];
			if (last && last.group === g) last.items.push(x);
			else out.push({ group: g, items: [x] });
		}
		return out;
	};
	const look = $derived(layer.id === 'timeline' ? timelineLook(s) : layer.id === 'scene' && scene ? sceneLook(s, scene) : null);
	/** @param {import('$lib/auth/client').Look | null} l */
	const putLook = (l) => setLook(s, layer.id === 'timeline' ? null : scene, l);
	const finish = $derived(/** @type {any} */ (s.current?.grade?.finish ?? null));
	/** a finishing value set: the part made with its defaults when it was off @param {string} part @param {string} k @param {number} v */
	const putFinish = (part, k, v) => {
		const defaults = Object.fromEntries(FINISH_SLIDERS.filter((x) => x[0] === part).map((x) => [x[1], x[6]]));
		const cur = finish?.[part] ?? defaults;
		const next = { ...defaults, ...cur, [k]: v };
		// a part's other control moved while it was off: it comes on a little, so the change shows
		if (k !== 'amount' && !cur.amount) next.amount = part === 'pop' ? 0.2 : 0.25;
		setFinish(s, { ...(finish ?? {}), [part]: next });
	};
	const cdl = $derived(clip?.grade ?? NEUTRAL);
	/** @param {'slope' | 'offset' | 'power'} key @param {number} v */
	const putCdl = (key, v) => {
		if (!clip) return;
		const cur = JSON.parse(JSON.stringify(cdl));
		const mean = (cur[key][0] + cur[key][1] + cur[key][2]) / 3;
		for (let i = 0; i < 3; i++) cur[key][i] = +(cur[key][i] + v - mean).toFixed(4);
		s.patchClip(clip.id, { grade: isNeutral(cur) ? undefined : cur });
	};
	const CDL = /** @type {const} */ ([
		['slope', 'gain', 0, 2, 1],
		['offset', 'lift', -0.2, 0.2, 0],
		['power', 'gamma', 0.4, 2.5, 1]
	]);
	const bal = $derived(clip?.balance ?? NEUTRAL_BALANCE);
	/** @param {string} key @param {number} v */
	const putBal = (key, v) => clip && s.patchClip(clip.id, { balance: cleanBalance({ ...bal, [key]: v }) ?? undefined });
	const secs = $derived(/** @type {any[]} */ (clip?.secondaries ?? []));
	/** @param {number} i @param {(x: any) => any} f */
	const putSec = (i, f) => clip && setSecondaries(s, clip, secs.map((x, j) => (j === i ? f(x) : x)));
	const frame = $derived(clip?.frame?.[s.shape] ?? { x: 0, y: 0, zoom: 1 });
	/** @type {['x' | 'y' | 'zoom', number, number, number][]} */
	const FRAME = [['x', -1, 1, 0], ['y', -1, 1, 0], ['zoom', 1, 3, 1]];
	/** @param {number} v @param {number} step */
	const show = (v, step) => v.toFixed(step < 1 ? 2 : 0);
</script>

<aside class="grade-aside" aria-label="Grade controls">
	<nav class="layers" aria-label="Layers">
		{#each LAYERS as l (l.id)}
			<button class:on={s.gradeLayer === l.id} onclick={() => (s.gradeLayer = l.id)}>{l.label}</button>
		{/each}
	</nav>

	<header>
		<h3>{layer.label}</h3>
		<p>
			{#if needsShot}
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
		{:else if layer.id === 'base' && clip}
			{#each BALANCE_NODES as n (n.id)}
				<section>
					<h4>{n.label}</h4>
					{#each n.fields as f (f.key)}
						<label class="sl" title="{f.label} ({f.unit}) — double-click: as shot">
							<span>{f.label}</span>
							<input {@attach fine()} type="range" min={f.min} max={f.max} step={f.step} value={bal[f.key]} oninput={(e) => putBal(f.key, Number(e.currentTarget.value))} ondblclick={() => putBal(f.key, 0)} />
							<output>{bal[f.key].toFixed(2)}</output>
						</label>
					{/each}
				</section>
			{/each}
			{#if clip.balance}<button class="reset" onclick={() => clip && s.patchClip(clip.id, { balance: undefined })}>Back to as shot</button>{/if}
		{:else if layer.id === 'clip' && clip}
			<section>
				<h4>Primary (ASC CDL)</h4>
				{#each CDL as [k, label, lo, hi, d] (k)}
					{@const mean = (cdl[k][0] + cdl[k][1] + cdl[k][2]) / 3}
					<label class="sl" title="double-click: {d}">
						<span>{label}</span>
						<input {@attach fine()} type="range" min={lo} max={hi} step="0.005" value={mean} oninput={(e) => putCdl(k, Number(e.currentTarget.value))} ondblclick={() => putCdl(k, d)} />
						<output>{mean.toFixed(3)}</output>
					</label>
				{/each}
				<label class="sl" title="double-click: 1">
					<span>saturation</span>
					<input {@attach fine()} type="range" min="0" max="2" step="0.01" value={cdl.sat} oninput={(e) => clip && s.patchClip(clip.id, { grade: { ...JSON.parse(JSON.stringify(cdl)), sat: Number(e.currentTarget.value) } })} ondblclick={() => clip && s.patchClip(clip.id, { grade: isNeutral({ ...cdl, sat: 1 }) ? undefined : { ...JSON.parse(JSON.stringify(cdl)), sat: 1 } })} />
					<output>{cdl.sat.toFixed(2)}</output>
				</label>
			</section>
			{#if clip.grade}<button class="reset" onclick={() => clip && s.patchClip(clip.id, { grade: undefined })}>Take the clip look off</button>{/if}
		{:else if layer.id === 'sec' && clip}
			{#each secs as sec, i (i)}
				<section class="sec">
					<div class="sec-head">
						<b>{secText(sec)}</b>
						{#if sec.window}
							<button class="chip" onclick={() => putSec(i, (x) => ({ ...x, window: { ...x.window, shape: x.window?.shape === 'ellipse' ? 'rect' : 'ellipse' } }))}>{sec.window.shape}</button>
							<button class="chip" onclick={() => putSec(i, (x) => ({ ...x, window: { ...x.window, invert: !x.window?.invert } }))}>{sec.window.invert ? 'outside' : 'inside'}</button>
						{/if}
						<button class="chip off" onclick={() => clip && setSecondaries(s, clip, secs.filter((_, j) => j !== i))}>off</button>
					</div>
					{#each secGroups(sec) as g (g.group)}
						<h4>{g.group}</h4>
						{#each g.fields as f (f.id)}
							<label class="sl">
								<span>{f.label}</span>
								<input {@attach fine()} type="range" min={f.lo} max={f.hi} step={f.step} value={f.get(sec)} oninput={(e) => putSec(i, (x) => f.set(x, Number(e.currentTarget.value)))} />
								<output>{show(f.get(sec), f.step)}</output>
							</label>
						{/each}
					{/each}
				</section>
			{:else}
				<p class="empty">No secondaries on this shot.</p>
			{/each}
			{#if secs.length < 4}
				<div class="adds">
					<button onclick={() => clip && setSecondaries(s, clip, [...secs, NEW_KEY])} title="A colour range of the picture (a hue, how saturated, how bright), with its own balance">+ Colour key</button>
					<button onclick={() => clip && setSecondaries(s, clip, [...secs, NEW_WINDOW])} title="A part of the frame (an ellipse or a rectangle), with its own balance">+ Window</button>
				</div>
			{/if}
		{:else if layer.id === 'frame' && clip}
			{#if isWorld(clip)}
				<p class="empty">A world shot is framed in its own camera.</p>
			{:else}
				<section>
					<h4>In {s.shape}</h4>
					{#each FRAME as [k, lo, hi, d] (k)}
						<label class="sl" title="double-click: {d}">
							<span>{k}</span>
							<input {@attach fine()} type="range" min={lo} max={hi} step="0.01" value={frame[k]} oninput={(e) => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: Number(e.currentTarget.value) })} ondblclick={() => clip && s.setFrame(clip.id, s.shape, { ...frame, [k]: d })} />
							<output>{frame[k].toFixed(2)}</output>
						</label>
					{/each}
				</section>
			{/if}
		{:else if layer.id === 'scene' && !scene}
			<p class="empty">Pick a shot that belongs to a scene: its scene's look is set here, for every shot of the scene.</p>
		{:else if layer.id === 'timeline' || layer.id === 'scene'}
			{#each grouped(LOOK_SLIDERS, (x) => x[5]) as g (g.group)}
				<section>
					<h4>{g.group}</h4>
					{#each g.items as [k, label, lo, hi, step] (k)}
						<label class="sl">
							<span>{label}</span>
							<input {@attach fine()} type="range" min={lo} max={hi} {step} value={lookValue(look, k)} oninput={(e) => putLook(withValue(look, k, Number(e.currentTarget.value)))} />
							<output>{show(lookValue(look, k), step)}</output>
						</label>
					{/each}
				</section>
			{/each}
			{#if look?.hue?.length || look?.hue_sat?.length}<p class="note">Its hue curves ({look.hue?.length ?? 0} and {look.hue_sat?.length ?? 0} points) are set by the agent (MCP grade_look).</p>{/if}
			{#if look}<button class="reset" onclick={() => putLook(null)}>Take the {layer.label.toLowerCase()} off</button>{/if}
		{:else if layer.id === 'finish'}
			{#each grouped(FINISH_SLIDERS, (x) => x[7]) as g (g.group)}
				<section>
					<h4>{g.group}</h4>
					{#each g.items as [part, k, label, lo, hi, step, d] (part + k)}
						{@const v = finish?.[part]?.[k] ?? d}
						<label class="sl">
							<span>{label}</span>
							<input {@attach fine()} type="range" min={lo} max={hi} {step} value={v} oninput={(e) => putFinish(part, k, Number(e.currentTarget.value))} />
							<output>{show(v, step)}</output>
						</label>
					{/each}
				</section>
			{/each}
			{#if finish}<button class="reset" onclick={() => setFinish(s, null)}>Take the finishing off</button>{/if}
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

	.layers button,
	.chip,
	.adds button,
	.reset {
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
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.3rem 0.9rem 1.2rem;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin-bottom: 0.7rem;
	}

	section.sec {
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
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
		grid-template-columns: 6.5rem minmax(3rem, 1fr) 2.8rem;
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

	.sec-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.sec-head b {
		flex: 1;
	}

	.chip.off {
		color: var(--dim);
	}

	.adds {
		display: flex;
		gap: 0.4rem;
	}

	.reset {
		margin-top: 0.3rem;
		color: var(--dim);
	}

	.empty,
	.note {
		margin: 0.4rem 0;
		font-size: 0.76rem;
		color: var(--dim);
	}
</style>
