// @ts-nocheck — plain JS, kept loose on purpose, as the other logic of ours is ($lib/avendb/functions.js)
// Measuring an AIP (avendb/docs/ARCHITECTURE.md §8, "AIPs", N2): an AIP's objective names the measuring logic that
// measures it (`def sim : Measure := logic "valley-sim"`, avendb/spec/AvenDB/Objective.lean), a logic module on the
// main line of the AIP's vault, which its owners accepted, so trusted code, tagged `ref:logic/measures/<name>`, that
// exports `measure(input)`. Those who accept the AIP measure it, on their own device, with no server between them and
// the vault (Samuel 2026-10-20: avenDB is local first and user owned): "Measure" on the AIP in the Proposals app
// (./AvendbAip.svelte) runs it in the page's logic host ($lib/sandbox/logic-host.js: a fresh QuickJS engine in the
// shell's worker, no page, no network, no keys, no clock, its work counted in ticks, its random seeded by its input) on
// the records of the AIP's lines, the input nobody trusts: first main's side, once, as the baseline, then the
// proposal's, each time its lines or the logic change. What it hands back, named numbers, the device records on the
// AIP as readings (`aip_measure`), written as the vault (or a vault that owns it, or holds its Measurer group), never
// the AIP's author, so `measured "name"` counts them (avendb/spec/AvenDB/Measurers.lean). Every run is a pure function
// of the logic and the records: anyone who reads both can run it again and get the same numbers (`measureOnce`).

import { checkCode } from '../../../game/code/check.js';
import { engineFor } from '../sandbox/engines.js';
import { MOST, seedOf } from '../sandbox/logic.js';
import { runOnce } from '../sandbox/logic-host.js';

/** The tag of the measuring logic an objective names `name`, on its vault's main line. @param {string} name */
export const tagOf = (name) => `ref:logic/measures/${name}`;

/**
 * What one run of a measuring logic may use: more than a game rule's call, since a measurement may run a whole sim,
 * still counted in ticks, the same on every device, the clock only a backstop well past them: the most a run may be
 * given ($lib/sandbox/logic.js `MOST`), from logic engine 2 on (`FIRST`).
 */
export const MEASURE = MOST;

/** The first logic engine that gives a run the budget it names: measuring logic is made for it or a later one. */
export const FIRST = 2;

/** At most this many characters of code, and readings from one run. */
export const MAX_CODE = 100_000;
export const MAX_READINGS = 16;

/** The largest magnitude a reading may take, as avenDB's objectives read numbers (`bound`, 10^24 units). */
const BOUND = 1e24;

/**
 * The input a measuring logic is given for one side of an AIP's lines (`aip_records`): each line's entry, type, tags
 * and its record on that side, `main` or `proposed`.
 * @param {any[]} lines @param {'main' | 'proposed'} side
 */
export const inputOf = (lines, side) => ({
	lines: lines.map((l) => ({ entry: l.entry, type: l.type ?? null, tags: l.tags ?? [], record: l[side] ?? {} }))
});

/**
 * Measuring logic `code` run once on `input`: `{ readings }`, each `[name, value]`, or `{ error }` where the one
 * checker refuses it, it doesn't load, throws, runs too long, eats its memory, or hands back anything but an object
 * of at most `MAX_READINGS` names, each 1 to 160 characters, to finite numbers within 10^24.
 * @param {string} code @param {object} input @param {number} [engine] the logic engine it is written for, `FIRST` or a
 *   later one, which gives it a measurement's budget
 * @returns {Promise<{ readings?: [string, number][], error?: string }>}
 */
export async function measureOnce(code, input, engine) {
	if ((engineFor('logic', engine)?.v ?? 0) < FIRST) return { error: `measuring logic is made for logic engine ${FIRST} or later, which gives it a measurement’s budget` };
	const c = checkCode('logic', { code, hooks: ['measure'], max: MAX_CODE });
	if (!c.ok) return { error: c.errors.join(' ') };
	// what crosses is one string, parsed inside the engine; its seed is its own, so every run of it answers alike
	const json = JSON.stringify(input);
	const o = { code, file: 'measure.js', kind: 'call', name: 'measure', json, seed: seedOf(json), now: 0, limits: MEASURE, engine };
	const { out, error } = await runOnce(o);
	if (error) return { error: error === 'it exports no measure' ? 'it exports no measure(input)' : error };
	const got = out === undefined ? undefined : JSON.parse(out);
	if (!got || typeof got !== 'object' || Array.isArray(got)) return { error: 'measure(input) hands back an object of named numbers' };
	const readings = Object.entries(got);
	if (readings.length > MAX_READINGS) return { error: `measure(input) hands back at most ${MAX_READINGS} numbers` };
	for (const [name, value] of readings) {
		if (!name.trim() || name.length > 160) return { error: 'a reading’s name is 1 to 160 characters' };
		if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > BOUND) return { error: `${name} is no finite number within 10^24` };
	}
	return { readings };
}

/** A short, steady hash of a text: the same text, the same 8 hex digits. @param {string} s */
const short = (s) => seedOf(s).toString(16).padStart(8, '0');

/**
 * The measuring logic vault `vault` names `name` on its main line, as `ask` reads it: `{ entry, code, engine, key }`
 * (`key` a hash of its code and engine), or `{ error }` where none or more than one is tagged so, or it is no logic
 * module.
 */
export async function logicOf(ask, vault, name) {
	const tag = tagOf(name);
	const found = await ask({ op: 'query', vault, where: { all: [{ type: ['logic'] }, { tag }] } });
	const rows = (found?.rows ?? []).filter((r) => !(r.tags ?? []).includes('avendb:deleted'));
	if (rows.length !== 1) return { error: rows.length ? `${rows.length} logic entries are tagged ${tag}, so none measures` : `no logic entry on main is tagged ${tag}` };
	const [r] = rows;
	const v = r.record ?? {};
	if (v.kind !== 'logic' || v.engine?.host !== 'logic' || typeof v.source !== 'string') return { error: `${tag} is no logic module` };
	return { entry: r.entry, code: v.source, engine: v.engine.version, key: short(`${v.engine.version}\n${v.source}`) };
}

/** The note on a reading from measuring logic `name`, keyed `key`, on `side`, its lines keyed `lines`. */
export const noteOf = (name, key, side, lines) => (side === 'main' ? `logic "${name}" ${key} on main` : `logic "${name}" ${key} on the proposal ${lines}`);

/**
 * AIP `a` (as the `aip` and `aips` reads give it) of vault `vault` measured by `me`, the vault the device writes as:
 * where it is worked on or proposed and its objective names measuring logic, each named logic run on main's side once
 * (where `me` recorded nothing from it yet) and on the proposal's side where `me` recorded nothing from this logic on
 * these lines yet. `ask` reads (an op's answer, or throws). Writes nothing: answers what it measured, one row per logic
 * and side, `{ logic, side, readings, note }`, or `{ logic, side?, error }`; `readingsOf` turns them into the writes.
 * @param {{ ask: (op: object) => Promise<any>, a: any, vault: string, me: string }} o
 */
export async function measureAip({ ask, a, vault, me }) {
	const out = [];
	const names = a.objective?.measures ?? [];
	if (!names.length || !['objective', 'proposed'].includes(a.stage) || a.outcome) return out;
	const mine = (a.objective.readings ?? []).filter((r) => r.measured && r.by === me).map((r) => r.note ?? '');
	let lines = null;
	for (const name of names) {
		const logic = await logicOf(ask, vault, name);
		if (logic.error) {
			out.push({ logic: name, error: logic.error });
			continue;
		}
		lines ??= (await ask({ op: 'aip_records', entry: a.entry }))?.lines ?? [];
		const linesKey = short(lines.map((l) => `${l.entry}:${(l.heads ?? []).join(',')}`).join('|'));
		const sides = [];
		if (!mine.some((n) => n.startsWith(`logic "${name}" `))) sides.push('main');
		if (!mine.includes(noteOf(name, logic.key, 'proposed', linesKey))) sides.push('proposed');
		for (const side of sides) {
			const r = await measureOnce(logic.code, inputOf(lines, side), logic.engine);
			if (r.error) {
				out.push({ logic: name, side, error: r.error });
				break;
			}
			out.push({ logic: name, side, readings: r.readings, note: noteOf(name, logic.key, side, linesKey) });
		}
	}
	return out;
}

/**
 * What `measureAip` measured on AIP `entry`, as the writes that record it: one `aip_measure` a number, written as
 * `as`.
 * @param {string} entry @param {any[]} rows @param {string} as
 */
export const readingsOf = (entry, rows, as) =>
	rows.flatMap((r) => (r.readings ?? []).map(([name, value]) => ({ op: 'aip_measure', entry, name, value, note: r.note, as })));
