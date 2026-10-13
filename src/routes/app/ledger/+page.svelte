<!--
	Ledger: the money of MaiaCity V1's one game, on its own, with no world round it. The single source of truth is the
	game (game/maiacity-v1/engine.js, held by the server): your seat's HEARTS and MINDs, what is ready to mint (the
	game's own rule, on the game clock), and, for any player, COOP or the pool, its rents in and out, what each weekly
	pay day nets it, what the last pay days moved, and every transaction ($lib/maiacity-v1/LedgerView.svelte, the same
	view as the game's Ledger card).
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { COOPS, MINDS, SEATS, TOKEN_COLOUR, TOKEN_LABEL, calendar, dateText, mintState, nameOf } from '../../../../game/maiacity-v1/engine.js';
	import { liveGame } from '$lib/maiacity-v1/live.svelte.js';
	import LedgerView from '$lib/maiacity-v1/LedgerView.svelte';

	const g = liveGame();
	let chosen = $state(typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('who') ?? '') : '');

	const view = $derived(g.view);
	const seat = $derived(g.mySeat);
	const me = $derived(seat ? view.players[seat] : null);
	const who = $derived(chosen || (seat ? `player:${seat}` : 'player:A'));
	const mint = $derived(view && seat ? mintState(view, seat, g.now) : null);
	const cal = $derived(view ? calendar(view, g.now) : null);
	const wallets = $derived(view ? [...SEATS.map((s) => [`player:${s}`, view.players[s].name + (s === seat ? ' (you)' : '')]), ...Object.keys(COOPS).map((id) => [`coop:${id}`, view.coops[id].name]), ['pool', 'AMM pool (MaiaCity COOP)']] : []);
	const balance = $derived.by(() => {
		if (!view) return null;
		const [kind, id] = who.split(':');
		return kind === 'player' ? view.players[id].wallet : kind === 'coop' ? view.coops[id].treasury : view.pool;
	});
	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
</script>

<svelte:head>
	<title>Ledger · maiaCITY</title>
</svelte:head>

<main class="app-page">
	{#if !g.loaded}
		<p class="dim">One moment…</p>
	{:else if !view}
		<p class="dim">{g.error || 'Your ledger opens once you are signed in.'}</p>
	{:else}
		<section class="wallet">
			<div>
				<p class="eyebrow">{me ? `${me.name} · your HEARTS` : 'MaiaCity V1'}</p>
				{#if me}
					<p class="balance">{f(me.wallet.HEARTS)} <small>HEARTS</small></p>
					<p class="dim">{MINDS.map((t) => `${f(me.wallet[t])} ${TOKEN_LABEL[t]}`).join(' · ')}</p>
				{:else}
					<p class="balance small">No seat yet</p>
					<p class="dim">Take a seat in <a href="{base}/app/maiacity-v1/">the game</a> to mint and invest. Every wallet below is open to read.</p>
				{/if}
				<p class="dim">{cal ? `${cal.weekday} ${cal.day} ${cal.name} · year ${cal.year} (${dateText(cal)})` : ''}</p>
			</div>
			{#if me && mint}
				<div class="mint">
					<p class="eyebrow">Ready to mint</p>
					<p class="ready">+{f(mint.amount)} <small>HEARTS</small></p>
					<button class="pill-btn" disabled={g.busy || !(mint.amount > 0.005)} onclick={() => g.move(seat, { type: 'mint' })}>{g.busy ? 'Minting…' : 'Mint'}</button>
				</div>
			{/if}
		</section>
		{#if g.error}<p class="bad">{g.error}</p>{/if}

		<div class="cols">
			<section>
				<h2>Whose ledger</h2>
				<ul class="wallets">
					{#each wallets as [id, label] (id)}
						<li><button class:on={who === id} onclick={() => (chosen = id)}>{label}</button></li>
					{/each}
				</ul>
				<h2 class="hold">What {nameOf(view, who)} holds</h2>
				<ul class="holdings">
					{#if who.startsWith('player:')}<li><span>HEARTS</span><strong>{f(balance.HEARTS)}</strong></li>{/if}
					{#each MINDS as t (t)}<li><span><i style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}</span><strong>{f(balance[t])}</strong></li>{/each}
				</ul>
				<p class="dim small">The one game is the source of every number here: <a href="{base}/app/maiacity-v1/">MaiaCity V1</a>.</p>
			</section>
			<section class="book">
				<LedgerView {view} {who} />
			</section>
		</div>
	{/if}
</main>

<style>
	.app-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 6rem;
	}
	.dim {
		color: var(--muted);
	}
	.small {
		font-size: 0.85rem;
	}
	.bad {
		color: var(--terracotta);
	}
	a {
		color: var(--ink);
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
	}
	.wallet {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1.6rem 1.8rem;
		border-radius: 20px;
		background: var(--ink);
		color: var(--paper);
	}
	.wallet .eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgb(250 248 242 / 0.7);
	}
	.wallet .dim {
		margin: 0.4rem 0 0;
		color: rgb(250 248 242 / 0.7);
	}
	.wallet a {
		color: var(--paper);
	}
	.balance {
		margin: 0.2rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(2.4rem, 6vw, 3.6rem);
		line-height: 1;
	}
	.balance.small {
		font-size: 2rem;
	}
	.balance small,
	.ready small {
		font-family: var(--font-body);
		font-size: 0.9rem;
		opacity: 0.75;
	}
	.mint {
		text-align: right;
	}
	.ready {
		margin: 0.2rem 0 0.7rem;
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-variant-numeric: tabular-nums;
		color: var(--mustard);
	}
	.mint .pill-btn {
		background: var(--mustard);
		color: var(--ink);
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
		gap: 1.5rem;
		margin-top: 1.8rem;
	}
	h2 {
		margin: 0 0 0.7rem;
		font-size: 1.3rem;
	}
	h2.hold {
		margin-top: 1.4rem;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.wallets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.wallets button {
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.wallets button.on {
		background: var(--ink);
		color: var(--paper);
	}
	.holdings li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.2rem;
		border-bottom: 1px solid var(--line);
	}
	.holdings i {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.45rem;
		border-radius: 50%;
	}
	.holdings strong {
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 720px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.mint {
			text-align: left;
		}
	}
</style>
