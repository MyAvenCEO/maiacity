<!--
	One wallet's ledger in MaiaCity V1: a player's, a COOP's or the pool's. Its rent subscriptions in and out for each
	weekly pay day, the dividends it can expect, what the next pay day nets it, what the last pay days actually moved,
	and every transaction, newest first. All of it read off the one game (game/maiacity-v1/engine.js): the game's
	Ledger card and the dashboard's Ledger app both show this.
-->
<script>
	// @ts-nocheck — plain JS
	import Mark from './Mark.svelte';
	import { MINDS, TOKEN_LABEL, dateOf, dateText, dividendsOf, heartsValue, ledgerOf, nameOf, payDaysOf, rents } from '../../../game/maiacity-v1/engine.js';

	/** show: 'all', or only the 'cash' flow (rents, dividends, pay days) or only the 'tx' (every transaction) */
	let { view, who, limit = 200, show = 'all', tall = false } = $props();

	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: Math.min(d, 2) }));
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
	const hv = $derived(view ? heartsValue(view) : null);
	const net = $derived(hv ? weekNet.reduce((a, [t, x]) => a + x * 4 * hv[t], 0) : 0);
	const days = $derived(view ? payDaysOf(view, who) : []);
	const signed = (x, d = 3) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${f(Math.abs(x), d)}`;
	const sign = (e) => (e.kind === 'arrears' ? '' : e.to === who ? '+' : e.from === who ? '−' : '');
	const LABELS = { mint: 'Minted', invest: 'Invested', pool: 'To the pool', swap: 'Swap', rent: 'Rent', arrears: 'Owed', demurrage: 'Melt', expired: 'Expired', settings: 'Settings', proposal: 'MIP', payout: 'Payout', dividend: 'Dividend' };
</script>

{#if show !== 'tx'}
		{#if subsIn.length || subsOut.length || divs.length}
			<p class="eyebrow">Cash flow · a month, paid weekly</p>
			<div class="flow">
				{#if subsIn.length || divs.length}<p class="group">In</p>{/if}
				{#each subsIn as r (r.what + r.from + r.to)}
					<div class="row" title="paid weekly, {f(r.weekly)} {TOKEN_LABEL[r.token]} each pay day"><span>{r.what}<small>from {nameOf(view, r.from)}{#if r.owed > 0.001} · <b class="bad">{f(r.owed)} owed to it</b>{/if}</small></span><span class="amt plus">+{f(r.monthly * hv[r.token])} ❤︎<small>{f(r.monthly)} {TOKEN_LABEL[r.token]}</small></span></div>
				{/each}
				{#each divs as r (r.what + r.from)}
					<div class="row" title="{f(view.settings.dividendShare * 100, 0)} % of its {r.what.toLowerCase()}, for the {TOKEN_LABEL[r.token]} held now"><span>Dividend<small>{nameOf(view, r.from)} · {r.what.toLowerCase()}</small></span><span class="amt plus">+{f(r.weekly * 4 * hv[r.token])} ❤︎<small>{f(r.weekly * 4)} {TOKEN_LABEL[r.token]}</small></span></div>
				{/each}
				{#if subsOut.length}<p class="group">Out</p>{/if}
				{#each subsOut as r (r.what + r.from + r.to)}
					<div class="row" title="paid weekly, {f(r.weekly)} {TOKEN_LABEL[r.token]} each pay day"><span>{r.what}<small>to {nameOf(view, r.to)}{#if r.owed > 0.001} · <b class="bad">{f(r.owed)} owed</b>{/if}</small></span><span class="amt minus">−{f(r.monthly * hv[r.token])} ❤︎<small>{f(r.monthly)} {TOKEN_LABEL[r.token]}</small></span></div>
				{/each}
				<div class="row net" title="4 pay days a month; a payer short of the MIND swaps through the pool"><span>Net a month<small>next pay day {vdate((view.week + 1) / 4)}</small></span><span class="amt" class:plus={net > 0} class:minus={net < 0}>{signed(net, 2)} ❤︎<small>{weekNet.map(([t, x]) => `${signed(x * 4)} ${TOKEN_LABEL[t]}`).join(' · ')}</small></span></div>
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
					{@const other = e.kind === 'settings' || e.kind === 'proposal' ? 'mip' : e.from === who ? e.to : e.from}
					<div class="tx" title={e.note}>
						<Mark {view} id={other} size={34} />
						<span class="what">
							<b>{LABELS[e.kind] ?? e.kind}</b>
							<small>{#if e.kind === 'settings' || e.kind === 'proposal'}{e.note}{:else}{e.from === who ? 'to' : 'from'} {nameOf(view, other)}{/if} · {vdate(e.vm)}</small>
						</span>
						{#if e.amount}
							<span class="amt" class:plus={sign(e) === '+'} class:minus={sign(e) === '−'}>{#if MINDS.includes(e.token)}{sign(e)}{f(e.amount * hv[e.token], 3)} ❤︎<small>{f(e.amount, 3)} {TOKEN_LABEL[e.token]}</small>{:else}{sign(e)}{f(e.amount, 3)} {e.token === 'HEARTS' ? '❤︎' : (TOKEN_LABEL[e.token] ?? e.token)}{/if}{#if e.out}<small>for {f(e.out.amount, 3)} {TOKEN_LABEL[e.out.token]} · {f(e.out.amount * (hv[e.out.token] ?? 1), 3)} ❤︎</small>{/if}</span>
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
	.tx {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.65rem;
		align-items: center;
		padding: 0.45rem 0;
		border-top: 1px solid rgb(31 42 35 / 0.08);
		font-size: 0.8rem;
	}
	.tx .what b {
		display: block;
		font-weight: 600;
	}
	.tx small {
		display: block;
		font-size: 0.68rem;
		opacity: 0.6;
	}
	.flow {
		margin-bottom: 0.8rem;
	}
	.flow .group {
		margin: 0.5rem 0 0.1rem;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}
	.flow .row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.35rem 0;
		border-top: 1px solid rgb(31 42 35 / 0.08);
		font-size: 0.8rem;
	}
	.flow .row small {
		display: block;
		font-size: 0.68rem;
		opacity: 0.6;
	}
	.flow .row .bad {
		color: #b5523a;
		font-weight: 600;
	}
	.flow .row.net {
		margin-top: 0.3rem;
		border-top: 1px solid rgb(31 42 35 / 0.25);
		font-weight: 600;
	}
	.flow .row.net small {
		font-weight: 400;
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
