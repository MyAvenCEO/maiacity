// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * OUR RECIPES BY THEIR HASH — every asset, version and variant of the groups the box builds, as a recipe file named
 * by the BLAKE3 hash of its bytes (./recipe.js, ./engines.js). A build is named by its recipe's hash and the values it
 * is built with, `<hash>?seed=maia&stage=9`; a label (`plants/apple@2`) is only a tag that points at a hash, the way a
 * git tag points at a commit (`hashOf`). The page hands a recipe to the box only once its bytes hash to the name it
 * was asked for (`recipeAt`), as it will for a recipe that comes from avenDB.
 *
 * `virtual:asset-recipes` (./box/plugin.js) is the index (each hash's group, asset, version and variant, and the
 * engine our recipes are made for); each group's library is loaded only when one of its recipes is built.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import INDEX from 'virtual:asset-recipes';
import { idOf, slug } from '$lib/ids.js';
import { RECIPE_HEAD, recipeTail } from './engines.js';
import { paramsIn, queryOf } from './params.js';
import { parseRef, refOf } from './refs.js';

export { INDEX };

const LIBRARIES = {
	things: () => import('virtual:asset-recipes/things'),
	machines: () => import('virtual:asset-recipes/machines'),
	actors: () => import('virtual:asset-recipes/actors'),
	plants: () => import('virtual:asset-recipes/plants')
};

/** the BLAKE3 hash of a text, in hex @param {string} text */
export const hashText = (text) => bytesToHex(blake3(utf8ToBytes(text)));

/**
 * A build's name as its parts: the recipe's hash and the values, as text. Throws for anything else.
 * @param {string} ref @returns {{ hash: string, params?: Record<string, string> }}
 */
export function parseBuild(ref) {
	const m = /^([0-9a-f]{64})(?:\?(.*))?$/.exec(ref);
	if (!m) throw new Error(`not a build: ${String(ref).slice(0, 80)} (a recipe's hash, then ?its=values)`);
	const params = paramsIn(m[2]);
	return { hash: m[1], ...(params && { params }) };
}

/** A build's name: a recipe's hash and the values, sorted. @param {string} hash @param {Record<string, unknown>} [values] */
export const buildOf = (hash, values) => {
	const q = queryOf(values);
	return q ? `${hash}?${q}` : hash;
};

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
	const { group, id, v, variant } = parseRef(label);
	const latest = v ?? INDEX.latest[`${group}/${id}`];
	return INDEX.labels[refOf(group, id, latest, variant)] ?? INDEX.labels[refOf(group, id, latest, INDEX.first[refOf(group, id, latest)])];
}

/** A build named from a label and its values: the label's hash, the same values. @param {string} label */
export const buildAt = (label) => buildOf(hashOf(label) ?? '', parseRef(label).params);

/** What a hash names in our index: its group, id, version, variant and label; undefined if it is not one of ours. */
export const recipeInfo = (hash) => INDEX.recipes[hash];

const heads = new Map();
/** a library's text, and BLAKE3's state after the recipe head and the library, so each recipe hashes in a moment */
async function library(group) {
	if (!heads.has(group)) {
		heads.set(
			group,
			LIBRARIES[group]().then(({ default: text }) => {
				const h = blake3.create();
				h.update(utf8ToBytes(RECIPE_HEAD + text));
				return { text, h };
			})
		);
		heads.get(group).catch(() => heads.delete(group));
	}
	return heads.get(group);
}

/**
 * A recipe of ours by its hash: `{ hash, code }`, its bytes checked against its name. Throws for a hash we do not
 * have, or bytes that hash to another name.
 * @param {string} hash
 */
export async function recipeAt(hash) {
	const at = INDEX.recipes[hash];
	if (!at) throw new Error(`no recipe ${hash.slice(0, 12)}… on this device`);
	const { text, h } = await library(at.group);
	const tail = recipeTail(at.id, at.v, at.variant);
	const named = bytesToHex(h.clone().update(utf8ToBytes(tail)).digest());
	if (named !== hash) throw new Error(`refused: the recipe for ${hash.slice(0, 12)}… hashes to ${named.slice(0, 12)}…`);
	return { hash, code: RECIPE_HEAD + text + tail };
}

/** A recipe handed in as code, checked against its name: the same `{ hash, code }`, or refused. */
export function checked({ hash, code }) {
	const named = hashText(code);
	if (named !== hash) throw new Error(`refused: the recipe named ${hash.slice(0, 12)}… hashes to ${named.slice(0, 12)}…`);
	return { hash, code };
}
