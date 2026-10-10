<!--
	The price of each good over time: one line per good (its market price, hour by hour), one axis in HEARTS, the days
	along the bottom. Prices are free (from fractions of a HEART to tens of thousands), so the axis is logarithmic: ×2 is
	the same height at 1 and at 10,000. Hover or touch to read every good's price at that moment.
-->
<script>
	import { GOODS_SHOWN as GOODS, GOOD_LABEL, GOOD_COLOUR, DAY_S } from './economy.js'; // GOODS: listed in rainbow order
	import { short, logScale, logAt } from './format.js';

	/** @type {{ series: Record<string, { t: number, price: number }[]>, now: number }} */
	let { series, now } = $props();

	const RANGES = [
		{ days: 7, label: '7 days' },
		{ days: 30, label: '30 days' },
		{ days: Infinity, label: 'All' }
	];
	let range = $state(30);
	let width = $state(340);
	/** @type {number | null} */
	let hoverT = $state(null);

	const H = 220,
		L = 34,
		R = 64,
		T = 10,
		B = 24;

	const from = $derived(Math.max(0, now - range * DAY_S));
	const shown = $derived(Object.fromEntries(GOODS.map((g) => [g, (series[g] ?? []).filter((p) => p.t >= from)])));
	const scale = $derived(logScale(GOODS.flatMap((g) => shown[g].map((p) => p.price))));
	const x = (/** @type {number} */ t) => L + ((t - from) / Math.max(1, now - from)) * (width - L - R);
	const y = (/** @type {number} */ v) => T + (1 - logAt(v, scale.lo, scale.hi)) * (H - T - B);
	const yTicks = $derived(scale.ticks);
	const dayTicks = $derived(dayMarks(from, now));

	/** @param {number} a @param {number} b */
	function dayMarks(a, b) {
		const span = (b - a) / DAY_S;
		const every = span <= 8 ? 1 : span <= 20 ? 2 : span <= 40 ? 5 : span <= 90 ? 10 : 20;
		const out = [];
		for (let d = Math.ceil(a / DAY_S / every) * every; d * DAY_S <= b; d += every) out.push(d);
		return out;
	}
	/** @param {{ t: number, price: number }[]} pts */
	const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
	/** the point of a good nearest a time */
	const at = (/** @type {string} */ g, /** @type {number} */ t) => {
		const pts = shown[g];
		let best = pts[0];
		for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
		return best;
	};
	/** end labels, nudged apart so they don't overlap */
	const ends = $derived.by(() => {
		const out = GOODS.filter((g) => shown[g].length).map((g) => {
			const v = shown[g][shown[g].length - 1].price;
			return { g, v, yy: y(v) };
		});
		out.sort((a, b) => a.yy - b.yy);
		for (let i = 1; i < out.length; i++) if (out[i].yy - out[i - 1].yy < 12) out[i].yy = out[i - 1].yy + 12;
		return out;
	});

	function onMove(/** @type {PointerEvent} */ e) {
		const r = /** @type {SVGElement} */ (e.currentTarget).getBoundingClientRect();
		const px = e.clientX - r.left;
		if (px < L || px > width - R) return (hoverT = null);
		hoverT = from + ((px - L) / (width - L - R)) * (now - from);
	}
	const clock = (/** @type {number} */ t) => `day ${Math.floor(t / DAY_S) + 1}, ${String(Math.floor((t % DAY_S) / 3600)).padStart(2, '0')}:00`;
</script>

<div class="chart" bind:clientWidth={width}>
	<div class="head">
		<b>Market price over time</b>
		<span class="ranges">{#each RANGES as r (r.label)}<button class:on={range === r.days} onclick={() => (range = r.days)}>{r.label}</button>{/each}</span>
	</div>
	<div class="legend">{#each GOODS as g (g)}<span><i style:background={GOOD_COLOUR[g]}></i>{GOOD_LABEL[g]}</span>{/each}</div>
	<svg width={width} height={H} role="img" aria-label="Market price of each good over time, in HEARTS, on a log scale" onpointermove={onMove} onpointerleave={() => (hoverT = null)}>
		{#each yTicks as v (v)}
			<line class="grid" x1={L} x2={width - R} y1={y(v)} y2={y(v)} />
			<text class="tick" x={L - 6} y={y(v) + 4} text-anchor="end">{short(v)}</text>
		{/each}
		{#each dayTicks as d (d)}
			<text class="tick" x={x(d * DAY_S)} y={H - 6} text-anchor="middle">day {d + 1}</text>
		{/each}
		{#each GOODS as g (g)}
			{#if shown[g].length > 1}<path d={path(shown[g])} fill="none" stroke={GOOD_COLOUR[g]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />{/if}
		{/each}
		{#each ends as e (e.g)}
			<text class="end" x={width - R + 6} y={e.yy + 4}>{short(e.v)} {GOOD_LABEL[e.g].slice(0, 5)}</text>
		{/each}
		{#if hoverT != null}
			<line class="cross" x1={x(hoverT)} x2={x(hoverT)} y1={T} y2={H - B} />
			{#each GOODS as g (g)}
				{#if shown[g].length}<circle cx={x(at(g, hoverT).t)} cy={y(at(g, hoverT).price)} r="4" fill={GOOD_COLOUR[g]} stroke="#fff" stroke-width="2" />{/if}
			{/each}
		{/if}
	</svg>
	{#if hoverT != null}
		<div class="tip" style:left="{Math.min(width - 150, Math.max(0, x(hoverT) - 75))}px">
			<b>{clock(at(GOODS[0], hoverT)?.t ?? hoverT)}</b>
			{#each GOODS as g (g)}{#if shown[g].length}<span><i style:background={GOOD_COLOUR[g]}></i>{GOOD_LABEL[g]} <b>{short(at(g, hoverT).price)}</b></span>{/if}{/each}
		</div>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		background: #fff;
		border-radius: 10px;
		padding: 0.5rem 0.4rem 0.2rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		margin-top: 0.4rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.3rem;
		font-size: 0.8rem;
	}
	.ranges button {
		font: inherit;
		font-size: 0.7rem;
		border: 1px solid #1f2a2326;
		background: #fff;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		margin-left: 0.2rem;
		cursor: pointer;
	}
	.ranges button.on {
		background: #24452f;
		color: #f4f1e8;
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
		width: 10px;
		height: 3px;
		border-radius: 2px;
		margin-right: 0.3rem;
		vertical-align: middle;
	}
	svg {
		display: block;
		touch-action: pan-y;
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
		fill: #2b2b29;
		font-variant-numeric: tabular-nums;
	}
	.tip {
		position: absolute;
		top: 3.2rem;
		width: 150px;
		background: rgb(255 255 255 / 0.96);
		border-radius: 8px;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.18);
		padding: 0.35rem 0.5rem;
		font-size: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		pointer-events: none;
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
