/*
 * What the rules made of each file (Samuel 2026-10-18: the Library's table keeps a file's derived files with it, as
 * the old studio's ingest table did): the files a done task of a rule made from it ($lib/studio/jobs: proxy, grading
 * still, preview, a spilled transcript or analysis), each with what it is. A task is of the file its first input
 * names; the newest done task of a rule on a file says what it made. Where a step stands is the Jobs app's, not this.
 */

import { BUILT_IN } from '$lib/studio/jobs/rules.js';
import { tasksOf } from '$lib/studio/jobs/tasks.js';

/** @typedef {import('./vaults.js').EntryView} EntryView */
/** @typedef {import('$lib/studio/jobs/tasks.js').Task} Task */

/** Each rule's name, as the Jobs app shows it. */
const NAMES = new Map(BUILT_IN.map((r) => [r.key, r.name]));
/** The order the rules run in, as they list them; a rule of a vault's own after them. */
const ORDER = BUILT_IN.map((r) => r.key);
const rank = (/** @type {string} */ rule) => (ORDER.includes(rule) ? ORDER.indexOf(rule) : ORDER.length);

/** What a made file is, by its tag: its name and the colour it is in. */
const ROLES = /** @type {const} */ ([
	['media:proxy', 'Proxy', 'ACEScct'],
	['media:still', 'Grading still', 'ACEScct'],
	['media:preview', 'Preview', 'Rec.709']
]);

/** A rule's name. @param {string} rule */
export const ruleName = (rule) => NAMES.get(rule) ?? rule;

/** What made file `e` is, made by rule `rule`. @param {EntryView} e @param {string} rule */
export function roleOf(e, rule) {
	const r = ROLES.find(([tag]) => e.tags?.includes(tag));
	return r ? `${r[1]} · ${r[2]}` : ruleName(rule);
}

/**
 * @typedef {{ entry: EntryView, rule: string, role: string }} Made a file a rule made, and what it is
 * @typedef {{ made: Map<string, Made[]>, of: Map<string, string> }} Family
 */

/**
 * Every file's made files in `world`, by its entry: `made` the files the rules made of it (in the order the rules
 * run), `of` each made file's original.
 * @param {import('./vaults.js').WorldView} world
 * @returns {Family}
 */
export function familyOf(world) {
	const byId = new Map(world.entries.map((e) => [e.entry, e]));
	/** @type {Map<string, Task>} */
	const done = new Map();
	for (const t of tasksOf(world)) {
		const from = t.inputs[0]?.entry;
		if (t.status !== 'done' || !from || byId.get(from)?.kind !== 'file') continue;
		const k = `${from}\n${t.rule}`;
		if ((done.get(k)?.at ?? -1) < t.at) done.set(k, t);
	}
	/** @type {Family} */
	const out = { made: new Map(), of: new Map() };
	const keys = [...done.keys()].sort((a, b) => rank(a.split('\n')[1]) - rank(b.split('\n')[1]));
	for (const k of keys) {
		const from = k.split('\n')[0];
		const d = /** @type {Task} */ (done.get(k));
		for (const id of d.outputs ?? []) {
			const e = byId.get(id);
			if (!e || e.kind !== 'file' || e.deleted || out.of.has(id)) continue;
			out.of.set(id, from);
			out.made.set(from, [...(out.made.get(from) ?? []), { entry: e, rule: d.rule, role: roleOf(e, d.rule) }]);
		}
	}
	return out;
}
