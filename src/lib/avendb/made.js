/*
 * What the rules made of each file (Samuel 2026-10-18: the Library's table keeps a file's derived files with it, as
 * the old studio's ingest table did): the files a done task of a rule made from it ($lib/studio/jobs: proxy, grading
 * still, preview, a spilled transcript or analysis), each with what it is, and every rule's step on it, done or not.
 * A task is of the file its first input names; the newest task of a rule on a file says where that step is, the newest
 * done one what it made.
 */

import { BUILT_IN } from '$lib/studio/jobs/rules.js';
import { tasksOf } from '$lib/studio/jobs/tasks.js';

/** @typedef {import('./vaults.js').EntryView} EntryView */
/** @typedef {import('$lib/studio/jobs/tasks.js').Task} Task */

/** Each rule's name, as the Jobs app shows it. */
const NAMES = new Map(BUILT_IN.map((r) => [r.key, r.name]));
/** The order the steps run in, as the rules list them; a rule of a vault's own after them. */
const ORDER = BUILT_IN.map((r) => r.key);
const rank = (/** @type {string} */ rule) => (ORDER.includes(rule) ? ORDER.indexOf(rule) : ORDER.length);
/** The rules that make files, so a step of theirs not done yet is a file still to come. */
const MAKERS = new Set(BUILT_IN.filter((r) => r.makes.some((m) => 'type' in m && m.type === 'file')).map((r) => r.key));

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

/** A step's state in words: done, waiting, being made, failed (tried again) or held for a person. @param {Task} t */
export const stateOf = (t) =>
	t.status === 'done' ? 'done' : t.status === 'claimed' ? 'being made' : t.status === 'failed' ? 'failed, tried again' : t.status === 'held' ? 'held for you' : 'waiting';

/**
 * @typedef {{ entry: EntryView, rule: string, role: string }} Made a file a rule made, and what it is
 * @typedef {{ rule: string, name: string, task: Task, done: boolean, makes: boolean }} Step a rule's step on a file
 * @typedef {{ made: Map<string, Made[]>, steps: Map<string, Step[]>, of: Map<string, string> }} Family
 */

/**
 * Every file's made files and steps in `world`, by its entry: `made` the files the rules made of it (in the order of
 * its steps), `steps` each rule's newest task on it, `of` each made file's original.
 * @param {import('./vaults.js').WorldView} world
 * @returns {Family}
 */
export function familyOf(world) {
	const byId = new Map(world.entries.map((e) => [e.entry, e]));
	/** @type {Map<string, Task>} */
	const newest = new Map();
	/** @type {Map<string, Task>} */
	const done = new Map();
	for (const t of tasksOf(world)) {
		const from = t.inputs[0]?.entry;
		if (!from || byId.get(from)?.kind !== 'file') continue;
		const k = `${from}\n${t.rule}`;
		if ((newest.get(k)?.at ?? -1) < t.at) newest.set(k, t);
		if (t.status === 'done' && (done.get(k)?.at ?? -1) < t.at) done.set(k, t);
	}
	/** @type {Family} */
	const out = { made: new Map(), steps: new Map(), of: new Map() };
	const keys = [...newest.keys()].sort((a, b) => rank(a.split('\n')[1]) - rank(b.split('\n')[1]));
	for (const k of keys) {
		const t = /** @type {Task} */ (newest.get(k));
		const [from, rule] = k.split('\n');
		const d = done.get(k);
		out.steps.set(from, [...(out.steps.get(from) ?? []), { rule, name: ruleName(rule), task: t, done: t.status === 'done', makes: MAKERS.has(rule) }]);
		for (const id of d?.outputs ?? []) {
			const e = byId.get(id);
			if (!e || e.kind !== 'file' || e.deleted || out.of.has(id)) continue;
			out.of.set(id, from);
			out.made.set(from, [...(out.made.get(from) ?? []), { entry: e, rule, role: roleOf(e, rule) }]);
		}
	}
	return out;
}
