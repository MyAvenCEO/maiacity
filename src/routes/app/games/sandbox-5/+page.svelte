<!--
	avenCITY Sandbox 5 — a valley of settlers, built from scratch: its own map, economy and rules ($lib/sandbox-5), only
	the sky, the stage and the map camera shared with the other sandboxes ($lib/sandbox-kit). Roads and carriers,
	production chains from the forest to the mint, soldiers who widen the land, and a rival keep to take.
-->
<script>
	import { loadCode } from '../../../../../game/code/index.js';

	// the valley's numbers are a config entry of the Maia City COOP (configs/sandbox-5/rules): loaded before the game's
	// modules are, as they read them as they load
	const valley = loadCode().then(() => import('$lib/sandbox-5/Valley.svelte'));
</script>

<svelte:head>
	<title>avenCITY Sandbox 5 · A valley of settlers · maiaCITY</title>
	<meta name="description" content="Settle a valley: build roads and flags, let carriers bring wares from flag to flag, run production chains from logs to coins, and take the rival keep." />
</svelte:head>

{#await valley then { default: Valley }}
	<Valley />
{/await}
