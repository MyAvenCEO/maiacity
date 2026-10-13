<!--
	Coops: the COOPs of MaiaCity V1's one game, on their own, with no world round them. The single source of truth is
	the game (game/maiacity-v1/engine.js, held by the server): each COOP, the MIND it mints, its treasury, who holds its
	MIND, what it owns (the hex, the pool, the tent, the Village COOP's machines), the rents it is paid and pays each
	weekly pay day, and, with a seat, investing HEARTS into it. Its full ledger is the Ledger app's.
-->
<script>
	// @ts-nocheck — plain JS
	import { base } from '$app/paths';
	import { COOPS, MINDS, RENTED, SEATS, TOKEN_COLOUR, TOKEN_LABEL, heartsValue, inHearts, nameOf, rents, supply } from '../../../../game/maiacity-v1/engine.js';
	import { VILLAGE_INFO } from '$lib/models/village.js';
	import { liveGame } from '$lib/maiacity-v1/live.svelte.js';
	import PoolBasket from '$lib/maiacity-v1/PoolBasket.svelte';

	const g = liveGame();
	let chosen = $state(typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('coop') ?? 'settlement') : 'settlement');
	let amount = $state(12);

	const view = $derived(g.view);
	const seat = $derived(g.mySeat);
	const me = $derived(seat ? view.players[seat] : null);
	const c = $derived(view ? view.coops[chosen] : null);
	const all = $derived(view ? rents(view) : []);
	const gets = $derived(all.filter((r) => r.to === `coop:${chosen}`));
	const pays = $derived(all.filter((r) => r.from === `coop:${chosen}`));
	const minted = $derived(view && c ? supply(view)[c.mind] : 0);
	const holders = $derived.by(() => {
		if (!view || !c) return [];
		const t = c.mind;
		const list = [...SEATS.map((s) => [`player:${s}`, view.players[s].wallet[t]]), ...Object.keys(COOPS).map((id) => [`coop:${id}`, view.coops[id].treasury[t]]), ['pool', view.pool[t]]];
		return list.filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
	});
	const hv = $derived(view ? heartsValue(view) : null);
	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
	/** what an asset earns a month, and from whom: the hex and the tent by their own settings, the machines by RENTED */
	const rentFor = (id) => {
		if (!view || !c) return null;
		if (id === 'hex') return { monthly: view.settings.hexRent, token: 'MAIA', from: 'the Settlement COOP' };
		if (id === 'tent') return { monthly: view.settings.tentRent, token: 'SETTLEMENT', from: 'each player' };
		const r = RENTED.find((x) => x.asset === id);
		return r && chosen !== 'settlement' ? { monthly: view.settings[r.setting] ?? 0, token: c.mind, from: 'the Settlement COOP' } : null;
	};
	const pct = (x) => `${f(x * 100, 1)} %`;
</script>

<svelte:head>
	<title>Coops · maiaCITY</title>
</svelte:head>

<main class="app-page">
	{#if !g.loaded}
		<p class="dim">One moment…</p>
	{:else if !view}
		<p class="dim">{g.error || 'The COOPs open once you are signed in.'}</p>
	{:else}
		<header>
			<p class="eyebrow">MaiaCity V1</p>
			<h1>COOPs</h1>
			<p class="dim">Three COOPs, each minting its own MIND. Invest HEARTS into one: half of the MIND is yours, half goes to its treasury. Every number here is read live from <a href="{base}/app/maiacity-v1/">the game</a>.</p>
		</header>

		<div class="cols">
			<nav>
				{#each Object.keys(COOPS) as id (id)}
					{@const k = view.coops[id]}
					<button class="coop" class:on={chosen === id} onclick={() => (chosen = id)}>
						<b>{k.name}</b>
						<span><i style="background:{TOKEN_COLOUR[k.mind]}"></i>{TOKEN_LABEL[k.mind]}</span>
						<small>{k.assets.map((a) => a.name).join(' · ')}</small>
					</button>
				{/each}
			</nav>

			{#if c}
				<section class="detail">
					<p class="eyebrow">COOP · mints {TOKEN_LABEL[c.mind]}</p>
					<h2>{c.name}</h2>

					<h3>Treasury <small>≈ {f(inHearts(view, c.treasury, hv))} HEARTS{chosen === 'maia' ? ` · with its pool basket ≈ ${f(inHearts(view, c.treasury, hv) + inHearts(view, view.pool, hv))} HEARTS` : ''}</small></h3>
					<ul class="rows">
						{#each MINDS as t (t)}<li><span><i style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}</span><strong>{f(c.treasury[t] * hv[t])} HEARTS <small>{f(c.treasury[t])} {TOKEN_LABEL[t]}</small></strong></li>{/each}
					</ul>
					{#if chosen === 'maia'}
						<h3>The pool basket it owns <small>the AMM pool is wholly the MaiaCity COOP's</small></h3>
						<PoolBasket {view} treasury={c.treasury} />
					{/if}

					<h3>Who holds {TOKEN_LABEL[c.mind]} <small>{f(minted)} in all · {f(minted * hv[c.mind])} HEARTS</small></h3>
					<ul class="rows">
						{#each holders as [id, v] (id)}<li><span>{nameOf(view, id)}{id === `coop:${chosen}` ? ' (its treasury)' : ''}</span><strong>{f(v * hv[c.mind])} HEARTS <small>{f(v)} {TOKEN_LABEL[c.mind]} · {pct(minted ? v / minted : 0)}</small></strong></li>{:else}<li class="dim">Nobody yet.</li>{/each}
					</ul>

					<h3>What it owns</h3>
					<ul class="rows assets">
						{#each c.assets as a (a.id)}
							{@const r = rentFor(a.id)}
							<li>
								<span><b>{a.name}</b><small>{[a.kind, VILLAGE_INFO[a.id]?.specs[1] && VILLAGE_INFO[a.id].specs[1].join(': ').toLowerCase(), r && `rented to ${r.from}`].filter(Boolean).join(' · ')}</small></span>
								{#if r}<strong>{f(r.monthly * hv[r.token])} HEARTS <small>a month · {f(r.monthly)} {TOKEN_LABEL[r.token]}</small></strong>{/if}
							</li>
						{/each}
					</ul>

					<h3>Rents each weekly pay day</h3>
					<ul class="rows">
						{#each gets as r (r.what + r.from)}<li><span>In · {r.what}<small>from {nameOf(view, r.from)}{#if r.owed > 0.001}{' · '}<em class="bad">{f(r.owed)} owed to it</em>{/if}</small></span><strong class="plus">+{f(r.weekly * hv[r.token], 3)} HEARTS <small>{f(r.weekly, 3)} {TOKEN_LABEL[r.token]}</small></strong></li>{/each}
						{#each pays as r (r.what + r.to)}<li><span>Out · {r.what}<small>to {nameOf(view, r.to)}{#if r.owed > 0.001}{' · '}<em class="bad">{f(r.owed)} owed</em>{/if}</small></span><strong class="minus">−{f(r.weekly * hv[r.token], 3)} HEARTS <small>{f(r.weekly, 3)} {TOKEN_LABEL[r.token]}</small></strong></li>{/each}
						{#if !gets.length && !pays.length}<li class="dim">No rents.</li>{/if}
					</ul>
					<p class="dim small">{f(view.settings.dividendShare * 100, 0)} % of every rent paid in {TOKEN_LABEL[c.mind]} goes on at once to its holders (Law 5).</p>

					<div class="buttons">
						{#if me}
							<input type="number" min="0" step="1" bind:value={amount} />
							<button class="pill-btn" disabled={g.busy || !(me.wallet.HEARTS >= amount && amount > 0)} onclick={() => g.move(seat, { type: 'invest', coop: chosen, amount })}>Invest {f(amount, 0)} HEARTS</button>
						{/if}
						<a class="pill-btn ghost" href="{base}/app/ledger/?who=coop:{chosen}">Its ledger</a>
					</div>
					{#if me}<p class="dim small">You hold {f(me.wallet.HEARTS)} HEARTS and {f(me.wallet[c.mind])} {TOKEN_LABEL[c.mind]}.</p>{:else}<p class="dim small">Take a seat in <a href="{base}/app/maiacity-v1/">the game</a> to invest.</p>{/if}
					{#if g.error}<p class="bad">{g.error}</p>{/if}
				</section>
			{/if}
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
		font-style: normal;
	}
	.plus {
		color: #2f6b45;
	}
	.minus {
		color: var(--terracotta);
	}
	a {
		color: var(--ink);
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	h1 {
		margin: 0.2rem 0 0.4rem;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 2.8rem);
	}
	h2 {
		margin: 0.2rem 0 0.8rem;
		font-family: var(--font-display);
		font-size: 1.7rem;
	}
	h3 {
		margin: 1.2rem 0 0.4rem;
		font-size: 1rem;
	}
	h3 small {
		font-weight: 400;
		color: var(--muted);
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
		gap: 1.5rem;
		margin-top: 1.4rem;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.coop {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.coop.on {
		background: var(--ink);
		color: var(--paper);
	}
	.coop span {
		font-size: 0.85rem;
	}
	.coop small {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	i {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.45rem;
		border-radius: 50%;
	}
	.detail {
		padding: 1.4rem 1.6rem;
		border: 1px solid var(--line);
		border-radius: 20px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rows li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.1rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.92rem;
	}
	.rows small {
		display: block;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--muted);
	}
	.rows strong {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.rows strong small {
		display: inline;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.2rem;
	}
	.buttons input {
		width: 6rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font: inherit;
	}
	.pill-btn.ghost {
		background: none;
		border: 1px solid var(--line);
		text-decoration: none;
	}
	@media (max-width: 720px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.detail {
			padding: 1.1rem 1rem;
		}
	}
</style>
