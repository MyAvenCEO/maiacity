/*
 * Import from the legacy studio (plan JI): one legacy timeline, as it is frozen (./frozen.js), brought into avenDB as a
 * cut of its own, with exactly the footage it plays. The legacy vault and Postgres stay as they are.
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
import { isVideo, proxyFor } from './color.js';
import { CUT, createCut, device, homeOf, schemaIn, shootable, timelineOf, worldOf } from './cuts.js';

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
 * How far an import is: `done` of `total` files brought (`part` of the one coming now, 0 to 1), and the files that
 * could not be, each with why.
 * @typedef {{ done: number, total: number, part: number, failed: { hash: string, error: string }[] }} Progress
 */

/**
 * Legacy timeline `id` brought into avenDB as a cut (or the cut it was brought as before), `tell` hearing how far:
 * into vault `into.vault`, acting as `into.as` (else the person's home vault, `homeOf`), named `into.name` and
 * `into.project` where given, linked to story `into.story` and tagged `into.tags` (./legacyfilms.js); from its frozen
 * copy `into.frozen` (./frozen.js: the repo's, else the Mac's film seed), without which nothing comes. The files come
 * one at a time; one that can't come (not in the legacy vault on this Mac, a copy that doesn't match) is left out
 * and told (`failed`), and the cut is made of the rest, its clip keeping the legacy hash, as no file plays it.
 * @param {string} id @param {(line: string, at: Progress) => void} [tell]
 * @param {{ vault?: string, as?: string, name?: string, project?: string, story?: { vault: string, entry: string }, tags?: string[], frozen?: import('./frozen.js').Frozen }} [into]
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
	// only a frozen film comes: the old studio's API is no longer asked
	const frozen = into.frozen;
	if (!frozen) throw new Error('Only a frozen film is brought into avenDB (./frozen.js).');
	const t = frozen.timeline;
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
	// their proxies first, so the proxy rule finds each one there when its original comes (./jobs/executors.js)
	tell('Bringing the footage’s proxies…', { ...at });
	await bringFootageProxies(home.vault, home.as, [frozen], hashes).catch((e) => console.warn('footage proxies:', e));
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
		const s = frozen.shots[k];
		await schemaIn(call, world, home.vault, SHOT_V1, home.as);
		const value = { kind: SHOT, shot: '', name: s.name, project: s.project ?? '', version: 1, spec: JSON.stringify(s.spec), legacy: k, at: Math.floor(Date.now() / 1000) };
		const made = answer(await call('run', { op: 'create', vault: home.vault, type: SHOT, value, as: home.as }));
		shots.set(k, { shot: `shot:${made.entry}`, version: 1 });
	}
	tell('Bringing the world shots’ proxies…', { ...at });
	await bringProxies(home.vault, home.as, [frozen]).catch((e) => console.warn('world proxies:', e));
	tell('Making the cut…', { ...at });
	const named = Object.fromEntries(Object.entries({ name: into.name, project: into.project, story: into.story }).filter(([, v]) => v));
	const cut = await createCut({ ...moved(t, refs, shots), ...named, legacy: id }, { ...home, tags: into.tags ?? [] });
	const { nudge } = await import('./jobs/mac.js');
	nudge();
	return at.failed.length ? { ...cut, failed: at.failed } : cut;
}

/** The key a footage proxy is kept by in a film seed's `proxies`, beside the world shots' `<shot>@<version>`. */
const FOOTAGE = 'footage:';

/**
 * The HD proxy the old studio played each of `hashes` from (legacy originals' hashes), brought into vault `vault`
 * tagged `media:proxy` and that original's `legacy:<hash>`, acting as `as`, where the vault has none yet: the proxy rule
 * takes it instead of making it again (./jobs/executors.js), as the words and the analysis are. Until then a timeline
 * of footage played from its 4K originals, and the 8 GB Mac remade every proxy while it played. From the film seed of
 * `frozen`'s films (`footage:<hash>` in its `proxies`; `studio_import` reads the seed only); one the seed lacks yet is
 * found in the legacy vault while this Mac still has it (an original's `meta.proxy`, an ACEScct one) and kept into
 * the seed of the film that plays it (`film_seed_keep`), so the next reset needs no legacy vault. How many it brought.
 * @param {string} vault @param {string} as @param {import('./frozen.js').Frozen[]} frozen
 * @param {string[]} [hashes] the originals, by default every file the films play
 */
export async function bringFootageProxies(vault, as, frozen, hashes = frozen.flatMap((f) => f.files ?? [])) {
	const call = await device();
	if (!call || !frozen.length) return 0;
	const world = await worldOf(call);
	const has = new Set(world.entries.filter((e) => e.vault === vault && !e.deleted && (e.tags ?? []).includes('media:proxy')).flatMap((e) => e.tags ?? []));
	const wanted = [...new Set(hashes.map((h) => h.toLowerCase()))].filter((h) => !has.has(`legacy:${h}`));
	if (!wanted.length) return 0;
	const { command } = await import('$lib/native');
	/** each proxy known, by its original's hash */
	const known = new Map(
		frozen.flatMap((f) =>
			Object.entries(f.proxies ?? {})
				.filter(([k]) => k.startsWith(FOOTAGE))
				.map(([k, p]) => /** @type {const} */ ([k.slice(FOOTAGE.length).toLowerCase(), p]))
		)
	);
	const lacking = wanted.filter((h) => !known.has(h));
	if (lacking.length) {
		const files = /** @type {import('$lib/auth/client').MediaItem[]} */ (await command('vault_list').catch(() => []));
		const byHash = new Map(files.map((m) => [m.hash, m]));
		for (const h of lacking) {
			const m = byHash.get(h);
			const p = m && isVideo(m) ? proxyFor(m, (x) => byHash.get(x)).hash : null;
			if (p) known.set(h, p);
		}
		// kept into the seed of the film each belongs to
		for (const f of frozen) {
			const mine = new Set((f.files ?? []).map((h) => h.toLowerCase()));
			const keep = Object.fromEntries(lacking.filter((h) => mine.has(h) && known.has(h)).map((h) => [`${FOOTAGE}${h}`, known.get(h)]));
			if (Object.keys(keep).length) await command('film_seed_keep', { key: f.key, proxies: keep }).catch((e) => console.warn(`the film seed of ${f.name}:`, e));
		}
	}
	let n = 0;
	for (const h of wanted) {
		const p = known.get(h);
		if (!p) continue;
		const [b] = /** @type {{ entry: string | null, error: string | null }[]} */ (
			await command('studio_import', { vault, hashes: [p], actor: as, tags: ['media:proxy', `legacy:${h}`] }).catch((e) => [{ entry: null, error: String(e?.message ?? e) }])
		);
		if (b?.entry) n++;
		else console.warn(`the proxy of ${h.slice(0, 12)}…:`, b?.error);
	}
	return n;
}

/** The tag a world shot version's proxy carries, naming the shot and version it stands for. @param {string} shot `shot:<entry>` @param {number} version */
export const proxyTag = (shot, version) => `proxy:${shot}:${version}`;

/**
 * Each world shot of vault `vault` brought from the legacy studio (its `legacy` names `<shot>@<version>`) with no
 * proxy there yet, its proxy brought, tagged `media:proxy` and `proxyTag`, acting as `as`: from the film seed of
 * `frozen`'s film that names it (its `proxies`, the bytes beside the films' files, which `studio_import` reads first).
 * One the seed lacks yet comes from the legacy vault while this Mac still has it, and is kept into that film's seed on
 * the way (`film_seed_keep`), so the next reset needs no legacy vault. A shot whose world the film camera no longer has
 * (game/film/worlds.js: the room, the Isar, the Backyard) plays only from it. One in a world it has plays from it
 * until its world is live, as the old studio played it: the dome cell builds each shot's place in 20 to 60 s and
 * gigabytes, more than an 8 GB Mac keeps up with live, and one the old studio never rendered is rendered in that
 * world, as avenDB holds it (./cuts.js `proxiesOf`). How many it brought.
 * @param {string} vault @param {string} as @param {import('./frozen.js').Frozen[]} [frozen]
 */
export async function bringProxies(vault, as, frozen = []) {
	const call = await device();
	if (!call) return 0;
	const world = await worldOf(call);
	const has = new Set(world.entries.filter((e) => e.vault === vault && !e.deleted && (e.tags ?? []).includes('media:proxy')).flatMap((e) => e.tags ?? []));
	const wanted = world.entries
		.filter((e) => e.vault === vault && e.type === SHOT && !e.deleted && typeof e.record?.legacy === 'string')
		.map((e) => ({ shot: shotFrom(e), legacy: /** @type {string} */ (e.record?.legacy).toLowerCase() }))
		.filter((w) => !has.has(proxyTag(w.shot.id, w.shot.version)));
	if (!wanted.length) return 0;
	const { command } = await import('$lib/native');
	/** each proxy known, by `<shot>@<version>` */
	const known = new Map(frozen.flatMap((f) => Object.entries(f.proxies ?? {}).map(([k, h]) => /** @type {const} */ ([k.toLowerCase(), h]))));
	const lacking = wanted.filter((w) => !known.has(w.legacy));
	if (lacking.length) {
		// the legacy vault's world proxies (vault/app/src/world.rs: a video file naming the shot and version), the newest first
		const files = /** @type {{ hash: string, kind: string, meta?: Record<string, any> }[]} */ (await command('vault_list').catch(() => []));
		/** @type {Map<string, string>} */
		const legacy = new Map();
		for (const m of files) {
			if (m.kind !== 'video' || !m.meta?.shot || m.meta.shotVersion == null) continue;
			const k = `${String(m.meta.shot).toLowerCase()}@${Number(m.meta.shotVersion)}`;
			if (!legacy.has(k)) legacy.set(k, m.hash);
		}
		for (const w of lacking) {
			const [shot, version] = w.legacy.split('@');
			const hash = legacy.get(`${shot}@${Number(version)}`);
			if (hash) known.set(w.legacy, hash);
		}
		// kept into the seed of the film each belongs to
		for (const f of frozen) {
			const keep = Object.fromEntries(Object.keys(f.shots).map((k) => k.toLowerCase()).filter((k) => lacking.some((w) => w.legacy === k) && known.has(k)).map((k) => [k, known.get(k)]));
			if (Object.keys(keep).length) await command('film_seed_keep', { key: f.key, proxies: keep }).catch((e) => console.warn(`the film seed of ${f.name}:`, e));
		}
	}
	let n = 0;
	for (const w of wanted) {
		const hash = known.get(w.legacy);
		if (!hash) {
			// one in a world the camera has is rendered there instead
			if (!shootable(w.shot.spec)) console.warn(`world proxy of ${w.shot.name}: neither the film seed nor the legacy vault has one`);
			continue;
		}
		const [b] = /** @type {{ entry: string | null, error: string | null }[]} */ (await command('studio_import', { vault, hashes: [hash], actor: as, tags: ['media:proxy', proxyTag(w.shot.id, w.shot.version)] }));
		if (b?.entry) n++;
		else console.warn(`world proxy of ${w.shot.name}:`, b?.error);
	}
	return n;
}
