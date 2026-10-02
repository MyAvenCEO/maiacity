<!--
	The old address of Sandbox 3 passes on to /app/games/sandbox-3/ — except with ?film&area=<dome>: then it is the film
	camera (src/lib/film), that dome's whole inside alone under the film's clocks, for the studio and the plate renderers.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute
	sandbox="sandbox-3"
	to="/app/games/sandbox-3/"
	mount={async (stage, area, onProgress) => {
		const { mountInterior } = await import('$lib/sandbox-2/interior/interior');
		return mountInterior(stage, /** @type {import('$lib/sandbox-2/interior/interior').DomeKind} */ (area), onProgress);
	}}
/>
