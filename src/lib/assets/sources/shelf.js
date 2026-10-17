// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE MAIA CITY VAULT'S ASSETS, LISTED FROM THE VAULT ALONE (V5 of the avenDB migration): what a viewer of a vault's
 * recipes lists (the avenDB app's Assets, $lib/avendb/Assets.svelte), with no repo fallback (Samuel 2026-10-17): the
 * vault's `recipe` entries as ./avendb.js `vaultRecipes` reads them, by group, asset, version and variant, each with
 * the card its entry holds (`shelfOf`), and why an entry the reader refused is none (`refusedOf`). A build of one is
 * ./viewer.js's. Nothing here reads the repo's index (../recipes.js, `virtual:asset-recipes`).
 */
import { refOf } from '../refs.js';
import { labelOf } from './avendb.js';

/** the groups in the order the asset dashboard lists them; one it doesn't name comes after, by its name */
export const GROUPS = ['factories', 'machines', 'actors', 'worlds', 'buildings', 'things', 'biomes', 'plants'];

/** a value an object holds of its own, never one it inherits @param {Record<string, any>} o @param {string} k */
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** a group's name as a heading reads it (`plants`: Plants) @param {string} g */
export const groupName = (g) => g.charAt(0).toUpperCase() + g.slice(1);

/**
 * @typedef {{ hash: string, label: string, v: number, variant: string | null, first: boolean, entry: string,
 *   title: string, name: string, note: string, card: any }} Shelved one recipe of the vault: its hash, its ref (`label`),
 *   version and variant, whether it is its version's first variant, the entry it is kept in, and from its card its
 *   title, its name among its version's variants (`Wood ant` of `Ant: Wood ant`), its note and the card itself
 * @typedef {{ id: string, ref: string, title: string, versions: { v: number, recipes: Shelved[] }[] }} ShelvedAsset
 * @typedef {{ group: string, title: string, assets: ShelvedAsset[] }} Shelf
 */

/**
 * The vault's recipes as a viewer lists them, from its entries alone: by group (the dashboard's order), then by asset
 * (by its title), then its versions, the newest first, each with its variants, its first variant first. An asset's
 * title is the part its variants' labels share before a colon (`Ant` of `Ant: Wood ant`), else its card's label.
 * @param {ReturnType<typeof import('./avendb.js').vaultRecipes>} source @returns {Shelf[]}
 */
export function shelfOf(source) {
	/** @type {Map<string, Map<string, Shelved[]>>} */
	const groups = new Map();
	for (const [hash, at] of Object.entries(source.index.recipes)) {
		const row = source.rowOf(hash);
		const card = row?.record?.card ?? {};
		const title = String(card.label ?? at.label);
		const first = !!at.variant && own(source.index.first, refOf(at.group, at.id, at.v)) === at.variant;
		const said = at.variant && title.includes(': ') ? title.slice(title.indexOf(': ') + 2) : (at.variant ?? `v${at.v}`);
		/** @type {Shelved} */
		const item = { hash, label: at.label, v: at.v, variant: at.variant ?? null, first, entry: String(row?.entry ?? ''), title, name: said, note: String(card.note ?? ''), card };
		const assets = groups.get(at.group) ?? new Map();
		groups.set(at.group, assets);
		assets.set(at.id, [...(assets.get(at.id) ?? []), item]);
	}
	const rank = (/** @type {string} */ g) => (GROUPS.includes(g) ? GROUPS.indexOf(g) : GROUPS.length);
	return [...groups]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([group, assets]) => ({
			group,
			title: groupName(group),
			assets: [...assets]
				.map(([id, items]) => {
					const vs = [...new Set(items.map((x) => x.v))].sort((a, b) => b - a);
					const versions = vs.map((v) => ({
						v,
						recipes: items.filter((x) => x.v === v).sort((a, b) => Number(b.first) - Number(a.first) || String(a.variant ?? '').localeCompare(String(b.variant ?? '')))
					}));
					const newest = versions[0].recipes;
					const heads = newest.map((x) => (x.variant && x.title.includes(': ') ? x.title.slice(0, x.title.indexOf(': ')) : null));
					const title = heads.every((h) => h && h === heads[0]) ? /** @type {string} */ (heads[0]) : newest[0].title;
					return { id, ref: `${group}/${id}`, title, versions };
				})
				.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
		}));
}

/**
 * Why an entry the vault holds is no recipe a page may build, as the reader said when it read the rows (`refused`):
 * what it said of that entry, or of the ref the entry's card names. Empty where it said nothing of it.
 * @param {ReturnType<typeof import('./avendb.js').vaultRecipes>} source @param {any} row
 * @returns {string[]}
 */
export function refusedOf(source, row) {
	const where = `entry ${String(row?.entry ?? '').slice(0, 12)}…`;
	let label = '';
	try {
		label = row?.record?.card ? labelOf(row.record.card) : '';
	} catch {
		label = '';
	}
	return source.refused.filter((m) => m.includes(where) || (!!label && (m.startsWith(`${label}:`) || m.startsWith(`${label} (`))));
}
