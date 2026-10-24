/*
 * THE ACTORS — the people and animals rigged to move, as avenDB's Assets (/app/avendb/#assets) lists it: the stand-in a
 * shot is blocked with, and the animals of the worlds, kind by kind — the chickens (six breeds of hen, the rooster, the
 * chick), the rabbits, the geese, the goats, the sheep, the frogs, the bee, the ants and their hill, the songbirds and
 * the fish — each kind with its variants. The machines are rigged the same way and built here too (the excavators,
 * the pod, the forklift, the LifeTrac, the cubes, the BatteryPack), but listed apart, in $lib/machines.
 * Each is built by a function that hands back its rig (./rig.ts), its moves (clips) and, for the stand-in, its poses.
 * An animal is its species' (./species/, on its body plan in ./plans/) and a line in ./casts.ts; it shows here with a
 * line in its kind below.
 */
import { elderWoman } from './elder-woman.js';
import { prepare } from './build';
import { CASTS } from './casts';
import { HEIGHT, LOOK, human, type Look } from './human';
import { human as humanV1 } from './human.v1';
import { human as humanV2 } from './human.v2';
import { human as humanV3 } from './human.v3';
import { human as humanV4 } from './human.v4';
import { human as humanV5 } from './human.v5';
import { lowDetail, type Cast } from './rig';
import { goat, GOAT_BREEDS } from './species/goat';
import { sheep, SHEEP_BREEDS } from './species/sheep';
import { rabbit, RABBIT_COATS } from './species/rabbit';
import { quadMoves as quadMovesV1 } from './plans/quadruped.v1';
import { goose, GOOSE_BREEDS } from './species/goose';
import { birdMoves as birdMovesV1 } from './plans/bird.v1';
import { FIRST, type Change, type Version } from '$lib/app/versions.js';
import { registerAssets } from '$lib/assets/register.js';

/** one actor: a breed, a coat, the stand-in */
export type Actor = { id: string; label: string; note: string; make: () => Cast; ready?: () => Promise<void> };
/** a kind of actor and its variants (the first shown first), with its version and history: a kind is versioned as a
 * whole (its species is one body plan), each version bringing the variants it made ($lib/app/versions.js) */
export type Family = { id: string; label: string; note: string; from: string; params?: import('$lib/assets/params.js').Param[]; variants: Actor[]; versions: Version<Actor[]>[]; version: number };

/** a four-legged kind as it moved at v1: its breeds, grazing with the head folded back between the forelegs */
const quadV1 = <T extends string>(kind: string, ids: readonly T[], make: (id: T, moves: typeof quadMovesV1) => Cast): Actor[] =>
	ids.map((id) => ({ id: `${kind}-${id}`, label: id[0]!.toUpperCase() + id.slice(1), note: 'as at v1', make: () => make(id, quadMovesV1) }));
const GRAZE_V2 = { v: 2, date: '2026-10-06', note: 'Grazing realigned: the neck reaches forward and down, the muzzle in the grass ahead of the forefeet, the forehand tipped to it (it folded back between the forelegs)' };

/** the geese as they moved at v1 */
const GEESE_V1: Actor[] = GOOSE_BREEDS.map((id) => ({ id: `goose-${id}`, label: id[0]!.toUpperCase() + id.slice(1), note: 'as at v1', make: () => goose(id, birdMovesV1) }));

/** the kinds' older versions, by id, each with its frozen variants (the rest are at v1) */
const HISTORY: Record<string, (Change & { build?: Actor[] })[]> = {
	'stand-in': [
		{ ...FIRST, build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v1: bald, dark slits for eyes, a beak of a nose', make: () => humanV1() }] },
		{ v: 2, date: '2026-10-13', note: 'A face and hair: eyes with their whites, irises, pupils and a glint, lids over them, a nose with a bridge and a tip, two lips, a finer skull; and hair (short, long, a bun, or none) in its own colour', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v2: an egg of a skull, a small jaw ball under it', make: () => humanV2() }] },
		{ v: 3, date: '2026-10-13', note: 'A real head: one sculpted surface on a skull’s proportions (22.8 cm chin to crown, 15.4 cm across, the eyes half way down, brows, nose base and chin a third of the face apart), with a brow ridge, eye sockets, cheekbones, a square jaw 10 cm across at its angle and a chin; ears from brow to nose base; the hair one layer grown from a hairline, thin at the line and full above it', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v3: a neutral face', make: () => humanV3() }] },
		{ v: 4, date: '2026-10-13', note: 'Friendly: a soft smile (the mouth’s corners lifted, fuller lips, dimples), the cheeks lifted with it, the eyes open with the lower lids raised a little, and thin arched brows raised a little', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v4: lid pads, one flat skin colour', make: () => humanV4() }] },
		{ v: 5, date: '2026-10-13', note: 'Real and warm: each eye a glossy ball in its socket (white, iris with a darker rim, pupil, catchlight) under two curved lids with a lash line; a toned skin (warm cheeks and nose tip, the lips’ colour, light under the nose); a round nose, a fuller upper lip and a wider warm smile; a shorter chin and a softer jaw; relaxed brows; fuller hair on top; a sturdier neck', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v5: a head drawn by sums, its smile laid on', make: () => humanV5() }] },
		{ v: 6, date: '2026-10-13', note: 'A sculpted head: MakeHuman’s head and neck (CC0), a man’s or a woman’s (`face`), smoothed; eyes in its lids with a lash line of single lashes, brows of single hairs, the lips’ colour by their shape, teeth one by one and a tongue, the hair grown over the scalp from a hairline with sideburns, round the ears; and a real smile as a blend shape (`joy`): the mouth open wide, the upper teeth showing, the eyes narrowed', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v6: its smile open wide on the teeth', make: () => human({}, HEIGHT, 6) }] },
		{ v: 7, date: '2026-10-14', note: 'A warm smile in place of the open one (`joy`, its name kept): the lips stay closed, the mouth’s corners go up and wide, the cheeks lift and narrow the eyes from below', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v7: its jaw’s underside on the neck', make: () => human({}, HEIGHT, 7) }] },
		{ v: 8, date: '2026-10-14', note: 'The jaw turns with the head: the whole jaw and chin ride the head bone, and the neck blends in below them, so no edge runs from the ear to the chin when the head turns', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v8: a tiny glint in each eye, no friendly gaze', make: () => human({}, HEIGHT, 8) }] },
		{ v: 9, date: '2026-10-14', note: 'Friendlier eyes: a friendly gaze to wear all the time as its own blend shape (`friendly`: the lower lids lifted a little, the upper ones kept open, the brows raised a touch, no smile in it), and a soft catchlight on each pupil’s edge, 1.8 mm across with a lighter ring, lit a little from within so it shows at a medium close-up in any light', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v9: its back teeth left without a colour', make: () => human({}, HEIGHT, 9) }] },
		{ v: 10, date: '2026-10-15', note: 'Every tooth coloured: the two molars behind the premolars are in the teeth’s table, so no point of the skin is left without a colour (350 had none)', build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v10: one look, 1.70 m', make: () => human({}, HEIGHT, 10) }] },
		{ v: 11, date: '2026-10-16', note: 'Built with how tall it is and its look (`height`, and `face`, `skin`, `hair`, `hairColour`, `shirt`, `trousers` and the rest, as ./human.ts LOOK has them): MaiaCity V1’s players and the people in its van, each their own; as v10 otherwise, and at v10’s 1.70 m and look when given none' }
	],
	goose: [{ ...FIRST, build: GEESE_V1 }, { v: 2, date: '2026-10-06', note: 'Grazing with the neck stretched forward and down in one curve, the bill in the grass ahead of the feet (the head bent back under the breast); the head carried level walking, slow long looks standing' }],
	goat: [{ ...FIRST, build: quadV1('goat', GOAT_BREEDS, goat) }, GRAZE_V2],
	sheep: [{ ...FIRST, build: quadV1('sheep', SHEEP_BREEDS, sheep) }, GRAZE_V2],
	rabbit: [{ ...FIRST, build: quadV1('rabbit', RABBIT_COATS, rabbit) }, GRAZE_V2]
};

const animal = (id: string, label: string, note: string): Actor => ({ id, label, note, make: CASTS[id]!, ready: () => prepare(id) });

/** the stand-in's look, one parameter each after its height, in LOOK's order (./human.ts) */
const LOOK_KEYS = Object.keys(LOOK) as (keyof Look)[];
const LOOK_LABELS: Record<keyof Look, string> = { skin: 'Skin', brows: 'Brows', shirt: 'T-shirt', trousers: 'Jeans', belt: 'Belt', shoes: 'Trainers', soles: 'Soles', hair: 'Hair (none, short, long, bun)', hairColour: 'Hair colour', iris: 'Eyes', lips: 'Lips', face: 'Face (man, woman)' };
/** what the stand-in is built with from v11: its height (1.0 to 2.2 m) and its look, a colour or a word each */
const STAND_IN_PARAMS: import('$lib/assets/params.js').Param[] = [
	{ id: 'height', label: 'Height (m)', type: 'number', min: 1, max: 2.2, step: 0.01, value: HEIGHT },
	...LOOK_KEYS.map((k) => ({ id: k, label: LOOK_LABELS[k], type: 'string' as const, value: LOOK[k], maxLength: k === 'hair' || k === 'face' ? 8 : 16 }))
];
const HAIRS = ['none', 'short', 'long', 'bun'];
/** a look from the parameters after the height, in LOOK's order: a hair or a face it does not know is LOOK's */
function lookOf(given: string[]): Partial<Look> {
	const out: Record<string, string> = {};
	LOOK_KEYS.forEach((k, i) => given[i] !== undefined && (out[k] = String(given[i])));
	if (out.hair !== undefined && !HAIRS.includes(out.hair)) delete out.hair;
	if (out.face !== undefined && out.face !== 'man' && out.face !== 'woman') delete out.face;
	return out as Partial<Look>;
}

const LIST: Omit<Family, 'versions' | 'version'>[] = [
	{ id: 'elder-woman', label: 'Elder woman', note: 'An older white woman, silver-blonde hair in a bun, a friendly gaze; 1.64 m', from: 'MaiaCity V2', variants: [{ id: 'elder-woman', label: 'Third settler', note: 'Trailer 3', make: elderWoman }] },
	{
		id: 'stand-in',
		label: 'Stand-in',
		note: 'a person of 1.70 m with a face and hair, rigged head to toe — 17 bones under one skin, any pose, any move',
		from: 'the room: Day 01, Day 02',
		// v11: how tall it is and what it looks like are what it is built with (v10 and before: one look, 1.70 m)
		params: STAND_IN_PARAMS,
		variants: [{ id: 'stand-in', label: 'Stand-in', note: 'a person of 1.70 m', make: (height?: number, ...look: string[]) => human(lookOf(look), height) }]
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
	}
];

/**
 * How finely an animal is built (1: as it is; a world draws its far-off flocks at a fifth,
 * $lib/assets/render/crowd.js `FAR`): its shapes coarser and its smallest parts left off, its bones and its clips the
 * same. Every version of every kind but the stand-in takes it.
 */
const DETAIL = { id: 'detail', label: 'Detail', type: 'number', min: 0.05, max: 1, step: 0.01, value: 1 } as const;
const detailed = new WeakMap<Actor[], Actor[]>();
const withDetail = (list: Actor[]) => {
	if (!detailed.has(list)) detailed.set(list, list.map((a) => ({ ...a, make: (detail?: number) => (detail === undefined || !(detail < 1) ? a.make() : lowDetail(() => a.make(), detail)) })));
	return detailed.get(list)!;
};

export const FAMILIES: Family[] = registerAssets(LIST, 'variants', HISTORY).map((f) =>
	f.id === 'stand-in' ? f : { ...f, params: [{ ...DETAIL }], variants: withDetail(f.variants), versions: f.versions.map((v) => ({ ...v, build: withDetail(v.build) })) }
);
