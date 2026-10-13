<!--
	Sandbox 8 · the Imports tab: what the village has to buy abroad to stand and to eat until its food forest bears.
	First the founding bill (what was imported before day 0 to build the village, in tonnes and euros by material), then
	year by year what came in through the euro border (food, materials, accelerators), what it cost, what the exports
	earned and the euro reserve that pays for it. The year the village first feeds itself and the year its exports first
	pay for all its imports are marked. COOP trade only: no person redeems MIND, and no MIND is made from euros.
-->
<script>
	// @ts-nocheck — plain JS
	import { num } from './params.js';

	/** worlds: one import record per world (./params.js importsOf) · names · sub · running: as ./LivingView.svelte */
	let { worlds = [], names = ['Base', 'Changed'], sub = [], running = false } = $props();

	const list = $derived(worlds.map((w, j) => (w ? { ...w, name: names[j] ?? `World ${j + 1}`, sub: sub[j] ?? '', j } : null)).filter(Boolean));
	const two = $derived(list.length > 1);
	let pick = $state(0);
	const w = $derived(list.find((x) => x.j === pick) ?? list[0] ?? null);

	const eur = (x) => (x == null || !Number.isFinite(x) ? '–' : `€${num(x)}`);
	const t = (x) => (x == null || !Number.isFinite(x) ? '–' : `${num(x)} t`);
	/** every item that ever came in (food, each material, solar, accelerators), in the order the ledger lists them */
	const items = $derived.by(() => {
		const seen = new Map();
		for (const r of w?.years ?? []) for (const it of r.items ?? []) if ((it.q > 0 || it.eur > 0) && !seen.has(it.id)) seen.set(it.id, { id: it.id, label: it.label, unit: it.unit });
		return [...seen.values()];
	});
	const itemOf = (r, id) => (r.items ?? []).find((x) => x.id === id) ?? null;
	const hasSolar = $derived((w?.years ?? []).some((r) => r.solarKwp > 0));
	/** a founding row's amount: tonnes, or kWp or units when the row is not in tonnes */
	const qty = (c) => (c == null ? '–' : Number.isFinite(c.t) ? num(c.t) : Number.isFinite(c.kwp) ? `${num(c.kwp)} kWp` : Number.isFinite(c.n) ? `${num(c.n)}` : '–');
	const sumT = (r) => r.materialsT ?? Object.values(r.materials ?? {}).reduce((a, v) => a + (v || 0), 0);
	const when = (y, done) => (y != null ? `year ${y}` : done ? 'not within the run' : 'not yet');
	/** the founding bills of the worlds differ (the tower experiment) */
	const billsDiffer = $derived(two && JSON.stringify(list[0].founding ?? null) !== JSON.stringify(list[1].founding ?? null));
	const billRows = $derived.by(() => {
		const keys = [];
		for (const x of list) for (const r of x.founding?.rows ?? []) if (!keys.includes(r.label)) keys.push(r.label);
		return keys.map((label) => ({ label, of: list.map((x) => (x.founding?.rows ?? []).find((r) => r.label === label) ?? null) }));
	});
</script>

<div class="imports">
	{#if !list.length}
		<p class="fine">{running ? 'The import ledger fills in as the run goes: press Run.' : 'No import ledger in this record.'}</p>
	{:else}
		<div class="heads">
			{#each list as x (x.j)}
				<section class="head w{x.j}">
					{#if two}<h4>{x.name}{x.sub ? `: ${x.sub}` : ''}</h4>{/if}
					<p><b>Founding bill:</b> {eur(x.founding?.eur)}{x.founding?.t != null ? `, ${t(x.founding.t)} of materials` : ''}, imported before day 0.</p>
					<p><b>Feeds itself:</b> {when(x.selfFedYear, !running)}{x.selfFedYear != null ? ': the first year with no food imported' : ''}.</p>
					<p><b>Exports pay all imports:</b> {when(x.exportsPayYear, !running)}{x.exportsPayYear != null ? ': the first year exports earned at least what imports cost' : ''}.</p>
					{#if x.years?.length}
						{@const last = x.years.at(-1)}
						<p><b>Euro reserve</b> {last.partial ? `in year ${last.y} so far` : `at the end of year ${last.y}`}: <span class:neg={last.reserveEur < 0}>{eur(last.reserveEur)}</span>{x.reserve0 != null ? ` (it started at ${eur(x.reserve0)})` : ''}.</p>
					{/if}
					{#if x.runOut != null}<p class="bad">The euro reserve ran out in year {x.runOut}: from then on the village could buy abroad only what its exports paid for.</p>{/if}
				</section>
			{/each}
		</div>

		{#if billRows.length}
			<h4 class="sub">The founding bill: imported to build the village</h4>
			<div class="scroll narrow">
				<table>
					<thead>
						<tr>
							<th class="l">Material</th>
							{#if billsDiffer}{#each list as x (x.j)}<th class="w{x.j}">{x.name}<small>t</small></th><th class="w{x.j}">{x.name}<small>€</small></th>{/each}{:else}<th>Amount<small>t, unless it says</small></th><th>Euros</th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each billRows as r}
							<tr>
								<td class="l">{r.label}</td>
								{#each billsDiffer ? r.of : r.of.slice(0, 1) as c}<td>{qty(c)}</td><td>{eur(c?.eur)}</td>{/each}
							</tr>
						{/each}
						<tr class="total">
							<td class="l">All</td>
							{#each billsDiffer ? list : list.slice(0, 1) as x (x.j)}<td>{x.founding?.t ? `${num(x.founding.t)} t` : '–'}</td><td>{eur(x.founding?.rowsEur)}</td>{/each}
						</tr>
					</tbody>
				</table>
			</div>
			{#each billsDiffer ? list : list.slice(0, 1) as x (x.j)}
				{#if Number.isFinite(x.founding?.eur) && Math.abs(x.founding.eur - (x.founding.rowsEur ?? 0)) > 1}
					<p class="fine">{billsDiffer ? `${x.name}: ` : ''}the whole founding, with these, comes to {eur(x.founding.eur)}{x.reserve0 != null ? `; ${eur(x.reserve0)} of the founding euros is left in the reserve on day 0` : ''}.</p>
				{/if}
			{/each}
			{#if list[0].founding?.note}<p class="fine">{list[0].founding.note}</p>{/if}
		{/if}

		<h4 class="sub">Year by year: through the euro border</h4>
		{#if two}
			<div class="worlds" role="group" aria-label="World">
				{#each list as x (x.j)}<button class="w{x.j}" class:on={pick === x.j} onclick={() => (pick = x.j)}>{x.name}</button>{/each}
			</div>
		{/if}
		{#if w?.years?.length}
			<div class="scroll tall">
				<table>
					<thead>
						<tr>
							<th class="l">Year</th>
							<th>Food in<small>kcal a person a day</small></th>
							<th>Materials in<small>t</small></th>
							{#if hasSolar}<th>Solar in<small>kWp</small></th>{/if}
							<th>Accel&shy;erators<small>bought</small></th>
							<th>Imports cost<small>€</small></th>
							<th>Exports earned<small>€</small></th>
							<th>Reserve<small>€ at year end</small></th>
						</tr>
					</thead>
					<tbody>
						{#each w.years as r (r.y)}
							<tr class:fed={r.y === w.selfFedYear} class:pays={r.y === w.exportsPayYear}>
								<td class="l">
									{r.y}{#if r.partial}<small>so far</small>{/if}
									{#if r.y === w.selfFedYear}<em class="tag fed">feeds itself</em>{/if}
									{#if r.y === w.exportsPayYear}<em class="tag pays">exports pay</em>{/if}
								</td>
								<td>{num(r.foodKcal ?? NaN)}{#if r.foodShare != null && Number.isFinite(r.foodShare)}<small>{num(100 * r.foodShare, 2)} % of food</small>{/if}</td>
								<td title={Object.entries(r.materials ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${num(v)} t`).join(', ')}>{num(sumT(r))}</td>
								{#if hasSolar}<td>{num(r.solarKwp ?? 0)}</td>{/if}
								<td>{num(r.accel ?? NaN)}</td>
								<td>{eur(r.importEur)}</td>
								<td>{eur(r.exportEur)}{#if Number.isFinite(r.exportKwh) && r.exportKwh > 0}<small>{num(r.exportKwh / 1000)} MWh</small>{/if}</td>
								<td class:neg={r.reserveEur <= 0}>{eur(r.reserveEur)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if items.length}
				<details>
					<summary>Every item by year: how much, and what it cost</summary>
					<div class="scroll tall">
						<table>
							<thead><tr><th class="l">Year</th>{#each items as it}<th>{it.label}<small>{it.unit || 'units'} · €</small></th>{/each}</tr></thead>
							<tbody>
								{#each w.years as r (r.y)}
									<tr>
										<td class="l">{r.y}</td>
										{#each items as it}{@const x = itemOf(r, it.id)}<td>{num(x?.q ?? 0)}<small>{eur(x?.eur ?? 0)}</small></td>{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
		{:else}
			<p class="fine">{running ? 'The first year fills in as the run goes.' : 'No yearly ledger in this record.'}</p>
		{/if}
		<p class="fine">COOP trade only: food COOPs buy food abroad, the works buy materials, COMPUTE buys accelerators, all from the shared euro reserve, which the founding euros left over and the exports (electricity, later goods) fill. No person redeems MIND, no MIND is made from euros, and HEARTS buy nothing.</p>
	{/if}
</div>

<style>
	.imports {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.heads {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
		gap: 0.5rem;
	}
	.head {
		background: var(--paper);
		border: 1px solid var(--line);
		border-left: 4px solid #2a78d6;
		border-radius: 12px;
		padding: 0.45rem 0.65rem;
		min-width: 0;
	}
	.head.w1 {
		border-left-color: #eb6834;
	}
	.head p {
		margin: 0.15rem 0;
		font-size: 0.78rem;
		color: var(--ink-soft);
		line-height: 1.4;
	}
	.head p b {
		color: var(--ink);
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: 0.84rem;
	}
	h4.sub {
		margin: 0.3rem 0 0;
	}
	.worlds {
		display: flex;
		gap: 0.25rem;
	}
	.worlds button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 0.76rem;
		padding: 0.2rem 0.75rem;
		cursor: pointer;
		color: var(--ink);
	}
	.worlds button.on.w0 {
		background: #2a78d6;
		border-color: #2a78d6;
		color: #fff;
	}
	.worlds button.on.w1 {
		background: #eb6834;
		border-color: #eb6834;
		color: #fff;
	}
	.scroll {
		overflow-x: auto;
		max-width: 100%;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
	}
	.scroll.narrow {
		max-width: min(100%, 40rem);
	}
	.scroll.tall {
		max-height: 26rem;
		overflow-y: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 0.76rem;
		width: 100%;
	}
	th {
		position: sticky;
		top: 0;
		background: var(--paper);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--muted);
		text-align: right;
		padding: 0.3rem 0.4rem;
		vertical-align: bottom;
		line-height: 1.2;
	}
	th small,
	td small {
		display: block;
		font-weight: 400;
		font-size: 0.62rem;
		color: var(--muted);
	}
	th.w0 {
		color: #1f5fae;
	}
	th.w1 {
		color: #c4521f;
	}
	td {
		text-align: right;
		padding: 0.25rem 0.4rem;
		border-top: 1px solid var(--line);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		vertical-align: top;
	}
	.l {
		text-align: left;
	}
	tr.total td {
		font-weight: 700;
	}
	tr.fed td {
		background: #e3f1e6;
	}
	tr.pays td {
		background: #e2eef8;
	}
	tr.fed.pays td {
		background: linear-gradient(90deg, #e3f1e6, #e2eef8);
	}
	.tag {
		display: inline-block;
		font-style: normal;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #fff;
		border-radius: 999px;
		padding: 0 0.35rem;
		margin-left: 0.25rem;
	}
	.tag.fed {
		background: #2f7d4f;
	}
	.tag.pays {
		background: #2a78d6;
	}
	.neg {
		color: #d03b3b;
		font-weight: 700;
	}
	.bad {
		color: #d03b3b !important;
	}
	details summary {
		cursor: pointer;
		font-size: 0.78rem;
		color: var(--ink-soft);
		margin-bottom: 0.3rem;
	}
	.fine {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.4;
	}
</style>
