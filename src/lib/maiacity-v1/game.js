// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MaiaCity V1 as its game screen plays it (./Game.svelte): its rules, its link to the server, its story and its world,
 * and what of the screen is its own. V2 hands the same screen its own (../maiacity-v2/game.js).
 */
import * as engine from '../../../game/maiacity-v1/engine.js';
import * as store from './store.js';
import * as tour from './tour.js';
import { reelFor } from './intro.js';
import { treeNow } from './trees.js';
import { plantOf } from './plants.js';
import { screenDataOf } from './screen.js';
import { createWorld } from './world.js';

export default {
	id: 'maiacity-v1',
	label: 'V1',
	/** under the title while the game opens */
	tagline: 'One hex, one tent, two players',
	engine,
	store,
	tour,
	reelFor,
	treeNow,
	plantOf,
	screenDataOf,
	createWorld,
	/** where this browser keeps how far each seat's story is told */
	storyKey: 'v1-story',
	/** the rent chain of a week, payer to payee: player → Tribe → Village → MaiaCity (engine.js rents) */
	chain: ['players', 'coop:tribe', 'coop:village', 'coop:maia'],
	/** proposals are made by agents through the MCP for now (Samuel 2026-10-20): the game only links to the AIPs app */
	proposals: null,
	/** the first tree is watered from the backpack's bottle, once a game month (V2: from the shared can) */
	care: 'bottle',
	/** how often the page reads the game again, ms */
	refreshMs: 10000
};
