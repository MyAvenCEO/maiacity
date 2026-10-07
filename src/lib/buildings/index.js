/*
 * THE BUILDINGS — what a settlement lives and works in, as the Buildings viewer (/app/buildings/) lists it: the tent a
 * settler starts in, the four domes of a village and the factory that makes their glass (Sandbox 3's, walked inside
 * with $lib/sandbox-2/DomeInterior.svelte), and the shipping containers fitted out as the crew's kitchen, workshop,
 * power and washroom (Sandbox 1's, $lib/models/containers.js, on the turntable and walked in there).
 */
import { DOMES } from '$lib/sandbox-2/interior/interior';
import { DOMES_IN_ORDER } from './domes.js';
import { CONTAINERS } from '$lib/models';

/** @typedef {import('$lib/sandbox-2/interior/interior').DomeKind} DomeKind */
/** @typedef {{ id: string, label: string, note: string, usedIn: string, dome: DomeKind, image: string, size: string }} Dome */
/** @typedef {import('$lib/models').Model} Model */
/** @typedef {Dome | Model} Building */

/** @type {Dome[]} */
const DOME_LIST = DOMES_IN_ORDER.map((d) => ({
	id: `dome-${d.kind}`,
	label: DOMES[d.kind].label,
	note: d.text,
	usedIn: 'Sandbox 3',
	dome: d.kind,
	image: d.image,
	size: `${DOMES[d.kind].diameter} m across · ${DOMES[d.kind].people}`
}));

/** @type {Building[]} */
export const BUILDINGS = [...DOME_LIST, ...CONTAINERS];

/** @param {Building} b */
export const groupOf = (b) => ('dome' in b ? 'Tents and domes' : 'Containers');
