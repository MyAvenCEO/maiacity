<!--
	One chart of the Stats view: lines over in-game days, one axis in one unit, dry spells shaded behind.
	Hover or touch to read every line at that day; each line's latest value is written at its end. `log`: a logarithmic
	axis, for prices (free, from fractions of a HEART to tens of thousands: ×2 is the same height anywhere).
-->
<script>
	import { short, logScale, logAt } from './format.js';
	/** @typedef {{ key: string, label: string, colour: string, dash?: boolean, pts: { x: number, y: number | null }[] }} ChartLine */
	/** @type {{ title: string, unit: string, lines: ChartLine[], from: number, to: number, shade?: [number, number][], note?: string, max?: number, log?: boolean }} */
	let { title, unit, lines, from, to, shade = [], note = '', max = 0, log = false } = $props();

	let width = $state(480);
	/** @type {number | null} */
	let hoverX = $state(null);

	const H = 200,
		L = 44,
		R = 74,
		T = 10,
		B = 22;

	const shown = $derived(lines.map((l) => ({ ...l, pts: l.pts.filter((p) => p.x >= from && p.x <= to) })));
	const top = $derived(max || niceTop(Math.max(1, ...shown.flatMap((l) => l.pts.map((p) => p.y ?? 0)))));
	const scale = $derived(log ? logScale(shown.flatMap((l) => l.pts.map((p) => p.y))) : null);
	const x = (/** @type {number} */ v) => L + ((v - from) / Math.max(1e-6, to - from)) * (width - L - R);
	const y = (/** @type {number} */ v) => T + (1 - (scale ? logAt(v, scale.lo, scale.hi) : v / top)) * (H - T - B);
	const yTicks = $derived(scale ? scale.ticks : [0, top / 4, top / 2, (3 * top) / 4, top]);
	const dayTicks = $derived.by(() => {
		const span = to - from;
		const every = span <= 8 ? 1 : span <= 20 ? 2 : span <= 40 ? 5 : span <= 90 ? 10 : span <= 200 ? 20 : 50;
		const out = [];
		for (let d = Math.ceil(from / every) * every; d <= to; d += every) out.push(d);
		return out;
	});

	/** @param {number} v */
	function niceTop(v) {
		const step = 10 ** Math.floor(Math.log10(v));
		for (const m of [1, 2, 4, 6, 8, 10]) if (m * step >= v * 1.08) return m * step;
		return 10 * step;
	}
	const fmt = short;
	/** a line's path, broken where a value is missing */
	const path = (/** @type {ChartLine['pts']} */ pts) => {
		let d = '',
			pen = false;
		for (const p of pts) {
			if (p.y == null) {
				pen = false;
				continue;
			}
			d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`;
			pen = true;
		}
		return d;
	};
	/** the point of a line nearest a day */
	const at = (/** @type {ChartLine} */ l, /** @type {number} */ v) => {
		let best = null;
		for (const p of l.pts) if (p.y != null && (!best || Math.abs(p.x - v) < Math.abs(best.x - v))) best = p;
		return best;
	};
	/** end labels, nudged apart so they don't overlap */
	const ends = $derived.by(() => {
		const out = shown
			.filter((l) => !l.dash)
			.map((l) => {
				const last = [...l.pts].reverse().find((p) => p.y != null);
				return last ? { key: l.key, label: l.label, colour: l.colour, v: last.y ?? 0, yy: y(last.y ?? 0) } : null;
			})
			.filter((e) => e != null);
		out.sort((a, b) => a.yy - b.yy);
		for (let i = 1; i < out.length; i++) if (out[i].yy - out[i - 1].yy < 12) out[i].yy = out[i - 1].yy + 12;
		return out;
	});
	const hoverPts = $derived(hoverX == null ? [] : shown.map((l) => ({ l, p: at(l, /** @type {number} */ (hoverX)) })).filter((h) => h.p));

	function onMove(/** @type {PointerEvent} */ e) {
		const r = /** @type {SVGElement} */ (e.currentTarget).getBoundingClientRect();
		const px = e.clientX - r.left;
		if (px < L || px > width - R) return (hoverX = null);
		hoverX = from + ((px - L) / (width - L - R)) * (to - from);
	}
	const when = (/** @type {number} */ v) => (Number.isInteger(v) ? (v === 0 ? 'start' : `end of day ${v}`) : `day ${Math.floor(v) + 1}, ${String(Math.floor((v % 1) * 24)).padStart(2, '0')}:00`);
</script>

<div class="chart" bind:clientWidth={width}>
	<div class="head">
		<b>{title}</b>
		<span>{unit}</span>
	</div>
	{#if note}<p class="note">{note}</p>{/if}
	<div class="legend">
		{#each lines as l (l.key)}<span><i class:dash={l.dash} style:--c={l.colour}></i>{l.label}</span>{/each}
	</div>
	<svg width={width} height={H} role="img" aria-label="{title}, in {unit}" onpointermove={onMove} onpointerleave={() => (hoverX = null)}>
		{#each shade as [a, b] (a)}
			{#if b >= from && a <= to}<rect class="dry" x={x(Math.max(from, a))} y={T} width={Math.max(1, x(Math.min(to, b)) - x(Math.max(from, a)))} height={H - T - B} />{/if}
		{/each}
		{#each yTicks as v (v)}
			<line class="grid" x1={L} x2={width - R} y1={y(v)} y2={y(v)} />
			<text class="tick" x={L - 6} y={y(v) + 4} text-anchor="end">{fmt(v)}</text>
		{/each}
		{#each dayTicks as d (d)}
			<text class="tick" x={x(d)} y={H - 6} text-anchor="middle">{d === 0 ? 'start' : `day ${d}`}</text>
		{/each}
		{#each shown as l (l.key)}
			{#if l.pts.length > 1}<path d={path(l.pts)} fill="none" stroke={l.colour} stroke-width="2" stroke-dasharray={l.dash ? '5 4' : null} stroke-linejoin="round" stroke-linecap="round" />{:else if l.pts.length === 1 && l.pts[0].y != null}<circle cx={x(l.pts[0].x)} cy={y(l.pts[0].y)} r="3" fill={l.colour} />{/if}
		{/each}
		{#each ends as e (e.key)}
			<text class="end" x={width - R + 6} y={e.yy + 4} fill={e.colour}>{fmt(e.v)} <tspan class="endlabel">{e.label.slice(0, 7)}</tspan></text>
		{/each}
		{#if hoverX != null}
			<line class="cross" x1={x(hoverX)} x2={x(hoverX)} y1={T} y2={H - B} />
			{#each hoverPts as h (h.l.key)}
				<circle cx={x(h.p?.x ?? 0)} cy={y(h.p?.y ?? 0)} r="4" fill={h.l.colour} stroke="#fff" stroke-width="2" />
			{/each}
		{/if}
	</svg>
	{#if hoverX != null && hoverPts.length}
		<div class="tip" style:left="{Math.min(width - 170, Math.max(0, x(hoverX) + 12))}px">
			<b>{when(hoverPts[0].p?.x ?? 0)}</b>
			{#each hoverPts as h (h.l.key)}<span><i class:dash={h.l.dash} style:--c={h.l.colour}></i>{h.l.label} <b>{fmt(h.p?.y ?? 0)}</b></span>{/each}
		</div>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		background: #fff;
		border-radius: 12px;
		padding: 0.6rem 0.5rem 0.3rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
		min-width: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0 0.3rem;
		font-size: 0.85rem;
	}
	.head span,
	.note {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.note {
		margin: 0.15rem 0.3rem 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.7rem;
		padding: 0.3rem 0.3rem 0;
		font-size: 0.7rem;
		color: #52514e;
	}
	i {
		display: inline-block;
		width: 12px;
		height: 3px;
		border-radius: 2px;
		margin-right: 0.3rem;
		vertical-align: middle;
		background: var(--c);
	}
	i.dash {
		background: repeating-linear-gradient(90deg, var(--c) 0 4px, transparent 4px 6px);
	}
	svg {
		display: block;
		touch-action: pan-y;
	}
	.dry {
		fill: #f0a03c22;
	}
	.grid {
		stroke: #1f2a2314;
	}
	.cross {
		stroke: #1f2a2366;
		stroke-dasharray: 3 3;
	}
	.tick {
		font-size: 10px;
		fill: #6b6a66;
	}
	.end {
		font-size: 10px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.endlabel {
		font-weight: 400;
		fill: #52514e;
	}
	.tip {
		position: absolute;
		top: 3.4rem;
		width: 170px;
		background: rgb(255 255 255 / 0.97);
		border-radius: 8px;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.18);
		padding: 0.35rem 0.5rem;
		font-size: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		pointer-events: none;
		z-index: 2;
	}
	.tip span {
		display: flex;
		align-items: center;
	}
	.tip span b {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
</style>
