<!--
	The address of Sandbox 6 passes on to /app/games/sandbox-6/ — except with ?film: then it is the film camera
	(src/lib/film), the valley alone under the film's clocks, played by its autoplayer, for the studio's world viewer
	and the plate renderer.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute
	sandbox="sandbox-6"
	to="/app/games/sandbox-6/"
	mount={async (stage, _area, onProgress) => (await import('$lib/sandbox-6/game.js')).mountGame(stage, { film: true, onProgress })}
/>
