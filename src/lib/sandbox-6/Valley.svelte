<!--
	avenCITY Sandbox 6 — a valley of settlers: the whole game on one page. The world fills the screen (./game.js); over
	it the tools (build, road, tear down, the building tree, the clock), the build menu, on the right what your village
	has against what it needs (with a village center picked, its trade routes too), the card of whatever else is
	selected, and the news. There is no goal: you grow your villages and see how far the valley goes.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WorldBar } from '$lib/sandbox-kit';
	import { BIOMES, BUILDINGS, ENERGY, HOUSE_BEDS, HOUSE_SIZE, LAND, LOAD_T, MENU, RECIPES, WARES, buildIn } from './rules.js';
	import { EUR_PER_GOLD, GRID_EUR_KWH } from './market.js';
	import { UNIT_OF, costLine, craftLine, energy, fmt, food, gold, nameOf, side, ware, water } from './units.js';
	import { MONTHS, PRICE, SIM_SPEED, SPEEDS, WATER_PRICE } from './food.js';
	import { PLAYER, wellsOf } from './sim.js';
	import Tree from './Tree.svelte';

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {ReturnType<typeof import('./game.js').mountGame> | null} */
	let game = null;
	let loading = $state(true);

	let mode = $state('look');
	let buildType = $state('');
	let hint = $state('');
	/** the clock's speed on the master clock: 1 a month a real day, 12 a year, 120 ten years; 0 paused */
	let speed = $state(1);
	/** the simulation: autoplay grows the first village full at ten years in ten real minutes; the speed it had before,
	 * and how far it got (the first village's people of its beds at most, and the date) */
	let simulating = $state(false);
	/** @type {number | null} */
	let before = null;
	/** @type {{ name: string, pop: number, cap: number, date: { year: number, month: number, day: number }, done: boolean } | null} */
	let simNote = $state(null);
	/** what a Buy button at the world market said when it could not */
	let buyWhy = $state('');
	let menuOpen = $state(false);
	let group = $state(MENU[0].group);
	let narrow = $state(false);
	/** @type {import('./game.js').Selection} */
	let selected = $state(null);
	/** @type {ReturnType<import('./sim.js').Sim['summary']> | null} */
	let summary = $state(null);
	/** @type {ReturnType<import('./sim.js').Sim['inspect']> | null} */
	let card = $state(null);
	/** @type {any} */
	let flagCard = $state(null);
	/** @type {any} */
	let roadCard = $state(null);
	let treeOpen = $state(false);
	/** whether the world market's card is open */
	let marketOpen = $state(false);
	/** how many of each building you have, sites too */
	let owned = $state(/** @type {Record<string, number>} */ ({}));
	/** @type {ReturnType<import('./sim.js').Sim['market']> | null} */
	let market = $state(null);
	/** the trade routes a selected village center of yours can dig, and the ones it has @type {ReturnType<import('./sim.js').Sim['links']>} */
	let links = $state([]);
	/** what a Connect button said when the route could not be dug */
	let linkWhy = $state('');
	/** what an Enlarge or Upgrade button said when it could not grow */
	let upWhy = $state('');
	/** what the Drill button said when the wells could not be paid */
	let drillWhy = $state('');
	/** the village of yours the right side shows — the one picked, else your first: each need against its stock */
	let home = $state(/** @type {ReturnType<import('./sim.js').Sim['village']>} */ (null));
	/** whether the pick is a village center of yours: then the right side is its card */
	let ownCentre = $state(false);
	/** its food and water, and a week of food against what its people eat (kg) and in gold */
	const fd = $derived(home?.food);
	const wt = $derived(home?.water);
	const pw = $derived(home?.power);
	/** its energy a week: what its wells and domes make, what its people and factories use, and what is left for the
	 * world grid (kWh, and € of real prices: the page shows energy and gold) */
	const pwMade = $derived(pw ? pw.well + pw.sun : 0);
	const pwUsed = $derived(pw ? pw.home + pw.climate + pw.centre + pw.work : 0);
	const pwGrid = $derived(pw ? pw.sold - pw.bought : 0);
	const pwEur = $derived(pw ? pw.earned - pw.spent : 0);
	/** your cashflow and the shown village's, gold a week: exports less imports */
	const cash = $derived.by(() => {
		const c = /** @type {{ exp: number, imp: number } | undefined} */ (/** @type {any} */ (summary)?.cash);
		return c ? (c.exp - c.imp) / EUR_PER_GOLD : 0;
	});
	const homeCash = $derived(home ? (home.cash.exp - home.cash.imp) / EUR_PER_GOLD : 0);
	/** gold with its sign */
	const signed = (/** @type {number} */ g) => `${g > 0.05 ? '+' : ''}${fmt(g)}`;
	let seenMsg = 0;
	/** @type {{ text: string, tone: string, node: number, key: number }[]} */
	let toasts = $state([]);

	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	/** a number of people, whole, with its thousands marked */
	const num = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US').replace('-', '−');
	/** gold, from gold */
	const goldOf = (/** @type {number} */ g) => fmt(g);
	/** the valley's date */
	const when = (/** @type {{ year: number, month: number, day: number }} */ d) => `year ${d.year}, month ${d.month}, day ${d.day}`;
	/** what a building's card says of its energy, a week */
	const powerLine = (/** @type {{ made: number, used: number, next: number | null }} */ p, /** @type {string} */ type) =>
		[
			p.made ? `makes ${energy(p.made)}${type === 'house' ? ' of solar this month' : ' of geothermal'}` : '',
			p.used ? `uses ${energy(p.used)}${type === 'house' ? ' for its climate and its people, every bed taken' : type === 'centre' ? ' for its hall, storehouse and routes' : ', working all its land gives it and keeping its dome'}` : '',
			p.next !== null ? `${p.next > p.used ? 'more' : 'less'} at its next stage: ${energy(p.next)}` : ''
		]
			.filter(Boolean)
			.join(' · ') || 'none';
	/** a cost on a button: its wares, in units, and its builders' energy */
	const buildOf = (/** @type {Record<string, number>} */ loads) => buildIn(Object.fromEntries(Object.entries(loads).map(([w, n]) => [w, n * LOAD_T])));
	/** years and months, short */
	const span = (/** @type {number} */ months) => (!Number.isFinite(months) ? 'never' : months >= 12 ? `${fmt(months / 12)} years` : `${Math.ceil(months)} months`);

	function refresh() {
		if (!game) return;
		const sim = game.sim;
		summary = sim.summary();
		market = sim.market();
		if (treeOpen) {
			/** @type {Record<string, number>} */
			const n = {};
			for (const b of Object.values(sim.state.buildings)) {
				if (b.owner !== PLAYER) continue;
				n[b.type] = (n[b.type] ?? 0) + 1;
				// and by the stage it stands at: a village center by its geothermal stages
				const lv = b.type === 'centre' ? (b.stage === 'live' ? wellsOf(b) : 0) : b.level;
				if (lv) n[`${b.type}:${lv}`] = (n[`${b.type}:${lv}`] ?? 0) + 1;
			}
			owned = n;
		}
		speed = game.speed;
		// the simulation's first village, and its end once every house holds 248
		if (simulating || simNote?.done) {
			const hq = sim.state.buildings[sim.state.hq];
			const row = market?.parties.find((/** @type {any} */ p) => p.owner === PLAYER && p.node === hq?.node);
			if (row) simNote = { name: row.name, pop: row.pop, cap: row.cap, date: summary.date, done: simNote?.done ?? false };
			if (simulating && row && row.cap > 0 && row.pop >= row.cap) {
				stopSim();
				game.setSpeed(0);
				speed = 0;
				simNote = { name: row.name, pop: row.pop, cap: row.cap, date: summary.date, done: true };
			}
		}
		const s = selected;
		card = s?.k === 'building' ? sim.inspect(s.id) : null;
		if (s?.k === 'building' && !card) select(null);
		ownCentre = card?.type === 'centre' && card.owner === PLAYER && card.stage === 'live';
		home = sim.village(s ? s.node : -1);
		links = card && ownCentre ? sim.links(card.id) : [];
		if (s?.k === 'flag') {
			const f = sim.state.flags[s.id];
			flagCard = f ? { owner: f.owner, wares: f.wares.map((/** @type {number} */ id) => sim.state.wares[id]?.type).filter(Boolean), bld: f.bld ? BUILDINGS[sim.state.buildings[f.bld]?.type]?.label : '' } : null;
			if (!f) select(null);
		} else flagCard = null;
		if (s?.k === 'road') {
			const r = sim.state.roads[sim.state.road[s.node]];
			roadCard = r ? { steps: r.path.length - 1, carrier: !!sim.state.units[r.carrier], busy: !!sim.state.units[r.carrier]?.ware, canFlag: !sim.canFlag(s.node) } : null;
			if (!r) select(null);
		} else roadCard = null;
		// the news: what is new since last time, a while on screen
		for (const m of summary.msgs) {
			const key = m.n;
			if (m.n <= seenMsg) continue;
			seenMsg = m.n;
			toasts = [...toasts.slice(-3), { text: m.text, tone: m.tone, node: m.node, key }];
			setTimeout(() => (toasts = toasts.filter((x) => x.key !== key)), m.tone === 'alert' ? 9000 : 6000);
		}
	}
	/** @param {import('./game.js').Selection} s */
	function select(s) {
		selected = s;
		linkWhy = '';
		upWhy = '';
		drillWhy = '';
		refresh();
	}
	/** drill two more geothermal producers under the selected village center */
	function drill() {
		if (!card || !game) return;
		const r = game.sim.drill(card.id);
		drillWhy = r.ok ? '' : r.why ?? '';
		refresh();
	}
	/** dig a trade route from the selected village center to another */
	function connect(/** @type {number} */ to) {
		if (!card || !game) return;
		const r = game.sim.connect(card.id, to);
		linkWhy = r.ok ? '' : r.why ?? '';
		refresh();
	}
	/** pick one of your villages: the map flies to its center and the right side shows it */
	function pickVillage(/** @type {number} */ node) {
		const at = game?.sim.at(node);
		if (at?.k === 'building') game?.select({ k: 'building', id: /** @type {number} */ (at.id), node });
		game?.focus(node);
	}
	/** @param {string} m @param {string} [type] */
	function tool(m, type = '') {
		if (m === 'build' && !type) {
			menuOpen = !menuOpen;
			if (menuOpen) (marketOpen = false), (treeOpen = false);
			if (!menuOpen && mode === 'build') game?.setMode('look');
			return;
		}
		menuOpen = false;
		game?.setMode(mode === m && !type ? 'look' : /** @type {import('./game.js').Mode} */ (m), type);
	}
	/** start the simulation (ten years in ten real minutes, autoplay growing the first village full), or stop it and go back */
	function simulate() {
		if (!game) return;
		if (!simulating) {
			before = speed;
			game.setSpeed(SIM_SPEED);
			game.simulate(true);
			simulating = true;
		} else stopSim();
		refresh();
	}
	function stopSim() {
		if (!game) return;
		game.simulate(false);
		simulating = false;
		if (before !== null) {
			game.setSpeed(before || 1);
			before = null;
		}
	}
	/** buy a ware from the world market for the village shown, or sell it one */
	function trade(/** @type {'buy' | 'sell'} */ how, /** @type {string} */ w) {
		if (!game || !home) return;
		const r = how === 'buy' ? game.sim.buy(home.node, w, 1) : game.sim.sell(home.node, w, 1);
		buyWhy = r.ok ? '' : r.why ?? '';
		refresh();
	}
	/** let a ware trade by itself: bought when short, its surplus exported (or not) */
	function auto(/** @type {string} */ w, /** @type {boolean} */ on) {
		game?.sim.order(w, on ? 'both' : null);
		refresh();
	}
	function newValley() {
		if (!confirm('Start a new valley? This one will be gone.')) return;
		game?.restart();
		seenMsg = -1;
		toasts = [];
		refresh();
	}

	let timer = 0;
	onMount(() => {
		narrow = matchMedia('(max-width: 720px)').matches;
		requestAnimationFrame(async () => {
			const { mountGame } = await import('./game.js');
			if (!stage) return;
			game = mountGame(stage, {
				onSelect: (s) => select(s),
				onMode: (m, t) => {
					mode = m;
					buildType = t;
					speed = game?.speed ?? 1;
				},
				onHint: (t) => (hint = t)
			});
			// what was already said before this visit is not news
			seenMsg = game.sim.state.time > 20 ? game.sim.state.msgSeq ?? 0 : -1;
			refresh();
			loading = false;
			timer = window.setInterval(refresh, 300);
		});
	});
	onDestroy(() => {
		clearInterval(timer);
		game?.dispose();
	});

	const sitesCost = (/** @type {Record<string, number>} */ cost) => Object.entries(cost);
	const chainOf = (/** @type {any} */ t) => {
		const r = RECIPES[t.id];
		if (r) return `On a ${BIOMES[/** @type {keyof typeof BIOMES} */ (r.biome)].label.toLowerCase()} hex: ${LAND[/** @type {keyof typeof LAND} */ (r.land)].label} → ${label(t.out).toLowerCase()}, grows in ${r.stages.length} stages`;
		return t.kind === 'centre' ? 'Its village’s storehouse, market, hall and geothermal power plant' : t.kind === 'house' ? 'Beds for 2, doubling each time it is enlarged, up to 248; plants its hex’s food forest' : '';
	};
</script>

<div class="valley">
	<div class="stage" bind:this={stage} role="application" aria-label="Sandbox 5: the valley. Drag to turn the map, scroll to zoom, click to select or build"></div>
	<WorldBar title="avenCITY Sandbox 5" subtitle="A valley of settlers · villages, trade routes underground" />
	{#if summary}
		<div class="cash" class:up={cash > 0.05} class:down={cash < -0.05} title="Your goal: become a prosumer, cashflow positive, exporting more to the world market than you import from it. What all your villages take in by exports, less what they pay for imports (food, water, power, planks, steel, glass), a week lately; the HEARTs your settlers issue are not counted.">
			<span class="big">Cashflow <b>{signed(cash)}</b> gold a week</span>
			<small>exports {goldOf(summary.cash.exp / EUR_PER_GOLD)} · imports {goldOf(summary.cash.imp / EUR_PER_GOLD)} · goal: positive</small>
		</div>
	{/if}
	<TouchStick move={(x, y, hurry) => game?.move(x, y, hurry)} {stage} taps=".tools button, .panel button, .card button" />

	<!-- the tools, down the left -->
	<nav class="tools" aria-label="Tools">
		<button class:on={mode === 'build' || menuOpen} onclick={() => tool('build')} title="Build (choose a building)"><span class="ic">⌂</span>Build</button>
		<button class:on={mode === 'road'} onclick={() => tool('road')} title="Road (R)"><span class="ic">⟋</span>Road</button>
		<button class:on={mode === 'demolish'} onclick={() => tool('demolish')} title="Tear down (X)"><span class="ic">✕</span>Tear down</button>
		<button class:on={treeOpen} onclick={() => ((treeOpen = !treeOpen), (menuOpen = false), (marketOpen = false), refresh())} title="The building tree: every chain and every stage of its buildings"><span class="ic">⌥</span>Tree</button>
		<button class:on={marketOpen} onclick={() => ((marketOpen = !marketOpen), (menuOpen = false), (treeOpen = false), (buyWhy = ''))} title="The world market: buy and sell, and what your village trades a week"><span class="ic">⇄</span>Market</button>
		<div class="speed" role="group" aria-label="Speed: how much of the calendar a real day holds">
			<button class:on={speed === 0} onclick={() => (game?.setSpeed(0), (speed = 0))} title="Pause (Space)">❚❚</button>
			{#each SPEEDS as x (x.s)}
				<button class:on={speed === x.s} onclick={() => (game?.setSpeed(x.s), (speed = x.s))} title="{x.about[0].toUpperCase()}{x.about.slice(1)} ({x.s}×)">{x.short}</button>
			{/each}
		</div>
		<p class="speednote">{speed === SIM_SPEED ? 'ten years in ten real minutes' : speed ? `${SPEEDS.find((x) => x.s === speed)?.about ?? `${speed}×`}` : 'Paused'}</p>
		<button class="sim" class:on={simulating} onclick={simulate} title={simulating ? 'Stop the simulation and play on yourself' : 'Simulate: autoplay builds at ten years in ten real minutes, growing your first village until all six houses hold 248 people'}>{simulating ? '■ Stop' : '▶ Simulate'}</button>
		{#if simNote && (simulating || simNote.done)}
			<p class="simnote">{simNote.done ? `${simNote.name} is full: ${num(simNote.pop)} people, on ${when(simNote.date)}` : `${simNote.name}: ${num(simNote.pop)} of ${num(simNote.cap)} people · ${when(simNote.date)}`}</p>
		{/if}
		<button class="quiet" onclick={newValley} title="Start a new valley">New valley</button>
	</nav>

	{#if menuOpen}
		<section class="panel menu" aria-label="Build menu">
			<div class="tabs" role="tablist">
				{#each MENU as m (m.group)}
					<button role="tab" aria-selected={group === m.group} class:on={group === m.group} onclick={() => (group = m.group)}>{m.group}</button>
				{/each}
			</div>
			<ul>
				{#each MENU.find((m) => m.group === group)?.types ?? [] as t (t.id)}
					<li>
						<button class:on={buildType === t.id} onclick={() => tool('build', t.id)}>
							<strong>{t.label}</strong>
							<span class="chain">{chainOf(t)}</span>
							<span class="cost">
								{#each sitesCost(t.cost) as [w, n] (w)}
									<span class="chip" class:short={(summary?.stock[w] ?? 0) < n}><i style:background={WARES[w].color}></i>{ware(n)} {nameOf(w)}</span>
								{/each}
								<span class="chip" title="Its builders' energy: their cranes, welding and presses"><i class="bolt"></i>{fmt(buildOf(t.cost).energy)} energy</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
			<p class="tip">{MENU.find((m) => m.group === group)?.types[0]?.about}</p>
		</section>
	{/if}

	<!-- your village, on the right: what it has against what it needs -->
	{#if home && summary}
		<aside class="side">
			<section class="panel village" aria-label="{home.name}: what it has, against what it needs">
				{#if ownCentre}<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>{/if}
				<p class="eyebrow">Your village{ownCentre ? ' · village center' : ''}</p>
				<h2>{home.name}</h2>
				{#if home.villages.length > 1}
					<div class="tabs" role="group" aria-label="Your villages">
						{#each home.villages as v (v.node)}<button class:on={v.node === home.node} onclick={() => pickVillage(v.node)}>{v.name}</button>{/each}
					</div>
				{/if}
				<p class="label stats cashline" title="What it took in by exports to the world market and sales to your other villages, less what it paid for imports from them, a week lately. Your goal: more in than out">Cashflow <b class:debt={homeCash < -0.05} class:gain={homeCash > 0.05}>{signed(homeCash)}</b> gold a week · exports {goldOf(home.cash.exp / EUR_PER_GOLD)} · imports {goldOf(home.cash.imp / EUR_PER_GOLD)}</p>
				<p class="label stats" title="Its settlers add a HEART each an in-game hour to its treasury (720 a month each, a thousandth of a gold): {gold(home.income)} gold a week. What it lacks to pay, it borrows">{home.pop}/{home.beds} beds · <b class:debt={home.gold < 0}>{goldOf(home.gold)}</b> gold</p>
				{#if home.loan}<p class="label stats" title="What its treasury lacked it borrowed: an annuity loan over fifteen years at 1% a month. It pays the same each month, interest and repayment together, so it owes less each month">Loan <b class="debt">{gold(home.loan.left)}</b> gold · pays {gold(home.loan.pay)} a month · {span(home.loan.months)} left</p>{/if}
				<ul class="wants" aria-label="Its core resources: what it makes or has, against what it needs">
					{#if fd}
						<li class:short={fd.short} title="Food a week, a food being a tonne: its forests grow {food(fd.grown)} ({Math.round(fd.share * 100)}%, forests in year {fd.year}) of the {food(fd.week)} its people eat. {fd.buy >= 1 ? `It buys ${food(fd.buy)}, ${gold(fd.buy * fd.perKg)} gold.` : fd.exported >= 1 ? `It exports ${food(fd.exported)}, ${gold(fd.exported * PRICE.world)} gold.` : ''} {food(fd.kg)} in store.">
							<span class="k">Food</span>
							<span class="bar"><span class={fd.short ? 'poor' : fd.share >= 0.999 ? 'good' : 'fair'} style:width="{Math.min(100, fd.share * 100)}%"></span></span>
							<span class="n">{food(fd.grown)}<em>/{food(fd.week)}</em></span>
						</li>
					{/if}
					{#if wt}
						<li class:short={wt.short} title="Water a week, a water being a m³ (1,000 L): its roofs catch {water(wt.rain)} of {MONTHS[wt.month - 1]} rain against the {water(wt.week)} of fresh water its people use; its crops take {water(wt.grey)} of greywater again. Its tanks hold {water(wt.litres)} of {water(wt.tank)}.{wt.bought >= 1 ? ` It buys ${water(wt.bought)}, ${gold(wt.spent)} gold.` : ''}">
							<span class="k">Water</span>
							<span class="bar"><span class={wt.short ? 'poor' : wt.rain >= wt.week ? 'good' : 'fair'} style:width="{Math.min(100, (wt.rain / Math.max(1, wt.week)) * 100)}%"></span></span>
							<span class="n">{water(wt.rain)}<em>/{water(wt.week)}</em></span>
						</li>
					{/if}
					{#if pw}
						<li class:short={pw.short} title="Energy a week, an energy being a MWh: geothermal {energy(pw.well)} (stage {pw.wells} of {ENERGY.wellsMost}) and solar {energy(pw.sun)} ({MONTHS[pw.month - 1]} sun), against homes {energy(pw.home)}, dome climate {energy(pw.climate)}, village center {energy(pw.centre)} and factories {energy(pw.work)} (their work, building and upkeep). To the grid {energy(pwGrid)}, {gold(pwEur)} gold.">
							<span class="k">Energy</span>
							<span class="bar"><span class={pw.short ? 'poor' : pwMade >= pwUsed ? 'good' : 'fair'} style:width="{Math.min(100, (pwMade / Math.max(1, pwUsed)) * 100)}%"></span></span>
							<span class="n">{energy(pwMade)}<em>/{energy(pwUsed)}</em></span>
						</li>
					{/if}
					{#each home.rows as r (r.key)}
						<li class:short={r.short} title="{r.label}, a tonne each: {ware(r.have)} in store, needs {ware(r.need)} for its homes' upkeep, its building sites and its factories">
							<span class="k">{r.label}</span>
							<span class="bar"><span class={r.short || r.have < r.need / 2 ? 'poor' : r.have < r.need ? 'fair' : 'good'} style:width="{Math.min(100, (r.have / Math.max(1, r.need)) * 100)}%"></span></span>
							<span class="n">{ware(r.have)}<em>/{ware(r.need)}</em></span>
						</li>
					{/each}
				</ul>
				{#if ownCentre && pw?.drill}
					<div class="actions"><button class="go" onclick={drill} title="Drill two more geothermal producers under its village center: {ENERGY.wellKw / 1000} MW more, {energy(ENERGY.wellKw * 168 * ENERGY.uptime)} energy a week, paid in gold by the treasuries joined to it (what they lack, borrowed)">Drill two producers · {gold(pw.drill)} gold</button></div>
					{#if drillWhy}<p class="status">{drillWhy}</p>{/if}
				{/if}
				{#each home.notes as x, k (k)}
					<button class="note {x.tone}" onclick={() => game?.focus(x.node)}><i></i>{x.text}</button>
				{/each}
				{#if ownCentre && links.length}
					<p class="label">Trade routes, under the ground</p>
					<ul class="routes">
						{#each links as l (l.id)}
							<li>
								<button class="name" onclick={() => game?.focus(l.node)}>{l.name}{l.mine ? '' : ' · city'}</button>
								{#if l.joined}<span class="joined">Joined</span>{:else}<button class="go" title="Two arched cells for 40 ft containers, laid dry of {ware(l.cost)} fired clay voussoirs: from your stores, and what they lack from the world market, {gold(l.eur)} gold" onclick={() => connect(l.id)}>Connect · {ware(l.cost)} fired clay{l.eur > 0 ? ` · ${gold(l.eur)} gold` : ''}</button>{/if}
							</li>
						{/each}
					</ul>
					{#if linkWhy}<p class="status">{linkWhy}</p>{/if}
				{/if}
				{#if ownCentre}
					<div class="actions"><button onclick={() => game?.setMode('road')}>Path from here</button></div>
				{/if}
				<p class="people small">Year {summary.date.year} · month {summary.date.month} · day {summary.date.day} · {summary.people} people · {summary.villages} {summary.villages === 1 ? 'village' : 'villages'}</p>
			</section>
		</aside>
	{/if}

	<!-- the world market, a card of its own from the left: what the shown village buys and sells, and its trade a week -->
	{#if marketOpen && home}
		<section class="panel market" aria-label="World market">
			<button class="close" onclick={() => (marketOpen = false)} aria-label="Close">×</button>
			<p class="eyebrow">World market · {home.name}</p>
			<h2>Trade</h2>
			<p class="label stats" title="What it took in by exports to the world market and sales to your other villages, less what it paid for imports from them, a week lately. Your goal: more in than out">Cashflow <b class:debt={homeCash < -0.05} class:gain={homeCash > 0.05}>{signed(homeCash)}</b> gold a week · {goldOf(home.gold)} gold in its treasury</p>
			<ul class="buy">
				{#each home.world as x (x.w)}
					<li title="{label(x.w)}: {x.unit}, {gold(x.eur / LOAD_T)} gold a tonne. Bought or sold at this village center's storehouse, a truckload of {LOAD_T} at a time, at once; what its treasury lacks it borrows.">
						<span class="k"><i style:background={WARES[x.w]?.color}></i>{label(x.w)}</span>
						<span class="n">{gold(x.eur / LOAD_T)} gold</span>
						<button onclick={() => trade('buy', x.w)}>Buy {LOAD_T}</button>
						<button onclick={() => trade('sell', x.w)} disabled={x.have < 1}>Sell {LOAD_T}</button>
						<button class="auto" class:on={x.order === 'both'} onclick={() => auto(x.w, x.order !== 'both')} title="By itself: bought when your villages run short, and what they have beyond exported, so its makers never rest">Auto</button>
					</li>
				{/each}
				<li title="Each village buys what its food forests do not grow and exports what they grow beyond two weeks put by; a food is a tonne"><span class="k">Food</span><span class="n">{gold(PRICE.world * 1000)} gold</span><em>by itself</em></li>
				<li title="Each village buys what its rain does not give once its tanks run dry, by itself; a water is a m³, 1,000 L"><span class="k">Water</span><span class="n">{gold(WATER_PRICE * 1000)} gold</span><em>by itself</em></li>
				<li title="Each village sells the world grid the energy it has over, and buys what it lacks, by itself; an energy is a MWh"><span class="k">Energy</span><span class="n">{gold(GRID_EUR_KWH * 1000)} gold</span><em>by itself</em></li>
			</ul>
			<section class="ledger" aria-label="A week of trade">
				<p class="ledger-head"><b>A week</b><span title="Every number is in one real unit: a ware, a food or a land's tonne, a water's m³, an energy's MWh; a gold is what 1,000 € of real prices buy">1 = {UNIT_OF.ware} · water {UNIT_OF.water} · energy {UNIT_OF.energy}</span></p>
				<dl>
					{#if fd && fd.buy >= 1}<dt title="What its forests do not grow: from your villages with more than two weeks put by, at half the world's price, else from the world market">Food bought</dt><dd class="debt">{food(fd.buy)} food · −{gold(fd.buy * fd.perKg)} gold</dd>{/if}
					{#if fd && fd.exported >= 1}<dt title="What its forests grow beyond what its people eat">Food exported</dt><dd class="gain">{food(fd.exported)} food · +{gold(fd.exported * PRICE.world)} gold</dd>{/if}
					{#if wt && wt.bought >= 1}<dt title="What its rain does not give while its tanks are dry">Water bought</dt><dd class="debt">{water(wt.bought)} water · −{gold(wt.spent)} gold</dd>{/if}
					{#if pw}<dt title="What it has over goes to the world grid, and what it lacks the grid sells it, after your villages joined to it share theirs; lately">Energy to the grid</dt><dd class:gain={pwGrid > 0.5} class:debt={pwGrid < -0.5}>{pwGrid > 0.5 ? '+' : ''}{energy(pwGrid)} energy · {pwEur > 0.5 ? '+' : ''}{gold(pwEur)} gold</dd>{/if}
					{#if home.wares >= 1}<dt title="Planks, steel, fired clay and glass bought from the world market, lately">Spent on wares</dt><dd class="debt">−{gold(home.wares)} gold</dd>{/if}
					{#if home.interest >= 1}<dt title="1% a month on what it owes">Loan interest</dt><dd class="debt">−{gold(home.interest)} gold</dd>{/if}
					{#if home.repaid >= 1}<dt title="Its loan's payments, interest and repayment together">Loan payments</dt><dd class="debt">−{gold(home.repaid)} gold</dd>{/if}
					{#if home.borrowed >= 1}<dt title="What its treasury lacked to pay, lately">Borrowed</dt><dd>+{gold(home.borrowed)} gold</dd>{/if}
					<dt title="What its settlers issue into its treasury: a HEART each an in-game hour, a thousandth of a gold">HEARTs issued</dt><dd>+{gold(home.income)} gold</dd>
				</dl>
			</section>
			{#if buyWhy}<p class="status">{buyWhy}</p>{/if}
		</section>
	{/if}

	{#if treeOpen && summary}
		<Tree stock={summary.stock} {owned} onBuild={(t) => ((treeOpen = false), tool('build', t))} onClose={() => (treeOpen = false)} />
	{/if}


	<!-- the card of what is selected (a village center of yours is the right side itself) -->
	{#if card && !ownCentre}
		<section class="panel card" aria-label="{card.label}">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">{card.owner === PLAYER ? (card.stage === 'site' ? 'Building site' : 'Yours') : 'A neighbour city'}</p>
			<h2>{card.name || card.label}</h2>
			<p class="about">{card.about}</p>
			{#if card.status}<p class="status">{card.status}</p>{/if}
			{#if card.stage === 'site'}
				<div class="bar"><span style:width="{card.progress * 100}%"></span></div>
				<ul class="needs">
					{#each card.cost as c (c.ware)}
						<li><i style:background={WARES[c.ware].color}></i>{label(c.ware)} <b>{ware(c.have)} of {ware(c.need)}</b>{#if c.coming}<em> · {ware(c.coming)} coming</em>{/if}</li>
					{/each}
				</ul>
			{:else if card.party}
				<p class="label">{card.party.pop} people{card.party.beds !== undefined ? ` in ${card.party.beds} beds` : ''}</p>
				<p class="label">In store</p>
				<ul class="wares tight">
					{#each Object.entries(card.stock ?? card.party.stock).filter(([w, n]) => WARES[w] && n >= 1) as [w, n] (w)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span><b>{ware(Math.floor(/** @type {number} */ (n)))}</b></li>{/each}
				</ul>
			{/if}
			{#if card.stock && card.owner === PLAYER && card.stage === 'live'}
				<p class="label">{card.settlers} settlers free</p>
			{/if}
			{#if card.type === 'house' && card.level}
				<p class="label">{HOUSE_SIZE[card.level - 1]} · home of <b>{card.beds}</b> settlers{card.upgrading ? ` · growing to ${HOUSE_BEDS[card.level]}` : ''}</p>
				{#if card.owner === PLAYER && card.up && !card.upgrading}
					<div class="actions">
						<button class="go up" title="Enlarge to {HOUSE_BEDS[card.level]} settlers. Its build: {side(buildOf(card.up), ', ')}, from your stores (what they lack, bought)" onclick={() => card && ((upWhy = game?.sim.upgrade(card.id)?.why ?? ''), refresh())}>Enlarge → {HOUSE_BEDS[card.level]}{#each Object.entries(card.up) as [w, n] (w)}<span class="cost"><i style:background={WARES[w].color}></i>{ware(n)}</span>{/each}<span class="cost"><i class="bolt"></i>{fmt(buildOf(card.up).energy)}</span></button>
					</div>
					{#if upWhy}<p class="status">{upWhy}</p>{/if}
				{/if}
			{/if}
			{#if card.recipe && card.level}
				<!-- a factory: its stage, and its three recipes (./rules.js RECIPES), in units -->
				<p class="label">{card.recipe.label} · stage <b>{card.level}</b> of {card.stages}{card.upgrading && card.next ? ` · growing to a ${card.next.label.toLowerCase()}` : ''}</p>
				<dl class="recipe">
					<dt title="A round of its work: what it takes from its hex's land and the grid, and what it makes">Makes</dt>
					<dd>{Object.keys(card.recipe.make.out).length ? `${craftLine(card.recipe.make)}, ${card.rounds} rounds a year` : `It ${card.recipe.does}`}</dd>
					<dt title="What standing takes a year: 2% of what it is built of, and its dome's energy">Keeps</dt>
					<dd>{side(card.recipe.keep.in, ', ')} a year</dd>
					{#if Object.keys(card.recipe.make.out).length}<dt title="What it made a week, lately">Lately</dt><dd>{ware(card.lately)} {nameOf(card.out)} a week{card.type === 'ironmine' ? ` · ore for ${num(card.deposit / card.rounds)} years` : ''}</dd>{/if}
				</dl>
				{#if card.owner === PLAYER && card.up && !card.upgrading && card.next}
					<div class="actions">
						<button class="go up" title="Upgrade to a {card.next.label.toLowerCase()}: {Object.keys(card.next.make.out).length ? craftLine(card.next.make) : card.next.does}, {card.rounds} rounds a year. Its build: {side(card.next.build.in, ', ')}" onclick={() => card && ((upWhy = game?.sim.upgrade(card.id)?.why ?? ''), refresh())}>Upgrade → {card.next.label}{#each Object.entries(card.up) as [w, n] (w)}<span class="cost"><i style:background={WARES[w].color}></i>{ware(n)}</span>{/each}<span class="cost"><i class="bolt"></i>{fmt(card.next.build.in.energy ?? 0)}</span></button>
					</div>
					{#if upWhy}<p class="status">{upWhy}</p>{/if}
				{/if}
			{/if}
			{#if card.power && card.owner === PLAYER}
				<p class="small" title="Energy a week, an energy being a MWh: a house's solar glass and what its people use at home, a factory's work and its dome's upkeep">Energy a week: {powerLine(card.power, card.type)}</p>
			{/if}
			{#if card.stage === 'live' && card.worker}
				{#if card.inputs.length}
					<ul class="needs">
						{#each card.inputs as s, k (k)}
							<li>
								{#each s.types as w (w)}<i style:background={WARES[w].color} title={label(w)}></i>{/each}
								{s.types.map(label).join(' or ')}
								<b>{s.have}</b>{#if s.coming}<em> · {s.coming} coming</em>{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if card.out}<p class="label">Makes <i class="dot" style:background={WARES[card.out].color}></i>{label(card.out)}</p>{/if}
				<p class="label">Busy <b>{card.eff}%</b></p>
				<div class="bar"><span style:width="{card.eff}%"></span></div>
			{/if}
			{#if card.owner === PLAYER}
				<div class="actions">
					{#if card.stage === 'live' && card.worker}<button onclick={() => (game?.sim.pause(card?.id ?? 0, !card?.paused), refresh())}>{card.paused ? 'Resume' : 'Pause'}</button>{/if}
					<button onclick={() => game?.setMode('road')}>Path from here</button>
					{#if card.type !== 'centre'}<button class="danger" onclick={() => (game?.sim.demolish(card?.node ?? -1), game?.select(null))}>Tear down</button>{/if}
				</div>
			{/if}
		</section>
	{:else if flagCard}
		<section class="panel card" aria-label="Stop">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">{flagCard.owner === PLAYER ? 'Yours' : 'A neighbour’s'}{flagCard.bld ? ` · ${flagCard.bld}` : ''}</p>
			<h2>Stop</h2>
			<p class="about">The middle of a settlement, where its paths meet. Wares wait here for a bus: {flagCard.wares.length} of 8.</p>
			<ul class="wares tight">
				{#each flagCard.wares as w, k (k)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span></li>{/each}
			</ul>
			{#if flagCard.owner === PLAYER}
				<div class="actions">
					<button onclick={() => game?.setMode('road')}>Path from here</button>
					<button class="danger" onclick={() => (game?.sim.demolish(selected?.node ?? -1), game?.select(null))}>Tear down</button>
				</div>
			{/if}
		</section>
	{:else if roadCard}
		<section class="panel card" aria-label="Road">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">Your path</p>
			<h2>Path · {roadCard.steps} steps</h2>
			<p class="about">{roadCard.carrier ? (roadCard.busy ? 'Its bus is carrying a ware.' : 'Its bus waits for work.') : 'Waiting for a bus.'} A path runs from the middle of one settlement to the middle of the next.</p>
			<div class="actions">
				<button class="danger" onclick={() => (game?.sim.demolish(selected?.node ?? -1), game?.select(null))}>Tear down</button>
			</div>
		</section>
	{/if}

	<div class="news" aria-live="polite">
		{#each toasts as t (t.key)}
			<button class="toast {t.tone}" onclick={() => t.node >= 0 && game?.focus(t.node)}>{t.text}</button>
		{/each}
	</div>
	{#if hint && mode !== 'look'}<p class="hint">{hint}</p>{/if}

	{#if loading}
		<div class="loading" role="status"><p class="eyebrow">avenCITY Sandbox 5</p><strong>A valley of settlers</strong><span>Growing the valley…</span></div>
	{/if}
</div>

<style>
	.valley {
		position: fixed;
		inset: 0;
		background: #2d5a6a;
		color: #1f2a23;
		font-size: 0.85rem;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: crosshair;
	}
	.panel,
	.tools button,
	.toast,
	.hint {
		background: rgb(250 248 242 / 0.86);
		border: 1px solid rgb(255 255 255 / 0.5);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		backdrop-filter: blur(14px) saturate(1.2);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
	}
	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	i {
		display: inline-block;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 3px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
		flex: none;
	}
	.tools {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 7.2rem;
	}
	.tools > button {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.7rem;
		border-radius: 999px;
		text-align: left;
	}
	.tools .ic {
		width: 1rem;
		text-align: center;
		opacity: 0.75;
	}
	.tools button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.speed {
		display: flex;
		gap: 0.2rem;
		margin-top: 0.4rem;
	}
	.speed button {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0;
		border-radius: 999px;
		font-size: 0.66rem;
		text-align: center;
		justify-content: center;
	}
	.tools .sim {
		justify-content: center;
		font-size: 0.78rem;
	}
	.speednote {
		margin: -0.2rem 0 0;
		padding: 0 0.4rem;
		color: #f4f1e8;
		font-size: 0.64rem;
		line-height: 1.25;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.45);
	}
	.simnote {
		margin: 0;
		padding: 0.35rem 0.55rem;
		border-radius: 12px;
		background: rgba(244, 241, 232, 0.88);
		color: #24452f;
		font-size: 0.7rem;
		line-height: 1.3;
	}
	.tools .quiet {
		margin-top: 0.4rem;
		font-size: 0.72rem;
		opacity: 0.85;
		justify-content: center;
	}
	.panel {
		border-radius: 16px;
		padding: 0.7rem 0.8rem;
	}
	.menu {
		position: absolute;
		z-index: 3;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(9rem + env(safe-area-inset-left, 0px));
		width: min(22rem, calc(100vw - 2rem));
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.tabs button {
		padding: 0.3rem 0.65rem;
		border: 0;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.07);
		font-size: 0.75rem;
	}
	.tabs button.on {
		background: #24452f;
		color: #f4f1e8;
	}
	.menu ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.35rem;
	}
	.menu li button {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1px solid rgb(31 42 35 / 0.08);
		border-radius: 12px;
		background: rgb(255 255 255 / 0.55);
		text-align: left;
	}
	.menu li button:hover,
	.menu li button.on {
		border-color: #3d6b34;
		background: rgb(255 255 255 / 0.9);
	}
	.chain {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.cost {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.15rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.72rem;
	}
	.chip.short {
		color: #b23b2f;
	}
	.tip {
		margin: 0.5rem 0 0;
		font-size: 0.72rem;
		opacity: 0.6;
	}
	.side {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		right: calc(1rem + env(safe-area-inset-right, 0px));
		width: 17rem;
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.side .village {
		position: relative;
		overflow: auto;
	}
	.village h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	.village .tabs {
		margin: 0.2rem 0 0;
	}
	.people {
		font-weight: 400;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.small {
		margin: 0.4rem 0 0;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.wares {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.15rem 0.6rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}
	.wares li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
	}
	.wares li span {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wares.tight {
		grid-template-columns: 1fr 1fr 1fr;
	}
	.card {
		position: absolute;
		z-index: 3;
		right: calc(19rem + env(safe-area-inset-right, 0px));
		top: calc(5rem + env(safe-area-inset-top, 0px));
		width: 17rem;
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.card .close,
	.village .close {
		position: absolute;
		top: 0.4rem;
		right: 0.5rem;
		border: 0;
		background: none;
		font-size: 1.2rem;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.card h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	.about {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		line-height: 1.35;
		opacity: 0.8;
	}
	.status {
		margin: 0.3rem 0;
		padding: 0.3rem 0.55rem;
		border-radius: 8px;
		background: rgb(61 107 52 / 0.12);
		font-size: 0.76rem;
	}
	.label {
		margin: 0.5rem 0 0.25rem;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.78rem;
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		background: rgb(31 42 35 / 0.1);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: #3d6b34;
	}
	.needs {
		margin: 0.45rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.25rem;
		font-size: 0.76rem;
	}
	.needs li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.needs b {
		margin-left: auto;
	}
	.needs em {
		font-style: normal;
		opacity: 0.6;
	}
	.trend.t1 {
		color: #2f7a3a;
	}
	.trend.t-1 {
		color: #a3322a;
	}
	.up {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		white-space: nowrap;
	}
	.up .cost {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8em;
		opacity: 0.85;
	}
	.up .cost i {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
	}
	.label.stats {
		display: block;
		line-height: 1.4;
	}
	.ledger {
		margin: 0.55rem 0 0;
		font-size: 0.74rem;
	}
	.ledger-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0 0 0.25rem;
	}
	.ledger-head span {
		font-size: 0.68rem;
		opacity: 0.7;
	}
	i.bolt {
		background: #e8b730;
	}
	.recipe {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.6rem;
		margin: 0.3rem 0 0.2rem;
		font-size: 0.74rem;
		line-height: 1.35;
	}
	.recipe dt {
		font-weight: 600;
		opacity: 0.65;
	}
	.recipe dd {
		margin: 0;
	}
	.ledger dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.1rem 0.6rem;
		margin: 0.35rem 0 0;
	}
	.ledger dt {
		opacity: 0.7;
	}
	.ledger dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.debt {
		color: #a3322a;
	}
	.buy {
		display: grid;
		gap: 0.2rem;
		margin: 0.3rem 0 0;
		padding: 0;
		list-style: none;
	}
	.buy li {
		display: grid;
		grid-template-columns: 1fr auto 2.3rem 2.3rem 2.3rem;
		align-items: center;
		gap: 0.3rem;
		min-height: 1.5rem;
	}
	.buy .k {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.buy .n {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.buy button {
		padding: 0.2rem 0;
		border: 1px solid #24452f;
		border-radius: 999px;
		background: #24452f;
		color: #f4f1e8;
		font-size: 0.62rem;
	}
	.buy button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.buy button.auto {
		background: transparent;
		color: #24452f;
	}
	.buy button.auto.on {
		background: #2f7a3a;
		border-color: #2f7a3a;
		color: #f4f1e8;
	}
	.buy em {
		grid-column: span 3;
		font-style: normal;
		font-size: 0.64rem;
		opacity: 0.6;
		text-align: center;
	}
	.cashline b {
		font-variant-numeric: tabular-nums;
	}
	.cash {
		position: absolute;
		z-index: 3;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.35rem 1rem 0.4rem;
		border-radius: 18px;
		background: rgb(250 248 242 / 0.9);
		border: 1px solid rgb(255 255 255 / 0.5);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
		color: #1f2a23;
		line-height: 1.25;
		white-space: nowrap;
	}
	.cash .big {
		font-size: 0.95rem;
	}
	.cash .big b {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}
	.cash.up .big b {
		color: #2f7a3a;
	}
	.cash.down .big b {
		color: #a3322a;
	}
	.cash small {
		font-size: 0.66rem;
		opacity: 0.7;
	}
	.gain {
		color: #2f7a3a;
	}
	.wants {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.3rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.74rem;
	}
	.wants li {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: center;
		gap: 0.5rem;
	}
	.wants .k em {
		margin-left: 0.25rem;
		font-style: normal;
		font-size: 0.64rem;
		opacity: 0.55;
	}
	.wants .bar {
		height: 0.4rem;
		margin: 0;
	}
	.wants .n {
		white-space: nowrap;
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}
	.wants .n em {
		font-style: normal;
		font-weight: 400;
		opacity: 0.55;
	}
	.wants li.short .k,
	.wants li.short .n {
		color: #a3322a;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		margin: 0.3rem 0 0;
		padding: 0;
		border: 0;
		background: none;
		font-size: 0.7rem;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}
	.note i {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: #d19a1e;
	}
	.note.alert i {
		background: #c2412f;
	}
	.bar span.good {
		background: #3d8f4a;
	}
	.bar span.fair {
		background: #c79a1c;
	}
	.bar span.poor {
		background: #b8483a;
	}
	.market {
		position: absolute;
		z-index: 4;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(9rem + env(safe-area-inset-left, 0px));
		width: min(27rem, calc(100vw - 2rem));
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.trend {
		font-size: 0.62rem;
		opacity: 0.8;
		margin-left: 0.1rem;
	}
	.routes {
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.3rem;
		font-size: 0.75rem;
	}
	.routes li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: space-between;
	}
	.routes button.name {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.routes button.go {
		flex: none;
		padding: 0.3rem 0.65rem;
		border: 1px solid #24452f;
		border-radius: 999px;
		background: #24452f;
		color: #f4f1e8;
		font-size: 0.72rem;
	}
	.routes .joined {
		opacity: 1;
		color: #2e7a45;
		font-weight: 600;
	}
	.actions button.go {
		background: #24452f;
		color: #f4f1e8;
		border-color: #24452f;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.7rem;
	}
	.actions button,
	.go {
		padding: 0.4rem 0.75rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.76rem;
	}
	.go {
		background: #24452f;
		color: #f4f1e8;
		border-color: #24452f;
	}
	.danger {
		color: #a3322a;
	}
	.go.danger {
		background: #a3322a;
		color: #fff;
		border-color: #a3322a;
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
	}
	.news {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		width: min(26rem, calc(100vw - 20rem));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		font-size: 0.76rem;
		animation: in 240ms ease-out;
	}
	.toast.good {
		border-color: rgb(61 107 52 / 0.5);
	}
	.toast.alert {
		background: rgb(163 50 42 / 0.9);
		color: #fff;
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
	}
	.hint {
		position: absolute;
		z-index: 2;
		left: 50%;
		bottom: calc(1rem + var(--nav-room, 4rem));
		transform: translateX(-50%);
		margin: 0;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		font-size: 0.78rem;
		white-space: nowrap;
		pointer-events: none;
	}
	.loading {
		position: absolute;
		inset: 0;
		z-index: 7;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: #24452f;
		color: #f2efe7;
	}
	.loading .eyebrow {
		color: #f0c49a;
		opacity: 1;
	}
	.loading strong {
		font-family: var(--font-display, serif);
		font-size: clamp(2rem, 5vw, 3.2rem);
		font-weight: 400;
	}

	/* ── a narrow screen: the tools in a row along the top, the panels as sheets from the foot ── */
	@media (max-width: 720px) {
		.tools {
			top: calc(4.2rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			width: auto;
			flex-direction: row;
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.tools > button {
			flex: none;
			padding: 0.4rem 0.65rem;
			font-size: 0.76rem;
		}
		.speed {
			margin: 0;
			flex: none;
		}
		.speed button {
			width: 2.2rem;
		}
		.speednote {
			display: none;
		}
		.buy li {
			grid-template-columns: repeat(3, 1fr);
		}
		.buy .k {
			grid-column: span 2;
		}
		.buy em {
			display: none;
		}
		.cash {
			top: calc(6.7rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			transform: none;
			padding: 0.3rem 0.6rem;
		}
		.tools .quiet {
			margin: 0;
		}
		.menu {
			top: calc(9.4rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			width: calc(100vw - 1rem);
			max-height: 55vh;
		}
		.side {
			top: calc(9.4rem + env(safe-area-inset-top, 0px));
			right: 0.5rem;
			width: 13.5rem;
			max-height: 40vh;
		}
		.wares {
			grid-template-columns: 1fr;
		}
		.market {
			top: calc(9.4rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			width: calc(100vw - 1rem);
			max-height: 60vh;
		}
		.card {
			top: auto;
			right: 0.5rem;
			left: 0.5rem;
			bottom: calc(0.5rem + var(--nav-room, 4rem));
			width: auto;
			max-height: 45vh;
		}
		.news {
			top: auto;
			bottom: calc(3.5rem + var(--nav-room, 4rem));
			width: calc(100vw - 2rem);
		}
		.hint {
			white-space: normal;
			text-align: center;
			max-width: calc(100vw - 2rem);
		}
	}
</style>
