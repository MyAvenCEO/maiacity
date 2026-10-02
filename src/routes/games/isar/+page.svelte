<!--
	The Isar's film page: with ?film the film camera (src/lib/film), the river alone under the film's clocks, for the
	studio's world viewer and the plate renderer; else it passes on to /app/worlds/isar/.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute sandbox="isar" to="/app/worlds/isar/" mount={async (stage, _area, onProgress) => (await import('$lib/worlds/isar')).mountIsar(stage, onProgress)} />
