/*
 * THE ACTORS — everyone and everything rigged to move, as the Actors gallery (/app/actors/) lists it: the stand-in a
 * shot is blocked with, and the animals of the worlds. Each is built by a function that hands back its rig (./rig.ts),
 * its moves (clips) and, for the stand-in, its poses. A new one is a function in ./human.ts or ./animals.ts and a line
 * here.
 */
import { bee, carp, frog, goat, goose, hen, sheep, tilapia } from './animals';
import { human } from './human';
import type { Cast } from './rig';

export type Actor = { id: string; label: string; note: string; from: string; make: () => Cast };

export const ACTORS: Actor[] = [
	{ id: 'stand-in', label: 'Stand-in', note: 'a person of 1.70 m, bald, rigged head to toe — 17 bones under one skin, any pose, any move', from: 'the room: Day 01, Day 02', make: () => human() },
	{ id: 'hen', label: 'Hen', note: 'scratches, walks with her head held still, pecks, flaps', from: 'Sandbox 4: the runs, under the trees', make: () => hen() },
	{ id: 'hen-brown', label: 'Hen, brown', note: 'the same hen in her brown coat', from: 'Sandbox 4: the runs, under the trees', make: () => hen('#b8703a') },
	{ id: 'goose', label: 'Goose', note: 'a long neck in three bones: waddles, grazes, hisses with its wings up', from: 'Sandbox 4: along the streams', make: () => goose() },
	{ id: 'goat', label: 'Goat', note: 'four legs in three bones each, a neck, horns, a beard: walks, grazes, looks round', from: 'Sandbox 4: the forest', make: () => goat() },
	{ id: 'sheep', label: 'Sheep', note: 'a fleece of tufts, a dark face: walks, grazes', from: 'Sandbox 2: the island’s meadows', make: () => sheep() },
	{ id: 'frog', label: 'Frog', note: 'folded legs that throw it forward: sits, croaks, hops', from: 'Sandbox 4: the ponds', make: () => frog() },
	{ id: 'bee', label: 'Bee', note: '1.5 cm, striped, four glass wings: hovers, flies', from: 'Sandbox 4: the hives and the flowers', make: () => bee() },
	{ id: 'carp', label: 'Carp', note: 'a body in four bones that waves it forward, barbels at its mouth: swims, turns', from: 'Sandbox 4: the ponds', make: () => carp() },
	{ id: 'tilapia', label: 'Tilapia', note: 'silver, barred: swims, turns', from: 'Sandbox 4: the aquaponics tanks', make: () => tilapia() }
];
