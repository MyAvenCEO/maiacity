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
	import { BUILDINGS, HOUSE_BEDS, HOUSE_SIZE, MENU, WARES, WARE_ORDER } from './rules.js';
	import { NEED_LABEL } from './market.js';
	import { FOOD_KG, KEEP, PRICE, WATER_L, WATER_USE } from './food.js';
	import { PLAYER } from './sim.js';
	import Tree from './Tree.svelte';

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {ReturnType<typeof import('./game.js').mountGame> | null} */
	let game = null;
	let loading = $state(true);

	let mode = $state('look');
	let buildType = $state('');
	let hint = $state('');
	let speed = $state(1);
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
	/** how many of each building you have, sites too */
	let owned = $state(/** @type {Record<string, number>} */ ({}));
	/** @type {ReturnType<import('./sim.js').Sim['market']> | null} */
	let market = $state(null);
	/** the trade routes a selected village center of yours can dig, and the ones it has @type {ReturnType<import('./sim.js').Sim['links']>} */
	let links = $state([]);
	/** what a Connect button said when the route could not be dug */
	let linkWhy = $state('');
	/** the village of yours the right side shows — the one picked, else your first: each need against its stock */
	let home = $state(/** @type {ReturnType<import('./sim.js').Sim['village']>} */ (null));
	/** whether the pick is a village center of yours: then the right side is its card */
	let ownCentre = $state(false);
	/** its food and water, and a week of food against what its people eat (kg) and in gold */
	const fd = $derived(home?.food);
	const wt = $derived(home?.water);
	const flow = $derived(fd ? fd.grown - fd.week : 0);
	const gold = $derived(fd ? fd.earned - fd.spent : 0);
	let seenMsg = 0;
	/** @type {{ text: string, tone: string, node: number, key: number }[]} */
	let toasts = $state([]);

	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	/** a number of kg, litres or gold, whole, with its thousands marked */
	const num = (/** @type {number} */ n) => Math.round(n).toLocaleString('en-US').replace('-', '−');
	/** how full a store is against what it keeps, as a bar's class */
	const fill = (/** @type {number} */ have, /** @type {number} */ want) => (have >= want * 0.99 ? 'good' : have >= want / 2 ? 'fair' : 'poor');

	function refresh() {
		if (!game) return;
		const sim = game.sim;
		summary = sim.summary();
		market = sim.market();
		if (treeOpen) {
			/** @type {Record<string, number>} */
			const n = {};
			for (const b of Object.values(sim.state.buildings)) if (b.owner === PLAYER) n[b.type] = (n[b.type] ?? 0) + 1;
			owned = n;
		}
		speed = game.speed;
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
			if (!menuOpen && mode === 'build') game?.setMode('look');
			return;
		}
		menuOpen = false;
		game?.setMode(mode === m && !type ? 'look' : /** @type {import('./game.js').Mode} */ (m), type);
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
	const chainOf = (/** @type {any} */ t) =>
		t.kind === 'centre' ? 'Its village’s storehouse, market and hall' : t.kind === 'house' ? 'Beds for 2, doubling each time it is enlarged, up to 248; plants its hex’s food forest' : t.kind === 'forester' ? 'Plants trees' : `${t.inputs?.length ? t.inputs.map((/** @type {string[]} */ s) => s.map(label).join(' or ')).join(' + ') + ' → ' : ''}${t.out ? label(t.out) : ''}`;
</script>

<div class="valley">
	<div class="stage" bind:this={stage} role="application" aria-label="Sandbox 5: the valley. Drag to turn the map, scroll to zoom, click to select or build"></div>
	<WorldBar title="avenCITY Sandbox 5" subtitle="A valley of settlers · villages, trade routes underground" />
	<TouchStick move={(x, y, hurry) => game?.move(x, y, hurry)} {stage} taps=".tools button, .panel button, .card button" />

	<!-- the tools, down the left -->
	<nav class="tools" aria-label="Tools">
		<button class:on={mode === 'build' || menuOpen} onclick={() => tool('build')} title="Build (choose a building)"><span class="ic">⌂</span>Build</button>
		<button class:on={mode === 'road'} onclick={() => tool('road')} title="Road (R)"><span class="ic">⟋</span>Road</button>
		<button class:on={mode === 'demolish'} onclick={() => tool('demolish')} title="Tear down (X)"><span class="ic">✕</span>Tear down</button>
		<button class:on={treeOpen} onclick={() => ((treeOpen = !treeOpen), (menuOpen = false), refresh())} title="The building tree: what each building needs and makes"><span class="ic">⌥</span>Tree</button>
		<div class="speed" role="group" aria-label="Speed">
			{#each [[0, '❚❚'], [1, '1×'], [2, '2×'], [4, '4×']] as [s, t] (s)}
				<button class:on={speed === s} onclick={() => (game?.setSpeed(/** @type {number} */ (s)), (speed = /** @type {number} */ (s)))} title={s ? `Speed ${t}` : 'Pause (Space)'}>{t}</button>
			{/each}
		</div>
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
									<span class="chip" class:short={(summary?.stock[w] ?? 0) < n}><i style:background={WARES[w].color}></i>{n} {label(w).toLowerCase()}</span>
								{/each}
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
				<p class="label stats" title="Its settlers add 24 HEARTs each an in-game hour to its treasury; 1,000 HEARTs are a gold. Below 0 it is in debt, from buying food">{home.pop}/{home.beds} beds · wellbeing <b>{Math.round(home.wb)}</b> · <b class:debt={home.gold < 0}>{num(home.gold)}</b> gold</p>
				{#if fd}
				<section class="ledger" aria-label="Food">
					<p class="ledger-head" class:short={fd.short}><b>Food</b><span title="A hex's food forest grows 10% of what its people eat in its first year, 10% more each year up to 100% in its tenth, then up to 150% from its fifteenth year">forests in year {fd.year} · grow {Math.round(fd.share * 100)}%</span></p>
					<span class="bar" title="In store against the {KEEP} weeks a village keeps"><span class={fill(fd.kg, fd.keep)} style:width="{Math.min(100, (fd.kg / Math.max(1, fd.keep)) * 100)}%"></span></span>
					<dl>
						<dt>In store</dt><dd>{num(fd.kg)} kg</dd>
						<dt title="{FOOD_KG.toFixed(1)} kg a person a week, the European diet">Eaten a week</dt><dd>{num(fd.week)} kg</dd>
						<dt>Grown a week</dt><dd>{num(fd.grown)} kg</dd>
						{#if fd.fromVillages >= 1}<dt title="From your villages that grow more than they eat, {PRICE.village} gold a kg">Bought nearby</dt><dd>{num(fd.fromVillages)} kg</dd>{/if}
						{#if fd.fromWorld >= 1}<dt title="From beyond the valley, {PRICE.world} gold a kg">Bought outside</dt><dd>{num(fd.fromWorld)} kg</dd>{/if}
						{#if fd.sold >= 1}<dt title="To your villages that lack it, {PRICE.village} gold a kg">Sold</dt><dd>{num(fd.sold)} kg</dd>{/if}
						<dt title="What its forests grow against what its people eat, a week, and what buying and selling food did to its gold">Cashflow</dt><dd class:debt={flow < -0.5} class:gain={flow > 0.5}>{flow > 0.5 ? '+' : ''}{num(flow)} kg · {gold > 0.5 ? '+' : ''}{num(gold)} gold</dd>
					</dl>
				</section>
				{/if}
				{#if wt}
				<section class="ledger" aria-label="Water">
					<p class="ledger-head" class:short={wt.short}><b>Water</b><span>{wt.wells} {wt.wells === 1 ? 'well' : 'wells'}</span></p>
					<span class="bar" title="In its tanks against {KEEP} weeks of use"><span class={fill(wt.litres, wt.week * KEEP)} style:width="{Math.min(100, (wt.litres / Math.max(1, wt.week * KEEP)) * 100)}%"></span></span>
					<dl>
						<dt>In its tanks</dt><dd>{num(wt.litres)} L</dd>
						<dt title="{WATER_L} L a person a day: {WATER_USE.drinking} to drink, {WATER_USE.home} at home, {WATER_USE.crops} for the crops">Used a week</dt><dd>{num(wt.week)} L</dd>
						<dt>Wells give a week</dt><dd>{num(wt.drawn)} L</dd>
					</dl>
				</section>
				{/if}
				<ul class="wants" aria-label="What it has, against what it needs">
					{#each home.rows as r (r.key)}
						<li class:short={r.short} title="{r.label}: {r.have} in store, needs {r.need}">
							<span class="k">{r.label}</span>
							<span class="bar"><span class={r.short || r.have < r.need / 2 ? 'poor' : r.have < r.need ? 'fair' : 'good'} style:width="{Math.min(100, (r.have / Math.max(1, r.need)) * 100)}%"></span></span>
							<span class="n">{r.have}<em>/{r.need}</em></span>
						</li>
					{/each}
				</ul>
				{#each home.notes as x, k (k)}
					<button class="note {x.tone}" onclick={() => game?.focus(x.node)}><i></i>{x.text}</button>
				{/each}
				{#if ownCentre && links.length}
					<p class="label">Trade routes, under the ground</p>
					<ul class="routes">
						{#each links as l (l.id)}
							<li>
								<button class="name" onclick={() => game?.focus(l.node)}>{l.name}{l.mine ? '' : ' · city'}</button>
								{#if l.joined}<span class="joined">Joined</span>{:else}<button class="go" onclick={() => connect(l.id)}>Connect · {l.cost} stone</button>{/if}
							</li>
						{/each}
					</ul>
					{#if linkWhy}<p class="status">{linkWhy}</p>{/if}
				{/if}
				{#if ownCentre}
					<div class="actions"><button onclick={() => game?.setMode('road')}>Path from here</button></div>
				{/if}
				<p class="people small">Year {summary.date.year} · week {summary.date.week} · {summary.people} people · {summary.villages} {summary.villages === 1 ? 'village' : 'villages'}</p>
			</section>
		</aside>
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
						<li><i style:background={WARES[c.ware].color}></i>{label(c.ware)} <b>{c.have} of {c.need}</b>{#if c.coming}<em> · {c.coming} coming</em>{/if}</li>
					{/each}
				</ul>
			{:else if card.party}
				<p class="label">{card.party.pop} people{card.party.beds !== undefined ? ` in ${card.party.beds} beds` : ''} · wellbeing <b>{Math.round(card.party.wb)}</b>{card.owner !== PLAYER ? ` · ${Math.round(card.party.coins)} coins` : ''}</p>
				<ul class="needs">
					{#each Object.entries(card.party.sat) as [need, v] (need)}
						<li>{NEED_LABEL[/** @type {keyof typeof NEED_LABEL} */ (need)]} <b>{Math.round(/** @type {number} */ (v) * 100)}%</b></li>
					{/each}
				</ul>
				<p class="label">In store</p>
				<ul class="wares tight">
					{#each Object.entries(card.stock ?? card.party.stock).filter(([, n]) => n >= 1) as [w, n] (w)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span><b>{Math.floor(/** @type {number} */ (n))}</b></li>{/each}
				</ul>
			{/if}
			{#if card.stock && card.owner === PLAYER && card.stage === 'live'}
				<p class="label">{card.settlers} settlers free</p>
			{/if}
			{#if card.type === 'house' && card.level}
				<p class="label">{HOUSE_SIZE[card.level - 1]} · home of <b>{card.beds}</b> settlers{card.upgrading ? ` · growing to ${HOUSE_BEDS[card.level]}` : ''}</p>
				{#if card.owner === PLAYER && card.up && !card.upgrading}
					<div class="actions">
						<button class="go up" title="Enlarge to {HOUSE_BEDS[card.level]} settlers: {Object.entries(card.up).map(([w, n]) => `${n} ${label(w).toLowerCase()}`).join(', ')}" onclick={() => card && (game?.sim.upgrade(card.id), refresh())}>Enlarge → {HOUSE_BEDS[card.level]}{#each Object.entries(card.up) as [w, n] (w)}<span class="cost"><i style:background={WARES[w].color}></i>{n}</span>{/each}</button>
					</div>
				{/if}
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
				{#if card.kind === 'mine'}<p class="small">Ore left in the vein: {card.deposit}</p>{/if}
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
		padding: 0.4rem 0;
		border-radius: 999px;
		font-size: 0.72rem;
		text-align: center;
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
	.ledger-head.short b {
		color: #b23b2f;
	}
	.ledger .bar {
		display: block;
		height: 0.4rem;
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
	.gain {
		color: #2f7a3a;
	}
	.wants {
		display: grid;
		gap: 0.3rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.74rem;
	}
	.wants li {
		display: grid;
		grid-template-columns: 3.6rem 1fr 3.2rem;
		align-items: center;
		gap: 0.5rem;
	}
	.wants .bar {
		height: 0.4rem;
		margin: 0;
	}
	.wants .n {
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
		.tools .quiet {
			margin: 0;
		}
		.menu {
			top: calc(7rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			width: calc(100vw - 1rem);
			max-height: 55vh;
		}
		.side {
			top: calc(7rem + env(safe-area-inset-top, 0px));
			right: 0.5rem;
			width: 13.5rem;
			max-height: 40vh;
		}
		.wares {
			grid-template-columns: 1fr;
		}
		.market {
			top: calc(7rem + env(safe-area-inset-top, 0px));
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
