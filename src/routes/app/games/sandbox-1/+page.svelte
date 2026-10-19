<script lang="ts">
	import { loadCode } from '../../../../../game/code/index.js';

	// the island's biomes are a config entry of the Maia City COOP (configs/sandbox-1/biomes): loaded before the
	// island's modules are, as they read them as they load
	const island = loadCode().then(() => import('$lib/aven-city'));
	import '$lib/aven-city/styles/index.css';
</script>

<svelte:head>
	<title>avenCITY Sandbox 1 · maiaCITY</title>
	<meta name="description" content="The avenCITY world — a procedurally generated hex island." />
</svelte:head>

<!-- The world owns its own full-screen layout and three.js scene, so the wrapper
     must not create a box around it. -->
{#await island then { AvenCityGame }}
	<div class="world"><AvenCityGame /></div>
{/await}

<style>
	.world {
		display: contents;
	}
</style>
