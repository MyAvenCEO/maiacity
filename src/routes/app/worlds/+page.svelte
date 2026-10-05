<!--
	Worlds: real places made into 3D worlds — measured from photos, walked like every sandbox, and shot by the studio's
	film camera like every sandbox (game/film/worlds.js) — and the sandboxes. Each with its version and history
	($lib/app/versions.js), and what it is anchored to. An admin's.
-->
<script lang="ts">
	import Icon from '$lib/app/Icon.svelte';
	import { PLAY, WORLDS, type Place } from '$lib/app/places';
	import { day, tag } from '$lib/app/versions.js';
</script>

<svelte:head>
	<title>Worlds · maiaCITY</title>
</svelte:head>

<main class="worlds">
	<header>
		<h1>Worlds</h1>
		<p class="lede">Real places as 3D worlds: measured from photos, to walk through and to film in the studio.</p>
	</header>
	{#snippet card(w: Place)}
		<div class="world">
			<a href={w.href}><Icon name={w.icon} size={34} /><b>{w.label} {#if w.version}<em>{tag(w.version)}</em>{/if}</b><span>{w.note}</span></a>
			{#if w.anchors}<span class="anchors">Anchored to {w.anchors}</span>{/if}
			{#if w.versions?.length}
				<ol class="history" aria-label="{w.label}: history">
					{#each [...w.versions].reverse() as ver (ver.v)}
						<li><a href={ver.build}><b>{tag(ver.v)}</b> {ver.note} <small>{day(ver.date)}</small></a></li>
					{/each}
				</ol>
			{/if}
		</div>
	{/snippet}
	<div class="grid">
		{#each WORLDS as w (w.href)}{@render card(w)}{/each}
	</div>
	<h2>Sandboxes</h2>
	<div class="grid">
		{#each PLAY as w (w.href)}{@render card(w)}{/each}
	</div>
	<!-- the open data a world is built from, credited here rather than over the world (both licences ask for it) -->
	<p class="credits">The Isar: map © OpenStreetMap contributors (ODbL) · terrain DGM1 © Bayerische Vermessungsverwaltung (CC BY 4.0)</p>
</main>

<style>
	.worlds {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1rem 4rem;
	}

	h1 {
		margin: 0.6rem 0 0.2rem;
	}

	.lede {
		margin: 0 0 1.5rem;
		opacity: 0.75;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0.8rem;
	}

	.world {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 1.1rem;
		border: 1px solid rgb(0 0 0 / 0.08);
		border-radius: 14px;
		background: rgb(255 255 255 / 0.6);
		color: inherit;
		text-decoration: none;
	}

	.world:hover {
		border-color: rgb(0 0 0 / 0.2);
	}

	.world > a {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		color: inherit;
		text-decoration: none;
	}

	.world em {
		font-size: 0.72rem;
		font-style: normal;
		font-weight: 400;
		opacity: 0.55;
	}

	.world span {
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.world .anchors {
		font-size: 0.75rem;
		opacity: 0.6;
	}

	h2 {
		margin: 2rem 0 0.8rem;
		font-size: 1.1rem;
	}

	/* its versions, newest first: each one opens the world as it was */
	.history {
		margin: 0.3rem 0 0;
		padding: 0.3rem 0 0 0.6rem;
		border-left: 2px solid rgb(0 0 0 / 0.08);
		font-size: 0.74rem;
		list-style: none;
	}

	.history a {
		color: inherit;
		text-decoration: none;
	}

	.history small {
		opacity: 0.5;
	}

	.credits {
		margin: 1.5rem 0 0;
		font-size: 0.72rem;
		opacity: 0.55;
	}
</style>
