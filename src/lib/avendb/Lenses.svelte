<!--
	The studio's lenses, as a database studio lists its migrations, but none is ever run on the data: each lens joins two
	versions of a schema, both ways, so an app on either reads what the other writes. In the layout every avenDB view has
	(./Frame.svelte): on the left the lenses, each with its count of steps; in the middle the one picked, at first the
	first, the versions it joins and its steps in words (a field the newer adds, steps for each record of a list, a value
	converted by its rules, each way), and its JSON as written; on the right its id, the versions it joins, who it is
	shared with and whose it is. A lens picked on the Schemas page opens here (`picked`).
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { parsed, sideOf, steps } from './db.js';
	import { count, nameOf, short } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio, picked?: string }} `picked` the lens shown, by its id: '' for the first */
	let { s, picked = $bindable('') } = $props();

	// why it is shown as public
	const PUBLIC = 'Public: a lens holds no data, so every device that follows the vault reads it';
	// whose avenDB's own lenses are
	const STANDARD =
		'One of avenDB’s own: every app knows it, and avenCEO GmbH holds it as an entry of its own, ' +
		'the same bytes so the same id, shared with Everyone';

	const all = $derived([...s.lenses.values()]);
	const lens = $derived(all.find((l) => l.id === picked) ?? all[0]);
	const lensSteps = $derived(lens ? steps(parsed(lens.json)) : []);
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

<!-- the left: every lens, with its count of steps -->
{#snippet lensNav()}
	<h3 class="nav-group">Lenses</h3>
	{#each all as l (l.id)}
		<button class="nav-item" class:on={l === lens} aria-pressed={l === lens} title={l.title} data-pick onclick={() => (picked = l.id)}
			><Icon name="lens" size={16} /><span>{l.title}</span><small>{steps(parsed(l.json)).length}</small></button
		>
	{/each}
{/snippet}

<!-- the right: what the lens picked is, the versions it joins and whose it is -->
{#snippet about()}
	{#if lens}
		<header class="about-head">
			<small>Lens</small>
			<h3>{lens.title}</h3>
		</header>
		<dl>
			<dt>Id</dt>
			<dd class="mono" title={lens.id}>{short(lens.id)}</dd>
			<dt>From</dt>
			<dd>{s.schemaName(lens.from)}</dd>
			<dt>To</dt>
			<dd>{s.schemaName(lens.to)}</dd>
			<dt>Steps</dt>
			<dd>{count(lensSteps.length, 'step')}, both ways</dd>
			<dt>Shared with</dt>
			<dd><span class="chip ok" title={PUBLIC}>Public</span></dd>
			<dt>Held by</dt>
			<dd>
				{#if s.standard.has(lens.id)}<span class="chip" title={STANDARD}>avenCEO GmbH</span>{:else}{nameOf(s.here)}’s own{/if}
			</dd>
		</dl>
	{/if}
{/snippet}

<Frame
	nav={all.length ? lensNav : undefined}
	aside={lens ? about : undefined}
	navLabel="Lenses"
	asideLabel="The lens’s details"
	navIcon="lens"
	asideIcon="info"
>
	<p class="lead soft">
		Migrations that never rewrite a record: a lens joins two versions of a schema, both ways. A record stays as it was
		written; an app on either version reads it through the lens, and its edits go back through it. Lenses are entries of
		the vault shared with Everyone, like schemas: every device that follows the vault reads them.
	</p>

	{#if lens}
		<article class="lens">
			<header>
				<Icon name="lens" size={15} />
				<b>{lens.title}</b>
			</header>
			<p class="joins">
				<span class="chip">{s.schemaName(lens.from)}</span>
				<span aria-hidden="true">⇄</span>
				<span class="chip accent">{s.schemaName(lens.to)}</span>
				<span class="soft">{count(lensSteps.length, 'step')}, both ways</span>
			</p>
			{@render stepList(lensSteps)}
			<details>
				<summary>JSON</summary>
				<pre class="json">{lens.json}</pre>
			</details>
		</article>
	{:else}
		<p class="empty">No lens yet.</p>
	{/if}
</Frame>

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

	/* the right side: what the lens is */
	.about-head {
		margin-bottom: 1rem;
	}

	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	dt {
		opacity: 0.6;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
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
