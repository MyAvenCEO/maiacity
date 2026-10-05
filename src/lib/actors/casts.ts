/*
 * THE CASTS — every animal by its id (its kind and its breed), each built by its species (./species/): what a world
 * asks for, what the Actors gallery lists, what a worker meshes ahead (./build.ts).
 */
import type { Cast } from './rig';
import { bee } from './species/bee';
import { ant, antHill } from './species/ant.js';
import { chicken, CHICKEN_KINDS } from './species/chicken';
import { fish, FISH_KINDS } from './species/fish';
import { frog, FROG_KINDS } from './species/frog';
import { goat, GOAT_BREEDS } from './species/goat';
import { goose, GOOSE_BREEDS } from './species/goose';
import { rabbit, RABBIT_COATS } from './species/rabbit';
import { sheep, SHEEP_BREEDS } from './species/sheep';

const each = <T extends string>(kind: string, ids: readonly T[], make: (id: T) => Cast) => Object.fromEntries(ids.map((id) => [`${kind}-${id}`, () => make(id)]));

export const CASTS: Record<string, () => Cast> = {
	...each('chicken', CHICKEN_KINDS, chicken),
	...each('goose', GOOSE_BREEDS, goose),
	...each('goat', GOAT_BREEDS, goat),
	...each('sheep', SHEEP_BREEDS, sheep),
	...each('rabbit', RABBIT_COATS, rabbit),
	...each('frog', FROG_KINDS, frog),
	...each('fish', FISH_KINDS, fish),
	bee,
	ant,
	'ant-hill': antHill
};
