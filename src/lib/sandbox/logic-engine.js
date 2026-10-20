// @ts-nocheck — plain JS, the logic host's own code
/*
 * THE LOGIC ENGINE — what runs in the logic host's worker (./logic-host.js, inside the shell of ./frame.js): the
 * shell's second lock, QuickJS and the logic core (./logic.js), and nothing else. It is frozen by version:
 * `node scripts/freeze-engine.mjs --logic "…"` bundles this file into static/engines/logic-v<n>.js and writes its BLAKE3
 * hash into ./engines.json, and a frozen engine never changes, so the same code given the same input decides the same
 * on it for good. A new capability is a new engine, beside the old ones.
 *
 * What an engine promises (version 1): code is a JS module, loaded into a QuickJS engine of its own with the core's
 * limits and its deterministic profile (seeded random, frozen clock, work counted in ticks), and called only the ways
 * the core's GLUE names, with one JSON text in and one out.
 *
 * Messages: { id, op: 'open', units: [{ code, file? }], seed?, now? } is answered with { id, ok: true, session,
 * units: [{ exports, error }] }; { id, op: 'call', session, unit, kind, name, json } with { id, ok: true, out } or
 * { id, ok: false, error }; { id, op: 'run', code, file?, seed?, now?, limits?, kind, name, json } (open, one call,
 * gone) with { id, ok: true, exports, out?, error? }; { id, op: 'end', session } with { id, ok: true }.
 *
 * Version 2: a run may name its own `limits`, held to the core's `MOST` (`within`), a measurement's (an AIP's measuring
 * logic, src/lib/proposals/measure.js); without them, the core's own. Version 1 ran every run on the core's own.
 */
import './lockdown.js';
import { open, quickjs, within } from './logic.js';

const sessions = new Map();
let next = 1;
const answer = (m) => self.postMessage([m, []]);

async function handle(m) {
	if (m.op === 'open') {
		const QJS = await quickjs();
		const units = m.units.map((u) => open(QJS, { code: String(u.code ?? ''), file: u.file, seed: m.seed, now: m.now }));
		const session = next++;
		sessions.set(session, units);
		return { session, units: units.map((u) => ({ exports: u.exports, error: u.error })) };
	}
	if (m.op === 'call') {
		const unit = sessions.get(m.session)?.[m.unit];
		if (!unit) throw new Error('that code is no longer loaded');
		if (unit.error) throw new Error(unit.error);
		return { out: unit.call(m.kind, m.name ?? null, String(m.json)) };
	}
	if (m.op === 'run') {
		const unit = open(await quickjs(), { code: String(m.code ?? ''), file: m.file, seed: m.seed, now: m.now, limits: within(m.limits) });
		try {
			if (unit.error) return { exports: [], error: unit.error };
			if (m.name != null && !unit.exports.includes(m.name)) return { exports: unit.exports, error: `it exports no ${m.name}` };
			return { exports: unit.exports, out: unit.call(m.kind, m.name ?? null, String(m.json)) };
		} catch (e) {
			return { exports: unit.exports, error: e.message || String(e) };
		} finally {
			unit.dispose();
		}
	}
	if (m.op === 'end') {
		for (const u of sessions.get(m.session) ?? []) u.dispose();
		sessions.delete(m.session);
		return {};
	}
	throw new Error(`no op ${String(m.op).slice(0, 40)}`);
}

self.onmessage = async (e) => {
	const m = e.data;
	if (!m || typeof m !== 'object') return;
	try {
		answer({ id: m.id, ok: true, ...(await handle(m)) });
	} catch (err) {
		answer({ id: m.id, ok: false, error: err?.message || String(err) });
	}
};
answer({ op: 'ready' });
