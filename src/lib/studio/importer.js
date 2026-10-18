/*
 * Import from the legacy studio, by hand only (plan JI): one legacy timeline brought into avenDB as a cut of its own,
 * with exactly the footage it plays. Nothing is ever imported by itself; the legacy timeline, its vault and Postgres
 * stay as they are.
 *
 * Each file a clip plays is copied, never moved: read in place from the legacy vault and put into the person's home
 * vault (vault/app/src/aven.rs `studio_import`), checked against its legacy hash, with its legacy transcript and
 * analysis beside it so the rules take them instead of making them again (./jobs/executors.js `legacyValue`). Each
 * world shot it plays comes along as a shot of avenDB's at that version (./avenshots.js). Importing the same
 * timeline or file twice finds what is there (`legacy` on the cut and shot, `legacy:<hash>` on the file) and adds
 * nothing.
 */

import { answer } from '$lib/avendb/ops.js';
import { avenRef, isAven } from './avenref.js';
import { SHOT, SHOT_V1, shotFrom } from './avenshots.js';
import { CUT, createCut, device, homeOf, schemaIn, timelineOf, worldOf } from './cuts.js';

/** @typedef {import('$lib/auth/client').Timeline} Timeline */

const HASH = /^[0-9a-f]{64}$/;

/**
 * `p`, or why not once `ms` pass with no answer: the legacy studio's API runs in a container on the Mac
 * (localhost:3100), and where it is stopped a call waits for ever, so the import would never say anything.
 * @template T @param {Promise<T>} p @param {number} [ms]
 */
export function legacyCall(p, ms = 20000) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	const late = new Promise((_, no) => (timer = setTimeout(() => no(new Error("the old studio's API doesn't answer (is OrbStack running on this Mac?)")), ms)));
	return /** @type {Promise<T>} */ (Promise.race([p, late]).finally(() => clearTimeout(timer)));
}

/** The legacy vault's files timeline `t` plays, by hash, each once (a world clip's shot is no file). @param {any} t */
export function filesOf(t) {
	const out = new Set();
	for (const c of t.clips ?? []) if (c.kind !== 'world' && typeof c.hash === 'string' && !isAven(c.hash) && HASH.test(c.hash)) out.add(c.hash);
	return [...out];
}

/**
 * Timeline `t` with its files and world shots named as avenDB names them.
 * @param {any} t @param {Map<string, string>} refs legacy hash → reference (./avenref.js `avenRef`)
 * @param {Map<string, { shot: string, version: number }>} shots `<shot>@<version>` → avenDB's shot and version
 */
export function moved(t, refs, shots) {
	const clips = (t.clips ?? []).map((/** @type {any} */ c) => {
		if (c.kind === 'world') {
			const s = shots.get(`${c.shot}@${c.shotVersion}`);
			return s ? { ...c, shot: s.shot, shotVersion: s.version } : c;
		}
		return typeof c.hash === 'string' && refs.has(c.hash) ? { ...c, hash: refs.get(c.hash) } : c;
	});
	return { ...t, clips };
}

/**
 * How far an import is: `done` of `total` files brought (`part` of the one coming now, 0 to 1), and the files that
 * could not be, each with why.
 * @typedef {{ done: number, total: number, part: number, failed: { hash: string, error: string }[] }} Progress
 */

/**
 * Legacy timeline `id` brought into avenDB as a cut (or the cut it was brought as before), `tell` hearing how far:
 * into vault `into.vault`, acting as `into.as` (else the person's home vault, `homeOf`), named `into.name` and
 * `into.project` where given, linked to story `into.story` and tagged `into.tags` (./legacyfilms.js). The files come
 * one at a time; one that can't come (not in the legacy vault on this Mac, a copy that doesn't match) is left out
 * and told (`failed`), and the cut is made of the rest, its clip keeping the legacy hash, as no file plays it.
 * @param {string} id @param {(line: string, at: Progress) => void} [tell]
 * @param {{ vault?: string, as?: string, name?: string, project?: string, story?: { vault: string, entry: string }, tags?: string[] }} [into]
 * @returns {Promise<Timeline & { failed?: Progress['failed'] }>}
 */
export async function importTimeline(id, tell = () => {}, into = {}) {
	const call = await device();
	if (!call) throw new Error('Importing into avenDB works in the Mac app, with avenDB open.');
	let world = await worldOf(call);
	const home = into.vault && into.as ? { vault: into.vault, as: into.as } : homeOf(world);
	if (!home) throw new Error('No avenDB vault to bring it into.');
	const before = world.entries.find((e) => e.vault === home.vault && e.type === CUT && e.record?.legacy === id && !e.deleted && !(e.tags ?? []).includes('avendb:deleted'));
	if (before) return timelineOf(before);
	const { getShot, getTimeline } = await import('$lib/auth/client');
	const t = await legacyCall(getTimeline(id));
	const hashes = filesOf(t);
	/** @type {Progress} */
	const at = { done: 0, total: hashes.length, part: 0, failed: [] };
	const say = () => tell(`${at.done} of ${at.total} files${at.failed.length ? ` (${at.failed.length} missing)` : ''}`, { ...at });
	say();
	const { command } = await import('$lib/native');
	const { listen } = await import('@tauri-apps/api/event');
	// how far the file coming now is, as the Mac tells it, at most a few times a second
	let last = 0;
	const unlisten = await listen('studio-import', ({ payload }) => {
		const p = /** @type {{ done: number, len: number }} */ (payload);
		if (Date.now() - last < 250) return;
		last = Date.now();
		at.part = Math.min(1, p.done / Math.max(1, p.len));
		say();
	});
	/** @type {{ hash: string, entry: string | null, error: string | null }[]} */
	const brought = [];
	try {
		for (const hash of hashes) {
			at.part = 0;
			const [b] = /** @type {typeof brought} */ (await command('studio_import', { vault: home.vault, hashes: [hash], actor: home.as }).catch((e) => [{ hash, entry: null, error: String(e?.message ?? e) }]));
			if (b?.error || !b?.entry) at.failed.push({ hash, error: b?.error ?? 'no entry was made' });
			else brought.push(b);
			at.done++;
			say();
		}
	} finally {
		unlisten();
	}
	if (hashes.length && !brought.length) throw new Error(`None of its ${hashes.length} files could be brought (${at.failed[0]?.error}).`);
	world = await worldOf(call);
	/** @type {Map<string, string>} */
	const refs = new Map();
	for (const b of brought) {
		const e = world.entries.find((x) => x.entry === b.entry);
		const f = e?.files?.[0];
		if (!e || !f || f.len == null) throw new Error(`${b.hash.slice(0, 12)}… was brought, but this Mac can't open it yet.`);
		refs.set(b.hash, avenRef(f, e.media ?? e.record?.media));
	}
	tell('Bringing its world shots…', { ...at });
	/** @type {Map<string, { shot: string, version: number }>} */
	const shots = new Map();
	for (const c of /** @type {any[]} */ (t.clips ?? [])) {
		if (c.kind !== 'world' || typeof c.shot !== 'string' || c.shot.startsWith('shot:')) continue;
		const k = `${c.shot}@${c.shotVersion}`;
		if (shots.has(k)) continue;
		const had = world.entries.find((e) => e.type === SHOT && e.record?.legacy === k && !e.deleted);
		if (had) {
			shots.set(k, { shot: shotFrom(had).id, version: had.record?.version ?? 1 });
			continue;
		}
		const s = await legacyCall(getShot(c.shot, c.shotVersion));
		await schemaIn(call, world, home.vault, SHOT_V1, home.as);
		const value = { kind: SHOT, shot: '', name: s.name, project: s.project ?? '', version: 1, spec: JSON.stringify(s.spec), legacy: k, at: Math.floor(Date.now() / 1000) };
		const made = answer(await call('run', { op: 'create', vault: home.vault, type: SHOT, value, as: home.as }));
		shots.set(k, { shot: `shot:${made.entry}`, version: 1 });
	}
	tell('Making the cut…', { ...at });
	const named = Object.fromEntries(Object.entries({ name: into.name, project: into.project, story: into.story }).filter(([, v]) => v));
	const cut = await createCut({ ...moved(t, refs, shots), ...named, legacy: id }, { ...home, tags: into.tags ?? [] });
	const { nudge } = await import('./jobs/mac.js');
	nudge();
	return at.failed.length ? { ...cut, failed: at.failed } : cut;
}
