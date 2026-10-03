/*
 * THE ACTORS — everyone and everything rigged to move, as the Actors gallery (/app/actors/) lists it: the stand-in a
 * shot is blocked with, and the animals of the worlds, every breed of them. Each is built by a function that hands
 * back its rig (./rig.ts), its moves (clips) and, for the stand-in, its poses. An animal is its species' (./species/,
 * on its body plan in ./plans/) and a line in ./casts.ts; it shows here with a line below.
 */
import { prepare } from './build';
import { CASTS } from './casts';
import { human } from './human';
import type { Cast } from './rig';

export type Actor = { id: string; label: string; note: string; from: string; make: () => Cast; ready?: () => Promise<void> };

const COOPS = 'Sandbox 4: the coops round the squares';
const animal = (id: string, label: string, note: string, from: string): Actor => ({ id, label, note, from, make: CASTS[id]!, ready: () => prepare(id) });

export const ACTORS: Actor[] = [
	{ id: 'stand-in', label: 'Stand-in', note: 'a person of 1.70 m, bald, rigged head to toe — 17 bones under one skin, any pose, any move', from: 'the room: Day 01, Day 02', make: () => human() },
	animal('chicken-red', 'Hen, red', 'a brown layer, chestnut with gold hackles: walks with her head held still, pecks, scratches, flaps', COOPS),
	animal('chicken-leghorn', 'Hen, Leghorn', 'white, her big single comb flopped over, white earlobes, yellow legs', COOPS),
	animal('chicken-australorp', 'Hen, Australorp', 'black with a green sheen, slate legs', COOPS),
	animal('chicken-barred', 'Hen, barred Rock', 'grey and white in bars across every feather', COOPS),
	animal('chicken-buff', 'Hen, buff Orpington', 'golden, fluffed up big, pale legs', COOPS),
	animal('chicken-speckled', 'Hen, speckled Sussex', 'mahogany, every feather tipped white', COOPS),
	animal('chicken-rooster', 'Rooster', 'red and gold over a black-green breast, a tall comb, sickle feathers arching over his tail: one to each run', COOPS),
	animal('chicken-chick', 'Chick', 'a yellow ball of down at the hens’ feet', COOPS),
	animal('rabbit-wild', 'Rabbit, wild agouti', 'grey-brown ticked, white beneath: sits hunched on its long hind feet, hops in a half-bound, nibbles, sits up to look', 'Sandbox 4: the hutches between the coops'),
	animal('rabbit-dutch', 'Rabbit, Dutch', 'a white blaze, collar and forefeet, the rest black', 'Sandbox 4: the hutches between the coops'),
	animal('rabbit-lop', 'Rabbit, lop', 'fawn, its ears hanging beside its face', 'Sandbox 4: the hutches between the coops'),
	animal('rabbit-white', 'Rabbit, white', 'white, pink-eyed', 'Sandbox 4: the hutches between the coops'),
	animal('rabbit-black', 'Rabbit, black', 'black all over', 'Sandbox 4: the hutches between the coops'),
	animal('rabbit-fawn', 'Rabbit, fawn', 'sandy, its ears up', 'Sandbox 4: the hutches between the coops'),
	animal('goose-embden', 'Goose, Embden', 'white, a long neck in three bones held in an S: waddles, grazes, hisses with its wings out', 'Sandbox 4: along the streams'),
	animal('goose-toulouse', 'Goose, Toulouse', 'grey, barred on the wings, white beneath', 'Sandbox 4: along the streams'),
	animal('goose-chinese', 'Goose, Chinese', 'fawn and white, a dark stripe down its neck, the knob on its bill', 'Sandbox 4: along the streams'),
	animal('goat-saanen', 'Goat, Saanen', 'white, hornless, a beard: walks with its hooves set down, grazes, looks round, the tail flicking', 'Sandbox 4: the forest'),
	animal('goat-alpine', 'Goat, Alpine', 'bay with a black stripe down its back, black legs and face stripes, horns', 'Sandbox 4: the forest'),
	animal('goat-pied', 'Goat, pied', 'white in patches of brown and black, horns', 'Sandbox 4: the forest'),
	animal('goat-nubian', 'Goat, Nubian', 'red-tan, a Roman nose, long hanging ears', 'Sandbox 4: the forest'),
	animal('goat-boer', 'Goat, Boer', 'white with a red-brown head, heavy, horns sweeping back', 'Sandbox 4: the forest'),
	animal('sheep-whiteface', 'Sheep, whiteface', 'a lumpy fleece in one skin, a white face, pricked ears: walks, grazes, looks up', 'Sandbox 4: grazing between the domes; the island’s meadows'),
	animal('sheep-suffolk', 'Sheep, Suffolk', 'black face and legs, long black ears', 'Sandbox 4: grazing between the domes; the island’s meadows'),
	animal('sheep-merino', 'Sheep, merino', 'a heavy crimped fleece down its legs and over its brow', 'Sandbox 4: grazing between the domes; the island’s meadows'),
	animal('sheep-black', 'Sheep, black', 'one in every flock', 'Sandbox 4: grazing between the domes; the island’s meadows'),
	animal('sheep-shorn', 'Sheep, shorn', 'a ewe just clipped, her shape showing', 'Sandbox 4: grazing between the domes; the island’s meadows'),
	animal('frog-bullfrog', 'Frog, bullfrog', 'its legs folded in a Z: sits, its throat pulsing, croaks with a swelling sac, leaps', 'Sandbox 4: the ponds'),
	animal('frog-green', 'Frog, green', 'a paler green bullfrog', 'Sandbox 4: the ponds'),
	animal('frog-common', 'Frog, common', 'brown and smaller, the dark mask behind its eye', 'Sandbox 4: the ponds'),
	animal('bee', 'Bee', '1.5 cm, striped, furred, pollen in its baskets: hovers, flies, its wings beating in a figure of eight', 'Sandbox 4: the hives and the flowers'),
	animal('fish-koi', 'Koi, orange', 'a wave down its body, a beat of the tail for every length swum: swims, turns, hangs sculling', 'Sandbox 4: the ponds'),
	animal('fish-kohaku', 'Koi, kohaku', 'white with red', 'Sandbox 4: the ponds'),
	animal('fish-ogon', 'Koi, ogon', 'metallic gold', 'Sandbox 4: the ponds'),
	animal('fish-carp', 'Carp', 'bronze, barbels at its mouth', 'Sandbox 4: the ponds'),
	animal('fish-nile', 'Tilapia, Nile', 'grey-green and barred, its tail edged red', 'Sandbox 4: the aquaponics tanks'),
	animal('fish-redtilapia', 'Tilapia, red', 'pink-orange', 'Sandbox 4: the aquaponics tanks')
];
