<!--
	The grade (Grade tab) as a stack of layers, read from the bottom up: the bottom is applied first, the top last.
	At the bottom, the shot's input transform into ACEScct (its CST); over it the balance layers that level the shots
	of a scene to each other (white balance, exposure, contrast, highlights, lows); over those the creative grade (an
	ASC CDL, for the look); then the whole film's look; at the top the output transform (ACES 2.0 → Rec.709). The
	balance is set by hand here or by an agent through MCP (grade_measure, grade_match, grade_balance) — the same
	data on the clip. Everything is data on the timeline, saved like every other edit; nothing is baked. A media clip's
	framing per shape is here too.
-->
<script>
	import { BALANCE_NODES, NEUTRAL, NEUTRAL_BALANCE, PRESETS, isNeutral, isNeutralBalance, neutral, presetOf, profileInfo } from './color.js';
	import { SHAPES, isWorld } from './studio.svelte.js';

	/** @typedef {import('$lib/auth/client').Cdl} Cdl */
	/** @typedef {import('$lib/auth/client').Balance} Balance */
	/** @typedef {import('$lib/auth/client').ClipFrame} ClipFrame */
	/** @typedef {'slope' | 'offset' | 'power'} Part */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const clip = $derived(s.sel && s.sel.track === 'V1' ? s.sel : null);
	/** the layer open for its controls: a balance layer's id, 'creative' or 'look' */
	let open = $state(/** @type {string | null} */ ('exposure'));
	$effect(() => {
		if (!clip && open !== 'look') open = 'look';
	});
	const film = $derived(open === 'look' || !clip);
	// the studio's setGrade writes the film's look or the clip's grade by this
	$effect(() => {
		s.gradeTarget = film ? 'film' : 'clip';
	});
	/** @type {Cdl} */
	const g = $derived((film ? s.current?.grade?.look : clip?.grade) ?? NEUTRAL);
	/** @type {Balance} */
	const bal = $derived(clip?.balance ?? NEUTRAL_BALANCE);
	const suggestion = $derived(clip && isWorld(clip) ? s.specOf(clip)?.look : undefined);
	const profile = $derived(clip ? s.profileOfClip(clip) : '');

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
		setCdl(next);
	}
	/** @param {Cdl} next */
	const setCdl = (next) => (film ? s.setMeta({ grade: { look: isNeutral(next) ? null : next } }) : s.setGrade(next));
	/** @param {number} v */
	const setSat = (v) => setCdl({ ...copy(), sat: v });
	/** @param {Part} k */
	const resetRow = (k) => setCdl({ ...copy(), [k]: [...NEUTRAL[k]] });
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

	/** @param {string} key @param {number} v */
	const setBal = (key, v) => s.setBalance({ ...$state.snapshot(bal), [key]: v });
	/** @param {(typeof BALANCE_NODES)[number]} n */
	const resetLayer = (n) => s.setBalance({ ...$state.snapshot(bal), ...Object.fromEntries(n.fields.map((f) => [f.key, 0])) });
	/** @param {(typeof BALANCE_NODES)[number]} n */
	const layerOn = (n) => n.fields.some((f) => bal[f.key] !== 0);
	/** @param {number} v @param {string} unit */
	const amount = (v, unit) => (v === 0 ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}${unit.startsWith('stops') ? ' st' : ''}`);
	/** the balance layers from the top down (the last applied first on screen) */
	const balanceTopDown = [...BALANCE_NODES].reverse();

	// framing, per shape (media clips)
	/** @type {ClipFrame} */
	const frame = $derived((clip && !isWorld(clip) ? clip.frame?.[s.shape] : undefined) ?? { x: 0, y: 0, zoom: 1 });
	/** @param {Partial<ClipFrame>} patch */
	const setFrame = (patch) => clip && s.setFrame(clip.id, s.shape, { ...frame, ...patch });
</script>

{#snippet cdlControls()}
	<div class="presets">
		{#each Object.entries(PRESETS) as [name, p] (name)}
			<button class="chip" class:on={presetOf(g) === name} title={p.label} onclick={() => preset(name)}>{name}</button>
		{/each}
	</div>
	{#if !film && suggestion && PRESETS[suggestion]}
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
	<button class="ghost small" onclick={() => (film ? s.setMeta({ grade: null }) : s.setGrade(neutral()))} disabled={isNeutral(g)}>Reset the {film ? 'look' : 'grade'}</button>
{/snippet}

<aside class="grade">
	<h2>Grade · layers</h2>
	<p class="hint">{clip ? s.clipName(clip) : 'Select a picture clip for its layers; the film look applies to every shot.'}</p>

	<ol class="stack" aria-label="Layers, the top applied last">
		<li class="layer fixed" title="The output transform, applied last">
			<span class="dot"></span><span class="nm">Output</span><span class="val">ACES 2.0 → Rec.709</span>
		</li>

		<li class="layer" class:open={open === 'look'} class:on={!!s.current?.grade?.look || !!s.current?.grade?.preset}>
			<button class="head" onclick={() => (open = open === 'look' ? null : 'look')}>
				<span class="dot"></span><span class="nm">Film look</span><span class="val">{s.current?.grade?.preset ?? (s.current?.grade?.look ? 'own' : '—')}</span>
			</button>
			{#if open === 'look'}<div class="body">{@render cdlControls()}</div>{/if}
		</li>

		{#if clip}
			<li class="sect">Creative</li>
			<li class="layer" class:open={open === 'creative'} class:on={!!clip.grade && !isNeutral(clip.grade)}>
				<button class="head" onclick={() => (open = open === 'creative' ? null : 'creative')}>
					<span class="dot"></span><span class="nm">Grade</span><span class="val">{presetOf(clip.grade) && presetOf(clip.grade) !== 'neutral' ? presetOf(clip.grade) : clip.grade ? 'CDL' : '—'}</span>
				</button>
				{#if open === 'creative'}<div class="body">{@render cdlControls()}</div>{/if}
			</li>

			<li class="sect">Balance · the shots to each other <button class="link" onclick={() => s.setBalance(null)} disabled={isNeutralBalance(bal)}>reset all</button></li>
			{#each balanceTopDown as n (n.id)}
				<li class="layer" class:open={open === n.id} class:on={layerOn(n)}>
					<button class="head" onclick={() => (open = open === n.id ? null : n.id)}>
						<span class="dot"></span><span class="nm">{n.label}</span><span class="val">{n.fields.map((f) => amount(bal[f.key], f.unit)).join(' · ')}</span>
					</button>
					{#if open === n.id}
						<div class="body">
							{#each n.fields as f (f.key)}
								<label class="b">
									<span>{f.label}</span>
									<input type="range" min={f.min} max={f.max} step={f.step} value={bal[f.key]} oninput={(e) => setBal(f.key, Number(e.currentTarget.value))} ondblclick={() => setBal(f.key, 0)} />
									<output>{bal[f.key].toFixed(2)}</output>
								</label>
							{/each}
							<button class="link" onclick={() => resetLayer(n)} disabled={!layerOn(n)}>reset</button>
						</div>
					{/if}
				</li>
			{/each}

			<li class="layer fixed" title="The input transform (CST) into ACEScct, applied first">
				<span class="dot"></span><span class="nm">Input</span><span class="val">{profile ? profileInfo(profile).label : '—'} → ACEScct</span>
			</li>
		{/if}
	</ol>

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
	.stack {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
	}

	.sect {
		display: flex;
		justify-content: space-between;
		margin: 0.5rem 0 0.1rem;
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.layer {
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.layer.fixed {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.55rem;
		background: var(--bg);
		font-size: 0.74rem;
		color: var(--dim);
	}

	.layer.open {
		border-color: var(--ink);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.35rem 0.55rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.76rem;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.dot {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--edge);
	}

	.layer.on .dot {
		background: var(--accent);
	}

	.nm {
		font-weight: 600;
	}

	.val {
		margin-left: auto;
		overflow: hidden;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.66rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	.body {
		padding: 0.2rem 0.55rem 0.5rem;
	}

	label.b {
		grid-template-columns: 5.2rem 1fr 3rem;
	}


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



	.hint {
		margin: 0 0 0.5rem;
		font-size: 0.72rem;
		color: var(--dim);
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
