<!--
	Sandbox 4 as a film camera (/games/sandbox-4/?film): the world with nothing round it, its clocks taken over before
	it mounts, and window.__film to drive it (src/lib/film/index.js). The studio embeds it in an iframe; the plate
	renderer opens it in a headless browser. Players never see it.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { VillageHandle } from '$lib/sandbox-2/interior/village';
	import { startFilm } from './index.js';

	let stage = $state<HTMLDivElement>();
	let village: VillageHandle | null = null;
	let destroyed = false;
	let status = $state('Loading the world…');

	onMount(async () => {
		startFilm({ base });
		const { mountVillage } = await import('$lib/sandbox-2/interior/village');
		const v = await mountVillage(stage!, (label) => (status = label === 'ready' ? '' : `${label}…`));
		if (destroyed) return v.dispose();
		village = v;
	});
	onDestroy(() => {
		destroyed = true;
		village?.dispose();
	});
</script>

<svelte:head>
	<title>Sandbox 4 · film camera · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="film" bind:this={stage}></div>
{#if status}<p class="status">{status}</p>{/if}

<style>
	.film {
		position: fixed;
		inset: 0;
		background: #000;
		z-index: 10;
	}
	/* the film draws its own frame size: shown whole, letterboxed, never stretched */
	.film :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		object-fit: contain;
		display: block;
	}
	.status {
		position: fixed;
		left: 0.75rem;
		bottom: 0.5rem;
		z-index: 11;
		margin: 0;
		font: 12px/1.4 system-ui, sans-serif;
		color: #aaa;
	}
</style>
