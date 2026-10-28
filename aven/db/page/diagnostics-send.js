// @ts-nocheck — plain JS
// A device's diagnostics, sent to avenDB's server for its person alone (Samuel 2026-10-26: "I don't want to copy paste
// anything"): every few minutes while the vault is open, and after each Run checks, by a pass this device signs for
// "avenDB diagnostics" (`POST /feed/diagnostics`, avendb-server's reports.rs). What goes is the page's whole report:
// timings, counts, short ids, never an entry's contents; and the view it was on, its path and page alone (`view`), never
// a query, and a short one ~10 s after the person opens another view (`viewChanged`), so each view's wait is seen. In theOS the Mac also reads its person's back, every device's,
// and keeps each as a file in ~/Library/Logs/TheOS/diagnostics (theos/app's `diagnostics_keep`), where they are read.
import { version } from '$app/environment';
import { actorDiagnostics } from '../../../maia/content/game/code/sources/device.js';
import { command, native } from '$lib/native';
import { playbackMetrics } from '$content/studio/playback-metrics.js';
import { diagnosticSnapshot } from './diagnostics-report.js';
import { latencyJournal } from './latency-journal.js';
import { lifecycle } from './lifecycle.js';
import { localTimings } from './local-timings.js';
import { feed } from './server.js';
import { session } from './session.svelte.js';
import { sync } from './sync.svelte.js';
import { viewReadiness } from './view-readiness.js';

/** The service a device names in its pass. */
export const AUDIENCE = 'avenDB diagnostics';
/** How often a device sends one while its vault is open, and the Mac reads them back (ms). */
const EVERY = 3 * 60_000;
/** How long after a view opens its report goes, and the least time between two such (ms). */
const SETTLE = 10_000;
const LEAST = 30_000;
/** The most bytes a report takes, as the server keeps them (256 KiB), with room for the pass. */
const MOST = 240 << 10;

/** What this device is, by its browser. */
export function deviceKind() {
	const ua = navigator.userAgent;
	return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Mac/.test(ua) ? 'Mac' : 'other';
}

/** The page's diagnostics now, without a run of the checks. */
export function snapshot() {
	latencyJournal.flush();
	return {
		viewReadiness: viewReadiness.snapshot(),
		...diagnosticSnapshot({
			phase: session.phase, build: version, device: deviceKind(), journal: latencyJournal.snapshot(), lifecycle: lifecycle()?.snapshot(),
			calls: localTimings.snapshot(), manifests: actorDiagnostics(), sync, playback: playbackMetrics.snapshot()
		})
	};
}

/** The view the page is on: its path and its page (`#chat`, `#performance/server`'s first part), never its query. */
export function view() {
	const page = location.hash.replace(/^#/, '').split('/')[0];
	return `${location.pathname}${/^[a-z-]{1,32}$/.test(page) ? `#${page}` : ''}`;
}

/** Whether the page is seen now, and how long it was hidden, from the lifecycle's journal: a report goes only while the
 *  page is seen (or from theOS), so `hiddenTotalMs` and `lastHiddenMs` say what the stretches before it were. */
export function visibility() {
	const context = lifecycle()?.timingContext();
	return {
		now: document.visibilityState,
		native: native(),
		elapsedMs: Math.round(context?.elapsedMs ?? 0),
		hiddenTotalMs: Math.round(context?.hiddenTotalMs ?? 0),
		lastHiddenMs: hiddenFor
	};
}

/** A pass of this device for the server's reports, or null while its vault is closed. */
async function pass() {
	if (session.phase !== 'open') return null;
	const got = await session.ask({ op: 'api_pass', audience: AUDIENCE }).catch(() => null);
	return got?.ok?.pass ?? null;
}

/** The server's answer to `body` with a pass, or null. */
async function post(body) {
	const p = await pass();
	if (!p) return null;
	const r = await fetch(`${feed()}/diagnostics`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: p, ...body })
	}).catch(() => null);
	return r?.ok ? r.json().catch(() => null) : null;
}

/** Sends `report`, cut down to what the server keeps: the biggest parts go first where it is too big. Whether it was kept. */
export async function sendReport(report) {
	const r = { ...report, view: view(), sentAt: Date.now(), kind: report.kind ?? 'maia-unified-diagnostics' };
	const size = () => new TextEncoder().encode(JSON.stringify(r)).length;
	for (const big of ['network', 'perf', 'timings', 'lifecycle']) {
		if (size() <= MOST) break;
		if (big in r) r[big] = { status: 'unavailable', reason: 'too-big-to-send' };
		else if (r.diagnostics && big in r.diagnostics) r.diagnostics = { ...r.diagnostics, [big]: { status: 'unavailable', reason: 'too-big-to-send' } };
	}
	if (size() > MOST) return false;
	return !!(await post({ report: r }))?.kept;
}

/** Reads this device's work and connections, as the Performance page does, for a report. */
async function engine() {
	const ask = (op) => session.ask({ op }).then((a) => a?.ok ?? null, () => null);
	const [perf, network] = await Promise.all([ask('perf'), ask('network')]);
	return { perf, network };
}

/** Its person's reports, the Mac keeps as files (theOS alone): how many were new. */
export async function keepReports() {
	if (!native()) return 0;
	const got = await post({});
	if (!Array.isArray(got?.reports) || !got.reports.length) return 0;
	return command('diagnostics_keep', { reports: got.reports }).catch(() => 0);
}

let busy = false;
let last = 0;
let settling = null;
/** When the page was last hidden (ms), and how long its last hidden stretch lasted. */
let hiddenAt = null;
let hiddenFor = 0;
/** Sends this device's report now, `why` it went (`every`, `view`), and in theOS reads its person's back. A page in
 *  the background waits; theOS goes on with its window hidden, as it is the one that keeps every device's reports
 *  (Samuel 2026-10-27: the reports stopped whenever theOS was behind another window). */
async function tick(why) {
	if (busy || session.phase !== 'open' || (document.hidden && !native())) return;
	busy = true;
	try {
		last = Date.now();
		await sendReport({ why, visibility: visibility(), diagnostics: snapshot(), ...(await engine()) });
		await keepReports();
	} finally {
		busy = false;
	}
}

/** Another view opened: its report goes once it had `SETTLE` to show, at most one each `LEAST`. */
export function viewChanged() {
	clearTimeout(settling);
	settling = setTimeout(() => {
		if (Date.now() - last >= LEAST) void tick('view');
	}, SETTLE);
}

/** The page was hidden or seen again: after a hidden stretch of `LEAST` or more, a report goes once it had `SETTLE`
 *  to catch up, so what the stretch cost its sync (pages lost in flight, askings stalled) is seen (S1b). */
function visibilityChanged() {
	if (document.hidden) {
		hiddenAt = Date.now();
		return;
	}
	if (hiddenAt === null) return;
	hiddenFor = Date.now() - hiddenAt;
	hiddenAt = null;
	if (hiddenFor < LEAST) return;
	clearTimeout(settling);
	settling = setTimeout(() => void tick('visible'), SETTLE);
}

/** While the vault is open: a report sent every `EVERY`, after a hidden stretch, and in theOS its person's read back.
 *  Its stop. */
export function sendEvery() {
	const first = setTimeout(() => tick('every'), 20_000);
	const timer = setInterval(() => tick('every'), EVERY);
	document.addEventListener('visibilitychange', visibilityChanged);
	return () => (clearTimeout(first), clearInterval(timer), clearTimeout(settling), document.removeEventListener('visibilitychange', visibilityChanged));
}
