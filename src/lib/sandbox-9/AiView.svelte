<!--
	Sandbox 8 · the AI tab: the avenCEO AI market, year by year. Who owns the accelerators (each settlement COOP and the
	Village COOP, in the data halls of their utility domes) and how many; the inference they sold to the AI COOPs
	(avenCEO and any rival) and its price; the Aven hours a person a day by tenth of holdings, split into help for the
	person and work for the COOPs; each tenth's MIND income by source (the HEARTS half, Aven work items, dividends); the
	accelerators imported and their euros; and what bound the Aven service.
-->
<script>
	// @ts-nocheck — plain JS
	import { num } from './params.js';

	/** worlds: one AI record per world (./params.js aiOf) · names · sub · running: as ./ImportsView.svelte */
	let { worlds = [], names = ['Base', 'Changed'], sub = [], running = false } = $props();

	const list = $derived(worlds.map((w, j) => (w ? { ...w, name: names[j] ?? `World ${j + 1}`, sub: sub[j] ?? '', j } : null)).filter(Boolean));
	const two = $derived(list.length > 1);
	let pick = $state(0);
	const w = $derived(list.find((x) => x.j === pick) ?? list[0] ?? null);

	const eur = (x) => (x == null || !Number.isFinite(x) ? '–' : `€${num(x)}`);
	const h = (x) => (x == null || !Number.isFinite(x) ? '–' : num(x, 2));
	const r = (x) => (x == null || !Number.isFinite(x) ? '–' : num(x, 3));
	const pc = (x) => (x == null || !Number.isFinite(x) ? '–' : `${num(100 * x, 2)} %`);
	/** the last whole year of a world (or the year so far) */
	const lastOf = (x) => x?.years?.findLast?.((y) => !y.partial) ?? x?.years?.at(-1) ?? null;
	const ownersAt = (x, y) =>
		(x?.owners ?? [])
			.map((o) => ({ ...o, chips: y?.byOwner?.[o.id]?.chips ?? 0 }))
			.filter((o) => o.chips > 0.5)
			.map((o) => `${o.label} ${num(o.chips, 2)}`)
			.join(', ');
	const hasExport = $derived((w?.years ?? []).some((y) => (y.export?.AHDay ?? 0) > 0 || (y.export?.eur ?? 0) > 0));
	const hasRivals = $derived((w?.years ?? []).some((y) => (y.aiCoops ?? []).length > 1));

	/** the year the tenth table shows: picked, or the last whole year */
	let yearPick = $state(/** @type {number | null} */ (null));
	const marks = $derived.by(() => {
		const ys = (w?.years ?? []).map((y) => y.y);
		const want = [1, 2, 5, 10, 20, 30, 60].filter((y) => ys.includes(y));
		const last = lastOf(w)?.y;
		if (last != null && !want.includes(last)) want.push(last);
		return want;
	});
	const yrow = $derived((w?.years ?? []).find((y) => y.y === (yearPick ?? lastOf(w)?.y)) ?? lastOf(w));
	const TENTH_NAMES = ['1 (poorest)', '2', '3', '4', '5', '6', '7', '8', '9', '10 (richest)'];
	const incomeOf = (t) => (t ? (t.hearts ?? 0) + (t.work ?? 0) + (t.div ?? 0) : NaN);
</script>

<div class="ai">
	{#if !list.length}
		<p class="fine">{running ? 'The AI market’s ledger fills in as the run goes: press Run.' : 'No AI-market record in this run.'}</p>
	{:else}
		<div class="heads">
			{#each list as x (x.j)}
				{@const y = lastOf(x)}
				<section class="head w{x.j}">
					{#if two}<h4>{x.name}{x.sub ? `: ${x.sub}` : ''}</h4>{/if}
					{#if y}
						<p><b>Accelerators</b> {y.partial ? `in year ${y.y} so far` : `at the end of year ${y.y}`}: {num(y.chips ?? 0, 2)}{ownersAt(x, y) ? `, in the data halls of ${ownersAt(x, y)}` : ''}.</p>
						<p><b>Inference sold</b> to the AI COOPs: {num(y.AHDay ?? 0)} accelerator-hours a day at {r(y.inferPriceR)} R each, {pc(y.utilization)} of what the halls could serve.</p>
						<p><b>Aven service</b> a person a day: {h(y.all?.helpH)} h of help and {h(y.all?.workH)} h of work for the COOPs; the poorest tenth {h(y.tenths?.[0]?.helpH)} h and {h(y.tenths?.[0]?.workH)} h.</p>
						<p><b>What bound it</b> most days: {y.bind?.words ?? '–'}{y.bind?.share != null ? ` (${pc(y.bind.share)} of days)` : ''}.</p>
						{#if (y.export?.eur ?? 0) > 0}<p><b>Sold abroad</b> (AI exports): {num(y.export.AHDay)} accelerator-hours a day, {eur(y.export.eur)} that year.</p>{/if}
					{/if}
				</section>
			{/each}
		</div>

		{#if two}
			<div class="worlds" role="group" aria-label="World">
				{#each list as x (x.j)}<button class="w{x.j}" class:on={pick === x.j} onclick={() => (pick = x.j)}>{x.name}</button>{/each}
			</div>
		{/if}

		<h4 class="sub">Year by year: accelerators, inference and Aven hours</h4>
		{#if w?.years?.length}
			<div class="scroll tall">
				<table>
					<thead>
						<tr>
							<th class="l">Year</th>
							<th>People</th>
							<th>Accel&shy;erators<small>at year end</small></th>
							<th>Imported<small>accelerators · €</small></th>
							<th>Capacity<small>accelerator-h a day</small></th>
							<th>Inference sold<small>accelerator-h a day</small></th>
							<th>Inference price<small>R an accelerator-h</small></th>
							<th>Help<small>Aven h a person a day</small></th>
							<th>Work<small>Aven h a person a day</small></th>
							<th>COOP work<small>h a day asked · done</small></th>
							<th class="l">What bound the Aven service</th>
							{#if hasExport}<th>Sold abroad<small>accelerator-h a day · €</small></th>{/if}
						</tr>
					</thead>
					<tbody>
						{#each w.years as y (y.y)}
							<tr>
								<td class="l">{y.y}{#if y.partial}<small>so far</small>{/if}</td>
								<td>{num(y.people ?? NaN)}</td>
								<td title={ownersAt(w, y)}>{num(y.chips ?? NaN, 2)}</td>
								<td>{num(y.imported?.n ?? 0, 2)}<small>{eur(y.imported?.eur ?? 0)}</small></td>
								<td>{num(y.capAHDay ?? NaN)}</td>
								<td>{num(y.AHDay ?? NaN)}<small>{pc(y.utilization)}</small></td>
								<td>{r(y.inferPriceR)}</td>
								<td>{h(y.all?.helpH)}</td>
								<td>{h(y.all?.workH)}</td>
								<td>{num((y.work?.runNeedDay ?? 0) + (y.work?.propNeedDay ?? 0))}<small>{num(y.work?.hoursDay ?? NaN)}</small></td>
								<td class="l why">{y.bind?.words ?? '–'}{#if y.bind?.share != null}<small>{pc(y.bind.share)} of days</small>{/if}</td>
								{#if hasExport}<td>{num(y.export?.AHDay ?? 0)}<small>{eur(y.export?.eur ?? 0)}</small></td>{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<h4 class="sub">By tenth of MIND holdings: Aven hours and income</h4>
			<div class="years" role="group" aria-label="Year">
				{#each marks as y}<button class:on={yrow?.y === y} onclick={() => (yearPick = y)}>Year {y}</button>{/each}
			</div>
			{#if yrow}
				<div class="scroll narrow">
					<table>
						<thead>
							<tr>
								<th class="l">Tenth</th>
								<th>Help<small>Aven h a day</small></th>
								<th>Work<small>Aven h a day</small></th>
								<th>HEARTS half<small>R a day</small></th>
								<th>Work items<small>R a day</small></th>
								<th>Dividends<small>R a day</small></th>
								<th>All income<small>R a day</small></th>
							</tr>
						</thead>
						<tbody>
							{#each yrow.tenths as t, i}
								<tr>
									<td class="l">{TENTH_NAMES[i]}</td>
									<td>{h(t?.helpH)}</td>
									<td>{h(t?.workH)}</td>
									<td>{h(t?.hearts)}</td>
									<td>{h(t?.work)}</td>
									<td>{h(t?.div)}</td>
									<td>{h(incomeOf(t))}</td>
								</tr>
							{/each}
							{#if yrow.all}
								<tr class="total">
									<td class="l">Everyone</td>
									<td>{h(yrow.all.helpH)}</td>
									<td>{h(yrow.all.workH)}</td>
									<td>{h(yrow.all.hearts)}</td>
									<td>{h(yrow.all.work)}</td>
									<td>{h(yrow.all.div)}</td>
									<td>{h(incomeOf(yrow.all))}</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
				<p class="fine">Year {yrow.y}{yrow.partial ? ' so far' : ''}: each tenth’s yearly mean a person, people sorted by what they hold. The HEARTS half is the MIND a person’s own 24 HEARTS make each day; work items are what the COOPs paid their Aven for running items and work proposals, by skill × hours delivered; dividends are Law 5’s fifth of every sale in the MINDs they hold. No wages, no basic income.</p>
			{/if}

			{#if w.owners?.length}
				<details>
					<summary>Who owns the accelerators, year by year</summary>
					<div class="scroll tall">
						<table>
							<thead><tr><th class="l">Year</th>{#each w.owners as o}<th>{o.label}<small>accelerators</small></th>{/each}</tr></thead>
							<tbody>
								{#each w.years as y (y.y)}
									<tr>
										<td class="l">{y.y}</td>
										{#each w.owners as o}{@const b = y.byOwner?.[o.id]}<td>{num(b?.chips ?? 0, 2)}{#if b?.AHDay > 0}<small>{num(b.AHDay)} h a day · {r(b.priceR)} R</small>{/if}</td>{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
			{#if hasRivals}
				<details>
					<summary>The AI COOPs selling Aven service, year by year</summary>
					<div class="scroll tall">
						<table>
							<thead><tr><th class="l">Year</th><th class="l">COOP: Aven hours a day · R an hour</th></tr></thead>
							<tbody>
								{#each w.years as y (y.y)}
									<tr><td class="l">{y.y}</td><td class="l">{(y.aiCoops ?? []).map((c) => `${c.label}: ${num(c.hoursDay)} · ${r(c.priceR)}`).join('; ') || '–'}</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
		{:else}
			<p class="fine">{running ? 'The first year fills in as the run goes.' : 'No yearly AI ledger in this record.'}</p>
		{/if}
		<p class="fine">The settlement COOPs and the Village COOP own the accelerators, in the data halls of their utility domes, run them on their own power and buy them through the euro border (the MaiaCity COOP’s bank advances the euros; they pay back in their own MIND). They sell inference by the accelerator-hour to the AI COOPs, avenCEO first; avenCEO runs the harnesses and sells Aven service to the people, who pay in any MIND (the seller receives only its own MIND; Law 5 pays a fifth to its holders). A person’s Aven spends its hours on help for its person, bought from what the person holds, and on work items for the COOPs, whose pay settles the hours’ Aven service first; the person gets the rest, so nobody needs MIND in hand before their Aven can work.</p>
	{/if}
</div>

<style>
	.ai {
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
	.worlds,
	.years {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.worlds button,
	.years button {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 0.76rem;
		padding: 0.2rem 0.75rem;
		cursor: pointer;
		color: var(--ink);
	}
	.worlds button.on.w0,
	.years button.on {
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
		max-width: min(100%, 44rem);
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
	td.l {
		white-space: normal;
		min-width: 5rem;
	}
	td.why {
		min-width: 10rem;
	}
	tr.total td {
		font-weight: 700;
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
