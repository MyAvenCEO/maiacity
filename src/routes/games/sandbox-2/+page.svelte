<!--
	The old address of Sandbox 2 passes on to /app/games/sandbox-2/ — except with ?film&area=planet: then it is the
	film camera (src/lib/film), the planet alone under the film's clocks, drawn from its map, so a shot renders the
	same every time.
-->
<script>
	import { base } from '$app/paths';
	import FilmRoute from '$lib/film/FilmRoute.svelte';
	import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../game/map';

	/** @param {HTMLElement} stage @param {string | undefined} _area @param {(label: string) => void} onProgress */
	async function mount(stage, _area, onProgress) {
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
		const planet = mountWorld(stage, { isLand, kindOf, isMountain, depthOf });
		onProgress('ready');
		return planet;
	}
</script>

<FilmRoute sandbox="sandbox-2" to="/app/games/sandbox-2/" {mount} />
