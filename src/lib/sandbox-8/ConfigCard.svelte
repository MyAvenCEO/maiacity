<!--
	One config card (game/economy/params.js), as a MIP shows it: its kind, name and id, the values it holds (each against
	what it was, when it changes a card that is there), its JSON data and its QuickJS code.
-->
<script>
	import { PARAMS } from './rules.js';

	/** @type {{ card: any, base?: any, removed?: boolean, editing?: boolean }} */
	let { card, base = undefined, removed = false, editing = false } = $props();

	const param = (/** @type {string} */ k) => PARAMS.find((p) => p.key === k);
	// every value it holds, and any the card it replaces held that it drops (back to the catalogue's default)
	const order = (/** @type {string} */ k) => (PARAMS.findIndex((p) => p.key === k) + PARAMS.length + 1) % (PARAMS.length + 1);
	const keys = $derived([...new Set([...Object.keys(card.values ?? {}), ...Object.keys(base?.values ?? {})])].sort((a, b) => order(a) - order(b)));
	const codeChanged = $derived(base !== undefined && (base?.code ?? '') !== (card.code ?? ''));
	// the hooks its code exports, as far as a quick look tells (the sandbox knows for sure)
	const hooks = $derived([...new Set([...(card.code ?? '').matchAll(/export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)(mint|decay|rot|harvest)\b/g)].map((m) => m[1]))]);
	const dataChanged = $derived(base !== undefined && JSON.stringify(base?.data ?? null) !== JSON.stringify(card.data ?? null));
</script>

<div class="card" class:removed>
	<div class="head">
		<span class="kind {card.kind}">{card.kind}</span>
		<b>{card.name || card.id}</b>
		<code>{card.id}</code>
		{#if removed}<span class="tag out">taken out</span>{:else if base === null}<span class="tag new">new card</span>{/if}
	</div>
	{#if card.description}<p class="about">{card.description}</p>{/if}
	{#if !removed && keys.length}
		<table>
			<tbody>
				{#each keys as k (k)}
					{@const p = param(k)}
					{@const now = card.values?.[k]}
					{@const was = base?.values?.[k]}
					<tr class:changed={base !== undefined && now !== was}>
						<td>{p?.label ?? k} <small>{p?.section ?? ''}</small></td>
						<td class="num">
							{#if now == null}<i>default {p?.value}</i>{:else}<b>{now}</b>{/if}
							<small>{p?.unit ?? ''}</small>
						</td>
						<td class="was">{#if base !== undefined && now !== was}{base === null || was == null ? 'was the default' : `was ${was}`}{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	{#if !removed && card.data !== undefined}
		<div class="label">Data {#if dataChanged}<span class="tag">changed</span>{/if}</div>
		<pre>{JSON.stringify(card.data, null, 2)}</pre>
	{/if}
	{#if editing}<!-- its code is edited right under it -->{:else if !removed && card.code}
		<div class="label">Code, run in the QuickJS sandbox{#if hooks.length}: changes {hooks.join(', ')}{/if} {#if codeChanged}<span class="tag">changed</span>{/if}</div>
		<pre>{card.code}</pre>
	{:else if !removed && codeChanged}
		<div class="label">Code <span class="tag">taken out</span></div>
	{/if}
</div>

<style>
	.card {
		border: 1px solid #1f2a231f;
		border-radius: 10px;
		padding: 0.5rem 0.7rem;
		margin-top: 0.5rem;
		background: #fcfbf7;
	}
	.card.removed {
		opacity: 0.6;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.head code {
		font-size: 0.7rem;
		color: #6b6a66;
	}
	.kind {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
		background: #24452f1a;
		color: #24452f;
	}
	.kind.world {
		background: #2f5d8a1a;
		color: #2f5d8a;
	}
	.kind.resource,
	.kind.recipe {
		background: #8a5a001a;
		color: #8a5a00;
	}
	.tag {
		font-size: 0.65rem;
		background: #eda10022;
		color: #8a5a00;
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}
	.tag.new {
		background: #1baf7a22;
		color: #136b4b;
	}
	.tag.out {
		background: #c0392b1f;
		color: #a03224;
	}
	.about {
		margin: 0.25rem 0 0;
		color: #52514e;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
		margin-top: 0.3rem;
	}
	td {
		padding: 0.2rem 0.3rem;
		border-top: 1px solid #1f2a2312;
	}
	td small {
		color: #8a8984;
		font-size: 0.68rem;
	}
	td.num {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	td.was {
		color: #8a5a00;
		font-size: 0.72rem;
		white-space: nowrap;
	}
	tr.changed td:first-child {
		box-shadow: inset 3px 0 0 #eda100;
		padding-left: 0.5rem;
	}
	.label {
		margin-top: 0.4rem;
		font-size: 0.72rem;
		color: #52514e;
	}
	pre {
		background: #1f2a23;
		color: #e8efe9;
		border-radius: 8px;
		padding: 0.5rem 0.6rem;
		font-size: 0.7rem;
		overflow: auto;
		max-height: 18rem;
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
	}
</style>
