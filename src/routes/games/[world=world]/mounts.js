// HOW EACH WORLD IS RAISED FOR THE FILM — one `mount` per world of the registry (game/film/worlds.js), keyed by its id,
// for its film page (./+page.svelte, src/lib/film/FilmRoute.svelte). The registry itself stays plain data, read by the
// API and the shoot scripts as well as the browser; a world's mount pulls in three.js and the world's own code, so it is
// kept here, beside the one page that raises it, and the type below makes sure no world of the registry is missed.
//
// Each takes the film's stage, the area the address names (&area=…, the registry's own) and a way to say how far on it
// is ('ready' once it stands), and answers the world, which the film camera drives until `dispose`.
import { base } from '$app/paths';
import { loadCode } from '../../../../game/code/index.js';
import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../game/map';
import { ISLAND_SEED } from '$lib/aven-city/game/seed.js';

/**
 * @typedef {(stage: HTMLElement, area: string | undefined, onProgress: (label: string) => void) => Promise<{ dispose: () => void }>} Mount
 */

/** @param {HTMLElement} stage */
const canvasIn = (stage) => {
	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'display:block;width:100%;height:100%';
	stage.appendChild(canvas);
	return canvas;
};

/** @type {Record<import('../../../../game/film/worlds.js').Sandbox, Mount>} */
export const MOUNTS = {
	// the island alone under the film's clocks, grown from its seed with nothing kept in the browser
	'sandbox-1': async (stage, _area, onProgress) => {
		await loadCode();
		const { createScene } = await import('$lib/aven-city/game/three/scene');
		onProgress('Growing the island');
		const canvas = canvasIn(stage);
		const island = createScene(canvas, { film: true });
		island.setWorld(ISLAND_SEED);
		onProgress('ready');
		return { dispose: () => (island.dispose(), canvas.remove()) };
	},

	// the planet alone, drawn from its map, so a shot renders the same every time
	'sandbox-2': async (stage, _area, onProgress) => {
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
	},

	// one dome's whole inside, the dome the area names (its page in the app is the Buildings')
	'sandbox-3': async (stage, area, onProgress) => {
		const { mountInterior } = await import('$lib/sandbox-2/interior/interior');
		return mountInterior(stage, /** @type {import('$lib/sandbox-2/interior/interior').DomeKind} */ (area), onProgress);
	},

	// the dome cell (Sandbox 3 in the app)
	'sandbox-4': async (stage, _area, onProgress) => (await import('$lib/sandbox-2/interior/village')).mountVillage(stage, onProgress),

	// the dome cell grown from our plants (Sandbox 4 in the app)
	'sandbox-5': async (stage, _area, onProgress) =>
		(await import('$lib/sandbox-2/interior/village')).mountVillage(stage, onProgress, await (await import('$lib/sandbox-2/interior/sandbox5.js')).sandbox5()),

	// the valley (Sandbox 5 in the app), played by its autoplayer
	'sandbox-6': async (stage, _area, onProgress) => (await loadCode(), await import('$lib/sandbox-5/game.js')).mountGame(stage, { film: true, onProgress }),

	// the fields and the highway alone
	'tired-land': async (stage, _area, onProgress) => (await import('$lib/worlds/tired-land')).mountTiredLand(stage, onProgress),

	// MaiaCity V1's world playing a seat's whole first-run intro on the film's clock: A the first player's, B the second's
	'maiacity-v1': async (stage, area, onProgress) => (await import('$lib/maiacity-v1/film.js')).mountIntroFilm(stage, area === 'B' ? 'B' : 'A', onProgress)
};
