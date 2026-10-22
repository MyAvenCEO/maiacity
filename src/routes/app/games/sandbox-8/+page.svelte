<!--
	avenCITY Sandbox 7 — the physical world lab ($lib/sandbox-8): buildings assembled from their physical parts, part by
	part and stage by stage, with Rapier rigid-body physics in a worker, finite fixings, temporary stands, wind and damage.
-->
<script>
	const lab = import('$lib/sandbox-8/Lab.svelte');
</script>

<svelte:head>
	<title>avenCITY Sandbox 7 · Physical world lab · maiaCITY</title>
	<meta name="description" content="Buildings assembled from their physical parts, part by part, with rigid-body physics, finite fixings, wind and damage." />
</svelte:head>

{#await lab then { default: Lab }}
	<Lab />
{/await}
