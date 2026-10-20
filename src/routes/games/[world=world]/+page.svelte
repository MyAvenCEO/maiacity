<!--
	A world's old address, /games/<sandbox>/, for every world of the registry (game/film/worlds.js): it passes on to the
	world's page in the app (the registry's route) — except with ?film, when it is the film camera (src/lib/film): that
	world alone, for the area the address names (&area=…), under the film's clocks, for the studio's world viewer and
	the plate renderers. How each world is raised for the film is ./mounts.js.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
	import { MOUNTS } from './mounts.js';

	/** @type {{ data: import('./$types').PageData }} */
	let { data } = $props();
</script>

{#key data.sandbox}
	<FilmRoute sandbox={data.sandbox} mount={MOUNTS[data.sandbox]} />
{/key}
