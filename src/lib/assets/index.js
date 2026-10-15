/*
 * EVERY ASSET BY ONE NAME — the asset groups of the app (the Factories, the Things, the Machines, the Actors, the
 * Plants, the Biomes, the Buildings, the Worlds) behind one way to name an asset at a version, so anything can ask for
 * anything:
 *
 *   group/id@v            machines/powercube@3, plants/apple@1, things/pickup@2, factories/batterypack-line@1
 *   group/id@v:variant    machines/powercube@1:powercube-electric (a kind's variant, as it was at that version)
 *   group/id              its latest version
 *
 * `assetAt(ref)` gives back the version and its builder, the one the group's explorer shows for it ($lib/app/versions.js:
 * a version's own frozen builder, or `kept: false` when only its note is left); `objectAt(ref, …)` builds it, as the
 * object to put into a scene or to carry in another asset ($lib/assets/parts.js). A world, a building or a film names
 * what it puts in by such a ref and so stays anchored to the asset as it was when it was made. Each group is loaded
 * only when it is asked for.
 */

/** @typedef {import('$lib/app/versions.js').Version<any>} AnyVersion */
/** @typedef {{ id: string, label: string, versions: AnyVersion[], version: number }} Item an asset as its group lists it */

/** @type {Record<string, { label: string, list: () => Promise<Item[]> }>} */
export const GROUPS = {
	// a factory is its spec, not an object: objectAt throws for it as for a biome ($lib/factories/index.js)
	factories: { label: 'Factories', list: async () => (await import('$lib/factories/index.js')).FACTORIES },
	things: { label: 'Things', list: async () => (await import('$lib/models')).MODELS },
	machines: { label: 'Machines', list: async () => (await import('$lib/machines/index.js')).MACHINES },
	actors: { label: 'Actors', list: async () => (await import('$lib/actors')).FAMILIES },
	plants: { label: 'Plants', list: async () => /** @type {Item[]} */ (/** @type {unknown} */ ((await import('$lib/plants')).PLANTS)) },
	biomes: { label: 'Biomes', list: async () => /** @type {Item[]} */ (/** @type {unknown} */ ((await import('$lib/biomes')).BIOMES)) },
	buildings: { label: 'Buildings', list: async () => /** @type {Item[]} */ (/** @type {unknown} */ ((await import('$lib/buildings')).BUILDINGS)) },
	worlds: {
		label: 'Worlds',
		list: async () => {
			const { PLAY, WORLDS } = await import('$lib/app/places');
			// a world's id is the last part of its address: sandbox-5, isar
			return [...PLAY, ...WORLDS].filter((p) => p.versions).map((p) => ({ ...p, id: idOfHref(p.href), versions: /** @type {AnyVersion[]} */ (p.versions), version: p.version ?? 1 }));
		}
	}
};

/** a world's id from its address @param {string} href */
export const idOfHref = (href) => href.replace(/\/+$/, '').split('/').pop() ?? href;

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
 * An asset at a version, by its ref: the item as its group lists it, the version, its builder (a kind's: the variant
 * asked for, or its first) and whether that builder is the version's own. Undefined if there is no such asset or
 * version.
 * @param {string} ref
 * @returns {Promise<{ group: string, item: Item, version: AnyVersion, build: any, kept: boolean } | undefined>}
 */
export async function assetAt(ref) {
	const { group, id, v, variant } = parseRef(ref);
	const g = GROUPS[group];
	if (!g) throw new Error(`no asset group ${group}: ${Object.keys(GROUPS).join(', ')}`);
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
 * An asset at a version, built: the object a thing's builder, a plant's `grow`, or a machine's or an actor's variant
 * makes, its ref on it (`userData.ref`) so `carry` names it on every part it brings. The arguments go to the builder
 * (a thing's options, a plant's stage and seed). Throws when the version was not kept, or when the group's versions
 * are not built as one object (a biome's recipe, a dome's interior, a world's page).
 * @param {string} ref
 * @param {...any} args
 * @returns {Promise<import('three').Object3D>}
 */
export async function objectAt(ref, ...args) {
	const got = await assetAt(ref);
	if (!got) throw new Error(`no asset ${ref}`);
	if (!got.kept) throw new Error(`${ref}: only its note was kept, not its builder`);
	if (typeof got.build !== 'function') throw new Error(`${ref}: ${got.group} are not built as one object`);
	const made = got.build(...args);
	const obj = made?.isObject3D ? made : made?.rig?.object;
	if (!obj?.isObject3D) throw new Error(`${ref}: its builder made no object`);
	obj.userData.ref = refOf(got.group, got.item.id, got.version.v, parseRef(ref).variant);
	return obj;
}
