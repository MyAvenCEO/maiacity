<!--
	A vault's worlds (Samuel 2026-10-19: worlds purely from avenDB, beside its Assets): its `game` entries, each one world
	to play, walk or film (MaiaCity V1, the sandboxes, the real places), as the Maia City vault's seed writes them
	(game/games.js, src/lib/avendb/seed.js), in the layout every avenDB view has (./Frame.svelte): on the left every world
	the acting vault reads; in the middle the one picked, what it is and where it opens; on the right its entry, whose it
	is and its tags. Who may open one is the vault's cap groups' to say (Traveler, Citizen: $lib/app/access.svelte.js),
	never this page's. Each has an address of its own, `#worlds/` and its entry.
-->
<script>
	import { base } from '$app/paths';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { ago, nameOf, reads, short } from './vaults.js';
	import { GAMES } from '../../../game/games.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, entry?: string }} */
	let { world, vault, actor, entry = '' } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));

	/** every world of the vault the acting vault reads, MaiaCity V1 first, then by name */
	const worlds = $derived(
		world.entries
			.filter((e) => e.vault === vault && e.type === 'game' && !e.deleted && e.record?.id && reads(e, actor))
			.sort((a, b) => Number(b.record?.id === 'maiacity-v1') - Number(a.record?.id === 'maiacity-v1') || String(a.record?.title).localeCompare(String(b.record?.title), undefined, { numeric: true }))
	);
	/** the world shown: the one the address names, else the first */
	const shown = $derived(worlds.find((e) => e.entry === entry) ?? worlds[0]);
	const rec = $derived(shown?.record ?? null);
	/** where world `e` opens, under the site's base: the address is the app's, so a game the app knows opens where the app
	 *  has it (the sandboxes' addresses moved to match their names on 2026-10-22, before the entries' routes did), any
	 *  other where its entry says */
	const routeOf = (/** @type {any} */ r) => GAMES.find((g) => g.id === r?.id)?.route ?? r?.route ?? '';
	const hrefOf = (/** @type {import('./vaults.js').EntryView} */ e) => (routeOf(e.record) ? `${base}${routeOf(e.record)}` : '');
	/** what a world is, from where it opens */
	const what = (/** @type {string} */ route) => (route.startsWith('/app/worlds/') ? 'A real place' : route.startsWith('/app/games/') ? 'A sandbox' : 'A game');
</script>

<!-- every world down the left -->
{#snippet list()}
	<h3 class="nav-group">Worlds</h3>
	{#each worlds as e (e.entry)}
		{@const on = shown?.entry === e.entry}
		<a class="nav-item" class:on href="#worlds/{e.entry}" aria-current={on ? 'page' : undefined} data-pick
			><Icon name="play" size={16} /><span>{e.record?.title ?? e.record?.id}</span></a
		>
	{/each}
{/snippet}

<!-- on the right, the world's entry: whose it is, its tags, when it was made -->
{#snippet about()}
	{#if shown && rec}
		<header class="about-head">
			<small>World</small>
			<h3>{rec.title}</h3>
		</header>
		<h4 class="side-head">Its entry</h4>
		<dl class="facts">
			<dt>Whose</dt>
			<dd>{nameOf(byId.get(shown.vault))}</dd>
			<dt>Id</dt>
			<dd class="mono">{rec.id}</dd>
			<dt>Tags</dt>
			<dd>{(shown.tags ?? []).join(', ') || 'None'}</dd>
			<dt>Entry</dt>
			<dd class="mono" title={shown.entry}>{short(shown.entry)}</dd>
			<dt>Version</dt>
			<dd>Edit #{shown.edits}</dd>
			{#if shown.created}<dt>Made</dt><dd>{ago(shown.created)}</dd>{/if}
		</dl>
	{/if}
{/snippet}

<Frame
	nav={worlds.length ? list : undefined}
	aside={shown ? about : undefined}
	navLabel="{nameOf(here)}’s worlds"
	asideLabel="The world’s entry"
	navIcon="play"
	asideIcon="info"
>
	{#if shown && rec}
		{@const href = hrefOf(shown)}
		<section class="world">
			<p class="kind">{what(routeOf(rec))}</p>
			<h2>{rec.title}</h2>
			{#if rec.note}<p class="soft">{rec.note}</p>{/if}
			{#if href}
				<a class="btn primary" {href}><Icon name="play" size={16} /> Open {rec.title}</a>
			{:else}
				<p class="soft">It names no page to open it on yet.</p>
			{/if}
		</section>
	{:else}
		<p class="empty">
			No worlds in {nameOf(here)}{actor === vault ? '' : ` that ${nameOf(byId.get(actor))} reads`}. The worlds are kept in
			Maia City: pick it in the nav pill.
		</p>
	{/if}
</Frame>

<style>
	.world {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.6rem;
		max-width: 40rem;
		padding: 1.4rem 1.5rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: var(--card, #fff);
	}

	.kind {
		margin: 0;
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0;
		font-size: 1.6rem;
	}

	.world p {
		margin: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.4rem;
		text-decoration: none;
	}

	/* the right side: the world's name, then its entry */
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

	.facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	.facts dt {
		opacity: 0.6;
	}

	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
