<script lang="ts">
	import { base } from '$app/paths';
	import { AvenCityGame } from '$lib/aven-city';
	import '$lib/aven-city/styles/index.css';
</script>

<svelte:head>
	<title>avenCITY Sandbox 1 · maiaCITY</title>
	<meta name="description" content="The avenCITY world — a procedurally generated hex island." />
</svelte:head>

<!-- The world owns its own full-screen layout and three.js scene, so the wrapper
     must not create a box around it. -->
<div class="world"><AvenCityGame backHref="{base}/games" /></div>

<style>
	.world {
		display: contents;
	}
</style>
