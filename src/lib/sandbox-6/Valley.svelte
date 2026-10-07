<!--
	avenCITY Sandbox 6 — a valley of settlers: the whole game on one page. The world fills the screen (./game.js); over
	it the tools (build, road, flag, tear down, the market, the building tree, the clock), the build menu, the valley's abundance, what
	your storehouses hold, the goals, the market (prices, your orders, the neighbours' requests), the card of whatever
	is selected, and the valley's news.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WorldBar } from '$lib/sandbox-kit';
	import { ABUNDANT, BUILDINGS, HOLD, MENU, PEOPLE, WARES, WARE_ORDER } from './rules.js';
	import { NEED_LABEL } from './market.js';
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
	let stockOpen = $state(true);
	let goalsOpen = $state(false);
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
	let marketOpen = $state(false);
	let treeOpen = $state(false);
	/** how many of each building you have, sites too */
	let owned = $state(/** @type {Record<string, number>} */ ({}));
	/** @type {ReturnType<import('./sim.js').Sim['market']> | null} */
	let market = $state(null);
	/** the ware whose order is being set */
	let editing = $state('');
	/** @type {{ sell: boolean, above: number, keep: number, buy: boolean, below: number, upTo: number }} */
	let draft = $state({ sell: false, above: 0, keep: 0, buy: false, below: 0, upTo: 0 });
	let seenMsg = 0;
	/** @type {{ text: string, tone: string, node: number, key: number }[]} */
	let toasts = $state([]);

	const label = (/** @type {string} */ w) => WARES[w]?.label ?? w;
	const clock = (/** @type {number} */ t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

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
		refresh();
	}
	/** open a ware's order to set it: what is set now, or a sensible start from its price */
	function edit(/** @type {string} */ w) {
		if (editing === w) return void (editing = '');
		const row = market?.wares.find((x) => x.w === w);
		if (!row) return;
		const p = Math.round(row.price * 10) / 10;
		draft = row.order ? { ...row.order } : { sell: false, above: Math.max(1, Math.round(p)), keep: 10, buy: false, below: Math.max(1, Math.round(p * 1.2)), upTo: 20 };
		editing = w;
	}
	function saveOrder() {
		if (!editing) return;
		game?.sim.order(editing, draft.sell || draft.buy ? { ...draft } : null);
		editing = '';
		refresh();
	}
	const money = (/** @type {number} */ n) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
	const tone = (/** @type {number} */ wb) => (wb >= ABUNDANT ? 'good' : wb >= 55 ? 'fair' : 'poor');
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
		stockOpen = !narrow;
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
		t.kind === 'land' ? `Holds land ${t.radius} steps round` : t.kind === 'market' ? 'Trades at the fair by your orders' : t.kind === 'warehouse' ? 'Stores wares and settlers' : t.kind === 'forester' ? 'Plants trees' : `${t.inputs?.length ? t.inputs.map((/** @type {string[]} */ s) => s.map(label).join(' or ')).join(' + ') + ' → ' : ''}${t.out ? label(t.out) : ''}`;
</script>

<div class="valley">
	<div class="stage" bind:this={stage} role="application" aria-label="Sandbox 6: the valley. Drag to turn the map, scroll to zoom, click to select or build"></div>
	<WorldBar title="avenCITY Sandbox 6" subtitle="A valley of settlers · trade, an open market, abundance" />
	<TouchStick move={(x, y, hurry) => game?.move(x, y, hurry)} {stage} taps=".tools button, .panel button, .card button" />

	<!-- the tools, down the left -->
	<nav class="tools" aria-label="Tools">
		<button class:on={mode === 'build' || menuOpen} onclick={() => tool('build')} title="Build (choose a building)"><span class="ic">⌂</span>Build</button>
		<button class:on={mode === 'road'} onclick={() => tool('road')} title="Road (R)"><span class="ic">⟋</span>Road</button>
		<button class:on={mode === 'flag'} onclick={() => tool('flag')} title="Flag (F)"><span class="ic">⚑</span>Flag</button>
		<button class:on={mode === 'demolish'} onclick={() => tool('demolish')} title="Tear down (X)"><span class="ic">✕</span>Tear down</button>
		<button class:on={marketOpen} onclick={() => ((marketOpen = !marketOpen), (menuOpen = false), (treeOpen = false))} title="The market: prices, your orders, requests"><span class="ic">⚖</span>Market</button>
		<button class:on={treeOpen} onclick={() => ((treeOpen = !treeOpen), (menuOpen = false), (marketOpen = false), refresh())} title="The building tree: what each building needs and makes"><span class="ic">⌥</span>Tree</button>
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

	<!-- what the storehouses hold, and the goals -->
	{#if summary}
		<aside class="side">
			<section class="panel abundance" aria-label="The valley's abundance">
				<div class="head">
					<span>Abundance</span>
					<span class="big {tone(summary.abundance)}">{Math.round(summary.abundance)}</span>
				</div>
				<p class="people small">{summary.thriving} of {summary.parties.length} at {ABUNDANT}+ with {PEOPLE}+ people{summary.held >= 0 ? ` · held ${clock(summary.held)} of ${clock(HOLD)}` : ''}</p>
				<ul class="lives">
					{#each market?.parties ?? [] as p (p.name)}
						<li>
							<button onclick={() => p.node >= 0 && game?.focus(p.node)} title="{p.name}: wellbeing {Math.round(p.wb)}, {p.pop} people">
								<span>{p.name} <em class:short={p.pop < PEOPLE}>{p.pop}</em></span>
								<span class="bar"><span class={tone(p.wb)} style:width="{p.wb}%"></span></span>
								<b>{Math.round(p.wb)}</b>
							</button>
						</li>
					{/each}
				</ul>
			</section>
			<section class="panel stock" aria-label="Your stock">
				<button class="head" onclick={() => (stockOpen = !stockOpen)} aria-expanded={stockOpen}>
					<span>Stock</span>
					<span class="people">{summary.settlers} settlers · {summary.stock.coin ?? 0} coins · {clock(summary.time)}</span>
				</button>
				{#if stockOpen}
					<ul class="wares">
						{#each WARE_ORDER as w (w)}
							<li title={label(w)} class:none={!(summary.stock[w] ?? 0)}><i style:background={WARES[w].color}></i><span>{label(w)}</span><b>{summary.stock[w] ?? 0}</b></li>
						{/each}
					</ul>
					<p class="people small">{summary.carriers} carriers · {summary.workers} at work</p>
				{/if}
			</section>
			<section class="panel goals" aria-label="Goals">
				<button class="head" onclick={() => (goalsOpen = !goalsOpen)} aria-expanded={goalsOpen}>
					<span>Goals</span>
					<span class="people">{summary.goals.filter((g) => g.done).length} of {summary.goals.length}</span>
				</button>
				{#if goalsOpen || !narrow}
					<ol>
						{#each summary.goals as g, k (g.id)}
							{#if goalsOpen || g.done || k === summary.goals.findIndex((x) => !x.done)}
								<li class:done={g.done} title={g.hint ?? ''}>
									<span class="tick">{g.done ? '✓' : k + 1}</span>
									<span>{g.label}{#if !g.done && g.need}<em> · {Math.min(g.have ?? 0, g.need)} of {g.need}</em>{/if}</span>
								</li>
							{/if}
						{/each}
					</ol>
				{/if}
			</section>
		</aside>
	{/if}

	{#if treeOpen && summary}
		<Tree stock={summary.stock} {owned} onBuild={(t) => ((treeOpen = false), tool('build', t))} onClose={() => (treeOpen = false)} />
	{/if}

	<!-- the market: prices at the fair, your standing orders, the neighbours' requests -->
	{#if marketOpen && market}
		<section class="panel market" aria-label="Market">
			<button class="close" onclick={() => (marketOpen = false)} aria-label="Close">×</button>
			<p class="eyebrow">The fair · {money(market.purse)} coins in your purse</p>
			<h2>Market</h2>
			{#if !market.halls}<p class="status">Build a market hall (Trade) to send a trader to the fair.</p>{/if}
			<p class="about">Prices follow how much of a ware the fair holds: selling makes it cheaper, buying dearer. Set an order and your trader fills it whenever the price allows.</p>
			{#if market.contracts.length}
				<p class="label">Requests</p>
				<ul class="requests">
					{#each market.contracts as c (c.id)}
						<li>
							<span><b>{c.who}</b> asks for {c.n} {label(c.w).toLowerCase()} · {c.reward ? `${c.reward} coins` : 'help: no coins left'} · {clock(c.left)} left{#if c.got}<em> · {c.got} brought</em>{/if}</span>
							<button class:go={!c.taken} onclick={() => (game?.sim.take(c.id, !c.taken), refresh())}>{c.taken ? 'Taken' : 'Take it'}</button>
						</li>
					{/each}
				</ul>
			{/if}
			<table class="prices">
				<thead><tr><th>Ware</th><th>Price</th><th>Fair</th><th>Yours</th><th>Order</th></tr></thead>
				<tbody>
					{#each market.wares as x (x.w)}
						<tr class:open={editing === x.w} onclick={() => edit(x.w)}>
							<td><i style:background={WARES[x.w].color}></i> {label(x.w)}</td>
							<td>{money(x.price)} <span class="trend t{x.trend}">{x.trend > 0 ? '▲' : x.trend < 0 ? '▼' : '·'}</span></td>
							<td>{x.pool}</td>
							<td>{x.stock}</td>
							<td class="order">{x.order ? [x.order.sell ? `sell ≥${x.order.above}` : '', x.order.buy ? `buy ≤${x.order.below}` : ''].filter(Boolean).join(' · ') : '–'}</td>
						</tr>
						{#if editing === x.w}
							<tr class="editor">
								<td colspan="5">
									<label><input type="checkbox" bind:checked={draft.sell} /> Sell when the price is at least <input type="number" min="0" step="0.5" bind:value={draft.above} />, keeping <input type="number" min="0" bind:value={draft.keep} /></label>
									<label><input type="checkbox" bind:checked={draft.buy} /> Buy when the price is at most <input type="number" min="0" step="0.5" bind:value={draft.below} />, up to <input type="number" min="0" bind:value={draft.upTo} /> in store</label>
									<div class="actions">
										<button class="go" onclick={(e) => (e.stopPropagation(), saveOrder())}>Set order</button>
										<button onclick={(e) => (e.stopPropagation(), (editing = ''))}>Cancel</button>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
			<p class="label">How the valley lives</p>
			<ul class="settlements">
				{#each market.parties as p (p.name)}
					<li>
						<p><b>{p.name}</b> · {p.pop} people · wellbeing {Math.round(p.wb)}{#if p.name !== 'You'} · {Math.round(p.coins)} coins{/if}</p>
						<div class="needbars">
							{#each Object.entries(p.sat) as [need, v] (need)}
								<span title="{NEED_LABEL[/** @type {keyof typeof NEED_LABEL} */ (need)]}: {Math.round(v * 100)}%"><em>{NEED_LABEL[/** @type {keyof typeof NEED_LABEL} */ (need)]}</em><span class="bar"><span class={tone(v * 100)} style:width="{v * 100}%"></span></span></span>
							{/each}
							<span title="Put by: {Math.round(p.reserve * 100)}%"><em>Put by</em><span class="bar"><span class={tone(p.reserve * 100)} style:width="{p.reserve * 100}%"></span></span></span>
						</div>
					</li>
				{/each}
			</ul>
			<p class="small">You sold {market.sold} and bought {market.bought} wares at the fair.</p>
		</section>
	{/if}

	<!-- the card of what is selected -->
	{#if card}
		<section class="panel card" aria-label="{card.label}">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">{card.owner === PLAYER ? (card.stage === 'site' ? 'Building site' : 'Yours') : card.type === 'fair' ? 'Open to all' : 'A neighbour'}</p>
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
				<p class="label">{card.party.pop} people · wellbeing <b>{Math.round(card.party.wb)}</b> · {Math.round(card.party.coins)} coins</p>
				<ul class="needs">
					{#each Object.entries(card.party.sat) as [need, v] (need)}
						<li>{NEED_LABEL[/** @type {keyof typeof NEED_LABEL} */ (need)]} <b>{Math.round(/** @type {number} */ (v) * 100)}%</b></li>
					{/each}
				</ul>
				<p class="label">In store</p>
				<ul class="wares tight">
					{#each Object.entries(card.party.stock).filter(([, n]) => n >= 1) as [w, n] (w)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span><b>{Math.floor(/** @type {number} */ (n))}</b></li>{/each}
				</ul>
			{:else if card.type === 'fair'}
				<div class="actions"><button class="go" onclick={() => (marketOpen = true)}>Open the Market</button></div>
			{/if}
			{#if card.box}
				<p class="label">Waiting to go to the fair</p>
				<ul class="wares tight">
					{#each Object.entries(card.box).filter(([, n]) => n > 0) as [w, n] (w)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span><b>{n}</b></li>{/each}
					{#if !Object.values(card.box).some((n) => n > 0)}<li class="none"><span>nothing yet</span></li>{/if}
				</ul>
				<div class="actions"><button onclick={() => (marketOpen = true)}>Orders in the Market</button></div>
			{/if}
			{#if card.stock}
				<p class="label">{card.settlers} settlers inside</p>
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
					<button onclick={() => game?.setMode('road')}>Road from its flag</button>
					{#if card.type !== 'hq'}<button class="danger" onclick={() => (game?.sim.demolish(card?.node ?? -1), game?.select(null))}>Tear down</button>{/if}
				</div>
			{/if}
		</section>
	{:else if flagCard}
		<section class="panel card" aria-label="Flag">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">{flagCard.owner === PLAYER ? 'Your flag' : 'A neighbour’s flag'}{flagCard.bld ? ` · ${flagCard.bld}` : ''}</p>
			<h2>Flag</h2>
			<p class="about">Wares wait here for a carrier: {flagCard.wares.length} of 8.</p>
			<ul class="wares tight">
				{#each flagCard.wares as w, k (k)}<li title={label(w)}><i style:background={WARES[w].color}></i><span>{label(w)}</span></li>{/each}
			</ul>
			{#if flagCard.owner === PLAYER}
				<div class="actions">
					<button onclick={() => game?.setMode('road')}>Road from here</button>
					<button class="danger" onclick={() => (game?.sim.demolish(selected?.node ?? -1), game?.select(null))}>Tear down</button>
				</div>
			{/if}
		</section>
	{:else if roadCard}
		<section class="panel card" aria-label="Road">
			<button class="close" onclick={() => game?.select(null)} aria-label="Close">×</button>
			<p class="eyebrow">Your road</p>
			<h2>Road · {roadCard.steps} steps</h2>
			<p class="about">{roadCard.carrier ? (roadCard.busy ? 'Its carrier is carrying a ware.' : 'Its carrier waits for work.') : 'Waiting for a carrier.'} A flag in the middle splits a long road: two carriers share it.</p>
			<div class="actions">
				{#if roadCard.canFlag}<button onclick={() => (game?.sim.flag(selected?.node ?? -1), game?.select(null))}>Set a flag here</button>{/if}
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

	{#if summary?.result}
		<div class="end" role="dialog" aria-label="The end of the game">
			<div>
				<p class="eyebrow">{clock(summary.time)} in the valley</p>
				<h2>Abundance for all</h2>
				<p>Ten minutes of plenty for the whole valley: you and every neighbour fed, watered, housed and with something put by. Every road, every carrier and every cartload to the fair brought you here.</p>
				<button class="go" onclick={() => (game?.restart(), (seenMsg = -1), (toasts = []))}>A new valley</button>
				<button onclick={() => (game && (game.sim.state.result = null), refresh())}>Keep building</button>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="loading" role="status"><p class="eyebrow">avenCITY Sandbox 6</p><strong>A valley of settlers</strong><span>Growing the valley…</span></div>
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
		width: 15.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font-weight: 600;
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
	.wares li.none {
		opacity: 0.4;
	}
	.wares.tight {
		grid-template-columns: 1fr 1fr 1fr;
	}
	.goals ol {
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.3rem;
	}
	.goals li {
		display: flex;
		gap: 0.45rem;
		font-size: 0.75rem;
		line-height: 1.3;
	}
	.goals li em {
		font-style: normal;
		opacity: 0.6;
	}
	.goals .tick {
		flex: none;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.08);
		font-size: 0.65rem;
		display: grid;
		place-items: center;
	}
	.goals li.done {
		opacity: 0.55;
	}
	.goals li.done .tick {
		background: #3d6b34;
		color: #fff;
	}
	.card {
		position: absolute;
		z-index: 3;
		right: calc(17.5rem + env(safe-area-inset-right, 0px));
		top: calc(5rem + env(safe-area-inset-top, 0px));
		width: 17rem;
		max-height: calc(100vh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
	}
	.card .close {
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
	.big {
		font-size: 1.5rem;
		font-weight: 600;
	}
	.big.good,
	.trend.t1 {
		color: #2f7a3a;
	}
	.big.fair {
		color: #a47a1c;
	}
	.big.poor,
	.trend.t-1 {
		color: #a3322a;
	}
	.lives {
		margin: 0.35rem 0 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.2rem;
	}
	.lives button {
		display: grid;
		grid-template-columns: 4.6rem 1fr 1.6rem;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font-size: 0.74rem;
		text-align: left;
	}
	.lives b {
		text-align: right;
	}
	.lives em {
		font-style: normal;
		font-size: 0.66rem;
		opacity: 0.55;
	}
	.lives em.short {
		color: #a3322a;
		opacity: 1;
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
	.market h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	.market .close {
		position: absolute;
		top: 0.4rem;
		right: 0.5rem;
		border: 0;
		background: none;
		font-size: 1.2rem;
	}
	.prices {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
	}
	.prices th {
		text-align: left;
		font-weight: 500;
		opacity: 0.6;
		padding: 0.2rem 0.25rem;
	}
	.prices td {
		padding: 0.22rem 0.25rem;
		border-top: 1px solid rgb(31 42 35 / 0.07);
		white-space: nowrap;
	}
	.prices tbody tr {
		cursor: pointer;
	}
	.prices tbody tr:hover,
	.prices tr.open {
		background: rgb(255 255 255 / 0.6);
	}
	.prices .order {
		font-size: 0.7rem;
		opacity: 0.8;
	}
	.trend {
		font-size: 0.62rem;
		opacity: 0.8;
	}
	.editor td {
		white-space: normal;
		background: rgb(255 255 255 / 0.75);
	}
	.editor label {
		display: block;
		margin: 0.25rem 0;
		line-height: 1.8;
	}
	.editor input[type='number'] {
		width: 3.4rem;
		font: inherit;
	}
	.requests,
	.settlements {
		margin: 0 0 0.4rem;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.3rem;
		font-size: 0.75rem;
	}
	.requests li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: space-between;
	}
	.requests button {
		flex: none;
		padding: 0.3rem 0.65rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.72rem;
	}
	.requests button.go,
	.actions button.go {
		background: #24452f;
		color: #f4f1e8;
		border-color: #24452f;
	}
	.requests em {
		font-style: normal;
		opacity: 0.6;
	}
	.settlements p {
		margin: 0 0 0.15rem;
	}
	.needbars {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.3rem;
	}
	.needbars em {
		display: block;
		font-style: normal;
		font-size: 0.64rem;
		opacity: 0.6;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.7rem;
	}
	.actions button,
	.go,
	.end button {
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
	.end {
		position: absolute;
		z-index: 6;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgb(20 26 22 / 0.45);
	}
	.end > div {
		width: min(26rem, calc(100vw - 2rem));
		padding: 1.4rem;
		border-radius: 20px;
		background: rgb(250 248 242 / 0.95);
		text-align: center;
	}
	.end h2 {
		margin: 0.3rem 0;
		font-family: var(--font-display, serif);
		font-size: 1.8rem;
		font-weight: 400;
	}
	.end p {
		line-height: 1.45;
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
			width: 12.5rem;
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
