// @ts-nocheck — plain JS
// The ported simulation ($lib/factories/des.js) gives the BatteryPack line exactly the numbers AirSup's own engine gave
// it: `node scripts/check.mjs spec.js --days 5` of AirSup's factory-skill at commit 9fde755, run on 2026-10-15 on the
// same spec (/mnt/project-files/factories/batterypack-line/check.json). Same seed, same equations, same draws: the
// numbers are equal, not close.
// Run: bun test src/lib/factories/des.test.js
import { expect, test } from 'bun:test';
import { SPEC } from './batterypack-line.js';
import { forecast, plan } from './des.js';

/** what check.mjs printed (--json) for the spec as it is */
const CHECK = {
	plan: { perDay: 120, takt: 480, daySec: 57600 },
	perDay: 160.2,
	scrapPerDay: 6.8,
	bottleneck: 'load',
	wip: 24,
	leadTime: 3025.30437469468,
	servers: { sort: 1, drawer: 1, load: 1, plates: 1, smt: 1, flash: 1, bms: 1, close: 1, eol: 2, pack: 1 },
	failures: { sort: 17, drawer: 0, load: 23, plates: 0, smt: 8, flash: 0, bms: 0, close: 0, eol: 8, pack: 4 },
	st: {
		sort: { busy: 0.6423489661254377, blocked: 0.35215044736507384, down: 0.005500586509488485, starved: 0 },
		drawer: { busy: 0.6843096039014807, blocked: 0.3156903960985194, down: 0, starved: 0 },
		load: { busy: 0.9601849716608828, blocked: 0, down: 0.039815028339117264, starved: 0 },
		plates: { busy: 0.852831552762486, blocked: 0, down: 0, starved: 0.14716844723751393 },
		smt: { busy: 0.26298469297833105, blocked: 0.7326634335296249, down: 0.004351873492043942, starved: 0 },
		flash: { busy: 0.3521557331752292, blocked: 0.6478442668247708, down: 0, starved: 0 },
		bms: { busy: 0.6762583248224758, blocked: 0, down: 0, starved: 0.32374167517752417 },
		close: { busy: 0.5062229611720724, blocked: 0, down: 0, starved: 0.49377703882792756 },
		eol: { busy: 0.6853914817177298, blocked: 0, down: 0.007552076148452809, starved: 0.30705644213381744 },
		pack: { busy: 0.16813804510751096, blocked: 0, down: 0, starved: 0.831861954892489 }
	}
};

test('the plan sizes the line as check.mjs did', () => {
	const p = plan(SPEC);
	expect(p.perDay).toBe(CHECK.plan.perDay);
	expect(p.takt).toBe(CHECK.plan.takt);
	expect(p.daySec).toBe(CHECK.plan.daySec);
	for (const st of p.stations) expect(st.servers).toBe(CHECK.servers[st.id]);
	expect(p.sink).toBe('pack');
});

test('five production days give the numbers AirSup’s check.mjs printed', () => {
	const p = plan(SPEC);
	const r = forecast(p, {}, { days: 5 });
	expect(r.perDay).toBeCloseTo(CHECK.perDay, 6);
	expect(r.scrapPerDay).toBeCloseTo(CHECK.scrapPerDay, 6);
	expect(r.bottleneck).toBe(CHECK.bottleneck);
	expect(r.wip).toBe(CHECK.wip);
	expect(r.leadTime).toBeCloseTo(CHECK.leadTime, 6);
	expect(r.failures).toEqual(CHECK.failures);
	for (const [id, w] of Object.entries(CHECK.st)) for (const k of Object.keys(w)) expect(r.st[id][k]).toBeCloseTo(w[k], 9);
});

test('a second cell loading robot moves the constraint to the plates bench', () => {
	const r = forecast(plan(SPEC), { load: { servers: 2 } }, { days: 5 });
	expect(r.perDay).toBeGreaterThan(CHECK.perDay);
	expect(r.bottleneck).toBe('plates');
});
