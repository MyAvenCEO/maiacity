<!--
	A vault's assets: the recipes of the vault looked at, its `recipe` entries (avenDB's `Recipe, v1`, one for each
	version or variant of an asset, the Maia City vault's seed writes them), listed by group, by asset, then its versions
	and variants, from the entries alone ($lib/assets/sources/shelf.js), and the one picked shown in 3D, built in the box
	from its entry's own file ($lib/assets/VaultAsset.svelte), in the turntable every asset viewer of the app has (its
	name, its note and its measure under it, what it is built with and its entry, ref and recipe beside it). The list
	looks as the app's viewers' list does ($lib/app/PickList.svelte): down the left, and on a phone folded to one line,
	the asset shown, to tap for the whole list. Everything comes from the vault as this browser's device holds it
	(./assets.js): the rows from the database op, a file from the device when a build needs it, held to the hash its ref
	names. Nothing comes from the repo's recipes, cards or libraries, so what the vault lacks, or holds otherwise, shows
	here, naming its ref and why, and is never stood in for. Each recipe has an address of its own, `#assets/` and its
	entry, which the table editor's View asset leads to.
-->
<script>
	import Icon from './Icon.svelte';
	import { vaultSource } from './assets.js';
	import { count, nameOf, seeded, short } from './vaults.js';
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
	/** the Maia City vault, where the asset recipes are kept, as this person's world knows it: the seed's coop where
	 *  they founded it, else a coop of that name */
	const city = $derived(seeded(world)[3]?.[0] ?? world.vaults.find((v) => v.kind === 'coop' && v.name === 'Maia City'));
	const held = $derived(db?.vault === vault ? db : null);
	/** the vault's recipes, read from its entries as the acting vault opens them, each file only when it is built */
	const source = $derived(vaultSource(world, held, vault, actor, read));
	const shelf = $derived(shelfOf(source));
	const recipes = $derived(Object.keys(source.index.recipes).length);
	const assets = $derived(shelf.reduce((n, g) => n + g.assets.length, 0));
	/** the recipe entries this browser holds that the acting vault doesn't open */
	const sealed = $derived((held?.rows ?? []).filter((r) => r.type === 'recipe' && r.record === null).length);

	let query = $state('');
	/** on a phone: the whole list unfolded, over the asset */
	let open = $state(false);
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

</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

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
			<nav class="shelf" class:open aria-label="{nameOf(here)}’s assets">
				<button class="fold" onclick={() => (open = !open)} aria-expanded={open} aria-label="{nameOf(here)}’s assets: {open ? 'close the list' : 'open the list'}">
					<b>{chosen ? nameOfRecipe(chosen) : 'Assets'}</b>{#if chosen}<em class="v">v{chosen.v}</em>{/if}
					<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>
				<div class="list">
					<input class="field" type="search" placeholder="Find an asset" bind:value={query} aria-label="Find an asset" />
					{#each found as g (g.group)}
						<section>
							<h3 class="group">{groupName(g.group)} <small>{g.assets.length}</small></h3>
							{#each g.assets as a (a.ref)}
								{@const on = chosen?.asset.ref === a.ref}
								<details open={on}>
									<summary class:on title={a.ref}>
										<span class="row"><b>{a.title}</b><em class="v">v{a.versions[0].v}</em>{#if a.versions.length > 1}<small>{a.versions.length} versions</small>{/if}</span>
									</summary>
									<ol class="history" aria-label="{a.title}: versions">
										{#each a.versions as v (v.v)}
											<li>
												<span class="v">v{v.v}</span>
												{#each v.recipes as r (r.hash)}
													<a
														class="pick"
														class:on={chosen?.hash === r.hash}
														href="#assets/{r.entry}"
														title={r.label}
														onclick={() => (open = false)}
														aria-current={chosen?.hash === r.hash ? 'page' : undefined}>{r.variant ? r.name : 'This version'}</a
													>
												{/each}
											</li>
										{/each}
									</ol>
								</details>
							{/each}
						</section>
					{:else}
						<p class="soft">No asset is called that.</p>
					{/each}
				</div>
			</nav>
			{#if open}<button class="scrim" aria-label="Close the list" onclick={() => (open = false)}></button>{/if}

			<article class="shown">
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
							<VaultAsset {source} hash={chosen.hash} title={nameOfRecipe(chosen)} note={chosen.note}>
								{#snippet about()}
									<span class="label">In {nameOf(here)}</span>
									<dl>
										<dt>Ref</dt>
										<dd class="mono">{chosen.label}</dd>
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
								{/snippet}
							</VaultAsset>
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
				{/if}
			</article>
		</div>
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
		grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}

	/* the list, as the app's viewers' list looks (PickList): a narrow column of one-line rows under small-capital group
	   headings, the asset shown opened to its versions */
	.shelf {
		position: sticky;
		top: 0;
		max-height: calc(100dvh - 9rem);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.list .field {
		margin: 0 0 0.4rem;
	}

	.fold,
	.scrim {
		display: none;
	}

	/* (held against the avenDB app's own look of a heading) */
	.shelf .group {
		margin: 0.7rem 0.5rem 0.15rem;
		font-size: 0.68rem;
		font-weight: 400;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.55;
	}

	.shelf .group small {
		margin-left: 0.2rem;
		letter-spacing: 0;
	}

	summary {
		display: block;
		padding: 0.4rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 0.82rem;
		line-height: 1.3;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		background: rgb(0 0 0 / 0.04);
	}

	summary.on {
		border-color: rgb(0 0 0 / 0.12);
		background: #fff;
	}

	/* the name, its newest version and its ref on one line; the name gives way first */
	.row {
		display: flex;
		flex-wrap: nowrap;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.row b {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row small {
		flex: none;
		max-width: 45%;
		overflow: hidden;
		font-size: 0.66rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.5;
	}

	.v {
		flex: none;
		font-size: 0.66rem;
		font-style: normal;
		font-variant-numeric: tabular-nums;
		opacity: 0.55;
	}

	/* an asset's versions, newest first, each with its variants, under it */
	.history {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0.15rem 0 0.4rem 0.9rem;
		padding: 0 0 0 0.5rem;
		border-left: 2px solid rgb(0 0 0 / 0.08);
		list-style: none;
	}

	.history li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}

	.history .v {
		min-width: 1.6rem;
	}

	.pick {
		padding: 0.15rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.7);
		font-size: 0.74rem;
		color: inherit;
		text-decoration: none;
	}

	.pick:hover {
		background: #fff;
	}

	.pick.on {
		border-color: #1f2a23;
		background: #1f2a23;
		color: #fff;
	}

	.shown {
		min-width: 0;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.2rem 0.8rem;
		margin: 0;
		font-size: 0.78rem;
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

	/* a phone: the list folded to one line above the asset, the asset shown, to tap for the whole list over it */
	@media (max-width: 760px) {
		.assets {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.6rem;
		}

		.shelf {
			position: relative;
			z-index: 3;
			max-height: none;
			overflow: visible;
		}

		.fold {
			display: flex;
			align-items: center;
			gap: 0.4rem;
			width: 100%;
			min-height: 2.6rem;
			padding: 0.35rem 0.9rem;
			border: 1px solid rgb(0 0 0 / 0.12);
			border-radius: 999px;
			background: #fff;
			font: inherit;
			font-size: 0.9rem;
			color: inherit;
			cursor: pointer;
		}

		.fold b {
			min-width: 0;
			overflow: hidden;
			font-weight: 600;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.fold svg {
			flex: none;
			width: 0.8rem;
			height: 0.8rem;
			margin-left: auto;
			opacity: 0.6;
			transition: transform 0.15s;
		}

		.open .fold svg {
			transform: rotate(180deg);
		}

		.list {
			display: none;
		}

		/* unfolded: the whole list over the asset, scrolling, clear of the nav pill */
		.open .list {
			display: flex;
			position: absolute;
			top: calc(100% + 0.3rem);
			left: 0;
			right: 0;
			max-height: min(70vh, calc(100dvh - 9rem));
			overflow: auto;
			overscroll-behavior: contain;
			padding: 0.6rem 0.6rem 0.8rem;
			border-radius: 14px;
			background: #f4f1eb;
			box-shadow: 0 12px 24px rgb(0 0 0 / 0.16);
		}

		.open summary {
			padding: 0.6rem 0.5rem;
			font-size: 0.9rem;
		}

		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 2;
			border: 0;
			background: rgb(0 0 0 / 0.2);
		}
	}
</style>
