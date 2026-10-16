// @ts-nocheck — plain JS, the view host's own code: the worker a view's draw script runs in
/*
 * THE VIEW WORKER — where a view's own script runs (the frame's engine, ./engine.js, starts it): a worker, so the
 * script never touches a window, cannot navigate, open, frame or post anything, and can loop without holding the
 * page. It is frozen by version (`node scripts/freeze-engine.mjs --view-worker "…"`, static/engines/view-worker-v<n>.js).
 *
 * - The shell's second lock (../lockdown.js) runs before anything of the view's: no fetch, socket, storage, worker or
 *   importScripts. The frame's policy refuses every connection besides.
 * - The script gets a DOM of its own (linkedom), parsed from the same safe HTML the frame shows. After each change
 *   the engine sends a picture of it (its HTML), which the frame makes safe again and lays over its own: the script
 *   decides what is shown, never how it gets there.
 * - A canvas draws on an OffscreenCanvas; each frame it drew goes to the frame as an ImageBitmap.
 * - The events it listens for come from the frame as plain data, dispatched on its own DOM; the sizes it reads
 *   (getBoundingClientRect, innerWidth) are the frame's, as last measured.
 * - It speaks to the page as an MCP App does, `parent.postMessage` (JSON-RPC), and hears it on 'message' events whose
 *   source is `parent`, so MCP Apps and the official SDK run unchanged; the page answers only what it allows.
 * - Its libraries (three, d3, the MCP Apps SDK) come in as frozen files the page checked by hash; a module script
 *   imports them by name (./imports.js), and nothing else.
 */
import { load, objectUrl } from './keep.js';
import '../lockdown.js';
import { parseHTML } from 'linkedom';
import { classic } from './imports.js';

const NativeEvent = self.Event;
let port = null;
const say = (m, t) => port?.postMessage(m, t ?? []);
const error = (e) => say({ op: 'error', message: String(e?.stack ?? e?.message ?? e).slice(0, 600) });
self.addEventListener('error', (e) => error(e.message));
self.addEventListener('unhandledrejection', (e) => error(e.reason?.message ?? e.reason));

/** the modules the libraries lend, by the name a script imports them by */
const modules = new Map();
self.__maiaDefine = (name, ns) => modules.set(name, ns);
self.__maiaImport = (name) => {
	if (!modules.has(name)) throw new Error(`this view engine has no module ${String(name).slice(0, 80)}: add it to the view's libs (three, d3, mcp-apps)`);
	return modules.get(name);
};
self.__maiaDynamic = async (name) => self.__maiaImport(name);
self.__maiaError = error;

self.addEventListener('message', function boot(e) {
	const m = e.data;
	if (!m || m.op !== 'boot' || port) return;
	self.removeEventListener('message', boot);
	port = m.port;
	try {
		start(m);
	} catch (err) {
		error(err);
	}
});

function start(m) {
	const { window: dom, document } = parseHTML(`<!doctype html><html><head></head><body>${m.html}</body></html>`);
	let next = m.mid;
	let [W, H, dpr] = m.size;
	let rects = {};
	let body = m.body;

	// ---- the globals a page script expects ----
	const PARENT = Object.freeze({
		postMessage(msg) {
			try {
				say({ op: 'rpc', msg: JSON.parse(JSON.stringify(msg)) });
			} catch (err) {
				error(`a message to the page must be plain JSON: ${err.message}`);
			}
		}
	});
	const define = (k, v) => Object.defineProperty(self, k, { value: v, configurable: true, writable: true });
	define('window', self);
	define('document', document);
	define('parent', PARENT);
	define('top', PARENT);
	for (const k of ['Node', 'Element', 'HTMLElement', 'SVGElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Text', 'DocumentFragment', 'Document', 'CustomEvent', 'Event', 'MutationObserver', 'DOMParser', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLImageElement', 'Image']) if (dom[k]) define(k, dom[k]);
	for (const k of ['MouseEvent', 'PointerEvent', 'KeyboardEvent', 'WheelEvent', 'FocusEvent', 'InputEvent', 'TouchEvent', 'UIEvent']) define(k, dom.CustomEvent ?? dom.Event);
	Object.defineProperties(self, {
		innerWidth: { get: () => W, configurable: true },
		innerHeight: { get: () => H, configurable: true },
		outerWidth: { get: () => W, configurable: true },
		outerHeight: { get: () => H, configurable: true },
		devicePixelRatio: { get: () => dpr, configurable: true },
		scrollX: { value: 0, configurable: true },
		scrollY: { value: 0, configurable: true },
		pageXOffset: { value: 0, configurable: true },
		pageYOffset: { value: 0, configurable: true }
	});
	define('getComputedStyle', (el) => new Proxy(el?.style ?? {}, { get: (s, k) => (k === 'getPropertyValue' ? (p) => s.getPropertyValue?.(p) ?? '' : (s[k] ?? '')) }));
	define('matchMedia', (q) => ({ matches: /prefers-color-scheme:\s*light/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
	define(
		'ResizeObserver',
		class {
			constructor(cb) {
				this.cb = cb;
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	define('IntersectionObserver', self.ResizeObserver);
	const [timeout, interval] = [self.setTimeout.bind(self), self.setInterval.bind(self)];
	// a worker without animation frames (Safari) gets them from a timer, held while its frame is out of sight
	let seen = true;
	let held = [];
	const raf = self.requestAnimationFrame?.bind(self) ?? ((cb) => (seen ? timeout(() => cb(performance.now()), 16) : (held.push(cb), 0)));
	const caf = self.cancelAnimationFrame?.bind(self) ?? clearTimeout;
	define('cancelAnimationFrame', caf);
	define('alert', () => {});
	define('confirm', () => false);
	define('prompt', () => null);
	define('open', () => null);
	// a view's script makes no blob: URL of its own (the engine kept the one it needs, ./keep.js)
	URL.createObjectURL = () => 'about:blank';
	// a canvas three.js asks for by its namespace is a canvas
	const make = document.createElementNS.bind(document);
	document.createElementNS = (ns, name) => (ns === 'http://www.w3.org/1999/xhtml' ? document.createElement(name) : make(ns, name));

	// ---- the element parts a page has and linkedom lacks: sizes, pointer capture, canvases ----
	const E = dom.Element.prototype;
	const midOf = (el) => el?.getAttribute?.('data-mid') ?? null;
	const rectOf = (el) => {
		const r = el === document.body || el === document.documentElement ? body : rects[midOf(el)];
		if (!r && midOf(el)) say({ op: 'measure', mids: [midOf(el)] });
		const [x, y, w, h] = r ?? [0, 0, 0, 0];
		return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON() {} };
	};
	E.getBoundingClientRect = function () {
		return rectOf(this);
	};
	E.getClientRects = function () {
		return [rectOf(this)];
	};
	for (const [k, i] of [['clientWidth', 2], ['clientHeight', 3], ['offsetWidth', 2], ['offsetHeight', 3], ['scrollWidth', 2], ['scrollHeight', 3]]) Object.defineProperty(E, k, { configurable: true, get() { return rectOf(this)[i === 2 ? 'width' : 'height']; } });
	for (const k of ['clientLeft', 'clientTop', 'scrollLeft', 'scrollTop']) Object.defineProperty(E, k, { configurable: true, get: () => 0, set() {} });
	Object.defineProperty(E, 'offsetLeft', { configurable: true, get() { return rectOf(this).left; } });
	Object.defineProperty(E, 'offsetTop', { configurable: true, get() { return rectOf(this).top; } });
	for (const k of ['setPointerCapture', 'releasePointerCapture', 'scrollIntoView', 'focus', 'blur', 'requestPointerLock', 'requestFullscreen']) E[k] = function () {};
	E.hasPointerCapture = () => false;
	for (const [k, attr] of [['colSpan', 'colspan'], ['rowSpan', 'rowspan']]) Object.defineProperty(E, k, { configurable: true, get() { return Number(this.getAttribute(attr) ?? 1); }, set(v) { this.setAttribute(attr, v); } });

	// tell the frame which events to send: only those someone listens for
	const T = dom.EventTarget?.prototype ?? Object.getPrototypeOf(dom.Node.prototype);
	const listen = T.addEventListener;
	T.addEventListener = function (type, ...rest) {
		say({ op: 'listen', type: String(type), mid: midOf(this) });
		return listen.call(this, type, ...rest);
	};
	const selfListen = self.addEventListener.bind(self);
	self.addEventListener = (type, ...rest) => {
		say({ op: 'listen', type: String(type), mid: null });
		return selfListen(type, ...rest);
	};

	// a canvas draws on an OffscreenCanvas; what it drew goes to the frame once a frame, as a picture
	const backing = new WeakMap();
	const dirty = new Set();
	let flushing = false;
	const DRAWS = { '2d': ['fillRect', 'strokeRect', 'clearRect', 'fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'reset'], webgl: ['drawArrays', 'drawElements', 'clear'], webgl2: ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear'] };
	function flush() {
		flushing = false;
		for (const el of dirty) {
			const b = backing.get(el);
			const mid = midOf(el);
			if (!b || !mid || !el.isConnected) continue;
			if (b.kind === '2d') createImageBitmap(b.canvas).then((bitmap) => say({ op: 'bitmap', mid, bitmap }, [bitmap]), () => {});
			else if (b.canvas.width && b.canvas.height) {
				const bitmap = b.canvas.transferToImageBitmap();
				say({ op: 'bitmap', mid, bitmap }, [bitmap]);
			}
		}
		dirty.clear();
	}
	const drew = (el) => {
		dirty.add(el);
		if (!flushing) (flushing = true), queueMicrotask(flush);
	};
	const C = dom.HTMLCanvasElement.prototype;
	const size = (el, k, d) => Number(el.getAttribute(k) ?? d) || 0;
	for (const [k, d] of [['width', 300], ['height', 150]])
		Object.defineProperty(C, k, {
			configurable: true,
			get() {
				return backing.get(this)?.canvas[k] ?? size(this, k, d);
			},
			set(v) {
				const n = Math.max(0, Math.floor(Number(v) || 0));
				this.setAttribute(k, String(n));
				const b = backing.get(this);
				if (b) b.canvas[k] = n;
			}
		});
	const backed = (el) => {
		if (!backing.has(el)) backing.set(el, { canvas: new OffscreenCanvas(Math.max(1, size(el, 'width', 300)), Math.max(1, size(el, 'height', 150))), ctx: null, kind: '' });
		return backing.get(el);
	};
	// canvases the frame lent for WebGL: what is drawn on one shows straight away, with no picture to send
	const lent = [...(m.canvases ?? [])];
	const borrow = (el) => {
		const { slot, canvas } = lent.shift();
		canvas.width = Math.max(1, size(el, 'width', 300));
		canvas.height = Math.max(1, size(el, 'height', 150));
		backing.set(el, { canvas, ctx: null, kind: '', direct: true });
		if (!midOf(el)) el.setAttribute('data-mid', String(++next));
		say({ op: 'take', slot, mid: midOf(el) });
	};
	C.getContext = function (kind, attrs) {
		if (!backing.has(this) && /^webgl2?$/.test(kind) && lent.length) borrow(this);
		const b = backed(this);
		if (b.ctx) return b.kind === kind ? b.ctx : null;
		const ctx = b.canvas.getContext(kind, attrs);
		if (!ctx) return null;
		[b.ctx, b.kind] = [ctx, kind];
		if (!b.direct) for (const f of DRAWS[kind] ?? []) {
			const real = ctx[f];
			if (typeof real === 'function')
				ctx[f] = (...a) => {
					drew(this);
					return real.apply(ctx, a);
				};
		}
		// a script may read its canvas back, or hand it to three.js
		if (!('canvas' in Object(ctx)) || ctx.canvas !== this) {
			try {
				Object.defineProperty(ctx, 'canvas', { value: this, configurable: true });
			} catch {}
		}
		return ctx;
	};
	C.transferControlToOffscreen = function () {
		return backed(this).canvas;
	};
	C.toDataURL = () => 'data:,';
	C.toBlob = (cb) => cb?.(null);
	C.captureStream = () => null;

	// ---- the picture of the DOM: after anything that may have changed it, at most once a frame, only when it did ----
	// (a mutation, a timer or frame callback, an event, a message, a script run: linkedom's observer alone misses text
	// set deep inside, so the engine compares pictures instead of trusting it)
	let queued = false;
	let last = '';
	const number = (root) => {
		for (const el of root.querySelectorAll('*')) if (!el.hasAttribute('data-mid')) el.setAttribute('data-mid', String(++next));
	};
	const picture = () => {
		queued = false;
		number(document.body);
		observer.takeRecords();
		const html = document.body.innerHTML;
		if (html === last) return;
		last = html;
		say({ op: 'dom', html });
	};
	const touch = () => {
		if (queued) return;
		queued = true;
		raf(picture);
	};
	const observer = new dom.MutationObserver(touch);
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
	const after = (cb) =>
		typeof cb === 'function'
			? function (...a) {
					try {
						return cb.apply(this, a);
					} finally {
						touch();
					}
				}
			: cb;
	define('setTimeout', (cb, ms, ...a) => timeout(after(cb), ms, ...a));
	define('setInterval', (cb, ms, ...a) => interval(after(cb), ms, ...a));
	define('requestAnimationFrame', (cb) => raf(after(cb)));

	// ---- what the frame sends: events, sizes, the page's messages ----
	const byMid = (mid) => (mid == null || mid === 'document' ? document : document.querySelector(`[data-mid="${String(mid).replace(/[^\d]/g, '')}"]`));
	port.onmessage = (e) => {
		const m = e.data;
		if (!m || typeof m !== 'object') return;
		if (m.op === 'ping') say({ op: 'pong' });
		else if (m.op === 'seen') {
			seen = Boolean(m.seen);
			if (seen) for (const cb of held.splice(0)) raf(cb);
		} else if (m.op === 'canvases') lent.push(...(m.canvases ?? []).filter((c) => c?.canvas instanceof OffscreenCanvas));
		else if (m.op === 'event') {
			const target = byMid(m.mid) ?? document;
			const { bubbles, cancelable, value, checked, selectedIndex, ...fields } = m.init ?? {};
			if (value !== undefined && 'value' in target) target.value = value;
			if (checked !== undefined && 'checked' in target) target.checked = checked;
			if (selectedIndex !== undefined && 'selectedIndex' in target) target.selectedIndex = selectedIndex;
			const ev = new dom.Event(m.type, { bubbles, cancelable });
			for (const [k, v] of Object.entries(fields)) Object.defineProperty(ev, k, { value: v, configurable: true });
			if (!('preventDefault' in ev)) ev.preventDefault = () => {};
			if (/^key/.test(m.type)) {
				// keys go to the window as well, where scripts listen for them
				const win = new NativeEvent(m.type);
				for (const [k, v] of Object.entries(fields)) Object.defineProperty(win, k, { value: v });
				self.dispatchEvent(win);
			}
			target.dispatchEvent(ev);
			touch();
		} else if (m.op === 'rects') {
			rects = m.rects ?? {};
			body = m.body ?? body;
			[W, H, dpr] = m.size ?? [W, H, dpr];
		} else if (m.op === 'resize') {
			[W, H, dpr] = m.size ?? [W, H, dpr];
			self.dispatchEvent(new NativeEvent('resize'));
			touch();
		} else if (m.op === 'rpc') {
			const ev = new NativeEvent('message');
			Object.defineProperties(ev, { data: { value: m.msg }, source: { value: PARENT }, origin: { value: '' } });
			self.dispatchEvent(ev);
			touch();
		}
	};

	// ---- the libraries, then the view's scripts, in their order ----
	for (const [name, code] of Object.entries(m.libs ?? {})) {
		try {
			run(code);
		} catch (err) {
			error(`library ${name}: ${err.message}`);
		}
	}
	delete self.__maiaDefine;
	for (const s of m.scripts ?? []) {
		try {
			run(s.module ? classic(s.code) : s.code);
		} catch (err) {
			error(err);
		}
	}
	touch();
}

/** a script run as a classic one, from a blob: URL (the one kind the frame's policy lets in) */
function run(code) {
	load(objectUrl(code));
}
