<!--
	Each good's order book right now (Samuel, 2026-10-09: with free prices, how best to show them): the sellers' lowest
	prices rising from the cheapest, the buyers' limits falling from the highest, against the units offered and wanted
	so far. Where the two lines cross is where the market clears; the dashed line is the clearing price (the average
	traded over the last day). The price axis is logarithmic, shared by all goods, so a good at 0.5 and one at 5,000 read
	alike. Hover a step to see whose price it is.
-->
<script>
	import { GOODS, GOOD_LABEL, GOOD_COLOUR } from './economy.js';
	import { short, logScale, logAt } from './format.js';

	/** @typedef {{ name: string, qty: number, price: number }} Order */
	/** @type {{ market: Record<string, { price: number | null, sells: Order[], wants: Order[] }> }} */
	let { market } = $props();

	const H = 130,
		L = 34,
		R = 8,
		T = 8,
		B = 18;
	let width = $state(200);
	/** @type {{ g: string, side: string, o: Order } | null} */
	let hover = $state(null);

	const scale = $derived(logScale(GOODS.flatMap((g) => [market[g].price, ...market[g].sells.map((o) => o.price), ...market[g].wants.map((o) => o.price)])));
	const y = (/** @type {number} */ v) => T + (1 - logAt(v, scale.lo, scale.hi)) * (H - T - B);

	/** the steps of one side: each order a run of its units at its price, cheapest seller (or highest buyer) first */
	const steps = (/** @type {Order[]} */ list, /** @type {boolean} */ up) => {
		const sorted = [...list].sort((p, q) => (up ? p.price - q.price : q.price - p.price));
		let at = 0;
		return sorted.map((o) => ({ o, from: at, to: (at += o.qty) }));
	};
	const books = $derived(
		Object.fromEntries(
			GOODS.map((g) => {
				const sells = steps(market[g].sells, true);
				const wants = steps(market[g].wants, false);
				return [g, { sells, wants, units: Math.max(1, sells.at(-1)?.to ?? 0, wants.at(-1)?.to ?? 0) }];
			})
		)
	);
	/** one side as a stepped path */
	const path = (/** @type {{ o: Order, from: number, to: number }[]} */ s, /** @type {(q: number) => number} */ x) => s.map((p, i) => `${i ? 'L' : 'M'}${x(p.from).toFixed(1)},${y(p.o.price).toFixed(1)}H${x(p.to).toFixed(1)}`).join('');
	const xOf = (/** @type {number} */ units) => (/** @type {number} */ q) => L + (q / units) * (width - L - R);
</script>

<div class="depth">
	<div class="head"><b>Order books now</b> <small>sellers' lowest prices <i class="sell"></i> and buyers' limits <i class="buy"></i> against units; dashed: the clearing price; log scale</small></div>
	<div class="grid">
		{#each GOODS as g (g)}
			{@const b = books[g]}
			{@const x = xOf(b.units)}
			{@const m = market[g]}
			<figure bind:clientWidth={width}>
				<figcaption><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} <b>{short(m.price)}</b></figcaption>
				<svg {width} height={H} role="img" aria-label="{GOOD_LABEL[g]}: {b.sells.length} sellers, {b.wants.length} buyers">
					{#each scale.ticks as v (v)}
						<line class="gridline" x1={L} x2={width - R} y1={y(v)} y2={y(v)} />
						<text class="tick" x={L - 4} y={y(v) + 3} text-anchor="end">{short(v)}</text>
					{/each}
					<text class="tick" x={width - R} y={H - 4} text-anchor="end">{b.units} units</text>
					{#if m.price != null}<line class="clear" x1={L} x2={width - R} y1={y(m.price)} y2={y(m.price)} />{/if}
					<path class="sell" d={path(b.sells, x)} />
					<path class="buy" d={path(b.wants, x)} />
					{#each b.sells as s, i (i)}<rect class="hit" x={x(s.from)} y={y(s.o.price) - 5} width={Math.max(2, x(s.to) - x(s.from))} height="10" role="presentation" onpointerenter={() => (hover = { g, side: 'sells', o: s.o })} onpointerleave={() => (hover = null)} />{/each}
					{#each b.wants as s, i (i)}<rect class="hit" x={x(s.from)} y={y(s.o.price) - 5} width={Math.max(2, x(s.to) - x(s.from))} height="10" role="presentation" onpointerenter={() => (hover = { g, side: 'wants', o: s.o })} onpointerleave={() => (hover = null)} />{/each}
					{#if !b.sells.length && !b.wants.length}<text class="tick" x={(L + width - R) / 2} y={H / 2} text-anchor="middle">nobody offers or wants it now</text>{/if}
				</svg>
				<p class="tip">{#if hover?.g === g}{hover.o.name} {hover.side === 'sells' ? 'sells' : 'wants'} {hover.o.qty} at {short(hover.o.price)}{#if m.price} <small>{short(hover.o.price / m.price)}× clearing</small>{/if}{:else}{b.sells.length} selling · {b.wants.length} buying{/if}</p>
			</figure>
		{/each}
	</div>
</div>

<style>
	.depth {
		background: #fff;
		border-radius: 10px;
		padding: 0.5rem 0.5rem 0.3rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		margin-top: 0.5rem;
	}
	.head {
		font-size: 0.8rem;
		padding: 0 0.2rem;
	}
	.head small {
		opacity: 0.65;
	}
	.head i {
		display: inline-block;
		width: 12px;
		height: 3px;
		border-radius: 2px;
		vertical-align: middle;
	}
	i.sell {
		background: #b8483b;
	}
	i.buy {
		background: #2f7a4a;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
		gap: 0.4rem 0.6rem;
		margin-top: 0.3rem;
	}
	figure {
		margin: 0;
		min-width: 0;
	}
	figcaption {
		font-size: 0.72rem;
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	figcaption em {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}
	figcaption b {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	svg {
		display: block;
	}
	.gridline {
		stroke: #1f2a2312;
	}
	.tick {
		font-size: 9px;
		fill: #6b6a66;
	}
	.clear {
		stroke: #1f2a2399;
		stroke-dasharray: 4 3;
	}
	path {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
	}
	path.sell {
		stroke: #b8483b;
	}
	path.buy {
		stroke: #2f7a4a;
	}
	.hit {
		fill: transparent;
	}
	.tip {
		margin: 0;
		font-size: 0.68rem;
		opacity: 0.75;
		min-height: 1em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
