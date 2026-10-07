/*
 * THE ACTORS — everyone and everything rigged to move, as the Actors gallery (/app/actors/) lists it: the stand-in a
 * shot is blocked with, and the animals of the worlds, kind by kind — the chickens (six breeds of hen, the rooster, the
 * chick), the rabbits, the geese, the goats, the sheep, the frogs, the bee, the ants and their hill, the fish, and the
 * machines (the excavators, the pod) — each kind with its variants.
 * Each is built by a function that hands back its rig (./rig.ts), its moves (clips) and, for the stand-in, its poses.
 * An animal is its species' (./species/, on its body plan in ./plans/) and a line in ./casts.ts; it shows here with a
 * line in its kind below.
 */
import { prepare } from './build';
import { CASTS } from './casts';
import { crawlerExcavator } from './crawler-excavator.js';
import { miniExcavator } from './excavator.js';
import { excavator as excavatorV1 } from './excavator.v1.js';
import { excavator as excavatorV2 } from './excavator.v2.js';
import { human } from './human';
import { pod } from './pod.js';
import type { Cast } from './rig';
import { goat, GOAT_BREEDS } from './species/goat';
import { sheep, SHEEP_BREEDS } from './species/sheep';
import { rabbit, RABBIT_COATS } from './species/rabbit';
import { quadMoves as quadMovesV1 } from './plans/quadruped.v1';
import { goose, GOOSE_BREEDS } from './species/goose';
import { birdMoves as birdMovesV1 } from './plans/bird.v1';
import { FIRST, versioned, type Change, type Version } from '$lib/app/versions.js';

/** one actor: a breed, a coat, the stand-in */
export type Actor = { id: string; label: string; note: string; make: () => Cast; ready?: () => Promise<void> };
/** a kind of actor and its variants (the first shown first), with its version and history: a kind is versioned as a
 * whole (its species is one body plan), each version bringing the variants it made ($lib/app/versions.js) */
export type Family = { id: string; label: string; note: string; from: string; variants: Actor[]; versions: Version<Actor[]>[]; version: number };

/** a four-legged kind as it moved at v1: its breeds, grazing with the head folded back between the forelegs */
const quadV1 = <T extends string>(kind: string, ids: readonly T[], make: (id: T, moves: typeof quadMovesV1) => Cast): Actor[] =>
	ids.map((id) => ({ id: `${kind}-${id}`, label: id[0]!.toUpperCase() + id.slice(1), note: 'as at v1', make: () => make(id, quadMovesV1) }));
const GRAZE_V2 = { v: 2, date: '2026-10-06', note: 'Grazing realigned: the neck reaches forward and down, the muzzle in the grass ahead of the forefeet, the forehand tipped to it (it folded back between the forelegs)' };

/** the geese as they moved at v1 */
const GEESE_V1: Actor[] = GOOSE_BREEDS.map((id) => ({ id: `goose-${id}`, label: id[0]!.toUpperCase() + id.slice(1), note: 'as at v1', make: () => goose(id, birdMovesV1) }));

/** the kinds' older versions, by id, each with its frozen variants (the rest are at v1) */
const HISTORY: Record<string, (Change & { build?: Actor[] })[]> = {
	goose: [{ ...FIRST, build: GEESE_V1 }, { v: 2, date: '2026-10-06', note: 'Grazing with the neck stretched forward and down in one curve, the bill in the grass ahead of the feet (the head bent back under the breast); the head carried level walking, slow long looks standing' }],
	goat: [{ ...FIRST, build: quadV1('goat', GOAT_BREEDS, goat) }, GRAZE_V2],
	sheep: [{ ...FIRST, build: quadV1('sheep', SHEEP_BREEDS, sheep) }, GRAZE_V2],
	rabbit: [{ ...FIRST, build: quadV1('rabbit', RABBIT_COATS, rabbit) }, GRAZE_V2],
	excavator: [
		{ ...FIRST, build: [{ id: 'excavator', label: 'Mini excavator', note: 'yellow, an open canopy, a 40 cm bucket', make: () => excavatorV1() }] },
		{ v: 2, date: '2026-10-06', note: 'Twice the size; the bucket turned round, its mouth and teeth towards the machine as a backhoe’s are', build: [{ id: 'excavator', label: 'Excavator', note: 'yellow, an open canopy, an 80 cm backhoe bucket', make: () => excavatorV2() }] },
		{ v: 3, date: '2026-10-06', note: 'Two machines: a 14-tonne crawler excavator built as one (steel tracks, an enclosed cab, a mono boom on two rams, no blade), and the mini back at its own size' }
	]
};

const animal = (id: string, label: string, note: string): Actor => ({ id, label, note, make: CASTS[id]!, ready: () => prepare(id) });


const LIST: Omit<Family, 'versions' | 'version'>[] = [
	{
		id: 'stand-in',
		label: 'Stand-in',
		note: 'a person of 1.70 m, bald, rigged head to toe — 17 bones under one skin, any pose, any move',
		from: 'the room: Day 01, Day 02',
		variants: [{ id: 'stand-in', label: 'Stand-in', note: 'a person of 1.70 m', make: () => human() }]
	},
	{
		id: 'chicken',
		label: 'Chicken',
		note: 'six breeds of hen, the rooster and a chick: walks with the head held still, pecks, scratches, flaps',
		from: 'Sandbox 3: the coops round the squares',
		variants: [
			animal('chicken-red', 'Red hen', 'a brown layer, chestnut with gold hackles, her tail dark'),
			animal('chicken-leghorn', 'Leghorn', 'white, her big single comb flopped over, white earlobes, yellow legs'),
			animal('chicken-australorp', 'Australorp', 'black with a green sheen, slate legs'),
			animal('chicken-barred', 'Barred Rock', 'grey and white in bars across every feather'),
			animal('chicken-buff', 'Buff Orpington', 'golden, fluffed up big, pale legs'),
			animal('chicken-speckled', 'Speckled Sussex', 'mahogany, every feather tipped white'),
			animal('chicken-rooster', 'Rooster', 'red and gold over a black-green breast, a tall comb, sickle feathers arching over his tail: one to each run'),
			animal('chicken-chick', 'Chick', 'a yellow ball of down at the hens’ feet')
		]
	},
	{
		id: 'rabbit',
		label: 'Rabbit',
		note: 'six coats: sits hunched on its long hind feet, hops in a half-bound, nibbles, sits up to look',
		from: 'Sandbox 3: the hutches between the coops',
		variants: [
			animal('rabbit-wild', 'Wild agouti', 'grey-brown ticked, white beneath, the tail white below'),
			animal('rabbit-dutch', 'Dutch', 'a white blaze, collar and forefeet, the rest black'),
			animal('rabbit-lop', 'Lop', 'fawn, its ears hanging beside its face'),
			animal('rabbit-white', 'White', 'white, pink-eyed'),
			animal('rabbit-black', 'Black', 'black all over'),
			animal('rabbit-fawn', 'Fawn', 'sandy, its ears up')
		]
	},
	{
		id: 'goose',
		label: 'Goose',
		note: 'a long neck in three bones held in an S: waddles, grazes, hisses with its wings out',
		from: 'Sandbox 3: along the streams',
		variants: [
			animal('goose-embden', 'Embden', 'white'),
			animal('goose-toulouse', 'Toulouse', 'grey, barred on the wings, white beneath'),
			animal('goose-chinese', 'Chinese', 'fawn and white, a dark stripe down its neck, the knob on its bill')
		]
	},
	{
		id: 'goat',
		label: 'Goat',
		note: 'five breeds: walks with its hooves set down, grazes, looks round, the tail flicking',
		from: 'Sandbox 3: the forest',
		variants: [
			animal('goat-saanen', 'Saanen', 'white, hornless, a beard'),
			animal('goat-alpine', 'Alpine', 'bay with a black stripe down its back, black legs and face stripes, horns'),
			animal('goat-pied', 'Pied', 'white in patches of brown and black, horns'),
			animal('goat-nubian', 'Nubian', 'red-tan, a Roman nose, long hanging ears'),
			animal('goat-boer', 'Boer', 'white with a red-brown head, heavy, horns sweeping back')
		]
	},
	{
		id: 'sheep',
		label: 'Sheep',
		note: 'five breeds, a lumpy fleece in one skin: walks, grazes, looks up',
		from: 'Sandbox 3: grazing between the domes',
		variants: [
			animal('sheep-whiteface', 'Whiteface', 'a white face, pricked ears'),
			animal('sheep-suffolk', 'Suffolk', 'black face and legs, long black ears'),
			animal('sheep-merino', 'Merino', 'a heavy crimped fleece down its legs and over its brow'),
			animal('sheep-black', 'Black', 'one in every flock'),
			animal('sheep-shorn', 'Shorn', 'a ewe just clipped, her shape showing')
		]
	},
	{
		id: 'frog',
		label: 'Frog',
		note: 'its legs folded in a Z: sits, its throat pulsing, croaks with a swelling sac, leaps',
		from: 'Sandbox 3: the ponds',
		variants: [
			animal('frog-bullfrog', 'Bullfrog', 'olive-brown and mottled, its head green'),
			animal('frog-green', 'Green', 'a paler green bullfrog'),
			animal('frog-common', 'Common', 'brown and smaller, the dark mask behind its eye')
		]
	},
	{
		id: 'bee',
		label: 'Bee',
		note: '1.5 cm, striped, furred, pollen in its baskets: hovers, flies, its wings beating in a figure of eight',
		from: 'Sandbox 3: the hives and the flowers',
		variants: [animal('bee', 'Honeybee', 'a worker')]
	},
	{
		id: 'ant',
		label: 'Ant',
		note: 'the red wood ant, 8 mm, walking in a tripod; and its hill: a thatched mound of needles and twigs, the colony busy all over it',
		from: 'Sandbox 3: the food forest floor',
		variants: [
			animal('ant-hill', 'Ant hill', 'a mound of needles, twigs and bark half a metre high, its doors all over it, eighty ants going round it and out'),
			animal('ant', 'Wood ant', 'a worker: red-brown head and thorax, the black shining gaster, elbowed antennae')
		]
	},
	{
		id: 'songbird',
		label: 'Songbirds',
		note: 'five birds of the garden and the forest edge, 14–25 cm: they fly in bounds, hop with both feet, peck, sing on a perch with the bill opening through each phrase, and sit',
		from: 'Sandbox 4: in the trees and on the forest floor',
		variants: [
			animal('bird-robin', 'Robin', 'olive-brown, the face and breast orange-red edged grey'),
			animal('bird-blackbird', 'Blackbird', 'the male: black, his bill and eye-ring yellow-orange'),
			animal('bird-greattit', 'Great tit', 'a black head and white cheeks, a yellow breast with its black stripe, a green back'),
			animal('bird-sparrow', 'House sparrow', 'the male: a grey crown, chestnut nape and black bib, his back streaked'),
			animal('bird-chaffinch', 'Chaffinch', 'the male: a blue-grey crown, a rusty-pink breast, two white bars on black wings')
		]
	},
	{
		id: 'fish',
		label: 'Fish',
		note: 'a wave down the body, a beat of the tail for every length swum: swims, turns, hangs sculling',
		from: 'Sandbox 3: the ponds and the aquaponics tanks',
		variants: [
			animal('fish-koi', 'Koi, orange', 'in the ponds'),
			animal('fish-kohaku', 'Koi, kohaku', 'white with red, in the ponds'),
			animal('fish-ogon', 'Koi, ogon', 'metallic gold, in the ponds'),
			animal('fish-carp', 'Carp', 'bronze, barbels at its mouth, in the ponds'),
			animal('fish-nile', 'Nile tilapia', 'grey-green and barred, its tail edged red, in the tanks'),
			animal('fish-redtilapia', 'Red tilapia', 'pink-orange, in the tanks')
		]
	},
	{
		id: 'excavator',
		label: 'Excavator',
		note: 'tracked diggers, each rigged: the house slews, boom, arm and bucket work on their rams, the wheels turn; they dig, slew and dump, drive, and the mini dozes with its blade',
		from: 'Sandbox 1: building the settlement',
		variants: [
			{ id: 'excavator-small', label: 'Small · 1.7 t', note: 'a mini excavator: rubber tracks, an open canopy, a dozer blade, a swinging boom, a 40 cm bucket', make: () => miniExcavator() },
			{ id: 'excavator-big', label: 'Big · 14 t', note: 'a crawler excavator: steel tracks, an enclosed cab, a mono boom on two rams, a 1 m bucket, 8.3 m reach', make: () => crawlerExcavator() }
		]
	},
	{
		id: 'pod',
		label: 'Pod',
		note: 'the mini transporter: autonomous and electric, no front and no back, 4 m long so three fill a 40 ft container, as wide and high as one; all four wheels steer, white lamps lead and red trail either way',
		from: 'Sandbox 5: between the hexes and through the tunnels',
		variants: [
			{ id: 'pod-people', label: 'People', note: 'eight seats on two benches facing each other, double doors both sides, and the bay under the floor the whole length, open at both ends for pushing goods in', make: () => pod('people') },
			{ id: 'pod-goods', label: 'Goods', note: 'one hold the full height from a low floor, 2 m inside, barn doors over both ends as a container has', make: () => pod('goods') }
		]
	}
];

export const FAMILIES: Family[] = versioned(LIST, 'variants', HISTORY);
