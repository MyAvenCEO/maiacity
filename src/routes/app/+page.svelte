<!--
	The dashboard: where a founder lands once signed in. A greeting, then everything the app holds as tiles — the
	games to play, what to read, and (for whoever holds them) the admin's tools.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { founderCount, me, type Founder } from '$lib/auth/client';
	import Icon from '$lib/app/Icon.svelte';
	import { ADMIN, APPS, PLAY, READ, holds, released } from '$lib/app/places';
	import { asset } from '$lib/media/url';

	let founder = $state<Founder | null>(null);
	let count = $state<number | null>(null);
	onMount(async () => {
		founder = await me().catch(() => null);
		count = (await founderCount().catch(() => null))?.count ?? null;
	});

	const hour = new Date().getHours();
	const hello = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const tools = $derived(ADMIN.filter((p) => holds(founder, p)));
	// the games this founder may open: the published ones, and for an admin the drafts too
	const games = $derived(PLAY.filter((g) => released(founder, g)));
</script>

<svelte:head>
	<title>Dashboard · maiaCITY</title>
</svelte:head>

<main class="dash">
	<header>
		<p class="eyebrow">{founder ? `Founder ${String(founder.number).padStart(3, '0')}` : ' '}</p>
		<h1>{hello}{founder ? `, ${founder.name}` : ''}.</h1>
		{#if count}<p class="lede">{count} {count === 1 ? 'founder is' : 'founders are'} in the line.</p>{/if}
	</header>

	<p class="divider">Your apps</p>
	<div class="tiles two">
		{#each APPS as t (t.href)}
			<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
		{/each}
	</div>

	{#if games.length}
	<p class="divider">Play</p>
	<div class="games">
		{#each games as g (g.href)}
			<a class="game" href={g.href}>
				{#if g.cover}<img src={asset(g.cover)} alt="" loading="lazy" />{:else}<span class="nocover"></span>{/if}
				{#if g.release === 'draft'}<span class="draft">Draft</span>{/if}
				<span class="label"><b>{g.label}</b><span>{g.note}</span></span>
			</a>
		{/each}
	</div>
	{/if}

	<p class="divider">Read</p>
	<div class="tiles">
		{#each READ as t (t.href)}
			<a class="tile" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
		{/each}
	</div>

	{#if tools.length}
		<p class="divider">Admin</p>
		<div class="tiles">
			{#each tools as t (t.href)}
				<a class="tile admin" href={t.href}><Icon name={t.icon} size={34} /><b>{t.label}</b><span>{t.note}</span></a>
			{/each}
		</div>
	{/if}
</main>

<style>
	.dash {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2.5rem clamp(1rem, 4vw, 2rem) 0;
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

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	/* the games: their own pictures, two by two */
	.games {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}

	.game {
		position: relative;
		overflow: hidden;
		aspect-ratio: 16 / 9;
		border-radius: 18px;
		background: var(--ink);
		color: #fff;
		text-decoration: none;
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

	/* a game only the admins see yet */
	.draft {
		position: absolute;
		top: 0.7rem;
		left: 0.7rem;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--mustard);
		color: var(--ink);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
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
		font-size: 0.85rem;
		opacity: 0.85;
	}

	/* the rest: square tiles, three to a row */
	.tiles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}

	.tiles.two {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.tiles.two .tile {
		aspect-ratio: 2.4 / 1;
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

	.tile.admin :global(svg) {
		color: var(--ink);
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

	@media (max-width: 560px) {
		.games {
			grid-template-columns: minmax(0, 1fr);
		}
		.tiles {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
