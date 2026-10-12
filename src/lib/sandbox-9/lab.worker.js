// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · THE LAB'S WORKER — runs an experiment's two worlds (same seed, one rule changed) off the page's thread,
 * so the page never freezes, and sends the page what to draw: a frame of each field at most 30 times a second, a
 * point of the time charts every few days, the bar charts twice a second, and at the end the computed takeaway, the
 * verdict and whether each guess came true.
 *
 * Messages in:  { type: 'start', id, seed?, speed? } · { type: 'play' } · { type: 'pause' } · { type: 'speed', speed }
 *               (days a second; Infinity: as fast as it goes)
 * Messages out: { type: 'meta' } · { type: 'frame' } · { type: 'done' } · { type: 'error' }
 */
import { EXPERIMENTS, startExperiment } from './experiments.js';
import { makeViewer } from './view.js';
import { judgeGuesses } from './guesses.js';

const FRAME_MS = 33; // at most 30 frames a second
const PANEL_MS = 500;
const SLICE_MS = 40; // the longest the worker runs days before it looks at its messages again

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

const plain = (v) => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v == null ? v : JSON.parse(JSON.stringify(v)));
