// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE REPO'S RECIPES BY THEIR HASH — every asset, version and variant of the groups the box builds, as a recipe file
 * named by the BLAKE3 hash of its bytes (./recipe.js, ./engines.js). A build is named by its recipe's hash and the
 * values it is built with, `<hash>?seed=maia&stage=9` (./builds.js); a label (`plants/apple@2`) is only a tag that
 * points at a hash, the way a tag in version control points at a commit (`hashOf`). A recipe is handed out only once
 * its bytes hash to the name it was asked for (`recipeAt`).
 *
 * No page reads this (Samuel 2026-10-17, with no repo fallback): every page reads the Maia City vault's recipes
 * (./vault.js). The repo's only feed the seed that writes them into the vault (src/lib/avendb/seed.js,
 * scripts/seed-ops.mjs), the dev server's stand-in for the vault's feed (./sources/devfeed.js) and the tests, which
 * ./vault.test.js holds every other module to.
 *
 * `virtual:asset-recipes` (./box/plugin.js) is the index (each hash's group, asset, version and variant, and the
 * engine our recipes are made for); each asset's library, its own code and nothing of another asset's, is loaded only
 * when one of its recipes is built (`virtual:asset-recipes/libraries`).
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import INDEX from 'virtual:asset-recipes';
import LIBRARIES from 'virtual:asset-recipes/libraries';
import { idOf, slug } from '$lib/ids.js';
import { buildOf } from './builds.js';
import { RECIPE_HEAD, recipeTail } from './engines.js';
import { queryOf } from './params.js';
import { refOf } from './refs.js';
import { repoRef } from './sources/index.js';

export { INDEX };
export { buildOf, checked, hashText, parseBuild } from './builds.js';

/**
 * A build's page: on the root, its recipe's hash as an address reads it ($lib/ids.js), its label in words (`?t=`,
 * never one of its values), then its values, sorted ($lib/assets/AssetPage.svelte).
 * @param {string} base the site's base path @param {string} hash @param {Record<string, unknown>} [values]
 */
export const pageOf = (base, hash, values) => {
	const q = queryOf(values);
	return `${base}/${idOf(hash)}/?t=${slug(INDEX.recipes[hash]?.label ?? '', 'asset')}${q ? `&${q}` : ''}`;
};

/**
 * The hash a label points at: `plants/apple@2:variant` (its latest version when none is named, its first variant
 * when none is). Undefined for a label of nothing.
 * @param {string} label
 */
export function hashOf(label) {
	const { group, id, v, variant } = repoRef(label);
	const latest = v ?? INDEX.latest[`${group}/${id}`];
	return INDEX.labels[refOf(group, id, latest, variant)] ?? INDEX.labels[refOf(group, id, latest, INDEX.first[refOf(group, id, latest)])];
}

/** A build named from a label and its values: the label's hash, the same values. @param {string} label */
export const buildAt = (label) => buildOf(hashOf(label) ?? '', repoRef(label).params);

/** What a hash names in our index: its group, id, version, variant and label; undefined if it is not one of ours. */
export const recipeInfo = (hash) => INDEX.recipes[hash];

const heads = new Map();
/**
 * An asset's library (`<group>/<id>`) as text, and BLAKE3's state after the recipe head and the library, so each of
 * its recipes hashes in a moment. @param {string} name
 */
async function library(name) {
	if (!heads.has(name)) {
		if (!Object.hasOwn(LIBRARIES, name)) throw new Error(`no recipes of ${name} on this device`);
		heads.set(
			name,
			LIBRARIES[name]().then(({ default: text }) => {
				const h = blake3.create();
				h.update(utf8ToBytes(RECIPE_HEAD + text));
				return { text, h };
			})
		);
		heads.get(name).catch(() => heads.delete(name));
	}
	return heads.get(name);
}

/**
 * A recipe of ours by its hash: `{ hash, code }`, its bytes checked against its name. Throws for a hash we do not
 * have, or bytes that hash to another name.
 * @param {string} hash
 */
export async function recipeAt(hash) {
	const at = INDEX.recipes[hash];
	if (!at) throw new Error(`no recipe ${hash.slice(0, 12)}… on this device`);
	const { text, h } = await library(`${at.group}/${at.id}`);
	const tail = recipeTail(at.id, at.v, at.variant);
	const named = bytesToHex(h.clone().update(utf8ToBytes(tail)).digest());
	if (named !== hash) throw new Error(`refused: the recipe for ${hash.slice(0, 12)}… hashes to ${named.slice(0, 12)}…`);
	return { hash, code: RECIPE_HEAD + text + tail };
}
