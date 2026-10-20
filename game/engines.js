// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE FROZEN ENGINES, READ — the one list of every engine a host of ours runs untrusted code on, by kind
 * (src/lib/sandbox/engines.json, which the API's image copies), read here so the page (src/lib/sandbox/engines.js,
 * which adds the floors) and the API (./code/sources/avendb.js) hold code to the same engines the same way.
 */
import MANIFEST from '../src/lib/sandbox/engines.json' with { type: 'json' };

/** every frozen engine of `kind`, oldest first @param {string} kind */
export const enginesOf = (kind) => MANIFEST[kind] ?? [];

/** the latest engine of `kind` @param {string} kind */
export const latestOf = (kind) => enginesOf(kind).at(-1);

/** engine `v` of `kind`, if it is frozen @param {string} kind @param {unknown} v */
export const engineAt = (kind, v) => enginesOf(kind).find((e) => e.v === v);

/** whether engine `v` of `kind` is frozen under `hash`: what code names an engine by, its version and its hash */
export const isFrozen = (kind, v, hash) => typeof hash === 'string' && engineAt(kind, v)?.blake3 === hash;

/** the file name each kind's engines are served under, where it is not the kind's own (a box engine's, as first frozen) */
const FILES = { box: 'engine' };

/** where engine `v` of `kind` is served, under the site's base path @param {string} kind @param {number} v */
export const pathOf = (kind, v) => `/engines/${FILES[kind] ?? kind}-v${v}.js`;
