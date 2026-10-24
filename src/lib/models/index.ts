/*
 * THE MODELS — every reusable still model, as avenDB's Assets lists it among the Things (/app/avendb/#assets) (the containers and the wayside are the Buildings', $lib/buildings/built.js): its name, what it is, where
 * it is used, and the function that builds it (./minidomes.js, ./domerooms.js, ./village.js, ./planting.js, ./tent.js,
 * ./belltent.js, ./wayside.js, ./pallet.js; a machine that works or has moving parts is a machine, $lib/machines, and never listed here too). A world places
 * them (src/lib/worlds); a new one is a function there and a line here. Each has its version and history
 * ($lib/app/versions.js): a changed model goes up a version, its old builder kept in HISTORY below.
 */
import type * as THREE from 'three';
import { henDome, playDome, rabbitDome } from './minidomes.js';
import { VILLAGE_INFO, loadingRamp, pickup, solarPanel } from './village.js';
import { ALL_PACKETS, backpack, dugEarth, markerSticks, plantStake, seedPacket, waterBottle } from './planting.js';
import { domeTent, packedTent, storageTent, storageTentBag } from './tent.js';
import { bellTent, bellTentBag, firePlace } from './belltent.js';
import { WAYSIDE_INFO, travelVan } from './wayside.js';
import { pallet } from './pallet.js';
import { DOME_ROOMS } from './domerooms.js';
import { playground, timberCoop, timberHutch } from './timber.v1.js';
import { waterCanister } from './water-canister.js';
import { FIRST, type Version, type Change } from '$lib/app/versions.js';
import { registerAssets } from '$lib/assets/register.js';

/** a model's builder: none of its arguments, or the values of the parameters it declares, in their order */
type Make = (...args: any[]) => THREE.Object3D;
/** what a model's recipe is built with, when a world places it otherwise than as it is listed ($lib/assets/params.js):
 *  each takes its `value` when not given */
type Param = import('$lib/assets/params.js').Param;
/** one kind of a model (a small and a big excavator): the viewer shows its variants to switch between, as the Actors
 *  gallery shows a kind's breeds; `make` is the first's */
export type Variant = { id: string; label: string; note: string; make: Make };
export type Model = { id: string; label: string; note: string; usedIn: string; make: Make; variants?: Variant[]; params?: Param[]; versions: Version<Make>[]; version: number };

/** the models' older versions, by id, each with its frozen builder (the rest are at v1) */
const HISTORY: Record<string, (Change & { build?: Make })[]> = {
	'chicken-coop': [
		{ ...FIRST, build: timberCoop },
		{ v: 2, date: '2026-10-06', note: 'A mini geodesic dome: wire round its foot, clear over the run, a shingled back to roost in; perches, three nesting boxes with eggs in them' }
	],
	'rabbit-hutch': [
		{ ...FIRST, build: timberHutch },
		{ v: 2, date: '2026-10-06', note: 'A mini geodesic dome of wire on grass, a little shingled dome inside to sleep in' }
	],
	'plant-stake': [
		{ ...FIRST, date: '2026-10-14', build: () => plantStake({ name: 'Samuel', seed: 'apple' }) },
		{ v: 2, date: '2026-10-16', note: 'Built with the tree’s name and its plant (`name`, `seed`), printed on its flag: MaiaCity V1 puts one by every tree it grows; the stake itself as v1' }
	],
	backpack: [
		{ ...FIRST, date: '2026-10-14', build: () => backpack({ v: 1 }) },
		{ v: 2, date: '2026-10-14', note: 'Ten seed packets in it, one for each of V1’s ten trees: six along the front wall, four behind them standing higher, each a little in front of the one before so all ten read from above; the bottle in the corner behind' }
	],
	pickup: [
		{ ...FIRST, date: '2026-10-13', build: () => pickup({ v: 1 }) },
		{ v: 2, date: '2026-10-14', note: 'Clear glass all round and the cab inside it, seen from inside: two front seats and a bench for three behind, the dash with two gauges under their hood, a screen and four vents, the steering wheel on its column on the left, three pedals, a gear stick and the handbrake on the console, door cards with their pulls, sun visors and the mirror; and a tailgate that opens down flat, level with the bed', build: () => pickup({ v: 2 }) },
		{ v: 3, date: '2026-10-14', note: 'Four doors that open to get in: each hinged at its front edge and swinging out to about 70°, its window in its frame, its card, armrest and handles going with it; the outside mirrors on the front doors; sills under them' }
	],
	'dome-tent': [
		{ ...FIRST, date: '2026-10-14', note: 'The dome tent: 4 m across and 2 m high, its door 0.9 × 1.55 m, on a deck 5.6 m across', build: () => domeTent() },
		{ v: 2, date: '2026-10-14', note: 'The storage tent: the same dome twice the size to keep things in, 8 m across and 4 m high, 40 mm tubes, a door 1.8 m wide and 3.1 m high to carry things in, on a deck 11.2 m across' }
	],
	'tent-bag': [
		{ ...FIRST, date: '2026-10-14', note: 'The dome tent’s bag: 0.9 m long and 0.4 m thick', build: () => packedTent() },
		{ v: 2, date: '2026-10-14', note: 'The storage tent’s bag: 1 m long and 0.7 m thick, its tubes in halves' }
	],
	'bell-tent': [{ ...FIRST, date: '2026-10-14', note: 'The Buildings’ bell tent made a model in its 20 parts, pitched step by step: the groundsheet, the canvas spread, the pole walked up, the wall poles and pegs, the guy ropes, the door rolled back, the things brought in and the lantern lit' }],
	'fire-place': [{ ...FIRST, date: '2026-10-14', note: 'The bell tent’s fire place in its parts, built step by step and lit' }],
	'bell-tent-bag': [{ ...FIRST, date: '2026-10-14', note: 'The bell tent packed in its bag' }],
	playground: [
		{ ...FIRST, build: () => playground(90).group },
		{ v: 2, date: '2026-10-06', note: 'A climbing dome of round logs with a platform and a slide at its middle; the swing on an arch of logs' }
	]
};

const LIST: Omit<Model, 'versions' | 'version'>[] = [
	{ id: 'chicken-coop', label: 'Chicken coop', note: 'a mini geodesic dome of timber struts, 5.6 m across and 2.3 m high: wire round its foot, clear panels over the run, a cedar-shingled back where the hens roost; a ladder of perches, three nesting boxes on hay with the day’s eggs, a feeder and a water trough', usedIn: 'Sandbox 4', make: () => henDome().group },
	{ id: 'rabbit-hutch', label: 'Rabbit hutch', note: 'a mini geodesic dome of wire against foxes and hawks, 5.2 m across and 1.6 m high, on grass: a little shingled dome to sleep in, a hay rack, a water bowl, a hollow log to hide in', usedIn: 'Sandbox 4', make: () => rabbitDome().group },
	{ id: 'playground', label: 'Playground', note: 'about 16 m across, all wood: a sandpit ringed with stumps round a climbing dome of round logs (4.4 m across, a platform at 1.2 m, a rope net under its crown, a slide out of its side), a swing on an arch of logs, balance logs and stepping stumps', usedIn: 'Sandbox 4', make: () => playDome().group },
	{ id: 'pickup', label: 'Pickup', note: `${VILLAGE_INFO.pickup.note}. The Village COOP’s`, usedIn: 'MaiaCity V1', make: () => pickup() },
	{ id: 'loading-ramp', label: 'Loading ramp', note: 'one folding aluminium ramp, 0.86 m wide between its rails, grip bars every 10 cm, a lip to lie on the bed: up 1.16 m over 2 m, from the ground to the pickup’s bed', usedIn: 'MaiaCity V1', make: () => loadingRamp() },
	{ id: 'backpack', label: 'Backpack', note: 'a hiker’s pack of about 35 l, 32 × 22 cm and 46 cm to its rim: a drawstring collar, a lid pocket thrown back, a front pocket, mesh bottle pockets, padded back, curved shoulder straps and a hip belt; open, a 1 l water bottle and ten seed packets in it', usedIn: 'MaiaCity V1', make: () => backpack() },
	{ id: 'water-canister', label: '10 L water canister', note: 'A 10-litre drinking-water canister, 302 × 154 × 397 mm, with a handle, wide cap and sealed outlet', usedIn: 'MaiaCity V2', make: waterCanister },
	{ id: 'water-bottle', label: 'Water bottle', note: '1 l, refillable, powder-coated steel, 7.7 cm across and 30 cm to its cap’s loop; its open mouth at the top to pour from', usedIn: 'MaiaCity V1', make: () => waterBottle() },
	{
		id: 'seed-packet',
		label: 'Seed packet',
		note: 'a paper envelope of 7 × 10 cm, a few seeds in it, its fruit or nut printed on the front with its name: one for each of V1’s ten trees (apple, pear, sweet cherry, plum, apricot, quince, mulberry, walnut, sweet chestnut, hazel), and the blackcurrant it had before',
		usedIn: 'MaiaCity V1',
		make: () => seedPacket('apple'),
		variants: Object.entries(ALL_PACKETS).map(([id, p]) => ({ id: `seed-packet-${id}`, label: p.label, note: `${p.label}, ${p.latin}`, make: () => seedPacket(id) }))
	},
	{ id: 'marker-sticks', label: 'Marker sticks', note: 'two sticks of square pine, 35 cm long and 12 mm across, pointed, their tops painted orange, pushed into the ground half a metre apart', usedIn: 'MaiaCity V1', make: () => markerSticks() },
	{
		id: 'plant-stake',
		label: 'Plant stake',
		note: 'a young tree’s stake of round peeled pine, 1 m long and 32 mm thick, axe-pointed, pushed in beside the seed; on a wire tied to its top a 10 × 7 cm waxed-cloth flag printed on both sides with the tree’s name and its plant',
		usedIn: 'MaiaCity V1',
		// v2: the tree's name and its plant printed on the flag are what it is built with (v1 is Samuel's apple)
		params: [
			{ id: 'name', label: 'Name on its flag', type: 'string', value: 'Samuel' },
			{ id: 'seed', label: 'Its plant', type: 'string', value: 'apple', maxLength: 24 }
		],
		make: (name = 'Samuel', seed = 'apple') => plantStake({ name: String(name), seed: String(seed) })
	},
	{ id: 'dug-earth', label: 'Dug earth', note: 'a patch of turned soil 60 cm across, heaped a little, crumbs and clods on it, a hollow for the seed; it darkens and shines as it is watered', usedIn: 'MaiaCity V1', make: () => dugEarth() },
	{
		id: 'dome-tent',
		label: 'Storage tent',
		note: 'the dome tent twice the size, to keep things in (and later taken to the tribe camp): a geodesic dome 8 m across and 4 m high, its frame of 40 mm steel tubes on hub plates (4-frequency, the tubes 1.02 – 1.3 m long, each in two halves), a canvas cover over it and a door panel 1.8 m wide and 3.1 m high zipped in, a round groundsheet under it, a lamp hung from its top; on a timber deck 11.2 m across. It is pitched step by step: the groundsheet unrolled and its sides laid out, the frame raised ring by ring from the floor, the cover drawn up from the back over the top, the door let down',
		usedIn: 'MaiaCity V1',
		make: () => storageTent(),
		variants: [
			{ id: 'dome-tent-pitched', label: 'Pitched', note: 'standing, its door in', make: () => storageTent() },
			{ id: 'dome-tent-floor', label: 'Groundsheet down', note: 'the groundsheet unrolled and its folded sides laid out flat', make: () => storageTent({ pitch: 0.2 }) },
			{ id: 'dome-tent-rings', label: 'Frame going up', note: 'the frame raised ring by ring: the lower rings in, the next one going up', make: () => storageTent({ pitch: 0.5 }) },
			{ id: 'dome-tent-frame', label: 'Frame up', note: 'the whole frame standing, the door’s bent tube in, the lamp hung', make: () => storageTent({ pitch: 0.75 }) },
			{ id: 'dome-tent-cover', label: 'Cover going on', note: 'the cover drawn up from the back over the top', make: () => storageTent({ pitch: 0.86 }) }
		]
	},
	{
		id: 'tent-bag',
		label: 'Storage tent bag',
		note: 'the storage tent packed: a roll of olive canvas 1 m long and 0.7 m thick, two straps buckled round it and a handle on top; unrolled, what is in it lies on it: the groundsheet rolled, the cover rolled, the frame’s tubes in halves in a bundle and the hubs in a sack',
		usedIn: 'MaiaCity V1',
		make: () => storageTentBag(),
		variants: [
			{ id: 'tent-bag-rolled', label: 'Rolled', note: 'rolled up and strapped', make: () => storageTentBag() },
			{ id: 'tent-bag-open', label: 'Unrolled', note: 'its straps undone and the canvas laid out flat', make: () => storageTentBag({ open: 1 }) }
		]
	},
	{
		id: 'bell-tent',
		label: 'Bell tent',
		note: 'our bell tent: cotton canvas 4.2 m across on one centre pole 3 m high, a wall of 75 cm all round, a door 1.1 × 1.8 m whose flaps roll back to either side; ten wall poles under its eave, ten guy ropes out to pegs 1.5 m from the wall, a bathtub groundsheet zipped in. Inside two mats and sleeping bags, a crate for a table, two packs, a hurricane lantern on the pole. It is in its 20 parts: pick one for its card, show it alone, explode the tent, pitch it step by step; step inside',
		usedIn: 'MaiaCity V1',
		make: () => bellTent(),
		variants: [
			{ id: 'bell-tent-pitched', label: 'Pitched', note: 'standing, its door rolled back, the things in and the lantern lit', make: () => bellTent() },
			{ id: 'bell-tent-groundsheet', label: 'Groundsheet', note: 'the groundsheet unfolded and pegged down', make: () => bellTent({ pitch: 0.12 }) },
			{ id: 'bell-tent-canvas', label: 'Canvas spread', note: 'the canvas spread out over it, the door at the front', make: () => bellTent({ pitch: 0.2 }) },
			{ id: 'bell-tent-pole', label: 'Pole going up', note: 'the centre pole being walked upright under the canvas', make: () => bellTent({ pitch: 0.31 }) },
			{ id: 'bell-tent-pole-up', label: 'Pole up', note: 'the pole standing, the eave still hanging, the wall loose', make: () => bellTent({ pitch: 0.42 }) },
			{ id: 'bell-tent-wall', label: 'Wall pegged', note: 'the wall poles under the eave and the wall’s foot pegged out', make: () => bellTent({ pitch: 0.56 }) },
			{ id: 'bell-tent-guys', label: 'Guys out', note: 'the guy ropes run out to their pegs and tight, the door still closed', make: () => bellTent({ pitch: 0.78 }) },
			{ id: 'bell-tent-door', label: 'Door open', note: 'the door’s flaps rolled back and tied, nothing in it yet', make: () => bellTent({ pitch: 0.86 }) }
		]
	},
	{
		id: 'fire-place',
		label: 'Fire place',
		note: 'the bell tent’s fire place, in front of its door: a ring of field stones 1.2 m across round a bed of ash, four logs in a tepee, the flames and their light, two green folding camp chairs facing the fire, a woodpile of nine split logs on two bearers. In its parts, built step by step, lit or put out',
		usedIn: 'MaiaCity V1',
		make: () => firePlace(),
		variants: [
			{ id: 'fire-place-lit', label: 'Burning', note: 'built and lit', make: () => firePlace() },
			{ id: 'fire-place-laid', label: 'Laid', note: 'built, the logs over the kindling, not lit', make: () => firePlace({ lit: 0 }) },
			{ id: 'fire-place-ring', label: 'Ring of stones', note: 'the ring of stones set, nothing else yet', make: () => firePlace({ built: 0.28 }) }
		]
	},
	{
		id: 'bell-tent-bag',
		label: 'Bell tent bag',
		note: 'the bell tent packed: a roll of canvas 1.1 m long and 0.5 m thick, two straps buckled round it and a handle on top; unrolled, what is in it lies on it: the canvas folded and tied, the groundsheet rolled, the centre pole in three sections, the ten wall poles in a bundle, the pegs in a sack',
		usedIn: 'MaiaCity V1',
		make: () => bellTentBag(),
		variants: [
			{ id: 'bell-tent-bag-rolled', label: 'Rolled', note: 'rolled up and strapped', make: () => bellTentBag() },
			{ id: 'bell-tent-bag-open', label: 'Unrolled', note: 'its straps undone and the canvas laid out flat', make: () => bellTentBag({ open: 1 }) }
		]
	},
	{ id: 'solar-panel', label: 'Solar panel', note: `${VILLAGE_INFO.solar.note}. The Village COOP’s`, usedIn: 'MaiaCity V1', make: () => solarPanel() },
	{ id: 'travel-van', label: 'Travel van', note: `${WAYSIDE_INFO.van.note}. It brings every newcomer to MaiaCity`, usedIn: 'MaiaCity V1', make: () => travelVan() },
	{ id: 'euro-pallet', label: 'Euro pallet', note: 'an empty EPAL, 1200 × 800 mm and 144 mm high: five top boards on three cross boards, nine blocks under them and three bottom boards, in two woods. The machines carry it loaded (the goods pod, the forklift); a factory’s line stacks its raw material and its product on it', usedIn: 'Factories', make: () => pallet() }
];

export const MODELS: Model[] = registerAssets([...LIST, ...DOME_ROOMS], 'make', HISTORY);

