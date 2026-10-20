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
 * WebAssembly (avenDB's device in the page, QuickJS in the logic host). Nothing else, and no eval. As SvelteKit's
 * directives: its keywords unquoted.
 * @param {(text: string) => string} sha256 a script's SHA-256 hash, in base64
 * @returns {NonNullable<import('@sveltejs/kit').KitConfig['csp']>['directives']}
 */
export const pageCsp = (sha256) => ({
	'script-src': ['self', 'wasm-unsafe-eval', 'blob:', `sha256-${sha256(SHELL_SCRIPT)}`, `sha256-${sha256(VIEW_SCRIPT)}`],
	'worker-src': ['self', 'blob:'],
	'object-src': ['none'],
	'base-uri': ['self']
});
