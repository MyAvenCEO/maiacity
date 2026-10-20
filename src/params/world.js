// A world of the one registry (game/film/worlds.js): only such a segment under /games/ is a world's film page
// (/games/<sandbox>/?film&area=…); any other address there falls through to the site's own pages, as it always did.
import { isWorld } from '../../game/film/worlds.js';

/** @param {string} param @returns {param is import('../../game/film/worlds.js').Sandbox} */
export const match = (param) => isWorld(param);
