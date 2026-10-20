/*
 * THE KERNEL'S FROZEN ENGINES, ONE LIST — every engine a host of ours runs code we cannot trust on, by kind: the asset
 * box's (`box`, ../assets/box/engine.js), the logic engine (./logic-engine.js), the view engine (./view/engine.js),
 * the worker a view's draw script runs in (./view/worker.js) and the libraries it may import (./view/libs/: three,
 * d3, the MCP Apps SDK). Each version's BLAKE3 hash and size are in ./engines.json, its file is
 * static/engines/<kind>-v<n>.js (a box engine's engine-v<n>.js, as it was first frozen), made by
 * scripts/freeze-engine.mjs; a frozen engine never changes or goes (./engines.test.js).
 *
 * Which one runs a piece of code (`engineFor`, gap G6): the version it names, as a code entry names it (its `engine`),
 * so a new engine never changes what older code does. But never one below the kind's FLOOR: a version that closes a
 * hole raises it, or code could name the engine from before, and so step around the wall. Code that names none runs
 * on the floor too.
 */
import { engineAt, enginesOf as listOf, isFrozen, latestOf, pathOf } from '../../../game/engines.js';

/**
 * @typedef {{ v: number, date: string, blake3: string, bytes: number, quickjs?: string, version?: string, three?: string, modules?: string[], note: string }} Frozen
 *   a frozen engine: its version, when, the BLAKE3 hash of its file and its size, and what it brought
 */

/** every frozen engine of `kind`, oldest first @param {string} kind @returns {Frozen[]} */
export const enginesOf = (kind) => listOf(kind);

export { engineAt, isFrozen, latestOf, pathOf };

/**
 * The oldest engine of each kind code may still run on. Each step up closed a hole, and code that names an older one
 * runs here all the same:
 * - box 1: every box engine so far; a recipe runs on the one it was made for, by its hash (#1076).
 * - view 3 cleans every value its template fills into an attribute again (G8); view 4 holds a view's script to a
 *   budget of work (G7), with view worker 2 answering its watch.
 * - logic 1: the first, and so far the only one.
 */
/** @type {Record<string, number>} */
export const FLOOR = { box: 1, view: 4, 'view-worker': 2, logic: 1 };

/** the view worker each view engine starts a view's script in (view 4's watch asks a question only worker 2 answers) */
/** @type {Record<number, number>} */
export const WORKERS = { 1: 1, 2: 1, 3: 1, 4: 2 };

/**
 * The frozen engine of `kind` that runs code naming version `named`: that one, or the kind's floor where it names an
 * older one or none (`undefined`, a number less than 1, anything but a whole number); undefined where it names one
 * that is not frozen, which nothing then runs.
 * @param {string} kind @param {unknown} named @param {Frozen[]} [list] @param {number} [floor]
 * @returns {Frozen | undefined}
 */
export function engineFor(kind, named, list = enginesOf(kind), floor = FLOOR[kind] ?? 1) {
	const v = Number.isInteger(named) && /** @type {number} */ (named) > floor ? /** @type {number} */ (named) : floor;
	return list.find((e) => e.v === v);
}

/** the view worker a view engine starts a view's script in, never below the worker's own floor @param {number} view */
export const workerFor = (view) => engineFor('view-worker', WORKERS[view] ?? latestOf('view-worker')?.v);
