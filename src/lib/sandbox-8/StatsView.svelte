<!--
	The Stats view: everything the valley does, day by day, on one page. Switch goods, avens and charts on and off;
	every chart shares the same range of days, and dry spells are shaded orange behind each one.
-->
<script>
	import { GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, DAY_S } from './economy.js';
	import LineChart from './LineChart.svelte';

	/** @type {{ stats: any[], series: Record<string, { t: number, price: number }[]>, now: number, avens: { id: number, name: string, colour: string, alive: boolean }[] }} */
	let { stats, series, now, avens } = $props();

	const CHARTS = [
		{ k: 'prices', label: 'Prices' },
		{ k: 'daily', label: 'Day by day' },
		{ k: 'trades', label: 'Trades' },
		{ k: 'hearts', label: 'HEARTS per aven' },
		{ k: 'money', label: 'HEARTS in the valley' },
		{ k: 'policy', label: 'Minting and decay' },
		{ k: 'meals', label: 'Who ate what' },
		{ k: 'eaten', label: 'Eaten' },
		{ k: 'short', label: 'Shortages' },
		{ k: 'body', label: 'Water and food reserves' },
		{ k: 'harvest', label: 'Harvests' },
		{ k: 'stock', label: 'Stocks' },
		{ k: 'rot', label: 'Rot' }
	];
	const RANGES = [
		{ days: 7, label: '7 days' },
		{ days: 30, label: '30 days' },
		{ days: 90, label: '90 days' },
		{ days: Infinity, label: 'All' }
	];
	const MINT = '#2f7d4f',
		DECAY = '#c2410c',
		TOTAL = '#24452f';

	let goodsOn = $state(Object.fromEntries(GOODS.map((g) => [g, true])));
	/** @type {Record<number, boolean>} */
	let avensOn = $state({});
	let chartsOn = $state(Object.fromEntries(CHARTS.map((c) => [c.k, true])));
	let range = $state(30);
	let showAvg = $state(true);

	const nowD = $derived(now / DAY_S);
	const from = $derived(Math.max(0, nowD - range));
	const to = $derived(Math.max(1, nowD));
	const goods = $derived(GOODS.filter((g) => goodsOn[g]));
	const crew = $derived(avens.filter((a) => avensOn[a.id] !== false));
	const rows = $derived(stats.filter((r) => r.day >= Math.floor(from)));
	const nights = $derived(rows.filter((r) => r.day >= 1));
	/** a dry spell's nights, as day ranges to shade */
	const shade = $derived(/** @type {[number, number][]} */ (stats.filter((r) => r.dry).map((r) => [r.day, r.day + 1])));
	const last = $derived(stats[stats.length - 1]);
	const sum = (/** @type {any[]} */ rs, /** @type {(r: any) => number} */ f) => rs.reduce((n, r) => n + f(r), 0);
	const fmt = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');

	/** one line per selected good, from a per-good field of the daily rows */
	const perGood = (/** @type {string} */ field, /** @type {any[]} */ rs = rows) => goods.map((g) => ({ key: g, label: GOOD_LABEL[g], colour: GOOD_COLOUR[g], pts: rs.map((r) => ({ x: r.day, y: r[field][g] })) }));
	/** one line per selected aven */
	const perAven = (/** @type {(r: any, id: number) => number | null} */ f, /** @type {any[]} */ rs = rows) => crew.map((a) => ({ key: String(a.id), label: a.name, colour: a.colour, pts: rs.map((r) => ({ x: r.day, y: f(r, a.id) })) }));

	const priceLines = $derived([
		...goods.map((g) => ({ key: g, label: GOOD_LABEL[g], colour: GOOD_COLOUR[g], pts: (series[g] ?? []).map((p) => ({ x: p.t / DAY_S, y: p.price })) })),
		...(showAvg ? goods.map((g) => ({ key: `${g}-avg`, label: `${GOOD_LABEL[g]} traded`, colour: GOOD_COLOUR[g], dash: true, pts: nights.map((r) => ({ x: r.day, y: r.avg[g] })) })) : [])
	]);
	const deals = $derived(sum(nights, (r) => r.deals));
	const unitsIn = (/** @type {any} */ r, /** @type {string} */ field, /** @type {number} */ id) => (r[field]?.[id] ? goods.reduce((n, g) => n + (r[field][id][g] ?? 0), 0) : 0);
	const needOf = $derived(goods.reduce((n, g) => n + NEED[g], 0));
	const totals = $derived({
		minted: sum(stats, (r) => r.minted),
		decayed: sum(stats, (r) => r.decayed),
		deals: sum(stats, (r) => r.deals),
		rotted: sum(stats, (r) => GOODS.reduce((n, g) => n + r.rotted[g], 0)),
		short: sum(stats, (r) => Object.values(r.short ?? {}).reduce((n, s) => n + Object.values(/** @type {Record<string, number>} */ (s)).reduce((m, v) => m + v, 0), 0)),
		dry: stats.filter((r) => r.dry).length
	});

	// the meals grid: one row per aven, one column per night; each night stacks what it went short of, in the good's colour
	let gridW = $state(600);
	const GRID_L = 54,
		ROW_H = 26;
	/** the most any aven missed in one night in this range: the bar scale */
	const worst = $derived(Math.max(3, ...nights.flatMap((r) => crew.map((a) => unitsIn(r, 'short', a.id)))));
	const colW = $derived(Math.max(2, (gridW - GRID_L - 8) / Math.max(1, nights.length)));
	/** @type {{ a: any, r: any } | null} */
	let cell = $state(null);
</script>

<div class="stats">
	<section class="cards">
		<div><span>HEARTS in the valley</span><b>{fmt(last?.total ?? 0)}</b></div>
		<div><span>Minted so far</span><b class="up">+{fmt(totals.minted)}</b></div>
		<div><span>Decayed so far</span><b class="down">−{fmt(totals.decayed)}</b></div>
		<div><span>Deals so far</span><b>{fmt(totals.deals)}</b></div>
		<div><span>Units gone short</span><b class="down">{fmt(totals.short)}</b></div>
		<div><span>Units rotted</span><b>{fmt(totals.rotted)}</b></div>
		<div><span>Dry nights</span><b>{totals.dry}</b></div>
		<div><span>Avens alive</span><b>{last?.alive ?? 5} of 5</b></div>
	</section>

	<section class="controls">
		<div class="row">
			<span class="lab">Range</span>
			{#each RANGES as r (r.label)}<button class="chip" class:on={range === r.days} onclick={() => (range = r.days)}>{r.label}</button>{/each}
		</div>
		<div class="row">
			<span class="lab">Goods</span>
			{#each GOODS as g (g)}<button class="chip" class:on={goodsOn[g]} style:--c={GOOD_COLOUR[g]} onclick={() => (goodsOn[g] = !goodsOn[g])}><i></i>{GOOD_LABEL[g]}</button>{/each}
			<button class="chip" class:on={showAvg} onclick={() => (showAvg = !showAvg)}>Traded average</button>
		</div>
		<div class="row">
			<span class="lab">Avens</span>
			{#each avens as a (a.id)}<button class="chip" class:on={avensOn[a.id] !== false} class:dead={!a.alive} style:--c={a.colour} onclick={() => (avensOn[a.id] = avensOn[a.id] === false)}><i></i>{a.name}{a.alive ? '' : ' †'}</button>{/each}
		</div>
		<div class="row">
			<span class="lab">Charts</span>
			{#each CHARTS as c (c.k)}<button class="chip" class:on={chartsOn[c.k]} onclick={() => (chartsOn[c.k] = !chartsOn[c.k])}>{c.label}</button>{/each}
		</div>
	</section>

	{#if stats.length < 2}
		<p class="empty">The charts fill in from the first night on. Press Start to let the avens trade.</p>
	{/if}

	<div class="grid">
		{#if chartsOn.prices}
			<div class="wide"><LineChart log title="Market price" unit="HEARTS a unit, log scale" note={showAvg ? 'Solid: the market price (the average traded over the last 24 hours), hour by hour. Dashed: the average price actually traded that day.' : 'The market price (the average traded over the last 24 hours), hour by hour.'} lines={priceLines} {from} {to} {shade} /></div>
		{/if}
		{#if chartsOn.daily}
			<div class="wide daily">
				<div class="head"><b>What the valley holds, day by day</b><span>units in store at the end of each day · HEARTS</span></div>
				<p class="note">Each good: in store across all living avens, with that night's <span class="up">+harvest</span> and <span class="down">−eaten</span>. Newest first.</p>
				<div class="scroll"><table>
					<thead><tr><th>Day</th>{#each goods as g (g)}<th><i style:--c={GOOD_COLOUR[g]}></i>{GOOD_LABEL[g]}</th>{/each}<th>HEARTS</th><th>Alive</th></tr></thead>
					<tbody>
						{#each [...nights].reverse().slice(0, 60) as r (r.day)}
							<tr class:dryrow={r.dry}>
								<td>{r.day}{r.dry ? ' · dry' : ''}</td>
								{#each goods as g (g)}
									{@const eaten = Object.values(r.ate ?? {}).reduce((n, e) => n + (/** @type {any} */ (e)[g] ?? 0), 0)}
									<td class="num"><b>{r.stock[g]}</b> <small><span class="up">+{r.harvest[g]}</span> <span class="down">−{eaten}</span></small></td>
								{/each}
								<td class="num"><b>{fmt(r.total)}</b></td>
								<td class="num">{r.alive}</td>
							</tr>
						{/each}
					</tbody>
				</table></div>
			</div>
		{/if}
		{#if chartsOn.meals}
			<div class="wide meals" bind:clientWidth={gridW}>
				<div class="head"><b>Who ate what, night by night</b><span>bar height: units missing, up to {worst}</span></div>
				<p class="note">A green tick: ate and drank in full. A coloured bar: went short of that good; the taller, the more it missed. Orange behind: dry spell. Hover a night to read it.</p>
				<svg width={gridW} height={crew.length * ROW_H + 18} role="img" aria-label="Each aven's meals and shortages, night by night" onpointerleave={() => (cell = null)}>
					{#each nights as r, i (r.day)}
						{#if r.dry}<rect class="dryband" x={GRID_L + i * colW} y="0" width={colW} height={crew.length * ROW_H} />{/if}
					{/each}
					{#each crew as a, j (a.id)}
						<text class="who" x={GRID_L - 6} y={j * ROW_H + ROW_H / 2 + 4} text-anchor="end" fill={a.colour}>{a.name}</text>
						<line class="base" x1={GRID_L} x2={gridW - 8} y1={(j + 1) * ROW_H - 3} y2={(j + 1) * ROW_H - 3} />
						{#each nights as r, i (r.day)}
							{@const x0 = GRID_L + i * colW}
							{@const s = r.short?.[a.id] ?? {}}
							{@const dead = r.health?.[a.id] === 0}
							{@const missing = goods.filter((g) => s[g])}
							<g role="presentation" onpointerenter={() => (cell = { a, r })}>
								<rect x={x0} y={j * ROW_H} width={colW} height={ROW_H} fill="transparent" />
								{#if dead}
									<rect x={x0 + colW * 0.15} y={(j + 1) * ROW_H - 6} width={Math.max(1, colW * 0.7)} height="2" fill="#b9b6ae" />
								{:else if missing.length}
									{@const unit = (ROW_H - 6) / worst}
									{#each missing as g, k (g)}
										{@const below = missing.slice(0, k).reduce((n, h) => n + s[h], 0)}
										<rect x={x0 + colW * 0.15} y={(j + 1) * ROW_H - 3 - (below + s[g]) * unit} width={Math.max(1, colW * 0.7)} height={s[g] * unit} fill={GOOD_COLOUR[g]} />
									{/each}
								{:else}
									<rect x={x0 + colW * 0.15} y={(j + 1) * ROW_H - 6} width={Math.max(1, colW * 0.7)} height="3" fill="#4fb37a" />
								{/if}
							</g>
						{/each}
					{/each}
					{#each nights as r, i (r.day)}
						{#if nights.length <= 12 || r.day % Math.ceil(nights.length / 10) === 0}<text class="tick" x={GRID_L + (i + 0.5) * colW} y={crew.length * ROW_H + 13} text-anchor="middle">{r.day}</text>{/if}
					{/each}
				</svg>
				{#if cell}
					{@const s = cell.r.short?.[cell.a.id] ?? {}}
					{@const ate = cell.r.ate?.[cell.a.id] ?? {}}
					<div class="tip">
						<b>{cell.a.name}, night {cell.r.day}{cell.r.dry ? ' · dry spell' : ''}</b>
						{#if cell.r.health?.[cell.a.id] === 0}<span>dead</span>{:else}
							{#each GOODS as g (g)}<span><i style:--c={GOOD_COLOUR[g]}></i>{GOOD_LABEL[g]} <b>{ate[g] ?? 0} of {NEED[g]}{s[g] ? `, short ${s[g]}` : ''}</b></span>{/each}
							<span>reserves <b>water {cell.r.body?.[cell.a.id]?.water} · food {cell.r.body?.[cell.a.id]?.food}</b></span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#if chartsOn.trades}
			<LineChart title="Units traded a day" unit="units" note="{fmt(deals)} deals in this range" lines={perGood('units', nights)} {from} {to} {shade} />
		{/if}
		{#if chartsOn.hearts}
			<LineChart title="HEARTS per aven" unit="HEARTS" lines={perAven((r, id) => r.hearts[id])} {from} {to} {shade} />
		{/if}
		{#if chartsOn.money}
			<LineChart title="HEARTS in the valley" unit="HEARTS" note="All balances together: grows by the mint, shrinks by decay" lines={[{ key: 'total', label: 'All avens', colour: TOTAL, pts: rows.map((r) => ({ x: r.day, y: r.total })) }]} {from} {to} {shade} />
		{/if}
		{#if chartsOn.policy}
			<LineChart title="Minted and decayed a night" unit="HEARTS a night" lines={[{ key: 'mint', label: 'Minted', colour: MINT, pts: nights.map((r) => ({ x: r.day, y: r.minted })) }, { key: 'decay', label: 'Decayed', colour: DECAY, pts: nights.map((r) => ({ x: r.day, y: r.decayed })) }]} {from} {to} {shade} />
		{/if}
		{#if chartsOn.eaten}
			<LineChart title="Eaten and drunk a night" unit="units of the {needOf} needed" lines={perAven((r, id) => (r.health?.[id] === 0 ? null : unitsIn(r, 'ate', id)), nights)} {from} {to} {shade} />
		{/if}
		{#if chartsOn.short}
			<LineChart title="Gone short a night" unit="units missing" lines={perAven((r, id) => (r.health?.[id] === 0 ? null : unitsIn(r, 'short', id)), nights)} {from} {to} {shade} />
		{/if}
		{#if chartsOn.body}
			<LineChart max={100} title="Water reserve" unit="0–100, dies at 0" note="No water at all: lives 2 days, dies on the 3rd" lines={perAven((r, id) => r.body?.[id]?.water ?? null, nights)} {from} {to} {shade} />
			<LineChart max={100} title="Food reserve" unit="0–100, dies at 0" note="No food at all: lives 21 days" lines={perAven((r, id) => r.body?.[id]?.food ?? null, nights)} {from} {to} {shade} />
		{/if}
		{#if chartsOn.harvest}
			<LineChart title="Harvested a night" unit="units" note="WATER includes the rain barrels" lines={perGood('harvest', nights)} {from} {to} {shade} />
		{/if}
		{#if chartsOn.stock}
			<LineChart title="In store across the valley" unit="units" lines={perGood('stock')} {from} {to} {shade} />
		{/if}
		{#if chartsOn.rot}
			<LineChart title="Rotted a night" unit="units" lines={perGood('rotted', nights)} {from} {to} {shade} />
		{/if}
	</div>
</div>

<style>
	.stats {
		height: 100%;
		overflow-y: auto;
		background: #f4f1e8;
		color: #1f2a23;
		padding: 0.8rem 1rem var(--nav-room, 6rem);
		box-sizing: border-box;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}
	.cards div {
		background: #fff;
		border-radius: 10px;
		padding: 0.45rem 0.7rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		display: flex;
		flex-direction: column;
	}
	.cards span {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.cards b {
		font-size: 1.15rem;
		font-variant-numeric: tabular-nums;
	}
	.up {
		color: #2f7d4f;
	}
	.down {
		color: #c2410c;
	}
	.controls {
		margin: 0.8rem 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.lab {
		width: 3.6rem;
		font-size: 0.75rem;
		color: #6b6a66;
	}
	.chip {
		font: inherit;
		font-size: 0.75rem;
		border: 1px solid #1f2a2326;
		background: #fff;
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		cursor: pointer;
		opacity: 0.55;
		display: inline-flex;
		align-items: center;
	}
	.chip.on {
		opacity: 1;
		border-color: #24452f;
		box-shadow: inset 0 0 0 1px #24452f;
	}
	.chip.dead {
		font-style: italic;
	}
	i {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 0.3rem;
		background: var(--c);
	}
	.empty {
		font-size: 0.85rem;
		color: #6b6a66;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
		gap: 0.7rem;
	}
	.grid > :global(*) {
		min-width: 0;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.daily {
		background: #fff;
		border-radius: 12px;
		padding: 0.6rem 0.8rem 0.4rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
		max-height: 360px;
		display: flex;
		flex-direction: column;
	}
	.daily .head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 0.85rem;
	}
	.daily .head span,
	.daily .note {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.daily .note {
		margin: 0.15rem 0 0.3rem;
	}
	.daily .scroll {
		overflow: auto;
		min-height: 0;
	}
	.daily table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.daily th {
		position: sticky;
		top: 0;
		background: #fff;
		text-align: right;
		font-weight: 600;
		color: #52514e;
		padding: 0.2rem 0.4rem;
		white-space: nowrap;
	}
	.daily th:first-child,
	.daily td:first-child {
		text-align: left;
	}
	.daily td {
		text-align: right;
		padding: 0.15rem 0.4rem;
		border-top: 1px solid #1f2a2312;
		white-space: nowrap;
	}
	.daily small {
		font-size: 0.65rem;
	}
	.dryrow {
		background: #f0a03c18;
	}
	.meals {
		position: relative;
		background: #fff;
		border-radius: 12px;
		padding: 0.6rem 0.5rem 0.3rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
		min-width: 0;
	}
	.meals .head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0 0.3rem;
		font-size: 0.85rem;
	}
	.meals .head span,
	.meals .note {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.meals .note {
		margin: 0.15rem 0.3rem 0.4rem;
	}
	.meals svg {
		display: block;
	}
	.who {
		font-size: 11px;
		font-weight: 700;
	}
	.base {
		stroke: #1f2a2314;
	}
	.dryband {
		fill: #f0a03c22;
	}
	.tick {
		font-size: 10px;
		fill: #6b6a66;
	}
	.tip {
		position: absolute;
		right: 0.6rem;
		top: 0.5rem;
		width: 190px;
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
	.tip i {
		border-radius: 2px;
	}
	@media (max-width: 760px) {
		.stats {
			padding: 0.6rem 0.6rem var(--nav-room, 6rem);
		}
		.grid {
			grid-template-columns: 1fr;
		}
		.cards {
			grid-template-columns: repeat(4, 1fr);
			gap: 0.3rem;
		}
		.cards div {
			padding: 0.3rem 0.4rem;
		}
		.cards span {
			font-size: 0.6rem;
		}
		.cards b {
			font-size: 0.9rem;
		}
		.lab {
			width: 100%;
		}
	}
</style>
