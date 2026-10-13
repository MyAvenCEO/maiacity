<!--
	Sandbox 8 · the Living tab: how people actually live, in plain units, for the poorest tenth, the middle tenth and the
	richest tenth by MIND holdings, per person, year by year (yearly means): food and protein against the need, home,
	water, electricity, Aven help, goods, the warm ponds, and how many went short. Under it, the village that year: where
	its food came from, the energy it made and where it went, and what binds each good. The worlds' yearly records are
	read as the run goes ($lib/sandbox-9/lab.worker.js), or from proof.json on the Proof tab.
-->
<script>
	// @ts-nocheck — plain JS
	import { LIVING, TENTHS, num } from './params.js';

	/** the columns: the three tenths, then everyone */
	const COLS = [...TENTHS.map((t, i) => ({ ...t, get: (r) => r?.tenths?.[i] })), { id: 'all', label: 'Everyone', get: (r) => r?.all }];
	const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

	/**
	 * worlds: one living record per world (./params.js livingOf), null while it has no year yet · names: a short name
	 * per world · sub: what each world is, in a few words · running: the run goes on (the last year may be partial)
	 */
	let { worlds = [], names = ['Base', 'Changed'], sub = [], running = false, indoor = null } = $props();
	/** the indoor food forest at maturity by month, with and without LED light (kcal a person a day) */
	const indoorTop = $derived(indoor ? Math.max(1e-9, ...(indoor.withLight ?? []), ...(indoor.withoutLight ?? [])) : 1);

	const list = $derived(worlds.map((w, j) => (w ? { ...w, name: names[j] ?? `World ${j + 1}`, sub: sub[j] ?? '', j } : null)).filter(Boolean));
	const two = $derived(list.length > 1);
	/** the years any world has, in order */
	const years = $derived([...new Set(list.flatMap((w) => (w.years ?? []).map((r) => r.y)))].sort((a, b) => a - b));
	const KEY = [1, 2, 5, 10, 20, 30, 45, 60];
	const keys = $derived.by(() => {
		const k = KEY.filter((y) => years.includes(y));
		const last = years.at(-1);
		if (last != null && !k.includes(last)) k.push(last);
		return k;
	});
	let picked = $state(/** @type {number | null} */ (null));
	/** the year shown: the one picked, or else the latest (so the table follows the run) */
	const year = $derived(picked != null && years.includes(picked) ? picked : (years.at(-1) ?? null));
	const rowOf = (w, y) => (w.years ?? []).find((r) => r.y === y) ?? null;
	const step = (d) => {
		const i = years.indexOf(year ?? -1);
		const n = years[Math.max(0, Math.min(years.length - 1, i + d))];
		if (n != null) picked = n;
	};

	let mode = $state(/** @type {'year' | 'measure'} */ ('year'));
	let measure = $state('kcal');
	const M = $derived(LIVING.find((m) => m.k === measure) ?? LIVING[0]);
	const needOf = (m, w) => (m.need ? (w?.need?.[m.need] ?? null) : null);
	/** a value below the need is short */
	const low = (m, w, v) => {
		if (m.k === 'short') return Number.isFinite(v) && v > 0;
		const n = needOf(m, w);
		return n != null && Number.isFinite(v) && v < n * 0.98;
	};
	/** the poorest tenth from the first year to the latest full year, measure by measure, in each world */
	const trends = $derived.by(() =>
		list
			.map((w) => {
				const full = (w.years ?? []).filter((r) => !r.partial);
				const a = full[0], b = full.at(-1);
				if (!a || !b || a === b) return null;
				const parts = LIVING.filter((m) => m.k !== 'short')
					.map((m) => {
						const x = a.tenths?.[0]?.[m.k], y = b.tenths?.[0]?.[m.k];
						if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
						const arrow = y > x * 1.01 ? '↑' : y < x * 0.99 ? '↓' : '=';
						return `${(m.short ?? m.label).toLowerCase()} ${num(x)} → ${num(y)} ${arrow}`;
					})
					.filter(Boolean);
				return parts.length ? { j: w.j, name: w.name, from: a.y, to: b.y, text: parts.join(' · ') } : null;
			})
			.filter(Boolean)
	);
	const val = (m, v) => (v == null || !Number.isFinite(v) ? '–' : m.k === 'short' ? Math.round(v).toLocaleString('en-GB') : num(v, m.digits ?? 3));
	const partial = (w, y) => !!rowOf(w, y)?.partial;
</script>

{#snippet trendLines()}
	{#each trends as t (t.j)}
		<p class="trend w{t.j}"><b>{two ? `${t.name}, the` : 'The'} poorest tenth, year {t.from} → year {t.to}:</b> {t.text}</p>
	{/each}
{/snippet}

<div class="living">
	{#if !years.length}
		<p class="fine">{running ? 'The first year’s numbers fill in as the run goes: press Run, and they appear by the month.' : 'No yearly living standards in this record.'}</p>
	{:else}
		<div class="modes" role="group" aria-label="Show">
			<button class:on={mode === 'year'} onclick={() => (mode = 'year')}>One year</button>
			<button class:on={mode === 'measure'} onclick={() => (mode = 'measure')}>Year by year</button>
		</div>

		{#if mode === 'year'}
			<div class="years">
				<button class="nav" onclick={() => step(-1)} disabled={years.indexOf(year) <= 0} aria-label="Year before">‹</button>
				<label class="pick">Year <select value={year} onchange={(e) => (picked = +e.currentTarget.value)}>{#each years as y}<option value={y}>{y}</option>{/each}</select></label>
				<button class="nav" onclick={() => step(1)} disabled={years.indexOf(year) >= years.length - 1} aria-label="Year after">›</button>
				<span class="chips">{#each keys as y}<button class:on={year === y} onclick={() => (picked = y)}>{y}</button>{/each}</span>
			</div>
			{#if list.some((w) => partial(w, year))}<p class="fine">Year {year} so far: the run is in it, so these are the means of its days up to now.</p>{/if}

			<div class="scroll">
				<table class="grid">
					<thead>
						<tr><th class="m">Per person</th><th>Need</th>{#each COLS as c}<th class:allc={c.id === 'all'}>{c.label}</th>{/each}</tr>
					</thead>
					<tbody>
						{#each LIVING as m (m.k)}
							<tr>
								<td class="m"><b>{m.label}</b><small>{m.unit}</small></td>
								<td class="need">{needOf(m, list[0]) != null ? num(needOf(m, list[0])) : ''}</td>
								{#each COLS as c}
									<td class:allc={c.id === 'all'}>
										{#each list as w (w.j)}
											{@const v = c.get(rowOf(w, year))?.[m.k]}
											<span class="v w{w.j}" class:low={low(m, w, v)}>{val(m, v)}</span>
										{/each}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if two}<p class="key"><span class="w0">■ {list[0].name}</span> <span class="w1">■ {list[1].name}</span> · red: below the need</p>{:else}<p class="key">Red: below the need.</p>{/if}
			{@render trendLines()}

			{#each list as w (w.j)}
				{@const v = rowOf(w, year)?.village}
				{#if v}
					<section class="village w{w.j}">
						<h4>{two ? `${w.name}: the` : 'The'} village in year {year}</h4>
						{#if v.food}
							{@const tot = (v.food.out ?? 0) + (v.food.in ?? 0) + (v.food.imp ?? 0)}
							<p class="line"><b>Food, kcal a person a day:</b> grown outdoors {num(v.food.out ?? 0)}, grown indoors {num(v.food.in ?? 0)}, imported {num(v.food.imp ?? 0)}{v.food.eaten != null ? `; eaten ${num(v.food.eaten)}` : ''}.</p>
							{#if tot > 0}
								<div class="stack" aria-hidden="true">
									<i class="out" style:width="{(100 * (v.food.out ?? 0)) / tot}%"></i><i class="in" style:width="{(100 * (v.food.in ?? 0)) / tot}%"></i><i class="imp" style:width="{(100 * (v.food.imp ?? 0)) / tot}%"></i>
								</div>
								<p class="legend"><span class="out">■ outdoors</span> <span class="in">■ indoors</span> <span class="imp">■ imported</span></p>
							{/if}
						{/if}
						{#if v.indoorByMonth?.length === 12}
							{@const top = Math.max(1e-9, ...v.indoorByMonth)}
							<p class="line"><b>Indoor food forest by month</b>, kcal a person a day:</p>
							<div class="months" role="img" aria-label="Indoor food by month: {v.indoorByMonth.map((x) => num(x)).join(', ')}">
								{#each v.indoorByMonth as x, i}<span title="{num(x)} kcal"><i style:height="{(78 * x) / top}%"></i><small>{MONTHS[i]}</small></span>{/each}
							</div>
						{/if}
						{#if v.energy}
							<p class="line"><b>Energy, kWh a person a day:</b> made {num(v.energy.made ?? NaN)}{v.energy.from?.length ? ` (${v.energy.from.map((u) => `${u.label} ${num(u.v)}`).join(', ')})` : ''}{v.energy.uses?.length ? `; it went to ${v.energy.uses.filter((u) => u.v > 0).map((u) => `${u.label} ${num(u.v)}`).join(', ')}` : ''}.</p>
						{/if}
						{#if v.binds?.length}
							<p class="line"><b>What binds each good:</b></p>
							<ul>{#each v.binds as b}<li><b>{b.good}:</b> {b.why}</li>{/each}</ul>
						{/if}
					</section>
				{/if}
			{/each}
		{:else}
			<div class="chips measures" role="group" aria-label="Measure">
				{#each LIVING as m}<button class:on={measure === m.k} onclick={() => (measure = m.k)}>{m.short ?? m.label}</button>{/each}
			</div>
			<p class="fine"><b>{M.label}</b>, {M.unit}{needOf(M, list[0]) != null ? `; the need is ${num(needOf(M, list[0]))}` : ''}.</p>
			<div class="scroll tall">
				<table class="grid">
					<thead><tr><th class="m">Year</th>{#each COLS as c}<th class:allc={c.id === 'all'}>{c.label}</th>{/each}</tr></thead>
					<tbody>
						{#each years as y}
							<tr>
								<td class="m">{y}{#if list.some((w) => partial(w, y))}<small>so far</small>{/if}</td>
								{#each COLS as c}
									<td class:allc={c.id === 'all'}>
										{#each list as w (w.j)}
											{@const v = c.get(rowOf(w, y))?.[M.k]}
											<span class="v w{w.j}" class:low={low(M, w, v)}>{val(M, v)}</span>
										{/each}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if two}<p class="key"><span class="w0">■ {list[0].name}</span> <span class="w1">■ {list[1].name}</span> · red: below the need</p>{/if}
			{@render trendLines()}
		{/if}
		{#if indoor?.withLight?.length === 12 || indoor?.withoutLight?.length === 12}
			<section class="village">
				<h4>The indoor food forest at maturity, by month</h4>
				<p class="line">kcal a person a day, year round under glass at 24 °C: <span class="lit">■ with LED light</span> <span class="dark">■ without</span></p>
				<div class="months two" role="img" aria-label="Indoor food by month with light: {(indoor.withLight ?? []).map((x) => num(x)).join(', ')}; without: {(indoor.withoutLight ?? []).map((x) => num(x)).join(', ')}">
					{#each MONTHS as m, i}
						<span title="with light {num(indoor.withLight?.[i] ?? NaN)} · without {num(indoor.withoutLight?.[i] ?? NaN)} kcal">
							<span class="pair"><i class="lit" style:height="{(100 * (indoor.withLight?.[i] ?? 0)) / indoorTop}%"></i><i class="dark" style:height="{(100 * (indoor.withoutLight?.[i] ?? 0)) / indoorTop}%"></i></span>
							<small>{m}</small>
						</span>
					{/each}
				</div>
				<p class="fine">With light: {(indoor.withLight ?? []).map((x) => num(x)).join(' · ')}<br />Without: {(indoor.withoutLight ?? []).map((x) => num(x)).join(' · ')}</p>
			</section>
		{/if}
		<p class="fine">Tenths by MIND holdings: the poorest tenth, the middle (fifth) tenth and the richest tenth, and everyone. Each number is the year’s mean a person, a day unless it says a week or a year; “people short” counts the people in that group who went short of any basic on at least one day of the year.</p>
	{/if}
</div>

<style>
	.living {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.modes,
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.modes button,
	.chips button,
	.nav {
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: 999px;
		font: inherit;
		font-size: 0.76rem;
		padding: 0.2rem 0.65rem;
		cursor: pointer;
		color: var(--ink);
	}
	.modes button.on,
	.chips button.on {
		background: var(--ink);
		color: var(--paper);
		border-color: var(--ink);
	}
	.nav {
		padding: 0.1rem 0.55rem;
		font-size: 0.9rem;
		line-height: 1.2;
	}
	.nav:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.years {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.pick {
		font-size: 0.78rem;
		color: var(--ink-soft);
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	select {
		font: inherit;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--paper);
		padding: 0.1rem 0.3rem;
	}
	.scroll {
		overflow-x: auto;
		max-width: min(100%, 60rem);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
	}
	.scroll.tall {
		max-height: 26rem;
		overflow-y: auto;
	}
	table {
		border-collapse: collapse;
		font-size: 0.76rem;
		width: 100%;
		min-width: 19rem;
	}
	th {
		position: sticky;
		top: 0;
		background: var(--paper);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--muted);
		text-align: right;
		padding: 0.3rem 0.4rem;
		white-space: nowrap;
	}
	td {
		text-align: right;
		padding: 0.25rem 0.4rem;
		border-top: 1px solid var(--line);
		font-variant-numeric: tabular-nums;
		vertical-align: top;
		white-space: nowrap;
	}
	.m {
		text-align: left;
		white-space: normal;
	}
	td.m b {
		font-weight: 600;
		display: block;
	}
	td.m small {
		display: block;
		color: var(--muted);
		font-size: 0.66rem;
	}
	td.need {
		color: var(--muted);
	}
	.allc {
		background: rgb(38 56 44 / 0.035);
	}
	.months {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 3px;
		height: 3.2rem;
		align-items: end;
		max-width: 24rem;
	}
	.months > span {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		height: 100%;
		min-width: 0;
	}
	.months i {
		display: block;
		width: 100%;
		background: #8bc34a;
		border-radius: 2px 2px 0 0;
		min-height: 1px;
	}
	.months .pair {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		gap: 1px;
		width: 100%;
		height: calc(100% - 0.8rem);
	}
	.months .pair i {
		flex: 1;
		width: auto;
	}
	i.lit {
		background: #eda100;
	}
	i.dark {
		background: #5d8a2e;
	}
	span.lit {
		color: #b07800;
	}
	span.dark {
		color: #5d8a2e;
	}
	.months small {
		font-size: 0.58rem;
		color: var(--muted);
		line-height: 1.2;
	}
	.v {
		display: block;
	}
	.v.w0 {
		color: #1f5fae;
	}
	.v.w1 {
		color: #c4521f;
	}
	.living:not(:has(.v.w1)) .v.w0 {
		color: var(--ink);
	}
	.v.low {
		color: #d03b3b;
		font-weight: 700;
	}
	.key,
	.legend {
		margin: 0;
		font-size: 0.7rem;
		color: var(--muted);
	}
	.key .w0 {
		color: #1f5fae;
	}
	.key .w1 {
		color: #c4521f;
	}
	.trend {
		margin: 0;
		font-size: 0.78rem;
		color: var(--ink-soft);
		line-height: 1.45;
		border-left: 3px solid #2a78d6;
		padding-left: 0.5rem;
	}
	.trend.w1 {
		border-left-color: #eb6834;
	}
	.trend b {
		color: var(--ink);
	}
	.village {
		max-width: 60rem;
		background: var(--paper);
		border: 1px solid var(--line);
		border-left: 4px solid #2a78d6;
		border-radius: 12px;
		padding: 0.45rem 0.65rem;
		min-width: 0;
	}
	.village.w1 {
		border-left-color: #eb6834;
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: 0.84rem;
	}
	.line {
		margin: 0.2rem 0;
		font-size: 0.78rem;
		color: var(--ink-soft);
		line-height: 1.4;
	}
	.line b {
		color: var(--ink);
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.76rem;
		color: var(--ink-soft);
		line-height: 1.4;
	}
	.stack {
		display: flex;
		height: 10px;
		border-radius: 5px;
		overflow: hidden;
		background: var(--cream);
		margin: 0.25rem 0 0.15rem;
	}
	.stack i {
		display: block;
		height: 100%;
	}
	.out {
		background: #2f9e5a;
		color: #2f7d4f;
	}
	.in {
		background: #8bc34a;
		color: #5d8a2e;
	}
	.imp {
		background: #c8744f;
		color: #a85a37;
	}
	.legend span {
		background: none;
	}
	.fine {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.4;
	}
</style>
