<!--
	One wallet's ledger in MaiaCity V1: a player's, a COOP's or the pool's. Its rent subscriptions in and out for each
	weekly pay day, the dividends it can expect, what the next pay day nets it, what the last pay days actually moved,
	and every transaction, newest first. All of it read off the one game (game/maiacity-v1/engine.js): the game's
	Ledger card and the dashboard's Ledger app both show this.
-->
<script>
	// @ts-nocheck — plain JS
	import { MINDS, TOKEN_LABEL, dateOf, dateText, dividendsOf, ledgerOf, nameOf, payDaysOf, rents } from '../../../game/maiacity-v1/engine.js';

	/** show: 'all', or only the 'cash' flow (rents, dividends, pay days) or only the 'tx' (every transaction) */
	let { view, who, limit = 200, show = 'all', tall = false } = $props();

	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
	const vdate = (vm) => dateText(dateOf(vm));
	const lines = $derived(view ? ledgerOf(view, who).slice(0, limit) : []);
	const subs = $derived(view ? rents(view) : []);
	const subsIn = $derived(subs.filter((r) => r.to === who));
	const subsOut = $derived(subs.filter((r) => r.from === who));
	const divs = $derived(view ? dividendsOf(view, who) : []);
	const weekNet = $derived.by(() => {
		const n = {};
		for (const r of [...subsIn, ...divs]) n[r.token] = (n[r.token] ?? 0) + r.weekly;
		for (const r of subsOut) n[r.token] = (n[r.token] ?? 0) - r.weekly;
		return MINDS.filter((t) => t in n).map((t) => [t, n[t]]);
	});
	const days = $derived(view ? payDaysOf(view, who) : []);
	const signed = (x, d = 3) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x), d)}`;
	const sign = (e) => (e.kind === 'arrears' ? '' : e.to === who ? '+' : e.from === who ? '−' : '');
	const LABELS = { mint: 'Minted', invest: 'Invested', pool: 'To the pool', swap: 'Swap', rent: 'Rent', arrears: 'Owed', demurrage: 'Melt', expired: 'Expired', settings: 'Settings', proposal: 'MIP', payout: 'Payout', dividend: 'Dividend' };
</script>

{#if show !== 'tx'}
		{#if subsIn.length || subsOut.length || divs.length}
			<p class="eyebrow">Subscriptions in and out · by their interval</p>
			<div class="subs">
				{#each subsIn as r (r.what + r.from + r.to)}
					<div class="line"><span class="when">In<small>{r.what}</small></span><span class="what">from {nameOf(view, r.from)}<small>paid weekly, {f(r.weekly, 3)} each pay day{#if r.owed > 0.001} · <b class="bad">{f(r.owed)} owed to it</b>{/if}</small></span><span class="amt plus">+{f(r.monthly)} {TOKEN_LABEL[r.token]}<small>a month</small></span></div>
				{/each}
				{#each divs as r (r.what + r.from)}
					<div class="line"><span class="when">In<small>Dividend</small></span><span class="what">from {nameOf(view, r.from)}<small>{f(view.settings.dividendShare * 100, 0)} % of its {r.what.toLowerCase()}, for the {TOKEN_LABEL[r.token]} held now · paid weekly with it</small></span><span class="amt plus">+{f(r.weekly * 4, 3)} {TOKEN_LABEL[r.token]}<small>a month</small></span></div>
				{/each}
				{#each subsOut as r (r.what + r.from + r.to)}
					<div class="line"><span class="when">Out<small>{r.what}</small></span><span class="what">to {nameOf(view, r.to)}<small>paid weekly, {f(r.weekly, 3)} each pay day{#if r.owed > 0.001} · <b class="bad">{f(r.owed)} owed</b>{/if}</small></span><span class="amt minus">−{f(r.monthly)} {TOKEN_LABEL[r.token]}<small>a month</small></span></div>
				{/each}
				<div class="line total"><span class="when">Net<small>a month</small></span><span class="what">next pay day {vdate((view.week + 1) / 4)}<small>4 pay days a month; a payer short of the MIND swaps through the pool</small></span><span class="amt">{#each weekNet as [t, x] (t)}<span class:plus={x > 0} class:minus={x < 0}>{signed(x * 4)} {TOKEN_LABEL[t]}</span>{/each}</span></div>
			</div>
		{/if}
		{#if days.length && show === 'all'}
			<p class="eyebrow">Cash flow, the last pay days</p>
			<div class="subs">
				{#each days as d (d.week)}
					<div class="line">
						<span class="when">{vdate(d.vm)}<small>week {d.week}</small></span>
						<span class="what">{#each MINDS.filter((t) => d.flows[t]) as t (t)}<small>{TOKEN_LABEL[t]}: in {f(d.flows[t].in, 3)} · out {f(d.flows[t].out, 3)}</small>{/each}</span>
						<span class="amt">{#each MINDS.filter((t) => d.flows[t]) as t (t)}{@const x = d.flows[t].in - d.flows[t].out}<span class:plus={x > 0} class:minus={x < 0}>{signed(x)} {TOKEN_LABEL[t]}</span>{/each}</span>
					</div>
				{/each}
			</div>
		{/if}
		{#if show === 'cash' && !subsIn.length && !subsOut.length && !divs.length}<p class="about">No rents in or out yet.</p>{/if}
{/if}
{#if show !== 'cash'}
		<p class="eyebrow">Every transaction</p>
		{#if lines.length}
			<div class="ledger" class:tall>
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

{/if}

<style>
	.eyebrow {
		margin: 0.6rem 0 0;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
	}
	.about {
		margin: 0 0 0.6rem;
		font-size: 0.78rem;
		opacity: 0.85;
	}
	.ledger {
		max-height: 40dvh;
		overflow-y: auto;
	}
	.ledger.tall {
		max-height: none;
	}
	.subs {
		margin-bottom: 0.6rem;
	}
	.subs .amt span {
		display: block;
	}
	.plus {
		color: #3d7a4a;
	}
	.minus {
		color: #b5523a;
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
	.line.total {
		border-top: 1px solid rgb(31 42 35 / 0.25);
		font-weight: 600;
	}
	.line .bad {
		color: #b5523a;
		font-weight: 600;
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
	@media (max-width: 720px), (max-height: 500px) {
		.ledger {
			max-height: none;
		}
	}
</style>
