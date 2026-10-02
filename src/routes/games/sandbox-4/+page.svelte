<!--
	The old address of Sandbox 4 passes on to /app/games/sandbox-4/ — except with ?film: then it is the film camera
	(src/lib/film), the world alone under the film's clocks, for the studio's world viewer and the plate renderer.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute
	sandbox="sandbox-4"
	to="/app/games/sandbox-4/"
	mount={async (stage, _area, onProgress) => (await import('$lib/sandbox-2/interior/village')).mountVillage(stage, onProgress)}
/>
