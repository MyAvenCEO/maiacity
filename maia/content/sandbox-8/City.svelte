<!--
	Constructible City on a page: its client (./cc/apps/web, Preact and three.js, the simulation in a worker) mounted
	into one full-screen layer over the app (./cc/apps/web/src/main.tsx mountCity), taken down again when the page is
	left.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	// the client's stylesheet, which its own build inlines into its page; every rule is scoped to .cc-city
	import './cc/apps/web/src/styles.css';

	/** @type {HTMLDivElement | undefined} */
	let root = $state();
	/** @type {(() => void) | undefined} */
	let unmount;
	let gone = false;
	let failed = $state('');

	onMount(() => {
		// @ts-ignore — a .tsx module (Preact JSX): Vite compiles it (./tsconfig.json), the app's type check does not
		import('./cc/apps/web/src/main.tsx').then(
			({ mountCity }) => {
				if (gone || !root) return;
				unmount = mountCity(root);
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
