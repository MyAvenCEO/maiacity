/*
 * THE BUILDINGS — what a settlement lives and works in, as the Buildings viewer (/app/buildings/) lists it: the tent a
 * settler starts in, the four domes of a village and the factory that makes their glass (Sandbox 3's, walked inside
 * with $lib/sandbox-2/DomeInterior.svelte), and the shipping containers fitted out as the crew's kitchen, workshop,
 * power and washroom (Sandbox 1's, $lib/models/containers.js, on the turntable and walked in there).
 */
import { DOMES } from '$lib/sandbox-2/interior/interior';
import { DOMES_IN_ORDER } from './domes.js';
import { CONTAINERS } from '$lib/models';
import { versioned } from '$lib/app/versions.js';

/** @typedef {import('$lib/sandbox-2/interior/interior').DomeKind} DomeKind */
/** @typedef {{ id: string, label: string, note: string, usedIn: string, dome: DomeKind, image: string, size: string, versions: import('$lib/app/versions.js').Version<DomeKind>[], version: number }} Dome */
/** @typedef {import('$lib/models').Model} Model */
/** @typedef {Dome | Model} Building */

/**
 * The domes' older versions, by id, as every asset keeps them ($lib/app/versions.js): all began at v1. A changed dome
 * goes up a version here, its old interior kept as its own kind of $lib/sandbox-2/interior to walk as it was.
 * @type {Record<string, (import('$lib/app/versions.js').Change & { build?: DomeKind })[]>}
 */
const HISTORY = {};

const DOME_LIST = DOMES_IN_ORDER.map((d) => ({
	id: `dome-${d.kind}`,
	label: DOMES[d.kind].label,
	note: d.text,
	usedIn: 'Sandbox 3',
	dome: d.kind,
	image: d.image,
	size: `${DOMES[d.kind].diameter} m across · ${DOMES[d.kind].people}`
}));

/** @type {Dome[]} */
const VERSIONED_DOMES = versioned(DOME_LIST, 'dome', HISTORY);

/** @type {Building[]} */
export const BUILDINGS = [...VERSIONED_DOMES, ...CONTAINERS];

/** @param {Building} b */
export const groupOf = (b) => ('dome' in b ? 'Tents and domes' : 'Containers');
