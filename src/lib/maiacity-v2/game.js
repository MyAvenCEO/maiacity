// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V2 as V1's game screen (../maiacity-v1/Game.svelte) plays it: V2's rules, its link to the server, its story
 * and its world (V1's, with V2's edition), its own Proposals page, the shared water can and the touch stick.
 */
import * as engine from '../../../game/maiacity-v2/engine.js';
import * as store from './store.js';
import * as tour from './tour.js';
import { reelFor } from './intro.js';
import { treeNow } from './trees.js';
import { plantOf } from './plants.js';
import { screenDataOf } from './screen.js';
import { createWorld } from './world.js';

export default {
	id: 'maiacity-v2',
	label: 'V2',
	tagline: 'One hex, one tent, three players',
	engine,
	store,
	tour,
	reelFor,
	treeNow,
	plantOf,
	screenDataOf,
	createWorld,
	storyKey: 'v2-story',
	/** a game forked from V1 reads V1's story where V2 has none yet */
	storyFallback: 'v1-story',
	/** player → Village → MaiaCOOP */
	chain: ['players', 'coop:village', 'coop:maia'],
	/** V2's own Proposals page: proposals made and signed there, a payout filled in from a COOP's card */
	proposals: (base, draft) => `${base}/app/maiacity-v2/proposals/?game=maiacity-v2${draft ? `&new=1${draft.from ? `&from=${encodeURIComponent(draft.from)}&to=${encodeURIComponent(draft.to)}&token=${draft.token}&amount=${draft.amount}` : ''}` : ''}`,
	/** the first tree is watered from the shared ten-litre can, once a real day; free play marks every tree */
	care: 'can',
	/** the touch stick walks and looks on a phone */
	touch: true,
	/** "Plant your tree" skips the story to the planting */
	plantShortcut: true,
	refreshMs: 3000
};
