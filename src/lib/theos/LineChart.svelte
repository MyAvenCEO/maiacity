<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// A small SVG line chart for the paper: thin 2px lines, a recessive grid, a legend for two or more series, direct
	// labels at the line ends, and a crosshair with a tooltip on hover (or touch).
	let {
		series, // [{ id, label, color, points: [[x, y], ...], dash? }]
		x, // { min, max, ticks: [..], fmt, label, log? }
		y, // { min, max, ticks: [..], fmt, label, log? }
		refs = [], // [{ axis: 'x' | 'y', at, label, end?, below? }]
		height = 300,
		endLabels = true,
		title = ''
	} = $props();

	// the drawing is as wide as its box (up to 680), so its words keep their size on a phone
	let cw = $state(680);
	const W = $derived(Math.max(320, Math.min(680, cw)));
	const narrow = $derived(W < 520);
	const pad = $derived({ l: narrow ? 48 : 64, r: endLabels ? (narrow ? 58 : 128) : 16, t: narrow ? 30 : 14, b: 46 });
	const xTicks = $derived(narrow && x.ticks.length > 5 ? x.ticks.filter((_, i) => i % 2 === 0 || i === x.ticks.length - 1) : x.ticks);
	const H = $derived(height);
	const iw = $derived(W - pad.l - pad.r);
	const ih = $derived(H - pad.t - pad.b);

	const tx = (v) => (x.log ? Math.log10(v) : v);
	const ty = (v) => (y.log ? Math.log10(v) : v);
	const sx = (v) => pad.l + ((tx(v) - tx(x.min)) / (tx(x.max) - tx(x.min))) * iw;
	const sy = (v) => pad.t + (1 - (ty(v) - ty(y.min)) / (ty(y.max) - ty(y.min))) * ih;
	// on a log axis, the clamp also works in log space (a value at or below zero sits on the floor)
	const clampY = (v) => (y.log && !(v > 0) ? y.min : Math.max(y.min, Math.min(y.max, v)));

	const path = (pts) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${sx(a).toFixed(1)},${sy(clampY(b)).toFixed(1)}`).join('');

	// end labels, nudged apart so they never sit on each other
	const ends = $derived.by(() => {
		const e = series.map((s) => ({ s, y: sy(clampY(s.points.at(-1)[1])) })).sort((a, b) => a.y - b.y);
		for (let i = 1; i < e.length; i++) if (e[i].y - e[i - 1].y < 16) e[i].y = e[i - 1].y + 16;
		for (const l of e) l.y = Math.max(l.y, pad.t + 6);
		for (let i = 1; i < e.length; i++) if (e[i].y - e[i - 1].y < 16) e[i].y = e[i - 1].y + 16;
		const over = e.length ? e.at(-1).y - (pad.t + ih + 4) : 0;
		if (over > 0) e.forEach((l) => (l.y -= over));
		return e;
	});

	// a label on a horizontal reference line starts to the right of any vertical reference line near the left edge
	const yRefX = $derived(Math.max(pad.l + 6, ...refs.filter((q) => q.axis === 'x' && sx(q.at) < pad.l + iw / 4).map((q) => sx(q.at) + 6)));

	let hover = $state(null); // index into the points
	let svg;
	function move(ev) {
		const r = svg.getBoundingClientRect();
		const px = ((ev.clientX - r.left) / r.width) * W;
		if (px < pad.l || px > W - pad.r) return (hover = null);
		const pts = series[0].points;
		let best = 0;
		for (let i = 0; i < pts.length; i++) if (Math.abs(sx(pts[i][0]) - px) < Math.abs(sx(pts[best][0]) - px)) best = i;
		hover = best;
	}
	const hx = $derived(hover == null ? 0 : sx(series[0].points[hover][0]));
</script>

<div class="chart">
	{#if series.length > 1}
		<ul class="legend" aria-label="Legend">
			{#each series as s (s.id)}
				<li><i style:background={s.color} class:dash={s.dash}></i>{s.label}</li>
			{/each}
		</ul>
	{/if}
	<div class="plot" bind:clientWidth={cw}>
		<svg
			bind:this={svg}
			viewBox="0 0 {W} {H}"
			role="img"
			aria-label={title}
			onpointermove={move}
			onpointerdown={move}
			onpointerleave={() => (hover = null)}
		>
			{#each y.ticks as t (t)}
				<line class="grid" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
				<text class="tick" x={pad.l - 8} y={sy(t)} text-anchor="end" dominant-baseline="middle">{y.fmt(t)}</text>
			{/each}
			{#each xTicks as t (t)}
				<text class="tick" x={sx(t)} y={H - pad.b + 18} text-anchor="middle">{x.fmt(t)}</text>
			{/each}
			<line class="axis" x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} />
			<text class="label" x={pad.l + iw / 2} y={H - 6} text-anchor="middle">{x.label}</text>
			{#if narrow}
				<text class="label" x={4} y={14}>{y.label}</text>
			{:else}
				<text class="label" transform="translate(14 {pad.t + ih / 2}) rotate(-90)" text-anchor="middle">{y.label}</text>
			{/if}

			{#each refs as r, i (i)}
				{#if r.axis === 'y'}
					<line class="ref" x1={pad.l} x2={W - pad.r} y1={sy(r.at)} y2={sy(r.at)} />
					<text class="reflabel" x={r.end ? W - pad.r - 4 : yRefX} y={sy(r.at) + (r.below ? 16 : -6)} text-anchor={r.end ? 'end' : 'start'}>{r.label}</text>
				{:else}
					<line class="ref" x1={sx(r.at)} x2={sx(r.at)} y1={pad.t} y2={pad.t + ih} />
					<text class="reflabel" x={sx(r.at) + 6} y={pad.t + 12}>{r.label}</text>
				{/if}
			{/each}

			{#each series as s (s.id)}
				<path d={path(s.points)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray={s.dash ? '6 5' : null} />
			{/each}

			{#if endLabels}
				{#each ends as e (e.s.id)}
					<circle cx={sx(e.s.points.at(-1)[0])} cy={sy(clampY(e.s.points.at(-1)[1]))} r="4" fill={e.s.color} stroke="var(--paper)" stroke-width="2" />
					<text class="end" x={W - pad.r + 10} y={e.y} dominant-baseline="middle">{y.fmt(e.s.points.at(-1)[1])}</text>
				{/each}
			{/if}

			{#if hover != null}
				<line class="cross" x1={hx} x2={hx} y1={pad.t} y2={pad.t + ih} />
				{#each series as s (s.id)}
					<circle cx={hx} cy={sy(clampY(s.points[hover][1]))} r="4.5" fill={s.color} stroke="var(--paper)" stroke-width="2" />
				{/each}
			{/if}
		</svg>
		{#if hover != null}
			<div class="tip" style:left="{(hx / W) * 100}%" class:flip={hx > W * 0.6}>
				<strong>{x.fmt(series[0].points[hover][0], true)}</strong>
				{#each series as s (s.id)}
					<span><i style:background={s.color}></i>{s.label}: <b>{y.fmt(s.points[hover][1], true)}</b></span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.chart {
		position: relative;
		font-family: var(--font-body);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1.1rem;
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	i {
		display: inline-block;
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}

	i.dash {
		background-image: linear-gradient(90deg, transparent 50%, var(--paper) 50%) !important;
	}

	.plot {
		position: relative;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		touch-action: pan-y;
		font-family: var(--font-body);
	}

	.grid {
		stroke: var(--line);
		stroke-width: 1;
		opacity: 0.6;
	}

	.axis {
		stroke: var(--muted);
		stroke-width: 1;
	}

	.tick {
		font-size: 13px;
		fill: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.label {
		font-size: 13px;
		fill: var(--ink-soft);
	}

	.ref {
		stroke: var(--ink-soft);
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}

	.reflabel {
		font-size: 11.5px;
		fill: var(--ink-soft);
		font-style: italic;
		/* a halo in the figure's colour, so that a line that crosses the label never hides it */
		paint-order: stroke;
		stroke: var(--paper);
		stroke-width: 3px;
		stroke-linejoin: round;
	}

	.end {
		font-size: 13px;
		fill: var(--ink);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.cross {
		stroke: var(--ink);
		stroke-width: 1;
		opacity: 0.35;
	}

	.tip {
		position: absolute;
		top: 0.4rem;
		transform: translateX(12px);
		display: grid;
		gap: 0.15rem;
		min-width: 11rem;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--paper);
		box-shadow: 0 6px 20px rgb(38 56 44 / 0.1);
		font-size: 0.76rem;
		color: var(--ink-soft);
		pointer-events: none;
		font-variant-numeric: tabular-nums;
	}

	.tip.flip {
		transform: translateX(calc(-100% - 12px));
	}

	.tip strong {
		color: var(--ink);
	}

	.tip b {
		color: var(--ink);
		font-weight: 600;
	}

	.tip i {
		margin-right: 0.4rem;
		vertical-align: middle;
	}
</style>
