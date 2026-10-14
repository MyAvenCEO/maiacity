<!--
	The studio's schemas, as a database studio draws its tables: each family of versions a chain of lenses joins, oldest
	first, side by side with the lens between each two, each version a card of its columns and their types, nested
	records' columns under theirs, how many rows here were written under it, and its JSON Schema as written. The vault
	itself adds a schema or a lens as it adds any entry, a creation of its own shared with Everyone (the `create` op),
	once the device answers a dry run of adding it (`may`).
-->
<script>
	import Icon from './Icon.svelte';
	import { families, fields, parsed, steps } from './db.js';
	import { allowed, may } from './ops.js';
	import { count, short, why } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio, api: any, vault: string, actor: string, onlens: () => void }} */
	let { s, api, vault, actor, onlens } = $props();

	// why it is shown as public
	const PUBLIC = 'Public: a schema holds no data, so every device that follows the vault reads it';
	// whose avenDB's own schemas are
	const STANDARD =
		'One of avenDB’s own: every app knows it, and avenCEO GmbH holds it as an entry of its own, ' +
		'the same bytes so the same id, shared with Everyone';

	const fams = $derived(families(s.schemas, s.lenses));

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

<div class="schemas">
	{#each fams as fam (fam.schemas[0]?.id)}
		<section class="family">
			<h3>{fam.name} <small class="soft">{count(fam.schemas.length, 'version')}</small></h3>
			<div class="chain">
				{#each fam.schemas as sc, i (sc.id)}
					{#if i}
						{@const l = fam.lenses[i - 1]}
						<button class="joint" onclick={onlens} title="{l?.title ?? 'A lens'}: see it in Lenses">
							<span class="wire" aria-hidden="true"></span>
							<span class="tag"><Icon name="lens" size={14} /> lens · {count(steps(parsed(l?.json ?? '')).length, 'step')}</span>
							<span class="wire" aria-hidden="true"></span>
						</button>
					{/if}
					{@const json = parsed(sc.json)}
					{@const uses = s.uses.get(sc.id) ?? 0}
					<article class="schema">
						<header>
							<Icon name="table" size={14} />
							<b>{sc.title}</b>
							<span class="mono soft" title={sc.id}>{short(sc.id)}</span>
							<span class="chip ok" title={PUBLIC}>Public</span>
							{#if s.standard.has(sc.id)}<span class="chip" title={STANDARD}>avenCEO GmbH</span>{/if}
						</header>
						{#if json}
							<table class="fields">
								<tbody>{@render fieldRows(fields(json), 0)}</tbody>
							</table>
						{/if}
						<footer>
							<span class="chip" class:accent={uses > 0}>{count(uses, 'record')} here</span>
							<details>
								<summary>JSON Schema</summary>
								<pre class="json">{sc.json}</pre>
							</details>
						</footer>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.family {
		margin-bottom: 1.8rem;
	}

	.family h3 {
		margin: 0 0 0.7rem;
	}

	.family h3 small {
		font-weight: 400;
		font-size: 0.8rem;
	}

	/* the versions side by side, the lens between: a canvas a studio draws its tables on */
	.chain {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0.6rem 0;
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
		width: min(100%, 19rem);
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

	.schema header .mono {
		margin-left: auto;
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: auto;
		padding: 0.5rem 0.7rem;
	}

	.joint {
		display: flex;
		align-items: center;
		align-self: center;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}

	.wire {
		width: 0.9rem;
		height: 2px;
		background: var(--accent);
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: #fff;
		font-size: 0.74rem;
		white-space: nowrap;
	}

	.joint:hover .tag {
		background: #d6e8e4;
	}

	summary {
		color: var(--accent);
		font-size: 0.78rem;
		cursor: pointer;
	}

	.json {
		max-height: 18rem;
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

	details {
		flex-basis: 100%;
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
</style>
