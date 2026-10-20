// A vault's assets as this browser's device holds them, for the Assets page (./Assets.svelte): the vault's `recipe`
// entries as the database op hands them out (./db.js, avendb's `data::database`), an asset's entry one row for each of
// its versions and variants, each recipe's source the newest file its entry brings (the world's `files`, oldest
// first) or its own version's, read whole from the device a window at a time as the Library reads a file
// (./files.js `whole`), and the two read as the Maia City vault's recipes are read, with no repo fallback
// ($lib/assets/sources/avendb.js `vaultRecipes`): what the vault lacks, or holds otherwise, fails, naming the ref.

import { RECIPE_MEDIA, vaultRecipes } from '$lib/assets/sources/avendb.js';
import { whole } from './files.js';
import { reads, size } from './vaults.js';

/** The type of a recipe's entry, avenDB's `Recipe, v1`. */
export const RECIPE = 'recipe';

/** The most a recipe's file may be that the page reads whole (the stand-in's, the largest, is 315 kB). */
export const MOST = 16_000_000;

/**
 * Vault `vault`'s recipe entries of database `db`, as the reader takes rows (`{ vault, entry, type, tags, record }`):
 * those whose record this browser holds and `opens` lets through (the acting vault reads them), in the order the vault
 * holds them. None for another vault's database.
 * @param {import('./db.js').Db | null} db @param {string} vault
 * @param {(r: import('./db.js').RowView) => boolean} [opens]
 */
export const recipeRows = (db, vault, opens = () => true) =>
	db?.vault === vault
		? db.rows
				.filter((r) => r.type === RECIPE && r.record !== null && r.record !== undefined && opens(r))
				.map((r) => ({ vault, entry: r.entry, type: r.type, tags: r.tags, record: r.record, brought: r.brought, ...(Array.isArray(r.at) ? { at: r.at } : {}) }))
		: [];

/** The newest file entry `e` brings, as the device's world lists them, oldest first. @param {import('./vaults.js').EntryView | undefined} e */
export const newestFile = (e) => e?.files?.at(-1);

/**
 * How the reader reads a recipe row's file: the newest file its entry brings, as world `world` lists it, or for one
 * version of an asset's entry, the file of its own write ($lib/assets/sources/avendb.js `versionsOf`), read whole
 * through `read` (the device's `readFile`), as bytes; refused, saying why, where its entry brings none, this browser
 * holds no key to it yet, or it is larger than a recipe may be.
 * @param {import('./vaults.js').WorldView} world @param {import('./files.js').Read} read
 * @returns {(row: { entry: string, edit?: string, files?: any[] }) => Promise<Uint8Array>}
 */
export function fileReader(world, read) {
	const byEntry = new Map(world.entries.map((e) => [e.entry, e]));
	return (row) => bytesOf(row?.edit && Array.isArray(row.files) ? row.files.at(-1) : newestFile(byEntry.get(row?.entry)), read);
}

/**
 * A recipe's file read whole through `read`, as bytes; refused, saying why, where there is none, this browser holds
 * no key to it yet, or it is larger than a recipe may be.
 * @param {import('./files.js').FileView | undefined} file @param {import('./files.js').Read} read
 */
async function bytesOf(file, read) {
	if (!file) throw new Error('its entry brings no file');
	if (file.len === null || file.len === undefined) throw new Error('this browser holds no key to its file yet');
	if (file.len > MOST) throw new Error(`its file is ${size(file.len)}, larger than a recipe may be (${size(MOST)} at most)`);
	const blob = await whole(read, file, RECIPE_MEDIA);
	return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The recipes an AIP proposes, for its vault to see before it answers ($lib/avendb/Hitl.svelte): each of its `recipe`
 * lines as `get` reads it on that line (its record and `files`, what the line brings, oldest first), read as the
 * vault's own are (`vaultRecipes`), each file the newest its line brings, held to the hash its card names. A device
 * older than `get`'s `files` lists none, and says so. `firsts`, each entry's first version as `get` reads it
 * (`version: 1` on main), say which asset each entry is, so a line that brings another asset's recipe is refused.
 * @param {any[]} rows @param {import('./files.js').Read} read @param {any[]} [firsts]
 */
export function proposedSource(rows, read, firsts = []) {
	const assets = firsts.flatMap((f) => {
		const card = f?.record?.card;
		return typeof f?.entry === 'string' && card?.group && card?.id ? [/** @type {[string, string]} */ ([f.entry, `${card.group}/${card.id}`])] : [];
	});
	return vaultRecipes(rows, {
		assets,
		read: (row) => {
			if (!Array.isArray(row?.files)) throw new Error('this device lists no files on a proposal’s line yet: it needs a newer avenDB');
			return bytesOf(row.files.at(-1), read);
		}
	});
}

/**
 * Vault `vault`'s recipes as a page reads them, from this device alone: its recipe entries in database `db` that vault
 * `actor` reads, as the device says (the world's readers, or Public), each one's file read through `read` only when a
 * build needs it (`vaultRecipes`: `index`, `refused`, `rowOf`, `hashOf`, `recipeAt`).
 * @param {import('./vaults.js').WorldView} world @param {import('./db.js').Db | null} db @param {string} vault
 * @param {string} actor @param {import('./files.js').Read} read
 */
export function vaultSource(world, db, vault, actor, read) {
	const known = new Map(world.entries.map((e) => [e.entry, e]));
	/** @param {import('./db.js').RowView} r */
	const opens = (r) => {
		const e = known.get(r.entry);
		return r.public || (!!e && reads(e, actor));
	};
	return vaultRecipes(recipeRows(db, vault, opens), { read: fileReader(world, read) });
}
