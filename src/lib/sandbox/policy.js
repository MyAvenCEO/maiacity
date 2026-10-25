// @ts-nocheck — plain JS
/*
 * The walls every sandboxed frame of ours shares (the asset box, the view frames): one list, so a feature turned off
 * for one is off for all. Part of the kernel: changing it changes every box at once. With them, the one script each
 * kind of frame runs, and the page's own policy, which names those scripts by their hash: vite.config.ts hands it to
 * SvelteKit for every page, and the Mac app's (vault/app/tauri.conf.json) is held to it (./policy.test.js).
 */

/** Every powerful browser feature, off: no device, no passkey, no clipboard, no payment, no full screen. */
export const DENIED = [
	'camera', 'microphone', 'geolocation', 'display-capture', 'clipboard-read', 'clipboard-write', 'payment', 'usb',
	'serial', 'hid', 'bluetooth', 'midi', 'publickey-credentials-get', 'publickey-credentials-create', 'storage-access',
	'fullscreen', 'screen-wake-lock', 'idle-detection', 'local-fonts', 'otp-credentials', 'xr-spatial-tracking'
];

/** The frame's `allow` attribute: every feature in DENIED turned off. */
export const DENY = DENIED.map((f) => `${f} 'none'`).join('; ');

/** The `sandbox` attribute: scripts, and nothing else (no same origin, forms, popups, modals, downloads, top navigation). */
export const SANDBOX = 'allow-scripts';

/**
 * How long and how much the page lets code we cannot trust have, in one place (the page's side; what a frozen engine
 * holds code to inside its worker is frozen with it and changes only with a new version: the logic core's ticks and
 * memory, ./logic.js LIMITS; a view script's 4 s hold and its work budget, ./view/engine.js and ./view/watch.js; a
 * formula's size and a batch's work, ./math.js LIMITS).
 * - job: how long one job may hold a shell (the asset box) before its room, or the shell, is ended (ms)
 * - logicJob: the same for the logic host, far past the logic core's own limits (ms)
 * - mathJob: how long one batch of a doc's formulas may hold the math host's shell before its worker is ended, past
 *   the math engine's own budget for a batch (./math.js LIMITS) (ms)
 * - message: the most a view may send the page in one message (characters of JSON)
 */
export const BUDGETS = { job: 20000, logicJob: 10000, mathJob: 6000, message: 4000 };

/** What a frame's own policy shuts, every one of them, unless the frame's kind opens one to what it names. */
export const SHUT = ['connect-src', 'img-src', 'style-src', 'font-src', 'media-src', 'frame-src', 'object-src', 'manifest-src', 'form-action', 'base-uri'];

/** What no frame of ours may ever open, whatever its kind: no connection, no frame inside it, no plug-in, no form, no base. */
export const NEVER = ['connect-src', 'frame-src', 'object-src', 'manifest-src', 'form-action', 'base-uri'];

/**
 * A frame's Content Security Policy, one way for every kind (the shell's, ./frame.js; a view's, ./view-host.js): it
 * starts from nothing (default-src 'none'), runs the scripts `script` names, makes workers and children only from blob:
 * URLs, and shuts every directive in SHUT but those `open` names. A directive in NEVER cannot be opened.
 * @param {{ script: string, children?: boolean, open?: Record<string, string> }} o
 */
export function frameCsp({ script, children = false, open = {} }) {
	const opened = NEVER.find((d) => d in open);
	if (opened) throw new Error(`no frame of ours opens ${opened}`);
	return ["default-src 'none'", `script-src ${script}`, 'worker-src blob:', ...(children ? ['child-src blob:'] : []), ...SHUT.map((d) => `${d} ${open[d] ?? "'none'"}`)].join('; ');
}

/**
 * The script of every shell's frame (./frame.js), the same text in each. It makes a worker of the engine it is handed
 * for each room the page names, and never puts two rooms in one worker; it passes messages both ways, the arrays
 * moved, and names each one a worker sends by that worker's room, which nothing in the worker can set. A worker made
 * ahead, nothing run in it yet (the spare, when the page asks for one), is the next new room's.
 */
export const SHELL_SCRIPT = `let url, warm, spare;
const rooms = new Map(), roomOf = new WeakMap();
const fresh = () => {
	const w = new Worker(url);
	w.onmessage = (x) => parent.postMessage([x.data[0], roomOf.get(w) ?? null], '*', x.data[1]);
	w.onerror = (x) => { x.preventDefault(); parent.postMessage([{ op: 'crash', error: String(x.message) }, roomOf.get(w) ?? null], '*'); };
	return w;
};
addEventListener('message', (e) => {
	if (e.source !== parent) return;
	const m = e.data;
	if (m && m.op === 'boot' && !url) {
		url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
		warm = m.spare === true;
		spare = fresh();
		return;
	}
	if (!url || !m) return;
	if (m.op === 'leave') {
		rooms.get(m.room)?.terminate();
		rooms.delete(m.room);
		return;
	}
	if (m.op !== 'job') return;
	let w = rooms.get(m.room);
	if (!w) {
		w = spare ?? fresh();
		spare = warm ? fresh() : null;
		rooms.set(m.room, w);
		roomOf.set(w, m.room);
	}
	w.postMessage(m.job);
});`;

/**
 * The script of every view's frame (./view-host.js `bootDoc`), the same text in each: it takes our view engine (and
 * the port it speaks over) from the page, once, and only with the key its own document carries, and starts it from a
 * blob: URL.
 */
export const VIEW_SCRIPT = `addEventListener('message', function boot(e) {
	const m = e.data;
	if (e.source !== parent || !m || m.maiaView !== document.documentElement.dataset.key || !e.ports[0]) return;
	removeEventListener('message', boot);
	self.__maiaPort = e.ports[0];
	const s = document.createElement('script');
	s.src = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
	document.head.append(s);
});`;

/**
 * THE PAGE'S OWN POLICY — the scripts our pages may run: our own files, and inline only what a hash names (SvelteKit
 * adds each page's own start script's). A frame written into the page (srcdoc: the box, the logic host, a view) keeps
 * the page's policy beside its own, so this one names what those frames run as well: their one script each, by its
 * hash, the blob: URLs they start their engine and the code they are handed from (a recipe, a view's script), and
 * WebAssembly (avenDB's device in the page, QuickJS in the logic host). Nothing else, and no eval.
 *
 * Everything else starts from our own origin (default-src), and the page talks only to our own servers (CONNECT): the
 * API, avenDB's feed and relay, plus the exact Cloudflare speed-test host for explicit diagnostics, and in theOS its own bridge and the `aven:` files. Pictures and films may come from
 * any https host (a link's preview, a video's still), as they cannot run; frames only from us, a blob: (a PDF) and
 * Bunny's player; no form posts anywhere. The same pages run in theOS (vault/app/tauri.conf.json), so its schemes are
 * named here too: they lead nowhere in a browser. A dev server's page also reaches this machine (`dev`): its API, its
 * avenDB, Vite's own socket. As SvelteKit's directives: its keywords unquoted.
 * @param {(text: string) => string} sha256 a script's SHA-256 hash, in base64
 * @param {{ dev?: boolean }} [o] `dev` for a dev server's pages
 * @returns {NonNullable<import('@sveltejs/kit').KitConfig['csp']>['directives']}
 */
export const pageCsp = (sha256, { dev = false } = {}) => ({
	'default-src': ['self'],
	'script-src': ['self', 'wasm-unsafe-eval', 'blob:', `sha256-${sha256(SHELL_SCRIPT)}`, `sha256-${sha256(VIEW_SCRIPT)}`],
	'worker-src': ['self', 'blob:'],
	'connect-src': [...CONNECT, 'https://speed.cloudflare.com', ...(dev ? LOCAL : [])],
	// Svelte writes style attributes into each prerendered page, and SvelteKit hashes no inline style when this is here
	'style-src': ['self', 'unsafe-inline'],
	'img-src': ['self', 'data:', 'blob:', 'https:', 'aven:', ...(dev ? LOCAL : [])],
	'media-src': ['self', 'data:', 'blob:', 'https:', 'aven:', ...(dev ? LOCAL : [])],
	'font-src': ['self', 'data:'],
	'frame-src': ['self', 'blob:', 'https://iframe.mediadelivery.net'],
	'object-src': ['none'],
	'base-uri': ['self'],
	'form-action': ['none']
});

/** Where the page may connect: us, our API (and its media, /vault/files), avenDB's feed and relay, theOS's bridge. */
export const CONNECT = ['self', 'blob:', 'data:', 'https://api.maia.city', 'https://avendb.maia.city', 'wss://avendb.maia.city', 'ipc:', 'http://ipc.localhost', 'aven:'];

/** This machine, for a dev server's pages only. */
const LOCAL = ['http://localhost:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'ws://127.0.0.1:*'];
