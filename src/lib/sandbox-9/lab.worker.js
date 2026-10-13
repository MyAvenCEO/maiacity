// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE LAB'S WORKER — runs an experiment's two worlds (same seed, one rule changed) off the page's thread,
 * so the page never freezes, and sends the page what to draw: a frame of each field at most 30 times a second, a
 * point of the time charts every few days, the bar charts twice a second, and at the end the computed takeaway, the
 * verdict and whether each guess came true. About once a simulated month it also reads each world's yearly records
 * (./records.js livingYears, villageYears, borderYears, foundingBill) for the Living and Imports tabs, and at the start
 * every parameter each world runs with (./engine.js paramSet) for the World tab.
 *
 * Messages in:  { type: 'start', id, seed?, speed? } · { type: 'play' } · { type: 'pause' } · { type: 'speed', speed }
 *               (days a second; Infinity: as fast as it goes)
 * Messages out: { type: 'meta', params, stats } · { type: 'frame', stats? } · { type: 'done', stats } · { type: 'error' }
 */
import { EXPERIMENTS, startExperiment } from './experiments.js';
import { makeViewer } from './view.js';
import { judgeGuesses } from './guesses.js';
// read as namespaces: a reader the engine does not have (yet) is simply left out, never a failed build
import * as ENG from './engine.js';
import * as REC from './records.js';
import { livingOf, importsOf, aiOf } from './params.js';
import { DAY } from '../sandbox-7/specs.js';

const FRAME_MS = 33; // at most 30 frames a second
const PANEL_MS = 500;
const SLICE_MS = 40; // the longest the worker runs days before it looks at its messages again
const STATS_DAYS = 30; // read the yearly records about once a simulated month

let run = null; // { exp, runner, vb, vc, every, ptA, playing, speed, owed, last, stepMs, lastFrame, lastPanel, done }

self.onmessage = (e) => {
	const m = e.data;
	try {
		if (m.type === 'start') start(m);
		else if (!run) return;
		else if (m.type === 'play') {
			run.playing = true;
			run.last = performance.now();
			schedule(0);
		} else if (m.type === 'pause') run.playing = false;
		else if (m.type === 'speed') {
			run.speed = m.speed;
			run.owed = 0;
		}
	} catch (err) {
		self.postMessage({ type: 'error', message: String(err?.stack || err) });
	}
};

function start(m) {
	const exp = EXPERIMENTS[m.id];
	if (!exp) throw new Error(`no experiment ${m.id}`);
	const t0 = performance.now();
	const runner = startExperiment(exp, { seed: m.seed, frameEvery: 1e9 });
	const days = runner.days;
	run = {
		exp,
		runner,
		vb: makeViewer(runner.base),
		vc: makeViewer(runner.changed),
		every: Math.max(1, Math.round(days / 520)),
		ptA: 0,
		points: { base: [], changed: [] },
		playing: false,
		speed: m.speed ?? 91,
		owed: 0,
		last: performance.now(),
		stepMs: 0,
		lastFrame: 0,
		lastPanel: 0,
		done: false,
		createMs: performance.now() - t0
	};
	self.postMessage({
		type: 'meta',
		id: exp.id,
		days,
		years: days / 365,
		every: run.every,
		seed: runner.base.cfg.seed,
		people: runner.base.N,
		shocks: { base: runner.base.cfg.shocks ?? [], changed: runner.changed.cfg.shocks ?? [] },
		// every parameter each world runs with (the World tab): its settings and the catalog constants it was built from
		params: { base: paramsOf(runner.base), changed: paramsOf(runner.changed), defaults: plain(ENG.paramSet?.(runner.base)?.defaults ?? ENG.DEFAULTS ?? null) },
		stats: statsNow(),
		createMs: run.createMs
	});
	post(true);
}

let timer = 0;
function schedule(ms) {
	clearTimeout(timer);
	timer = setTimeout(tick, ms);
}

function tick() {
	const r = run;
	if (!r || !r.playing || r.done) return;
	const now = performance.now();
	const fast = !Number.isFinite(r.speed);
	r.owed = Math.min(r.owed + (r.speed * (now - r.last)) / 1000, Math.max(1, r.speed * 0.25));
	r.last = now;
	const t0 = performance.now();
	let ran = 0;
	while ((fast || r.owed >= 1) && performance.now() - t0 < SLICE_MS) {
		const more = r.runner.advance(1);
		r.vb.day();
		r.vc.day();
		ran++;
		if (!fast) r.owed -= 1;
		const d = r.runner.day;
		if (d - r.ptA >= r.every || !more) {
			r.points.base.push(r.vb.point(r.ptA, d));
			r.points.changed.push(r.vc.point(r.ptA, d));
			r.ptA = d;
		}
		if (!more) {
			r.done = true;
			break;
		}
	}
	r.stepMs += performance.now() - t0;
	r.ranSince = (r.ranSince ?? 0) + ran;
	if (r.done || performance.now() - r.lastFrame >= FRAME_MS) post(r.done || performance.now() - r.lastPanel >= PANEL_MS);
	if (r.done) return finish();
	schedule(fast ? 0 : 16);
}

function post(withPanel) {
	const r = run;
	const fb = r.vb.frame(), fc = r.vc.frame();
	const msg = {
		type: 'frame',
		day: r.runner.day,
		days: r.runner.days,
		ranDays: r.ranSince ?? 0,
		msPerYear: r.runner.day > 0 ? (r.stepMs / r.runner.day) * 365 : null,
		base: fb,
		changed: fc,
		points: r.points
	};
	if (withPanel) {
		msg.panel = { base: r.vb.panel(), changed: r.vc.panel() };
		r.lastPanel = performance.now();
		if (r.done || r.runner.day - r.statsDay >= r.statsEvery) msg.stats = statsNow();
	}
	r.points = { base: [], changed: [] };
	r.ranSince = 0;
	r.lastFrame = performance.now();
	const transfer = [];
	for (const f of [fb, fc]) for (const k of ['dec', 'adec', 'owner', 'met', 'hold', 'living', 'div', 'aven', 'spent', 'lim', 'price']) transfer.push(f[k].buffer);
	self.postMessage(msg, transfer);
}

function finish() {
	const r = run;
	const res = r.runner.finish();
	const summary = (x) => ({
		pass: x.prop3.pass,
		P1: { pass: x.prop3.P1.pass, personDaysShort: x.prop3.P1.personDaysShortAny, peopleEverShort: x.prop3.P1.peopleEverShort },
		P2: { strict: { pass: x.prop3.P2.strict.pass, from: x.prop3.P2.strict.holdsEveryDayFrom }, normal: { pass: x.prop3.P2.normal.pass, failures: x.prop3.P2.normal.failures } },
		P3: { pass: x.prop3.P3.pass, failed: x.prop3.P3.failed },
		abundance: { pass: x.prop3.abundance.pass, mindBindsBasics: x.prop3.abundance.mindBindsBasics }
	});
	self.postMessage({
		type: 'done',
		stats: statsNow(),
		result: {
			id: res.id,
			question: res.question,
			ruleChanged: res.ruleChanged,
			years: res.years,
			seed: res.seed,
			takeaway: res.takeaway,
			verdict: { pass: !!res.verdict.pass, claim: res.verdict.claim, evidence: res.verdict.evidence },
			metrics: res.metrics.map((m) => ({ id: m.id, label: m.label, base: plain(m.base), changed: plain(m.changed) })),
			guesses: judgeGuesses(r.exp, res.base, res.changed, r.runner.base, r.runner.changed, res.verdict),
			prop3: { base: summary(res.base), changed: summary(res.changed) },
			ms: res.ms,
			stepMs: r.stepMs,
			msPerYear: (r.stepMs / Math.max(1, r.runner.day)) * 365
		}
	});
}

/**
 * A world's parameters as plain data: the settings it runs with, the catalog constants it was built from and the
 * village facts (./engine.js paramSet), or, from an engine without it, its config and constants.
 */
function paramsOf(w) {
	const p = ENG.paramSet ? ENG.paramSet(w) : { settings: w.cfg, catalog: w.c };
	return { settings: plain(p.settings ?? w.cfg), catalog: plain(p.catalog ?? w.c ?? {}), village: plain(p.village ?? null) };
}

/** each world's yearly living standards, border ledger and AI market so far (the Living, Imports and AI tabs) */
function statsNow() {
	const r = run;
	if (!r) return null;
	const t0 = performance.now();
	const one = (w) => {
		try {
			const L = REC.livingYears?.(w) ?? null, V = REC.villageYears?.(w) ?? null;
			const B = REC.borderYears?.(w) ?? null, F = REC.foundingBill?.(w) ?? null;
			const A = REC.aiYears?.(w) ?? null;
			return { living: plain(livingOf(L, V, w.c, DAY)), imports: plain(importsOf(B, F, V, {}, L)), ai: plain(aiOf(A)) };
		} catch (err) {
			return { error: String(err?.message || err) };
		}
	};
	const out = { base: one(r.runner.base), changed: one(r.runner.changed), day: r.runner.day };
	r.statsDay = r.runner.day;
	// reading the records should cost little; if it does not, read them less often
	const ms = performance.now() - t0;
	r.statsEvery = ms > 40 ? STATS_DAYS * 4 : ms > 15 ? STATS_DAYS * 2 : STATS_DAYS;
	return out;
}

const plain = (v) => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v == null ? v : JSON.parse(JSON.stringify(v)));
