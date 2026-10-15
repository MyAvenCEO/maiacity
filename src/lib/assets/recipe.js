/*
 * A RECIPE — one asset at one version (and variant), as the box's engine runs it (./box/engine.js): its builder, and
 * what the engine needs to know of it (`meta`: its group, name, version, label, note and the parameters it declares,
 * ./params.js). An engine runs a recipe it is handed as a file of code, named by the BLAKE3 hash of its bytes; the
 * name it is listed under (`plants/apple@2`) is only a label for people (./recipes.js, ./box/plugin.js).
 *
 * The file is a script that calls `defineRecipe(f)` with a function that takes the engine's `require` (the modules
 * the engine has: three.js and the addons it lists) and gives back `{ meta, build }`. Ours are made from the groups'
 * lists by ./box/plugin.js, through `recipeIn`; anyone's later come from avenDB, the same shape, run the same way.
 */
import { pick } from './refs.js';

/** @typedef {import('./groups.js').Item} Item @typedef {import('./groups.js').AnyVersion} AnyVersion */
/** @typedef {import('./card.js').Meta} Meta */

/** the keys of `o` that are set, as a fresh plain object */
const set = (/** @type {Record<string, any>} */ o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * What a recipe says of the asset it builds: a kind's variant named (the one asked for, or its first), its label
 * with the variant's, its note the variant's or the version's.
 * @param {string} group @param {Item} item @param {AnyVersion} version @param {string} [variant]
 * @returns {Meta}
 */
export function metaOf(group, item, version, variant) {
	const v = Array.isArray(version.build) ? version.build.find((x) => x.id === (variant ?? version.build[0]?.id)) : null;
	return /** @type {Meta} */ (set({
		group,
		id: item.id,
		version: version.v,
		variant: variant ?? v?.id,
		label: v?.label ? `${item.label}: ${v.label}` : item.label,
		note: v?.note ?? version.note,
		params: item.params?.length ? JSON.parse(JSON.stringify(item.params)) : undefined
	}));
}

/**
 * The recipe of one asset in a group's list: what its file gives the engine. Throws when it has no builder of its own.
 * @param {string} group @param {Item[]} list @param {string} id @param {number} v @param {string | null} [variant]
 * @returns {{ meta: Meta, build: (...args: any[]) => any }}
 */
export function recipeIn(group, list, id, v, variant) {
	const got = pick(list, id, v, variant ?? undefined);
	if (!got) throw new Error(`no asset ${group}/${id}@${v}${variant ? `:${variant}` : ''}`);
	if (!got.kept || typeof got.build !== 'function') throw new Error(`${group}/${id}@${v}: no builder of its own`);
	return { meta: metaOf(group, got.item, got.version, variant ?? undefined), build: got.build };
}

/**
 * Every recipe a group's list holds: each version that kept its builder, each variant of it.
 * @param {Item[]} list @returns {{ id: string, v: number, variant: string | null }[]}
 */
export function recipesIn(list) {
	/** @type {{ id: string, v: number, variant: string | null }[]} */
	const out = [];
	for (const item of list)
		for (const version of item.versions.filter((x) => x.kept)) {
			if (Array.isArray(version.build)) for (const b of version.build) out.push({ id: item.id, v: version.v, variant: b.id });
			else out.push({ id: item.id, v: version.v, variant: null });
		}
	return out;
}
