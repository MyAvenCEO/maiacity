<!--
	The old address of Sandbox 1 passes on to /app/games/sandbox-1/ — except with ?film: then it is the film camera
	(src/lib/film), the island alone under the film's clocks, grown from its seed with nothing kept in the browser.
-->
<script>
	import FilmRoute from '$lib/film/FilmRoute.svelte';
	import { ISLAND_SEED } from '$lib/aven-city/game/seed.js';

	/** @param {HTMLElement} stage */
	const canvasIn = (stage) => {
		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:100%;height:100%';
		stage.appendChild(canvas);
		return canvas;
	};
</script>

<FilmRoute
	sandbox="sandbox-1"
	to="/app/games/sandbox-1/"
	mount={async (stage, _area, onProgress) => {
		const { createScene } = await import('$lib/aven-city/game/three/scene');
		onProgress('Growing the island');
		const canvas = canvasIn(stage);
		const island = createScene(canvas, { film: true });
		island.setWorld(ISLAND_SEED);
		onProgress('ready');
		return { dispose: () => (island.dispose(), canvas.remove()) };
	}}
/>
