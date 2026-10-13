<!--
	Ledger: the money of MaiaCity V1's one game, on its own, with no world round it. The single source of truth is the
	game (game/maiacity-v1/engine.js, held by the server): your seat's HEARTS and MINDs, what is ready to mint (the
	game's own rule, on the game clock), and, for any player, COOP or the pool, its rents in and out, what each weekly
	pay day nets it, by interval, and every transaction ($lib/maiacity-v1/LedgerView.svelte, the same
	view as the game's Ledger card).
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { COOPS, MINDS, SEATS, TOKEN_COLOUR, TOKEN_LABEL, calendar, dateText, heartsValue, inHearts, mintState, nameOf } from '../../../../game/maiacity-v1/engine.js';
	import { liveGame } from '$lib/maiacity-v1/live.svelte.js';
	import LedgerView from '$lib/maiacity-v1/LedgerView.svelte';
	import PoolBasket from '$lib/maiacity-v1/PoolBasket.svelte';
	import Mark from '$lib/maiacity-v1/Mark.svelte';

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
	let tab = $state('tx');
	const TABS = [['tx', 'Transactions'], ['cash', 'Cash flow'], ['assets', 'Assets']];
	const heartsLabel = $derived(who.startsWith('player:') ? `${((n) => n.charAt(0).toLowerCase() + n.slice(1))(view.players[who.slice(7)].name.replace(/\s+/g, ''))}HEARTS` : 'HEARTS');
	const hv = $derived(view ? heartsValue(view) : null);
	/** the chosen wallet's whole worth in HEARTS; the MaiaCity COOP's counts the pool basket it owns */
	const total = $derived(view && balance ? inHearts(view, balance, hv) + (who === 'coop:maia' ? inHearts(view, view.pool, hv) : 0) : 0);
	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: Math.min(d, 2) }));
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
				<p class="eyebrow">{me ? `${me.name} · all you hold, in ❤︎` : 'MaiaCity V1'}</p>
				{#if me}
					<p class="balance">{f(inHearts(view, me.wallet, hv))} <small>❤︎</small></p>
				{:else}
					<p class="balance small">No seat yet</p>
					<p class="dim">Take a seat in <a href="{base}/app/maiacity-v1/">the game</a> to mint and invest. Every wallet below is open to read.</p>
				{/if}
				<p class="dim">{cal ? `${cal.weekday} ${cal.day} ${cal.name} · year ${cal.year} (${dateText(cal)})` : ''}</p>
			</div>
			{#if me && mint}
				<div class="mint">
					<p class="eyebrow">Ready to mint</p>
					<p class="ready">+{f(mint.amount)} <small>❤︎</small></p>
					<button class="pill-btn" disabled={g.busy || !(mint.amount > 0.005)} onclick={() => g.move(seat, { type: 'mint' })}>{g.busy ? 'Minting…' : 'Mint'}</button>
				</div>
			{/if}
		</section>
		{#if g.error}<p class="bad">{g.error}</p>{/if}

		<div class="body">
			<nav class="bar" aria-label="Whose ledger">
				{#each wallets as [id, label], i (id)}
					{#if i === SEATS.length || i === wallets.length - 1}<hr />{/if}
					<button class="slot" class:on={who === id} title={label} aria-label={label} aria-current={who === id ? 'true' : undefined} onclick={() => (chosen = id)}>
						<Mark {view} {id} />
					</button>
				{/each}
			</nav>

			<div class="side">
				<header class="whose">
					<small>{who.startsWith('player:') ? 'Player' : who === 'pool' ? 'AMM pool · owned by the MaiaCity COOP' : 'COOP'}</small>
					<h2>{nameOf(view, who)}</h2>
					<p class="worth">{f(total)} <span>❤︎{who === 'coop:maia' ? ', treasury and pool basket' : ''}</span></p>
					<p class="dim small" title="The average MIND is worth 1 HEART; the pool says how each stands against it">1 MIND in ❤︎: {MINDS.map((t) => `${TOKEN_LABEL[t]} ${f(hv[t])}`).join(' · ')}</p>
				</header>
				<div class="tabs" role="tablist">
					{#each TABS as [id, label] (id)}
						<button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
					{/each}
				</div>

				<div class="split">
					<section class="left">
						<div class="pane" class:off={tab !== 'assets'}>
							<p class="eyebrow">{who === 'coop:maia' ? 'Assets · its treasury' : 'Assets'}</p>
							<ul class="holdings">
								{#if who.startsWith('player:')}<li><span><i class="heart"></i>{heartsLabel}</span><strong>{f(balance.HEARTS)} ❤︎</strong></li>{/if}
								{#each MINDS as t (t)}<li><span><i style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}</span><strong>{f(balance[t] * hv[t])} ❤︎<small>{f(balance[t])} {TOKEN_LABEL[t]}</small></strong></li>{/each}
							</ul>
							{#if who === 'coop:maia'}
								<p class="eyebrow">The pool basket it owns</p>
								<p class="dim small">The AMM pool belongs wholly to the MaiaCity COOP, so its basket is part of what the COOP holds.</p>
								<PoolBasket {view} treasury={balance} />
							{:else if who === 'pool'}
								<p class="eyebrow">Inside the basket</p>
								<PoolBasket {view} />
							{/if}
						</div>
						<div class="pane" class:off={tab !== 'cash'}>
							<LedgerView {view} {who} show="cash" />
						</div>
					</section>
					<section class="right pane" class:off={tab !== 'tx'}>
						<LedgerView {view} {who} show="tx" tall />
					</section>
				</div>
				<p class="dim small">The one game is the source of every number here: <a href="{base}/app/maiacity-v1/">MaiaCity V1</a>.</p>
			</div>
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
	.wallet > div:first-child {
		flex: 1 1 20rem;
		min-width: 0;
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
	/* room for the wallet bar, which stands at the browser's left edge on its full height, as avenDB's vault bar */
	.app-page:has(.bar) {
		padding-left: calc(72px + clamp(1rem, 4vw, 2rem));
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 1.8rem;
		align-items: start;
	}
	.bar {
		position: fixed;
		z-index: 20;
		top: 0;
		bottom: 0;
		left: 0;
		width: 72px;
		box-sizing: border-box;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.55rem;
		padding: calc(0.9rem + env(safe-area-inset-top, 0px)) 0 7rem;
		background: #e6e0d4;
	}
	.bar hr {
		width: 2rem;
		margin: 0.1rem 0;
		border: 0;
		border-top: 2px solid rgb(0 0 0 / 0.12);
	}
	.slot {
		position: relative;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}
	/* the picked wallet's marker at the bar's edge, as avenDB marks the vault open */
	.slot::before {
		position: absolute;
		left: -14px;
		width: 5px;
		height: 0;
		border-radius: 0 4px 4px 0;
		background: var(--ink);
		content: '';
		transition: height 0.15s ease;
	}
	.slot:hover::before {
		height: 12px;
	}
	.slot.on::before {
		height: 36px;
	}
	.slot :global(.mark) {
		transition: transform 0.15s ease;
	}
	.slot:hover :global(.mark) {
		transform: scale(1.06);
	}
	.whose small {
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.worth {
		margin: 0 0 0.3rem;
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-variant-numeric: tabular-nums;
	}
	.worth span {
		font-family: var(--font-body);
		font-size: 0.85rem;
		color: var(--muted);
	}
	.holdings strong small {
		display: block;
		text-align: right;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--muted);
	}
	.whose h2 {
		margin: 0.1rem 0 0.8rem;
		font-family: var(--font-display);
		font-size: 1.7rem;
	}
	.tabs {
		display: none;
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem;
	}
	.left .pane + .pane {
		margin-top: 1.4rem;
	}
	.eyebrow {
		margin: 0.4rem 0 0.4rem;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.pane > .eyebrow:not(:first-child) {
		margin-top: 1.2rem;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
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
	.holdings i.heart {
		background: var(--terracotta);
	}
	.holdings strong {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 720px) {
		.mint {
			text-align: left;
		}
		.body {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
			margin-top: 1.2rem;
		}
		.app-page:has(.bar) {
			padding-left: clamp(1rem, 4vw, 2rem);
		}
		.bar {
			position: static;
			width: auto;
			flex-direction: row;
			overflow-x: auto;
			padding: 0.6rem 0.8rem;
			border-radius: 16px;
		}
		.bar hr {
			width: 0;
			height: 2rem;
			border-top: 0;
			border-left: 2px solid rgb(0 0 0 / 0.12);
		}
		.slot::before {
			display: none;
		}
		.slot.on :global(.mark) {
			outline: 3px solid var(--ink);
			outline-offset: 2px;
		}
		.tabs {
			display: flex;
			gap: 0.3rem;
			margin-bottom: 1rem;
			padding: 0.25rem;
			border-radius: 999px;
			background: #e6e0d4;
		}
		.tabs button {
			flex: 1;
			padding: 0.5rem 0.4rem;
			border: 0;
			border-radius: 999px;
			background: none;
			color: var(--ink);
			font: inherit;
			font-size: 0.85rem;
			cursor: pointer;
		}
		.tabs button.on {
			background: var(--ink);
			color: var(--paper);
		}
		.split {
			grid-template-columns: minmax(0, 1fr);
			gap: 0;
		}
		.left .pane + .pane {
			margin-top: 0;
		}
		.off {
			display: none;
		}
	}
</style>
