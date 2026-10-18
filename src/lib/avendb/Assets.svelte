<!--
	A vault's assets: the recipes of the vault looked at, its `recipe` entries (avenDB's `Recipe, v1`, one for each
	asset, its versions and variants in its history, the Maia City vault's seed writes them), from the entries alone
	($lib/assets/sources/shelf.js), in the layout every avenDB view has (./Frame.svelte): on the left its assets, by
	group, each leading to its newest version; in the middle the one picked, shown in 3D, built in the box from its
	entry's own file ($lib/assets/VaultAsset.svelte), in the turntable every asset viewer of the app has (its name, its
	name and its moves and views above it, staying at the top as the column scrolls); on the right the one place for it,
	avenDB's version-control side every entry has (./Lines.svelte): its history, its versions and variants to pick (with
	its ref, entry, recipe and engine), and its parts, a part picked there or on the asset shown on its own
	($lib/assets/Parts.svelte). Everything comes from the vault as this browser's device holds it (./assets.js): the rows
	from the database op, its history from the note op, a file from the device when a build needs it, held to the hash
	its ref names. Nothing comes from the repo's recipes, cards or libraries, so what the vault lacks, or holds otherwise,
	shows here, naming its ref and why, and is never stood in for. Each asset has an address of its own, `#assets/` and
	its entry, which the table editor's View asset leads to (its newest version), and each version and variant of it
	one more, its recipe's hash after the entry.
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import Lines from './Lines.svelte';
	import { vaultSource } from './assets.js';
	import { authorsLine, count, nameOf, seeded, short } from './vaults.js';
	import { groupName, refusedOf, shelfOf } from '$lib/assets/sources/shelf.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, entry?: string,
	 *   recipe?: string }}
	 *   `entry` the recipe entry the address names, if it names one, and `recipe` the hash of the version or variant of
	 *   it, if it names one
	 */
	let { world, vault, actor, api, entry = '', recipe = '' } = $props();

	/** the parts list, with the stage's own `Parts` of an asset's parts, loaded with the stage */
	const partsList = import('$lib/assets/Parts.svelte');

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
	/** the Maia City vault, where the asset recipes are kept, as this person's world knows it: the seed's coop where
	 *  they founded it, else a coop of that name */
	const city = $derived(seeded(world)[0]?.[0] ?? world.vaults.find((v) => v.kind === 'coop' && v.name === 'Maia City'));
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

	/** what a recipe is called: its asset's title, and its variant's name where it has one of its own (`Ant · Wood ant`) */
	const nameOfRecipe = (/** @type {any} */ r) => (r.variant && r.name !== r.asset.title ? `${r.asset.title} · ${r.name}` : r.asset.title);
	/** the recipe an asset's row leads to: its newest version, not a variant of it where it has one */
	const newestOf = (/** @type {any} */ a) => a.versions[0].recipes.find((/** @type {any} */ r) => !r.variant) ?? a.versions[0].recipes[0];
	const all = $derived(shelf.flatMap((g) => g.assets.flatMap((a) => a.versions.flatMap((v) => v.recipes.map((r) => ({ ...r, asset: a, group: g.group }))))));
	/** the recipe shown: the version or variant the address names, else its entry's newest, else the newest of the first
	 *  asset listed */
	const chosen = $derived.by(() => {
		if (!entry) return all[0];
		const of = all.filter((r) => r.entry === entry);
		const newest = of.length ? newestOf(of[0].asset) : null;
		return of.find((r) => r.hash === recipe) ?? of.find((r) => r.hash === newest?.hash);
	});
	/** the recipes of the asset shown, with the write that brought each and the line it is on (null for main's) */
	const kept = $derived(
		chosen
			? all
					.filter((r) => r.entry === chosen.entry)
					.map((r) => {
						const row = source.rowOf(r.hash);
						return { ...r, edit: String(row?.edit ?? ''), line: row?.line ?? null, main: row?.main ?? null };
					})
			: []
	);
	const shown = $derived(kept.find((r) => r.hash === chosen?.hash));
	const hrefOf = (/** @type {{ entry: string, hash: string }} */ r) => `#assets/${r.entry}/${r.hash}`;

	/** the asset's history and lines, as the device's note op reads its entry: none until it has, nor of another entry */
	let noted = $state.raw(/** @type {{ entry: string, note: any } | null} */ (null));
	const asset = $derived(chosen?.entry ?? '');
	$effect(() => {
		void world;
		const e = asset;
		if (!e) return;
		let gone = false;
		api.note(e).then(
			(/** @type {any} */ n) => {
				if (!gone) noted = { entry: e, note: n ?? null };
			},
			() => {
				if (!gone) noted = { entry: e, note: null };
			}
		);
		return () => {
			gone = true;
		};
	});
	const note = $derived(noted?.entry === asset ? noted.note : null);

	/** what each line of the asset's entry holds: its versions, newest first, each one to show
	 *  @param {{ line: string | null }} l */
	const versionsOf = (l) =>
		kept
			.filter((r) => r.line === l.line)
			.sort((a, b) => b.v - a.v)
			.map((r) => ({ key: r.hash, label: `v${r.v}${l.line === null && r.variant && r.name !== r.asset.title ? ` · ${r.name}` : ''}`, href: hrefOf(r), on: r.hash === chosen?.hash }));
	/** the recipe an edit of its history brought, or the version of main a merge made, if one */
	const recipeOf = (/** @type {any} */ e) =>
		kept.find((r) => r.edit === e.id) ??
		(e.kind === 'merge' && e.line === null && e.version ? kept.find((r) => r.line === null && r.main === e.version) : undefined);
	/** what an edit that brought a version did, in the asset's words */
	const saidOf = (/** @type {any} */ e) => {
		const r = kept.find((x) => x.edit === e.id);
		if (!r) return undefined;
		return r.line === null ? `Wrote v${r.v}${e.deps.length ? '' : ', its first'}` : `Wrote v${r.v} of the variant “${r.name}”`;
	};

	/** what the side shows: the asset's history, its versions, or its parts */
	let tab = $state('versions');
	/** its parts as built, the one picked, and whether it is shown on its own */
	let catalog = $state.raw(/** @type {any} */ (null));
	let picked = $state(/** @type {string | null} */ (null));
	let solo = $state(true);
	// a part picked on the asset itself: its card in the side
	$effect(() => {
		if (picked) tab = 'parts';
	});
	/** where a whole asset another carries is shown here, by its ref (`machines/powercube@3`) @param {string} ref */
	const unitHref = (ref) => {
		try {
			const h = source.hashOf(String(ref).split('?')[0]);
			const r = all.find((x) => x.hash === h);
			return r ? hrefOf(r) : null;
		} catch {
			return null;
		}
	};
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

</script>

<!-- the list down the left: a search, then each group's assets, each leading to its newest version -->
{#snippet shelfNav()}
	<input class="nav-search" type="search" placeholder="Find an asset" bind:value={query} aria-label="Find an asset" />
	{#each found as g (g.group)}
		<h3 class="nav-group">{groupName(g.group)}</h3>
		{#each g.assets as a (a.ref)}
			{@const to = newestOf(a)}
			<a class="nav-item" class:on={chosen?.asset.ref === a.ref} href="#assets/{to.entry}" title={a.ref} aria-current={chosen?.asset.ref === a.ref ? 'page' : undefined}
				><Icon name="asset" size={16} /><span>{a.title}</span><small>v{a.versions[0].v}</small></a
			>
		{/each}
	{:else}
		<p class="soft none">No asset is called that.</p>
	{/each}
{/snippet}

<!-- on the right, the one place for the asset shown: avenDB's version-control side, with its parts beside -->
{#snippet about()}
	{#if chosen}
		<header class="about-head">
			<small>{groupName(chosen.group)}</small>
			<h3>{chosen.asset.title}</h3>
			<p class="soft">v{chosen.v}{chosen.variant && chosen.name !== chosen.asset.title ? ` · ${chosen.name}` : ''}{shown?.line ? ', a variant' : ''}</p>
		</header>
		<Lines
			{world}
			{note}
			line={shown?.line ?? null}
			at={shown?.edit ?? ''}
			bind:tab
			thing="the asset"
			{versionsOf}
			hrefOf={(e) => {
				const r = recipeOf(e);
				return r ? hrefOf(r) : undefined;
			}}
			said={saidOf}
			tabs={catalog ? [{ id: 'parts', label: 'Parts', icon: 'parts', count: catalog.parts.length, body: partsTab }] : []}
			versions={details}
		/>
	{/if}
{/snippet}

<!-- under its lines, what its entry says of the version shown -->
{#snippet details()}
	{#if chosen}
		<h4 class="side-head">This version, in {nameOf(here)}</h4>
		<dl>
			<dt>Ref</dt>
			<dd class="mono">{chosen.label}</dd>
			<dt>By</dt>
			<dd>{authorsLine(world, world.entries.find((e) => e.entry === chosen.entry)?.authors, nameOf(here))}</dd>
			<dt>Entry</dt>
			<dd class="mono" title={chosen.entry}>{short(chosen.entry)}</dd>
			<dt>Recipe</dt>
			<dd class="mono" title={chosen.hash}>BLAKE3 {short(chosen.hash)}</dd>
			<dt>Engine</dt>
			<dd>Box engine {chosen.card.engine}</dd>
			{#if Number.isFinite(chosen.card.triangles)}
				<dt>Triangles</dt>
				<dd>{chosen.card.triangles.toLocaleString('en-GB')}{chosen.card.skinned ? ', skinned' : ''}</dd>
			{/if}
		</dl>
	{/if}
{/snippet}

<!-- its parts: the part picked, shown on its own, and the tree to pick from -->
{#snippet partsTab()}
	{#await partsList then { default: Parts }}
		<Parts {catalog} own={chosen?.card.ref} bind:picked bind:solo hrefOf={unitHref} />
	{/await}
{/snippet}

<Frame
	nav={held && recipes ? shelfNav : undefined}
	aside={held && chosen && !unnamed ? about : undefined}
	navLabel="{nameOf(here)}’s assets"
	asideLabel="The asset’s history, versions and parts"
	navIcon="asset"
>
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

		{#if unnamed}
			<div class="card refusal" role="alert">
				<h3>{unnamed.ref || `Entry ${short(entry)}`}: not shown</h3>
				<p class="error">{unnamed.why}</p>
				<p class="soft">Nothing stands in for it: an asset is shown only from its own entry and file in the vault.</p>
			</div>
		{:else if chosen}
			<!-- a stage that fails says so here, and the list beside it stays -->
			<svelte:boundary onerror={(e) => console.error(e)}>
				{#await viewer}
					<p class="soft">Opening the stage…</p>
				{:then { default: VaultAsset }}
					<div class="viewer">
						<VaultAsset {source} hash={chosen.hash} title="{nameOfRecipe(chosen)} v{chosen.v}" note={chosen.note} bind:catalog bind:picked {solo} />
					</div>
				{:catch e}
					<p class="error">The stage could not be opened: {e?.message ?? e}</p>
				{/await}
				{#snippet failed(e, reset)}
					<p class="error" role="alert">
						Showing {chosen.label} failed: {/** @type {any} */ (e)?.message ?? e}
						<button class="btn quiet" onclick={reset}>Try again</button>
					</p>
				{/snippet}
			</svelte:boundary>
		{:else}
			<p class="empty">
				<Icon name="asset" size={18} />
				{#if here?.id === city?.id}
					{nameOf(here)} holds no asset recipes yet. Setting up the account that founded it writes them in.
				{:else}
					{nameOf(here)} holds no asset recipes: they are kept in {city ? nameOf(city) : 'the Maia City vault'}. Open it
					to see each one, built from its own entry.
				{/if}
			</p>
		{/if}
	{/if}
</Frame>

<style>
	.lead {
		margin: 0 0 0.8rem;
		font-size: 0.86rem;
	}

	/* the asset's name and its bar stay at the very top of the column as it scrolls, up through the column's top
	   margin (./Frame.svelte's middle) */
	.viewer {
		--turntable-top: -1.4rem;
	}

	@media (max-width: 760px) {
		.viewer {
			--turntable-top: -1rem;
		}
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

	.none {
		padding: 0.4rem 0.6rem;
		font-size: 0.84rem;
	}

	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head {
		margin: 0 0 0.9rem 0.35rem;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.about-head p {
		margin: 0.1rem 0 0;
		font-size: 0.8rem;
	}

	.side-head {
		margin: 0 0 0.5rem 0.35rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
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
</style>
