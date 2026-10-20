// @ts-nocheck — plain JS, kept loose on purpose, as the other logic of ours is ($lib/avendb/functions.js)
// The Measurer's job (avendb/docs/ARCHITECTURE.md §8, "AIPs", N2): an AIP's objective names the measuring logic that
// measures it (`def sim : Measure := logic "valley-sim"`, avendb/spec/AvenDB/Objective.lean), a logic module on the
// main line of the AIP's vault, which its owners accepted, so trusted code, tagged `ref:logic/measures/<name>`, that
// exports `measure(input)`. The job runs it in our logic host ($lib/sandbox/logic-host.js: a fresh QuickJS engine,
// no page, no network, no keys, no clock, its work counted in ticks, its random seeded by its input) on the records
// of the AIP's lines, the input nobody trusts: first main's side, once, as the baseline, then the proposal's, each
// time its lines or the logic change. What it hands back, named numbers, the job records on the AIP as readings
// (`aip_measure`), written by a device of a vault holding the vault's Measurer group, never the AIP's author, so
// `measured "name"` counts them. Every run is a pure function of the logic and the records: anyone who reads both
// can run it again and get the same numbers (`measureOnce`).
//
// It runs where it is given an agent device that acts as the Measurer (scripts/measure.mjs, on avenDB's server).

import { checkCode } from '../../../game/code/check.js';
import { seedOf } from '../sandbox/logic.js';
import { runOnce } from '../sandbox/logic-host.js';

/** The tag of the measuring logic an objective names `name`, on its vault's main line. @param {string} name */
export const tagOf = (name) => `ref:logic/measures/${name}`;

/**
 * What one run of a measuring logic may use: more than a game rule's call, since a measurement may run a whole sim,
 * still counted in ticks, the same on every device, the clock only a backstop well past them.
 */
export const MEASURE = { memory: 64 << 20, stack: 1 << 20, load: { ticks: 2000, ms: 5000 }, call: { ticks: 20_000, ms: 120_000 } };

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
 * @param {string} code @param {object} input @param {number} [engine] the logic engine it is written for
 * @returns {Promise<{ readings?: [string, number][], error?: string }>}
 */
export async function measureOnce(code, input, engine) {
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
 * One round of the Measurer `me` (its vault's id) over vault `vault`: for each AIP worked on or proposed whose
 * objective names measuring logic, each named logic run on main's side once (where `me` recorded nothing from it yet)
 * and on the proposal's side where `me` recorded nothing from this logic on these lines yet, each number written as
 * a reading. `ask` reads (avendb_ask), `run` writes (avendb_run); `dry` writes nothing. Answers what it did: one row
 * per AIP, logic and side, `{ aip, logic, side, readings }` or `{ aip, logic, error }`.
 * @param {{ ask: (op: object) => Promise<any>, run: (op: object) => Promise<any>, vault: string, me: string, dry?: boolean }} o
 */
export async function measureRound({ ask, run, vault, me, dry = false }) {
	const out = [];
	for (const a of await ask({ op: 'aips', vault })) {
		const names = a.objective?.measures ?? [];
		if (!names.length || !['objective', 'proposed'].includes(a.stage) || a.outcome) continue;
		const mine = (a.objective.readings ?? []).filter((r) => r.measured && r.by === me).map((r) => r.note ?? '');
		let lines = null;
		for (const name of names) {
			const logic = await logicOf(ask, vault, name);
			if (logic.error) {
				out.push({ aip: a.entry, logic: name, error: logic.error });
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
					out.push({ aip: a.entry, logic: name, side, error: r.error });
					break;
				}
				const note = noteOf(name, logic.key, side, linesKey);
				if (!dry) for (const [n, value] of r.readings) await run({ op: 'aip_measure', entry: a.entry, name: n, value, note });
				out.push({ aip: a.entry, logic: name, side, readings: r.readings });
			}
		}
	}
	return out;
}
