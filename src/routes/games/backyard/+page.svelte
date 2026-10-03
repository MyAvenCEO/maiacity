<!--
	The backyard's film page: with ?film the film camera (src/lib/film), the backyard alone under the film's clocks, for
	the studio's world viewer and the plate renderer; else it passes on to /app/worlds/backyard/.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute sandbox="backyard" to="/app/worlds/backyard/" mount={async (stage, _area, onProgress) => (await import('$lib/worlds/backyard')).mountBackyard(stage, onProgress)} />
