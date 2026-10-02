<!--
	The room's film page: with ?film the film camera (src/lib/film), the room alone under the film's clocks, for the
	studio's world viewer and the plate renderer; else it passes on to /app/worlds/room/.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute sandbox="room" to="/app/worlds/room/" mount={async (stage, _area, onProgress) => (await import('$lib/worlds/room')).mountRoom(stage, onProgress)} />
