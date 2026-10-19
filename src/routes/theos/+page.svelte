<script>
	// The theOS paper on the public site, the same page avenDB's Docs view shows for the theOS doc ($lib/theos/Paper.svelte),
	// with Figure 9's simulation run once at build time (./+page.server.js).
	import Paper from '$lib/theos/Paper.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>theOS · The civilization scale operating system of Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, HEARTS as the unit of account, liquidity owned by the City COOP, open market governance, and Proposition 3: no one starves, no one has to work to survive, and living standards rise for every tenth of the people, in real units. By Samuel Andert and Claude." />
</svelte:head>

<main>
	<Paper gini={data.gini} />
</main>
