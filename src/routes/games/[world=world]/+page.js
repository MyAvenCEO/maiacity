// Every world of the registry gets its film page at /games/<sandbox>/, each prerendered (game/film/worlds.js).
import { WORLDS } from '../../../../game/film/worlds.js';

/** @type {import('./$types').EntryGenerator} */
export const entries = () => /** @type {(keyof typeof WORLDS)[]} */ (Object.keys(WORLDS)).map((world) => ({ world }));

/** @type {import('./$types').PageLoad} */
export const load = ({ params }) => ({ sandbox: params.world });
