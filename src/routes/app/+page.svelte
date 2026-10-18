<!--
	The dashboard, the one place everything starts from (Samuel 2026-10-18: one dashboard, no group pages): a greeting;
	the Game Worlds, every game (MaiaCity V1, the sandboxes) as the Maia City COOP vault serves it, published or, for an
	admin, a draft, which whoever's device acts for that vault publishes or withdraws right here
	($lib/app/games.svelte.js); the founder's apps (Ledger, Coops, Proposals, the Universe); then avenDB's apps (the
	game assets among them, in its Assets), the vault's pages as its own home lists them ($lib/avendb/VaultApps.svelte), each
	opening in the vault picked in the nav pill.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { founderCount, me, type Founder } from '$lib/auth/client';
	// the person's name, from their avenDB human vault's profile: none of it in maiaCITY's database
	import { session } from '$lib/avendb/session.svelte.js';
	import { nameOf } from '$lib/avendb/vaults.js';
	import VaultApps from '$lib/avendb/VaultApps.svelte';
	import Icon from '$lib/app/Icon.svelte';
	import { APPS, GAME_WORLDS, holds, isAdmin, published, released } from '$lib/app/places';
	import { cityOf, publish } from '$lib/app/games.svelte.js';
	import { asset } from '$lib/media/url';

	let founder = $state<Founder | null>(null);
	let count = $state<number | null>(null);
	onMount(async () => {
		founder = await me().catch(() => null);
		count = (await founderCount().catch(() => null))?.count ?? null;
	});

	const hour = new Date().getHours();
	const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const admin = $derived(isAdmin(founder));
	// the games this founder may open: the published ones, and for an admin the drafts too
	const games = $derived(GAME_WORLDS.filter((g) => released(founder, g)));
	const apps = $derived(APPS.filter((t) => holds(founder, t)));
	// the Maia City COOP vault, where this device acts for it: only then a game can be published or withdrawn here
	const city = $derived(admin ? cityOf(session.world) : null);
	// the vault avenDB's apps open in: the one picked in the nav pill
	const vault = $derived(session.world?.vaults.find((v: { id: string }) => v.id === session.vault) ?? null);
</script>

<svelte:head>
	<title>Dashboard · maiaCITY</title>
</svelte:head>

<main class="dash">
	<header>
		<p class="eyebrow">{founder ? `Founder ${String(founder.number).padStart(3, '0')}` : ' '}</p>
		<h1>{hello}{session.name ? `, ${session.name}` : ''}.</h1>
		{#if count}<p class="lede">{count} {count === 1 ? 'founder is' : 'founders are'} in the line.</p>{/if}
	</header>

	<p class="divider">Game Worlds</p>
	<div class="games">
		{#each games as g (g.href)}
			{@const on = published(g)}
			<div class="game">
				<a href={g.href}>
					{#if g.cover}<img src={asset(g.cover)} alt="" loading="lazy" />{:else}<span class="nocover"></span>{/if}
					<span class="label"><b>{g.label}</b><span>{g.note}</span></span>
				</a>
				{#if !on}<span class="draft">Draft</span>{/if}
				{#if city && g.game}
					<button class="publish" class:on disabled={!!session.doing} onclick={() => publish(g.game!, !on)} title={on ? 'Everyone may watch and read it: withdraw it' : 'Only the admins open it: publish it to everyone'}>{on ? 'Withdraw' : 'Publish'}</button>
				{/if}
			</div>
		{/each}
	</div>
	{#if city && session.error}<p class="err">{session.error}</p>{/if}

	<p class="divider">Your apps</p>
	<div class="tiles">
		{#each apps as t (t.href)}
			<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
		{/each}
	</div>

	{#if admin}
		<VaultApps at="{base}/app/avendb/">
			{#snippet head(name: string)}
				<p class="divider">{name}{#if vault && name === 'Workspace'}<small> · {nameOf(vault)}</small>{/if}</p>
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

	.draft {
		position: absolute;
		top: 0.7rem;
		left: 0.7rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--mustard);
		color: var(--ink);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		pointer-events: none;
	}

	.publish {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.publish:not(.on) {
		border-color: var(--mustard);
		background: var(--mustard);
	}

	.publish:disabled {
		opacity: 0.5;
	}

	.err {
		color: #a03224;
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
