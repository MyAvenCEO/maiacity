/*
 * THE ACTORS — everyone and everything rigged to move, as the Actors gallery (/app/actors/) lists it: the stand-in a
 * shot is blocked with, and the animals of the worlds, kind by kind — the chickens (six breeds of hen, the rooster, the
 * chick), the rabbits, the geese, the goats, the sheep, the frogs, the bee, the ants and their hill, the fish, and the
 * machines (the excavators, the pod, the forklift, the LifeTrac and its Power Cube) — each kind with its variants.
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
import { human as humanV1 } from './human.v1';
import { pod } from './pod.js';
import { pod as podV1 } from './pod.v1.js';
import { pod as podV2 } from './pod.v2.js';
import { pod as podV3 } from './pod.v3.js';
import { pod as podV4 } from './pod.v4.js';
import { forklift } from './forklift.js';
import { lifetrac } from './lifetrac.js';
import { powerCube } from './powercube.js';
import { electroCube } from './electrocube.js';
import { batteryCube } from './batterycube.js';
import { batteryCube as batteryCubeV1 } from './batterycube.v1.js';
import { batteryPack } from './batterypack.js';
import { batteryPack as batteryPackV1 } from './batterypack.v1.js';
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
	'stand-in': [
		{ ...FIRST, build: [{ id: 'stand-in', label: 'Stand-in', note: 'as at v1: bald, dark slits for eyes, a beak of a nose', make: () => humanV1() }] },
		{ v: 2, date: '2026-10-13', note: 'A face and hair: eyes with their whites, irises, pupils and a glint, lids over them, a nose with a bridge and a tip, two lips, a finer skull; and hair (short, long, a bun, or none) in its own colour' }
	],
	goose: [{ ...FIRST, build: GEESE_V1 }, { v: 2, date: '2026-10-06', note: 'Grazing with the neck stretched forward and down in one curve, the bill in the grass ahead of the feet (the head bent back under the breast); the head carried level walking, slow long looks standing' }],
	goat: [{ ...FIRST, build: quadV1('goat', GOAT_BREEDS, goat) }, GRAZE_V2],
	sheep: [{ ...FIRST, build: quadV1('sheep', SHEEP_BREEDS, sheep) }, GRAZE_V2],
	rabbit: [{ ...FIRST, build: quadV1('rabbit', RABBIT_COATS, rabbit) }, GRAZE_V2],
	pod: [
		{
			...FIRST,
			date: '2026-10-07',
			build: [
				{ id: 'pod-people', label: 'People', note: 'as at v1: eight seats, an underfloor bay open at the ends', make: () => podV1('people') },
				{ id: 'pod-goods', label: 'Goods', note: 'as at v1: barn doors at both ends', make: () => podV1('goods') }
			]
		},
		{
			v: 2,
			date: '2026-10-07',
			note: 'On rails: small flanged wheels on two axles at the very ends, the room between them to carry things; opens only to its sides; twenty seats in two compartments; the goods pod’s sides lift as wings',
			build: [
				{ id: 'pod-people', label: 'People', note: 'as at v2', make: () => podV2('people') },
				{ id: 'pod-goods', label: 'Goods', note: 'as at v2: its sides lifting as wings, roll cages in it', make: () => podV2('goods') }
			]
		},
		{
			v: 3,
			date: '2026-10-07',
			note: 'The goods pod’s doors swing open left and right, two each side; four Euro pallets in it, loaded and unloaded through them; open, close, load and unload as moves',
			build: [
				{ id: 'pod-people', label: 'People', note: 'as at v3', make: () => podV3('people') },
				{ id: 'pod-goods', label: 'Goods', note: 'as at v3: open shelves over the axles', make: () => podV3('goods') }
			]
		},
		{
			v: 4,
			date: '2026-10-07',
			note: 'The goods pod’s shelves over its axles become racks: five compartments of different heights each side, behind one tall door per rack; they open one by one as a move. Both pods: the shell’s edges and corners softly rounded as one piece, the roof sensors flush in it, the roof up to 2.59 m',
			build: [
				{ id: 'pod-people', label: 'People', note: 'as at v4', make: () => podV4('people') },
				{ id: 'pod-goods', label: 'Goods', note: 'as at v4: its pallets sliding in and out on their own', make: () => podV4('goods') }
			]
		},
		{ v: 5, date: '2026-10-07', note: 'The goods pod’s pallets are carried in and out by forklifts, one to each pallet: the Forklift actor built into its rig, driving in under the pallet, lifting it and carrying it through the doors; the pallets go out far enough to clear the doors’ swing' }
	],
	forklift: [{ ...FIRST, date: '2026-10-07' }],
	lifetrac: [{ ...FIRST, date: '2026-10-13' }],
	powercube: [{ ...FIRST, date: '2026-10-13' }, { v: 2, date: '2026-10-13', note: 'The Electric variant is its own actor now: the ElectroCube' }],
	electrocube: [{ ...FIRST, date: '2026-10-13' }],
	batterycube: [
		{ ...FIRST, date: '2026-10-13', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v1: busbars down the front, a one-way inverter', make: () => batteryCubeV1() }] },
		{ v: 2, date: '2026-10-13', note: 'Plug in and pull out: a backplane behind the stack takes each BatteryPack’s (v3) back plug, and a ClickLock rail pair holds each pack; no busbars on the front', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v2: a one-way inverter', make: () => batteryCube(2) }] },
		{ v: 3, date: '2026-10-13', note: 'A charger too: the inverter is bidirectional, and an AC inlet on its back charges the packs from the grid, an ElectroCube or a generator', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v3: its packs with two handles each', make: () => batteryCube(3) }] },
		{ v: 4, date: '2026-10-13', note: 'Its four BatteryPacks at v4: one centre grip each, its trigger releasing the pack', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v4: no pull-out move', make: () => batteryCube(4) }] },
		{ v: 5, date: '2026-10-13', note: 'Pull out as a move: a hand squeezes the third pack’s grip, it slides 36 cm out on its rails, waits, slides back and clicks home; and a “pulled out” pose' }
	],
	batterypack: [
		{ ...FIRST, date: '2026-10-13', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v1: a square case, five charge lights', make: () => batteryPackV1() }] },
		{ v: 2, date: '2026-10-13', note: 'Smooth and modern: one matte black case with round corners (R 30 mm), a soft-edged lid, a light seam under it, a darker foot band, flush latches, and a slim LED strip along the top of its face that shows the state of charge in ten segments. Same 460 × 480 × 125 mm', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v2: its terminals still on its face', make: () => batteryPack(2) }] },
		{ v: 3, date: '2026-10-13', note: 'Plug in, pull out: power and data leave by one blind-mate plug in its back, between two guide pins (no terminals on its face), and a ClickLock clicks it into its rails; press the tab on its face and it slides out', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v3: two handles and a release tab', make: () => batteryPack(3) }] },
		{ v: 4, date: '2026-10-13', note: 'One grip for one hand, in the middle of its face, in place of the two handles: its trigger releases the ClickLock, so one squeeze and one pull take the pack out, and pushing it in clicks it home' }
	],
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
		note: 'a person of 1.70 m with a face and hair, rigged head to toe — 17 bones under one skin, any pose, any move',
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
		note: 'the mini transporter: autonomous and electric on rails, no front and no back, 4 m long so three fill a 40 ft container, as wide and high as one; small wheels at the very ends, it opens only to its sides, white lamps lead and red trail either way',
		from: 'Sandbox 5: between the hexes and through the tunnels',
		variants: [
			{ id: 'pod-people', label: 'People', note: 'twenty seats in two compartments, two benches of five facing each other in each, a door each side between them; the bay under the floor between the axles, a flap on each side', make: () => pod('people') },
			{ id: 'pod-goods', label: 'Goods', note: 'four Euro pallets (1200 × 800 mm) in two rows lengthwise, carried in and out by four forklifts, each row behind two doors on its side that swing open left and right; a hold 2.2 m high; over the axles, racks of five compartments at different heights, each rack behind one tall door', make: () => pod('goods') }
		]
	},
	{
		id: 'forklift',
		label: 'Forklift',
		note: 'the pallet mover: autonomous, on a battery, as small as a machine lifting a loaded Euro pallet can be; no cab, a low body, two uprights, forks for a Euro pallet’s openings; it lifts, drives and carries, and it is built into the goods pod’s rig to load and unload it',
		from: 'Sandbox 5: loading the pods at the hubs',
		variants: [
			{ id: 'forklift', label: 'Forklift', note: '1.8 m long with its forks, 0.84 m wide, 1.23 m high; forks 0.8 m long, lifting 75 cm', make: () => forklift() },
			{ id: 'forklift-pallet', label: 'With a pallet', note: 'a loaded Euro pallet (1200 × 800 mm, cartons to 1.2 m) on its forks', make: () => forklift({ pallet: true }) }
		]
	},
	{
		id: 'lifetrac',
		label: 'LifeTrac',
		note: 'Open Source Ecology’s open-source tractor, its newest design (v25): a compact loader driven by radio, every part of it its own — tap one for its card, show it alone, watch it go on step by step or the whole machine drawn apart',
		from: 'Open Source Ecology: the Global Village Construction Set',
		variants: [{ id: 'lifetrac-v25', label: 'v25', note: 'LifeTrac v25 (2025–26): bolted plate frame, four direct-drive hydraulic wheels, loader arms, LoRa remote control, a Power Cube for its heart', make: () => lifetrac() }]
	},
	{
		id: 'powercube',
		label: 'Power Cube',
		note: 'Open Source Ecology’s hydraulic power unit, the heart of every machine of their set: an engine on a pump in a steel cube with its own tanks, cooler and couplers, lifted from one machine to the next — every part its own, as in the LifeTrac that carries one',
		from: 'Open Source Ecology: the Global Village Construction Set',
		variants: [
			{ id: 'powercube-7s', label: 'VII / 7s', note: 'Power Cube VII / 7s (v15.6, 2014–15): 28 hp Briggs & Stratton V-twin, 15.2 gpm at 3,000 psi, 27" cube, ~181 kg', make: () => powerCube() }
		]
	},
	{
		id: 'electrocube',
		label: 'ElectroCube',
		note: 'Our own cube on Open Source Ecology’s Power Cube frame: the same 28 hp V-twin, tank and battery, a brushless ~15 kVA alternator on its shaft where the hydraulics were, its regulator, breakers and sockets on the back; 27" wide and high, 35" long. Every part its own',
		from: 'Our design, on the Power Cube of Open Source Ecology',
		variants: [{ id: 'electrocube', label: 'ElectroCube', note: 'about 15 kVA at 400 V three-phase and 230 V, a 28 hp petrol V-twin, 0.69 × 0.69 × 0.9 m', make: () => electroCube() }]
	},
	{
		id: 'batterycube',
		label: 'BatteryCube',
		note: 'Our own cube on the Power Cube’s 27" frame, no engine: four BatteryPacks stacked to its top (~20.7 kWh) and each plugged into a backplane and held by a ClickLock, and a 6 kW bidirectional inverter on its back that turns their 52 V into 230 V, takes a solar panel straight in and charges them from outside power at its AC inlet. Every part its own',
		from: 'Our design, on the Power Cube of Open Source Ecology',
		variants: [{ id: 'batterycube', label: 'BatteryCube', note: '~20.7 kWh, 6 kW at 230 V both ways, an MPPT solar input, an AC inlet, 686 × 660 × 686 mm, ~140 kg', make: () => batteryCube() }]
	},
	{
		id: 'batterypack',
		label: 'BatteryPack',
		note: 'Our modular, repairable battery: 280 cylindrical 21700 cells (14S20P, 51.8 V, ~5.2 kWh) in two holder plates, copper contact plates pressed on by its lid, no welds and no glue, so every cell, plate and the BMS comes out again. Four fill a BatteryCube',
		from: 'Our design',
		variants: [{ id: 'batterypack', label: 'BatteryPack', note: '460 × 480 × 125 mm, ~26 kg, 280 cells, a charge strip on its face', make: () => batteryPack() }]
	}
];

export const FAMILIES: Family[] = versioned(LIST, 'variants', HISTORY);
