// A YouTube artifact's words (content-v2 M1c, ./Artifact.svelte): the studio's `youtube` rule (src/lib/studio/jobs/,
// the Jobs thread's) fetches on the Mac a video's title, channel, length, upload day, language, chapters and captions,
// as a task's value. This finds that rule and an artifact's tasks of it, asks for one, and copies a done task's value
// into the fields the artifact still has empty, once a task: the artifact then carries the tag `youtube:` and the
// task's key, so words a person takes out stay out, and a new link (a new task) fills again what is empty then.

import { BUILT_IN, held, layered } from '$lib/studio/jobs/rules.js';
import { tasksOf } from '$lib/studio/jobs/tasks.js';
import { isArtifact, youtubeId } from './artifacts.js';
import { whole } from './files.js';
import { seeded } from './vaults.js';

/** The rule's key, as the studio names it. */
export const RULE = 'youtube';

/** The start of the tag that says which task's words an artifact took. */
const MARK = 'youtube:';
/** The tag that says an artifact took task `t`'s words. @param {import('$lib/studio/jobs/tasks.js').Task} t */
const markOf = (t) => `${MARK}${t.key.slice(0, 16)}`;
/** Whether artifact `e` took task `t`'s words already. @param {import('./vaults.js').EntryView} e
 *  @param {import('$lib/studio/jobs/tasks.js').Task} t */
export const took = (e, t) => (e.tags ?? []).includes(markOf(t));

/**
 * The `youtube` rule in force for vault `vault`'s artifacts: its own, avenCEO GmbH's where this device knows it as the
 * person's seed, or the app's; `null` where none is, or it is turned off.
 * @param {import('./vaults.js').WorldView} world @param {string} vault
 */
export function wordsRule(world, vault) {
	const company = seeded(world)[1]?.[0]?.id;
	const rules = layered(BUILT_IN, company && company !== vault ? held(world, company) : [], held(world, vault));
	return rules.find((r) => r.key === RULE) ?? null;
}

/** A task's params, `{}` where they don't parse. @param {import('$lib/studio/jobs/tasks.js').Task} t */
const paramsOf = (t) => {
	try {
		return JSON.parse(t.params || '{}') ?? {};
	} catch {
		return {};
	}
};

/**
 * The `youtube` tasks of artifact `e` at the link it has now, the newest first.
 * @param {import('./vaults.js').WorldView} world @param {import('./vaults.js').EntryView} e
 */
export function wordsTasks(world, e) {
	const url = /** @type {any} */ (e.record)?.url ?? '';
	return tasksOf(world)
		.filter((t) => t.rule === RULE && t.vault === e.vault && t.inputs[0]?.entry === e.entry)
		.filter((t) => {
			const p = paramsOf(t);
			return !('url' in p) || p.url === url;
		})
		.sort((a, b) => b.at - a.at);
}

/** @type {Map<string, Promise<any>>} each done task's value, by its key, once read */
const values = new Map();

/**
 * Done task `t`'s value: in its result, or where that names a JSON file it made (`{ file }`, words too long for a
 * task's result), in that file's bytes; `null` where there is none.
 * @param {import('$lib/studio/jobs/tasks.js').Task} t @param {import('./vaults.js').WorldView} world
 * @param {{ readFile: import('./files.js').Read }} api
 * @returns {Promise<any>}
 */
export function wordsOf(t, world, api) {
	if (!values.has(t.key)) {
		const got = (async () => {
			const v = t.result ? JSON.parse(t.result) : null;
			if (!v?.file || v.transcript) return v;
			const f = world.entries.find((x) => x.entry === v.file)?.files?.[0];
			if (!f) return null;
			const blob = await whole((root, size, from, to) => api.readFile(root, size, from, to), f, 'application/json');
			return { ...v, ...JSON.parse(await blob.text()) };
		})().catch(() => (values.delete(t.key), null));
		values.set(t.key, got);
	}
	return /** @type {Promise<any>} */ (values.get(t.key));
}

/**
 * The ops that copy value `got` of a `youtube` task into the fields of artifact `e` it has empty: its title while it
 * is still the one its link gave it, whose it is (the channel), when it was published, its language, its length, its
 * chapters and its transcript, each a row from its second.
 * @param {import('./vaults.js').EntryView} e @param {any} got
 */
export function filling(e, got) {
	const r = /** @type {any} */ (e.record) ?? {};
	const id = youtubeId(r.url ?? '');
	/** @type {object[]} */
	const ops = [];
	const set = (/** @type {string} */ field, /** @type {unknown} */ value) => ops.push({ op: 'set', entry: e.entry, path: [field], value });
	const linkTitle = !r.title || r.title === `YouTube · ${id}` || r.title === r.url;
	if (got.title && linkTitle) set('title', String(got.title));
	if (got.channel && !r.by?.name) {
		const url = got.channel_url && !r.by?.url ? { url: String(got.channel_url) } : {};
		set('by', { ...r.by, name: String(got.channel), ...url, platform: r.by?.platform || 'youtube' });
	}
	const day = /^(\d{4})(\d{2})(\d{2})$/.exec(String(got.upload_date ?? ''));
	if (day && !r.taken) set('taken', `${day[1]}-${day[2]}-${day[3]}`);
	if (got.language && !r.language) set('language', String(got.language));
	if (Number(got.duration) > 0 && r.duration === undefined) set('duration', Number(got.duration));
	/** rows `xs` as the schema keeps them, each its id and second, and field `k` @param {any[]} xs @param {string} k */
	const rows = (xs, k) =>
		xs.filter((x) => x && String(x[k] ?? '').trim()).map((x, i) => ({ id: i + 1, t: Math.max(0, Number(x.t) || 0), [k]: String(x[k]).trim() }));
	if (!r.chapters?.length && got.chapters?.length) set('chapters', rows(got.chapters, 'title'));
	if (!r.transcript?.length && got.transcript?.length) set('transcript', rows(got.transcript, 'text'));
	return ops;
}

/**
 * The reconciler of a vault's YouTube words: for each artifact of vault `vault` the acting vault writes whose newest
 * done `youtube` task it hasn't taken yet, the ops filling what it has empty and the tag that says it took them.
 * @param {import('./vaults.js').WorldView} world @param {string} vault @param {string} actor
 * @param {{ readFile: import('./files.js').Read }} api
 */
export async function wordsFilling(world, vault, actor, api) {
	const ops = [];
	for (const e of world.entries) {
		if (e.vault !== vault || e.deleted || !isArtifact(e) || !e.writers.includes(actor)) continue;
		const t = wordsTasks(world, e).find((x) => x.status === 'done');
		if (!t || took(e, t)) continue;
		const got = await wordsOf(t, world, api);
		if (!got) continue;
		const old = (e.tags ?? []).filter((x) => x.startsWith(MARK));
		ops.push(...filling(e, got), { op: 'tag', entry: e.entry, add: [markOf(t)], remove: old });
	}
	return ops;
}
