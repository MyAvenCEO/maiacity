/*
 * REFS — one way to name an asset at a version, `group/id@v[:variant]`, and to find its builder in a set of groups.
 * The page asks every group (./index.js `assetAt`, `objectAt`); the asset box asks only the groups built as one
 * object (./groups.js). Both go through here, so a ref means the same thing everywhere.
 */

/** @typedef {import('./groups.js').Group} Group */
/** @typedef {import('./groups.js').Item} Item */
/** @typedef {import('./groups.js').AnyVersion} AnyVersion */

/**
 * A ref as its parts. @param {string} ref
 * @returns {{ group: string, id: string, v?: number, variant?: string }}
 */
export function parseRef(ref) {
	const m = /^([a-z]+)\/([^@:]+)(?:@(\d+))?(?::(.+))?$/.exec(ref);
	if (!m) throw new Error(`not an asset ref: ${ref} (group/id@v)`);
	return { group: m[1], id: m[2], v: m[3] ? Number(m[3]) : undefined, variant: m[4] };
}

/** The ref of an asset at a version (and a variant). @param {string} group @param {string} id @param {number} [v] @param {string} [variant] */
export const refOf = (group, id, v, variant) => `${group}/${id}${v ? `@${v}` : ''}${variant ? `:${variant}` : ''}`;

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
	const item = (await g.list()).find((x) => x.id === id);
	const version = item && (v === undefined ? item.versions[item.versions.length - 1] : item.versions.find((x) => x.v === v));
	if (!item || !version) return undefined;
	let build = version.build;
	// a kind with variants (the machines, the actors): the one asked for, or its first
	if (Array.isArray(build) && build.every((x) => typeof x?.make === 'function')) {
		build = (variant ? build.find((x) => x.id === variant) : build[0])?.make;
		if (!build) return undefined;
	} else if (variant) return undefined;
	return { group, item, version, build, kept: version.kept };
}

/**
 * An asset at a version in `groups`, built (see ./index.js `objectAt`).
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
	const made = got.build(...args);
	const obj = made?.isObject3D ? made : made?.rig?.object;
	if (!obj?.isObject3D) throw new Error(`${ref}: its builder made no object`);
	obj.userData.ref = refOf(got.group, got.item.id, got.version.v, parseRef(ref).variant);
	return obj;
}
