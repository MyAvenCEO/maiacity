<!--
	The dashboard, the one place everything starts from (legacy's $lib/app/Dashboard.svelte, its layout and design): a
	greeting; the game, one thin card across the page (straight into its world map for an admin, greyed out and invite
	only for everyone else, Samuel 2026-11-04); the Game Worlds, the four sandboxes, open to every traveler; then the
	apps — a tile for each group of the asset library (plants, animals, things, machines, buildings, biomes;
	$lib/app/groups.ts) and the factories — and, for an admin acting as Maia City (the nav pill's You menu), the coop's
	own: its stories, its Library, its Artifacts, the Game editor, its members, invites and its Postgres. The proposals are no tile:
	they open from the nav pill's star over any page (Samuel 2026-11-05).
-->
<script lang="ts">
	import Icon from '$lib/site/app/Icon.svelte';
	import { asset } from '$lib/site/media/url';
	import { session } from '$lib/session.svelte';
	import { asCity } from '$lib/acting.svelte';
	import { GROUP_APPS } from '$lib/app/groups';

	const hour = new Date().getHours();
	const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

	const WORLDS = [
		{ href: '/sandbox-1/', label: 'Sandbox 1', note: 'The dome cell, its food forest grown from our plants', cover: '5ddd7dc657e28a84e7ef48b8064dafe5698791950dea387e7059b1c41e5d2fc1.jpg' },
		{ href: '/sandbox-2/', label: 'Sandbox 2', note: 'The physical world lab: buildings from their parts, with physics, fixings and wind', cover: 'bd34c342d7db41283ff4d243aa21bf08daf40fe1e9b47a0f63f92a00d65a9c6e.jpg' },
		{ href: '/sandbox-3/', label: 'Sandbox 3', note: 'The tired land: walk it as someone new every visit', cover: '41a858860a82169d3d5586d30b648723c32874a94e014f30718a5a70f5b56e85.jpg' },
		{ href: '/sandbox-4/', label: 'Sandbox 4', note: 'The cassette joint: a cast cassette of the 100 m dome seated, keyed, capped and clamped', cover: 'd308f061bd5498775faa69da06ae54aef9a39c784b714c5c3605382e18540aca.jpg' },
		{ href: '/sandbox-5/', label: 'Sandbox 5', note: 'The forest dome alone in its own food forest, outside and under the glass', cover: '80ee079deb5be54066d2fd230d11fa74ee59aa8f13c6ce3b9b7aa27fb30c8892.jpg' }
	];
	type Tile = { href: string; label: string; note: string; icon: (typeof GROUP_APPS)[number]['icon'] | 'play' | 'coops' | 'key' | 'database' | 'factory' | 'studio' | 'gear' | 'media' | 'link' | 'journal' | 'ledger'; admins?: boolean };
	const APPS: Tile[] = [
		// the asset library, a tile per group, each the same viewer (Samuel 2026-11-04)
		...GROUP_APPS.map((g) => ({ href: g.href, label: g.label, note: g.note, icon: g.icon, admins: 'admins' in g && g.admins })),
		// the factories that build our assets, each a live simulation (routes/factories): first the LifeTrac line; admins
		// only for now (Samuel 2026-11-03)
		{ href: '/factories/', label: 'Factories', note: 'The LifeTrac line, every part from raw stock', icon: 'factory', admins: true },
	];
	// the coop's own, for an admin acting as Maia City (Samuel 2026-11-04: the stories moved here; 2026-11-05: the
	// proposals left for the nav pill's star)
	const CITY: Tile[] = [
		// our films as timelines, storyboard beside the script, to feel whether they work (routes/stories)
		{ href: '/stories/', label: 'Stories', note: 'Our films as timelines: storyboard, voice, notes', icon: 'studio' },
		// every image, video and recording play keeps, labelled, and where the stories use it (routes/library, Samuel 2026-11-04)
		{ href: '/library/', label: 'Library', note: 'Every image, video and recording play keeps', icon: 'media' },
		// every link from the net Maia City keeps, its summaries and its authors, kept by avenMAIA: all of them artifacts
		// (routes/artifacts, Samuel 2026-11-06)
		{ href: '/artifacts/', label: 'Artifacts', note: 'Every link we keep, summarized, with its authors', icon: 'link' },
		// the game's configs, each a Loro document, first the levelling (routes/game-editor, Samuel 2026-11-04)
		{ href: '/game-editor/', label: 'Game editor', note: 'The game\'s configs: how a village grows', icon: 'gear' },
		// what play teaches its agents, each skill a Loro document (routes/skills, play/SPEC.md §4.14)
		{ href: '/skills/', label: 'Skills', note: 'What play teaches its agents, and its history', icon: 'journal' },
		// every schema a document of the meta-schema, its documents and its history (routes/schemas, play/SPEC.md "Version control")
		{ href: '/schemas/', label: 'Schemas', note: 'Every type of document, itself a document', icon: 'ledger' },
		// the auto-accept rules, one document: which intents pass a gate with no person (routes/rules, play/SPEC.md §4.12)
		{ href: '/rules/', label: 'Rules', note: 'Which intents pass Approve spec or Accept with no person', icon: 'check' },
		{ href: '/admin/', label: 'Members', note: 'Who holds which level', icon: 'coops' },
		{ href: '/admin/#invites', label: 'Invites', note: 'Make a citizen', icon: 'key' },
		// the admins' window into play's Postgres, read only (routes/postgres): the coop's own (Samuel 2026-11-03)
		{ href: '/postgres/', label: 'Postgres', note: 'Every table and its rows, read only', icon: 'database' }
	];
	const city = $derived(asCity());
	const admin = $derived(session.me?.level === 'admin');
	const apps = $derived(APPS.filter((t) => !t.admins || admin));
</script>

<svelte:head><title>Dashboard · maiaCITY play</title></svelte:head>

<main class="dash">
	<header>
		<p class="eyebrow">{city ? 'Acting as Maia City' : session.me?.founder ? `Founder ${String(session.me.founder).padStart(3, '0')}` : `A ${session.me?.level} of Maia City`}</p>
		<h1>{hello}{session.me?.name ? `, ${session.me.name}` : ''}.</h1>
	</header>

	<!-- the game: admins play it now, everyone else sees it coming (invite only) -->
	{#if admin}
		<a class="play" href="/game/map/"><Icon name="play" size={22} /><b>The game</b><span>The world map: biomes and plots, nothing built on it yet</span><em>Play →</em></a>
	{:else}
		<div class="play off" aria-disabled="true"><Icon name="play" size={22} /><b>The game</b><span>Coming soon</span><em>Invite only</em></div>
	{/if}

	<p class="divider">Game Worlds</p>
	<div class="games">
		{#each WORLDS as g (g.href)}
			<div class="game">
				<a href={g.href}>
					{#if g.cover}<img src={asset(g.cover)} alt="" loading="lazy" />{:else}<span class="nocover"></span>{/if}
					<span class="label"><b>{g.label}</b><span>{g.note}</span></span>
				</a>
			</div>
		{/each}
	</div>

	<p class="divider">Your apps</p>
	<div class="tiles">
		{#each apps as t (t.href)}
			<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
		{/each}
	</div>

	{#if city}
		<p class="divider">Maia City</p>
		<div class="tiles">
			{#each CITY as t (t.href)}
				<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
			{/each}
		</div>
	{/if}
</main>

<style>
	.dash { max-width: 60rem; margin: 0 auto; padding: 2.5rem clamp(1rem, 4vw, 2rem) 7rem; }
	.eyebrow { margin: 0; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--terracotta); }
	h1 { margin: 0.4rem 0 0; font-size: clamp(2.2rem, 5vw, 3.4rem); }
	.divider { display: flex; align-items: center; gap: 0.8rem; margin: 2.4rem 0 0.9rem; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
	.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
	.play { display: flex; align-items: center; gap: 0.8rem; margin-top: 2rem; padding: 0.75rem 1.1rem; border-radius: 14px; background: var(--ink); color: var(--paper); text-decoration: none; transition: transform 150ms ease, box-shadow 150ms ease; }
	.play:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgb(38 56 44 / 0.16); }
	.play :global(svg) { flex: none; color: var(--mustard); }
	.play b { font-family: var(--font-display); font-size: 1.1rem; font-weight: 500; }
	.play span { flex: 1; min-width: 0; overflow: hidden; font-size: 0.85rem; opacity: 0.8; text-overflow: ellipsis; white-space: nowrap; }
	.play em { flex: none; font-style: normal; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mustard); }
	.play.off { background: var(--paper); color: var(--muted); border: 1px solid var(--line); cursor: not-allowed; }
	.play.off:hover { transform: none; box-shadow: none; }
	.play.off :global(svg), .play.off em { color: var(--muted); }
	/* four worlds, two by two (Samuel 2026-11-05: Sandbox 4 joined the three) */
	.games { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
	.game { position: relative; overflow: hidden; aspect-ratio: 16 / 9; border-radius: 18px; background: var(--ink); }
	.game a { display: block; height: 100%; color: #fff; text-decoration: none; }
	.game img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 300ms ease; }
	.game:hover img { transform: scale(1.03); }
	.nocover { display: block; width: 100%; height: 100%; background: linear-gradient(160deg, #4f7a5a, #24452f); }
	.game .label { position: absolute; inset: auto 0 0; display: flex; flex-direction: column; padding: 2rem 1rem 0.9rem; background: linear-gradient(transparent, rgb(20 28 22 / 0.75)); line-height: 1.25; }
	.game b { font-family: var(--font-display); font-size: 1.1rem; font-weight: 500; }
	.game .label span { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; font-size: 0.85rem; opacity: 0.85; }
	/* auto-fill, not auto-fit: a row of two keeps the tiles' size instead of stretching each to half the page */
	.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 14px; }
	.tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.35rem; aspect-ratio: 1.15 / 1; padding: 1rem; border: 1px solid var(--line); border-radius: 18px; background: var(--paper); color: var(--ink); text-align: center; text-decoration: none; transition: transform 150ms ease, box-shadow 150ms ease; }
	.tile:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgb(38 56 44 / 0.1); }
	.tile :global(svg) { color: var(--mustard); }
	.tile b { margin-top: 0.3rem; font-family: var(--font-display); font-size: 1.2rem; font-weight: 500; }
	.tile span { font-size: 0.8rem; color: var(--muted); }
	@media (max-width: 860px) { .games { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 560px) {
		.game { aspect-ratio: 4 / 3; }
		.game .label span { display: none; }
		.game .label { padding: 1.4rem 0.7rem 0.6rem; }
		.tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
