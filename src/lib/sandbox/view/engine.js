// @ts-nocheck — plain JS, the view host's own code
/*
 * THE VIEW ENGINE — the only script that ever runs in a view's frame (../ViewHost.svelte makes the frame: no origin,
 * no connection, a nonce for this engine alone). It is frozen by version: `node scripts/freeze-engine.mjs --view "…"`
 * bundles this file into static/engines/view-v<n>.js and writes its BLAKE3 hash into ../engines.json; the page
 * checks the bytes against it before it hands them in.
 *
 * What it does with a view (HTML and CSS, our components, template marks, an optional draw script):
 * - its HTML is parsed in a document of its own that runs nothing, made safe (./sanitize.js), and only then put in
 *   the frame: only this engine writes the frame's DOM;
 * - without a draw script, the HTML is a template (./template.js) drawn from the state the page hands in (the view's
 *   data, or what its logic made of it, in QuickJS), and a click or a control names an event the page is told of;
 * - with one, the script runs in a worker inside this frame (./worker.js) on a copy of the DOM, never in this window:
 *   each picture of that DOM it sends is made safe and laid over the frame's (kept elements stay), its canvases come
 *   as pictures (ImageBitmap), and the events it listens for go to it as plain data;
 * - our components (./components.js) and look (./theme.js) are here for every view.
 *
 * The page and the engine speak over a MessageChannel port handed in at boot:
 *   page → engine  { op: 'view', html, state, auto, worker?: { code, libs } }, { op: 'state', state }, { op: 'rpc', msg }
 *   engine → page  { op: 'ready' }, { op: 'size', height }, { op: 'event', name, value }, { op: 'rpc', msg },
 *                  { op: 'error', message }
 */
import { defineComponents } from './components.js';
import { sanitize } from './sanitize.js';
import { eventOf, render } from './template.js';
import { BASE, fontFaces } from './theme.js';
import { DM_SANS, FRAUNCES } from 'virtual:view-fonts';

const port = self.__maiaPort;
delete self.__maiaPort;

const style = document.createElement('style');
style.textContent = fontFaces(DM_SANS, FRAUNCES) + BASE;
document.head.append(style);
defineComponents(window);

const say = (m) => port.postMessage(m);
const fail = (e) => say({ op: 'error', message: String(e?.message ?? e).slice(0, 500) });
addEventListener('error', (e) => fail(e.message));

/** a view's HTML parsed where nothing runs, its scripts taken out, made safe */
function parse(html) {
	const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
	const scripts = [];
	for (const s of doc.querySelectorAll('script')) {
		if (s.hasAttribute('src')) fail('a view loads no script from an address: its libraries come with the engine');
		else if (s.textContent.trim()) scripts.push({ code: s.textContent, module: s.getAttribute('type') === 'module' });
		s.remove();
	}
	// a <style> the parser put in the head is the view's too
	for (const s of [...doc.head.querySelectorAll('style')].reverse()) doc.body.prepend(s);
	sanitize(doc.body);
	return { doc, scripts };
}

// ---- laying a new DOM over the frame's: kept elements stay (a canvas keeps what it shows, a field its focus) ----
const byMid = new Map();
const index = (root) => {
	byMid.clear();
	for (const el of root.querySelectorAll('[data-mid]')) byMid.set(el.getAttribute('data-mid'), el);
	// a canvas the worker draws on directly is kept even before its picture puts it in the page
	for (const [mid, el] of placed) if (!byMid.has(mid)) byMid.set(mid, el);
};
// a lent canvas's size is the worker's to set (its attributes would throw)
const SIZED = new Set(['width', 'height']);
function update(el, from) {
	const own = el.localName === 'canvas' && placed.get(el.getAttribute('data-mid')) === el;
	for (const a of [...el.attributes]) if (!from.hasAttribute(a.name) && !(own && SIZED.has(a.name))) el.removeAttribute(a.name);
	for (const a of from.attributes) if (el.getAttribute(a.name) !== a.value && !(own && SIZED.has(a.name))) el.setAttribute(a.name, a.value);
	if (el.localName === 'input' && el !== document.activeElement) {
		if (from.hasAttribute('value') && el.value !== from.getAttribute('value')) el.value = from.getAttribute('value');
		if (el.checked !== from.hasAttribute('checked')) el.checked = from.hasAttribute('checked');
	}
	if (el.localName === 'canvas') return;
	morph(el, from);
}
function morph(to, from) {
	let cur = to.firstChild;
	for (const f of [...from.childNodes]) {
		let match = null;
		if (f.nodeType === 1) {
			const mid = f.getAttribute('data-mid');
			const kept = mid ? byMid.get(mid) : null;
			if (kept && kept.localName === f.localName && kept.namespaceURI === f.namespaceURI && !kept.contains(to)) match = kept;
			else if (!mid && cur?.nodeType === 1 && cur.localName === f.localName && cur.namespaceURI === f.namespaceURI && !cur.hasAttribute('data-mid')) match = cur;
		} else if (f.nodeType === 3 && cur?.nodeType === 3) match = cur;
		if (!match) {
			to.insertBefore(document.importNode(f, true), cur);
			continue;
		}
		if (match === cur) cur = cur.nextSibling;
		else to.insertBefore(match, cur);
		if (f.nodeType === 3) {
			if (match.data !== f.data) match.data = f.data;
		} else update(match, f);
	}
	while (cur) {
		const next = cur.nextSibling;
		cur.remove();
		cur = next;
	}
}

// ---- its height, for a view that takes the height of what it shows ----
let auto = false;
let told = 0;
const measure = () => {
	if (!auto) return;
	const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
	if (Math.abs(h - told) > 1) say({ op: 'size', height: (told = h) });
};
// a frame out of sight draws no frames (no animation frame, no resize observation), so a timer measures it too: the
// page lays it out at its real height before anyone scrolls to it
const remeasure = () => (requestAnimationFrame(measure), setTimeout(measure, 50));
new ResizeObserver(() => requestAnimationFrame(measure)).observe(document.documentElement);

// ---- a view without a draw script: its template, drawn from the state ----
let template = null;
let state = {};
function draw() {
	if (!template) return;
	byMid.clear();
	morph(document.body, render(document, template, state));
	remeasure();
}
for (const type of ['click', 'input', 'change'])
	document.addEventListener(type, (e) => {
		if (!template) return;
		const ev = eventOf(e.target, type);
		if (ev) say({ op: 'event', ...ev });
	});

// ---- a view with a draw script: a worker in this frame, on a copy of the DOM ----
let worker = null;
let wport = null;
// canvases lent to the worker for WebGL: each one's frames go from the worker straight to the screen, never through
// this window. A few wait in the worker before its script runs; each one it takes is replaced, up to LEND in all.
const LEND = 8;
const lending = new Map();
const placed = new Map();
let lent = 0;
function lend(n) {
	const out = [];
	while (n-- > 0 && lent < LEND && 'transferControlToOffscreen' in HTMLCanvasElement.prototype) {
		const el = document.createElement('canvas');
		const slot = ++lent;
		lending.set(slot, el);
		out.push({ slot, canvas: el.transferControlToOffscreen() });
	}
	return out;
}
/** the worker drew its first frame on lent canvas `slot`, for its element `mid`: that canvas stands in for it */
function take(slot, mid) {
	const el = lending.get(slot);
	if (!el || !/^\d{1,9}$/.test(String(mid)) || placed.has(String(mid))) return;
	lending.delete(slot);
	mid = String(mid);
	el.setAttribute('data-mid', mid);
	placed.set(mid, el);
	const was = byMid.get(mid);
	if (was && was !== el && was.localName === 'canvas') {
		for (const a of was.attributes) if (!SIZED.has(a.name)) el.setAttribute(a.name, a.value);
		was.replaceWith(el);
	}
	byMid.set(mid, el);
	const more = lend(1);
	if (more.length) wport?.postMessage({ op: 'canvases', canvases: more }, more.map((c) => c.canvas));
}
/** the event types the script listens for, anywhere */
const wanted = new Set(['click', 'input', 'change']);
const FORWARD = ['click', 'dblclick', 'contextmenu', 'input', 'change', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'wheel', 'keydown', 'keyup', 'focusin', 'focusout', 'touchstart', 'touchmove', 'touchend'];
const BUBBLES = new Set(['click', 'dblclick', 'contextmenu', 'input', 'change', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout', 'wheel', 'keydown', 'keyup', 'focusin', 'focusout', 'touchstart', 'touchmove', 'touchend']);
const FIELDS = ['clientX', 'clientY', 'offsetX', 'offsetY', 'pageX', 'pageY', 'movementX', 'movementY', 'button', 'buttons', 'pointerId', 'pointerType', 'isPrimary', 'pressure', 'deltaX', 'deltaY', 'deltaZ', 'deltaMode', 'key', 'code', 'repeat', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'detail'];
const midOf = (el) => {
	for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute('data-mid')) return n.getAttribute('data-mid');
	return null;
};
let pending = null;
function forward(e) {
	if (!wport || !wanted.has(e.type)) return;
	const target = e.target === document || e.target === window ? null : e.target;
	const init = { bubbles: BUBBLES.has(e.type), cancelable: true };
	for (const k of FIELDS) if (e[k] !== undefined && typeof e[k] !== 'object') init[k] = e[k];
	if (e.touches) init.touches = [...e.touches].map((t) => ({ identifier: t.identifier, clientX: t.clientX, clientY: t.clientY, pageX: t.pageX, pageY: t.pageY }));
	if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) Object.assign(init, { value: String(target.value).slice(0, 10000), checked: Boolean(target.checked), selectedIndex: target.selectedIndex ?? -1 });
	if ((e.type === 'wheel' || e.type === 'contextmenu' || e.type === 'touchmove') && e.cancelable) e.preventDefault();
	if (e.type === 'pointerdown' && target?.localName === 'canvas' && target.setPointerCapture) target.setPointerCapture(e.pointerId);
	const m = { op: 'event', type: e.type, mid: target ? midOf(target) : 'document', init };
	// moves come at most one a frame, the last one
	if (/move$/.test(e.type)) {
		if (!pending) requestAnimationFrame(() => (wport?.postMessage(pending), (pending = null)));
		pending = m;
		return;
	}
	wport.postMessage(m);
}
for (const type of FORWARD) document.addEventListener(type, forward, { capture: true, passive: false });

/** where the elements the script reads are, for its getBoundingClientRect and sizes */
let measured = new Set();
function rects() {
	if (!wport) return;
	const out = {};
	let n = 0;
	for (const mid of measured) {
		const el = byMid.get(mid);
		if (!el || ++n > 500) continue;
		const r = el.getBoundingClientRect();
		out[mid] = [r.left, r.top, r.width, r.height];
	}
	for (const el of document.querySelectorAll('canvas[data-mid]')) {
		const r = el.getBoundingClientRect();
		out[el.getAttribute('data-mid')] = [r.left, r.top, r.width, r.height];
	}
	const b = document.body.getBoundingClientRect();
	wport.postMessage({ op: 'rects', rects: out, body: [b.left, b.top, b.width, b.height], size: [innerWidth, innerHeight, devicePixelRatio] });
}
addEventListener('resize', () => {
	rects();
	wport?.postMessage({ op: 'resize', size: [innerWidth, innerHeight, devicePixelRatio] });
});

// what the worker sends is taken at most once a frame, the last of each kind: a script that floods the frame with
// pictures of its DOM or canvases slows only itself
let latest = null;
const frames = new Map();
let budget = { at: 0, rpc: 0 };
function flush() {
	scheduled = false;
	if (latest != null) {
		const html = latest;
		latest = null;
		const { doc } = parse(html);
		index(document.body);
		morph(document.body, doc.body);
		index(document.body);
		requestAnimationFrame(() => (rects(), measure()));
	}
	for (const [mid, bitmap] of frames) {
		const el = byMid.get(mid);
		const ctx = el?.localName === 'canvas' && placed.get(mid) !== el ? el.getContext('bitmaprenderer') : null;
		if (ctx) ctx.transferFromImageBitmap(bitmap);
		else bitmap.close();
	}
	frames.clear();
}
let scheduled = false;
const soon = () => scheduled || ((scheduled = true), requestAnimationFrame(flush));

function fromWorker(m) {
	if (!m || typeof m !== 'object') return;
	switch (m.op) {
		case 'dom':
			if (typeof m.html !== 'string' || m.html.length > 2_000_000) return;
			latest = m.html;
			return soon();
		case 'listen':
			if (FORWARD.includes(m.type)) wanted.add(m.type);
			if (typeof m.mid === 'string' && /^\d{1,9}$/.test(m.mid) && measured.size < 500) measured.add(m.mid);
			return;
		case 'measure':
			if (Array.isArray(m.mids)) for (const mid of m.mids.slice(0, 500)) if (/^\d{1,9}$/.test(String(mid)) && measured.size < 500) measured.add(String(mid));
			return rects();
		case 'bitmap': {
			if (!(m.bitmap instanceof ImageBitmap)) return;
			const mid = String(m.mid);
			frames.get(mid)?.close();
			frames.set(mid, m.bitmap);
			return soon();
		}
		case 'rpc': {
			// at most a hundred messages a second go on to the page
			const now = performance.now();
			if (now - budget.at > 1000) budget = { at: now, rpc: 0 };
			if (++budget.rpc > 100) return;
			try {
				return say({ op: 'rpc', msg: JSON.parse(JSON.stringify(m.msg ?? null)) });
			} catch {
				return;
			}
		}
		case 'take':
			return take(m.slot, m.mid);
		case 'pong':
			asked = 0;
			return;
		case 'error':
			return fail(m.message);
	}
}

function start(view) {
	const { doc, scripts } = parse(view.html ?? '');
	auto = Boolean(view.auto);
	state = view.state ?? {};
	if (!scripts.length) {
		template = doc.body;
		draw();
		return;
	}
	if (!view.worker?.code) return fail('this view has a script, and no worker engine came with it');
	// every element gets its number, the same in the frame and in the worker's copy
	let mid = 0;
	for (const el of doc.body.querySelectorAll('*')) el.setAttribute('data-mid', String(++mid));
	byMid.clear();
	morph(document.body, doc.body);
	index(document.body);
	worker = new Worker(URL.createObjectURL(new Blob([view.worker.code], { type: 'text/javascript' })));
	worker.onerror = (e) => (e.preventDefault(), fail(e.message));
	const ch = new MessageChannel();
	wport = ch.port1;
	wport.onmessage = (e) => fromWorker(e.data);
	const r = document.body.getBoundingClientRect();
	const canvases = lend(2);
	worker.postMessage({ op: 'boot', port: ch.port2, html: doc.body.innerHTML, mid, scripts, libs: view.worker.libs ?? {}, canvases, size: [innerWidth, innerHeight, devicePixelRatio], body: [r.left, r.top, r.width, r.height] }, [ch.port2, ...canvases.map((c) => c.canvas)]);
	requestAnimationFrame(rects);
	remeasure();
	// whether the view is in sight, for a worker that draws its frames by a timer
	let inView = true;
	const seen = () => wport?.postMessage({ op: 'seen', seen: inView && document.visibilityState !== 'hidden' });
	new IntersectionObserver((es) => ((inView = es.at(-1).isIntersecting), seen())).observe(document.documentElement);
	document.addEventListener('visibilitychange', seen);
	// a script that holds its worker for seconds on end (a loop that never ends) is stopped: it would only burn the
	// person's battery. Asked once a second; a timer a hidden page slows down only asks less often.
	const watch = setInterval(() => {
		if (asked && performance.now() - asked > HELD) {
			clearInterval(watch);
			worker.terminate();
			wport.close();
			wport = null;
			return fail(`this view's script held its worker for more than ${HELD / 1000} seconds, so it was stopped`);
		}
		if (!asked) (asked = performance.now()), wport.postMessage({ op: 'ping' });
	}, 1000);
}
let asked = 0;
const HELD = 4000;

port.onmessage = (e) => {
	const m = e.data;
	if (!m || typeof m !== 'object') return;
	try {
		if (m.op === 'view' && !template && !worker) start(m);
		else if (m.op === 'state') {
			state = m.state ?? {};
			draw();
		} else if (m.op === 'rpc') wport?.postMessage({ op: 'rpc', msg: m.msg });
	} catch (err) {
		fail(err);
	}
};
say({ op: 'ready' });
