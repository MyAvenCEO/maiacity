<!--
	The old address of Sandbox 3 passes on to the Buildings (/app/buildings/), where its domes are now — except with ?film&area=<dome>: then it is the film
	camera (src/lib/film), that dome's whole inside alone under the film's clocks, for the studio and the plate renderers.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
</script>

<FilmRoute
	sandbox="sandbox-3"
	to="/app/buildings/"
	mount={async (stage, area, onProgress) => {
		const { mountInterior } = await import('$lib/sandbox-2/interior/interior');
		return mountInterior(stage, /** @type {import('$lib/sandbox-2/interior/interior').DomeKind} */ (area), onProgress);
	}}
/>
