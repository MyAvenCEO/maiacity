<!--
	MaiaCity V1: the one shared game, as both players see it. The server holds the game (api/src/maiacity-v1.js); the
	page reads it every few seconds and, in between, runs the same rules (game/maiacity-v1/engine.js) forward to the
	second, so the clock, the melt and the HEARTS' expiry count live. Every move goes to the server.
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { COOPS, DAY_MS, SEATS, SETTING_LIMITS, TOKEN_LABEL, advance, calendar, ledgerOf, mintState, nameOf, price, quote, supply } from '../../../game/maiacity-v1/engine.js';
	import { loadGame, resetGame, sendMove, takeSeat } from './store.js';

	let game = $state.raw(null);
	let me = $state('');
	let admin = $state(false);
	let skew = 0; // server time minus this browser's
	let tick = $state(Date.now());
	let error = $state('');
	let busy = $state(false);
	let seat = $state('A');
	let amount = $state(12);
	let swapToken = $state('MAIA');
	let swapAmount = $state(1);
	let ledgerOfWho = $state('');
	let draft = $state(null);

	const now = $derived(tick + skew);
	const view = $derived(game ? advance(game, now) : null);
	const player = $derived(view?.players[seat]);
	const mine = $derived(player?.founder === me);
	const canMove = $derived(!!player && (mine || admin));
	const mySeat = $derived(view ? SEATS.find((s) => view.players[s].founder === me) : null);
	const cal = $derived(view ? calendar(view, now) : null);
	const mint = $derived(view ? mintState(view, seat, now) : null);
	const who = $derived(ledgerOfWho || `player:${seat}`);
	const lines = $derived(view ? ledgerOf(view, who).slice(0, 200) : []);
	const p = $derived(view ? price(view) : null);
	const total = $derived(view ? supply(view) : null);
	const swapOut = $derived(view ? quote(view, swapToken, Number(swapAmount) || 0) : 0);
	const nextMonth = $derived(view ? view.started + (view.month + 1) * DAY_MS : 0);

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
		if (busy) return;
		busy = true;
		error = '';
		try {
			take(await fn());
		} catch (e) {
			error = e?.message ?? String(e);
		} finally {
			busy = false;
		}
	}

	const doMove = (action) => run(() => sendMove(seat, action));

	onMount(() => {
		refresh().then(() => {
			if (mySeat) seat = mySeat;
		});
		const t = setInterval(() => (tick = Date.now()), 1000);
		const r = setInterval(refresh, 15000);
		return () => (clearInterval(t), clearInterval(r));
	});

	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
	const dur = (ms) => {
		if (!Number.isFinite(ms)) return '—';
		const s = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
	};
	const vdate = (vm) => {
		const whole = Math.floor(vm);
		return `Y${Math.floor(whole / 12)} M${(whole % 12) + 1} D${Math.floor((vm - whole) * 30) + 1}`;
	};
	const sign = (e) => (e.kind === 'arrears' ? '' : e.to === who ? '+' : e.from === who ? '−' : '');
	const LABELS = { mint: 'Minted', invest: 'Invested', pool: 'To the pool', swap: 'Swap', rent: 'Rent', arrears: 'Owed', demurrage: 'Melt', expired: 'Expired', settings: 'Settings' };
	const SETTING_NAMES = { heartsPerDay: 'HEARTS a day', demurrage: 'Demurrage a year (0.07 = 7 %)', poolShare: 'Treasury share to the pool', swapFee: 'Swap fee', tentRent: 'Tent rent, each player a month (VillageMIND)', hexRent: 'Hex rent, Settlement COOP a month (MaiaMIND)' };
	const holdersList = $derived(view ? [...SEATS.map((s) => [`player:${s}`, view.players[s].name]), ['coop:maia', 'MaiaCity COOP'], ['coop:village', 'Settlement COOP'], ['pool', 'AMM pool']] : []);
</script>

<main class="v1">
	<header>
		<p class="eyebrow">MaiaCity V1</p>
		{#if cal}
			<h1>Year {cal.year} · Month {cal.month} · Day {cal.day}</h1>
			<p class="lede">One virtual month a real day. Rent is due in {dur(nextMonth - now)}. Every balance melts 7 % a year.</p>
		{:else}
			<h1>MaiaCity V1</h1>
		{/if}
	</header>

	{#if error}<p class="error">{error}</p>{/if}

	{#if view}
		<nav class="seats">
			{#each SEATS as s (s)}
				{@const pl = view.players[s]}
				<button class:on={seat === s} onclick={() => ((seat = s), (ledgerOfWho = ''))}>
					<b>{pl.name}</b>
					<span>{pl.founder === me ? 'You' : pl.founder ? 'Taken' : 'Free seat'}</span>
				</button>
			{/each}
		</nav>

		<section class="card player">
			<div class="head">
				<h2>{player.name}</h2>
				{#if !player.founder && !mySeat}
					<button class="primary" disabled={busy} onclick={() => run(() => takeSeat(seat))}>Play as {player.name}</button>
				{:else if !mine && admin}
					<span class="tag">Admin: you may move for this seat</span>
				{/if}
			</div>

			<div class="balances">
				<div><span>HEARTS</span><b>{f(player.wallet.HEARTS)}</b><small>{player.wallet.HEARTS > 0.001 && player.lastMint != null ? `expire in ${dur(player.lastMint + DAY_MS - now)}` : 'none held'}</small></div>
				<div><span>MaiaMIND</span><b>{f(player.wallet.MAIA)}</b><small>{total?.MAIA ? `${f((player.wallet.MAIA / total.MAIA) * 100, 1)} % of all` : ' '}</small></div>
				<div><span>VillageMIND</span><b>{f(player.wallet.VILLAGE)}</b><small>{total?.VILLAGE ? `${f((player.wallet.VILLAGE / total.VILLAGE) * 100, 1)} % of all` : ' '}</small></div>
				<div><span>Rent owed</span><b class:bad={player.arrears > 0.001}>{f(player.arrears)}</b><small>VillageMIND · {f(view.settings.tentRent)} a month</small></div>
			</div>

			{#if canMove}
				<div class="moves">
					<div class="move">
						<h3>Mint</h3>
						<button class="primary" disabled={busy || !mint.can} onclick={() => doMove({ type: 'mint' })}>
							{mint.can ? `Mint today’s ${view.settings.heartsPerDay} HEARTS` : `Next mint in ${dur(mint.next - now)}`}
						</button>
						<small>Mint at least every 24 h, or the HEARTS you still hold expire.</small>
					</div>
					<div class="move">
						<h3>Invest HEARTS</h3>
						<div class="row">
							<input type="number" min="0" step="1" bind:value={amount} />
							<button class="ghost" onclick={() => (amount = Math.floor(player.wallet.HEARTS * 1e6) / 1e6)}>All</button>
						</div>
						<div class="row">
							{#each Object.keys(COOPS) as id (id)}
								<button disabled={busy || !(player.wallet.HEARTS > 0)} onclick={() => doMove({ type: 'invest', coop: id, amount })}>Into the {COOPS[id].name}</button>
							{/each}
						</div>
						<small>Each HEART makes 1 MIND: half yours, half the COOP’s treasury ({f(view.settings.poolShare * 100, 0)} % of that to the pool).</small>
					</div>
					<div class="move">
						<h3>Swap through the pool</h3>
						<div class="row">
							<input type="number" min="0" step="0.1" bind:value={swapAmount} />
							<select bind:value={swapToken}>
								<option value="MAIA">MaiaMIND → VillageMIND</option>
								<option value="VILLAGE">VillageMIND → MaiaMIND</option>
							</select>
						</div>
						<div class="row">
							<button disabled={busy || !(swapOut > 0)} onclick={() => doMove({ type: 'swap', token: swapToken, amount: swapAmount })}>Swap for {f(swapOut, 3)} {TOKEN_LABEL[swapToken === 'MAIA' ? 'VILLAGE' : 'MAIA']}</button>
						</div>
					</div>
				</div>
			{:else if player.founder}
				<p class="note">This is the other player’s seat. You see everything they hold and do.</p>
			{/if}
		</section>

		<div class="grid">
			{#each Object.values(view.coops) as c (c.id)}
				<section class="card">
					<h2>{c.name}</h2>
					<p class="note">Owns {c.owns}. Mints {TOKEN_LABEL[c.mind]}.</p>
					<dl>
						<dt>Treasury, MaiaMIND</dt><dd>{f(c.treasury.MAIA)}</dd>
						<dt>Treasury, VillageMIND</dt><dd>{f(c.treasury.VILLAGE)}</dd>
						{#if c.id === 'village'}
							<dt>Gets tent rent</dt><dd>{f(view.settings.tentRent)} VillageMIND × 2 a month</dd>
							<dt>Pays hex rent</dt><dd>{f(view.settings.hexRent)} MaiaMIND a month</dd>
						{:else}
							<dt>Gets hex rent</dt><dd>{f(view.settings.hexRent)} MaiaMIND a month</dd>
						{/if}
						{#if c.arrears > 0.001}<dt>Rent owed</dt><dd class="bad">{f(c.arrears)} MaiaMIND</dd>{/if}
					</dl>
					<button class="ghost" onclick={() => (ledgerOfWho = `coop:${c.id}`)}>Its ledger</button>
				</section>
			{/each}
			<section class="card">
				<h2>AMM pool</h2>
				<p class="note">Constant product, owned by no one, never withdrawn. Swaps pay a {f(view.settings.swapFee * 100, 1)} % fee into it.</p>
				<dl>
					<dt>MaiaMIND</dt><dd>{f(view.pool.MAIA, 3)}</dd>
					<dt>VillageMIND</dt><dd>{f(view.pool.VILLAGE, 3)}</dd>
					<dt>1 MaiaMIND</dt><dd>{p == null ? 'needs both sides' : `${f(p, 4)} VillageMIND`}</dd>
				</dl>
				<button class="ghost" onclick={() => (ledgerOfWho = 'pool')}>Its ledger</button>
			</section>
		</div>

		<section class="card">
			<div class="head">
				<h2>Ledger · {nameOf(view, who)}</h2>
				<select bind:value={ledgerOfWho}>
					<option value="">The player shown</option>
					{#each holdersList as [id, label] (id)}<option value={id}>{label}</option>{/each}
				</select>
			</div>
			{#if lines.length}
				<div class="ledger">
					{#each lines as e (e.id)}
						<div class="line">
							<span class="when">{vdate(e.vm)}</span>
							<span class="kind k-{e.kind}">{LABELS[e.kind] ?? e.kind}</span>
							<span class="what">
								{#if e.kind === 'settings'}{e.note}
								{:else}{e.from === who ? `to ${nameOf(view, e.to)}` : `from ${nameOf(view, e.from)}`}<small>{e.note}</small>{/if}
							</span>
							{#if e.kind !== 'settings'}
								<span class="amt" class:plus={sign(e) === '+'} class:minus={sign(e) === '−'}>{sign(e)}{f(e.amount, 3)} {TOKEN_LABEL[e.token] ?? e.token}{#if e.out}<small>+{f(e.out.amount, 3)} {TOKEN_LABEL[e.out.token]}</small>{/if}</span>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="note">Nothing yet.</p>
			{/if}
		</section>

		<section class="card">
			<div class="head">
				<h2>Settings</h2>
				{#if (mySeat || admin) && !draft}<button class="ghost" onclick={() => (draft = { ...view.settings })}>Edit</button>{/if}
			</div>
			<dl class="settings">
				{#each Object.keys(SETTING_LIMITS) as k (k)}
					<dt>{SETTING_NAMES[k]}</dt>
					<dd>
						{#if draft}<input type="number" step="any" min={SETTING_LIMITS[k][0]} max={SETTING_LIMITS[k][1]} bind:value={draft[k]} />{:else}{view.settings[k]}{/if}
					</dd>
				{/each}
			</dl>
			{#if draft}
				<div class="row">
					<button class="primary" disabled={busy} onclick={() => run(() => sendMove(mySeat ?? seat, { type: 'settings', settings: draft })).then(() => (draft = null))}>Save</button>
					<button class="ghost" onclick={() => (draft = null)}>Cancel</button>
				</div>
			{/if}
			{#if admin}
				<p class="note">
					Admin: <button class="ghost danger" disabled={busy} onclick={() => confirm('Start the game again from year 0? Every balance and the ledger go.') && run(resetGame)}>Start again from year 0</button>
				</p>
			{/if}
		</section>
	{:else if !error}
		<p class="note">Loading the game…</p>
	{/if}
</main>

<style>
	.v1 {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2.5rem clamp(1rem, 4vw, 2rem) 7rem;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.4rem 0 0;
		font-size: clamp(1.8rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
	}
	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
	}
	.lede,
	.note {
		color: var(--ink-soft);
	}
	.note {
		margin: 0.4rem 0 0.8rem;
		font-size: 0.9rem;
	}
	.error {
		padding: 0.7rem 1rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--terracotta) 15%, transparent);
		color: var(--ink);
	}
	.seats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin: 1.6rem 0 1rem;
	}
	.seats button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--paper);
		color: var(--ink);
		cursor: pointer;
		text-align: left;
	}
	.seats button.on {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	.seats span {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.card {
		margin: 0 0 14px;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: var(--paper);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.balances {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
		margin: 1rem 0;
	}
	.balances div {
		display: flex;
		flex-direction: column;
		padding: 0.7rem 0.8rem;
		border-radius: 12px;
		background: color-mix(in srgb, var(--sage) 12%, transparent);
	}
	.balances span {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.balances b {
		font-size: 1.35rem;
		font-variant-numeric: tabular-nums;
	}
	.balances small {
		font-size: 0.72rem;
		color: var(--muted);
	}
	.moves {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.move small {
		display: block;
		margin-top: 0.4rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}
	.row input {
		flex: 1 1 5rem;
		min-width: 4rem;
	}
	.row select {
		flex: 1 1 10rem;
		min-width: 0;
	}
	input,
	select {
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--cream);
		color: var(--ink);
		font: inherit;
	}
	button {
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--cream);
		color: var(--ink);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button.primary {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}
	button.ghost {
		background: transparent;
	}
	button.danger {
		color: var(--terracotta);
	}
	.tag {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.grid .card {
		margin: 0 0 14px;
	}
	dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.3rem 0.8rem;
		margin: 0 0 0.8rem;
		font-size: 0.9rem;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.settings dd input {
		width: 7rem;
		text-align: right;
	}
	.bad {
		color: var(--terracotta);
	}
	.ledger {
		margin-top: 0.8rem;
		max-height: 28rem;
		overflow-y: auto;
	}
	.line {
		display: grid;
		grid-template-columns: 6.5rem 6rem 1fr auto;
		gap: 0.6rem;
		align-items: baseline;
		padding: 0.45rem 0;
		border-top: 1px solid var(--line);
		font-size: 0.86rem;
	}
	.line small {
		display: block;
		font-size: 0.74rem;
		color: var(--muted);
	}
	.when {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.kind {
		font-weight: 600;
	}
	.amt {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.amt.plus {
		color: color-mix(in srgb, var(--sage) 80%, var(--ink));
	}
	.amt.minus {
		color: var(--terracotta);
	}
	@media (max-width: 760px) {
		.balances {
			grid-template-columns: 1fr 1fr;
		}
		.moves,
		.grid {
			grid-template-columns: 1fr;
		}
		.line {
			grid-template-columns: 5.5rem 1fr auto;
		}
		.line .kind {
			display: none;
		}
	}
</style>
