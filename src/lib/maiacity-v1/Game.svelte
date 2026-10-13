<!--
	MaiaCity V1: the one shared game, as both players see it, as a game screen like Sandbox 1 and Sandbox 5 — the hex in
	3D under everything ($lib/maiacity-v1/world.js), the numbers in pills across the top, the tools down the left, and
	a card on the right for whatever is open (a sheet from the foot on a phone, an aside down the right on its side).
	The server holds the game (api/src/maiacity-v1.js); the page reads it every few seconds and, in between, runs the
	same rules (game/maiacity-v1/engine.js) forward to the second, so the clock, the melt and the HEARTS growing count
	live. Every move goes to the server. Every decision is a MIP that needs both players' signatures.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { COOPS, DAY_MS, PAYEES, PAYERS, SEATS, SETTING_LIMITS, SETTING_NAMES, SIGNATURES, TOKEN_LABEL, advance, calendar, describe, ledgerOf, mintState, nameOf, price, quote, supply } from '../../../game/maiacity-v1/engine.js';
	import { loadGame, resetGame, sendMove, takeSeat } from './store.js';
	import { createWorld } from './world.js';

	let game = $state.raw(null);
	let me = $state('');
	let admin = $state(false);
	let skew = 0; // server time minus this browser's
	let tick = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let seat = $state('A');
	// what the card shows; a phone opens on the world, the card closed
	let panel = $state(typeof matchMedia !== 'undefined' && matchMedia('(max-width: 720px), (max-height: 500px)').matches ? null : 'you');
	let tools = $state(false); // the phone's tools, behind the action button
	let amount = $state(12);
	let swapToken = $state('MAIA');
	let swapAmount = $state(1);
	let ledgerOfWho = $state('');
	let draft = $state(null);
	let labels = $state({});
	let canvas;
	let world;

	const now = $derived(tick + skew);
	const view = $derived(game ? advance(game, now) : null);
	const player = $derived(view?.players[seat]);
	const mine = $derived(player?.founder === me);
	const canMove = $derived(!!player && (mine || admin));
	const mySeat = $derived(view ? SEATS.find((s) => view.players[s].founder === me) : null);
	const cal = $derived(view ? calendar(view, now) : null);
	const hour = $derived(cal ? ((cal.months * 30) % 1) * 24 : 11);
	const mint = $derived(view ? mintState(view, seat, now) : null);
	const who = $derived(ledgerOfWho || `player:${seat}`);
	const lines = $derived(view ? ledgerOf(view, who).slice(0, 200) : []);
	const p = $derived(view ? price(view) : null);
	const total = $derived(view ? supply(view) : null);
	const swapOut = $derived(view ? quote(view, swapToken, Number(swapAmount) || 0) : 0);
	const nextMonth = $derived(view ? view.started + (view.month + 1) * DAY_MS : 0);
	const mips = $derived(view?.mips ?? []);
	const openMips = $derived(mips.filter((m) => m.status === 'open'));
	const decidedMips = $derived(mips.filter((m) => m.status !== 'open').reverse());

	$effect(() => world?.update(view, hour));

	function take(res) {
		game = res.game;
		if (res.me) me = res.me;
		if (res.admin != null) admin = res.admin;
		if (res.now) skew = res.now - Date.now();
		tick = Date.now();
	}

	async function refresh() {
		try {
			take(await loadGame());
			error = '';
		} catch (e) {
			error = e?.message ?? String(e);
		}
	}

	async function run(fn) {
		if (busy) return false;
		busy = true;
		error = '';
		try {
			take(await fn());
			return true;
		} catch (e) {
			error = e?.message ?? String(e);
			return false;
		} finally {
			busy = false;
		}
	}

	const doMove = (action) => run(() => sendMove(seat, action));

	onMount(() => {
		world = createWorld(canvas, {
			onPick: (name) => {
				if (!name) return;
				if (name.startsWith('player:')) {
					seat = name.slice(7);
					open('you');
				} else open(name);
			},
			onLabels: (l) => (labels = l)
		});
		refresh().then(() => {
			if (mySeat) seat = mySeat;
		});
		const t = setInterval(() => (tick = Date.now()), 1000);
		const r = setInterval(refresh, 10000);
		return () => (clearInterval(t), clearInterval(r), world.dispose());
	});

	function open(name) {
		panel = panel === name ? null : name;
		tools = false;
		if (name === 'ledger') ledgerOfWho = '';
	}

	function newMip(payout) {
		draft = { title: payout ? `Payout from the ${nameOf(view, payout.from)}` : '', description: '', settings: { ...view.settings }, payouts: payout ? [payout] : [] };
		panel = 'mips';
	}

	async function propose() {
		const settings = Object.fromEntries(Object.entries(draft.settings).filter(([k, v]) => Number(v) !== view.settings[k]));
		const payouts = draft.payouts.filter((x) => Number(x.amount) > 0);
		if (await doMove({ type: 'propose', mip: { title: draft.title, description: draft.description, settings, payouts } })) draft = null;
	}

	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
	const dur = (ms) => {
		if (!Number.isFinite(ms)) return '—';
		const s = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
	};
	const pad = (n) => String(n).padStart(2, '0');
	const vdate = (vm) => {
		const whole = Math.floor(vm);
		return `Y${Math.floor(whole / 12)} M${(whole % 12) + 1} D${Math.floor((vm - whole) * 30) + 1}`;
	};
	const sign = (e) => (e.kind === 'arrears' ? '' : e.to === who ? '+' : e.from === who ? '−' : '');
	const LABELS = { mint: 'Minted', invest: 'Invested', pool: 'To the pool', swap: 'Swap', rent: 'Rent', arrears: 'Owed', demurrage: 'Melt', expired: 'Expired', settings: 'Settings', proposal: 'MIP', payout: 'Payout' };
	const holdersList = $derived(view ? [...SEATS.map((s) => [`player:${s}`, view.players[s].name]), ['coop:maia', 'MaiaCity COOP'], ['coop:village', 'Settlement COOP'], ['pool', 'AMM pool']] : []);
	const TOOLS = [
		['you', '◉', 'You'],
		['mint', '♥', 'Mint'],
		['invest', '↗', 'Invest'],
		['swap', '⇄', 'Swap'],
		['mips', '✎', 'Proposals'],
		['ledger', '≡', 'Ledger'],
		['rules', '⚙', 'Rules']
	];
	const labelOf = (k) => (k === 'pool' ? 'AMM pool' : k.startsWith('coop:') ? COOPS[k.slice(5)].name : view?.players[k.slice(7)]?.name);
	const mindOf = (k) => COOPS[k.slice(5)].mind;
</script>

<div class="v1">
	<canvas class="stage" bind:this={canvas}></canvas>

	{#if view}
		<!-- the names over the things in the world: tap one to open it -->
		{#each Object.entries(labels) as [k, l] (k)}
			{#if l.on}
				<button class="tag" class:me={k === `player:${seat}`} style="left:{l.x}px;top:{l.y}px" onclick={() => (k.startsWith('player:') ? ((seat = k.slice(7)), open('you')) : open(k))}>
					{labelOf(k)}
					{#if k.startsWith('player:')}<small>♥ {f(view.players[k.slice(7)].wallet.HEARTS, 1)}</small>{:else if k === 'pool'}<small>{p == null ? 'empty' : `1 Maia = ${f(p, 3)} Village`}</small>{:else}<small>{f(view.coops[k.slice(5)].treasury[mindOf(k)], 1)} {TOKEN_LABEL[mindOf(k)]}</small>{/if}
				</button>
			{/if}
		{/each}
	{/if}

	<div class="brand panel">MaiaCity <b>V1</b></div>

	{#if view && player}
		<div class="topstats">
			<span class="stat panel" title="HEARTS held, and ready to mint"><span class="heart">♥</span> <b>{f(player.wallet.HEARTS, 1)}</b>{#if mint.amount > 0.05}<em>+{f(mint.amount, 1)}</em>{/if}</span>
			<span class="stat panel" title="MaiaMIND"><i style="background:#5f8f6e"></i> <b>{f(player.wallet.MAIA, 1)}</b></span>
			<span class="stat panel" title="VillageMIND"><i style="background:#c87a4f"></i> <b>{f(player.wallet.VILLAGE, 1)}</b></span>
		</div>

		<div class="topright">
			<div class="seg panel">
				{#each SEATS as s (s)}
					<button class:on={seat === s} onclick={() => ((seat = s), (ledgerOfWho = ''))}>{view.players[s].name}{view.players[s].founder === me ? ' · you' : ''}</button>
				{/each}
			</div>
			<span class="clock panel">Y{cal.year} · M{cal.month} · D{cal.day} {pad(Math.floor(hour))}:{pad(Math.floor((hour % 1) * 60))}</span>
		</div>

		<nav class="tools" class:open={tools}>
			{#each TOOLS as [id, ic, label] (id)}
				<button class:on={panel === id} onclick={() => open(id)}><span class="ic">{ic}</span>{label}{#if id === 'mips' && openMips.length}<span class="badge">{openMips.length}</span>{/if}</button>
			{/each}
			<p class="speednote">a month a real day · rent in {dur(nextMonth - now)}</p>
		</nav>
		<button class="fab" class:on={tools} aria-label="Tools" onclick={() => (tools = !tools)}>
			<svg viewBox="0 0 24 24"><path d={tools ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} /></svg>
		</button>

		{#if panel}
		<aside class="card panel" class:wide={panel === 'ledger' || panel === 'mips'}>
			<button class="close" aria-label="Close" onclick={() => (panel = null)}>×</button>

			{#if panel === 'you'}
				<p class="eyebrow">{mine ? 'You' : player.founder ? 'The other player' : 'A free seat'}</p>
				<h2>{player.name}</h2>
				{#if !player.founder && !mySeat}
					<p class="about">Take this seat to play. Your HEARTS grow 24 a day.</p>
					<div class="buttons"><button class="primary" disabled={busy} onclick={() => run(() => takeSeat(seat))}>Play as {player.name}</button></div>
				{/if}
				<div class="wares">
					<div><span>HEARTS</span><b>{f(player.wallet.HEARTS)}</b></div>
					<div><span>Ready to mint</span><b>{f(mint.amount)}</b></div>
					<div><span>MaiaMIND</span><b>{f(player.wallet.MAIA)}</b></div>
					<div><span>VillageMIND</span><b>{f(player.wallet.VILLAGE)}</b></div>
				</div>
				<dl>
					<dt>Share of all MaiaMIND</dt><dd>{total?.MAIA ? `${f((player.wallet.MAIA / total.MAIA) * 100, 1)} %` : '—'}</dd>
					<dt>Share of all VillageMIND</dt><dd>{total?.VILLAGE ? `${f((player.wallet.VILLAGE / total.VILLAGE) * 100, 1)} %` : '—'}</dd>
					<dt>Tent rent</dt><dd>{f(view.settings.tentRent)} VillageMIND a month</dd>
					{#if player.arrears > 0.001}<dt>Rent owed</dt><dd class="bad">{f(player.arrears)} VillageMIND</dd>{/if}
				</dl>
				{#if canMove}
					<div class="buttons">
						<button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => doMove({ type: 'mint' })}>Mint {f(mint.amount)} HEARTS</button>
						<button onclick={() => open('invest')}>Invest</button>
					</div>
					{#if !mine}<p class="small">Admin: you move for this seat.</p>{/if}
				{/if}
			{:else if panel === 'mint'}
				<p class="eyebrow">Your HEARTS</p>
				<h2>Mint</h2>
				<p class="about">Your HEARTS grow 24 a day, one an hour. Mint whenever you like: you get all that grew since your last mint. The right to mint reaches back 24 h only, so growth older than that is lost. HEARTS you hold stay.</p>
				<div class="wares">
					<div><span>Ready to mint</span><b>{f(mint.amount)}</b></div>
					<div><span>Last mint</span><b class="small">{player.lastMint ? `${dur(now - player.lastMint)} ago` : 'never'}</b></div>
				</div>
				{#if mint.lost > 0.001}<p class="bad small">{f(mint.lost)} HEARTS grew more than 24 h ago and are lost.</p>{:else if mint.full > now}<p class="small">Full 24 HEARTS in {dur(mint.full - now)}: mint before then so none are lost.</p>{/if}
				{#if canMove}<div class="buttons"><button class="primary" disabled={busy || mint.amount < 0.001} onclick={() => doMove({ type: 'mint' })}>Mint {f(mint.amount)} HEARTS</button></div>{/if}
			{:else if panel === 'invest'}
				<p class="eyebrow">{f(player.wallet.HEARTS)} HEARTS held</p>
				<h2>Invest HEARTS</h2>
				<p class="about">Each HEART makes 1 MIND of the COOP: half yours, half its treasury. {f(view.settings.poolShare * 100, 0)} % of the treasury half goes into the pool.</p>
				{#if canMove}
					<div class="row">
						<input type="number" min="0" step="1" bind:value={amount} />
						<button onclick={() => (amount = Math.floor(player.wallet.HEARTS * 1e6) / 1e6)}>All</button>
					</div>
					<div class="buttons col">
						{#each Object.keys(COOPS) as id (id)}
							<button class="primary" disabled={busy || !(player.wallet.HEARTS > 0)} onclick={() => doMove({ type: 'invest', coop: id, amount })}>Into the {COOPS[id].name}</button>
						{/each}
					</div>
				{/if}
			{:else if panel === 'swap'}
				<p class="eyebrow">AMM pool</p>
				<h2>Swap</h2>
				<p class="about">Constant product, owned by no one. A {f(view.settings.swapFee * 100, 1)} % fee stays in the pool.</p>
				{#if canMove}
					<div class="row">
						<input type="number" min="0" step="0.1" bind:value={swapAmount} />
						<select bind:value={swapToken}>
							<option value="MAIA">MaiaMIND → VillageMIND</option>
							<option value="VILLAGE">VillageMIND → MaiaMIND</option>
						</select>
					</div>
					<div class="buttons"><button class="primary" disabled={busy || !(swapOut > 0)} onclick={() => doMove({ type: 'swap', token: swapToken, amount: swapAmount })}>Swap for {f(swapOut, 3)} {TOKEN_LABEL[swapToken === 'MAIA' ? 'VILLAGE' : 'MAIA']}</button></div>
				{/if}
				<dl>
					<dt>Pool MaiaMIND</dt><dd>{f(view.pool.MAIA, 3)}</dd>
					<dt>Pool VillageMIND</dt><dd>{f(view.pool.VILLAGE, 3)}</dd>
					<dt>1 MaiaMIND</dt><dd>{p == null ? 'needs both sides' : `${f(p, 4)} VillageMIND`}</dd>
				</dl>
			{:else if panel?.startsWith('coop:')}
				{@const c = view.coops[panel.slice(5)]}
				<p class="eyebrow">COOP · mints {TOKEN_LABEL[c.mind]}</p>
				<h2>{c.name}</h2>
				<p class="about">Owns {c.owns}.</p>
				<dl>
					<dt>Treasury MaiaMIND</dt><dd>{f(c.treasury.MAIA)}</dd>
					<dt>Treasury VillageMIND</dt><dd>{f(c.treasury.VILLAGE)}</dd>
					{#if c.id === 'village'}
						<dt>Gets tent rent</dt><dd>{f(view.settings.tentRent)} × 2 VillageMIND</dd>
						<dt>Pays hex rent</dt><dd>{f(view.settings.hexRent)} MaiaMIND</dd>
					{:else}
						<dt>Gets hex rent</dt><dd>{f(view.settings.hexRent)} MaiaMIND</dd>
					{/if}
					{#if c.arrears > 0.001}<dt>Rent owed</dt><dd class="bad">{f(c.arrears)} MaiaMIND</dd>{/if}
				</dl>
				<div class="buttons">
					{#if canMove}<button class="primary" onclick={() => open('invest')}>Invest</button>{/if}
					{#if canMove}<button onclick={() => newMip({ from: panel, to: `player:${seat}`, token: c.mind, amount: 1 })}>Propose a payout</button>{/if}
					<button onclick={() => { const k = panel; panel = 'ledger'; ledgerOfWho = k; }}>Its ledger</button>
				</div>
			{:else if panel === 'pool'}
				<p class="eyebrow">Never withdrawn</p>
				<h2>AMM pool</h2>
				<p class="about">{f(view.settings.poolShare * 100, 0)} % of every treasury half flows in. Rent payers swap through it when they lack a MIND.</p>
				<dl>
					<dt>MaiaMIND</dt><dd>{f(view.pool.MAIA, 3)}</dd>
					<dt>VillageMIND</dt><dd>{f(view.pool.VILLAGE, 3)}</dd>
					<dt>1 MaiaMIND</dt><dd>{p == null ? 'needs both sides' : `${f(p, 4)} VillageMIND`}</dd>
				</dl>
				<div class="buttons"><button class="primary" onclick={() => open('swap')}>Swap</button><button onclick={() => { panel = 'ledger'; ledgerOfWho = 'pool'; }}>Its ledger</button></div>
			{:else if panel === 'ledger'}
				<p class="eyebrow">Every transaction</p>
				<h2>Ledger</h2>
				<select class="full" bind:value={ledgerOfWho}>
					<option value="">{player.name} (shown)</option>
					{#each holdersList as [id, label] (id)}<option value={id}>{label}</option>{/each}
				</select>
				{#if lines.length}
					<div class="ledger">
						{#each lines as e (e.id)}
							<div class="line">
								<span class="when">{vdate(e.vm)}<small>{LABELS[e.kind] ?? e.kind}</small></span>
								<span class="what">
									{#if e.kind === 'settings' || e.kind === 'proposal'}{e.note}
									{:else}{e.from === who ? `to ${nameOf(view, e.to)}` : `from ${nameOf(view, e.from)}`}<small>{e.note}</small>{/if}
								</span>
								{#if e.amount}
									<span class="amt" class:plus={sign(e) === '+'} class:minus={sign(e) === '−'}>{sign(e)}{f(e.amount, 3)} {TOKEN_LABEL[e.token] ?? e.token}{#if e.out}<small>+{f(e.out.amount, 3)} {TOKEN_LABEL[e.out.token]}</small>{/if}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="about">Nothing yet.</p>
				{/if}
			{:else if panel === 'mips'}
				<p class="eyebrow">MaiaCity improvement proposals</p>
				<h2>Proposals</h2>
				<p class="about">Every decision is a MIP: the settings, and payouts from a COOP treasury to any wallet. It needs {SIGNATURES} signatures and applies at once, in this same game.</p>
				{#if draft}
					<div class="draft">
						<input class="full" placeholder="Title" bind:value={draft.title} />
						<textarea class="full" rows="3" placeholder="Why, in prose" bind:value={draft.description}></textarea>
						<p class="eyebrow">Settings</p>
						<dl class="settings">
							{#each Object.keys(SETTING_LIMITS) as k (k)}
								<dt class:changed={Number(draft.settings[k]) !== view.settings[k]}>{SETTING_NAMES[k]}</dt>
								<dd><input type="number" step="any" min={SETTING_LIMITS[k][0]} max={SETTING_LIMITS[k][1]} bind:value={draft.settings[k]} /></dd>
							{/each}
						</dl>
						<p class="eyebrow">Payouts</p>
						{#each draft.payouts as x, i (i)}
							<div class="payout">
								<select bind:value={x.from}>{#each PAYERS as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
								<span>→</span>
								<select bind:value={x.to}>{#each PAYEES as id (id)}<option value={id}>{nameOf(view, id)}</option>{/each}</select>
								<input type="number" min="0" step="0.1" bind:value={x.amount} />
								<select bind:value={x.token}><option value="MAIA">MaiaMIND</option><option value="VILLAGE">VillageMIND</option></select>
								<button class="link" onclick={() => draft.payouts.splice(i, 1)}>Remove</button>
							</div>
						{/each}
						<button class="link" onclick={() => draft.payouts.push({ from: 'coop:maia', to: `player:${seat}`, token: 'MAIA', amount: 1 })}>+ Add a payout</button>
						<div class="buttons">
							<button class="primary" disabled={busy || !draft.title.trim()} onclick={propose}>Propose and sign as {player.name}</button>
							<button onclick={() => (draft = null)}>Cancel</button>
						</div>
					</div>
				{:else if canMove}
					<div class="buttons"><button class="primary" onclick={() => newMip()}>New proposal</button></div>
				{/if}
				{#each openMips as m (m.number)}
					<article class="mip open">
						<header><b>MIP #{m.number}</b><span class="status">open</span></header>
						<h3>{m.title}</h3>
						{#if m.description}<p>{m.description}</p>{/if}
						<p class="changes">{describe(view, m)}</p>
						<p class="sigs">
							{#each SEATS as s (s)}<span class:ok={m.signatures.includes(s)}>{m.signatures.includes(s) ? '✓' : '○'} {view.players[s].name}</span>{/each}
						</p>
						{#if canMove}
							<div class="buttons">
								{#if !m.signatures.includes(seat)}<button class="primary" disabled={busy} onclick={() => doMove({ type: 'sign', number: m.number })}>Sign as {player.name}</button>{/if}
								<button disabled={busy} onclick={() => doMove({ type: 'reject', number: m.number })}>{m.by === seat ? 'Withdraw' : 'Reject'}</button>
							</div>
						{/if}
					</article>
				{/each}
				{#each decidedMips as m (m.number)}
					<article class="mip {m.status}">
						<header><b>MIP #{m.number}</b><span class="status">{m.status}</span></header>
						<h3>{m.title}</h3>
						<p class="changes">{describe(view, m)}</p>
					</article>
				{/each}
			{:else if panel === 'rules'}
				<p class="eyebrow">The game’s settings</p>
				<h2>Rules</h2>
				<dl class="settings">
					{#each Object.keys(SETTING_LIMITS) as k (k)}<dt>{SETTING_NAMES[k]}</dt><dd>{view.settings[k]}</dd>{/each}
				</dl>
				<p class="about">One virtual month a real day, from year 0. Every balance melts {f(view.settings.demurrage * 100, 0)} % a year. Rent is due at each month’s end. A setting changes only through a MIP with {SIGNATURES} signatures.</p>
				<div class="buttons">
					{#if canMove}<button class="primary" onclick={() => newMip()}>Propose a change</button>{/if}
					{#if admin}<button class="danger" disabled={busy} onclick={() => confirm('Start the game again from year 0? Every balance, MIP and the ledger go.') && run(resetGame)}>Start again from year 0</button>{/if}
				</div>
			{/if}
			{#if error}<p class="error">{error}</p>{/if}
		</aside>
		{:else if error}
			<p class="error toast">{error}</p>
		{/if}
	{:else}
		<div class="loading" role="status"><p class="eyebrow">MaiaCity V1</p><strong>One hex, one tent, two players</strong><span>{error || 'Opening the game…'}</span></div>
	{/if}
</div>

<style>
	.v1 {
		position: fixed;
		inset: 0;
		background: #cfe0e6;
		color: #1f2a23;
		font-size: 0.85rem;
		overflow: hidden;
	}
	.stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		cursor: grab;
		touch-action: none;
	}
	.panel,
	.tools button,
	.tag {
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
		flex: none;
	}
	.brand {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		font-weight: 600;
	}
	.brand b {
		color: #5f8f6e;
	}
	.topstats {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 0.3rem;
	}
	.stat {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.stat em {
		font-style: normal;
		font-size: 0.72rem;
		color: #3d7a4a;
	}
	.heart {
		color: #e0435a;
	}
	.topright {
		position: absolute;
		z-index: 2;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		right: calc(1rem + env(safe-area-inset-right, 0px));
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.seg {
		display: flex;
		padding: 0.2rem;
		border-radius: 999px;
	}
	.seg button {
		padding: 0.35rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: none;
		white-space: nowrap;
	}
	.seg button.on {
		background: #fff;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
	}
	.clock {
		padding: 0.5rem 0.8rem;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.tools {
		position: absolute;
		z-index: 2;
		top: calc(5rem + env(safe-area-inset-top, 0px));
		left: calc(1rem + env(safe-area-inset-left, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 8rem;
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
	.badge {
		margin-left: auto;
		min-width: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: #c87a4f;
		color: #fff;
		font-size: 0.7rem;
		text-align: center;
	}
	.speednote {
		margin: 0.2rem 0 0;
		padding: 0 0.4rem;
		font-size: 0.66rem;
		line-height: 1.25;
		text-shadow: 0 1px 2px rgb(255 255 255 / 0.6);
	}
	.tag {
		position: absolute;
		z-index: 1;
		transform: translate(-50%, -100%);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.25rem 0.6rem;
		border-radius: 10px;
		font-size: 0.72rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.tag small {
		font-weight: 400;
		font-size: 0.66rem;
		opacity: 0.75;
	}
	.tag.me {
		background: #24452f;
		color: #f4f1e8;
	}
	.card {
		position: absolute;
		z-index: 3;
		right: calc(1rem + env(safe-area-inset-right, 0px));
		top: calc(4.6rem + env(safe-area-inset-top, 0px));
		width: 19rem;
		max-height: calc(100dvh - 9rem - var(--nav-room, 4rem));
		overflow: auto;
		padding: 0.8rem 0.9rem;
		border-radius: 16px;
	}
	.card.wide {
		width: 26rem;
	}
	.close {
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
	h2 {
		margin: 0.15rem 0 0.3rem;
		font-size: 1.15rem;
	}
	h3 {
		margin: 0.2rem 0;
		font-size: 0.95rem;
	}
	.about {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		line-height: 1.4;
		opacity: 0.85;
	}
	.small {
		font-size: 0.75rem;
	}
	.wares {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
		margin: 0.5rem 0;
	}
	.wares div {
		display: flex;
		flex-direction: column;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: rgb(31 42 35 / 0.06);
	}
	.wares span {
		font-size: 0.68rem;
		opacity: 0.65;
	}
	.wares b {
		font-size: 1.05rem;
		font-variant-numeric: tabular-nums;
	}
	.wares b.small {
		font-size: 0.85rem;
	}
	dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.25rem 0.7rem;
		margin: 0.4rem 0 0.6rem;
		font-size: 0.8rem;
	}
	dt {
		opacity: 0.65;
	}
	dt.changed {
		opacity: 1;
		font-weight: 600;
		color: #c87a4f;
	}
	dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.settings dd input {
		width: 5.5rem;
		text-align: right;
	}
	.bad {
		color: #b5523a;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.buttons.col {
		flex-direction: column;
	}
	.buttons button,
	.row button {
		padding: 0.5rem 0.8rem;
		border: 1px solid rgb(31 42 35 / 0.15);
		border-radius: 999px;
		background: #fff;
	}
	.buttons button.primary {
		background: #24452f;
		border-color: #24452f;
		color: #f4f1e8;
	}
	button.danger {
		color: #b5523a;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button.link {
		padding: 0.2rem 0;
		border: 0;
		background: none;
		color: #24452f;
		text-decoration: underline;
		font-size: 0.78rem;
	}
	.row {
		display: flex;
		gap: 0.35rem;
	}
	.row input {
		flex: 1 1 4rem;
		min-width: 3rem;
	}
	.row select {
		flex: 1 1 9rem;
		min-width: 0;
	}
	input,
	select,
	textarea {
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(31 42 35 / 0.18);
		border-radius: 10px;
		background: #fff;
		color: inherit;
		font: inherit;
		font-size: 0.82rem;
	}
	.full {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 0.35rem;
	}
	.payout {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 0.3rem;
		align-items: center;
		margin-bottom: 0.4rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid rgb(31 42 35 / 0.08);
	}
	.payout input,
	.payout select {
		min-width: 0;
	}
	.draft {
		margin: 0.4rem 0 0.6rem;
		padding: 0.6rem;
		border-radius: 12px;
		background: rgb(31 42 35 / 0.05);
	}
	.mip {
		margin-top: 0.5rem;
		padding: 0.55rem 0.65rem;
		border-radius: 12px;
		border: 1px solid rgb(31 42 35 / 0.1);
		background: #fff;
	}
	.mip header {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
	}
	.mip p {
		margin: 0.2rem 0;
		font-size: 0.78rem;
	}
	.changes {
		opacity: 0.75;
	}
	.status {
		padding: 0 0.45rem;
		border-radius: 999px;
		background: #f0c49a;
		font-size: 0.68rem;
	}
	.accepted .status {
		background: #b9d4b3;
	}
	.rejected .status,
	.withdrawn .status {
		background: rgb(31 42 35 / 0.1);
	}
	.mip:not(.open) {
		opacity: 0.75;
	}
	.sigs {
		display: flex;
		gap: 0.7rem;
	}
	.sigs .ok {
		color: #3d7a4a;
		font-weight: 600;
	}
	.ledger {
		max-height: 55dvh;
		overflow-y: auto;
	}
	.line {
		display: grid;
		grid-template-columns: 5.2rem 1fr auto;
		gap: 0.5rem;
		align-items: baseline;
		padding: 0.4rem 0;
		border-top: 1px solid rgb(31 42 35 / 0.08);
		font-size: 0.76rem;
	}
	.line small {
		display: block;
		font-size: 0.68rem;
		opacity: 0.6;
	}
	.when {
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}
	.amt {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.amt.plus {
		color: #3d7a4a;
	}
	.amt.minus {
		color: #b5523a;
	}
	.error {
		margin: 0.6rem 0 0;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		background: rgb(200 122 79 / 0.18);
		font-size: 0.78rem;
	}
	.fab {
		display: none;
	}
	.toast {
		position: absolute;
		z-index: 3;
		left: 50%;
		bottom: calc(var(--nav-room, 4rem) + 0.6rem);
		transform: translateX(-50%);
		background: rgb(250 248 242 / 0.94);
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
		text-align: center;
		padding: 1rem;
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

	/* ── a phone, upright or on its side: the tools behind one action button, the card sliding in ── */
	@media (max-width: 720px), (max-height: 500px) {
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
		}
		.speednote,
		.clock {
			display: none;
		}
		.brand {
			padding: 0.4rem 0.7rem;
		}
	}

	/* ── upright: the numbers across under the top bar, the card a sheet from the foot, at most half the screen ── */
	@media (max-width: 720px) and (min-height: 501px) {
		.topstats {
			top: calc(3.6rem + env(safe-area-inset-top, 0px));
			left: 0.5rem;
			right: 0.5rem;
			transform: none;
			justify-content: center;
		}
		.card,
		.card.wide {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-height: 50dvh;
			padding: 0.8rem 1rem var(--nav-room, 4rem);
			border-radius: 18px 18px 0 0;
			border-bottom: 0;
			box-shadow: 0 -8px 28px rgb(0 0 0 / 0.16);
			animation: sheet 240ms ease-out;
			overscroll-behavior: contain;
		}
		.ledger {
			max-height: none;
		}
	}

	/* ── on its side: the card an aside down the right, the action button on the left ── */
	@media (max-height: 500px) {
		.fab {
			right: auto;
			left: max(8px, env(safe-area-inset-left, 0px));
		}
		.tools.open {
			right: auto;
			left: max(8px, env(safe-area-inset-left, 0px));
		}
		.topstats {
			top: calc(3.2rem + env(safe-area-inset-top, 0px));
			left: calc(0.5rem + env(safe-area-inset-left, 0px));
			transform: none;
		}
		.card,
		.card.wide {
			top: calc(3.2rem + env(safe-area-inset-top, 0px));
			right: 0;
			bottom: 0;
			width: calc(min(19rem, 50vw - 5.5rem) + env(safe-area-inset-right, 0px));
			max-height: none;
			border-radius: 16px 0 0 0;
			border-right: 0;
			border-bottom: 0;
			animation: aside 240ms ease-out;
		}
	}
	@keyframes sheet {
		from {
			transform: translateY(100%);
		}
	}
	@keyframes aside {
		from {
			transform: translateX(100%);
		}
	}
</style>
