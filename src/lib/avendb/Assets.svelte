<!--
	A vault's assets: the recipes of the vault looked at, its `recipe` entries (avenDB's `Recipe, v1`, one for each
	version or variant of an asset, the Maia City vault's seed writes them), listed by group, by asset, then its versions
	and variants, from the entries alone ($lib/assets/sources/shelf.js), and the one picked shown in 3D, built in the box
	from its entry's own file ($lib/assets/VaultAsset.svelte), beside its card as the entry holds it: its title, note,
	ref, measure and what it is built with. Everything comes from the vault as this browser's device holds it
	(./assets.js): the rows from the database op, a file from the device when a build needs it, held to the hash its ref
	names. Nothing comes from the repo's recipes, cards or libraries, so what the vault lacks, or holds otherwise, shows
	here, naming its ref and why, and is never stood in for. Each recipe has an address of its own, `#assets/` and its
	entry, which the table editor's View asset leads to.
-->
<script>
	import Icon from './Icon.svelte';
	import { vaultSource } from './assets.js';
	import { count, nameOf, short } from './vaults.js';
	import { groupName, refusedOf, shelfOf } from '$lib/assets/sources/shelf.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, entry?: string }}
	 *   `entry` the recipe entry the address names, if it names one
	 */
	let { world, vault, actor, api, entry = '' } = $props();

	/** the viewer, with three.js and the asset stage, loaded once this page shows */
	const viewer = import('$lib/assets/VaultAsset.svelte');

	let db = $state(/** @type {import('./db.js').Db | null} */ (null));
	let failed = $state('');
	// what the device holds changed, or another vault is picked: read its database again, as the table editor does
	$effect(() => {
		void world;
		const v = vault;
		let gone = false;
		api.database(v).then(
			(/** @type {import('./db.js').Db} */ d) => {
				if (!gone) [db, failed] = [d, ''];
			},
			(/** @type {Error} */ e) => {
				if (!gone) failed = e.message ?? String(e);
			}
		);
		return () => {
			gone = true;
		};
	});

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	const here = $derived(world.vaults.find((v) => v.id === vault));
	const held = $derived(db?.vault === vault ? db : null);
	/** the vault's recipes, read from its entries as the acting vault opens them, each file only when it is built */
	const source = $derived(vaultSource(world, held, vault, actor, read));
	const shelf = $derived(shelfOf(source));
	const recipes = $derived(Object.keys(source.index.recipes).length);
	const assets = $derived(shelf.reduce((n, g) => n + g.assets.length, 0));
	/** the recipe entries this browser holds that the acting vault doesn't open */
	const sealed = $derived((held?.rows ?? []).filter((r) => r.type === 'recipe' && r.record === null).length);

	let query = $state('');
	/** the shelf as searched: an asset by its title or ref, a group by its name */
	const found = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return shelf;
		return shelf
			.map((g) => ({ ...g, assets: g.group.includes(q) ? g.assets : g.assets.filter((a) => `${a.title} ${a.ref}`.toLowerCase().includes(q)) }))
			.filter((g) => g.assets.length);
	});

	const all = $derived(shelf.flatMap((g) => g.assets.flatMap((a) => a.versions.flatMap((v) => v.recipes.map((r) => ({ ...r, asset: a, group: g.group }))))));
	/** the recipe shown: the one the address names, else the newest of the first asset listed */
	const chosen = $derived(entry ? all.find((r) => r.entry === entry) : all[0]);
	/** the entry the address names, where the vault hands out no recipe of it: its row, and why not */
	const unnamed = $derived.by(() => {
		if (!entry || chosen || !held) return null;
		const row = held.rows.find((r) => r.entry === entry);
		/** @type {any} */
		const card = row?.record?.card;
		const ref = card && typeof card === 'object' ? `${card.group}/${card.id}@${card.version}${card.variant ? `:${card.variant}` : ''}` : '';
		const said = row ? refusedOf(source, { entry: row.entry, record: row.record }) : [];
		const why = !row
			? `${nameOf(here)} holds no entry ${short(entry)} this browser knows`
			: row.type !== 'recipe'
				? `entry ${short(entry)} is a ${row.type ?? 'sealed entry'}, not a recipe`
				: row.record === null
					? `${nameOf(world.vaults.find((v) => v.id === actor))} doesn’t open entry ${short(entry)}`
					: (said.join('; ') || `${ref || `entry ${short(entry)}`} is not in the Maia City vault`);
		return { ref, why };
	});

	const metres = (/** @type {number[]} */ s) => s.map((x) => (x >= 10 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : x.toFixed(3))).join(' × ') + ' m';
</script>

{#if failed}
	<p class="error">Reading the vault’s entries failed: {failed}</p>
{:else if !held}
	<p class="soft">Reading {nameOf(here)}’s recipe entries…</p>
{:else}
	<p class="soft lead">
		{#if recipes}
			{count(recipes, 'recipe')} of {count(assets, 'asset')} in {nameOf(here)}, each built from its entry’s own file as this
			browser’s device holds it.
		{:else}
			No recipe entry in {nameOf(here)} that a page may build{source.refused.length ? '' : ' yet'}.
		{/if}
		{#if sealed}{count(sealed, 'more recipe entry', 'more recipe entries')} {nameOf(world.vaults.find((v) => v.id === actor))} doesn’t open.{/if}
	</p>
	{#if source.refused.length}
		<details class="refused">
			<summary class="error">{count(source.refused.length, 'entry', 'entries')} refused: no page builds {source.refused.length === 1 ? 'it' : 'them'}</summary>
			<ul>
				{#each source.refused as why, i (i)}<li>{why}</li>{/each}
			</ul>
		</details>
	{/if}

	{#if recipes || unnamed}
		<div class="assets">
			<nav class="shelf" aria-label="{nameOf(here)}’s assets">
				<input class="field" type="search" placeholder="Find an asset" bind:value={query} aria-label="Find an asset" />
				{#each found as g (g.group)}
					<section>
						<h3>{groupName(g.group)} <small class="soft">{g.assets.length}</small></h3>
						{#each g.assets as a (a.ref)}
							<details open={chosen?.asset.ref === a.ref}>
								<summary class:on={chosen?.asset.ref === a.ref}>{a.title} <small class="soft mono">{a.ref}</small></summary>
								{#each a.versions as v (v.v)}
									<div class="version">
										<span class="v">v{v.v}</span>
										{#each v.recipes as r (r.hash)}
											<a
												class="pick"
												class:on={chosen?.hash === r.hash}
												href="#assets/{r.entry}"
												title={r.label}
												aria-current={chosen?.hash === r.hash ? 'page' : undefined}>{r.variant ? r.name : 'This version'}</a
											>
										{/each}
									</div>
								{/each}
							</details>
						{/each}
					</section>
				{:else}
					<p class="soft">No asset is called that.</p>
				{/each}
			</nav>

			<article class="shown">
				{#if unnamed}
					<div class="card refusal" role="alert">
						<h3>{unnamed.ref || `Entry ${short(entry)}`}: not shown</h3>
						<p class="error">{unnamed.why}</p>
						<p class="soft">Nothing stands in for it: an asset is shown only from its own entry and file in the vault.</p>
					</div>
				{:else if chosen}
					<header>
						<small>{groupName(chosen.group)}</small>
						<h3>{chosen.title}</h3>
						{#if chosen.note}<p>{chosen.note}</p>{/if}
					</header>
					{#await viewer}
						<p class="soft">Opening the stage…</p>
					{:then { default: VaultAsset }}
						<VaultAsset {source} hash={chosen.hash} />
					{:catch e}
						<p class="error">The stage could not be opened: {e?.message ?? e}</p>
					{/await}
					<dl>
						<dt>Ref</dt>
						<dd class="mono">{chosen.label}</dd>
						<dt>Entry</dt>
						<dd class="mono" title={chosen.entry}>{short(chosen.entry)}</dd>
						<dt>Recipe</dt>
						<dd class="mono" title={chosen.hash}>BLAKE3 {short(chosen.hash)}, its entry’s file</dd>
						<dt>Engine</dt>
						<dd>Box engine {chosen.card.engine}</dd>
						{#if Array.isArray(chosen.card.size)}
							<dt>Size</dt>
							<dd>{metres(chosen.card.size)}</dd>
						{/if}
						{#if Number.isFinite(chosen.card.triangles)}
							<dt>Triangles</dt>
							<dd>{chosen.card.triangles.toLocaleString('en-GB')}{chosen.card.skinned ? ', skinned' : ''}</dd>
						{/if}
						{#if chosen.card.params?.length}
							<dt>Built with</dt>
							<dd>
								{#each chosen.card.params as p (p.id)}
									<span class="chip" title={p.id}>{p.label}: {p.names?.[Number(p.value)] ?? p.value}</span>{' '}
								{/each}
							</dd>
						{/if}
					</dl>
				{/if}
			</article>
		</div>
	{:else}
		<p class="empty">
			<Icon name="asset" size={18} />
			Once the Maia City vault’s recipes are seeded into {nameOf(here)}, each shows here, built from its own entry.
		</p>
	{/if}
{/if}

<style>
	.lead {
		margin: 0 0 0.8rem;
		font-size: 0.86rem;
	}

	.refused {
		margin: 0 0 1rem;
		font-size: 0.82rem;
	}

	.refused summary {
		cursor: pointer;
	}

	.refused ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
		overflow-wrap: anywhere;
	}

	.assets {
		display: grid;
		grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
		gap: 1.2rem;
		align-items: start;
	}

	.shelf {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: calc(100dvh - 12rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.shelf h3 {
		margin: 0.4rem 0 0.2rem;
	}

	.shelf details summary {
		padding: 0.3rem 0.45rem;
		border-radius: 7px;
		font-size: 0.86rem;
		cursor: pointer;
	}

	.shelf details summary:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.shelf details summary.on {
		background: #fff;
		font-weight: 600;
	}

	.shelf summary small {
		font-weight: 400;
	}

	.version {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0 0.25rem 1.1rem;
	}

	.v {
		min-width: 1.8rem;
		color: var(--soft);
		font-size: 0.74rem;
		font-variant-numeric: tabular-nums;
	}

	.pick {
		padding: 0.12rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: #fff;
		font-size: 0.76rem;
		color: inherit;
		text-decoration: none;
	}

	.pick:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.pick.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.shown {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		min-width: 0;
	}

	.shown header small {
		color: var(--accent);
		font-size: 0.72rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.shown header h3 {
		margin: 0.15rem 0 0.25rem;
		font-size: 1.2rem;
	}

	.shown header p {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.35rem 1rem;
		margin: 0;
		font-size: 0.84rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.refusal h3 {
		margin: 0 0 0.4rem;
	}

	.refusal p {
		margin: 0.3rem 0 0;
		overflow-wrap: anywhere;
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* a phone: the list above the asset */
	@media (max-width: 760px) {
		.assets {
			grid-template-columns: minmax(0, 1fr);
		}

		.shelf {
			max-height: 40dvh;
		}
	}
</style>
