<!--
	Constructible City on a page: its pinned build (./pinned.js: one module, made by ./build.mjs from its upstream,
	brought from the Maia City vault by this page's avenDB device and run only when its bytes hash to ./build.json's
	pin) mounted into one full-screen layer over the app, with the app's render core and screen slots lent to it, and
	taken down again when the page is left.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { screenSlot } from '$lib/app/screen-slots.js';
	import { createControls, createRenderer } from '$lib/render/core.js';
	import { pinnedCity } from './pinned.js';

	/** @type {HTMLDivElement | undefined} */
	let root = $state();
	/** @type {(() => void) | undefined} */
	let unmount;
	let gone = false;
	let failed = $state('');

	onMount(() => {
		pinnedCity().then(
			({ mountCity }) => {
				if (gone || !root) return;
				unmount = mountCity(root, { createRenderer, createControls, screenSlot });
			},
			(error) => {
				failed = `Could not start Constructible City: ${error.message}`;
				console.error(error);
			}
		);
	});
	onDestroy(() => {
		gone = true;
		unmount?.();
	});
</script>

<div class="city">
	{#if failed}<p class="failed">{failed}</p>{/if}
	<div class="cc-city" bind:this={root}></div>
</div>

<style>
	.city {
		position: fixed;
		inset: 0;
		background: #10161a;
	}
	.failed {
		padding: 40px;
		color: #ffb79e;
	}
</style>
