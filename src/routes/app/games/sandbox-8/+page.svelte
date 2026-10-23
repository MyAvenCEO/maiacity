<!--
	avenCITY Sandbox 8 — Constructible City ($lib/sandbox-8, from its upstream: ./upstream.mjs): a hard-realism
	settlement game near Göttingen, where every road, house and tent is built by people with their hands, tools and
	machines, from materials that arrive by truck, in real weather.
-->
<script>
	const city = import('$lib/sandbox-8/City.svelte');
</script>

<svelte:head>
	<title>avenCITY Sandbox 8 · Constructible City · maiaCITY</title>
	<meta name="description" content="A hard-realism settlement game: roads, houses and tents built by people with their hands, tools and machines, in real weather." />
</svelte:head>

{#await city then { default: City }}
	<City />
{/await}
