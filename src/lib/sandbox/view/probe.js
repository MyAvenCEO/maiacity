// @ts-nocheck — plain JS: views made to do harm, as any vault could hold one
/*
 * WHAT A VIEW CAN'T DO — every way out an untrusted view would try, tried from inside one shown by the real view host
 * (../ViewHost.svelte), as the asset box's probe (../../assets/box/probe.js) tries every way out of the box. The probe
 * page (/app/views/probe/) shows them; scripts/probes.mjs runs it headless in Chromium, clicks what the view drew, and
 * counts what reached the canary. Every attempt must be refused or stopped.
 *
 * - `hostileView(canary)`: HTML and a draw script. The script (in the view's worker) tries the network, storage,
 *   cookies, code from strings, the page's DOM, navigating, opening windows, posting to the page outside its port and
 *   the MCP Apps methods a view is refused (`WORKER_TRIES`), and says what came of each as a view may, in a
 *   `notifications/message`. The HTML, and a picture of its DOM the script sends, reach out every way markup can
 *   (`HTML_TRIES`): what comes of those only the canary can tell, so each aims at its own address there.
 * - `spinView()`: a draw script that never yields, which the engine must stop.
 * - `burnView()`: a draw script that works without end in bursts, answering every ping between them and whatever else
 *   it hears, which its budget of work (./watch.js) must stop. It names view engine 2, from before the budget, as code
 *   that would step around a wall would: it runs on the floor all the same (../engines.js `engineFor`).
 * - `unknownEngineView()`: a view made for a view engine that was never frozen, which must not start.
 * - `heavyView()`: a draw script whose every animation frame holds its worker 300 ms, which its budget of work must
 *   slow down, never stop.
 * - `logicViews()`: a view's logic that never returns and one that eats its memory, which QuickJS must stop.
 *
 * `canary` is where every attempt aims (`<canary>/<attempt>`): an address only the probe's runner listens on, so a
 * request that left the box is seen there even when the box saw it fail.
 */

/** the mark of the page's DOM and cookie: a view that reads either reached the page */
export const SECRET = 'maia-probe-secret';

/** what the view's script tries, each said by the view itself, but those the page has to see for itself (`PAGE_SAYS`) */
export const WORKER_TRIES = [
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'WebTransport',
	'sendBeacon',
	'importScripts',
	'import()',
	'a nested worker',
	'a SharedWorker',
	'a blob: URL of its own',
	'eval',
	'new Function',
	'a timer of a string',
	'WebAssembly',
	'RTCPeerConnection',
	'indexedDB',
	'caches',
	'OPFS',
	'localStorage',
	'sessionStorage',
	'BroadcastChannel',
	'cookies',
	'cookieStore',
	'passkeys',
	"the page's DOM",
	'navigating the page',
	'navigating its frame',
	'opening a window',
	'posting to the page outside its port',
	'tools/call',
	'resources/read',
	'ui/open-link',
	'sampling/createMessage',
	'a message too big'
];

/** the attempts whose outcome the page sees, not the view: the script only says it tried */
export const PAGE_SAYS = ['posting to the page outside its port'];

/** what the view's HTML (and a picture of its DOM the script sends) reaches out to: each its own address at the canary */
export const HTML_TRIES = {
	'script-src': 'a <script src>',
	img: 'a picture from the network',
	srcset: 'a srcset',
	picture: 'a <picture> source',
	a: 'a link, clicked',
	'a-blank': 'a link to a new window, clicked',
	'a-top': 'a link to the page, clicked',
	'a-javascript': 'a javascript: link, clicked',
	form: 'a form, sent',
	formaction: 'a button with a formaction, clicked',
	'input-image': 'an image input',
	iframe: 'an <iframe>',
	object: 'an <object>',
	embed: 'an <embed>',
	'link-css': 'a stylesheet link',
	prefetch: 'a prefetch link',
	'meta-refresh': 'a meta refresh',
	base: 'a <base>',
	'css-import': 'a CSS @import',
	'css-url': 'a CSS background',
	'css-font': 'a CSS font',
	'style-attr': 'a style attribute',
	'svg-image': 'an SVG <image>',
	'svg-use': 'an SVG <use>',
	'svg-a': 'an SVG link',
	video: 'a <video>',
	poster: 'a video poster',
	audio: 'an <audio>',
	onerror: 'an onerror handler',
	ontoggle: 'an ontoggle handler',
	'svg-onload': 'an SVG onload handler',
	mxss: 'markup that mutates as it is parsed',
	'worker-img': 'a picture from the network, drawn by the script',
	'worker-a': 'a link, drawn by the script',
	'worker-iframe': 'an <iframe>, drawn by the script',
	'worker-form': 'a form, drawn by the script',
	'worker-script': 'a <script src>, drawn by the script',
	'worker-onerror': 'an onerror handler, drawn by the script'
};

/** the elements of the hostile view a person (or the probe's runner) clicks, or types into */
export const CLICKS = ['#probe-a', '#probe-blank', '#probe-top', '#probe-javascript', '#probe-submit', '#probe-formaction', '#probe-summary', '#probe-text'];

/** the view's script: every way out of its worker, each said as it went */
const script = (canary) => `
'use strict';
const C = ${JSON.stringify(canary)};
const host = new URL(C).host;
const WAIT = 3000;
// what the page answers: by its id
let next = 0;
const waiting = new Map();
self.addEventListener('message', (e) => {
	const m = e.data;
	if (m && m.id != null && waiting.has(m.id)) {
		waiting.get(m.id)(m);
		waiting.delete(m.id);
	}
});
const ask = (method, params) =>
	new Promise((ok) => {
		const id = 'probe-' + ++next;
		waiting.set(id, ok);
		parent.postMessage({ jsonrpc: '2.0', id, method, params });
	});
const answer = (r) => {
	if (r.error) throw new Error(r.error.message);
	return JSON.stringify(r.result ?? null);
};
const tell = (probe, said) => parent.postMessage({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'probe', data: { probe, said: String(said).slice(0, 160) } } });
const event = (target, ok, no) => {
	target.onopen = () => ok('open');
	target.onload = () => ok('loaded');
	target.onmessage = () => ok('a message');
	target.onerror = () => no(new Error('error'));
};

const tries = {
	fetch: () => fetch(C + '/fetch').then((r) => r.status),
	XMLHttpRequest: () =>
		new Promise((ok, no) => {
			const x = new XMLHttpRequest();
			event(x, () => ok(x.status), no);
			x.open('GET', C + '/xhr');
			x.send();
		}),
	WebSocket: () => new Promise((ok, no) => event(new WebSocket(C.replace(/^http/, 'ws') + '/websocket'), ok, no)),
	EventSource: () => new Promise((ok, no) => event(new EventSource(C + '/eventsource'), ok, no)),
	WebTransport: () => new WebTransport('https://' + host + '/webtransport').ready.then(() => 'open'),
	sendBeacon: () => {
		if (!navigator.sendBeacon(C + '/beacon', 'x')) throw new Error('not queued');
		return 'queued';
	},
	importScripts: () => importScripts(C + '/import-scripts.js'),
	'import()': () => import(C + '/import.js'),
	'a nested worker': () => new Promise((ok, no) => event(new Worker(C + '/worker.js'), ok, no)),
	'a SharedWorker': () => new Promise((ok, no) => event(new SharedWorker(C + '/shared-worker.js').port, ok, no)),
	'a blob: URL of its own': () => {
		const u = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
		if (!String(u).startsWith('blob:')) throw new Error('it made ' + u);
		return u;
	},
	eval: () => (0, eval)('1 + 1'),
	'new Function': () => new Function('return 1')(),
	'a timer of a string': () =>
		new Promise((ok, no) => {
			setTimeout('self.__probeTimer = 1', 0);
			setTimeout(() => (self.__probeTimer ? ok('it ran') : no(new Error('it never ran'))), 300);
		}),
	WebAssembly: () => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => 'compiled'),
	RTCPeerConnection: () => new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + host }] }) && 'made',
	indexedDB: () =>
		new Promise((ok, no) => {
			const r = indexedDB.open('maia-view-probe');
			r.onsuccess = () => ok('opened');
			r.onerror = () => no(r.error);
		}),
	caches: () => caches.open('maia-view-probe').then(() => 'opened'),
	OPFS: () => navigator.storage.getDirectory().then(() => 'opened'),
	localStorage: () => (localStorage.setItem('maia-view-probe', '1'), 'written'),
	sessionStorage: () => (sessionStorage.setItem('maia-view-probe', '1'), 'written'),
	BroadcastChannel: () => (new BroadcastChannel('maia-view-probe').postMessage('hello'), 'sent'),
	cookies: () => {
		document.cookie = 'maia-view-probe=1; path=/';
		const c = String(document.cookie ?? '');
		if (c.includes('${SECRET}')) return c;
		throw new Error('no cookie of the page in reach');
	},
	cookieStore: () => cookieStore.get('${SECRET}').then((c) => (c ? c.value : Promise.reject(new Error('none')))),
	passkeys: () => navigator.credentials.get({ publicKey: { challenge: new Uint8Array(32), timeout: 1000 } }).then(() => 'asked'),
	"the page's DOM": () => {
		for (const w of [self.parent, self.top, self.opener, self.frameElement, self])
			if (String(w?.document?.documentElement?.outerHTML ?? '').includes('${SECRET}')) return 'read it';
		throw new Error('nothing of the page in reach');
	},
	'navigating the page': () => {
		top.location = C + '/top';
		return 'top.location set';
	},
	'navigating its frame': () => {
		self.location.href = C + '/location';
		return 'location set';
	},
	'opening a window': () => {
		if (!open(C + '/open')) throw new Error('open gave nothing');
		return 'opened';
	},
	// to the frame's engine as its worker, which listens only to its port; and to the frame's engine down the port
	// itself, as messages the engine never takes from a worker: the page sees whether any came through
	'posting to the page outside its port': () => {
		self.postMessage({ op: 'event', name: 'maia-probe-escape', value: 'self.postMessage' });
		const real = MessagePort.prototype.postMessage;
		MessagePort.prototype.postMessage = function (...a) {
			MessagePort.prototype.postMessage = real;
			for (const op of ['event', 'ready', 'size', 'view']) real.call(this, { op, name: 'maia-probe-escape', value: 'forged', height: 1, html: '<p>forged</p>' });
			return real.apply(this, a);
		};
		parent.postMessage({ jsonrpc: '2.0', method: 'ping' });
		return 'its frame, and forged messages down its port';
	},
	'tools/call': () => ask('tools/call', { name: 'avendb', arguments: { op: 'read' } }).then(answer),
	'resources/read': () => ask('resources/read', { uri: 'ui://maiacity/keys' }).then(answer),
	'ui/open-link': () => ask('ui/open-link', { url: C + '/open-link' }).then(answer),
	'sampling/createMessage': () => ask('sampling/createMessage', { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }], maxTokens: 9 }).then(answer),
	'a message too big': () => ask('ui/message', { role: 'user', content: [{ type: 'text', text: 'x'.repeat(5000) }] }).then(answer)
};

// a picture of its DOM that reaches out: the engine draws it in the frame only once it is made safe again
document.body.insertAdjacentHTML(
	'beforeend',
	'<div id="from-worker"><img src="' + C + '/worker-img" alt=""><a href="' + C + '/worker-a">a link</a><iframe src="' + C + '/worker-iframe"></iframe>' +
		'<form action="' + C + '/worker-form"><button>send</button></form><script src="' + C + '/worker-script"></scr' + 'ipt>' +
		'<img src="data:image/gif;base64,AAAA" onerror="location=\\'' + C + '/worker-onerror\\'" alt=""></div>'
);

(async () => {
	// the page must answer what it allows, or every refusal below would mean nothing
	const control = await Promise.race([ask('ping', {}), new Promise((ok) => setTimeout(() => ok(null), WAIT))]);
	tell('(the page answers a ping)', control && !control.error ? 'answered' : 'no answer');
	await Promise.all(
		Object.entries(tries).map(async ([name, attempt]) => {
			let said;
			try {
				const got = await Promise.race([Promise.resolve().then(attempt), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 3 s')), WAIT))]);
				said = (${JSON.stringify(PAGE_SAYS)}.includes(name) ? 'tried, the page says: ' : 'OPEN: ') + String(got).slice(0, 80);
			} catch (err) {
				said = 'blocked: ' + String(err?.message ?? err).slice(0, 120);
			}
			tell(name, said);
		})
	);
	tell('(done)', Object.keys(tries).length);
})();
`;

/** a view made to do harm: HTML that reaches out every way markup can, and a script that tries every way out */
export function hostileView(canary) {
	const c = canary;
	const html = `<style>
	@import url("${c}/css-import");
	.bg { background: url("${c}/css-url") }
	@font-face { font-family: probe; src: url("${c}/css-font") }
	body { font: 14px/1.4 system-ui, sans-serif; margin: 12px }
</style>
<h3 id="probe-mark">Every way out of a view, tried from inside one</h3>
<p>Its script tries every way out of its worker; this markup reaches out every way markup can. The links and buttons below
go nowhere: click them.</p>
<script src="${c}/script-src"></script>
<p>
	<img src="${c}/img" alt="a picture from the network"> <img srcset="${c}/srcset 1x" alt="">
	<picture><source srcset="${c}/picture"><img alt=""></picture>
</p>
<p>
	<a id="probe-a" href="${c}/a">a link</a> ·
	<a id="probe-blank" href="${c}/a-blank" target="_blank" rel="opener">a new window</a> ·
	<a id="probe-top" href="${c}/a-top" target="_top">the page</a> ·
	<a id="probe-javascript" href="javascript:top.location='${c}/a-javascript'">a script</a>
</p>
<form action="${c}/form" method="get"><input name="q" value="x"><button id="probe-submit" type="submit">send the form</button></form>
<p>
	<button id="probe-formaction" type="submit" formaction="${c}/formaction">send elsewhere</button>
	<input id="probe-text" name="q" value="press Enter here">
	<input type="image" src="${c}/input-image" alt="">
</p>
<iframe src="${c}/iframe"></iframe><object data="${c}/object"></object><embed src="${c}/embed">
<link rel="stylesheet" href="${c}/link-css"><link rel="prefetch" href="${c}/prefetch"><link rel="preconnect" href="${c}">
<meta http-equiv="refresh" content="0;url=${c}/meta-refresh"><base href="${c}/base/">
<div class="bg" style="background-image: url('${c}/style-attr')">a styled box</div>
<svg width="24" height="24"><image href="${c}/svg-image" width="24" height="24"></image><use href="${c}/svg-use#x"></use><a href="${c}/svg-a"><text y="16">x</text></a></svg>
<video src="${c}/video" poster="${c}/poster"></video><audio src="${c}/audio"></audio>
<img src="data:image/gif;base64,AAAA" onerror="parent.postMessage('maia-probe-escape', '*'); top.location='${c}/onerror'" alt="">
<details open ontoggle="top.location='${c}/ontoggle'"><summary id="probe-summary">a toggle</summary>what it holds</details>
<svg onload="top.location='${c}/svg-onload'"></svg>
<noscript><p title="</noscript><img src=${c}/mxss onerror=top.location='${c}/mxss'>"></p></noscript>
<script>${script(c)}</script>`;
	return { id: 'probe-hostile', title: 'A view made to do harm', kind: 'html', spec: { html, height: 520 } };
}

/** a draw script that never yields: the engine must stop its worker */
export const spinView = () => ({ id: 'probe-spin', title: 'A script that never yields', kind: 'html', spec: { html: '<p>This script never yields.</p><script>for (;;) {}</script>', height: 160 } });

/**
 * A draw script that works without end, in bursts of 400 ms with a break after each, so its worker answers every ping
 * (the engine's four seconds never see it). It answers at once whatever it hears on any port it can find, and sends
 * numbers of its own ahead, as answers to asks not made yet; and it names view engine 2, which had no budget. Its
 * budget of work must stop it all the same.
 */
const BURN = `
'use strict';
const data = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
const ports = new Set();
Object.defineProperty(MessageEvent.prototype, 'data', {
	configurable: true,
	get() {
		const p = this.target;
		if (p instanceof MessagePort && !ports.has(p)) {
			ports.add(p);
			p.addEventListener('message', (e) => p.postMessage(data.call(e)));
		}
		return data.call(this);
	}
});
setInterval(() => {
	for (const p of ports) for (let i = 0; i < 20; i++) p.postMessage(String(Math.random()));
}, 50);
const busy = (ms) => {
	const t = performance.now();
	while (performance.now() - t < ms);
};
setInterval(() => busy(400), 0);
`;
export const burnView = () => ({ id: 'probe-burn', title: 'A script that works without end, in bursts', kind: 'html', engine: 2, spec: { html: `<p>This script works in bursts, a break after each, and answers whatever it hears.</p><script>${BURN}</script>`, height: 160 } });

/**
 * A draw script whose every animation frame holds its worker 300 ms, as a scene a slow graphics card can't keep up
 * with does: past half its budget its frames must come further apart, and it must go on. It says, as `HEAVY`, how many
 * frames it drew, how many of them came 400 ms or more after the one before (spaced out: 300 ms of its own work, and
 * a pace of 100 ms or more), and how far apart two came at most.
 */
export const HEAVY = '(a heavy scene)';
const HEAVY_SCRIPT = `
'use strict';
let [frames, spaced, last, widest] = [0, 0, 0, 0];
const busy = (ms) => {
	const t = performance.now();
	while (performance.now() - t < ms);
};
function draw() {
	const now = performance.now();
	if (last) widest = Math.max(widest, now - last);
	if (last && now - last >= 400) spaced++;
	last = now;
	frames++;
	parent.postMessage({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'probe', data: { probe: ${JSON.stringify(HEAVY)}, said: JSON.stringify({ frames, spaced, widest: Math.round(widest) }) } } });
	busy(300);
	requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
`;
export const heavyView = () => ({ id: 'probe-heavy', title: 'A scene too heavy for the device', kind: 'html', spec: { html: `<p>Each of this script’s frames holds its worker 300 ms.</p><script>${HEAVY_SCRIPT}</script>`, height: 160 } });

/** a view made for a view engine that was never frozen: no page has it, so it must not start */
export const UNKNOWN_ENGINE = 99;
export const unknownEngineView = () => ({ id: 'probe-engine', title: 'A view made for an engine that does not exist', kind: 'html', engine: UNKNOWN_ENGINE, spec: { html: '<p>This view names view engine 99.</p>', height: 80 } });

/** a view's logic that never returns, and one that eats its memory: QuickJS must stop both */
export const logicViews = () => [
	{ id: 'probe-logic-spin', title: 'Logic that never returns', kind: 'html', spec: { html: '<p>Its logic never returns: {{n}}</p>', data: { n: 0 }, height: 160, logic: 'export function init(data) {\n\tfor (;;) {}\n}\n' } },
	{ id: 'probe-logic-memory', title: 'Logic that eats its memory', kind: 'html', spec: { html: '<p>Its logic eats its memory: {{n}}</p>', data: { n: 0 }, height: 160, logic: 'export function init(data) {\n\tconst all = [];\n\tfor (;;) all.push(new Array(100000).fill(all.length));\n}\n' } }
];
