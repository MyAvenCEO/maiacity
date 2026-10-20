<!--
	AN ASSET'S PARTS, TO PICK FROM — the avenDB app's Assets lists them in its side ($lib/avendb/Assets.svelte), beside
	the asset's history and versions: the card of the part picked (what it is, what moves it, its numbers, its build step
	and its source), then its parts tree from its card's catalog (./tree.js): its own parts by assembly, each whole asset
	it carries with its own parts under it, and the sources. A part picked here is the one the viewer shows on its own
	(./VaultAsset.svelte); picked again, or Show all, lets it go.
-->
<script>
	// @ts-nocheck — plain JS
	import { treeOf } from './tree.js';

	/**
	 * @type {{ catalog: any, own?: string, picked?: string | null, solo?: boolean, hrefOf?: (ref: string) => string | null,
	 *   nameOf?: (ref: string) => string }}
	 *   `catalog` the asset's parts as built, `own` its own ref, `picked` the part picked, `solo` whether it is shown on its
	 *   own (else in its place), `hrefOf` where a whole asset it carries is shown, by its ref, and `nameOf` its name as
	 *   avenDB gives it ("Power Cube v3 · 1a2b3c4d…")
	 */
	let { catalog, own, picked = $bindable(null), solo = $bindable(true), hrefOf = () => null, nameOf = (ref) => ref } = $props();

	const tree = $derived(treeOf(catalog, own, hrefOf, nameOf));
	const card = $derived(picked ? (catalog?.parts.find((p) => p.id === picked) ?? null) : null);
	const assembly = $derived(card ? catalog.assemblies?.find((a) => a.id === card.assembly) : null);
	const choose = (id) => (picked = picked === id ? null : id);
</script>

{#snippet item(p)}
	<li>
		<button class="part" class:on={picked === p.id} aria-pressed={picked === p.id} onclick={() => choose(p.id)}
			>{p.label}{#if p.count && p.count > 1}<small> ×{p.count}</small>{/if}{#if p.moves}<i title="It moves">↻</i>{/if}</button
		>
	</li>
{/snippet}

<div class="parts">
	{#if card}
		<article class="picked" aria-label="The part picked">
			<small class="eyebrow">{assembly?.label ?? card.assembly}{#if catalog.steps?.length}{` · step ${card.step} of ${catalog.steps.length}`}{/if}</small>
			<h4>{card.label}{#if card.count && card.count > 1}<small> ×{card.count}</small>{/if}</h4>
			{#if card.what}<p>{card.what}</p>{/if}
			{#if card.moves}<p><b>Moves</b> {card.moves}</p>{/if}
			{#if card.drive}<p><b>Driven by</b> {card.drive}</p>{/if}
			{#if card.ref && card.ref !== own}
				{@const to = hrefOf(card.ref)}
				<p><b>Part of</b> {#if to}<a href={to}>{nameOf(card.ref)}</a>{:else}{nameOf(card.ref)}{/if}</p>
			{/if}
			{#if card.specs?.length}
				<dl>
					{#each card.specs as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
				</dl>
			{/if}
			{#if catalog.steps?.length && catalog.steps[card.step - 1]}
				<p class="soft">
					Build step {card.step}: {catalog.steps[card.step - 1]}{#if card.source}{' · source: '}{#each catalog.sources?.filter((s) => s.label === card.source) ?? [] as s (s.url)}<a
								href={s.url}
								target="_blank"
								rel="noreferrer">{s.label} ↗</a
							>{:else}{card.source}{/each}{/if}
				</p>
			{/if}
			<div class="row">
				<button class="btn quiet" class:on={solo} aria-pressed={solo} onclick={() => (solo = !solo)}>{solo ? 'On its own' : 'In its place'}</button>
				<button class="btn quiet" onclick={() => (picked = null)}>Show all</button>
			</div>
		</article>
	{:else}
		<p class="hint soft">Pick a part, here or on the asset itself, to see it on its own with its card.</p>
	{/if}

	<header>
		<h4>Parts <small>{catalog.parts.length}</small></h4>
	</header>
	{#each tree.own as t (t.a.id)}
		<details open={tree.own.length === 1 || (!!picked && t.parts.some((p) => p.id === picked))}>
			<summary><b>{t.a.label}</b> <small>{t.parts.length}</small></summary>
			{#if t.a.note}<p class="note soft">{t.a.note}</p>{/if}
			<ul>
				{#each t.parts as p (p.id)}{@render item(p)}{/each}
			</ul>
		</details>
	{/each}
	{#each tree.units as u (u.ref)}
		<details class="unit" open={!!picked && u.parts.some((p) => p.id === picked)}>
			<summary
				><b>{u.name}</b> <small>{u.parts.length}</small>{#if u.href}<a href={u.href} title="Its own: {u.named}" onclick={(e) => e.stopPropagation()}
						>Open</a
					>{/if}</summary
			>
			<p class="note soft">A whole asset of its own ({u.named}), carried here as one part</p>
			{#each u.groups as t (t.a.id)}
				<span class="sub">{t.a.label.replace(/^[^:]*:\s*/, '')}</span>
				<ul>
					{#each t.parts as p (p.id)}{@render item(p)}{/each}
				</ul>
			{/each}
		</details>
	{/each}
	{#if catalog.sources?.length}
		<details>
			<summary><b>Sources</b> <small>{catalog.sources.length}</small></summary>
			<ul class="sources">
				{#each catalog.sources as s (s.url)}<li><a href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a></li>{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.parts {
		font-size: 0.84rem;
	}

	h4 {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	header {
		margin: 1.1rem 0 0.4rem 0.35rem;
	}

	/* the part picked: its card, as the viewers' part card reads */
	.picked {
		padding: 0.75rem 0.85rem;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
	}

	.picked .eyebrow {
		color: var(--accent);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.picked h4 {
		margin: 0.15rem 0 0.35rem;
		color: inherit;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 650;
		letter-spacing: 0;
		text-transform: none;
		overflow-wrap: anywhere;
	}

	.picked h4 small {
		font-weight: 500;
		opacity: 0.6;
	}

	.picked p {
		margin: 0.3rem 0;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.picked dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.2rem 0.7rem;
		margin: 0.5rem 0;
		font-size: 0.78rem;
	}

	.picked dt {
		opacity: 0.6;
	}

	.picked dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.picked .row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.55rem;
	}

	.picked .btn.on {
		border-color: #1f2a23;
		background: #1f2a23;
		color: #fff;
	}

	.hint {
		margin: 0 0.35rem;
		font-size: 0.78rem;
		line-height: 1.45;
	}

	/* the tree: each assembly folds, its parts a row each */
	details {
		margin: 0 0 0.15rem;
		border-radius: 8px;
	}

	details[open] {
		padding-bottom: 0.3rem;
	}

	summary {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.4rem 0.55rem;
		border-radius: 8px;
		cursor: pointer;
	}

	summary:hover {
		background: rgb(0 0 0 / 0.05);
	}

	summary b {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	summary small,
	.part small {
		color: var(--soft);
		font-variant-numeric: tabular-nums;
	}

	summary a {
		margin-left: auto;
		font-size: 0.76rem;
	}

	.note {
		margin: 0 0.55rem 0.3rem 1.2rem;
		font-size: 0.76rem;
		line-height: 1.4;
	}

	.sub {
		display: block;
		margin: 0.35rem 0 0.1rem 1.2rem;
		color: var(--soft);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	ul {
		margin: 0;
		padding: 0 0 0 0.65rem;
		list-style: none;
	}

	.part {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		width: 100%;
		padding: 0.3rem 0.55rem;
		border: 0;
		border-radius: 7px;
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.part:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.part.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
		font-weight: 600;
	}

	.part i {
		margin-left: auto;
		font-style: normal;
		color: var(--accent);
	}

	.sources a {
		display: block;
		padding: 0.25rem 0.55rem;
		overflow-wrap: anywhere;
	}
</style>
