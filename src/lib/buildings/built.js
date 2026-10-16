/*
 * THE BUILDINGS BUILT AS ONE OBJECT — the shipping containers fitted out as the crew's kitchen, workshop, power and
 * washroom (Sandbox 1's, $lib/models/containers.js) and the wayside of MaiaCity V1 ($lib/models/wayside.js): each
 * made by a builder that hands back one three.js object, so each is a recipe of the `buildings` group the asset box
 * builds ($lib/assets/groups.js), `buildings/container-kitchen@1`, and the Buildings viewer (/app/buildings/) shows
 * it from the box like any thing or machine. The tents and domes are not here: each is a world in disguise (Sandbox
 * 3's interiors, $lib/sandbox-2/interior, a sky, lamps, animals and a forest of its own), built by that world's code
 * (./inside.js); ./index.js lists them all.
 *
 * Each has its version and history ($lib/app/versions.js): a changed building goes up a version, its old builder kept
 * in HISTORY below (all at v1 so far).
 */
import { kitchenContainer, sanitaryContainer, techContainer, workshopContainer } from '$lib/models/containers.js';
import { WAYSIDE_INFO, busStop, gasStation, maiaCentre, oldShed, villageStore } from '$lib/models/wayside.js';
import { versioned } from '$lib/app/versions.js';

/** @typedef {import('$lib/models').Model} Model */

/**
 * the buildings' older versions, by id, each with its frozen builder (none yet: every one is at v1)
 * @type {Record<string, (import('$lib/app/versions.js').Change & { build?: () => import('three').Object3D })[]>}
 */
const HISTORY = {};

/** the shipping containers, fitted out to walk in */
/** @type {Omit<Model, 'versions' | 'version'>[]} */
const CONTAINER_LIST = [
	{ id: 'container-kitchen', label: 'Kitchen container', note: "a 40' high cube (12.19 × 2.44 × 2.90 m) fitted as the crew's central kitchen: six-burner range under its hood, combi steamer, sinks, dishwasher, fridges and freezer, the serving hatch — and the pantry behind a partition. Walk in", usedIn: 'Sandbox 1', make: () => kitchenContainer() },
	{ id: 'container-workshop', label: 'Workshop container', note: "the workshop: a 4 m bench under a pegboard of hand tools, timber rack, pillar drill, grinder, mitre saw, table saw, welder, compressor, cordless tools in their cases, spades, ladder, wheelbarrow; a mixer outside. Walk in", usedIn: 'Sandbox 1', make: () => workshopContainer() },
	{ id: 'container-tech', label: 'Tech container', note: "28 solar panels (about 11 kWp) on the roof and fold-out wings, 40 kWh of batteries, inverters, a hydrogen fuel cell and electrolyser, Starlink, and the AI server room behind glass. Walk in", usedIn: 'Sandbox 1', make: () => techContainer() },
	{ id: 'container-sanitary', label: 'Sanitary container', note: 'washing machines and dryers, three washbasins, three showers and three toilets in cubicles, the hot-water heat pump; a rainwater tank outside. Walk in', usedIn: 'Sandbox 1', make: () => sanitaryContainer() }
];
/** @type {Model[]} */
export const CONTAINERS = versioned(CONTAINER_LIST, 'make', HISTORY);

/** the wayside of MaiaCity V1: buildings on the dusty highway and at the village centre, and the places they make together */
/** @type {(Omit<Model, 'versions' | 'version'> & { group: string })[]} */
const WAYSIDE_LIST = [
	{ id: 'bus-stop', label: 'Bus stop', group: 'Wayside', note: `${WAYSIDE_INFO.busStop.note}. Where every newcomer steps off`, usedIn: 'MaiaCity V1', make: () => busStop() },
	{ id: 'gas-station', label: 'Abandoned gas station', group: 'Wayside', note: `${WAYSIDE_INFO.gasStation.note}. The old world, left behind at the city's centre`, usedIn: 'MaiaCity V1', make: () => gasStation() },
	{ id: 'old-shed', label: 'Old shed', group: 'Wayside', note: WAYSIDE_INFO.shed.note, usedIn: 'MaiaCity V1', make: () => oldShed() },
	{ id: 'maia-centre', label: 'MaiaCity centre', group: 'Places', note: 'the centre of the city plot today, where the sand highway ends: the abandoned gas station at the road’s end, the bus stop, the travel van pulling in. Where the story starts', usedIn: 'MaiaCity V1', make: () => maiaCentre() },
	{ id: 'village-store', label: 'Village store', group: 'Places', note: "the village centre's future storage area: the broken shed with the powercube inside, the solar row and the battery beside it. All the Village COOP's", usedIn: 'MaiaCity V1', make: () => villageStore() }
];
/** @type {(Model & { group: string })[]} */
export const WAYSIDE = versioned(WAYSIDE_LIST, 'make', HISTORY);

/** every building built as one object, in the viewer's order: the `buildings` group's recipes */
export const BUILT = [...CONTAINERS, ...WAYSIDE];
