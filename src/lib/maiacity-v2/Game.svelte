<!--
	MaiaCity V2's game screen is V1's ($lib/maiacity-v1/Game.svelte), played with V2's own rules, server, story and
	world (./game.js): three players, the MaiaCOOP and the Village COOP with one maiaMIND/villageMIND pool, the third
	settler's supply run, the shared water can and V2's Proposals page.
-->
<script>
	import Game from '$lib/maiacity-v1/Game.svelte';
	import V2 from './game.js';
</script>

<Game edition={V2} />
