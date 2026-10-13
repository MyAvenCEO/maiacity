<!--
	PoolBasket: the AMM pool basket the MaiaCity COOP owns, MIND by MIND: what lies in it, its Balancer weight, what that
	is worth in HEARTS, the display currency (engine heartsValue), and its share of the basket's value. With `treasury`, it also adds
	the treasury and the basket together, so the COOP's whole holding reads in one place.
-->
<script>
	// @ts-nocheck — plain JS
	import { MINDS, TOKEN_COLOUR, TOKEN_LABEL, heartsValue, weights } from '../../../game/maiacity-v1/engine.js';

	let { view, treasury = null } = $props();

	const w = $derived(weights(view));
	const hv = $derived(heartsValue(view));
	const worth = $derived(Object.fromEntries(MINDS.map((t) => [t, view.pool[t] * hv[t]])));
	const total = $derived(MINDS.reduce((a, t) => a + worth[t], 0));
	const f = (n, d = 2) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: Math.min(d, 2) }));
	const pct = (x) => `${f(x * 100, 1)} %`;
</script>

<ul class="basket">
	{#each MINDS as t (t)}
		<li>
			<span><i style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}<small>weight {pct(w[t])} · {pct(total ? worth[t] / total : 0)} of its value</small></span>
			<strong>{f(worth[t])} ❤︎<small>{f(view.pool[t])} {TOKEN_LABEL[t]}</small></strong>
		</li>
	{/each}
	<li class="sum"><span>Basket value</span><strong>{f(total)} <small class="inline">❤︎</small></strong></li>
</ul>
{#if treasury}
	<p class="label">Treasury and basket together</p>
	<ul class="basket">
		{#each MINDS as t (t)}
			<li><span><i style="background:{TOKEN_COLOUR[t]}"></i>{TOKEN_LABEL[t]}</span><strong>{f((treasury[t] + view.pool[t]) * hv[t])} ❤︎<small>{f(treasury[t] + view.pool[t])} {TOKEN_LABEL[t]}</small></strong></li>
		{/each}
		<li class="sum"><span>All of it</span><strong>{f(MINDS.reduce((a, t) => a + (treasury[t] + view.pool[t]) * hv[t], 0))} <small class="inline">❤︎</small></strong></li>
	</ul>
{/if}

<style>
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0.2rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.92rem;
	}
	small {
		display: block;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--muted);
	}
	small.inline {
		display: inline;
	}
	strong {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.sum {
		font-weight: 600;
	}
	i {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		margin-right: 0.45rem;
		border-radius: 50%;
	}
	.label {
		margin: 1rem 0 0.3rem;
		font-size: 0.85rem;
		font-weight: 600;
	}
</style>
