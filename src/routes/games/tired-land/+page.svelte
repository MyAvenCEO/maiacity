<!--
	The tired land's film page: with ?film the film camera (src/lib/film), the fields and the highway alone under the
	film's clocks, for the studio's world viewer and the plate renderer; else it passes on to /app/worlds/tired-land/.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute sandbox="tired-land" to="/app/worlds/tired-land/" mount={async (stage, _area, onProgress) => (await import('$lib/worlds/tired-land')).mountTiredLand(stage, onProgress)} />
