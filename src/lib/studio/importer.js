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
 * Legacy timeline `id` brought into avenDB as a cut (or the cut it was brought as before), `tell` hearing how far:
 * into vault `into.vault`, acting as `into.as` (else the person's home vault, `homeOf`), named `into.name` and
 * `into.project` where given, linked to story `into.story` and tagged `into.tags` (./legacyfilms.js).
 * @param {string} id @param {(line: string) => void} [tell]
 * @param {{ vault?: string, as?: string, name?: string, project?: string, story?: { vault: string, entry: string }, tags?: string[] }} [into]
 * @returns {Promise<Timeline>}
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
	const t = await getTimeline(id);
	const hashes = filesOf(t);
	tell(`Bringing ${hashes.length} file${hashes.length === 1 ? '' : 's'} into avenDB…`);
	const { command } = await import('$lib/native');
	const brought = /** @type {{ hash: string, entry: string | null, error: string | null }[]} */ (await command('studio_import', { vault: home.vault, hashes, actor: home.as }));
	const failed = brought.filter((b) => b.error);
	if (failed.length) throw new Error(`${failed.length} of ${hashes.length} files could not be brought (${failed[0].hash.slice(0, 12)}…: ${failed[0].error}). Nothing else was made; import again to go on.`);
	world = await worldOf(call);
	/** @type {Map<string, string>} */
	const refs = new Map();
	for (const b of brought) {
		const e = world.entries.find((x) => x.entry === b.entry);
		const f = e?.files?.[0];
		if (!e || !f || f.len == null) throw new Error(`${b.hash.slice(0, 12)}… was brought, but this Mac can't open it yet.`);
		refs.set(b.hash, avenRef(f, e.media ?? e.record?.media));
	}
	tell('Bringing its world shots…');
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
		const s = await getShot(c.shot, c.shotVersion);
		await schemaIn(call, world, home.vault, SHOT_V1, home.as);
		const value = { kind: SHOT, shot: '', name: s.name, project: s.project ?? '', version: 1, spec: JSON.stringify(s.spec), legacy: k, at: Math.floor(Date.now() / 1000) };
		const made = answer(await call('run', { op: 'create', vault: home.vault, type: SHOT, value, as: home.as }));
		shots.set(k, { shot: `shot:${made.entry}`, version: 1 });
	}
	tell('Making the cut…');
	const named = Object.fromEntries(Object.entries({ name: into.name, project: into.project, story: into.story }).filter(([, v]) => v));
	const cut = await createCut({ ...moved(t, refs, shots), ...named, legacy: id }, { ...home, tags: into.tags ?? [] });
	const { nudge } = await import('./jobs/mac.js');
	nudge();
	return cut;
}
