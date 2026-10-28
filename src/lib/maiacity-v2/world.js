// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V2's world is V1's (../maiacity-v1/world.js), played with V2's edition: three seats and their cast, V2's
 * things and plants at their own refs, the third settler's second tent and the shared water can, the touch stick, the
 * tree markers of free play, and V2's own cuts of the station walk, the fetch at the village and the bottle's pour.
 * The film world of /games/maiacity-v2/?film is this same world on the film's clock.
 */
import { createWorld as createV1World } from '../maiacity-v1/world.js';
import { SEATS, WATER_HOME, WATER_REACH } from '../../../game/maiacity-v2/engine.js';
import * as things from './things.js';
import { plantRef } from './plants.js';
import { CAST, SECOND_HOME } from './cast.js';

export { PLAYER_HEIGHT, wearPack } from '../maiacity-v1/world.js';

/** what of the world is V2's own */
export const EDITION = {
	seats: SEATS,
	cast: CAST,
	things,
	plantRef,
	water: { home: WATER_HOME, reach: WATER_REACH },
	shelter: SECOND_HOME,
	markers: true,
	touch: true,
	cuts: { station: true, fetchAtDoor: true, pour: true }
};

/** V2's world on a canvas: V1's createWorld with V2's edition @param {HTMLCanvasElement} canvas @param {object} [options] */
export const createWorld = (canvas, options = {}) => createV1World(canvas, { ...options, edition: EDITION });
