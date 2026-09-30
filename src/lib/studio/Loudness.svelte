<!--
	The loudness of the film over time (Audio tab): every sound clip's curve at its gain (every 0.5 s, BS.1770), in
	its track's colour, against the level each track is aimed at; the playhead. What the mixer's numbers mean, seen.
-->
<script>
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const W = 1000, H = 180, TOP = -6, BOTTOM = -54;
	const COLOUR = /** @type {Record<string, string>} */ ({ A1: '#d99a2b', A2: '#4a5f93', A3: '#6f9a57' });
	const AIM = /** @type {Record<string, number>} */ ({ A1: -18, A2: -26, A3: -30 });
	const end = $derived(Math.max(1, s.end));
	/** @param {number} t */
	const x = (t) => (t / end) * W;
	/** @param {number} l */
	const y = (l) => ((TOP - Math.max(BOTTOM, Math.min(TOP, l))) / (TOP - BOTTOM)) * H;
	/** each clip's curve as an SVG path, in film time and at its gain */
	const curves = $derived(
		(s.loud?.clips ?? [])
			.filter((/** @type {any} */ c) => Array.isArray(c.curve))
			.map((/** @type {any} */ c) => {
				let d = '';
				let pen = false;
				c.curve.forEach((/** @type {number | null} */ l, /** @type {number} */ i) => {
					if (typeof l !== 'number') return void (pen = false);
					const px = x(c.start + (i + 0.5) * c.curve_step), py = y(l + c.gain_db);
					d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
					pen = true;
				});
				return { id: c.clip, track: c.track, d };
			})
	);
</script>

<div class="loud">
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Loudness over time">
		{#each [-12, -18, -24, -30, -36, -42, -48] as l (l)}
			<line class="grid" x1="0" x2={W} y1={y(l)} y2={y(l)} />
		{/each}
		{#each Object.entries(AIM) as [t, l] (t)}
			<line class="aim" x1="0" x2={W} y1={y(l)} y2={y(l)} stroke={COLOUR[t]} />
		{/each}
		{#each curves as c (c.id)}
			<path d={c.d} stroke={COLOUR[c.track] ?? '#888'} class:sel={s.selected === c.id} />
		{/each}
		<line class="head" x1={x(s.time)} x2={x(s.time)} y1="0" y2={H} />
	</svg>
	<div class="scale">
		{#each [-12, -24, -36, -48] as l (l)}<span style:top="{(y(l) / H) * 100}%">{l}</span>{/each}
	</div>
	<div class="legend">
		<span><i style:background={COLOUR.A1}></i>Voice</span>
		<span><i style:background={COLOUR.A2}></i>Music</span>
		<span><i style:background={COLOUR.A3}></i>Sounds</span>
		<span class="note">{s.loudMeasuring ? 'listening…' : s.loud ? 'LUFS at each clip’s gain · dashed: aimed at' : 'measuring the sound…'}</span>
	</div>
</div>

<style>
	.loud {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 0.5rem 0.8rem 0.4rem 2.2rem;
		background: #14171a;
	}

	svg {
		flex: 1;
		width: 100%;
		min-height: 0;
	}

	path {
		fill: none;
		stroke-width: 1.6;
		vector-effect: non-scaling-stroke;
		opacity: 0.85;
	}

	path.sel {
		stroke-width: 2.6;
		opacity: 1;
	}

	.grid {
		stroke: #2a2f33;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.aim {
		stroke-width: 1;
		stroke-dasharray: 4 4;
		vector-effect: non-scaling-stroke;
		opacity: 0.6;
	}

	.head {
		stroke: #e05a47;
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.scale {
		position: absolute;
		top: 0.5rem;
		bottom: 1.9rem;
		left: 0.3rem;
		width: 1.8rem;
	}

	.scale span {
		position: absolute;
		transform: translateY(-50%);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.6rem;
		color: #7d858c;
	}

	.legend {
		display: flex;
		gap: 0.9rem;
		padding-top: 0.3rem;
		font-size: 0.68rem;
		color: #aab1b7;
	}

	.legend i {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.3rem;
		border-radius: 2px;
	}

	.note {
		margin-left: auto;
		color: #7d858c;
	}
</style>
