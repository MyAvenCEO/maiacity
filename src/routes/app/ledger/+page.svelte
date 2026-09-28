<!--
	Ledger: a founder's own money, on its own — no globe. What they hold (their own hearts, the city's, the MINDS of
	the coops they backed), what is ready to mint (it ticks on here with the same rule the server mints by), and what
	happened, newest first. The same data as Sandbox 2's wallet and ledger sheet.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import * as api from '$lib/sandbox-2/api';
	import type { Account, LedgerView } from '$lib/sandbox-2/api';
	import { accrued, format } from '../../../../game/time';
	import { STARTING } from '../../../../game/policy';

	let me = $state<Account | null>(null);
	let book = $state<LedgerView | null>(null);
	let now = $state(new Date());
	let phase = $state<'loading' | 'ready' | 'failed'>('loading');
	let busy = $state(false);
	let note = $state('');
	let error = $state('');

	const claimable = $derived(me ? accrued(new Date(me.lastClaimAt), now) + (me.startingPending ? STARTING : 0n) : 0n);

	async function refresh() {
		[me, book] = await Promise.all([api.account(), api.ledger().catch(() => null)]);
	}

	onMount(() => {
		refresh()
			.then(() => (phase = 'ready'))
			.catch((e) => ((error = (e as Error).message), (phase = 'failed')));
		const tick = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(tick);
	});

	async function mint() {
		busy = true;
		error = '';
		note = '';
		try {
			const r = await api.mint();
			note = `Minted ${r.claimedLabel} ${me?.token ?? '♥'}.`;
			await refresh();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Ledger · maiaCITY</title>
</svelte:head>

<main class="app-page">
	{#if phase === 'loading'}
		<p class="dim">One moment…</p>
	{:else if !me}
		<p class="dim">{error || 'Your ledger opens once you are signed in.'}</p>
	{:else}
		<section class="wallet">
			<div>
				<p class="eyebrow">Your hearts</p>
				<p class="balance">{me.balanceLabel} <small>{me.token}</small></p>
				<p class="dim">
					{#if me.city}Citizen of <a href="{base}/app/coops/?coop={me.city.slug}">{me.city.name}</a>{#if me.settlement} · living in <a href="{base}/app/coops/?coop={me.settlement.slug}">{me.settlement.name}</a>{/if}{:else}Not a citizen of a city yet — <a href="{base}/app/coops/">choose one in Coops</a>{/if}
				</p>
			</div>
			<div class="mint">
				<p class="eyebrow">Ready to mint</p>
				<p class="ready">+{format(claimable)} <small>{me.token}</small></p>
				<button class="pill-btn" disabled={busy || claimable < 10n ** 16n} onclick={mint}>{busy ? 'Minting…' : 'Mint'}</button>
			</div>
		</section>
		{#if note}<p class="ok">{note}</p>{/if}
		{#if error}<p class="bad">{error}</p>{/if}

		<div class="cols">
			<section>
				<h2>What you hold</h2>
				<ul class="holdings">
					{#each book?.holdings ?? me.holdings as h (h.token)}
						<li class={h.kind}><span>{h.token}</span><strong>{h.balanceLabel}</strong></li>
					{:else}
						<li class="dim">Nothing yet — mint your first hearts.</li>
					{/each}
				</ul>
			</section>
			<section>
				<h2>What happened</h2>
				<ul class="txs">
					{#each book?.transactions ?? [] as t (t.id)}
						<li>
							<span>{t.title}</span>
							<strong class={t.sign === '+' ? 'plus' : 'minus'}>{t.sign}{t.figure} <small>{t.token}</small></strong>
						</li>
					{:else}
						<li class="dim">No transactions yet.</li>
					{/each}
				</ul>
			</section>
		</div>
	{/if}
</main>

<style>
	.app-page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.6rem clamp(1rem, 4vw, 2rem) 0;
	}

	.dim {
		color: var(--muted);
	}

	.ok {
		color: #2f6b45;
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
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 1.5rem;
		margin-top: 1.8rem;
	}

	h2 {
		margin: 0 0 0.7rem;
		font-size: 1.3rem;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.holdings li,
	.txs li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0.2rem;
		border-bottom: 1px solid var(--line);
	}

	.holdings li.own strong {
		color: var(--ink);
	}

	.holdings li.minds span {
		color: #2f6b45;
	}

	.holdings li.city span {
		color: var(--terracotta);
	}

	.txs strong {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.plus {
		color: #2f6b45;
	}

	.minus {
		color: var(--terracotta);
	}

	.txs small {
		font-weight: 400;
		color: var(--muted);
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
