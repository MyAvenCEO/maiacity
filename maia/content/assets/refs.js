/*
 * REFS — one way to name an asset at a version, `group/id@v[:variant][?parameters]`, and to find its builder in a set
 * of groups. The page asks every group (./index.js `assetAt`, `objectAt`); the asset box asks only the groups built as
 * one object (./groups.js). Both go through here, so a ref means the same thing everywhere. The parameters are the
 * ones its recipe declares (./params.js): `plants/apple@2?seed=maia&stage=9`.
 */
import { argsOf, paramsIn, queryOf, valuesOf } from './params.js';

/** @typedef {import('./groups.js').Group} Group */
/** @typedef {import('./groups.js').Item} Item */
/** @typedef {import('./groups.js').AnyVersion} AnyVersion */

/**
 * A ref as its parts; `params` as text, undefined when it names none. @param {string} ref
 * @returns {{ group: string, id: string, v?: number, variant?: string, params?: Record<string, string> }}
 */
export function parseRef(ref) {
	const m = /^([a-z]+)\/([^@:?]+)(?:@(\d+))?(?::([^?]+))?(?:\?(.*))?$/.exec(ref);
	if (!m) throw new Error(`not an asset ref: ${ref} (group/id@v)`);
	const params = paramsIn(m[5]);
	return { group: m[1], id: m[2], v: m[3] ? Number(m[3]) : undefined, variant: m[4], ...(params && { params }) };
}

/**
 * The ref of an asset at a version (and a variant, and its parameters' values, sorted).
 * @param {string} group @param {string} id @param {number} [v] @param {string} [variant] @param {Record<string, unknown>} [values]
 */
export function refOf(group, id, v, variant, values) {
	const q = queryOf(values);
	return `${group}/${id}${v ? `@${v}` : ''}${variant ? `:${variant}` : ''}${q ? `?${q}` : ''}`;
}

/**
 * The asset `id` at version `v` (its latest when not given), and a kind's variant (the one asked for, or its first), in a
 * group's list: its item, its version and its builder. Undefined if there is no such asset, version or variant.
 * @param {Item[]} list @param {string} id @param {number} [v] @param {string} [variant]
 * @returns {{ item: Item, version: AnyVersion, build: any, kept: boolean } | undefined}
 */
export function pick(list, id, v, variant) {
	const item = list.find((x) => x.id === id);
	const version = item && (v === undefined ? item.versions[item.versions.length - 1] : item.versions.find((x) => x.v === v));
	if (!item || !version) return undefined;
	let build = version.build;
	// a kind with variants (the machines, the actors): the one asked for, or its first
	if (Array.isArray(build) && build.every((x) => typeof x?.make === 'function')) {
		build = (variant ? build.find((x) => x.id === variant) : build[0])?.make;
		if (!build) return undefined;
	} else if (variant) return undefined;
	return { item, version, build, kept: version.kept };
}

/**
 * An asset at a version in `groups`, by its ref (see ./index.js `assetAt`).
 * @param {Record<string, Group>} groups
 * @param {string} ref
 * @returns {Promise<{ group: string, item: Item, version: AnyVersion, build: any, kept: boolean } | undefined>}
 */
export async function assetIn(groups, ref) {
	const { group, id, v, variant } = parseRef(ref);
	const g = groups[group];
	if (!g) throw new Error(`no asset group ${group}: ${Object.keys(groups).join(', ')}`);
	const got = pick(await g.list(), id, v, variant);
	return got && { group, ...got };
}

/**
 * Builds an object with a builder and what it declares it takes (./params.js): the values `given` (a ref's, as text),
 * else `args` in their order, else its own; a builder that declares none takes `args` as they are. A builder may make
 * its object or a rig that carries it, at once or in time. The object comes with its ref (`userData.ref`): `ref`, the
 * name of the version it was built from, and every value it was built with. The page (`objectIn`) and the box's engine
 * (./box/engine.js) both build through here.
 * @param {{ build: (...args: any[]) => any, params?: import('./params.js').Param[], ref: string }} recipe
 * @param {Record<string, string>} [given] @param {unknown[]} [args]
 * @returns {Promise<import('three').Object3D>}
 */
export async function buildWith({ build, params = [], ref }, given, args = []) {
	if (given && !params.length) throw new Error(`${ref} takes no parameters`);
	const values = params.length ? valuesOf(params, given, args) : undefined;
	const made = await (values ? build(...argsOf(params, values)) : build(...args));
	const obj = made?.isObject3D ? made : made?.rig?.object;
	if (!obj?.isObject3D) throw new Error(`${ref}: its builder made no object`);
	const q = queryOf(values);
	obj.userData.ref = q ? `${ref}?${q}` : ref;
	return obj;
}

/**
 * An asset at a version in `groups`, built (see ./index.js `objectAt`), with the ref's values, else `args` (`buildWith`).
 * @param {Record<string, Group>} groups
 * @param {string} ref
 * @param {...any} args
 * @returns {Promise<import('three').Object3D>}
 */
export async function objectIn(groups, ref, ...args) {
	const got = await assetIn(groups, ref);
	if (!got) throw new Error(`no asset ${ref}`);
	if (!got.kept) throw new Error(`${ref}: only its note was kept, not its builder`);
	if (typeof got.build !== 'function') throw new Error(`${ref}: ${got.group} are not built as one object`);
	const { variant, params: given } = parseRef(ref);
	return buildWith({ build: got.build, params: got.item.params, ref: refOf(got.group, got.item.id, got.version.v, variant) }, given, args);
}
