/*
 * SANDBOX 5 — Sandbox 4's dome cell (./village.ts), its food forest grown from our own plants ($lib/plants) through
 * ./flora.js: each plant at a stage of its life, from the young tree to the ripe fruit, so the forest is never all one
 * age. Outside, under the open sky, the plants of a middle-European forest garden; inside the domes, under the glass,
 * the ones that need the warmth — the mango, the banana, the coconut palm, the coffee and the cacao.
 *
 * Its garden is kept in the Maia City COOP's vault (A3, Samuel 2026-10-19), the repo's code/configs/sandbox-4/garden its
 * seed: `sandbox5()` reads it there.
 *
 * Every plant is anchored to the version it was planted with: its pin, the plant's avenDB entry and the heads of that
 * version (`pin`, $lib/assets/sources/avendb.js `PIN_REF`; Samuel 2026-10-20), or, in a garden not pinned yet, the
 * version its card numbers (`v`). A plant changed later is a new version of its entry, and Sandbox 5 keeps growing the
 * one written here until it is planted again on purpose.
 */

import { configAt, loadCode } from '../../../../game/code/index.js';

/** @typedef {{ entry: string, at: string[] }} Pin a version of a plant by avenDB's ids: its entry, the heads of the version */
/**
 * @typedef {{ id: string, v: number, pin?: Pin, stages: number[], weight?: number }} Planting a plant of the library at its
 *   version (its `pin`, else `v`), at one of `stages` (the stage indices 0 … 9; 9 the ripe fruit), drawn `weight` times as
 *   often as a plant of weight 1
 */
/**
 * @typedef {{ trees: Planting[], shrubs: Planting[], climbers: Planting[], cover: Planting[] }} Garden
 *   a forest garden's layers: its trees (canopy and sub-canopy), its shrubs, its climbers, and the cover under them
 *   (herbs, vegetables, the ground layer and the fungi)
 */

/** @typedef {{ id: string, v: number, pin?: Pin, stage: number, seed: string }} Kind a plant at its version, stage and seed */

/** A planting's plant as a kind is anchored to it: its pin where it has one. @param {{ pin?: Pin }} p */
export const pinOf = (p) => (p.pin ? { pin: p.pin } : {});

/**
 * How finely Sandbox 4 has always grown its plants (DETAIL in $lib/plants/grow.js: `detailAt` of each level is these):
 * near you, further off, and one alone in the picked plant's card (./PlantLook.svelte), finer than any in the forest.
 * Its forest asks the asset box for its plants at these levels, as their `detail` (./flora.js `DETAILS`).
 */
export const TIERS = {
	near: { level: 0.25, roots: false, thin: 0.45, fill: 1.3, finest: 0.0016 },
	mid: { level: 0.1, roots: false, thin: 0.12, fill: 1.6, finest: 0.006 },
	look: { level: 0.5, roots: false, thin: 0.6, fill: 1.2, finest: 0.0008 }
};

/** where Sandbox 4's garden is kept: the Maia City COOP's vault (A3), else the repo's seed (code/configs/sandbox-4/garden) */
export const GARDEN = 'configs/sandbox-4/garden';

/**
 * The garden a config holds as Sandbox 4 grows it. Outside: a temperate forest garden planted for the most it can give,
 * layer under layer (Martin Crawford's at Dartington, the syntropic plantings): a canopy of nut trees and the alder, a
 * dense layer of fruit trees under it, shrubs between their trunks, perennial vegetables, herbs, roots and ground cover
 * under them (`cover`), climbers, mushrooms on the logs, each layer at its own spacing (`spacing`). Inside, under the
 * glass, the plants that need the warmth. Below the trees the plants grow in drifts (`drift`: 5 to 15 of one kind
 * together, `gap` metres apart), and between them lie mini fields sown in rows (`fields`: each crop `size` metres, its
 * rows `row` and its plants `gap` apart, `fields` of them, on `tilled` soil; `reach` is how far off the forest draws it).
 * @param {any} c the config's JSON
 * @returns {{ seed: string, outside: Garden & { canopy: Planting[], herbs: Planting[], ground: Planting[], roots: Planting[], fungi: Planting[] },
 *   inside: Garden, spacing: Record<string, number>, drift: { least: number, most: number, gap: Record<string, number> },
 *   fields: { id: string, v: number, pin?: Pin, stages: number[], size: [number, number], row: number, gap: number, fields: number, reach: 'cover' | 'shrub' | 'tree', tilled: boolean }[] }}
 */
function floraOf(c) {
	const outside = {
		...c.outside,
		get cover() {
			return [...this.herbs, ...this.ground, ...this.roots, ...this.fungi];
		}
	};
	return { seed: c.seed, outside, inside: c.inside, spacing: c.spacing, drift: c.drift, fields: c.fields };
}

const SEED = configAt(GARDEN);

/**
 * How close each layer of the outdoor forest garden stands: a plant every so many square metres (on a jittered grid),
 * and how far it keeps from a canopy tree's trunk. The seed's; a garden carries its own (`flora.spacing`).
 */
export const OUTDOOR_SPACING = SEED.spacing;

/** Sandbox 5: the village of ./village.ts, its forest the seed's garden (`flora`). */
export const SANDBOX_5 = {
	sandbox: /** @type {const} */ ('sandbox-5'),
	flora: floraOf(SEED)
};

/** Sandbox 5 as it is kept now: its garden from the Maia City vault once the vault's code is loaded, else the seed's. */
export async function sandbox5() {
	await loadCode();
	return { sandbox: /** @type {const} */ ('sandbox-5'), flora: floraOf(configAt(GARDEN)) };
}

/** @typedef {typeof SANDBOX_5.flora} Flora */

/**
 * One planting of a layer, drawn by its weight, at one of its stages: the kind to grow.
 * @param {Planting[]} layer @param {() => number} r @param {string} seed
 * @returns {Kind}
 */
export function pick(layer, r, seed) {
	return stageOf(planting(layer, r), r, seed);
}

/** One planting of a layer, drawn by its weight. @param {Planting[]} layer @param {() => number} r */
export function planting(layer, r) {
	const total = layer.reduce((a, p) => a + (p.weight ?? 1), 0);
	let x = r() * total;
	let p = layer[layer.length - 1];
	for (const q of layer) if ((x -= q.weight ?? 1) < 0) {
		p = q;
		break;
	}
	return p;
}

/**
 * A planting at one of its stages: the kind to grow.
 * @param {Planting} p @param {() => number} r @param {string} seed @returns {Kind}
 */
export function stageOf(p, r, seed) {
	// the later stages a little more often: a food forest is mostly grown
	const k = Math.min(p.stages.length - 1, Math.floor(Math.pow(r(), 0.8) * p.stages.length));
	return { id: p.id, v: p.v, ...pinOf(p), stage: p.stages[k], seed };
}

/** the drifts and the mini fields as the seed has them; a garden carries its own (`flora.drift`, `flora.fields`) */
export const DRIFT = SEED.drift;
/** @type {{ id: string, v: number, pin?: Pin, stages: number[], size: [number, number], row: number, gap: number, fields: number, reach: 'cover' | 'shrub' | 'tree', tilled: boolean }[]} */
export const FIELDS = SEED.fields;

/** every plant a garden can grow, as kinds (for growing them all ahead) @param {Garden} garden @param {string} seed */
export const kindsOf = (garden, seed) =>
	Object.values(garden).flatMap((layer) => layer.flatMap((/** @type {Planting} */ p) => p.stages.map((stage) => ({ id: p.id, v: p.v, ...pinOf(p), stage, seed }))));
