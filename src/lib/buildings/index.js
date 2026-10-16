/*
 * THE BUILDINGS — what a settlement lives and works in, as the Buildings viewer (/app/buildings/, the one asset viewer
 * $lib/assets/AssetViewer.svelte) lists it: the tent a settler starts in, the domes of a village and the factory that
 * makes their glass, and the shipping containers fitted out as the crew's kitchen, workshop, power and washroom and
 * the wayside of MaiaCity V1 (./built.js). Each stands on the same round ground (./ground.js), and is stepped inside
 * there.
 *
 * The containers and the wayside are built in the asset box, each a recipe of the `buildings` group
 * ($lib/assets/groups.js). The tent and the domes are worlds in disguise: each is Sandbox 3's interior of that kind
 * ($lib/sandbox-2/interior), built alone, without the land round it, by that world's own code (./inside.js), as
 * Sandbox 3's village builds it into its world; they stay world code until their interiors are assets of their own.
 */
import { DOMES } from '$lib/sandbox-2/interior/interior';
import { DOMES_IN_ORDER } from './domes.js';
import { CONTAINERS, WAYSIDE } from './built.js';
import { versioned } from '$lib/app/versions.js';

/** @typedef {import('$lib/sandbox-2/interior/interior').DomeKind} DomeKind */
/** @typedef {{ id: string, label: string, note: string, usedIn: string, dome: DomeKind, image: string, size: string, flora?: boolean, versions: import('$lib/app/versions.js').Version<DomeKind>[], version: number }} Dome */
/** @typedef {import('$lib/models').Model} Model */
/** @typedef {Dome | Model} Building */

/**
 * The domes' older versions, by id, as every asset keeps them ($lib/app/versions.js): all began at v1. A changed dome
 * goes up a version here, its old interior kept as its own kind of $lib/sandbox-2/interior to walk as it was.
 * @type {Record<string, (import('$lib/app/versions.js').Change & { build?: DomeKind })[]>}
 */
const HISTORY = {
	// (its first version, the glass fish tank, was never built into a world, so it is not kept)
	'dome-grand': [{ v: 2, date: '2026-10-07', note: 'A green middle, a sunken rainforest pond with a waterfall and a creek, and our real plants' }]
};

const DOME_LIST = DOMES_IN_ORDER.map((d) => ({
	id: `dome-${d.kind}`,
	label: DOMES[d.kind].label,
	note: d.text,
	usedIn: 'Sandbox 3',
	dome: d.kind,
	image: d.image,
	size: `${DOMES[d.kind].diameter} m across · ${DOMES[d.kind].people}`,
	flora: !!d.flora
}));

/** @type {Dome[]} */
const VERSIONED_DOMES = versioned(DOME_LIST, 'dome', HISTORY);

/** @type {Building[]} */
export const BUILDINGS = [...VERSIONED_DOMES, ...CONTAINERS, ...WAYSIDE];

/** @param {Building} b */
export const groupOf = (b) => ('dome' in b ? 'Tents and domes' : /** @type {any} */ (b).group ?? 'Containers');
