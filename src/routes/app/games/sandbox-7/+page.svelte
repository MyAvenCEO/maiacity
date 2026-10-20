<!--
	avenCITY Sandbox 6 — one village at its real size ($lib/sandbox-6): the Tower180 hex ringed by its Dome120 factories,
	and six living hexes round it of Dome40 and Dome80 homes (each a straight block across the north), Dome120 food forests and utilities; every
	dimension, tonne, price and hectare on toggleable panels, for the village, the tower hex or a living hex.
-->
<script>
	import { loadCode } from '../../../../../game/code/index.js';

	// the hex's numbers are a config entry of the Maia City COOP (configs/sandbox-6/specs): loaded before the hex's
	// modules are, as they read them as they load
	const hex = loadCode().then(() => import('$lib/sandbox-6/HexPlan.svelte'));
</script>

<svelte:head>
	<title>avenCITY Sandbox 6 · One village · maiaCITY</title>
	<meta name="description" content="A maiaCITY village of seven hexes at its real size: the domes, the tower, their materials in tonnes, real prices and the land in hectares." />
</svelte:head>

{#await hex then { default: HexPlan }}
	<HexPlan />
{/await}
