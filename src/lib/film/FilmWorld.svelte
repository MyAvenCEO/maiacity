<!--
	A sandbox as a film camera (/games/<sandbox>/?film&area=…, game/film/worlds.js): the world with nothing round it, its
	clocks taken over before it mounts, and window.__film to drive it (src/lib/film/index.js). The world hands itself to
	the film as window.__world (src/lib/sandbox-kit/film.js). The studio embeds it in an iframe; the plate renderer and
	the Mac app open it unseen. Players never see it.
-->
<script>
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { startFilm } from './index.js';

	/**
	 * @type {{
	 *   title: string,
	 *   mount: (stage: HTMLElement, onProgress: (label: string) => void) => Promise<{ dispose: () => void }>
	 * }}
	 */
	let { title, mount } = $props();

	/** @type {HTMLDivElement | undefined} */
	let stage = $state();
	/** @type {{ dispose: () => void } | null} */
	let world = null;
	let destroyed = false;
	let status = $state('Loading the world…');

	onMount(async () => {
		startFilm({ base });
		try {
			const w = await mount(/** @type {HTMLDivElement} */ (stage), (label) => (status = label === 'ready' ? '' : `${label}…`));
			if (destroyed) return w.dispose();
			world = w;
			status = '';
		} catch (e) {
			status = `The world did not come up: ${/** @type {Error} */ (e).message}`;
		}
	});
	onDestroy(() => {
		destroyed = true;
		world?.dispose();
	});
</script>

<svelte:head>
	<title>{title} · film camera · maiaCITY</title>
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
