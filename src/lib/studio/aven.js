/*
 * The studio's footage from avenDB (Jobs and studio 2.0, J1-J7 in the studio's views): every original a vault of the
 * person holds, with what the rules made of it (./jobs/rules.js: probe, proxy, still, transcript, analysis), as the
 * studio's library items (`MediaItem`, ./types.js), with avenDB as their only storage owner.
 *
 * An avenDB file is named where the legacy studio names a vault file by its hash, by a reference that carries what reading
 * it takes: `aven:<root>:<sealed size>:<length>:<media type>` (`avenRef`). The Mac app's Rust reads it in place through
 * avenDB's device (vault/app/src/aven.rs `source_of_ref`: the player, the jobs), the page through `aven://` (`avenUrl`).
 */

import { madeIndex, tasksOf } from './jobs/tasks.js';
import { collectionEntries } from './collection-entries.js';

export { avenRef, avenUrl, isAven } from '../media/ref.js';
import { avenRef, avenUrl } from '../media/ref.js';

/** @param {string} s */
const parse = (s) => {
	try {
		return s ? JSON.parse(s) : null;
	} catch {
		return null;
	}
};

/** The kind the studio sorts a file by, from its media type. @param {string} media */
const kindOf = (media) => (media.startsWith('video/') ? 'video' : media.startsWith('audio/') ? 'audio' : media.startsWith('image/') ? 'image' : 'other');

/**
 * The studio's library items for avenDB's footage in `world`: each original (`media:original`) with its probe, proxy,
 * grading still and preview, transcript and analysis as the legacy studio's meta names them, and each file a rule made
 * as an item of class `proxy` that names what it stands for, so the views show originals and play their proxies.
 * Only files this device can open.
 * @param {import('../avendb/vaults.js').WorldView} world
 * @returns {import('./types.js').MediaItem[]}
 */
export function libraryOf(world) {
	const byId = new Map(world.entries.map((e) => [e.entry, e]));
	const tasks = tasksOf(world);
	const made = madeIndex(tasks);
	// each file's newest graded still (the `frame` rule, of a cut that grades it), by the file's reference
	/** @type {Map<string, import('./jobs/tasks.js').Task & { value: any }>} */
	const graded = new Map();
	for (const t of tasks) {
		if (t.rule !== 'frame' || t.status !== 'done') continue;
		const v = parse(t.result);
		if (v?.kind !== 'graded' || !v.of) continue;
		if ((graded.get(v.of)?.at ?? -1) < t.at) graded.set(v.of, { ...t, value: v });
	}
	/** @param {string | undefined} id */
	const fileOf = (id) => {
		const e = id ? byId.get(id) : undefined;
		const f = e?.files?.[0];
		return e && !e.deleted && f && f.len != null ? { e, f, ref: avenRef(f, e.media ?? e.record?.media) } : null;
	};
	/** @param {string} rule @param {string} id */
	const task = (rule, id) => made.get(`${rule}:${id}`);
	/** @type {import('./types.js').MediaItem[]} */
	const out = [];
	const added = (/** @type {any} */ e) => new Date((e.created ?? 0) * 1000).toISOString();
	for (const e of world.entries) {
		if (e.deleted || e.type !== 'file' || !(e.tags ?? []).includes('media:original')) continue;
		const own = fileOf(e.entry);
		if (!own) continue;
		const media = e.media ?? e.record?.media ?? 'application/octet-stream';
		const probe = parse(task('probe', e.entry)?.result ?? '');
		const proxy = fileOf(task('proxy', e.entry)?.outputs?.[0]);
		const stillTask = task('still', e.entry);
		const g = graded.get(own.ref);
		const gradedPreview = fileOf(g?.outputs?.[0]);
		if (gradedPreview) graded.delete(own.ref);
		const [still, preview] = [fileOf(stillTask?.outputs?.[0]), gradedPreview ?? fileOf(stillTask?.outputs?.[1])];
		// a long value is in a JSON file of its own (vault/app/src/aven.rs `spill`): its address, read by `avenLibrary`
		const transcript = parse(task('transcript', e.entry)?.result ?? '');
		const analysis = parse(task('analysis', e.entry)?.result ?? '');
		const spilled = (/** @type {any} */ v) => (v?.file ? fileOf(v.file)?.ref : undefined);
		const title = e.title ?? e.record?.title ?? 'a file';
		/** @type {Record<string, unknown>} */
		const meta = {
			aven: { entry: e.entry, vault: e.vault },
			// a profile set by hand rides on the probe's journey (./cuts.js `setProfile`), the detected one beside it
			...(probe?.journey ? { color: { profile: probe.journey.detected ?? probe.journey.profile, from: probe.journey.from, ...(probe.journey.override ? { override: probe.journey.override } : {}) } } : {}),
			...(probe ? { probe: { ...(probe.picture ?? {}), audio: probe.audio, timecode: probe.timecode, timecode_fps: probe.timecode_fps }, duration: probe.seconds, fps: probe.fps ?? probe.picture?.fps } : {}),
			...(proxy ? { proxy: proxy.ref } : {}),
			...(still ? { grade_still: still.ref, still_at: parse(stillTask?.result ?? '')?.t } : {}),
			...(preview ? { preview: preview.ref } : {}),
			...(transcript ? { transcript, transcript_state: transcript.state ?? 'done', transcript_file: spilled(transcript) } : {}),
			...(analysis ? { analysis, analysis_state: analysis.state ?? 'done', hero: analysis.hero, analysis_file: spilled(analysis) } : {})
		};
		out.push({ hash: own.ref, mime: media, kind: kindOf(media), size: own.f.len ?? 0, added: added(e), title, description: '', tags: (e.tags ?? []).filter((t) => t !== 'media:original'), meta, public: false, original_name: title, class: 'original' });
		const madeItem = (/** @type {NonNullable<ReturnType<typeof fileOf>>} */ m, /** @type {Record<string, unknown>} */ extra) => {
			const mm = m.e.media ?? m.e.record?.media ?? 'application/octet-stream';
			out.push({ hash: m.ref, mime: mm, kind: kindOf(mm), size: m.f.len ?? 0, added: added(m.e), title: m.e.title ?? title, description: '', tags: [], meta: { aven: { entry: m.e.entry, vault: m.e.vault }, ...extra }, public: false, original_name: m.e.title ?? title, class: 'proxy' });
		};
		if (proxy) madeItem(proxy, { role: 'proxy', proxy_of: own.ref, color: { profile: 'acescct', from: 'our own tag' } });
		if (still) madeItem(still, { role: 'grade-still', grade_still_of: own.ref, color: { profile: 'acescct', from: 'our own tag' } });
		if (preview) madeItem(preview, { role: 'preview', preview_of: own.ref, ...(gradedPreview ? { graded: { timeline: g?.value.cut, clip: g?.value.clip } } : {}) });
	}
	// a graded still of a legacy vault's file a cut plays: its preview, set on it by `withGraded`
	for (const [of, g] of graded) {
		const m = fileOf(g.outputs?.[0]);
		if (m) out.push(itemOf(m, 'proxy', { role: 'preview', preview_of: of, graded: { timeline: g.value.cut, clip: g.value.clip } }));
	}
	// each world shot version's proxy (the studio finds a world clip's by its shot and version)
	for (const t of tasks) {
		if (t.status !== 'done' || t.rule !== 'world-proxy') continue;
		const v = parse(t.result);
		const m = fileOf(t.outputs?.[0]);
		if (m && v?.shot) out.push(itemOf(m, 'proxy', { role: 'proxy', shot: v.shot, shotVersion: v.shotVersion, shape: v.shape, width: v.width, height: v.height, fps: v.fps, duration_s: v.seconds, color: { profile: 'acescct', from: 'our own tag' } }, ['proxy', 'world shot']));
	}
	// each legacy world shot's proxy, brought into avenDB once from the old vault, by its tag
	for (const e of world.entries) {
		const tag = (e.tags ?? []).find((t) => t.startsWith('proxy:shot:'));
		const m = tag && (e.tags ?? []).includes('media:proxy') ? fileOf(e.entry) : null;
		if (!m || !tag) continue;
		const [, shot, entry, version] = tag.split(':');
		out.push(itemOf(m, 'proxy', { role: 'proxy', shot: `${shot}:${entry}`, shotVersion: Number(version), color: { profile: 'acescct', from: 'our own tag' } }, ['proxy', 'world shot']));
	}
	// what cuts made: their renders' deliveries, and their hero frames
	for (const t of tasks) {
		if (t.status !== 'done' || (t.rule !== 'render' && t.rule !== 'frame')) continue;
		const v = parse(t.result);
		const cut = t.inputs[0] ? `cut:${t.inputs[0].entry}` : null;
		if (t.rule === 'frame' && v?.kind !== 'hero') continue;
		for (const id of t.outputs ?? []) {
			const m = fileOf(id);
			if (!m || !(m.e.tags ?? []).some((x) => x === 'media:delivery' || x === 'media:frame')) continue;
			out.push(t.rule === 'render' ? itemOf(m, 'delivery', { role: 'render', timeline: cut }, ['role:render']) : itemOf(m, 'original', { role: 'frame', timeline: cut, t: v.t, shape: v.shape, clip: v.clip }, ['role:frame']));
		}
	}
	return out;
}

/**
 * A file a rule made, as a library item of class `cls`.
 * @param {{ e: import('../avendb/vaults.js').EntryView, f: any, ref: string }} m @param {string} cls
 * @param {Record<string, unknown>} meta @param {string[]} [tags]
 * @returns {import('./types.js').MediaItem}
 */
function itemOf(m, cls, meta, tags = []) {
	const media = m.e.media ?? m.e.record?.media ?? 'application/octet-stream';
	const title = m.e.title ?? m.e.record?.title ?? 'a file';
	const added = new Date((m.e.created ?? 0) * 1000).toISOString();
	return { hash: m.ref, mime: media, kind: kindOf(media), size: m.f.len ?? 0, added, title, description: '', tags, meta: { aven: { entry: m.e.entry, vault: m.e.vault }, ...meta }, public: false, original_name: title, class: cls };
}

/**
 * The library with each graded still a cut made of a legacy vault's file set as that file's preview, as the legacy
 * render worker set it (`meta.preview`).
 * @param {import('./types.js').MediaItem[]} items
 */
export function withGraded(items) {
	const byHash = new Map(items.map((m) => [m.hash, m]));
	for (const m of items) {
		const of = m.meta?.graded && m.meta.preview_of;
		const original = typeof of === 'string' ? byHash.get(of) : undefined;
		if (original && original !== m) original.meta = { ...original.meta, preview: m.hash };
	}
	return items;
}

/**
 * The value in the JSON file entry `id` of `world` brings (a task's long value, vault/app/src/aven.rs `spill`), read
 * once; `null` where this device can't open it.
 * @param {import('../avendb/vaults.js').WorldView} world @param {string} id
 */
export function valueOfFile(world, id) {
	const e = world.entries.find((x) => x.entry === id);
	const f = e?.files?.[0];
	return f && f.len != null ? valueIn(avenRef(f, e?.media ?? e?.record?.media ?? 'application/json')) : Promise.resolve(null);
}

/** @type {Map<string, Promise<any>>} the values read from their JSON files, by reference: a file's bytes never change */
const values = new Map();

/** The value in the JSON file `ref` names, read once. @param {string} ref */
function valueIn(ref) {
	let v = values.get(ref);
	if (!v) {
		v = fetch(avenUrl(ref))
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
		values.set(ref, v);
	}
	return v;
}

/**
 * The library items of the avenDB footage this Mac's device holds now, each long transcript and analysis read from its
 * file; none off the Mac app or while avenDB isn't open.
 */
/** @param {{signal?:AbortSignal}} [options] */
export async function avenLibrary({signal} = {}) {
	const { device } = await import('./cuts.js');
	const call = await device();
	if (!call) return [];
	signal?.throwIfAborted();
	const items = await libraryFromDevice(call, {signal});
	await Promise.all(
		items.flatMap((m) =>
			['transcript', 'analysis'].map(async (k) => {
				const ref = m.meta[`${k}_file`];
				if (typeof ref !== 'string') return;
				signal?.throwIfAborted();
				const v = await valueIn(ref);
				signal?.throwIfAborted();
				if (v) m.meta[k] = v;
			})
		)
	);
	return items;
}

/** Materialize only the two collections consumed by libraryOf. Unrelated
 * rooms, assets and stories must never gate the footage library. Each
 * collection yields between bounded query/metadata pages.
 * @param {(command: string, op: any) => Promise<any>} call
 * @param {{signal?:AbortSignal}} [options]
 */
export async function libraryFromDevice(call, {signal} = {}) {
	const files = await collectionEntries(call, 'file', null, {signal});
	const tasks = await collectionEntries(call, 'task', null, {signal});
	return libraryOf(/** @type {import('../avendb/vaults.js').WorldView} */ ({ entries: [...files, ...tasks] }));
}
