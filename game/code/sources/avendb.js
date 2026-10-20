// @ts-nocheck — plain JS, kept loose on purpose
/**
 * avenDB AS THE SOURCE OF CODE ENTRIES (C10; Samuel 2026-10-17: every dynamic config and every piece of code our hosts
 * run goes through avenDB, engine code only by GitHub commits). The code lives in the seed's flat "Maia City" vault, a
 * code entry per view or logic module (avenDB's shipped "View" and "Logic" schemas, #830), found by its tags:
 *
 *   ref:<code path>     the path the loader names it by: ref:views/coop-chart, ref:configs/sandbox-5/rules
 *   game:<id>           the game it belongs to (sandbox-5, maiacity-v1); none for a Generated UI view
 *
 * A game's settings are code entries too (A3, Samuel 2026-10-19: game settings and sandbox configs belong to the Maia
 * City COOP): of type `config`, the vault's own "Config, v1" schema (src/lib/avendb/seed.js), their JSON as `data`;
 * no host runs them, and each is held to the shape of the repo's seed of it (../check.js `config`).
 *   legacy:<hash>       on what was copied from the repo: the repo entry's hash at the copy
 *
 * The loader (../index.js) reads them through this source once they are loaded (`loadCode`), and the repo's code/ is
 * the seed: what every page and the API run offline, before the first load, and for any path the vault does not hold.
 * What is loaded is what Maia City's own signed edits prove, checked by avenDB's WebAssembly where it runs, and nothing
 * the server says otherwise (H2, ./feed.js `provenRows`): a proof that doesn't check out loads nothing, and the seed
 * runs, as offline. A page that holds the person's avenDB open loads them off its own device instead, which checked
 * every edit as it took it, once it brought Maia City from its peers (./device.js `deviceRows`), the same rows. Either
 * way, an entry handed out at an older version than this device proved of it before is refused, saying so (../fresh.js):
 * a signature proves who wrote a version, not that it is the newest. Each entry comes back in the repo entry's own shape ({ ref, type, for, title, ..., files, hash }),
 * with its vault, entry and heads beside, checked by the one checker and held to an engine version the repo ships;
 * what fails either is left out and the seed's stays. Nothing here writes: `copyOf` makes the one batch the vault's
 * owner runs to copy the repo in.
 *
 * A ref `vault:<vault id>/<entry id>@<heads>` names one entry at one version, as avenDB pins one: it is served only
 * while the loaded entry is at those heads.
 */
import { hashText } from '../../hash.js';
import { canonical, jsonFile } from '../files.js';
import { checkCode } from '../check.js';
import { ENTRIES as SEED } from '../../../code/index.js';
import { CODE_FEED, MAIA_CITY, proofOf, provenRows } from './feed.js';
import { deviceRows } from './device.js';
import { KEPT_NEWEST, fresh } from '../fresh.js';
import { isFrozen, latestOf } from '../../engines.js';

/** the kinds of code entry this source carries, and the host each runs in */
const HOSTS = { view: 'view', logic: 'logic' };
/** and a game's settings, which no host runs */
const KINDS = [...Object.keys(HOSTS), 'config'];

/** where avenDB's server serves public code entries (its feed, as /feed/posts serves posts): { code: [row] } */
export { CODE_FEED };

/** where the loader reads the code entries: the proof of the views, logic modules and configs of Maia City's vault,
 * named by its id (./feed.js `MAIA_CITY`), never by its name nor by the server's say; `feed` where /feed/code is */
export const feedOf = (feed = CODE_FEED, vault = MAIA_CITY) => proofOf(KINDS, { vault, feed });

const PATH = /^(views|logic|configs)\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

export const hashOf = hashText;
const tagged = (tags, key) => (tags ?? []).find((t) => typeof t === 'string' && t.startsWith(`${key}:`))?.slice(key.length + 1);
const textOf = (v) => (v == null ? undefined : typeof v === 'string' ? v : jsonFile(v));
const objectOf = (text) => (text == null ? undefined : JSON.parse(text));
const shipped = (host, e) => isFrozen(host, e?.version, e?.hash);

/**
 * A repo entry as the record, type and tags the vault keeps it under: { type, tags, value }, value a code entry of
 * avenDB's View or Logic schema. `engine` is the engine version it is written for (the latest the repo ships).
 */
export function recordOf(e) {
	if (e.type === 'config') {
		const tags = [`ref:${e.ref}`, ...(e.for ? [`game:${e.for}`] : []), ...(e.hash ? [`legacy:${e.hash}`] : [])];
		return { type: 'config', tags, value: { kind: 'config', title: e.title ?? '', note: e.note ?? '', data: JSON.parse(e.files['config.json'] ?? '{}') } };
	}
	const host = HOSTS[e.type];
	if (!host) throw new Error(`${e.ref}: only views and logic modules are code entries, not ${e.type}`);
	const latest = latestOf(host);
	const tags = [`ref:${e.ref}`, ...(e.for && e.for !== 'genui' ? [`game:${e.for}`] : []), ...(e.hash ? [`legacy:${e.hash}`] : [])];
	const base = { kind: e.type, title: e.title ?? '', note: e.note ?? '', engine: { host, version: latest.v, hash: latest.blake3 } };
	if (e.type === 'logic') return { type: 'logic', tags, value: { ...base, source: e.files['logic.js'] ?? '', manifest: { hooks: e.hooks ?? [] } } };
	const form = e.kind ?? 'html';
	const value = {
		...base,
		form,
		source: (form === 'a2ui' ? e.files['a2ui.json'] : e.files['view.html']) ?? '',
		manifest: { libs: e.libs ?? [], slots: e.slot ? [e.slot] : [] },
		...(e.height != null ? { height: e.height } : {}),
		...(e.files['data.json'] != null ? { data: objectOf(e.files['data.json']) } : {}),
		...(e.files['input.json'] != null ? { input: objectOf(e.files['input.json']) } : {}),
		...(e.files['logic.js'] != null ? { logic: e.files['logic.js'] } : {})
	};
	return { type: 'view', tags, value };
}

/**
 * A row the vault hands out ({ entry, vault, type, tags, heads, record }) as a repo entry, or `{ error }`: the path its
 * ref tag names, its files as the repo keeps them, its hash as the repo makes one, and where in the vault it is.
 */
export function entryOf(row) {
	const r = row?.record ?? {};
	const ref = tagged(row?.tags, 'ref');
	const where = `entry ${String(row?.entry ?? '?').slice(0, 12)}…`;
	if (!ref || !PATH.test(ref)) return { error: `${where}: no ref:<views/…, logic/… or configs/…> tag` };
	if (ref.startsWith('configs/')) {
		if (row.type !== 'config' || r.kind !== 'config') return { error: `${ref}: a ${row.type ?? r.kind} entry under a config path` };
		const game = tagged(row.tags, 'game');
		if (!game) return { error: `${ref}: a config names its game (game:<id>)` };
		const entry = { type: 'config', for: game, title: r.title ?? '', ...(r.note ? { note: r.note } : {}) };
		const files = { 'config.json': jsonFile(r.data ?? {}) };
		const hash = hashOf(canonical({ entry, files }));
		return { entry: { ref, ...entry, files, hash, source: 'avendb', vault: row.vault, entry: row.entry, heads: row.heads } };
	}
	const type = ref.startsWith('views/') ? 'view' : 'logic';
	if (row.type !== type || r.kind !== type) return { error: `${ref}: a ${row.type ?? r.kind} entry under a ${type} path` };
	if (r.engine?.host !== HOSTS[type] || !shipped(HOSTS[type], r.engine)) return { error: `${ref}: written for ${HOSTS[type]} engine ${r.engine?.version ?? '?'}, which the repo does not ship` };
	const game = tagged(row.tags, 'game');
	const entry = { type, for: game ?? (type === 'view' ? 'genui' : undefined), title: r.title ?? '' };
	if (!entry.for) return { error: `${ref}: a logic module names its game (game:<id>)` };
	if (r.note) entry.note = r.note;
	const files = {};
	if (type === 'logic') {
		entry.card = ref.split('/').at(-1);
		entry.hooks = r.manifest?.hooks ?? [];
		files['logic.js'] = r.source ?? '';
	} else {
		entry.kind = r.form === 'a2ui' ? 'a2ui' : 'html';
		if (r.manifest?.slots?.[0]) entry.slot = r.manifest.slots[0];
		if (entry.kind === 'html') {
			entry.libs = r.manifest?.libs ?? [];
			if (r.height != null) entry.height = r.height;
			files['view.html'] = r.source ?? '';
		} else files['a2ui.json'] = r.source ?? '';
		for (const [name, v] of [['data.json', textOf(r.data)], ['input.json', textOf(r.input)], ['logic.js', r.logic || undefined]]) if (v != null) files[name] = v;
	}
	const hash = hashOf(canonical({ entry: JSON.parse(JSON.stringify(entry)), files }));
	// the engine it names, beside where it is (not part of what the repo hashes): its host runs it there (H4)
	return { entry: { ref, ...JSON.parse(JSON.stringify(entry)), files, hash, source: 'avendb', vault: row.vault, entry: row.entry, heads: row.heads, engine: r.engine.version } };
}

/**
 * What the one checker says of an entry: in write mode, as at the API's door, since nothing checked it on its way into
 * the vault (avenDB keeps what fits its schema; what our hosts may run is ours to say)
 */
function checked(e, viewOf) {
	if (e.type === 'config') {
		const seed = SEED[e.ref];
		return checkCode('config', JSON.parse(e.files['config.json']), { seed: seed?.type === 'config' ? JSON.parse(seed.files['config.json']) : undefined });
	}
	if (e.type === 'logic') return checkCode('logic', { code: e.files['logic.js'], hooks: e.hooks });
	return checkCode('view', viewOf(e));
}

/** the loaded entries, by path; empty until `use` or `loadCode` fills them */
let loaded = {};
/** why a path runs nothing, where its row was older than the newest this device proved of it (../fresh.js) */
let stale = {};

export const avendb = {
	/**
	 * whether code is loaded from the vault's feed (avenDB's /feed/code, #862): on since Samuel switched it on
	 * (2026-10-17); false sends every page and the API back to the seed alone
	 */
	on: true,
	/** the loaded entry at `path`, or null @param {string} path */
	byPath: (path) => loaded[path] ?? null,
	/**
	 * why the vault's entry at `path` runs nowhere, where the version handed out of it was older than the newest this
	 * device proved (../fresh.js) and none of it was loaded before: the loader refuses the path, saying so, rather than
	 * run the seed's or an older one in silence; undefined otherwise @param {string} path
	 */
	staleAt: (path) => (loaded[path] ? undefined : stale[path]),
	/** every loaded entry @returns {Record<string, any>} */
	all: () => loaded,
	/**
	 * Take in the rows the vault handed out: each becomes a repo-shaped entry if it maps, checks and names an engine the
	 * repo ships; returns what was taken and what was left out (and why). `viewOf` is ../index.js `viewOfEntry`.
	 * `older` are rows held back as older than the newest this device proved of their entries (../fresh.js `fresh`,
	 * each `{ row, error }`): what was loaded of such a path before stays, a version at least as new, else the path
	 * runs nothing and says why (`staleAt`).
	 */
	use(rows, viewOf, older = []) {
		const next = {};
		const twice = new Set();
		const refused = [];
		for (const row of rows ?? []) {
			// an entry the vault deleted (tagged so: src/lib/avendb/seed.js GONE) runs nowhere
			if ((row?.tags ?? []).includes('avendb:deleted')) continue;
			const m = entryOf(row);
			if (m.error) {
				refused.push(m.error);
				continue;
			}
			const c = checked(m.entry, viewOf);
			if (!c.ok) refused.push(`${m.entry.ref}: ${c.errors.join(' ')}`);
			else if (next[m.entry.ref] || twice.has(m.entry.ref)) {
				// which of two is meant, no reader could say: neither runs, and the seed's stays
				refused.push(`${m.entry.ref}: held twice in the vault (entries ${(next[m.entry.ref]?.entry ?? '?').slice(0, 8)}…, ${m.entry.entry.slice(0, 8)}…)`);
				twice.add(m.entry.ref);
				delete next[m.entry.ref];
			} else next[m.entry.ref] = m.entry;
		}
		const held = {};
		for (const { row, error } of older) {
			refused.push(error);
			const path = tagged(row?.tags, 'ref');
			if (!path || next[path] || twice.has(path)) continue;
			if (loaded[path]?.entry === row.entry) next[path] = loaded[path];
			else held[path] = error;
		}
		loaded = next;
		stale = held;
		return { taken: Object.keys(next).sort(), refused };
	},
	/** the entry a vault ref names, at its heads (../ref.js `parseEntryRef`) @param {{ vault: string, entry: string, heads: string[] }} ref */
	at(ref) {
		const e = Object.values(loaded).find((x) => x.vault === ref.vault && x.entry === ref.entry);
		if (!e) throw new Error(`code entry ${ref.entry.slice(0, 12)}… of vault ${ref.vault.slice(0, 12)}… is not loaded`);
		const heads = (Array.isArray(e.heads) ? e.heads : String(e.heads ?? '').split(',')).filter(Boolean).sort().join(',');
		if (heads !== [...ref.heads].sort().join(',')) throw new Error(`${e.ref} is at other heads now than ${ref.heads[0].slice(0, 12)}…`);
		return e;
	}
};

/**
 * Load the vault's code entries, off the page's own avenDB where it holds one open that brought Maia City from its
 * peers (./device.js `deviceRows`), else as Maia City's own signed edits prove them (H2, ./feed.js `provenRows`): {
 * taken, refused } or { error } (no anchor, offline, a proof that doesn't check out), and on any failure what was
 * loaded before stays, else the seed: never a row the proof didn't prove, nor one the device didn't check. `viewOf` is
 * ../index.js `viewOfEntry`; `feed` where /feed/code is, on the API the server's own feed inside (AVENDB_FEED); `vault`
 * the anchor, Maia City's id (`MAIA_CITY`); `url` the proof's address (`feedOf`); `verify` and `keep` as `provenRows`
 * takes them (a test's); `device` false reads the feed whatever the page holds open. Either way, an entry whose version
 * is older than the newest this device proved of it before is refused, naming both (../fresh.js `fresh`, the newest
 * kept in `newest`), and what is taken is kept as its newest.
 */
export async function loadCode(viewOf, { feed = CODE_FEED, vault = MAIA_CITY, url = feedOf(feed, vault), fetch: get = globalThis.fetch, timeout = 4000, verify, keep, device = true, newest = KEPT_NEWEST } = {}) {
	if (!avendb.on) return { error: 'code from avenDB is switched off' };
	/** rows a device checked or a proof proved, held to the newest of each entry proved before, and kept as it */
	const taken = (rows) => {
		const f = fresh(rows, { proven: true, keep: newest });
		return avendb.use(f.rows, viewOf, f.stale);
	};
	const local = device ? await deviceRows(KINDS, { vault }) : null;
	if (local) return taken(local);
	const got = await provenRows(url, { vault, kinds: KINDS, fetch: get, timeout, ...(verify ? { verify } : {}), ...(keep ? { keep } : {}) });
	return 'error' in got ? got : taken(got.rows);
}

/**
 * The one batch the Maia City vault's owner runs (one ceremony) to copy the repo's code entries in: a create per
 * entry, acting as the vault. `entries` are the repo's (../index.js ENTRIES' values). A batch is not atomic (avenDB
 * runs its ops one by one), so a rerun must not copy twice: `have` is what the vault already holds (the feed's rows,
 * or any { tags }), and every path one of them names by its ref tag is left out, whatever it holds now, since from
 * the copy on the vault is where that code changes. The first copy (`have` null) starts by opening the vault's views
 * and logic modules to everyone, by type, now and later, as the feed reads them (the repo they come from is public),
 * so whatever of it went in before a stop shows on the feed, and a rerun reads it there; with `server`, the id of
 * avenMAIA's vault, it first gives the server a Backup share, without which the feed has nothing to show (the
 * page's "server keeps a copy" does the same).
 */
export function copyOf(entries, vault, { have = null, server = null } = {}) {
	const hex = (id) => /^[0-9a-f]{64}$/.test(String(id));
	if (!hex(vault)) throw new Error('the vault is its id, 64 hex digits');
	if (server != null && !hex(server)) throw new Error("the server's vault is its id, 64 hex digits");
	const held = new Set((have ?? []).map((r) => tagged(r?.tags, 'ref')).filter(Boolean));
	const ops = entries
		.filter((e) => HOSTS[e.type] && !held.has(e.ref))
		.map((e) => recordOf(e))
		.map(({ type, tags, value }) => ({ op: 'create', vault, type, tags, schema: type, value }));
	const share = { op: 'share', over: vault, who: 'everyone', level: 'Public', what: { type: Object.keys(HOSTS) }, as: vault };
	// the server serves only what it holds: a Backup share to its vault (avenMAIA) makes it keep the vault's entries
	const keep = server ? [{ op: 'share', over: vault, who: { vault: server }, level: 'Backup', as: vault }] : [];
	return { op: 'batch', ops: have ? ops : [...keep, share, ...ops], as: vault };
}
