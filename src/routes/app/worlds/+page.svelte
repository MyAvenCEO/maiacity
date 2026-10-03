<!--
	Worlds: real places made into 3D worlds — measured from photos, walked like every sandbox, and shot by the studio's
	film camera like every sandbox (game/film/worlds.js). An admin's.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import Icon from '$lib/app/Icon.svelte';
	import { WORLDS } from '$lib/app/places';
</script>

<svelte:head>
	<title>Worlds · maiaCITY</title>
</svelte:head>

<main class="worlds">
	<header>
		<a class="back" href="{base}/app/">← Dashboard</a>
		<h1>Worlds</h1>
		<p class="lede">Real places as 3D worlds: measured from photos, to walk through and to film in the studio.</p>
	</header>
	<div class="grid">
		{#each WORLDS as w (w.href)}
			<a class="world" href={w.href}><Icon name={w.icon} size={34} /><b>{w.label}</b><span>{w.note}</span></a>
		{/each}
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

	.back {
		color: inherit;
		opacity: 0.7;
		text-decoration: none;
		font-size: 0.9rem;
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

	.world span {
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.credits {
		margin: 1.5rem 0 0;
		font-size: 0.72rem;
		opacity: 0.55;
	}
</style>
