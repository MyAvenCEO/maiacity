<!--
	One config card (game/economy/params.js), as a MIP shows it: its kind, name and id, the values it holds (each against
	what it was, when it changes a card that is there), its JSON data and its QuickJS code. Against a card it changes,
	what changed comes first, from → to, and what stays the same folds away (Samuel, 2026-10-10: a diff, for an overview);
	changed code shows as a line diff.
-->
<script>
	import { PARAMS } from './rules.js';
	import { HOOK_NAMES } from '../../../game/economy/params.js';

	/** @type {{ card: any, base?: any, removed?: boolean, editing?: boolean }} */
	let { card, base = undefined, removed = false, editing = false } = $props();

	const param = (/** @type {string} */ k) => PARAMS.find((p) => p.key === k);
	// every value it holds, and any the card it replaces held that it drops (back to the catalogue's default)
	const order = (/** @type {string} */ k) => (PARAMS.findIndex((p) => p.key === k) + PARAMS.length + 1) % (PARAMS.length + 1);
	const keys = $derived([...new Set([...Object.keys(card.values ?? {}), ...Object.keys(base?.values ?? {})])].sort((a, b) => order(a) - order(b)));
	const codeChanged = $derived(base !== undefined && (base?.code ?? '') !== (card.code ?? ''));
	// the hooks its code exports, as far as a quick look tells (the sandbox knows for sure)
	const hooks = $derived([...new Set([...(card.code ?? '').matchAll(/export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+)(\w+)/g)].map((m) => m[1]).filter((n) => HOOK_NAMES.includes(n)))]);
	const dataChanged = $derived(base !== undefined && JSON.stringify(base?.data ?? null) !== JSON.stringify(card.data ?? null));
	// against a card it changes: the values that change, and those that stay the same (folded)
	const against = $derived(base !== undefined && base !== null && !removed);
	const moved = $derived(against ? keys.filter((k) => card.values?.[k] !== base?.values?.[k]) : keys);
	const kept = $derived(against ? keys.filter((k) => card.values?.[k] === base?.values?.[k]) : []);
	/** a line diff of two texts: the changed lines with two lines around them, the rest as "… n lines the same" */
	function lineDiff(/** @type {string} */ a, /** @type {string} */ b) {
		const x = a.split('\n'),
			y = b.split('\n');
		const n = x.length,
			m = y.length;
		// longest common subsequence, from the end
		const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
		/** @type {{ t: ' ' | '+' | '-', s: string }[]} */
		const all = [];
		let i = 0,
			j = 0;
		while (i < n && j < m) {
			if (x[i] === y[j]) all.push({ t: ' ', s: x[i++] }), j++;
			else if (L[i + 1][j] >= L[i][j + 1]) all.push({ t: '-', s: x[i++] });
			else all.push({ t: '+', s: y[j++] });
		}
		while (i < n) all.push({ t: '-', s: x[i++] });
		while (j < m) all.push({ t: '+', s: y[j++] });
		const near = all.map((l, k) => all.slice(Math.max(0, k - 2), k + 3).some((o) => o.t !== ' '));
		/** @type {({ t: ' ' | '+' | '-', s: string } | { skip: number })[]} */
		const out = [];
		for (let k = 0; k < all.length; k++) {
			if (near[k]) out.push(all[k]);
			else if (out.at(-1) && 'skip' in /** @type {any} */ (out.at(-1))) /** @type {any} */ (out.at(-1)).skip++;
			else out.push({ skip: 1 });
		}
		return { lines: out, added: all.filter((l) => l.t === '+').length, removed: all.filter((l) => l.t === '-').length };
	}
	const codeDiff = $derived(against && codeChanged ? lineDiff(base?.code ?? '', card.code ?? '') : null);
</script>

<div class="card" class:removed>
	<div class="head">
		<span class="kind {card.kind}">{card.kind}</span>
		<b>{card.name || card.id}</b>
		<code>{card.id}</code>
		{#if removed}<span class="tag out">taken out</span>{:else if base === null}<span class="tag new">new card</span>{/if}
	</div>
	{#if card.description}<p class="about">{card.description}</p>{/if}
	{#if !removed && moved.length}
		<div class="rows">
			{#each moved as k (k)}{@render row(k)}{/each}
		</div>
	{/if}
	{#if kept.length}
		<details class="same">
			<summary>{kept.length} value{kept.length === 1 ? '' : 's'} the same</summary>
			<div class="rows">
				{#each kept as k (k)}{@render row(k)}{/each}
			</div>
		</details>
	{/if}
	{#if !removed && card.data !== undefined}
		<div class="label">Data {#if dataChanged}<span class="tag">changed</span>{/if}</div>
		<pre>{JSON.stringify(card.data, null, 2)}</pre>
	{/if}
	{#if editing}<!-- its code is edited right under it -->{:else if !removed && codeDiff}
		<details class="code">
			<summary class="label">Code, run in the QuickJS sandbox{#if hooks.length}: {hooks.join(', ')}{/if} <span class="tag">changed</span> <span class="plus">+{codeDiff.added}</span> <span class="minus">−{codeDiff.removed}</span></summary>
			<pre class="diff">{#each codeDiff.lines as l, i (i)}{#if 'skip' in l}<span class="skip">… {l.skip} line{l.skip === 1 ? '' : 's'} the same</span>
{:else}<span class={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>{l.t} {l.s}</span>
{/if}{/each}</pre>
		</details>
	{:else if !removed && card.code}
		<!-- folded until asked for: the hooks it changes and whether it changed show on the toggle -->
		<details class="code">
			<summary class="label">Code, run in the QuickJS sandbox{#if hooks.length}: {hooks.join(', ')}{/if} {#if codeChanged}<span class="tag">changed</span>{/if}</summary>
			<pre>{card.code}</pre>
		</details>
	{:else if !removed && codeChanged}
		<div class="label">Code <span class="tag">taken out</span></div>
	{/if}
</div>

{#snippet row(/** @type {string} */ k)}
	{@const p = param(k)}
	{@const now = card.values?.[k]}
	{@const was = base?.values?.[k]}
	{@const changed = base !== undefined && now !== was}
	<div class="row" class:changed>
		<span class="name">{p?.label ?? k}</span>
		<span class="val">
			{#if changed && base !== null}<s>{was == null ? `default ${p?.value}` : was}</s> → {/if}{#if now == null}<i>default {p?.value}</i>{:else}<b>{now}</b>{/if}
			<small>{p?.unit ?? ''}</small>
		</span>
	</div>
{/snippet}

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
	.rows {
		display: grid;
		grid-template-columns: minmax(10rem, max-content) 1fr;
		margin-top: 0.3rem;
		font-size: 0.8rem;
	}
	.row {
		display: contents;
	}
	.row > span {
		padding: 0.22rem 0.4rem;
		border-top: 1px solid #1f2a2312;
	}
	.row .val {
		font-variant-numeric: tabular-nums;
	}
	.row .val small {
		color: #8a8984;
		font-size: 0.7rem;
	}
	.row .val s {
		color: #8a5a00;
	}
	.row.changed .name {
		box-shadow: inset 3px 0 0 #eda100;
		padding-left: 0.6rem;
		font-weight: 600;
	}
	.same {
		margin-top: 0.3rem;
		font-size: 0.75rem;
		color: #6b6a66;
	}
	.same summary {
		cursor: pointer;
	}
	.plus {
		color: #136b4b;
		font-size: 0.7rem;
	}
	.minus {
		color: #a03224;
		font-size: 0.7rem;
	}
	pre.diff .add {
		color: #8fe0b0;
	}
	pre.diff .del {
		color: #f19a8f;
	}
	pre.diff .skip {
		color: #8a9a8f;
		font-style: italic;
	}
	.label {
		margin-top: 0.4rem;
		font-size: 0.72rem;
		color: #52514e;
	}
	summary.label {
		cursor: pointer;
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
