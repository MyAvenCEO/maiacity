<!--
	Sandbox 8 · the clean live charts under the two fields (world model 7.2), the base world in blue and the world with
	the one rule changed in orange, every number read from the running worlds (./view.js):
	  - population, and people short of a basic;
	  - the poorest tenth's living standard, with the dashed physics ceiling;
	  - who owns the MIND: people, COOP treasuries, the pools;
	  - energy a person next to the living standard of each tenth;
	  - where the energy goes: from the harvest to the basics, the works, building, R&D, storage, curtailment, losses;
	  - who keeps the surplus of each basic: buyers or sellers.
-->
<script>
	// @ts-nocheck — plain JS
	import LineChart from './LineChart.svelte';

	/**
	 * @type {{ pts: { base: any[], changed: any[] }, panel: { base: any, changed: any } | null, xMax: number, bands?: any[],
	 *   names: { base: string, changed: string }, version: number }}
	 */
	let { pts, panel, xMax, bands = [], names, version } = $props();

	const BASE = '#2a78d6', CHANGED = '#eb6834';
	const OWN = [
		{ key: 'people', label: 'People', color: '#2a78d6' },
		{ key: 'treasuries', label: 'COOP treasuries', color: '#eb6834' },
		{ key: 'pools', label: 'Pools', color: '#1baf7a' }
	];
	const USE = [
		{ key: 'basics', label: 'Basics', color: '#2a78d6' },
		{ key: 'running', label: 'Works and extras', color: '#eb6834' },
		{ key: 'building', label: 'Building', color: '#1baf7a' },
		{ key: 'R&D', label: 'R&D', color: '#eda100' },
		{ key: 'storage', label: 'Into storage', color: '#e87ba4' },
		{ key: 'curtailed', label: 'Curtailed', color: '#9a9a94' },
		{ key: 'losses', label: 'Losses', color: '#6250d6' }
	];
	const BASICS = ['Food', 'Water', 'Energy', 'A bed'];

	// time series: rebuilt when a batch of points arrives (version)
	const series = $derived.by(() => {
		void version;
		const map = (/** @type {any[]} */ a, /** @type {string} */ k) => a.map((p) => [p.d, p[k]]);
		return {
			N: [
				{ name: names.base, color: BASE, points: map(pts.base, 'N') },
				{ name: names.changed, color: CHANGED, points: map(pts.changed, 'N') }
			],
			short: [
				{ name: names.base, color: BASE, points: map(pts.base, 'short') },
				{ name: names.changed, color: CHANGED, points: map(pts.changed, 'short') }
			],
			poor: [
				{ name: `${names.base}: poorest tenth`, color: BASE, points: map(pts.base, 'poorL') },
				{ name: `${names.changed}: poorest tenth`, color: CHANGED, points: map(pts.changed, 'poorL') },
				{ name: `${names.base}: physics ceiling`, color: BASE, dash: true, points: map(pts.base, 'ceil') },
				{ name: `${names.changed}: physics ceiling`, color: CHANGED, dash: true, points: map(pts.changed, 'ceil') }
			],
			own: [
				{ name: names.base, color: BASE, points: map(pts.base, 'people').map(([d, v]) => [d, 100 * v]) },
				{ name: names.changed, color: CHANGED, points: map(pts.changed, 'people').map(([d, v]) => [d, 100 * v]) }
			]
		};
	});
	const lastShort = $derived({ base: pts.base.at(-1)?.short ?? 0, changed: pts.changed.at(-1)?.short ?? 0 });
	const decMax = $derived(panel ? Math.max(1e-9, ...panel.base.deciles.L, ...panel.changed.deciles.L) : 1);
	const kwhMax = $derived(panel ? Math.max(1e-9, ...panel.base.deciles.kwh, ...panel.changed.deciles.kwh) : 1);
	const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(0)} %`;
	const f1 = (/** @type {number} */ x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)) : '–');
	/** where the energy goes, in kWh a person a day */
	const useTotal = (/** @type {any} */ e) => USE.reduce((a, u) => a + (e[u.key] ?? 0), 0);
</script>

<div class="charts">
	<section class="card">
		<LineChart title="Population" unit="people" series={series.N} {xMax} {bands} fmt={(v) => v.toFixed(0)} height={90} />
		<LineChart title="People short of a basic (below 98 % of food, water, energy or a bed)" unit="people on the worst day" series={series.short} {xMax} {bands} yMin={0} fmt={(v) => v.toFixed(0)} height={90} />
		<p class="note">Nobody dies in this world unless they go short; today {lastShort.base} short in {names.base}, {lastShort.changed} in {names.changed}.</p>
	</section>

	<section class="card">
		<LineChart title="The poorest tenth’s living standard" unit="R a day at day-0 prices" series={series.poor} {xMax} {bands} />
		<p class="note">What the tenth holding least consumed, valued at day-0 prices. Dashed: the physics ceiling, the most a person could get from today’s plants, land, energy and recipes.</p>
	</section>

	<section class="card">
		<LineChart title="People’s share of all MIND" unit="%" series={series.own} {xMax} {bands} fmt={(v) => v.toFixed(0)} height={110} />
		{#if panel}
			{#each [['base', names.base], ['changed', names.changed]] as [w, label]}
				<div class="stack-row">
					<span class="who">{label}</span>
					<div class="stack" role="img" aria-label="Who owns the MIND in {label}">
						{#each OWN as o}
							{@const v = panel[w].ownership[o.key]}
							{#if v > 0.001}<i style:flex-grow={v} style:background={o.color} title="{o.label}: {pct(v)}"></i>{/if}
						{/each}
					</div>
				</div>
			{/each}
			<ul class="legend">{#each OWN as o}<li><i style:background={o.color}></i>{o.label}: {pct(panel.base.ownership[o.key])} · {pct(panel.changed.ownership[o.key])}</li>{/each}</ul>
		{/if}
	</section>

	{#if panel}
		<section class="card">
			<h4>Living standard of each tenth, by holdings <small>· last 30 days</small></h4>
			<div class="bars" role="img" aria-label="Living standard by tenth">
				{#each panel.base.deciles.L as v, x}
					{@const c = panel.changed.deciles.L[x]}
					<div class="pair">
						<i style:height="{(100 * v) / decMax}%" style:background={BASE} title="{names.base}, tenth {x + 1}: {f1(v)} R a day"></i>
						<i style:height="{(100 * c) / decMax}%" style:background={CHANGED} title="{names.changed}, tenth {x + 1}: {f1(c)} R a day"></i>
					</div>
				{/each}
			</div>
			<div class="axis"><span>poorest</span><span>tenths by holdings</span><span>richest</span></div>
			<h4>Energy each tenth uses at home <small>· kWh a person a day</small></h4>
			<div class="bars short" role="img" aria-label="Energy by tenth">
				{#each panel.base.deciles.kwh as v, x}
					{@const c = panel.changed.deciles.kwh[x]}
					<div class="pair">
						<i style:height="{(100 * v) / kwhMax}%" style:background={BASE} title="{names.base}, tenth {x + 1}: {f1(v)} kWh"></i>
						<i style:height="{(100 * c) / kwhMax}%" style:background={CHANGED} title="{names.changed}, tenth {x + 1}: {f1(c)} kWh"></i>
					</div>
				{/each}
			</div>
			<p class="note">All electricity used, works and R&D included: {f1(panel.base.ePP)} kWh a person a day in {names.base}, {f1(panel.changed.ePP)} in {names.changed}.</p>
			<ul class="legend"><li><i style:background={BASE}></i>{names.base}</li><li><i style:background={CHANGED}></i>{names.changed}</li></ul>
		</section>

		<section class="card">
			<h4>Where the energy goes <small>· kWh a person a day, last 30 days</small></h4>
			{#each [['base', names.base], ['changed', names.changed]] as [w, label]}
				{@const e = panel[w].energy}
				<p class="src">{label}: sun {f1(e.solar)} · geothermal {f1(e.geo)} · from the battery {f1(e.battery)}</p>
				<div class="stack" role="img" aria-label="Where the energy goes in {label}">
					{#each USE as u}
						{@const v = e[u.key] ?? 0}
						{#if v > useTotal(e) * 0.004}<i style:flex-grow={v} style:background={u.color} title="{u.label}: {f1(v)} kWh"></i>{/if}
					{/each}
				</div>
			{/each}
			<ul class="legend">{#each USE as u}<li><i style:background={u.color}></i>{u.label}</li>{/each}</ul>
		</section>

		<section class="card">
			<h4>Who keeps the surplus of each basic <small>· last 30 days</small></h4>
			{#each panel.base.surplus as s, b}
				{@const c = panel.changed.surplus[b]}
				<div class="sur">
					<span class="good">{BASICS[b]}</span>
					{#each [[s, names.base], [c, names.changed]] as [x, label]}
						{@const tot = x.buyers + x.sellers}
						<div class="stack thin" title="{label}: buyers {tot > 0 ? pct(x.buyers / tot) : '–'}, sellers {tot > 0 ? pct(x.sellers / tot) : '–'}">
							{#if tot > 0}
								<i style:flex-grow={x.buyers} style:background="#2a78d6"></i>
								<i style:flex-grow={x.sellers} style:background="#eb6834"></i>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
			<p class="note">Each row: {names.base} above, {names.changed} below. Buyers keep what each person could have paid above the price (their limit less the price); sellers keep the price less their variable cost.</p>
			<ul class="legend"><li><i style:background="#2a78d6"></i>Buyers</li><li><i style:background="#eb6834"></i>Sellers</li></ul>
		</section>
	{/if}
</div>

<style>
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 0.7rem;
	}
	.card {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0.6rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	h4 {
		margin: 0.1rem 0 0;
		font-size: 0.82rem;
		font-weight: 600;
		font-family: var(--font-body);
		letter-spacing: 0;
	}
	h4 small {
		font-weight: 400;
		color: var(--muted);
	}
	.note,
	.src {
		margin: 0;
		font-size: 0.72rem;
		color: var(--ink-soft);
		line-height: 1.4;
	}
	.stack-row {
		display: grid;
		grid-template-columns: 4.5rem 1fr;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.72rem;
	}
	.who {
		color: var(--ink-soft);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.stack {
		display: flex;
		gap: 2px;
		height: 14px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--cream);
	}
	.stack.thin {
		height: 8px;
	}
	.stack i {
		display: block;
		flex-basis: 0;
		min-width: 2px;
	}
	.bars {
		display: grid;
		grid-template-columns: repeat(10, 1fr);
		gap: 4px;
		height: 80px;
		align-items: end;
		border-bottom: 1px solid var(--line);
	}
	.bars.short {
		height: 46px;
	}
	.pair {
		display: flex;
		gap: 2px;
		height: 100%;
		align-items: flex-end;
	}
	.pair i {
		flex: 1;
		border-radius: 3px 3px 0 0;
		min-height: 1px;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.66rem;
		color: var(--muted);
	}
	.sur {
		display: grid;
		grid-template-columns: 3.4rem 1fr;
		grid-template-rows: auto auto;
		column-gap: 0.4rem;
		row-gap: 2px;
		align-items: center;
		font-size: 0.72rem;
	}
	.sur .good {
		grid-row: span 2;
		color: var(--ink-soft);
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.8rem;
		font-size: 0.7rem;
		color: var(--ink-soft);
	}
	.legend i {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		margin-right: 0.3rem;
		vertical-align: -1px;
	}
</style>
