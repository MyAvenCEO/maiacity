<!--
	The dashboard, the one place everything starts from (Samuel 2026-10-18: one dashboard, no group pages, no avenDB page
	of its own, the same for every vault, a coop's and a person's): the home of avenDB's Shell (./Shell.svelte, no
	address or `#home`), which src/routes/app/+page.svelte opens at /app; a greeting;
	the Game Worlds, every game (MaiaCity V1, the sandboxes) the Maia City cap groups the person holds open: the
	sandboxes to every Traveler, V1 to every Citizen ($lib/app/access.svelte.js; Samuel 2026-10-19: no draft stage);
	the founder's apps (Ledger, Coops, Proposals, the Universe); then avenDB's apps, the vault's pages
	($lib/avendb/VaultApps.svelte), each opening right here: all of them for an admin, in the vault picked in the nav
	pill; Maia City's Assets and Worlds, read only, for every other Traveler.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { founderCount, me, type Founder } from '$lib/auth/client';
	// the person's name, from their avenDB human vault's profile: none of it in maiaCITY's database
	import { session } from '$lib/avendb/session.svelte.js';
	import { nameOf } from '$lib/avendb/vaults.js';
	import VaultApps from '$lib/avendb/VaultApps.svelte';
	import Icon from '$lib/app/Icon.svelte';
	import { APPS, GAME_WORLDS, holds, isAdmin, opens } from '$lib/app/places';
	import { access, holdsGroup } from '$lib/app/access.svelte.js';
	import { TRAVELER } from '$lib/avendb/capgroups.js';
	import { asset } from '$lib/media/url';

	/** what the vault's home shows above its apps: the consent screen, while a request waits */
	let { children }: { children?: Snippet } = $props();

	let founder = $state<Founder | null>(null);
	let count = $state<number | null>(null);
	onMount(async () => {
		founder = await me().catch(() => null);
		count = (await founderCount().catch(() => null))?.count ?? null;
	});

	const hour = new Date().getHours();
	const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const admin = $derived(isAdmin());
	// the games this founder opens, by the cap groups of Maia City they hold
	const games = $derived(GAME_WORLDS.filter((g) => opens(g)));
	const apps = $derived(APPS.filter((t) => holds(founder, t) && opens(t)));
	// Maia City's Assets and Worlds in avenDB, read only, for every traveler
	const traveler = $derived(!!access.city && holdsGroup(TRAVELER));
	// the vault avenDB's apps open in: the one picked in the nav pill
	const vault = $derived(session.world?.vaults.find((v: { id: string }) => v.id === session.vault) ?? null);
</script>

<main class="dash">
	<header>
		<p class="eyebrow">{founder ? `Founder ${String(founder.number).padStart(3, '0')}` : ' '}</p>
		<h1>{hello}{session.name ? `, ${session.name}` : ''}.</h1>
		{#if count}<p class="lede">{count} {count === 1 ? 'founder is' : 'founders are'} in the line.</p>{/if}
	</header>

	{@render children?.()}

	<p class="divider">Game Worlds</p>
	<div class="games">
		{#each games as g (g.href)}
			<div class="game">
				<a href={g.href}>
					{#if g.cover}<img src={asset(g.cover)} alt="" loading="lazy" />{:else}<span class="nocover"></span>{/if}
					<span class="label"><b>{g.label}</b><span>{g.note}</span></span>
				</a>
			</div>
		{:else}
			{#if access.known || session.phase !== 'open'}
				<p class="none">{session.phase === 'open' ? 'An invite to Maia City opens the sandboxes: ask for one.' : 'Unlock your avenDB to see the games your invite opens.'}</p>
			{/if}
		{/each}
	</div>

	<p class="divider">Your apps</p>
	<div class="tiles">
		{#each apps as t (t.href)}
			<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
		{/each}
	</div>

	<!-- avenDB's apps, the one place of the vault's pages: all of them for an admin, in the vault picked in the nav pill;
	     for every other Traveler, Maia City's Assets and Worlds (Samuel 2026-10-19: purely from avenDB, no cards of
	     their own) -->
	{#if admin}
		<VaultApps>
			{#snippet head(name: string)}
				<p class="divider">{name}{#if vault && name === 'Workspace'}<small> · {nameOf(vault)}</small>{/if}</p>
			{/snippet}
		</VaultApps>
	{:else if traveler}
		<VaultApps only={['assets', 'worlds']} onopen={() => (session.vault = access.city)}>
			{#snippet head()}
				<p class="divider">Maia City</p>
			{/snippet}
		</VaultApps>
	{/if}
</main>

<style>
	.dash {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2.5rem clamp(1rem, 4vw, 2rem) 7rem;
	}

	h1 {
		margin: 0.4rem 0 0;
		font-size: clamp(2.2rem, 5vw, 3.4rem);
	}

	.lede {
		margin: 0.6rem 0 0;
		color: var(--ink-soft);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin: 2.4rem 0 0.9rem;
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.divider small {
		font-size: inherit;
		letter-spacing: inherit;
		text-transform: none;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	/* the games: their own pictures, three a row, MaiaCity V1 over the whole row */
	.games {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}

	.game {
		position: relative;
		overflow: hidden;
		aspect-ratio: 16 / 9;
		border-radius: 18px;
		background: var(--ink);
	}

	.game:first-child {
		grid-column: 1 / -1;
		aspect-ratio: 21 / 9;
	}

	.game a {
		display: block;
		height: 100%;
		color: #fff;
		text-decoration: none;
	}

	/* no game opens yet: what opens them */
	.none {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--ink-soft);
	}

	.game img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 300ms ease;
	}

	.game:hover img {
		transform: scale(1.03);
	}

	/* a game with no cover yet: a quiet gradient */
	.nocover {
		display: block;
		width: 100%;
		height: 100%;
		background: linear-gradient(160deg, #4f7a5a, #24452f);
	}


	.game .label {
		position: absolute;
		inset: auto 0 0;
		display: flex;
		flex-direction: column;
		padding: 2rem 1rem 0.9rem;
		background: linear-gradient(transparent, rgb(20 28 22 / 0.75));
		line-height: 1.25;
	}

	.game b {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 500;
	}

	.game .label span {
		display: -webkit-box;
		overflow: hidden;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		font-size: 0.85rem;
		opacity: 0.85;
	}

	.game:not(:first-child) b {
		font-size: 1.1rem;
	}

	/* your apps: tiles in one row on a wide screen, two a row on a phone */
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
		gap: 14px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		aspect-ratio: 1.15 / 1;
		padding: 1rem;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: var(--paper);
		color: var(--ink);
		text-align: center;
		text-decoration: none;
		transition: transform 150ms ease, box-shadow 150ms ease;
	}

	.tile:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 22px rgb(38 56 44 / 0.1);
	}

	.tile :global(svg) {
		color: var(--mustard);
	}

	.tile b {
		margin-top: 0.3rem;
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 500;
	}

	.tile span {
		font-size: 0.8rem;
		color: var(--muted);
	}

	@media (max-width: 860px) {
		.games {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 560px) {
		/* on a phone the sandboxes stay two a row, their names alone */
		.game:first-child {
			aspect-ratio: 16 / 9;
		}
		.game:not(:first-child) {
			aspect-ratio: 4 / 3;
		}
		.game:not(:first-child) .label span {
			display: none;
		}
		.game:not(:first-child) .label {
			padding: 1.4rem 0.7rem 0.6rem;
		}
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
