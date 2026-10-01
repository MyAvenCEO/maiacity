<!--
	A sound clip's EQ in the inspector: its bands (game/film/sound.js), each changed by hand with a fine drag, and the
	curve they make — drawn from the Mac's own maths (`eq_response`: the render's biquads, the studio's playback makes
	the same) — over the clip's spectrum as the Audio tab measured it (octave bands where it speaks, through its EQ).
	The MCP sets the same bands (audio_eq, audio_match); this shows them and lets a hand move them.
-->
<script>
	import { EQ_TYPES, MAX_BANDS, bandLabel, cleanEq } from '../../../game/film/sound.js';
	import { fine } from './fine.js';

	/** @typedef {import('$lib/auth/client').EqBand} EqBand */
	/** @type {{ s: import('./studio.svelte.js').Studio, clip: import('$lib/auth/client').TimelineClip, ro?: boolean }} */
	let { s, clip, ro = false } = $props();

	const bands = $derived(cleanEq(clip.eq));
	/** @type {[number, number][]} */
	let curve = $state([]);
	$effect(() => {
		const eq = $state.snapshot(bands);
		let live = true;
		void import('$lib/native')
			.then(({ command }) => command('eq_response', { eq, n: 160 }))
			.then((r) => live && (curve = /** @type {any} */ (r).curve))
			.catch(() => live && (curve = []));
		return () => void (live = false);
	});
	const measured = $derived(s.loud?.clips?.find((/** @type {any} */ m) => m.clip === clip.id));
	/** @type {[number, number][]} */
	const spectrum = $derived(measured?.spectrum ?? []);

	// the drawing: 20 Hz – 20 kHz on the octaves, ±18 dB
	const W = 280, H = 110, DB = 18;
	const x = (/** @type {number} */ f) => (Math.log10(f / 20) / 3) * W;
	const y = (/** @type {number} */ db) => H / 2 - (Math.max(-DB, Math.min(DB, db)) / DB) * (H / 2);
	const path = $derived(curve.map(([f, db], i) => `${i ? 'L' : 'M'}${x(f).toFixed(1)},${y(db).toFixed(1)}`).join(' '));
	const HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

	/** @param {EqBand[]} next */
	const save = (next) => s.setClip({ eq: cleanEq(next) }, clip.id);
	/** @param {number} i @param {Partial<EqBand>} patch */
	const set = (i, patch) => save(bands.map((b, k) => (k === i ? { ...b, ...patch } : b)));
	const add = () => save([...bands, { type: 'peaking', f: 2500, gain: 2, q: 1 }]);
	/** @param {number} i */
	const drop = (i) => save(bands.filter((_, k) => k !== i));
	const logF = (/** @type {number} */ f) => Math.log10(f);
	const hz = (/** @type {number} */ f) => (f >= 1000 ? `${Math.round(f / 100) / 10} kHz` : `${Math.round(f)} Hz`);
	/** @param {EqBand['type']} t */
	const hasGain = (t) => t === 'peaking' || t === 'lowshelf' || t === 'highshelf';
</script>

<div class="eq">
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="EQ curve{bands.length ? `: ${bands.map(bandLabel).join(', ')}` : ': flat'}">
		{#each HZ as f (f)}<line class="grid" x1={x(f)} x2={x(f)} y1="0" y2={H} />{/each}
		{#each [-12, -6, 0, 6, 12] as d (d)}<line class="grid" class:zero={d === 0} x1="0" x2={W} y1={y(d)} y2={y(d)} />{/each}
		{#each spectrum as [f, v] (f)}
			<!-- each octave's share of the energy, from the top down: louder is taller -->
			<rect class="spec" x={x(f / Math.SQRT2)} width={x(f * Math.SQRT2) - x(f / Math.SQRT2) - 1} y={H - Math.max(0, (v + 36) / 36) * H} height={Math.max(0, (v + 36) / 36) * H} />
		{/each}
		{#if path}<path class="curve" d={path} />{/if}
		{#each bands as b, i (i)}<circle class="dot" cx={x(b.f)} cy={y(hasGain(b.type) ? b.gain : 0)} r="3" />{/each}
	</svg>
	<p class="axis"><span>20 Hz</span><span>200</span><span>2k</span><span>20 kHz</span></p>
	{#if !measured}<p class="sub">The spectrum shows once the sound is measured. <button class="ghost small" onclick={() => s.measureSound()} disabled={s.loudMeasuring}>{s.loudMeasuring ? 'Measuring…' : 'Measure'}</button></p>{/if}
	<fieldset disabled={ro}>
		{#each bands as b, i (i)}
			<div class="band">
				<select value={b.type} onchange={(e) => set(i, { type: /** @type {EqBand['type']} */ (e.currentTarget.value) })} aria-label="Band {i + 1} kind">
					{#each EQ_TYPES as t (t)}<option value={t}>{t}</option>{/each}
				</select>
				<label title="Frequency: {hz(b.f)}">
					<input type="range" min={logF(20)} max={logF(20000)} step="0.001" value={logF(b.f)} {@attach fine()} onchange={(e) => set(i, { f: Math.round(10 ** Number(e.currentTarget.value)) })} />
					<span>{hz(b.f)}</span>
				</label>
				{#if hasGain(b.type)}
					<label title="Gain">
						<input type="range" min="-12" max="12" step="0.1" value={b.gain} {@attach fine()} onchange={(e) => set(i, { gain: Number(e.currentTarget.value) })} />
						<span>{b.gain > 0 ? '+' : ''}{b.gain.toFixed(1)} dB</span>
					</label>
				{/if}
				{#if b.type !== 'lowshelf' && b.type !== 'highshelf'}
					<label title="Q: wide (low) to narrow (high)">
						<input type="range" min="0.3" max="8" step="0.01" value={b.q} {@attach fine()} onchange={(e) => set(i, { q: Number(e.currentTarget.value) })} />
						<span>Q {b.q.toFixed(2)}</span>
					</label>
				{/if}
				<button class="ghost small x" onclick={() => drop(i)} aria-label="Remove band {i + 1}">×</button>
			</div>
		{/each}
		<div class="row">
			{#if bands.length < MAX_BANDS}<button class="ghost small" onclick={add}>Add a band</button>{/if}
			{#if bands.length}<button class="ghost small" onclick={() => save([])}>Flat</button>{/if}
		</div>
	</fieldset>
</div>

<style>
	.eq {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	svg {
		width: 100%;
		height: 7rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--panel-2, rgba(0, 0, 0, 0.25));
	}

	.grid {
		stroke: var(--edge);
		stroke-width: 0.5;
		vector-effect: non-scaling-stroke;
	}

	.grid.zero {
		stroke: var(--ink-soft);
	}

	.spec {
		fill: var(--ink-soft);
		opacity: 0.18;
	}

	.curve {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.6;
		vector-effect: non-scaling-stroke;
	}

	.dot {
		fill: var(--accent);
	}

	.axis {
		display: flex;
		justify-content: space-between;
		margin: -0.2rem 0 0;
		font-size: 0.6rem;
		color: var(--ink-soft);
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.band {
		display: grid;
		grid-template-columns: 5.4rem 1fr auto;
		gap: 0.2rem 0.4rem;
		align-items: center;
		padding: 0.3rem 0.35rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
	}

	.band select {
		grid-row: span 3;
		align-self: start;
		width: 100%;
	}

	.band label {
		display: grid;
		grid-template-columns: 1fr 4.2rem;
		gap: 0.3rem;
		align-items: center;
		grid-column: 2;
		font-size: 0.68rem;
	}

	.band label span {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		text-align: right;
		color: var(--ink-soft);
	}

	.band .x {
		grid-column: 3;
		grid-row: 1;
	}

	.row {
		display: flex;
		gap: 0.4rem;
	}

	.sub {
		margin: 0;
		font-size: 0.7rem;
		color: var(--ink-soft);
	}
</style>
