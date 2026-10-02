// @ts-nocheck — three.js scene building through window.__world (Sandbox 4), as the shot lists always did
// Sets for the film, built into Sandbox 4's scene while it is filmed (never in the game itself). A shot names its set
// (world.props: 'tired-land'); the film camera (src/lib/film) builds it once, then moves what moves on the world's
// own clock (`window.__props(clock)`), so a truck is exactly where the shot expects it at every frame.
// Its randomness is seeded (the shot's world.seed): the same fields every time.
import { buildTiredLand } from '../worlds/tiredLandSet.js';

/** The tired land (src/lib/worlds/tiredLandSet.js), built into Sandbox 4's scene for the shots that name it. */
export function tiredLand(seed = 1) {
	if (window.__props) return;
	const v = window.__world ?? window.__village;
	const { set, drive } = buildTiredLand(seed);
	window.__props = drive;
	v.scene.add(set);
	// the film shows a set only in the shots that name it (src/lib/film/index.js)
	(window.__sets ??= {})['tired-land'] = set;
}

export const sets = { 'tired-land': tiredLand };
