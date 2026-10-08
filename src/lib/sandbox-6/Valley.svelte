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
	import { BIOMES, BUILDINGS, LAND, LOAD_T, MENU, RECIPES, START, WARES, buildIn } from './rules.js';
	import { EUR_PER_GOLD, GRID_EUR_KWH } from './market.js';
	import { UNIT_OF, costLine, craftLine, energy, fmt, food, gold, nameOf, side, ware, water } from './units.js';
	import { MONTHS, PRICE, SIM_SPEED, SPEEDS, WATER_PRICE } from './food.js';
	import { PLAYER, levelOf } from './sim.js';
	import { mapFill } from './autoplay.js';
	import Tree from './Tree.svelte';
	import { stagesOf } from './tree.js';

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
	/** @type {{ villages: number, toFound: number, pop: number, cap: number, date: { year: number, month: number, day: number }, done: boolean } | null} */
	let simNote = $state(null);
	/** what a Buy button at the world market said when it could not */
	let buyWhy = $state('');
	let menuOpen = $state(false);
	/** on a phone: whether the tools are open from the action button */
	let toolsOpen = $state(false);
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
	/** your books, open under the cashflow in the top bar (./sim.js books) */
	let booksOpen = $state(false);
	/** @type {any} */
	let books = $state(null);
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
	/** what the Upgrade button of a village center said when it could not be paid */
	let growWhy = $state('');
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
	/** your cashflow and the shown village's, gold a week: exports less imports and upkeep */
	const cash = $derived.by(() => {
		const c = /** @type {{ exp: number, imp: number, upkeep: number } | undefined} */ (/** @type {any} */ (summary)?.cash);
		return c ? (c.exp - c.imp - c.upkeep) / EUR_PER_GOLD : 0;
	});
	const homeCash = $derived(home ? (home.cash.exp - home.cash.imp - home.cash.upkeep) / EUR_PER_GOLD : 0);
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
	/** the valley's own clock for the time control: its date and hour, running at the speed you play */
	const valleyClock = $derived.by(() => {
		const d = summary?.date;
		if (!d) return null;
		const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
		const h = Math.floor(d.hour), m = Math.floor((d.hour - h) * 60);
		return { day: `${pad(d.day)}.${pad(d.month)}.${pad(d.year % 100)}`, hour: `${pad(h)}:${pad(m)}`, about: "The valley's clock: it began at the real date and time you started it, and runs at the speed you play" };
	});
	/** the valley's date */
	const when = (/** @type {{ year: number, month: number, day: number }} */ d) => `year ${d.year}, month ${d.month}, day ${d.day}`;
	/** what a stage makes a week, as its recipe reads: land and energy in, a ware or energy out (or what it does) */
	const makeLine = (/** @type {{ make: { in: Record<string, number>, out: Record<string, number> }, does?: string }} */ s) =>
		Object.keys(s.make.out).length ? `${Object.keys(s.make.in).length ? craftLine(s.make) : side(s.make.out)} a week` : `It ${s.does || 'makes nothing'}`;
	/** a cost on a button: its wares, in units, and its builders' energy */
	const buildOf = (/** @type {Record<string, number>} */ loads) => buildIn(Object.fromEntries(Object.entries(loads).map(([w, n]) => [w, n * LOAD_T])));
	/** years and months, short */
	const span = (/** @type {number} */ months) => (!Number.isFinite(months) ? 'never' : months >= 12 ? `${fmt(months / 12)} years` : `${Math.ceil(months)} months`);

	function refresh() {
		if (!game) return;
		const sim = game.sim;
		summary = sim.summary();
		market = sim.market();
		books = booksOpen ? sim.books() : null;
		if (treeOpen) {
			/** @type {Record<string, number>} */
			const n = {};
			for (const b of Object.values(sim.state.buildings)) {
				if (b.owner !== PLAYER) continue;
				n[b.type] = (n[b.type] ?? 0) + 1;
				// and by the stage it stands at: a village center by its own (a logistics hub first)
				const lv = b.type === 'centre' ? (b.stage === 'live' ? levelOf(b) : 0) : b.level;
				if (lv) n[`${b.type}:${lv}`] = (n[`${b.type}:${lv}`] ?? 0) + 1;
			}
			owned = n;
		}
		speed = game.speed;
		// the simulation over the whole valley, and its end once every village that could be is founded and full
		if (simulating || simNote?.done) {
			const f = mapFill(sim, market.parties);
			simNote = { villages: f.villages, toFound: f.toFound, pop: f.pop, cap: f.cap, date: summary.date, done: f.full };
			if (simulating && f.full) {
				stopSim();
				game.setSpeed(0);
				speed = 0;
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
		growWhy = '';
		refresh();
	}
	/** grow the shown village's center to its next stage: a logistics hub into the village center and its geothermal plant */
	function grow() {
		const at = home && game?.sim.at(home.node);
		if (!game || at?.k !== 'building') return;
		const r = game.sim.grow(/** @type {number} */ (at.id));
		growWhy = r.ok ? '' : r.why ?? '';
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
		toolsOpen = false;
		if (m === 'build' && !type) {
			menuOpen = !menuOpen;
			if (menuOpen) (marketOpen = false), (treeOpen = false);
			if (!menuOpen && mode === 'build') game?.setMode('look');
			return;
		}
		menuOpen = false;
		game?.setMode(mode === m && !type ? 'look' : /** @type {import('./game.js').Mode} */ (m), type);
	}
	/** start the simulation (ten years in ten real minutes, autoplay founding and growing villages until the valley is full), or stop it and go back */
	function simulate() {
		if (!game) return;
		toolsOpen = false;
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
		toolsOpen = false;
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
		return t.kind === 'centre' ? 'A small store dome in a village’s middle hex; grows into its village center and geothermal power plant' : t.kind === 'house' ? 'Beds for 2, doubling each time it is enlarged, up to 248; plants its hex’s food forest' : '';
	};
</script>

<!-- a building's stage and its recipes, the same for every building that grows (./tree.js stagesOf: a home, a factory,
     a village center): what it makes, uses and costs to keep a week, and what it made lately -->
{#snippet stageInfo(/** @type {any[]} */ stages, /** @type {number} */ level, /** @type {{ upgrading?: boolean, lately?: string }} */ o)}
	{@const cur = stages[level - 1]}
	{@const next = stages[level] ?? null}
	{#if cur}
		<p class="label">{cur.label}{cur.beds ? ` · ${cur.beds} beds` : ''} · stage <b>{level}</b> of {stages.length}{o.upgrading && next ? ` · growing to ${next.label.toLowerCase()}` : ''}</p>
		<dl class="recipe">
			<dt title="What it makes a week, in-game, from its land and energy (working all its land gives it)">Makes</dt>
			<dd>{makeLine(cur)}</dd>
			<dt title="The energy it uses a week to stand">Uses</dt>
			<dd>{side(cur.use.in)} a week</dd>
			<dt title="Its upkeep a week, always in gold: 2% a year of what it is built of, at world prices">Upkeep</dt>
			<dd>{side(cur.keep.in)} a week</dd>
			{#if o.lately && Object.keys(cur.make.out).length}<dt title="What it made a week, lately">Lately</dt><dd>{o.lately}</dd>{/if}
		</dl>
	{/if}
{/snippet}
<!-- its upgrade to the next stage, with what that takes: for the foot of its card, beside its other buttons -->
{#snippet stageUp(/** @type {any[]} */ stages, /** @type {number} */ level, /** @type {Record<string, number> | null | undefined} */ up, /** @type {() => void} */ go)}
	{@const next = stages[level] ?? null}
	{#if next && up}
		<button class="go up grow" onclick={go} title="Upgrade to {next.label.toLowerCase()}: {makeLine(next)}. Its build: {side(next.build.in, ', ')}, from your stores (what they lack, bought){next.build.in.gold ? ' and its treasury (what it lacks, borrowed)' : ''}">
			<span>Upgrade → {next.label}</span>
			<span class="chips">
				{#each Object.entries(up) as [w, n] (w)}<span class="cost"><i style:background={WARES[w].color}></i>{ware(n)}</span>{/each}
				{#if next.build.in.energy}<span class="cost"><i class="bolt"></i>{fmt(next.build.in.energy)}</span>{/if}
				{#if next.build.in.gold}<span class="cost"><i class="coin"></i>{fmt(next.build.in.gold)}</span>{/if}
			</span>
		</button>
	{/if}
{/snippet}

<div class="valley">
	<div class="stage" bind:this={stage} role="application" aria-label="Sandbox 5: the valley. Drag to turn the map, scroll to zoom, click to select or build"></div>
	<WorldBar title="avenCITY #S5" clock={valleyClock} />
	{#if summary}
		<!-- three numbers for all your villages together, each known by its icon: cashflow (click it for your books),
		     treasury and settlers -->
		<div class="topstats">
			<button class="stat flow" class:up={cash > 0.05} class:down={cash < -0.05} aria-expanded={booksOpen} onclick={() => ((booksOpen = !booksOpen), refresh())} title="Cashflow, gold a week lately: what all your villages take in by exports to the world market, less what they pay it for imports and for their upkeep. Your goal: positive. Click for your books">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 11.5l4-4 3 3 6-6" /><path d="M10.5 4.5h4v4" /></svg>
				<b>{signed(cash)}</b><small>a week</small><i class="caret" aria-hidden="true"></i>
			</button>
			<span class="stat" class:down={(summary.stock.coin ?? 0) < 0} title="Treasury: the gold all your villages' treasuries hold now">
				<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="4" rx="5.5" ry="2" /><path d="M2.5 4v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4" /><path d="M2.5 8v4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V8" /></svg>
				<b>{goldOf(summary.stock.coin ?? 0)}</b>
			</span>
			<button class="stat" aria-expanded={ownCentre} onclick={() => (ownCentre ? game?.select(null) : home && pickVillage(home.node))} title="Settlers: the people living in all your villages, {summary.people} in {summary.beds} beds. Click for your village">
				<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.5" r="2.5" /><path d="M2.5 14.5c0-3.2 2.5-5.5 5.5-5.5s5.5 2.3 5.5 5.5" /></svg>
				<b>{fmt(summary.people)}</b>
			</button>
		</div>
		{#if booksOpen && books}
			{@const b = books}
			{@const costs = b.imports.food + b.imports.water + b.imports.energy + b.imports.wares + b.upkeep + b.repaid + b.demurrage}
			{@const income = b.exports.food + b.exports.energy + b.exports.wares + b.hearts + b.borrowed}
			{@const owns = Math.max(0, b.treasury) + b.stores + b.buildings}
			{@const owes = b.loan.left + Math.max(0, -b.treasury)}
			<!-- your books, as in the Cashflow game, two-sided (Samuel): a week's costs on the left against its income on the
			     right, then what you owe on the left against what you own on the right -->
			<section class="books" aria-label="Your books">
				<button class="close" onclick={() => (booksOpen = false)} aria-label="Close">×</button>
				<p class="eyebrow">Your books · all villages · in gold</p>
				<p class="sub">A week, lately</p>
				<div class="t">
					<div class="leg">
						<p class="head">Costs</p>
						<dl>
							<dt title="Food the world market sold your villages">Food bought</dt><dd>{gold(b.imports.food)}</dd>
							<dt title="Water the world market sold your villages">Water bought</dt><dd>{gold(b.imports.water)}</dd>
							<dt title="Energy the world grid sold your villages">Energy bought</dt><dd>{gold(b.imports.energy)}</dd>
							<dt title="Planks, steel, fired clay and glass the world market sold your villages">Wares bought</dt><dd>{gold(b.imports.wares)}</dd>
							<dt title="Keeping your homes, factories and village centers up: 2% a year of what they are built of">Upkeep</dt><dd>{gold(b.upkeep)}</dd>
							<dt title="Interest and repayment together; {gold(b.interest)} of it interest">Loan payments</dt><dd>{gold(b.repaid)}</dd>
							<dt title="What the treasuries hold loses 7% a year">Demurrage</dt><dd>{gold(b.demurrage)}</dd>
						</dl>
						<p class="sum"><span>Total</span><b class="debt">{gold(costs)}</b></p>
					</div>
					<div class="leg">
						<p class="head">Income</p>
						<dl>
							<dt title="Food the world market bought from your villages">Food sold</dt><dd>{gold(b.exports.food)}</dd>
							<dt title="Energy the world grid bought from your villages">Energy sold</dt><dd>{gold(b.exports.energy)}</dd>
							<dt title="Wares the world market bought from your villages">Wares sold</dt><dd>{gold(b.exports.wares)}</dd>
							<dt title="A HEART each settler issues an in-game hour into its village's treasury">HEARTs issued</dt><dd>{gold(b.hearts)}</dd>
							<dt title="What the treasuries lacked to pay, lent">Borrowed</dt><dd>{gold(b.borrowed)}</dd>
						</dl>
						<p class="sum"><span>Total</span><b class="gain">{gold(income)}</b></p>
					</div>
				</div>
				<p class="net" title="What all your villages sold the world market less what they bought from it and their upkeep. Your goal: positive"><span>Cashflow</span><b class:gain={b.cashflow > 50} class:debt={b.cashflow < -50}>{signed(b.cashflow / EUR_PER_GOLD)}</b></p>
				<p class="net" title="Income less costs: what the treasuries gained or lost"><span>Treasury change</span><b class:gain={income - costs > 50} class:debt={income - costs < -50}>{signed((income - costs) / EUR_PER_GOLD)}</b></p>
				<p class="sub">Balance sheet, now</p>
				<div class="t">
					<div class="leg">
						<p class="head">Liabilities</p>
						<dl>
							<dt title="What your villages still owe on their loans">Loans</dt><dd>{gold(b.loan.left)}</dd>
							{#if b.treasury < 0}<dt title="What the treasuries are short, beyond what they may borrow">Overdrawn</dt><dd>{gold(-b.treasury)}</dd>{/if}
						</dl>
						<p class="sum"><span>Total</span><b class="debt">{gold(owes)}</b></p>
					</div>
					<div class="leg">
						<p class="head">Assets</p>
						<dl>
							<dt>Treasury</dt><dd>{gold(Math.max(0, b.treasury))}</dd>
							<dt title="What your stores hold, at the world market's prices">Wares in store</dt><dd>{gold(b.stores)}</dd>
							<dt title="What your homes, factories and village centers are built of, at world prices, and your geothermal plants">Buildings</dt><dd>{gold(b.buildings)}</dd>
						</dl>
						<p class="sum"><span>Total</span><b class="gain">{gold(owns)}</b></p>
					</div>
				</div>
				<p class="net" title="Assets less liabilities"><span>Net worth</span><b class:gain={owns > owes} class:debt={owns < owes}>{signed((owns - owes) / EUR_PER_GOLD)}</b></p>
				<p class="small">{b.loan.left >= 1 ? `Loans pay ${gold(b.loan.pay)} a month, ${span(b.loan.months)} left · ` : ''}they may owe up to {gold(b.loan.most)}, 125 gold a settler · {fmt(b.people)} settlers in {fmt(b.beds)} beds</p>
			</section>
		{/if}
	{/if}
	<TouchStick move={(x, y, hurry) => game?.move(x, y, hurry)} {stage} taps=".tools button, .panel button, .card button, .fab" />

	<!-- the tools, down the left; on a phone, behind one action button at the foot on the right -->
	<button class="fab" class:on={toolsOpen} aria-expanded={toolsOpen} aria-label="Actions" title="Actions" onclick={() => (toolsOpen = !toolsOpen)}>
		<svg viewBox="0 0 24 24" aria-hidden="true">{#if toolsOpen}<path d="M6 6l12 12M18 6L6 18" />{:else}<path d="M4 7h16M4 12h16M4 17h16" />{/if}</svg>
	</button>
	<nav class="tools" class:open={toolsOpen} aria-label="Tools">
		<button class:on={mode === 'build' || menuOpen} onclick={() => tool('build')} title="Build (choose a building)"><span class="ic">⌂</span>Build</button>
		<button class:on={mode === 'road'} onclick={() => tool('road')} title="Road (R)"><span class="ic">⟋</span>Road</button>
		<button class:on={mode === 'demolish'} onclick={() => tool('demolish')} title="Tear down (X)"><span class="ic">✕</span>Tear down</button>
		<button class:on={treeOpen} onclick={() => ((treeOpen = !treeOpen), (menuOpen = false), (marketOpen = false), (toolsOpen = false), refresh())} title="The building tree: every chain and every stage of its buildings"><span class="ic">⌥</span>Tree</button>
		<button class:on={marketOpen} onclick={() => ((marketOpen = !marketOpen), (menuOpen = false), (treeOpen = false), (toolsOpen = false), (buyWhy = ''))} title="The world market: buy and sell, and what your village trades a week"><span class="ic">⇄</span>Market</button>
		<div class="speed" role="group" aria-label="Speed: how much of the calendar a real day holds">
			<button class:on={speed === 0} onclick={() => (game?.setSpeed(0), (speed = 0))} title="Pause (Space)">❚❚</button>
			{#each SPEEDS as x (x.s)}
				<button class:on={speed === x.s} onclick={() => (game?.setSpeed(x.s), (speed = x.s))} title="{x.about[0].toUpperCase()}{x.about.slice(1)} ({x.s}×)">{x.short}</button>
			{/each}
		</div>
		<p class="speednote">{speed === SIM_SPEED ? 'ten years in ten real minutes' : speed ? `${SPEEDS.find((x) => x.s === speed)?.about ?? `${speed}×`}` : 'Paused'}</p>
		<button class="sim" class:on={simulating} onclick={simulate} title={simulating ? 'Stop the simulation and play on yourself' : 'Simulate: autoplay builds at ten years in ten real minutes, founding and growing village after village until every village of the valley is full'}>{simulating ? '■ Stop' : '▶ Simulate'}</button>
		{#if simNote && (simulating || simNote.done)}
			<p class="simnote">{simNote.done ? `The valley is full: ${num(simNote.villages)} villages, ${num(simNote.pop)} people, on ${when(simNote.date)}` : `${num(simNote.villages)} ${simNote.villages === 1 ? 'village' : 'villages'}${simNote.toFound ? `, ${num(simNote.toFound)} to found` : ''} · ${num(simNote.pop)} of ${num(simNote.cap)} people · ${when(simNote.date)}`}</p>
		{/if}
		<button class="quiet" onclick={newValley} title="Start a new valley">New valley</button>
	</nav>

	{#if menuOpen}
		<section class="panel menu" aria-label="Build menu">
			<button class="close" onclick={() => tool('build')} aria-label="Close">×</button>
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

	<!-- a new valley: nothing stands yet; your first logistics hub, wherever you like -->
	{#if summary && !home && !simulating}
		<aside class="side">
			<section class="panel village" aria-label="A new valley">
				<p class="eyebrow">A new valley</p>
				<h2>Found your village</h2>
				<p class="label">Put up your logistics hub in the middle hex of a village: your {START.settlers} settlers bring it, with {costLine(START.stock)} in its store. Then build your first hut on a hex round it.</p>
				<div class="actions"><button class="go" onclick={() => tool('build', 'centre')}>Place your logistics hub</button></div>
				<p class="small">It grows into your village center later, with its geothermal plant. What its treasury lacks it borrows, up to 125 gold a villager.</p>
			</section>
		</aside>
	{/if}

	<!-- your village, on the right: what it has against what it needs -->
	{#if home && summary && ownCentre}
		<aside class="side">
			<section class="panel village" aria-label="{home.name}: what it has, against what it needs">
				<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
				<p class="eyebrow">Your village{ownCentre && card ? ` · ${card.label.toLowerCase()}` : ''}</p>
				<h2>{home.name}</h2>
				{#if home.villages.length > 1}
					<div class="tabs" role="group" aria-label="Your villages">
						{#each home.villages as v (v.node)}<button class:on={v.node === home.node} onclick={() => pickVillage(v.node)}>{v.name}</button>{/each}
					</div>
				{/if}
				<p class="label stats cashline" title="What it took in by exports to the world market and sales to your other villages, less what it paid for imports from them and for its upkeep, a week lately. Your goal: more in than out">Cashflow <b class:debt={homeCash < -0.05} class:gain={homeCash > 0.05}>{signed(homeCash)}</b> gold a week · exports {goldOf(home.cash.exp / EUR_PER_GOLD)} · imports {goldOf(home.cash.imp / EUR_PER_GOLD)} · upkeep {goldOf(home.cash.upkeep / EUR_PER_GOLD)}</p>
				<p class="label stats" title="Its settlers add a HEART each an in-game hour to its treasury (720 a month each, a thousandth of a gold): {gold(home.income)} gold a week. What it lacks to pay, it borrows">{home.pop}/{home.beds} beds · <b class:debt={home.gold < 0}>{goldOf(home.gold)}</b> gold</p>
				{#if home.loan}<p class="label stats" title="What its treasury lacked it borrowed: an annuity loan over fifteen years at 1% a month, up to 125 gold a villager. It pays the same each month, interest and repayment together, so it owes less each month">Loan <b class="debt">{gold(home.loan.left)}</b> of {gold(home.loanMost)} gold · pays {gold(home.loan.pay)} a month · {span(home.loan.months)} left</p>{/if}
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
						<li class:short={pw.short} title="Energy a week, an energy being a MWh: geothermal plant {energy(pw.well)}{pw.plant ? '' : ' (none yet: it comes with the village center)'} and solar {energy(pw.sun)} ({MONTHS[pw.month - 1]} sun), against homes {energy(pw.home)}, dome climate {energy(pw.climate)}, village center {energy(pw.centre)} and factories {energy(pw.work)} (their work, building and standing). To the grid {energy(pwGrid)}, {gold(pwEur)} gold.">
							<span class="k">Energy</span>
							<span class="bar"><span class={pw.short ? 'poor' : pwMade >= pwUsed ? 'good' : 'fair'} style:width="{Math.min(100, (pwMade / Math.max(1, pwUsed)) * 100)}%"></span></span>
							<span class="n">{energy(pwMade)}<em>/{energy(pwUsed)}</em></span>
						</li>
					{/if}
					{#each home.rows as r (r.key)}
						<li class:short={r.short} title="{r.label}, a tonne each: {ware(r.have)} in store, wants {ware(r.need)} for its building sites and its factories">
							<span class="k">{r.label}</span>
							<span class="bar"><span class={r.short || r.have < r.need / 2 ? 'poor' : r.have < r.need ? 'fair' : 'good'} style:width="{Math.min(100, (r.have / Math.max(1, r.need)) * 100)}%"></span></span>
							<span class="n">{ware(r.have)}<em>/{ware(r.need)}</em></span>
						</li>
					{/each}
				</ul>
				{#if pw}{@render stageInfo(/** @type {any[]} */ (stagesOf('centre')), pw.stage, {})}{/if}
				{#each home.notes as x, k (k)}
					<button class="note {x.tone}" onclick={() => game?.focus(x.node)}><i></i>{x.text}</button>
				{/each}
				{#if links.length}
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
				<p class="people small">Year {summary.date.year} · month {summary.date.month} · day {summary.date.day} · {summary.people} people · {summary.villages} {summary.villages === 1 ? 'village' : 'villages'}</p>
				{#if growWhy}<p class="status">{growWhy}</p>{/if}
				{#if pw?.next}<div class="actions foot">{@render stageUp(/** @type {any[]} */ (stagesOf('centre')), pw.stage, pw.next.up, grow)}</div>{/if}
			</section>
		</aside>
	{/if}

	<!-- the world market, a card of its own from the left: what the shown village buys and sells, and its trade a week -->
	{#if marketOpen && home}
		<section class="panel market" aria-label="World market">
			<button class="close" onclick={() => (marketOpen = false)} aria-label="Close">×</button>
			<p class="eyebrow">World market · {home.name}</p>
			<h2>Trade</h2>
			<p class="label stats" title="What it took in by exports to the world market and sales to your other villages, less what it paid for imports from them and for its upkeep, a week lately. Your goal: more in than out">Cashflow <b class:debt={homeCash < -0.05} class:gain={homeCash > 0.05}>{signed(homeCash)}</b> gold a week · {goldOf(home.gold)} gold in its treasury</p>
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
					{#if home.upkeep >= 1}<dt title="What keeping its homes, factories and village center up takes, always in gold: 2% a year of what they are built of, at world prices">Upkeep</dt><dd class="debt">−{gold(home.upkeep)} gold</dd>{/if}
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
				<p class="label">{card.settlers} settlers live in its village</p>
			{/if}
			{#if stagesOf(card.type) && card.level}
				{@render stageInfo(/** @type {any[]} */ (stagesOf(card.type)), card.level, {
					upgrading: card.upgrading,
					lately: card.out && card.stage === 'live' ? `${ware(card.lately)} ${nameOf(card.out)} a week${card.type === 'ironmine' ? ` · ore for ${num(card.deposit / card.rounds)} years` : ''}` : ''
				})}
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
				<p class="label">Busy <b>{card.eff}%</b></p>
				<div class="bar"><span style:width="{card.eff}%"></span></div>
			{/if}
			{#if upWhy}<p class="status">{upWhy}</p>{/if}
			{#if card.owner === PLAYER && card.type !== 'centre'}
				<div class="actions foot">
					{#if stagesOf(card.type) && card.level && !card.upgrading}{@render stageUp(/** @type {any[]} */ (stagesOf(card.type)), card.level, card.up, () => card && ((upWhy = game?.sim.upgrade(card.id)?.why ?? ''), refresh()))}{/if}
					<button class="danger" onclick={() => (game?.sim.demolish(card?.node ?? -1), game?.select(null))}>Tear down</button>
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
				<div class="actions foot">
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
	.menu .tabs {
		padding-right: 1.6rem;
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
		right: calc(1rem + env(safe-area-inset-right, 0px));
		top: calc(5rem + env(safe-area-inset-top, 0px));
		width: 17rem;
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.valley:has(.side) .card {
		right: calc(19rem + env(safe-area-inset-right, 0px));
	}
	.card .close,
	.village .close,
	.books .close,
	.market .close,
	.menu .close {
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
	.grow {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		border-radius: 12px;
		text-align: left;
	}
	.grow .chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.55rem;
	}
	i.coin {
		background: #d9a520;
		border-radius: 50%;
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
	/* the top bar's three numbers: one pill in the middle, each number known by its icon */
	.topstats {
		position: absolute;
		z-index: 3;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: stretch;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.9);
		border: 1px solid rgb(255 255 255 / 0.5);
		box-shadow: 0 4px 18px rgb(0 0 0 / 0.12);
		color: #1f2a23;
		white-space: nowrap;
		overflow: hidden;
	}
	.stat {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.85rem;
		font: inherit;
		font-size: 0.9rem;
		color: inherit;
		background: none;
		border: 0;
	}
	.stat + .stat {
		border-left: 1px solid rgb(31 42 35 / 0.12);
	}
	.stat svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.7;
	}
	.stat b {
		font-variant-numeric: tabular-nums;
	}
	.stat small {
		font-size: 0.7rem;
		opacity: 0.65;
	}
	.stat.up b {
		color: #2f7a3a;
	}
	.stat.down b {
		color: #a3322a;
	}
	button.stat {
		cursor: pointer;
	}
	button.stat:hover,
	button.stat[aria-expanded='true'] {
		background: rgb(31 42 35 / 0.06);
	}
	.caret {
		width: 0.4rem;
		height: 0.4rem;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: translateY(-0.12rem) rotate(45deg);
		opacity: 0.5;
	}
	[aria-expanded='true'] .caret {
		transform: translateY(0.1rem) rotate(-135deg);
	}
	/* your books: a sheet under the numbers */
	.books {
		position: absolute;
		z-index: 4;
		top: calc(4.2rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		width: min(30rem, calc(100vw - 1rem));
		max-height: calc(100vh - 6rem - var(--nav-room, 4rem));
		overflow: auto;
		padding: 0.7rem 0.9rem 0.8rem;
		border-radius: 16px;
		background: rgb(250 248 242 / 0.96);
		border: 1px solid rgb(255 255 255 / 0.5);
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
		color: #1f2a23;
		font-size: 0.8rem;
	}
	.books .sub {
		margin: 0.55rem 0 0.15rem;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #7b857a;
	}
	/* two sides, as a T: costs and liabilities on the left, income and assets on the right */
	.books .t {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border-top: 1px solid rgb(31 42 35 / 0.25);
	}
	.books .leg {
		display: flex;
		flex-direction: column;
		padding: 0.25rem 0.6rem 0.3rem 0;
	}
	.books .leg + .leg {
		padding: 0.25rem 0 0.3rem 0.6rem;
		border-left: 1px solid rgb(31 42 35 / 0.25);
	}
	.books .head {
		margin: 0 0 0.15rem;
		font-weight: 600;
	}
	.books dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.1rem 0.5rem;
		margin: 0;
	}
	.books dt {
		color: #4d574e;
		white-space: nowrap;
	}
	.books dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.books .sum,
	.books .net {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.books .sum {
		margin-top: auto;
		padding-top: 0.25rem;
		border-top: 1px solid rgb(31 42 35 / 0.15);
		font-weight: 600;
	}
	.books .net {
		padding: 0.3rem 0 0.1rem;
		border-top: 1px solid rgb(31 42 35 / 0.25);
		font-weight: 700;
	}
	.books .net + .net {
		border-top: 0;
		padding-top: 0;
		font-weight: 600;
	}
	.books .small {
		margin: 0.6rem 0 0;
		font-size: 0.7rem;
		color: #7b857a;
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
	.actions.foot {
		position: sticky;
		bottom: 0;
		z-index: 1;
		margin: 0.7rem -0.8rem 0;
		padding: 0.55rem 0.8rem 0.7rem;
		background: rgb(250 248 242 / 0.97);
		border-top: 1px solid rgb(31 42 35 / 0.08);
	}
	.panel:has(> .actions.foot) {
		padding-bottom: 0;
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
	.fab {
		display: none;
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

	/* ── a narrow screen: the tools behind one action button at the foot on the right, the cards and panels as sheets
	   sliding up from the foot, full width, their buttons fixed at their foot above the nav pill ── */
	@media (max-width: 720px) {
		.fab {
			display: flex;
			align-items: center;
			justify-content: center;
			position: absolute;
			z-index: 6;
			right: max(8px, env(safe-area-inset-right, 0px));
			bottom: var(--nav-foot, 8px);
			width: var(--nav-height, 52px);
			height: var(--nav-height, 52px);
			padding: 0;
			border: 1px solid rgb(255 255 255 / 0.5);
			border-radius: 999px;
			background: rgb(250 248 242 / 0.94);
			box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
			-webkit-backdrop-filter: blur(10px);
			backdrop-filter: blur(10px);
		}
		.fab svg {
			width: 1.35rem;
			height: 1.35rem;
			fill: none;
			stroke: currentColor;
			stroke-width: 2;
			stroke-linecap: round;
		}
		.fab.on {
			background: #24452f;
			color: #f4f1e8;
		}
		.tools {
			display: none;
		}
		.tools.open {
			display: flex;
			z-index: 6;
			top: auto;
			left: auto;
			right: max(8px, env(safe-area-inset-right, 0px));
			bottom: calc(var(--nav-room, 4rem) + 0.2rem);
			width: 10rem;
			max-height: calc(100dvh - var(--nav-room, 4rem) - 5rem);
			overflow-y: auto;
			scrollbar-width: none;
			animation: in 160ms ease-out;
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
		.topstats {
			top: calc(3.9rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			transform: none;
			justify-content: space-around;
		}
		.stat {
			padding: 0.35rem 0.6rem;
			font-size: 0.8rem;
		}
		.books {
			top: calc(6.7rem + env(safe-area-inset-top, 0px));
			padding: 0.6rem 0.6rem 0.7rem;
			font-size: 0.72rem;
		}
		/* the sheets: full width from the foot, up to most of the screen, sliding in */
		.menu,
		.market,
		.card,
		.side {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-height: min(72dvh, calc(100dvh - 7.5rem));
		}
		.side {
			display: flex;
			z-index: 3;
		}
		.menu,
		.market,
		.card,
		.side .village {
			padding: 0.8rem 1rem var(--nav-room, 4rem);
			border-radius: 18px 18px 0 0;
			border-bottom: 0;
			box-shadow: 0 -8px 28px rgb(0 0 0 / 0.16);
			overflow: auto;
			overscroll-behavior: contain;
			animation: sheet 240ms ease-out;
		}
		.valley:has(.side) .card {
			right: 0;
		}
		.card .close,
		.village .close,
		.market .close,
		.menu .close {
			top: 0.5rem;
			right: 0.7rem;
		}
		.panel:has(> .actions.foot) {
			padding-bottom: 0;
		}
		.actions.foot {
			margin: 0.7rem -1rem 0;
			padding: 0.6rem 1rem var(--nav-room, 4rem);
		}
		.actions.foot button {
			padding: 0.55rem 0.9rem;
			font-size: 0.8rem;
		}
		.wares {
			grid-template-columns: 1fr;
		}
		.news {
			top: calc(6.7rem + env(safe-area-inset-top, 0px));
			width: calc(100vw - 2rem);
		}
		.hint {
			white-space: normal;
			text-align: center;
			max-width: calc(100vw - 2rem);
		}
	}
	@keyframes sheet {
		from {
			transform: translateY(100%);
		}
	}
</style>
