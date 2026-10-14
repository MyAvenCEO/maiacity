/*
 * THE MACHINES — everything we build that works by moving parts, as the Machines gallery (/app/machines/) lists it:
 * the excavators, the pod and the forklift that loads it, Open Source Ecology's LifeTrac and Power Cube, and our own
 * ElectroCube, BatteryCube and BatteryPack — each kind with its variants and its versions. They are rigged like the
 * people and animals (a bone and a card for every part, $lib/actors/rig.ts) and built beside them in $lib/actors, where
 * the games import them from; this list only gathers them apart from the Actors (/app/actors/: people and animals).
 */
import { crawlerExcavator } from '$lib/actors/crawler-excavator.js';
import { miniExcavator } from '$lib/actors/excavator.js';
import { excavator as excavatorV1 } from '$lib/actors/excavator.v1.js';
import { excavator as excavatorV2 } from '$lib/actors/excavator.v2.js';
import { pod } from '$lib/actors/pod.js';
import { pod as podV1 } from '$lib/actors/pod.v1.js';
import { pod as podV2 } from '$lib/actors/pod.v2.js';
import { pod as podV3 } from '$lib/actors/pod.v3.js';
import { pod as podV4 } from '$lib/actors/pod.v4.js';
import { forklift } from '$lib/actors/forklift.js';
import { lifetrac } from '$lib/actors/lifetrac.js';
import { powerCube } from '$lib/actors/powercube.js';
import { electroCube } from '$lib/actors/electrocube.js';
import { batteryCube } from '$lib/actors/batterycube.js';
import { batteryCube as batteryCubeV1 } from '$lib/actors/batterycube.v1.js';
import { batteryPack } from '$lib/actors/batterypack.js';
import { batteryPack as batteryPackV1 } from '$lib/actors/batterypack.v1.js';
import { FIRST, versioned } from '$lib/app/versions.js';

/** @typedef {import('$lib/actors').Actor} Actor */
/** @typedef {import('$lib/actors').Family} Family */

/** the kinds' older versions, by id, each with its frozen variants (the rest are at v1)
 * @type {Record<string, (import('$lib/app/versions.js').Change & { build?: Actor[] })[]>} */
const HISTORY = {
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
	electrocube: [
		{ ...FIRST, date: '2026-10-13', build: [{ id: 'electrocube', label: 'ElectroCube', note: 'as at v1: a classic alternator, 35" (0.9 m) long', make: () => electroCube(1) }] },
		{ v: 2, date: '2026-10-13', note: 'The same 27" size as every other cube (686 × 660 × 686 mm): a flat axial-flux generator, under 10 cm long, on the engine’s shaft where the pump was, and a power converter on the back that makes clean 400 V and 230 V at 50 Hz from it' }
	],
	batterycube: [
		{ ...FIRST, date: '2026-10-13', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v1: busbars down the front, a one-way inverter', make: () => batteryCubeV1() }] },
		{ v: 2, date: '2026-10-13', note: 'Plug in and pull out: a backplane behind the stack takes each BatteryPack’s (v3) back plug, and a ClickLock rail pair holds each pack; no busbars on the front', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v2: a one-way inverter', make: () => batteryCube(2) }] },
		{ v: 3, date: '2026-10-13', note: 'A charger too: the inverter is bidirectional, and an AC inlet on its back charges the packs from the grid, an ElectroCube or a generator', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v3: its packs with two handles each', make: () => batteryCube(3) }] },
		{ v: 4, date: '2026-10-13', note: 'Its four BatteryPacks at v4: one centre grip each, its trigger releasing the pack', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v4: no pull-out move', make: () => batteryCube(4) }] },
		{ v: 5, date: '2026-10-13', note: 'Pull out as a move: a hand squeezes the third pack’s grip, it slides 36 cm out on its rails, waits, slides back and clicks home; and a “pulled out” pose', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v5: its packs at v4, their plugs’ pins on the pack', make: () => batteryCube(5) }] },
		{ v: 6, date: '2026-10-13', note: 'Its four BatteryPacks at v5 (the grip low, the lock at its height), its rails raised to meet their pawls, and pins on the backplane: two pointed guide pins, two power pins and four data pins per pack, going into the pack’s holes', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v6: its packs at v5, a lid each', make: () => batteryCube(6) }] },
		{ v: 7, date: '2026-10-13', note: 'Its four BatteryPacks at v6: each a closed shell with a service drawer inside; their lock’s keepers moved to meet the pawls on the drawers’ front plates', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v7: its packs at v6', make: () => batteryCube(7) }] },
		{ v: 8, date: '2026-10-13', note: 'Its four BatteryPacks at v7 (grip, lock and release buttons at the base plate’s level), its rails lowered to meet their pawls; every live backplane pin sunk 5 mm in an insulating collar, finger-safe', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v8: its packs at v7, the data pins over the power pins', make: () => batteryCube(8) }] },
		{ v: 9, date: '2026-10-13', note: 'Its four BatteryPacks at v8 (grip, lock and release buttons on the shell’s foot), its rails lower to meet their pawls; every pin of a header in one straight line: guide, power, data, power, guide', build: [{ id: 'batterycube', label: 'BatteryCube', note: 'as at v9: its packs’ release buttons in the sill', make: () => batteryCube(9) }] },
		{ v: 10, date: '2026-10-13', note: 'Its four BatteryPacks at v9: each one’s release buttons in its shell’s two front corner columns, at the base plate’s level' }
	],
	batterypack: [
		{ ...FIRST, date: '2026-10-13', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v1: a square case, five charge lights', make: () => batteryPackV1() }] },
		{ v: 2, date: '2026-10-13', note: 'Smooth and modern: one matte black case with round corners (R 30 mm), a soft-edged lid, a light seam under it, a darker foot band, flush latches, and a slim LED strip along the top of its face that shows the state of charge in ten segments. Same 460 × 480 × 125 mm', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v2: its terminals still on its face', make: () => batteryPack(2) }] },
		{ v: 3, date: '2026-10-13', note: 'Plug in, pull out: power and data leave by one blind-mate plug in its back, between two guide pins (no terminals on its face), and a ClickLock clicks it into its rails; press the tab on its face and it slides out', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v3: two handles and a release tab', make: () => batteryPack(3) }] },
		{ v: 4, date: '2026-10-13', note: 'One grip for one hand, in the middle of its face, in place of the two handles: its trigger releases the ClickLock, so one squeeze and one pull take the pack out, and pushing it in clicks it home', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v4: the grip in the middle, pins on its back', make: () => batteryPack(4) }] },
		{ v: 5, date: '2026-10-13', note: 'The grip low on its face, near the case’s foot, its trigger at the very height of the ClickLock’s pawls, so the two release cables run straight to them; and its back plug as a flush socket of proper holes (two lined guide holes, two power and four data sockets) for the cube’s pins: nothing sticks out of its back', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v5: a lid on four latches', make: () => batteryPack(5) }] },
		{ v: 6, date: '2026-10-13', note: 'Serviceable from the front: a closed shell (no lid, no latches) and one L-shaped service drawer, its front plate the pack’s face and its base plate carrying every inner part (holders, cells, contact plates, a clamp in place of the lid’s pad, the BMS and an inner plug). Press the two push buttons in the shell’s sides, pull the grip, and the whole inside slides out; a “service” move plays it, and a “drawer out” pose holds it', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v6: release buttons in the shell’s sides', make: () => batteryPack(6) }] },
		{ v: 7, date: '2026-10-13', note: 'Everything from the front and low: the grip and the ClickLock down at the base plate’s level (bar 28 mm, lock 20 mm over the foot), and the drawer’s two release buttons on the face’s left and right ends at the same level, each pulling its spring catch in by a short rod; its back socket’s contacts sit in pockets that take the cube’s pin collars', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v7: grip and buttons on the drawer’s front plate', make: () => batteryPack(7) }] },
		{ v: 8, date: '2026-10-13', note: 'What you hold and press is the shell’s: a foot (floor tub and a 20 mm sill across the face) carries the grip, the ClickLock and the two release buttons at its outer ends, and the drawer’s catches; the drawer rides on the foot and carries only the insides, pulled by a finger slot under its face; the back socket’s holes in one line', build: [{ id: 'batterypack', label: 'BatteryPack', note: 'as at v8: release buttons in the sill’s outer ends', make: () => batteryPack(8) }] },
		{ v: 9, date: '2026-10-13', note: 'The release mechanism in the shell’s two front corner columns: each column stands up to the base plate’s top, a release button in its face at the base plate’s level and the drawer’s catch inside it, a spring bolt that shoots sideways into a notch in the base plate’s edge. The base plate runs between the columns and the cells’ holders pass over them (a taller column would stop the drawer coming out)' }
	],
	excavator: [
		{ ...FIRST, build: [{ id: 'excavator', label: 'Mini excavator', note: 'yellow, an open canopy, a 40 cm bucket', make: () => excavatorV1() }] },
		{ v: 2, date: '2026-10-06', note: 'Twice the size; the bucket turned round, its mouth and teeth towards the machine as a backhoe’s are', build: [{ id: 'excavator', label: 'Excavator', note: 'yellow, an open canopy, an 80 cm backhoe bucket', make: () => excavatorV2() }] },
		{ v: 3, date: '2026-10-06', note: 'Two machines: a 14-tonne crawler excavator built as one (steel tracks, an enclosed cab, a mono boom on two rams, no blade), and the mini back at its own size' }
	]
};

/** @type {Omit<Family, 'versions' | 'version'>[]} */
const LIST = [
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
		note: 'Our own cube on Open Source Ecology’s Power Cube frame: the same 28 hp V-twin, tank and battery, a flat axial-flux ~15 kW generator on its shaft where the hydraulics were, a power converter, breakers and sockets on the back; a 27" cube like every other. Every part its own',
		from: 'Our design, on the Power Cube of Open Source Ecology',
		variants: [{ id: 'electrocube', label: 'ElectroCube', note: 'about 15 kVA at 400 V three-phase and 230 V, a 28 hp petrol V-twin, 0.69 × 0.69 × 0.66 m, the size of every cube', make: () => electroCube() }]
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

/** @type {Family[]} */
export const MACHINES = versioned(LIST, 'variants', HISTORY);
