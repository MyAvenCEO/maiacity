<!--
	The studio's lenses, as a database studio lists its migrations, but none is ever run on the data: each lens joins two
	versions of a schema, both ways, so an app on either reads what the other writes. Each with the versions it joins and
	its steps in words (a field the newer adds, steps for each record of a list, a value converted by its rules, each way),
	and its JSON as published.
-->
<script>
	import Icon from './Icon.svelte';
	import { parsed, sideOf, steps } from './db.js';
	import { count, short } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio }} */
	let { s } = $props();
</script>

{#snippet rules(/** @type {[any, any][]} */ rows, /** @type {string} */ from, /** @type {string} */ to)}
	<table class="rules">
		<thead><tr><th>When {from} reads</th><th>{to} reads</th></tr></thead>
		<tbody>
			{#each rows as [when, then], i (i)}
				<tr><td><code>{sideOf(when)}</code></td><td><code>{sideOf(then)}</code></td></tr>
			{/each}
		</tbody>
	</table>
{/snippet}

{#snippet stepList(/** @type {import('./db.js').Step[]} */ list)}
	<ol class="steps">
		{#each list as st, i (i)}
			<li>
				{#if 'add' in st}
					<span class="step add">add</span> <code>{st.add}</code> <span class="soft">a field only the newer version has</span>
				{:else if 'in' in st}
					<span class="step in">in each of</span> <code>{st.in}</code>
					{@render stepList(st.steps)}
				{:else}
					<span class="step convert">convert</span> <code>{st.from.join(', ')}</code> → <code>{st.to.join(', ')}</code>
					{@render rules(st.forward, 'the older', 'the newer')}
					<details>
						<summary>And back: {count(st.backward.length, 'rule')}</summary>
						{@render rules(st.backward, 'the newer', 'the older')}
					</details>
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

<p class="lead soft">
	Migrations that never rewrite a record: a lens joins two versions of a schema, both ways. A record stays as it was
	written; an app on either version reads it through the lens, and its edits go back through it.
</p>

<div class="lenses">
	{#each [...s.lenses.values()] as l (l.id)}
		{@const json = parsed(l.json)}
		{@const list = steps(json)}
		<article class="lens">
			<header>
				<Icon name="lens" size={15} />
				<b>{l.title}</b>
				<span class="mono soft" title={l.id}>{short(l.id)}</span>
			</header>
			<p class="joins">
				<span class="chip">{s.schemaName(l.from)}</span>
				<span aria-hidden="true">⇄</span>
				<span class="chip accent">{s.schemaName(l.to)}</span>
				<span class="soft">{count(list.length, 'step')}, both ways</span>
			</p>
			{@render stepList(list)}
			<details>
				<summary>JSON</summary>
				<pre class="json">{l.json}</pre>
			</details>
		</article>
	{:else}
		<p class="empty">No lens yet.</p>
	{/each}
</div>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.lens {
		max-width: 46rem;
		margin-bottom: 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.lens header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}

	.lens header .mono {
		margin-left: auto;
	}

	.joins {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin: 0.6rem 0;
		font-size: 0.84rem;
	}

	.steps {
		margin: 0.2rem 0 0.4rem;
		padding-left: 1.3rem;
		font-size: 0.84rem;
		line-height: 1.6;
	}

	.steps .steps {
		margin-top: 0.3rem;
	}

	.step {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 5px;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.74rem;
		font-weight: 600;
	}

	.step.add {
		background: #dcebd9;
		color: #2b5a37;
	}

	.step.in {
		background: #e6e1f1;
		color: #4b3a75;
	}

	.step.convert {
		background: #efe3c8;
		color: #6a4b12;
	}

	.rules {
		margin: 0.4rem 0;
		border-collapse: collapse;
		font-size: 0.76rem;
	}

	.rules th,
	.rules td {
		padding: 0.2rem 0.6rem;
		border-bottom: 1px solid #f0efea;
		text-align: left;
	}

	.rules th {
		color: var(--soft);
		font-weight: 500;
	}

	summary {
		color: var(--accent);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.json {
		max-height: 20rem;
		overflow: auto;
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
	}
</style>
