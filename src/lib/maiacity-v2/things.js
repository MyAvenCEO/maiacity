// @ts-nocheck — plain JS, kept loose on purpose
/*
 * MAIACITY V2'S THINGS — V1's things and measures (../maiacity-v1/things.js), each asset named by its ref as it stands
 * (V2 reads no pins), and the shared water can of V2's own.
 */
import { stakeOf, standInOf } from '../maiacity-v1/things.js';

export * from '../maiacity-v1/things.js';

/** the library's assets the world puts in, at the version each stands at */
export const THINGS = {
	water: 'things/water-canister@1',
	busStop: 'buildings/bus-stop@1',
	gasStation: 'buildings/gas-station@1',
	shed: 'buildings/old-shed@1',
	solar: 'things/solar-panel@1',
	ramp: 'things/loading-ramp@1',
	battery: 'machines/batterycube@10',
	cube: 'machines/electrocube@2',
	pickup: 'things/pickup@3',
	tent: 'things/bell-tent@1',
	fire: 'things/fire-place@1',
	bag: 'things/bell-tent-bag@1',
	pack: 'things/backpack@2',
	stake: 'things/plant-stake@2',
	earth: 'things/dug-earth@1',
	van: 'things/travel-van@1'
};

/** a tree's plant stake, its flag printed with the tree's name and its plant */
export const stakeRef = stakeOf(THINGS);

/** the people: the rigged stand-in, built with how tall they are and their look */
export const STAND_IN = 'actors/stand-in@11';
export const standInRef = standInOf(STAND_IN);
