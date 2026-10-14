<!--
	MaiaCity V1 — the simplest game of the city ($lib/maiacity-v1): two players, 24 HEARTS a day each, the MaiaCity COOP
	with the shared hex, the Tribe COOP with the 2-person bell tent, one maiaMIND/villageMIND pool, rent and the melt.
-->
<script>
	import Game from '$lib/maiacity-v1/Game.svelte';
</script>

<svelte:head>
	<title>MaiaCity V1 · maiaCITY</title>
	<meta name="description" content="Two players invest their daily HEARTS into two COOPs, pay rent in MINDs and swap through one pool, while every balance melts 7 % a year." />
</svelte:head>

<Game />
