<!--
	Sandbox 8 · a small line chart in SVG: one y axis, thin 2px lines (a dashed one for a ceiling), a legend, light grid,
	shaded bands for scheduled shocks, and a crosshair with the values under the pointer. Lines are thinned to at
	most 320 points so it stays light while the worlds run.
-->
<script>
	// @ts-nocheck — plain JS
	/**
	 * @type {{ series: { name: string, color: string, dash?: boolean, points: number[][] }[], xMax: number, title: string, unit?: string,
	 *   bands?: { from: number, to: number, label: string }[], yMin?: number, height?: number, fmt?: (v: number) => string, xFmt?: (v: number) => string }}
	 */
	let { series, xMax, title, unit = '', bands = [], yMin, height = 150, fmt = (v) => niceNum(v), xFmt = (d) => `year ${(d / 365 + 1).toFixed(1)}` } = $props();

	const W = 320, PADL = 34, PADR = 8, PADT = 8, PADB = 18;
	let hover = $state(/** @type {number | null} */ (null));

	const thin = (/** @type {number[][]} */ pts) => {
		if (pts.length <= 320) return pts;
		const step = pts.length / 320, out = [];
		for (let i = 0; i < 320; i++) out.push(pts[Math.floor(i * step)]);
		out.push(pts[pts.length - 1]);
		return out;
	};
	const shown = $derived(series.map((s) => ({ ...s, pts: thin(s.points.filter((p) => Number.isFinite(p[1]))) })));
	const ext = $derived.by(() => {
		let lo = Infinity, hi = -Infinity, flat = false;
		for (const s of shown) for (const p of s.pts) (lo = Math.min(lo, p[1])), (hi = Math.max(hi, p[1]));
		if (!Number.isFinite(lo)) (lo = 0), (hi = 1);
		if (yMin !== undefined) {
			// the axis starts at its floor (0 people short), and a flat line there still gets three units of height (whole-number ticks for counts)
			lo = Math.min(lo, yMin);
			if (hi - lo < 1e-9 * Math.max(1, Math.abs(hi))) (hi = lo + Math.max(3, Math.abs(hi) * 0.1)), (flat = true);
		} else if (hi - lo < 1e-9 * Math.max(1, Math.abs(hi))) {
			// a flat line: give it a little room either side, so the ticks are not the same number four times
			const r = Math.max(1, Math.abs(hi) * 0.05);
			(lo -= r), (hi += r);
		}
		const pad = (hi - lo) * 0.08;
		return { lo: yMin !== undefined ? lo : lo - pad, hi: flat ? hi : hi + pad };
	});
	const sx = (/** @type {number} */ d) => PADL + (d / Math.max(1, xMax)) * (W - PADL - PADR);
	const sy = (/** @type {number} */ v) => PADT + (1 - (v - ext.lo) / (ext.hi - ext.lo)) * (height - PADT - PADB);
	const ticks = $derived.by(() => {
		const out = [];
		for (let i = 0; i <= 3; i++) out.push(ext.lo + ((ext.hi - ext.lo) * i) / 3);
		return out;
	});
	const years = $derived.by(() => {
		const y = Math.max(1, Math.round(xMax / 365)), step = y <= 6 ? 1 : y <= 15 ? 3 : 5, out = [];
		for (let k = step; k < y; k += step) out.push(k);
		return out;
	});
	const path = (/** @type {number[][]} */ pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');

	function move(/** @type {PointerEvent} */ e) {
		const svg = /** @type {SVGSVGElement} */ (e.currentTarget);
		const r = svg.getBoundingClientRect();
		const x = ((e.clientX - r.left) / r.width) * W;
		hover = Math.max(0, Math.min(xMax, ((x - PADL) / (W - PADL - PADR)) * xMax));
	}
	const at = $derived.by(() => {
		if (hover === null) return null;
		const rows = shown.map((s) => {
			let best = null, bd = Infinity;
			for (const p of s.pts) {
				const d = Math.abs(p[0] - /** @type {number} */ (hover));
				if (d < bd) (bd = d), (best = p);
			}
			return { name: s.name, color: s.color, v: best ? best[1] : NaN, d: best ? best[0] : NaN };
		});
		return { d: rows.find((r) => Number.isFinite(r.d))?.d ?? hover, rows };
	});
	function niceNum(/** @type {number} */ v) {
		const a = Math.abs(v);
		if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
		if (a >= 10) return v.toFixed(0);
		if (a >= 1) return v.toFixed(1);
		return v.toFixed(2);
	}
</script>

<figure class="chart">
	<figcaption>{title}{#if unit}<small> · {unit}</small>{/if}</figcaption>
	<div class="plot">
		<svg viewBox="0 0 {W} {height}" role="img" aria-label={title} onpointermove={move} onpointerleave={() => (hover = null)}>
			{#each bands as b}
				<rect x={sx(b.from)} y={PADT} width={Math.max(1, sx(b.to) - sx(b.from))} height={height - PADT - PADB} class="band"><title>{b.label}</title></rect>
			{/each}
			{#each ticks as t}
				<line x1={PADL} x2={W - PADR} y1={sy(t)} y2={sy(t)} class="grid" />
				<text x={PADL - 4} y={sy(t) + 3} class="tick" text-anchor="end">{fmt(t)}</text>
			{/each}
			{#each years as y}
				<text x={sx(y * 365)} y={height - 5} class="tick" text-anchor="middle">{y + 1}</text>
			{/each}
			<text x={W - PADR} y={height - 5} class="tick" text-anchor="end">year</text>
			{#each shown as s}
				{#if s.pts.length > 1}
					<path d={path(s.pts)} stroke={s.color} stroke-dasharray={s.dash ? '4 3' : undefined} class="line" />
				{:else if s.pts.length === 1}
					<circle cx={sx(s.pts[0][0])} cy={sy(s.pts[0][1])} r="2.5" fill={s.color} />
				{/if}
			{/each}
			{#if at}
				<line x1={sx(at.d)} x2={sx(at.d)} y1={PADT} y2={height - PADB} class="cross" />
				{#each at.rows as r}
					{#if Number.isFinite(r.v)}<circle cx={sx(r.d)} cy={sy(r.v)} r="3" fill={r.color} stroke="var(--paper)" stroke-width="1.5" />{/if}
				{/each}
			{/if}
		</svg>
		{#if at}
			<div class="tip" style:left="{Math.min(70, Math.max(2, (sx(at.d) / W) * 100 - 15))}%">
				<b>{xFmt(at.d)}</b>
				{#each at.rows as r}<span><i style:background={r.color}></i>{r.name}: {Number.isFinite(r.v) ? fmt(r.v) : '–'}</span>{/each}
			</div>
		{/if}
	</div>
	<ul class="legend">
		{#each series as s}<li><i style:background={s.color} class:dash={s.dash}></i>{s.name}</li>{/each}
	</ul>
</figure>

<style>
	.chart {
		margin: 0;
		min-width: 0;
	}
	figcaption {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 0.2rem;
	}
	figcaption small {
		font-weight: 400;
		color: var(--muted);
	}
	.plot {
		position: relative;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 0.6;
	}
	.tick {
		font-size: 8.5px;
		fill: var(--muted);
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.band {
		fill: rgb(200 116 79 / 0.12);
	}
	.cross {
		stroke: var(--ink-soft);
		stroke-width: 0.8;
	}
	.tip {
		position: absolute;
		top: 0;
		pointer-events: none;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.25rem 0.45rem;
		font-size: 0.7rem;
		line-height: 1.35;
		box-shadow: 0 4px 12px rgb(38 56 44 / 0.12);
		display: flex;
		flex-direction: column;
		max-width: 60%;
	}
	.tip i,
	.legend i {
		display: inline-block;
		width: 10px;
		height: 3px;
		border-radius: 2px;
		margin-right: 0.3rem;
		vertical-align: middle;
	}
	.legend {
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.8rem;
		font-size: 0.7rem;
		color: var(--ink-soft);
	}
	.legend i.dash {
		background-image: linear-gradient(90deg, transparent 50%, var(--paper) 50%) !important;
		background-size: 5px 3px;
	}
</style>
