// @ts-nocheck — plain JS, run by Vite's dev server (only with VITE_RECIPE_FEED=dev) and by the tests, never by a page
/*
 * A STAND-IN FOR THE MAIA CITY VAULT'S RECIPE FEED, MADE FROM THE REPO — for checking pages where avenDB's server can't
 * be reached (a cloud container, whose proxy refuses the server's address). Our recipes as the seed writes them into the
 * vault (./avendb.js `recipeEntryOf`, each card from ./cards.json), each a row as avenDB's feed hands one out
 * (`/feed/code`, `world::public_row`) with its file listed, and each file served beside them, as the feed serves a code
 * entry's newest file. A page reads it exactly as it reads the real feed (../vault.js), checked the same.
 *
 * Off unless asked for, and never in a build: a dev server serves it only when a developer starts it with
 * `VITE_RECIPE_FEED=dev` (../box/plugin.js), and only a dev server's page asks for it (`import.meta.env.DEV` is false
 * in a build, ../vault.js `feedOf`). The tests make their fake vault with it.
 */
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { hashBytes, hashText } from '../../../../game/hash.js';
import { recipeFile } from '../engines.js';
import { recipeEntryOf } from './avendb.js';

/** the stand-in's vault: the id of no vault avenDB's server holds */
export const DEV_VAULT = 'de'.repeat(32);

/**
 * The repo's recipes as rows of the Maia City vault's feed, and each one's file by its entry: `{ rows, files, missing }`,
 * `missing` the recipes left out, saying why (a card ./cards.json doesn't have yet: bun scripts/recipe-cards.mjs).
 * @param {{ index: any, libraries: Record<string, string> }} made what ../box/plugin.js `bundleRecipes` makes
 * @param {Record<string, any>} cards each recipe's card, by its hash (./cards.json's `cards`)
 * @param {{ vault?: string }} [o]
 */
export function devFeedOf({ index, libraries }, cards, { vault = DEV_VAULT } = {}) {
	const rows = [];
	/** @type {Map<string, Uint8Array>} */
	const files = new Map();
	const missing = [];
	for (const [hash, at] of Object.entries(index.recipes)) {
		try {
			const card = cards[hash];
			if (!card) throw new Error('./cards.json has no card of it (bun scripts/recipe-cards.mjs)');
			const code = recipeFile(libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant);
			const first = !!at.variant && index.first[`${at.group}/${at.id}@${at.v}`] === at.variant;
			const { type, tags, value, file } = recipeEntryOf({ code, card, first });
			const bytes = utf8ToBytes(file.text);
			const entry = hashText(`maiaCITY dev feed: ${at.label}`);
			rows.push({ entry, vault, name: 'Maia City', seed: 'Maia City', type, schema: '', tags, heads: [hash], created: 0, record: value, files: [{ root: hashBytes(bytes), size: bytes.length, len: bytes.length }] });
			files.set(entry, bytes);
		} catch (e) {
			missing.push(`${at.label}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return { vault, rows, files, missing };
}

/**
 * The stand-in served as avenDB's server serves the feed (avendb/crates/avendb-server/src/feed.rs), a dev server's
 * middleware: `<at>/code?seed=1&type=recipe` the rows, `{ code: [...] }`, and `<at>/entry/<vault>/<entry>/file` an
 * entry's file, whole, as plain text no page runs; not found, as plain text, for any other. `feed` makes the stand-in
 * (`devFeedOf`), again whenever the repo's recipes changed.
 * @param {string} at where it is served (what ../vault.js `feedOf` reads in dev, without its /code)
 * @param {() => Promise<ReturnType<typeof devFeedOf>>} feed
 */
export function serveDevFeed(at, feed) {
	return async (req, res, next) => {
		const url = new URL(req.url ?? '/', 'http://dev.invalid');
		if (!url.pathname.startsWith(`${at}/`)) return next();
		const answer = (status, type, body) => {
			res.statusCode = status;
			res.setHeader('content-type', type);
			res.setHeader('x-content-type-options', 'nosniff');
			res.setHeader('cache-control', 'no-store');
			res.end(body);
		};
		try {
			const made = await feed();
			const rest = url.pathname.slice(at.length);
			if (rest === '/code') {
				const kinds = url.searchParams.get('type')?.split(',');
				return answer(200, 'application/json', JSON.stringify({ code: !kinds || kinds.includes('recipe') ? made.rows : [] }));
			}
			const m = /^\/entry\/([0-9a-f]{64})\/([0-9a-f]{64})\/file$/.exec(rest);
			const bytes = m && m[1] === made.vault ? made.files.get(m[2]) : undefined;
			if (bytes) return answer(200, 'text/plain; charset=utf-8', bytes);
			return answer(404, 'text/plain; charset=utf-8', 'not found');
		} catch (e) {
			return answer(503, 'text/plain; charset=utf-8', `the dev feed could not be made: ${e instanceof Error ? e.message : String(e)}`);
		}
	};
}
