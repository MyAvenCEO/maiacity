<!--
	The grade (Grade tab): the whole film's look, or the selected clip's own grade — each an ASC CDL in ACEScct (slope,
	offset, power per channel, and saturation), applied clip grade → film look → output transform, as the render does.
	Presets are today's looks; a world shot suggests the one it was lit for. A media clip's framing per shape is here
	too. Everything is data on the timeline, saved like every other edit; nothing is baked.
-->
<script>
	import { NEUTRAL, PRESETS, isNeutral, neutral, presetOf } from './color.js';
	import { SHAPES, isWorld } from './studio.svelte.js';

	/** @typedef {import('$lib/auth/client').Cdl} Cdl */
	/** @typedef {import('$lib/auth/client').ClipFrame} ClipFrame */
	/** @typedef {'slope' | 'offset' | 'power'} Part */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const clip = $derived(s.sel && s.sel.track === 'V1' ? s.sel : null);
	const film = $derived(s.gradeTarget === 'film' || !clip);
	/** @type {Cdl} */
	const g = $derived((film ? s.current?.grade?.look : clip?.grade) ?? NEUTRAL);
	const suggestion = $derived(clip && isWorld(clip) ? s.specOf(clip)?.look : undefined);
	const ro = $derived(!s.locked);

	/** @type {{ k: Part, label: string, min: number, max: number, step: number, id: number }[]} */
	const ROWS = [
		{ k: 'slope', label: 'Slope · gain', min: 0, max: 2, step: 0.005, id: 1 },
		{ k: 'offset', label: 'Offset · lift', min: -0.2, max: 0.2, step: 0.001, id: 0 },
		{ k: 'power', label: 'Power · gamma', min: 0.4, max: 2.5, step: 0.005, id: 1 }
	];
	const CH = ['R', 'G', 'B'];
	/** A copy of the grade on screen, to change. @returns {Cdl} */
	const copy = () => structuredClone($state.snapshot(g));

	/** @param {Part} k @param {number | 'all'} i @param {number} v */
	function set(k, i, v) {
		const next = copy();
		if (i === 'all') {
			// the master moves the three together, keeping their differences
			const mean = (next[k][0] + next[k][1] + next[k][2]) / 3;
			for (let c = 0; c < 3; c++) next[k][c] = +(next[k][c] + (v - mean)).toFixed(4);
		} else next[k][i] = v;
		s.setGrade(next);
	}
	/** @param {number} v */
	const setSat = (v) => s.setGrade({ ...copy(), sat: v });
	/** @param {Part} k */
	const resetRow = (k) => s.setGrade({ ...copy(), [k]: [...NEUTRAL[k]] });
	/** @param {string} name */
	function preset(name) {
		const p = PRESETS[name];
		if (!p) return;
		/** @type {Cdl} */
		const cdl = structuredClone(p.cdl);
		if (film) s.setMeta({ grade: { look: isNeutral(cdl) ? null : cdl, ...(name === 'neutral' ? {} : { preset: name }) } });
		else s.setGrade(cdl);
	}
	/** @param {readonly number[]} v */
	const mean = (v) => (v[0] + v[1] + v[2]) / 3;
	/** @param {number} v */
	const shown = (v) => v.toFixed(3);

	// framing, per shape (media clips)
	/** @type {ClipFrame} */
	const frame = $derived((clip && !isWorld(clip) ? clip.frame?.[s.shape] : undefined) ?? { x: 0, y: 0, zoom: 1 });
	/** @param {Partial<ClipFrame>} patch */
	const setFrame = (patch) => clip && s.setFrame(clip.id, s.shape, { ...frame, ...patch });
</script>

<aside class="grade">
	<h2>Grade</h2>
	{#if ro}<p class="hint">Lock the edit to grade. (The grade shows here as a preview in Edit.)</p>{/if}
	<div class="target" role="tablist">
		<button role="tab" aria-selected={!film} class:on={!film} disabled={!clip} onclick={() => (s.gradeTarget = 'clip')} title={clip ? '' : 'Select a picture clip on V1'}>This clip</button>
		<button role="tab" aria-selected={film} class:on={film} onclick={() => (s.gradeTarget = 'film')}>Film look</button>
	</div>
	<p class="what">
		{#if film}The whole film's look{#if s.current?.grade?.preset} · <b>{s.current.grade.preset}</b>{/if}{:else}{clip ? s.clipName(clip) : ''}{#if presetOf(clip?.grade) && presetOf(clip?.grade) !== 'neutral'} · <b>{presetOf(clip?.grade)}</b>{/if}{/if}
		{#if !isNeutral(g)}<span class="on">graded</span>{/if}
	</p>

	<fieldset disabled={ro}>
		<div class="presets">
			{#each Object.entries(PRESETS) as [name, p] (name)}
				<button class="chip" class:on={presetOf(g) === name} title={p.label} onclick={() => preset(name)}>{name}</button>
			{/each}
		</div>
		{#if suggestion && PRESETS[suggestion]}
			<p class="sugg">Lit for <b>{suggestion}</b> <button class="link" onclick={() => preset(suggestion)}>apply to this clip</button></p>
		{/if}

		{#each ROWS as r (r.k)}
			<div class="grp">
				<div class="gh">
					<span>{r.label}</span>
					<button class="link" onclick={() => resetRow(r.k)}>reset</button>
				</div>
				<label class="m">
					<span>all</span>
					<input type="range" min={r.min} max={r.max} step={r.step} value={mean(g[r.k])} oninput={(e) => set(r.k, 'all', Number(e.currentTarget.value))} ondblclick={() => resetRow(r.k)} />
					<output>{shown(mean(g[r.k]))}</output>
				</label>
				{#each CH as c, i (c)}
					<label class="ch {c}">
						<span>{c}</span>
						<input type="range" min={r.min} max={r.max} step={r.step} value={g[r.k][i]} oninput={(e) => set(r.k, i, Number(e.currentTarget.value))} ondblclick={() => set(r.k, i, r.id)} />
						<output>{shown(g[r.k][i])}</output>
					</label>
				{/each}
			</div>
		{/each}
		<div class="grp">
			<label class="m">
				<span>Sat</span>
				<input type="range" min="0" max="2" step="0.01" value={g.sat} oninput={(e) => setSat(Number(e.currentTarget.value))} ondblclick={() => setSat(1)} />
				<output>{g.sat.toFixed(2)}</output>
			</label>
		</div>
		<button class="ghost small" onclick={() => (film ? s.setMeta({ grade: null }) : s.setGrade(neutral()))} disabled={isNeutral(g)}>Reset the {film ? 'look' : 'clip'}</button>
	</fieldset>

	{#if clip && !isWorld(clip)}
		<h3>Framing · {s.shape}</h3>
		<div class="shapes">
			{#each SHAPES as sh (sh)}<button class="chip" class:on={s.shape === sh} class:set={!!clip.frame?.[sh]} onclick={() => (s.shape = sh)}>{sh}</button>{/each}
		</div>
		<label class="m"><span>x</span><input type="range" min="-1" max="1" step="0.01" value={frame.x} oninput={(e) => setFrame({ x: Number(e.currentTarget.value) })} /><output>{frame.x.toFixed(2)}</output></label>
		<label class="m"><span>y</span><input type="range" min="-1" max="1" step="0.01" value={frame.y} oninput={(e) => setFrame({ y: Number(e.currentTarget.value) })} /><output>{frame.y.toFixed(2)}</output></label>
		<label class="m"><span>zoom</span><input type="range" min="1" max="3" step="0.01" value={frame.zoom} oninput={(e) => setFrame({ zoom: Number(e.currentTarget.value) })} /><output>{frame.zoom.toFixed(2)}</output></label>
		<button class="ghost small" onclick={() => clip && s.setFrame(clip.id, s.shape, null)} disabled={!clip.frame?.[s.shape]}>Centre it</button>
	{:else if clip}
		<p class="hint">A world clip is framed for each shape in its shot record (a native camera per shape), not cropped.</p>
	{/if}
</aside>

<style>
	.grade {
		grid-area: inspector;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	h2,
	h3 {
		margin: 0 0 0.5rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	h3 {
		margin-top: 1rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--edge);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	fieldset:disabled {
		opacity: 0.55;
	}

	.hint {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.target {
		display: flex;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
	}

	.target button {
		flex: 1;
		padding: 0.25rem 0.5rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.74rem;
		color: var(--dim);
		cursor: pointer;
	}

	.target button.on {
		background: var(--ink);
		color: #fff;
	}

	.what {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		margin: 0.5rem 0;
		font-size: 0.78rem;
		font-weight: 600;
	}

	.what b {
		font-weight: 600;
		color: var(--accent);
	}

	.what .on {
		margin-left: auto;
		padding: 0 0.35rem;
		border-radius: 4px;
		background: #f3e3c1;
		font-size: 0.62rem;
		color: #a8741a;
	}

	.presets,
	.shapes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.4rem;
	}

	.chip {
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.7rem;
		color: var(--ink);
		cursor: pointer;
	}

	.chip.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.chip.set:not(.on) {
		border-color: var(--accent);
	}

	.sugg {
		margin: 0.2rem 0 0.5rem;
		font-size: 0.72rem;
		color: #4a5f93;
	}

	.grp {
		margin: 0.45rem 0;
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.gh {
		display: flex;
		justify-content: space-between;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--dim);
	}

	label {
		display: grid;
		grid-template-columns: 2.2rem 1fr 3rem;
		gap: 0.35rem;
		align-items: center;
		font-size: 0.7rem;
		color: var(--dim);
	}

	label input {
		width: 100%;
		accent-color: var(--ink);
	}

	.ch.R input {
		accent-color: #c0392b;
	}

	.ch.G input {
		accent-color: #2f7d4f;
	}

	.ch.B input {
		accent-color: #3355aa;
	}

	output {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.66rem;
		text-align: right;
		color: var(--ink);
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.68rem;
		color: var(--accent);
		cursor: pointer;
	}
</style>
