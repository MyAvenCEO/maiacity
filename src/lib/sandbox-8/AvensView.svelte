<!--
	The Avens view (Samuel, 2026-10-09): one aven at a time, everything about it. The avens on the left; on the right its
	HEARTS and body, its brain, its stock and limits, its HEARTS and body over the days, its activity and its ledger.
	Its brain is drawn from what its world declares (the Brains card's traits: mind.js), the same way for any world: the
	dials of its character, the wants it keeps, and what its trials optimise.
-->
<script>
	import LineChart from './LineChart.svelte';
	import ActivityFeed from './ActivityFeed.svelte';
	import { GOODS, GOOD_LABEL, GOOD_COLOUR, NEED, ROT, DAY_S } from './economy.js';
	import { RULES } from './rules.js';
	import { DIALS } from './mind.js';
	import { short, times, logScale, logAt } from './format.js';

	/** @type {{ data: any, aven: any, market: any, names: Record<string, string>, trialDays: number, onselect: (id: number) => void, lineOf: (e: any) => string, admin?: boolean, mindNote?: string, onforget?: () => void }} */
	let { data, aven: a, market, names, trialDays, onselect, lineOf, admin = false, mindNote = '', onforget } = $props();

	const fmt = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US');
	/** @param {number} t */
	const clock = (t) => {
		const s = t % DAY_S;
		return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
	};
	const share = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => `${Math.max(0, Math.min(100, ((v - lo) / Math.max(1e-9, hi - lo)) * 100))}%`;
	const t = $derived(data.traits);
	const m = $derived(a.mind);
	/** dials it has that this world doesn't declare: kept in its brain, playing no part here */
	const idle = $derived(m ? Object.entries(m.dials).filter(([k]) => !t.dials.some((/** @type {any} */ d) => d.key === k)) : []);
	const traitLabel = (/** @type {any} */ tr) => (tr.kind === 'wants' ? t.wants.find((/** @type {any} */ w) => w.key === tr.key)?.label : t.dials.find((/** @type {any} */ d) => d.key === tr.key)?.label) ?? tr.key;
	const rank = $derived(data.list.find((/** @type {any} */ o) => o.id === a.id)?.rank ?? 0);
	const limits = RULES.haggleMax > 0 ? { ask: 'sells at', bid: 'pays up to' } : { ask: 'lowest it accepts', bid: 'most it pays' };

	/** its limit per good against the market (Samuel: prices are free): the last week's clearing prices as a band, the
	 * clearing price now as a tick, every other limit in the book as a faint mark, and its own as a dot; log scale */
	const bars = $derived(
		GOODS.map((g) => {
			const own = a.grows.includes(g);
			const mk = market[g];
			const week = (mk.history ?? []).slice(-8).filter((/** @type {any} */ v) => v != null && v > 0);
			const others = [...mk.sells, ...mk.wants].filter((/** @type {any} */ o) => o.name !== a.name).map((/** @type {any} */ o) => o.price);
			return { g, own, v: own ? a.ask[g] : a.bid[g], price: mk.price, week, others };
		})
	);
	const barScale = $derived(logScale(bars.flatMap((b) => [b.v, b.price, ...b.week, ...b.others])));
	const at = (/** @type {number} */ v) => `${(logAt(v, barScale.lo, barScale.hi) * 100).toFixed(1)}%`;
	const days = $derived(data.stats);
	const from = $derived(days.length ? days[0].day : 0);
	const to = $derived(days.length ? Math.max(days.at(-1).day, from + 1) : 1);
	const heartsLines = $derived([{ key: 'hearts', label: 'HEARTS', colour: a.colour, pts: days.map((/** @type {any} */ r) => ({ x: r.day, y: r.hearts ?? null })) }]);
	const bodyLines = $derived([
		{ key: 'health', label: 'Health', colour: '#b8483b', pts: days.map((/** @type {any} */ r) => ({ x: r.day, y: r.health == null ? null : Math.round((r.health / RULES.healthMax) * 100) })) },
		{ key: 'water', label: 'Water', colour: GOOD_COLOUR.water, dash: true, pts: days.map((/** @type {any} */ r) => ({ x: r.day, y: r.water ?? null })) },
		{ key: 'food', label: 'Food', colour: GOOD_COLOUR.fruits, dash: true, pts: days.map((/** @type {any} */ r) => ({ x: r.day, y: r.food ?? null })) }
	]);
	const shade = $derived.by(() => {
		/** @type {[number, number][]} */
		const out = [];
		for (const r of days) {
			if (!r.dry) continue;
			const last = out.at(-1);
			if (last && last[1] === r.day - 1) last[1] = r.day;
			else out.push([r.day, r.day]);
		}
		return out;
	});
</script>

<div class="avens">
	<nav class="list" aria-label="Avens">
		{#each data.list as o (o.id)}
			<button class:sel={o.id === a.id} class:dead={!o.alive} onclick={() => onselect(o.id)}>
				<i style:background={o.colour}></i>
				<b>{o.name}</b>
				<span class="num">{o.alive ? `${fmt(o.hearts)} ♥` : 'dead'}</span>
				<span class="bar"><span style:width={o.alive ? share(o.health, 0, RULES.healthMax) : '0%'}></span></span>
			</button>
		{/each}
	</nav>

	<main>
		<header>
			<h2><i style:background={a.colour}></i>{a.name}</h2>
			<span class="grows">grows {#each a.grows as g (g)}<em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]} {/each}</span>
			{#if a.fields?.length}
				<span class="fields">fields {#each a.fields as f, i (i)}<span class="field"><em style:background={GOOD_COLOUR[f.crop]}></em>{GOOD_LABEL[f.crop]} <b>L{f.level}</b>{f.grown < 100 ? ` · growing ${f.grown}%` : ''} · {f.yield} a day</span>{/each}</span>
			{/if}
			<p>{a.alive ? `No. ${rank} on the board` : `Died on day ${a.diedOn}, reborn on day ${a.diedOn + RULES.rebirthDays}`} · decides with {names[a.brain.last?.source] ?? a.brain.last?.source ?? 'no brain yet'}</p>
		</header>

		<div class="vitals">
			<div><span>HEARTS</span><b>{fmt(a.hearts)}</b><small>minted +{fmt(a.minted)} · decayed −{fmt(a.decayed)}</small></div>
			<div><span>Health</span><b>{Math.round(a.health)} <small>of {RULES.healthMax}</small></b><span class="meter"><span class="h" style:width={share(a.health, 0, RULES.healthMax)}></span></span></div>
			<div><span>Water reserve</span><b>{Math.round(a.body.water)} <small>of 100</small></b><span class="meter"><span style:background={GOOD_COLOUR.water} style:width={share(a.body.water, 0, 100)}></span></span></div>
			<div><span>Food reserve</span><b>{Math.round(a.body.food)} <small>of 100</small></b><span class="meter"><span style:background={GOOD_COLOUR.fruits} style:width={share(a.body.food, 0, 100)}></span></span></div>
		</div>

		<div class="grid">
			<section class="card brain">
				<h3>Its brain</h3>
				{#if m}
					<p class="sub">{m.runs} world{m.runs === 1 ? '' : 's'} · {m.days} days lived · died {m.deaths}× · {m.tally.trials} trials, {m.tally.kept} kept</p>
					<p class="goal"><span>Optimises</span>{t.score}, over {trialDays} days at a time</p>
					<h4>Character</h4>
					<ul class="traits">
						{#each t.dials as d (d.key)}
							<li>
								<span class="name">{d.label}</span>
								<span class="track"><span style:left={share(m.dials[d.key] ?? d.min, d.min, d.max)}></span></span>
								<b>{m.dials[d.key] ?? '—'} <small>of {d.max}</small></b>
								<small class="ends"><span>{d.min}: {d.low}</span><span>{d.max}: {d.high}</span></small>
							</li>
						{/each}
					</ul>
					{#if idle.length}<p class="sub">Not used in this world: {idle.map(([k, v]) => `${(/** @type {Record<string, any>} */ (DIALS)[k]?.label ?? k).toLowerCase()} ${v}`).join(', ')}.</p>{/if}
					<h4>Wants</h4>
					<ul class="traits">
						{#each t.wants as w (w.key)}
							<li>
								<span class="name">{w.label}</span>
								<span class="track want"><span style:left={share(m.wants[w.key] ?? w.min, w.min, w.max)}></span></span>
								<b>{m.wants[w.key] ?? '—'} <small>{w.unit}</small></b>
							</li>
						{/each}
					</ul>
					<p class="now">{m.trial ? `Trying ${traitLabel(m.trial).toLowerCase()} ${m.trial.from}→${m.trial.to} since day ${m.trial.day}: kept only if it beats ${m.base}/day.` : m.base == null ? `Measuring its setting for ${trialDays} days before its next trial.` : `Its last ${trialDays} days scored ${m.base}/day: it picks its next trial.`}</p>
					{#if m.log.length}<h4>Trials</h4><ul class="lines">{#each m.log.slice().reverse() as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
					{#if m.lessons.length}<h4>Lessons</h4><ul class="lines">{#each m.lessons as l (l.id)}<li>#{l.id} {l.text} <small>+{l.up} −{l.down}</small></li>{/each}</ul>{/if}
					{#if m.deathLog.length}<h4>Deaths</h4><ul class="lines death">{#each m.deathLog.slice().reverse() as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
					{#if mindNote}<p class="sub miss">{mindNote}</p>{/if}
					{#if admin}<button class="forget" onclick={onforget}>Forget every brain in this world</button>{/if}
				{:else}
					<p class="sub">Its brain loads with the world.</p>
				{/if}
			</section>

			<section class="card">
				<h3>Stock and limits</h3>
				<div class="scroll"><table>
					<thead><tr><th>Good</th><th title="needed a day">Need</th><th title="grows a day on average, and last night's harvest">Grows</th><th title="share that rots each night">Rots</th><th>Stock</th><th title="market price">Market</th><th title="its own price: for a good it grows, {limits.ask}; for one it buys, {limits.bid}">Its limit</th></tr></thead>
					<tbody>
						{#each GOODS as g (g)}
							{@const own = a.grows.includes(g)}
							{@const v = own ? a.ask[g] : a.bid[g]}
							<tr>
								<td><em style:background={GOOD_COLOUR[g]}></em>{GOOD_LABEL[g]}</td>
								<td class="num">{NEED[g]}</td>
								<td class="num">{#if a.produce[g] != null}{a.produce[g]}<small>last {a.harvest[g]}</small>{/if}</td>
								<td class="num">{ROT[g] ? `${Math.round(ROT[g] * 100)}%` : '—'}</td>
								<td class="num">{a.stock[g]}</td>
								<td class="num">{short(market[g].price)}</td>
								<td class="num">{#if v != null}<small>{own ? limits.ask : limits.bid}</small> {short(v)}<small>{times(v, market[g].price)}</small>{:else}<small>none yet</small>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table></div>
				<h4>Its limits against the market <small>log scale, {short(barScale.lo)} to {short(barScale.hi)} HEARTS</small></h4>
				<ul class="bars">
					{#each bars as b (b.g)}
						<li>
							<span class="good"><em style:background={GOOD_COLOUR[b.g]}></em>{GOOD_LABEL[b.g]}</span>
							<span class="track" title="band: the last week's clearing prices; tick: the clearing price now; grey: the others' limits; dot: its own">
								{#if b.week.length}<span class="week" style:left={at(Math.min(...b.week))} style:right="calc(100% - {at(Math.max(...b.week))})"></span>{/if}
								{#each b.others as p, i (i)}<span class="other" style:left={at(p)}></span>{/each}
								{#if b.price != null}<span class="clear" style:left={at(b.price)}></span>{/if}
								{#if b.v != null}<span class="me" class:sell={b.own} style:left={at(b.v)}></span>{/if}
							</span>
							<span class="num">{#if b.v != null}{short(b.v)} <small>{b.price ? `${times(b.v, b.price)} clearing` : b.own ? 'sells' : 'buys'}</small>{:else}<small>none yet</small>{/if}</span>
						</li>
					{/each}
				</ul>
				{#if Object.keys(a.choices ?? {}).length}
					<h4>Its other decisions</h4>
					<ul class="lines">{#each Object.entries(a.choices) as [k, v] (k)}<li>{a.brain.labels?.[k] ?? k.replace(/_/g, ' ')} <b>{short(v)}</b> {a.brain.units?.[k] ?? ''}</li>{/each}</ul>
				{/if}
			</section>

			<section class="card chart"><LineChart title="HEARTS" unit="HEARTS" lines={heartsLines} {from} {to} {shade} note="At the end of each day" /></section>
			<section class="card chart"><LineChart title="Body" unit="% of full" lines={bodyLines} {from} {to} {shade} max={100} note="Health, and the two reserves; at 0 in any of them it dies" /></section>

			<section class="card">
				<h3>Activity</h3>
				<div class="box"><ActivityFeed entries={data.feed} {names} who={false} empty="Nothing yet." /></div>
			</section>

			<section class="card">
				<h3>Ledger</h3>
				<ul class="ledger">
					{#each a.ledger as e, i (i)}
						<li class={e.kind}>
							<span class="when">d{e.day} {clock(e.t)}</span>
							<span>{lineOf(e)}</span>
							{#if e.hearts}<span class="num" class:up={e.hearts > 0}>{e.hearts > 0 ? '+' : ''}{fmt(e.hearts)}</span>{/if}
						</li>
					{:else}
						<li class="none">Nothing yet.</li>
					{/each}
				</ul>
			</section>
		</div>
	</main>
</div>

<style>
	.avens {
		height: 100%;
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		background: #f4f1e8;
		color: #1f2a23;
		min-height: 0;
	}
	.list {
		overflow-y: auto;
		border-right: 1px solid #1f2a231a;
		padding: 0.6rem 0.4rem var(--nav-room, 6rem);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.list button {
		display: grid;
		grid-template-columns: auto 1fr auto;
		grid-template-rows: auto auto;
		align-items: center;
		gap: 0.1rem 0.4rem;
		border: 0;
		background: none;
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		font: inherit;
		font-size: 0.82rem;
		color: inherit;
		cursor: pointer;
	}
	.list button:hover {
		background: #1f2a230a;
	}
	.list button.sel {
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
	}
	.list button.dead {
		opacity: 0.55;
		font-style: italic;
	}
	.list .num {
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
	}
	.list .bar {
		grid-column: 2 / 4;
		height: 3px;
		border-radius: 2px;
		background: #1f2a2314;
		overflow: hidden;
	}
	.list .bar span {
		display: block;
		height: 100%;
		background: #b8483b;
	}
	i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	main {
		overflow-y: auto;
		padding: 0.9rem 1.1rem var(--nav-room, 6rem);
		min-width: 0;
	}
	header h2 {
		margin: 0;
		font-size: 1.3rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	header h2 i {
		width: 14px;
		height: 14px;
	}
	header p {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		color: #6b6a66;
	}
	.grows {
		font-size: 0.78rem;
		color: #6b6a66;
	}
	.grows em,
	td em {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		margin: 0 0.2rem 0 0.35rem;
	}
	.vitals {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 0.5rem;
		margin: 0.8rem 0;
	}
	.vitals div {
		background: #fff;
		border-radius: 10px;
		padding: 0.5rem 0.7rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.vitals span:first-child {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.vitals b {
		font-size: 1.2rem;
		font-variant-numeric: tabular-nums;
	}
	.vitals b small,
	.vitals > div > small {
		font-size: 0.72rem;
		font-weight: 400;
		color: #6b6a66;
	}
	.meter {
		height: 6px;
		border-radius: 3px;
		background: #1f2a2314;
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
	}
	.meter .h {
		background: #b8483b;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
		gap: 0.7rem;
		align-items: start;
	}
	.card {
		background: #fff;
		border-radius: 10px;
		padding: 0.7rem 0.85rem;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		min-width: 0;
	}
	.card.chart {
		padding: 0.4rem 0.5rem;
	}
	.brain {
		grid-row: span 2;
	}
	h2,
	h3,
	h4 {
		font-family: inherit;
	}
	h3 {
		margin: 0 0 0.3rem;
		font-size: 0.95rem;
	}
	h4 {
		margin: 0.7rem 0 0.25rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b6a66;
	}
	.sub {
		margin: 0.2rem 0;
		font-size: 0.75rem;
		color: #6b6a66;
	}
	.miss {
		color: #c2410c;
	}
	.goal {
		margin: 0.5rem 0 0;
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		background: #24452f0d;
		font-size: 0.8rem;
	}
	.goal span {
		display: block;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6b6a66;
	}
	.traits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
	}
	.traits li {
		display: grid;
		grid-template-columns: 7rem 1fr 3.6rem;
		align-items: center;
		gap: 0.15rem 0.5rem;
		font-size: 0.8rem;
	}
	.traits b {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.traits b small {
		font-weight: 400;
		color: #6b6a66;
	}
	.track {
		position: relative;
		height: 6px;
		border-radius: 3px;
		background: linear-gradient(90deg, #b07ad833, #b07ad8);
	}
	.track.want {
		background: linear-gradient(90deg, #2a78d633, #2a78d6);
	}
	.track span {
		position: absolute;
		top: 50%;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid #1f2a23;
		transform: translate(-50%, -50%);
		box-sizing: border-box;
	}
	.ends {
		grid-column: 2 / 4;
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.68rem;
		color: #6b6a66;
	}
	.ends span:last-child {
		text-align: right;
	}
	.now {
		margin: 0.6rem 0 0;
		font-size: 0.78rem;
	}
	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.75rem;
	}
	.lines li {
		padding: 0.15rem 0;
		border-top: 1px solid #1f2a230d;
	}
	.lines small {
		color: #6b6a66;
	}
	.lines.death li {
		color: #b8483b;
	}
	.forget {
		margin-top: 0.6rem;
		background: none;
		border: 0;
		padding: 0;
		color: #b3261e;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
		font-size: 0.78rem;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}
	th {
		text-align: right;
		font-weight: 600;
		opacity: 0.7;
		padding: 0.15rem 0.3rem;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	td {
		padding: 0.2rem 0.3rem;
		border-top: 1px solid #1f2a230d;
	}
	td.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	td small {
		color: #6b6a66;
		margin: 0 0.2rem;
	}
	.box {
		max-height: 420px;
		overflow-y: auto;
	}
	.ledger {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.75rem;
		max-height: 420px;
		overflow-y: auto;
	}
	.ledger li {
		display: grid;
		grid-template-columns: 4.6rem 1fr auto;
		gap: 0.4rem;
		padding: 0.18rem 0;
		border-top: 1px solid #1f2a230d;
	}
	.ledger .when {
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
	}
	.ledger .num {
		color: #b8483b;
		font-variant-numeric: tabular-nums;
	}
	.ledger .num.up {
		color: #2f7d4f;
	}
	.ledger .death {
		color: #b8483b;
		font-weight: 700;
	}
	.ledger .none {
		display: block;
		opacity: 0.5;
	}
	/* phones: the avens in a row on top, everything about the one picked under it */
	@media (max-width: 760px) {
		.avens {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
		}
		.list {
			flex-direction: row;
			overflow-x: auto;
			overflow-y: hidden;
			border-right: 0;
			border-bottom: 1px solid #1f2a231a;
			padding: 0.4rem;
		}
		.list button {
			flex: none;
		}
		main {
			padding: 0.7rem 0.8rem var(--nav-room, 6rem);
		}
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.vitals {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.brain {
			grid-row: auto;
		}
	}
	.bars {
		list-style: none;
		padding: 0;
		margin: 0.2rem 0 0.4rem;
		font-size: 0.75rem;
	}
	.bars li {
		display: grid;
		grid-template-columns: 6.5rem minmax(0, 1fr) 6.5rem;
		align-items: center;
		gap: 0.5rem;
		padding: 0.18rem 0;
	}
	.bars .good em {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		margin-right: 0.3rem;
	}
	.track {
		position: relative;
		height: 14px;
		border-radius: 7px;
		background: #1f2a230d;
	}
	.track > span {
		position: absolute;
		top: 50%;
		transform: translate(-50%, -50%);
	}
	.track .week {
		transform: translateY(-50%);
		height: 8px;
		min-width: 3px;
		border-radius: 4px;
		background: #24452f2e;
	}
	.track .other {
		width: 2px;
		height: 8px;
		background: #1f2a2340;
	}
	.track .clear {
		width: 2px;
		height: 14px;
		background: #1f2a23;
	}
	.track .me {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #2f7a4a;
		box-shadow: 0 0 0 2px #fff;
	}
	.track .me.sell {
		background: #b8483b;
	}
	.bars .num small {
		opacity: 0.6;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.6rem;
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.fields .field em {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 3px;
		margin-right: 0.2rem;
	}
</style>
