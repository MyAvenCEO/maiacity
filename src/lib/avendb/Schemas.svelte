<!--
	The studio's schemas, as a database studio draws its tables, in the layout every avenDB view has (./Frame.svelte):
	on the left each family of versions a chain of lenses joins, with how many rows here were written under it; in the
	middle the version picked, at first the newest of the first family, a card of its columns and their types, nested
	records' columns under theirs, and its JSON Schema as written; on the right its family's versions to pick, newest
	first, the lens between each two leading to it on the Lenses page, then the version's id, how many rows here were
	written under it, who it is shared with and whose it is. The vault itself adds a schema or a lens as it adds any
	entry, a creation of its own shared with Everyone (the `create` op), once the device answers a dry run of adding it
	(`may`).
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { families, fields, parsed, steps } from './db.js';
	import { allowed, may } from './ops.js';
	import { count, short, why } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio, api: any, vault: string, actor: string, onlens: (id: string) => void }} */
	let { s, api, vault, actor, onlens } = $props();

	// why it is shown as public
	const PUBLIC = 'Public: a schema holds no data, so every device that follows the vault reads it';
	// whose avenDB's own schemas are
	const STANDARD =
		'One of avenDB’s own: every app knows it, and avenCEO GmbH holds it as an entry of its own, ' +
		'the same bytes so the same id, shared with Everyone';

	const fams = $derived(families(s.schemas, s.lenses));

	/** the version picked, by its id: none at first, so the newest of the first family */
	let picked = $state('');
	/** The newest version of family `f`. @param {import('./db.js').Family} f */
	const newest = (f) => f.schemas[f.schemas.length - 1];
	const fam = $derived(fams.find((f) => f.schemas.some((sc) => sc.id === picked)) ?? fams[0]);
	const version = $derived(fam?.schemas.find((sc) => sc.id === picked) ?? (fam && newest(fam)));
	/** How many rows here were written under a version of family `f`. @param {import('./db.js').Family} f */
	const records = (f) => f.schemas.reduce((n, sc) => n + (s.uses.get(sc.id) ?? 0), 0);

	/** a schema or a lens to add, and its JSON as the person writes it, kept as written */
	let kind = $state(/** @type {'schema' | 'lens'} */ ('schema'));
	let text = $state('');
	const adding = $derived({ op: 'create', vault, type: kind, value: text, as: actor });
	/** why the device won't add it, as it answers a dry run of it: '' where it would, or while nothing is written */
	let unadded = $state('');
	$effect(() => {
		const op = { ...adding };
		unadded = '';
		if (!op.value.trim()) return;
		let gone = false;
		may(api, actor, [op]).then(([a]) => !gone && (unadded = allowed(a) ? '' : why(/** @type {any} */ (a))));
		return () => {
			gone = true;
		};
	});

	async function add() {
		if (await api.run(kind === 'schema' ? 'Adding the schema' : 'Adding the lens', { ...adding })) text = '';
	}
</script>

{#snippet fieldRows(/** @type {import('./db.js').Field[]} */ list, /** @type {number} */ depth)}
	{#each list as f (f.name)}
		<tr>
			<td style:padding-left="{0.7 + depth * 1}rem">
				{#if depth}<span class="nest" aria-hidden="true">└</span>{/if}<code>{f.name}</code>{#if f.required}<span
						class="req"
						title="Required: not null">*</span
					>{/if}
			</td>
			<td class="type" title={f.hint}>{f.type}</td>
		</tr>
		{#if f.fields.length}{@render fieldRows(f.fields, depth + 1)}{/if}
	{/each}
{/snippet}

<!-- the left: each family of versions, leading to its newest -->
{#snippet list()}
	<h3 class="nav-group">Schemas</h3>
	{#each fams as f (f.schemas[0]?.id)}
		<button
			class="nav-item"
			class:on={f === fam}
			aria-pressed={f === fam}
			title="{count(f.schemas.length, 'version')}, {count(records(f), 'record')} here"
			data-pick
			onclick={() => (picked = newest(f).id)}><Icon name="schema" size={16} /><span>{f.name}</span><small>{records(f)}</small></button
		>
	{/each}
{/snippet}

<!-- the right: the family's versions, newest first, the lens between each two, then the version picked -->
{#snippet about()}
	{#if fam && version}
		{@const uses = s.uses.get(version.id) ?? 0}
		<header class="about-head">
			<small>Schema</small>
			<h3>{fam.name}</h3>
		</header>
		<h4 class="side-head">{count(fam.schemas.length, 'version')}</h4>
		<ol class="versions" aria-label="{fam.name}: versions">
			{#each [...fam.schemas.keys()].reverse() as i (fam.schemas[i].id)}
				{@const sc = fam.schemas[i]}
				<li>
					<button class="pick" class:on={sc.id === version.id} aria-pressed={sc.id === version.id} onclick={() => (picked = sc.id)}
						>{sc.title}</button
					>
					<small class="soft" title="Records here written under it">{s.uses.get(sc.id) ?? 0}</small>
				</li>
				{#if i}
					{@const l = fam.lenses[i - 1]}
					<li>
						<button class="joint" onclick={() => onlens(l?.id ?? '')} title="{l?.title ?? 'A lens'}: see it in Lenses">
							<Icon name="lens" size={14} /> lens · {count(steps(parsed(l?.json ?? '')).length, 'step')}
						</button>
					</li>
				{/if}
			{/each}
		</ol>
		<h4 class="side-head">{version.title}</h4>
		<dl>
			<dt>Id</dt>
			<dd class="mono" title={version.id}>{short(version.id)}</dd>
			<dt>Records</dt>
			<dd>{count(uses, 'record')} here written under it</dd>
			<dt>Shared with</dt>
			<dd><span class="chip ok" title={PUBLIC}>Public</span></dd>
			<dt>Held by</dt>
			<dd>
				{#if s.standard.has(version.id)}<span class="chip" title={STANDARD}>avenCEO GmbH</span>{:else}{s.vaultName(vault)}’s own{/if}
			</dd>
		</dl>
	{/if}
{/snippet}

<Frame
	nav={fams.length ? list : undefined}
	aside={version ? about : undefined}
	navLabel="Schemas"
	asideLabel="The schema’s versions and details"
	navIcon="schema"
>
	<p class="lead soft">
		What each record holds, version by version, as a table holds its columns. Every edit names the schema it was written
		under; a lens carries a record between two versions, so an app on either reads what the other writes. Schemas and
		lenses are entries of the vault shared with Everyone: they hold no data, so every device that follows the vault
		reads them. avenDB’s own (notes, todos, articles, flows, functions and posts) are avenCEO GmbH’s entries.
	</p>

	{#if actor === vault}
		<details class="add">
			<summary>Add a schema or a lens</summary>
			<div class="row">
				<select class="field" bind:value={kind} aria-label="What it is">
					<option value="schema">A schema</option>
					<option value="lens">A lens</option>
				</select>
				<button class="btn primary" disabled={!text.trim() || !!unadded} onclick={add}>Add it</button>
			</div>
			<textarea
				class="field source"
				rows="8"
				bind:value={text}
				placeholder={kind === 'schema' ? 'Its JSON Schema' : 'Its JSON: the versions it joins, and its steps'}
				aria-label="Its JSON"
			></textarea>
			<p class="soft">
				{unadded
					? `It can’t be added: ${unadded}.`
					: 'It becomes an entry of the vault, shared with Everyone, its JSON kept exactly as written.'}
			</p>
		</details>
	{/if}

	{#if version}
		{@const json = parsed(version.json)}
		<div class="canvas">
			<article class="schema">
				<header>
					<Icon name="table" size={14} />
					<b>{version.title}</b>
				</header>
				{#if json}
					<table class="fields">
						<tbody>{@render fieldRows(fields(json), 0)}</tbody>
					</table>
				{/if}
				<footer>
					<details>
						<summary>JSON Schema</summary>
						<pre class="json">{version.json}</pre>
					</details>
				</footer>
			</article>
		</div>
	{:else}
		<p class="empty">No schema yet.</p>
	{/if}
</Frame>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	/* the version picked, on a canvas a studio draws its tables on */
	.canvas {
		padding: 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background-color: #f8f7f3;
		background-image: radial-gradient(rgb(0 0 0 / 0.09) 1px, transparent 1px);
		background-size: 14px 14px;
	}

	.schema {
		display: flex;
		flex-direction: column;
		width: min(100%, 30rem);
		overflow: hidden;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 9px;
		background: #fff;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.06);
	}

	.schema header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.7rem;
		border-bottom: 1px solid var(--edge);
		background: #eef3f1;
		font-size: 0.86rem;
	}

	.fields {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.fields td {
		padding: 0.3rem 0.7rem;
		border-bottom: 1px solid #f0efea;
		white-space: nowrap;
	}

	.fields .type {
		color: var(--soft);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		text-align: right;
	}

	.nest {
		margin-right: 0.3rem;
		color: rgb(0 0 0 / 0.3);
	}

	.req {
		margin-left: 0.15rem;
		color: var(--bad);
	}

	.schema footer {
		padding: 0.5rem 0.7rem;
	}

	summary {
		color: var(--accent);
		font-size: 0.78rem;
		cursor: pointer;
	}

	.json {
		max-height: 24rem;
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

	.add {
		max-width: 46rem;
		margin: 0 0 1.4rem;
	}

	.add .row {
		margin: 0.5rem 0;
	}

	.add .source {
		display: block;
		width: 100%;
		box-sizing: border-box;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.78rem;
	}

	.add p {
		font-size: 0.8rem;
	}

	/* the right side: the family's versions, the lens between each two, then the version picked */
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

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.versions {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0 0 0 0.6rem;
		border-left: 2px solid rgb(0 0 0 / 0.08);
		list-style: none;
	}

	.versions li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.pick {
		padding: 0.18rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font: inherit;
		font-size: 0.76rem;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.pick:hover {
		background: #fff;
	}

	.pick.on {
		border-color: #1f2a23;
		background: #1f2a23;
		color: #fff;
	}

	.versions small {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.joint {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.1rem 0.5rem;
		border: 1px dashed var(--accent);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: var(--accent);
		cursor: pointer;
	}

	.joint:hover {
		background: #d6e8e4;
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
</style>
