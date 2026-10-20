// @ts-nocheck — three.js scene building through window.__world (Sandbox 4), as the shot lists always did
// Sets for the film, built into Sandbox 4's scene while it is filmed (never in the game itself). A shot names its set
// (world.props: 'tired-land'); the film camera (src/lib/film) builds it once, then moves what moves on the world's
// own clock (`window.__props(clock)`), so a truck is exactly where the shot expects it at every frame.
// Its randomness is seeded (the shot's world.seed): the same fields every time.
import { buildTiredLand, libraryLorry } from '../worlds/tiredLandSet.js';

/** The tired land (src/lib/worlds/tiredLandSet.js), built into Sandbox 4's scene for the shots that name it; its trucks
 *  the library's, drawn by Sandbox 4's renderer of the library (`library`, sandbox-2/interior/village.ts). Resolves once
 *  its trucks are built too (a set says when all of it is there: the film builds every set before the timeline plays). */
export function tiredLand(seed = 1) {
	if (window.__props) return;
	const v = window.__world ?? window.__village;
	const trucks = [];
	const { set, drive } = buildTiredLand(seed, libraryLorry(v.library.assets, trucks));
	window.__props = drive;
	v.scene.add(set);
	// the film shows a set only in the shots that name it (src/lib/film/index.js); its trucks are drawn by the library,
	// not in the set, so they are put away while it is hidden, and the next shot that shows it drives them back
	const away = new v.THREE.Matrix4().makeScale(0, 0, 0);
	(window.__sets ??= {})['tired-land'] = {
		get visible() {
			return set.visible;
		},
		set visible(on) {
			set.visible = on;
			if (!on) for (const t of trucks) v.library.assets.move(t, away);
		}
	};
	return v.library.ready?.();
}

export const sets = { 'tired-land': tiredLand };
