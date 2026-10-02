<!--
	The old address of Sandbox 2 passes on to /app/games/sandbox-2/ — except with ?film&area=planet|island: then it is
	the film camera (src/lib/film), the world alone under the film's clocks. On film it is the procedural world only —
	the planet's map, or a city's island grown from the shot's seed (world.seed) with its settlements seeded from it —
	never the live cities, so a shot renders the same every time.
-->
<script>
	import { base } from '$app/paths';
	import FilmRoute from '$lib/film/FilmRoute.svelte';
	import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../game/map';

	/** @param {HTMLElement} stage */
	const canvasIn = (stage) => {
		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'display:block;width:100%;height:100%';
		stage.appendChild(canvas);
		return canvas;
	};

	/** @param {HTMLElement} stage @param {string | undefined} area @param {(label: string) => void} onProgress */
	async function mount(stage, area, onProgress) {
		if (area === 'island') {
			// the island is grown when a shot is staged: its seed is the shot's
			const { createScene } = await import('$lib/sandbox-2/island/scene');
			const canvas = canvasIn(stage);
			const island = createScene(canvas, { film: true });
			onProgress('ready');
			return { dispose: () => (island.dispose(), canvas.remove()) };
		}
		onProgress('Drawing the planet');
		const url = (/** @type {string} */ f) => `${base}/sandbox-2/map/${f}`;
		const quiet = (/** @type {Promise<any>} */ p) => p.catch(() => undefined);
		const [{ mountWorld }, isLand, kindOf, isMountain, depthOf] = await Promise.all([
			import('$lib/sandbox-2/world/world'),
			quiet(loadLandMask(url('land.json'))),
			quiet(loadBiomeMap(url('biomes.json'))),
			quiet(loadMountainMask(url('mountains.geojson'))),
			quiet(loadDepthMap(url('depth.json')))
		]);
		const planet = mountWorld(stage, { cities: [], isLand, kindOf, isMountain, depthOf });
		onProgress('ready');
		return planet;
	}
</script>

<FilmRoute sandbox="sandbox-2" to="/app/games/sandbox-2/" {mount} />
