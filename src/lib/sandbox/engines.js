/*
 * THE KERNEL'S FROZEN ENGINES — besides the asset engines (../assets/engines.json), every engine a host of ours runs
 * code we cannot trust on: the logic engine (./logic-engine.js), later the view engine. Each version's BLAKE3 hash and
 * size are in ./engines.json, its file is static/engines/<kind>-v<n>.js, made by scripts/freeze-engine.mjs; a frozen
 * engine never changes or goes (./logic.test.js).
 */
import manifest from './engines.json' with { type: 'json' };

/**
 * @typedef {{ v: number, date: string, blake3: string, bytes: number, quickjs?: string, note: string }} Frozen
 *   a frozen engine: its version, when, the BLAKE3 hash of its file and its size, and what it brought
 */

/** every frozen engine of `kind`, oldest first @param {'logic'} kind @returns {Frozen[]} */
export const enginesOf = (kind) => /** @type {Record<string, Frozen[]>} */ (manifest)[kind] ?? [];

/** the latest engine of `kind` @param {'logic'} kind */
export const latestOf = (kind) => enginesOf(kind).at(-1);

/** where engine `v` of `kind` is served, under the site's base path @param {string} kind @param {number} v */
export const pathOf = (kind, v) => `/engines/${kind}-v${v}.js`;
