/*
 * Cuts in avenDB (Jobs and studio 2.0, J9): a studio timeline kept as a `cut` entry of a vault of the person's instead
 * of a row of the API's Postgres. The studio opens and saves one exactly as it does a legacy timeline (./studio.svelte.js
 * routes by id: `cut:<entry>`); the legacy timelines stay where they are, untouched, until J15.
 *
 * A cut's record holds its name, stage and version as fields and the rest of the timeline (clips, grade, colour,
 * shape, tags) as one JSON text, `timeline`: the whole of it is saved at once, as the API saved it. Its version is the
 * number of edits the device holds of it (`updated`), so a save over a copy read before someone else's edit is refused,
 * as the API refused it ("changed elsewhere").
 *
 * What a cut is made into is asked of its rules (./jobs/rules.js `render`, `frame`), as tasks on the cut that the Mac's
 * worker does (vault/app/src/aven.rs): a render when asked, a file's graded still whenever a save changes how the file
 * looks on screen (as the API queued it). The studio reads them as it read the API's render jobs (`cutJobs`).
 */

import { answer, DELETED } from '$lib/avendb/ops.js';
import { BUILT_IN, held, layered } from './jobs/rules.js';
import { madeIndex, newTask, pin, retrying, tasksOf } from './jobs/tasks.js';
import { DEFAULT_SANDBOX, isWorld } from '../../../game/film/worlds.js';

export const CUT = 'cut';

/** The `cut` record's schema, in the vault's own lane, as the job schemas are (./jobs/schemas.js). */
export const CUT_V1 = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Cut, v1",
  "description": "A film's cut as the studio edits it: its name, stage and version, and its timeline as JSON text.",
  "type": "object",
  "properties": {
    "kind": { "const": "cut" },
    "name": { "type": "string", "maxLength": 200 },
    "project": { "type": "string", "maxLength": 200, "default": "" },
    "variant": { "type": "string", "maxLength": 200, "default": "" },
    "description": { "type": "string", "maxLength": 4000, "default": "" },
    "stage": { "type": "string", "maxLength": 32, "default": "edit" },
    "version": { "type": "integer", "minimum": 1, "default": 1 },
    "timeline": { "type": "string", "maxLength": 4000000, "default": "{}" },
    "legacy": { "type": "string", "maxLength": 64, "default": "" },
    "at": { "type": "integer", "minimum": 0 }
  },
  "required": ["kind", "name", "at"]
}
`;

/** @typedef {import('./types.js').Timeline} Timeline */

/** Whether timeline `id` is a cut in avenDB. @param {unknown} id */
export const isCut = (id) => typeof id === 'string' && id.startsWith('cut:');

/** The fields the record holds apart from the timeline's JSON. */
const FIELDS = ['name', 'project', 'variant', 'description', 'stage', 'version', 'legacy'];

/** @param {string} s */
const parse = (s) => {
	try {
		return s ? JSON.parse(s) : {};
	} catch {
		return {};
	}
};

/**
 * Cut entry `e` as the studio's timeline: a row of the world, or the one the `get` op answers, which names the heads
 * of the version read.
 * @param {import('../avendb/vaults.js').EntryView & { heads?: string[] }} e @returns {Timeline}
 */
export function timelineOf(e) {
	const r = e.record ?? {};
	const rest = parse(r.timeline ?? '');
	const at = new Date((r.at ?? e.created ?? 0) * 1000).toISOString();
	return /** @type {Timeline} */ ({
		aspect: '16:9',
		tags: [],
		clips: [],
		...rest,
		id: `cut:${e.entry}`,
		name: r.name ?? 'A cut',
		project: r.project || null,
		variant: r.variant || null,
		description: r.description ?? '',
		stage: r.stage ?? 'edit',
		version: r.version ?? 1,
		legacy: r.legacy || null,
		created: new Date((e.created ?? 0) * 1000).toISOString(),
		// the version read, by its heads (the `get` op's), so a save over an older copy is refused; '' where unknown
		updated: Array.isArray(e.heads) ? e.heads.join(',') : '',
		at,
		vault: e.vault
	});
}

/**
 * Timeline `t`'s record fields: its own fields, and the rest as JSON text.
 * @param {Partial<Timeline>} t
 */
export function fieldsOf(t) {
	/** @type {Record<string, any>} */
	const rest = {};
	/** @type {Record<string, any>} */
	const own = {};
	for (const [k, v] of Object.entries(t)) {
		if (['id', 'created', 'updated', 'at', 'vault', 'if_updated'].includes(k)) continue;
		if (FIELDS.includes(k)) own[k] = v ?? (k === 'version' ? 1 : '');
		else rest[k] = v;
	}
	return { ...own, timeline: JSON.stringify(rest), at: Math.floor(Date.now() / 1000) };
}

/** The ops that read and change nothing: a world read stays good across them (`worldOf`). */
const READS = new Set(['world', 'get', 'query', 'history', 'schemas', 'requests', 'aips', 'aip', 'may', 'jobs', 'shares', 'database', 'note', 'read_file', 'creatable', 'taggable']);

/**
 * The world read last and when, shared by every caller for a moment (Samuel 2026-10-18: the whole world as JSON over
 * the bridge, read by thirty callers and every four seconds, ran The OS out of memory and stuttered playback): one
 * read answers all who ask within `FRESH`, and any change made through `device()` drops it.
 * @type {{ at: number, world: Promise<any> } | null}
 */
let kept = null;
const FRESH = 3000;

/** The app's avenDB device, or `null` off the Mac app or while it isn't open: a change through it drops the world kept. */
export async function device() {
	const { native } = await import('$lib/native');
	if (!native()) return null;
	const { call, status } = await import('$lib/avendb/native.js');
	if (!(await status().catch(() => null))?.open) return null;
	return (/** @type {string} */ c, /** @type {any[]} */ ...a) => {
		if (c !== 'run' || !READS.has(a[0]?.op)) kept = null;
		return call(c, ...a);
	};
}

/**
 * The device's world: one read for every caller within a few seconds, none of a change made since (`kept`).
 * @param {(c: string, ...a: any[]) => Promise<any>} call @returns {Promise<import('../avendb/vaults.js').WorldView>}
 */
export const worldOf = async (call) => {
	if (!kept || performance.now() - kept.at > FRESH) {
		const world = call('run', { op: 'world' }).then(answer);
		kept = { at: performance.now(), world };
		world.catch(() => (kept = null));
	}
	return kept.world;
};

/**
 * The vault new cuts go into, and the vault the person acts as there: the Maia City vault if they reach it, else their
 * own.
 * @param {import('../avendb/vaults.js').WorldView} world
 */
export function homeOf(world) {
	const vaults = (world.vaults ?? []).filter((v) => v.kind !== 'device' && v.acting?.reaches);
	const v = vaults.find((x) => /maia city/i.test(x.name ?? '')) ?? vaults.find((x) => x.id === world.mine) ?? vaults[0];
	return v ? { vault: v.id, as: v.acting.as } : null;
}

/** The vault the person acts as in vault `vault`. @param {import('../avendb/vaults.js').WorldView} world @param {string} vault */
export const asIn = (world, vault) => world.vaults?.find((v) => v.id === vault)?.acting?.as ?? vault;

/** Whether new cuts go into avenDB here: on the Mac app with avenDB open and a vault to put them in. */
export async function cutsHere() {
	const call = await device();
	return !!call && !!homeOf(await worldOf(call));
}

/**
 * Every cut this device holds, newest first, or those of vault `vault` alone (the vault picked in the nav pill: Maia
 * City's in Maia City, a person's own in theirs); none off the Mac app.
 * @param {string | null} [vault] @returns {Promise<Timeline[]>}
 */
export async function listCuts(vault = null) {
	const call = await device();
	if (!call) return [];
	const world = await worldOf(call);
	return world.entries
		.filter((e) => e.type === CUT && e.record?.kind === CUT && !e.deleted && !(e.tags ?? []).includes(DELETED))
		.filter((e) => !vault || e.vault === vault)
		.map(timelineOf)
		.sort((a, b) => (/** @type {any} */ (b).at < /** @type {any} */ (a).at ? -1 : 1));
}

/**
 * Every story this device holds, by title: the stories the studio's timelines belong to (a cut's `story` link) are
 * picked from these; none off the Mac app.
 * @returns {Promise<{ id: string, vault: string, title: string }[]>}
 */
export async function listStories() {
	const call = await device();
	if (!call) return [];
	const world = await worldOf(call);
	return world.entries
		.filter((e) => e.type === 'story' && !e.deleted && !(e.tags ?? []).includes(DELETED))
		.map((e) => ({ id: e.entry, vault: e.vault, title: String(e.title || /** @type {any} */ (e.record)?.title || 'Untitled') }))
		.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

/** Cut `id` as it is now. @param {string} id @returns {Promise<Timeline>} */
export async function getCut(id) {
	const call = await device();
	if (!call) throw new Error('This cut lives in avenDB, which is open only in the Mac app.');
	// the one entry, not the whole world: read every few seconds while a cut is open
	const got = await call('run', { op: 'get', entry: id.slice(4) }).catch(() => null);
	const row = got?.ok;
	if (!row) throw new Error('No such cut on this Mac.');
	return timelineOf(row);
}

/**
 * A new cut of timeline `t` in the person's home vault (`homeOf`), or in vault `at.vault` acting as `at.as` (else as
 * the person acts there), tagged
 * `at.tags`; its schema added first if the vault lacks it.
 * @param {Partial<Timeline>} t @param {{ vault?: string, as?: string, tags?: string[] }} [at]
 */
export async function createCut(t, at = {}) {
	const call = await device();
	if (!call) throw new Error('avenDB is not open in this app.');
	let world = await worldOf(call);
	const home = at.vault ? { vault: at.vault, as: at.as ?? asIn(world, at.vault) } : homeOf(world);
	if (!home) throw new Error('No avenDB vault to keep the cut in.');
	await schemaIn(call, world, home.vault, CUT_V1, home.as);
	const tags = at.tags?.length ? { tags: at.tags } : {};
	const made = answer(await call('run', { op: 'create', vault: home.vault, type: CUT, ...tags, value: { kind: CUT, ...fieldsOf(t) }, as: home.as }));
	world = await worldOf(call);
	const e = world.entries.find((x) => x.entry === made.entry);
	if (!e) throw new Error('The cut was made but this Mac does not show it yet.');
	return timelineOf(e);
}

/**
 * Schema `text` added to vault `vault` unless it holds one of its title already.
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {import('../avendb/vaults.js').WorldView} world
 * @param {string} vault @param {string} text @param {string} as
 */
export async function schemaIn(call, world, vault, text, as) {
	const title = JSON.parse(text).title;
	const has = world.entries.some((e) => e.vault === vault && e.type === 'schema' && !e.deleted && e.title === title);
	if (!has) answer(await call('run', { op: 'create', vault, type: 'schema', value: text, as }));
}

/**
 * Cut `id` saved as `t`, only over the version it was read at (`t.if_updated`): else refused, as the API refuses.
 * @param {string} id @param {Partial<Timeline> & { if_updated?: string }} t @returns {Promise<Timeline>}
 */
export async function saveCut(id, t) {
	const call = await device();
	if (!call) throw new Error('avenDB is not open in this app.');
	const entry = id.slice(4);
	const read = async () => (await call('run', { op: 'get', entry }).catch(() => null))?.ok ?? null;
	const e = await read();
	if (!e) throw new Error('No such cut on this Mac.');
	if (t.if_updated && t.if_updated !== timelineOf(e).updated) throw new Error('The cut was changed elsewhere.');
	const fields = fieldsOf({ ...timelineOf(e), ...t });
	const ops = Object.entries(fields).map(([k, value]) => ({ op: 'set', entry, path: [k], value }));
	let world = await worldOf(call);
	answer(await call('run', { op: 'batch', ops, as: asIn(world, e.vault) }));
	const saved = timelineOf((await read()) ?? e);
	world = await worldOf(call);
	// every file whose look on screen changed: its graded still made again (never failing the save itself)
	const before = timelineOf(e);
	for (const clip of restill(before, saved)) await ask(call, world, e, 'frame', { clip }).catch(() => null);
	return saved;
}

/**
 * Each world shot version cut `t` plays that has no proxy yet, its proxy asked for (the `world-proxy` rule, J10):
 * avenDB's shots only, the API's are the legacy app's to make. Asked as a cut opens (`askWorldProxies`); the Mac's
 * worker renders them one at a time, never while the studio plays or its live world is open (./jobs/mac.js), so no
 * second world runs beside the live one.
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {import('../avendb/vaults.js').WorldView} world @param {any} t
 */
export async function proxiesOf(call, world, t) {
	const { shotFrom, versionEntry } = await import('./avenshots.js');
	const seen = new Set();
	for (const c of t.clips ?? []) {
		if (c.kind !== 'world' || typeof c.shot !== 'string' || !c.shot.startsWith('shot:') || seen.has(`${c.shot}@${c.shotVersion}`)) continue;
		seen.add(`${c.shot}@${c.shotVersion}`);
		const v = versionEntry(world, c.shot, c.shotVersion);
		// one brought from the film seed or the old studio needs none rendered, nor can one whose world the camera no
		// longer has (each brought once, tagged proxy:<shot>:<version>)
		const tag = `proxy:${c.shot}:${c.shotVersion}`;
		if (v && shootable(shotFrom(v).spec) && !world.entries.some((e) => !e.deleted && (e.tags ?? []).includes(tag))) await ask(call, world, v, 'world-proxy', {}).catch(() => null);
	}
}

/** The world proxies cut `t` lacks, asked for on this Mac's device (`proxiesOf`); nothing off the Mac app. @param {any} t */
export async function askWorldProxies(t) {
	const call = await device();
	if (!call) return;
	await proxiesOf(call, await worldOf(call), t);
	const { nudge } = await import('./jobs/mac.js');
	nudge();
}

/** Whether the film camera can shoot spec `spec`'s world (game/film/worlds.js), so a proxy is rendered there. @param {any} spec */
export const shootable = (spec) => isWorld(spec?.world?.sandbox ?? DEFAULT_SANDBOX);

/** @typedef {{ id: string, track: string, kind?: string, hash?: string, stacks?: unknown, frame?: Record<string, unknown>, script?: { scene?: string } }} Graded */

/**
 * Per file, the first picture clip that plays it, and what its graded still is made of (its look on screen), as the
 * legacy API read it.
 * @param {any} t
 */
function gradesOf(t) {
	/** @type {Map<string, { clip: string, of: string, graded: boolean }>} */
	const out = new Map();
	for (const c of /** @type {Graded[]} */ (t.clips ?? [])) {
		if (c.track !== 'V1' || (c.kind && c.kind !== 'media') || !c.hash || out.has(c.hash)) continue;
		const own = { stacks: c.stacks ?? null, frame: c.frame?.['16:9'] ?? null, scene: c.script?.scene ?? null };
		out.set(c.hash, { clip: c.id, of: JSON.stringify({ own, grade: t.grade ?? null, color: t.color ?? null }), graded: !!(c.stacks || c.frame?.['16:9'] || t.grade) });
	}
	return out;
}

/**
 * The clips whose files' graded stills a save from `before` to `after` makes again: each file whose look changed (a
 * file never graded, and graded now by nothing, keeps the preview it has).
 * @param {any} before @param {any} after
 */
export function restill(before, after) {
	const was = gradesOf(before);
	const clips = [];
	for (const [hash, now] of gradesOf(after)) {
		const then = was.get(hash);
		if (then?.of === now.of || (!now.graded && !then?.graded)) continue;
		clips.push(now.clip);
	}
	return clips;
}

/**
 * Rule `key` asked of entry `e` (a cut, a shot version), with the params the asker names (`given`: a render's
 * delivery, a frame's clip): its task's key, a new task or the one with the same key already there (a held one asked
 * again).
 * @param {(c: string, ...a: any[]) => Promise<any>} call @param {import('../avendb/vaults.js').WorldView} world
 * @param {import('../avendb/vaults.js').EntryView} e @param {string} key @param {Record<string, any>} given
 */
async function ask(call, world, e, key, given) {
	const rule = layered(BUILT_IN, held(world, e.vault)).find((r) => r.key === key);
	if (!rule) throw new Error(`The ${key} rule is off in this cut's vault.`);
	const as = asIn(world, e.vault);
	const tasks = tasksOf(world).filter((t) => t.vault === e.vault);
	const pinned = pin(rule, e, madeIndex(tasks));
	if (!pinned) throw new Error(`The cut can't be made into a ${key} yet.`);
	for (const p of rule.params) if (p in given) pinned.params[p] = given[p] ?? null;
	const value = newTask(rule, pinned, as, Math.floor(Date.now() / 1000));
	const known = tasks.find((t) => t.key === value.key);
	// a graded still still queued for an earlier look of the same clip is not made at all: this one replaces it
	if (key === 'frame' && given.clip) {
		const stale = tasks.filter((t) => t.rule === 'frame' && t.status === 'queued' && t.key !== value.key && t.inputs[0]?.entry === e.entry && JSON.parse(t.params || '{}').clip === given.clip);
		for (const t of stale) await call('run', deletedTag(t.entry, as)).catch(() => null);
	}
	if (known?.status === 'held') answer(await call('run', retrying(known, as)));
	if (!known) answer(await call('run', { op: 'create', vault: e.vault, type: 'task', value, as }));
	const { nudge } = await import('./jobs/mac.js');
	nudge();
	return known?.key ?? value.key;
}

/** @typedef {import('./types.js').RenderJob} RenderJob */

/** Cut `id`'s entry. @param {import('../avendb/vaults.js').WorldView} world @param {string} id */
function cutIn(world, id) {
	const e = world.entries.find((x) => x.entry === id.slice(4));
	if (!e) throw new Error('No such cut on this Mac.');
	return e;
}

/**
 * Cut `id` rendered (`delivery` "youtube-4k": YouTube's 4K master alone; none: every delivery): its job, as the
 * studio shows the API's.
 * @param {string} id @param {'youtube-4k'} [delivery] @returns {Promise<RenderJob>}
 */
export async function renderCut(id, delivery) {
	const call = await device();
	if (!call) throw new Error('This cut lives in avenDB, which is open only in the Mac app.');
	const world = await worldOf(call);
	const key = await ask(call, world, cutIn(world, id), 'render', { delivery: delivery ?? null });
	const job = (await cutJobs(id)).find((j) => j.key === key);
	if (!job) throw new Error('The render was asked for, but this Mac does not show it yet.');
	return job;
}

/**
 * A hero frame of cut `id`: one frame at `t` seconds in a delivery shape.
 * @param {string} id @param {{ t: number, shape: string }} at @returns {Promise<RenderJob>}
 */
export async function frameCut(id, at) {
	const call = await device();
	if (!call) throw new Error('This cut lives in avenDB, which is open only in the Mac app.');
	const world = await worldOf(call);
	const key = await ask(call, world, cutIn(world, id), 'frame', { t: at.t, shape: at.shape, clip: null });
	const job = (await cutJobs(id)).find((j) => j.key === key);
	if (!job) throw new Error('The frame was asked for, but this Mac does not show it yet.');
	return job;
}

/** How a task's status reads as a render job's. @type {Record<string, RenderJob['status']>} */
const STATUS = { queued: 'queued', claimed: 'rendering', done: 'done', failed: 'queued', held: 'failed' };

/**
 * The renders and frames asked of cut `id`, newest first, as the studio reads the API's render jobs: how far each is
 * from this Mac's jobs (the lanes, vault/app/src/jobs.rs), and a done one's report from its file when it is long.
 * @param {string} id @returns {Promise<(RenderJob & { key: string })[]>}
 */
export async function cutJobs(id) {
	const call = await device();
	if (!call) return [];
	const world = await worldOf(call);
	const tasks = tasksOf(world)
		.filter((t) => (t.rule === 'render' || t.rule === 'frame') && t.inputs[0]?.entry === id.slice(4))
		.sort((a, b) => b.at - a.at)
		.slice(0, 10);
	/** @type {Map<string, any>} */
	const running = new Map();
	try {
		const { command } = await import('$lib/native');
		const jobs = /** @type {{ active: any[] }} */ (await command('jobs_list', { limit: 0 }));
		for (const j of jobs.active ?? []) running.set(j.subject, j);
	} catch {
		// the lanes unread: the tasks' own state alone
	}
	const { valueOfFile } = await import('./aven.js');
	return Promise.all(
		tasks.map(async (t) => {
			let v = t.result ? JSON.parse(t.result) : null;
			if (v?.file) v = { ...v, ...((await valueOfFile(world, v.file)) ?? {}) };
			const live = running.get(`aven:${t.entry}`);
			const status = STATUS[t.status] ?? 'queued';
			const stage = String(live?.stage ?? '');
			const note = t.status === 'done' ? (v?.note ?? 'done') : t.error ? (t.status === 'held' ? t.error : `tried again: ${t.error}`) : stage.startsWith('rendering') && stage !== 'rendering world plates' && stage !== 'rendering the frame' ? 'rendering' : stage || (status === 'queued' ? 'queued' : 'starting');
			const at = new Date(t.at * 1000).toISOString();
			const params = t.params ? JSON.parse(t.params) : {};
			return {
				id: `task:${t.entry}`,
				key: t.key,
				timeline_id: id,
				status,
				progress: t.status === 'done' ? 1 : Number(live?.progress ?? 0),
				note,
				output_hash: v?.output_hash ?? null,
				created: at,
				updated: live?.ended ?? live?.started ?? at,
				kind: /** @type {'render' | 'frame'} */ (t.rule),
				params: t.rule === 'frame' ? { t: params.t ?? undefined, shape: params.shape ?? undefined } : null,
				report: v?.report ?? (v?.deliveries ? { deliveries: v.deliveries } : null),
				deliveries: v?.deliveries ?? []
			};
		})
	);
}

/**
 * The worker's queue: every render and frame asked of any cut and not done yet, the running first, then by when
 * each was asked; how far each is from the Mac's own job of it.
 * @returns {Promise<{ id: string, kind: 'render' | 'frame', status: string, progress: number, timeline_id: string, created: string }[]>}
 */
export async function renderQueue() {
	const call = await device();
	if (!call) return [];
	const world = await worldOf(call);
	/** @type {Map<string, any>} */
	const live = new Map();
	try {
		const { command } = await import('$lib/native');
		const jobs = /** @type {{ active: any[] }} */ (await command('jobs_list', { limit: 0 }));
		for (const j of jobs.active ?? []) live.set(j.subject, j);
	} catch {
		// the lanes unread: the tasks' own state alone
	}
	return tasksOf(world)
		.filter((t) => (t.rule === 'render' || t.rule === 'frame') && (t.status === 'queued' || t.status === 'claimed' || t.status === 'failed'))
		.map((t) => ({
			id: `task:${t.entry}`,
			kind: /** @type {'render' | 'frame'} */ (t.rule),
			status: STATUS[t.status] ?? 'queued',
			progress: Number(live.get(`aven:${t.entry}`)?.progress ?? 0),
			timeline_id: `cut:${t.inputs[0]?.entry ?? ''}`,
			created: new Date(t.at * 1000).toISOString()
		}))
		.sort((a, b) => (a.status === b.status ? Date.parse(a.created) - Date.parse(b.created) : a.status === 'rendering' ? -1 : 1));
}

/**
 * What rule `rule` made of the original at avenDB entry `entry` made again: its task asked again from nothing, or
 * asked now (a proxy, a transcript that failed or found nothing).
 * @param {string} entry @param {'proxy' | 'transcript'} [rule]
 */
export async function remake(entry, rule = 'proxy') {
	const call = await device();
	if (!call) throw new Error('The Mac app makes these.');
	const world = await worldOf(call);
	const e = world.entries.find((x) => x.entry === entry);
	if (!e) throw new Error('That file is not in avenDB.');
	const known = tasksOf(world)
		.filter((t) => t.rule === rule && t.inputs[0]?.entry === entry)
		.sort((a, b) => b.at - a.at)[0];
	if (!known) return void (await ask(call, world, e, rule, {}));
	answer(await call('run', retrying(known, asIn(world, e.vault))));
	const { nudge } = await import('./jobs/mac.js');
	nudge();
}
/** The proxy of the original at avenDB entry `entry` made again. @param {string} entry */
export const remakeProxy = (entry) => remake(entry, 'proxy');

/**
 * A probe's colour journey with its profile set by hand to `profile` (`null`: back to what the probe detected): the
 * profile the proxy and the still go through, the detected one kept beside it.
 * @param {Record<string, any> | null | undefined} journey @param {string | null} profile
 */
export function journeyWith(journey, profile) {
	const { override: _o, detected, ...rest } = journey ?? {};
	const found = detected ?? rest.profile ?? 'unknown';
	return profile && profile !== found ? { ...rest, profile, override: profile, detected: found } : { ...rest, profile: found };
}

/** The newest done task of rule `rule` made of entry `entry`. @param {import('../avendb/vaults.js').WorldView} world @param {string} rule @param {string} entry */
const madeOf = (world, rule, entry) => madeIndex(tasksOf(world)).get(`${rule}:${entry}`);

/**
 * The colour profile of the original at avenDB entry `entry` set by hand (`null`: back to the detected one), written
 * into its probe's journey on the file's own task: the proxy and the still pin that journey, so the Mac makes them
 * again through it by themselves, and set back they are the ones already made.
 * @param {string} entry @param {string | null} profile
 */
export async function setProfile(entry, profile) {
	const call = await device();
	if (!call) throw new Error('A file’s colour is set in the Mac app.');
	const world = await worldOf(call);
	const t = madeOf(world, 'probe', entry);
	if (!t) throw new Error('This file isn’t probed yet: its colour comes once it is.');
	const probe = parse(t.result) ?? {};
	answer(await call('run', { op: 'set', entry: t.entry, path: ['result'], value: JSON.stringify({ ...probe, journey: journeyWith(probe.journey, profile) }), as: asIn(world, t.vault) }));
	const { nudge } = await import('./jobs/mac.js');
	nudge();
}

/** How long a value may be and still stay on its task (vault/app/src/aven.rs `SPILL`). */
const SPILL = 16 * 1024;

/**
 * The transcript of the original at avenDB entry `entry` with its words put right by hand (`words`, the whole list):
 * written onto its transcript task, a long one into a JSON file of its own as the Mac spills it. The transcript now.
 * @param {string} entry @param {(import('./transcript.js').CaptionWord | import('./transcript.js').Word)[]} words
 */
export async function setTranscript(entry, words) {
	const call = await device();
	if (!call) throw new Error('A transcript is put right in the Mac app.');
	const world = await worldOf(call);
	const t = madeOf(world, 'transcript', entry);
	if (!t) throw new Error('This file has no transcript yet.');
	const { withWords } = await import('./transcript.js');
	const { valueOfFile } = await import('./aven.js');
	const held = parse(t.result);
	const before = held?.file ? await valueOfFile(world, held.file) : held;
	const next = withWords(before, words, 'hand', new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
	if (!next.words.length) throw new Error('No words to keep.');
	const as = asIn(world, t.vault);
	const text = JSON.stringify(next);
	if (text.length <= SPILL) {
		answer(await call('run', { op: 'set', entry: t.entry, path: ['result'], value: text, as }));
		return next;
	}
	const bytes = new TextEncoder().encode(text);
	const source = world.entries.find((x) => x.entry === entry);
	const name = `${String(source?.title ?? 'transcript').replace(/\.[^.]+$/, '')}.transcript.json`;
	const { NativeDevice } = await import('$lib/avendb/native.js');
	const put = answer(
		await new NativeDevice(/** @type {any} */ ({})).putFile({ op: 'put_file', vault: t.vault, name, media: 'application/json', tags: ['media:transcript'], len: bytes.length, as }, async (at, n) => bytes.subarray(at, at + n))
	);
	const small = { file: put.entry, state: 'done', ...(next.language ? { language: next.language } : {}), ...(held?.seconds != null ? { seconds: held.seconds } : {}) };
	answer(
		await call('run', {
			op: 'batch',
			ops: [
				{ op: 'set', entry: t.entry, path: ['result'], value: JSON.stringify(small) },
				{ op: 'set', entry: t.entry, path: ['outputs'], value: [...(t.outputs ?? []), put.entry] }
			],
			as
		})
	);
	return next;
}

/**
 * The op that tags entry `entry` deleted (avenDB's deleted tag: it can come back), among the entry's own tags: a cut's
 * or a task's record has no tags field, so the tag put in the record was refused, as not fitting its schema (Samuel
 * 2026-10-20 could not delete a timeline). @param {string} entry @param {string} as
 */
const deletedTag = (entry, as) => ({ op: 'tag', entry, add: [DELETED], as });

/** Cut `id` deleted (avenDB's deleted tag: it can come back). @param {string} id */
export async function deleteCut(id) {
	const call = await device();
	if (!call) throw new Error('avenDB is not open in this app.');
	const entry = id.slice(4);
	const world = await worldOf(call);
	const e = world.entries.find((x) => x.entry === entry);
	if (!e) return;
	answer(await call('run', deletedTag(entry, asIn(world, e.vault))));
}
