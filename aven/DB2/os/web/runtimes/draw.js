// The tree drawer, the applier (aven/runtimes/README.md, "Two kinds of output, and the drawers"): trusted page code
// that draws what markdown-runtime and face-runtime give back into a shadow root of its own. It trusts nothing it is
// handed: it checks the tree again against the one allowlist (Aven.Runtime.Tree, held to its vectors by
// sandbox/drawer.mjs) and each style rule against Style's types (Aven.Runtime.Style: `Rule.ok`), and refuses the whole
// answer if anything fails.
// It builds the DOM node by node (createElement, setAttribute, createTextNode), never from markup text, and writes
// the CSS itself from the typed rules (`Rule.css`): no CSS text comes from a runtime. A click on a node with
// `data-on` is an event by name; a click on a link is handed to the host, which asks before it opens anything; the
// page never follows one by itself.
//
// A tree is the Value it crosses in (Node.value): text is a string; an element is [tag, [[name, value], …], [kid, …]].
// A rule is Rule.value: [[compound, …], [declaration, …]]; a compound [tag or null, [class, …]]; a declaration its
// property's name, then its values (Decl.value); a length [hundredths, unit]; a colour three bytes.

export const TREE_LIMITS = { depth: 64, nodes: 20000, text: 8 * 1048576 };

const ALLOWED = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code', 'em',
	'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'del', 'ins', 'kbd', 'mark', 'small', 'blockquote', 'hr', 'br', 'a', 'img', 'table',
	'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'input', 'label', 'section', 'article', 'header', 'footer', 'nav',
	'figure', 'figcaption', 'details', 'summary', 'slot']);
const FORBIDDEN = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
	'form', 'svg', 'math', 'template', 'noscript', 'portal', 'video', 'audio', 'source', 'track', 'canvas']);
const GLOBAL = new Set(['class', 'id', 'role', 'title', 'lang', 'dir', 'tabindex', 'hidden', 'data-on', 'data-key', 'data-place']);
const BY_TAG = {
	a: ['href'],
	img: ['src', 'alt', 'width', 'height'],
	td: ['colspan', 'rowspan', 'scope'],
	th: ['colspan', 'rowspan', 'scope'],
	input: ['type', 'checked', 'disabled', 'value', 'placeholder', 'name'],
	button: ['type', 'disabled'],
	label: ['for'],
	ol: ['start'],
	li: ['value'],
	details: ['open'],
};
const TYPES = new Set(['text', 'checkbox', 'radio', 'number', 'search', 'button']);

const lower = (c) => (c >= 'A' && c <= 'Z' ? String.fromCharCode(c.charCodeAt(0) + 32) : c);
const isHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');

/** A file of the network, by its hash: `/files/<64 lowercase hex>`. */
export const isFileUrl = (v) => {
	const cs = [...v];
	return cs.length === 71 && v.startsWith('/files/') && cs.slice(7).every(isHex);
};
/** A link a click may follow: `https:`, `mailto:` or a fragment. */
export const isLink = (v) => v.startsWith('https://') || v.startsWith('mailto:') || v.startsWith('#');
/** An event handler's name in any case; ASCII lowered, as Lean's `Char.toLower`. */
const isHandler = (k) => {
	const cs = [...k];
	return cs.length >= 2 && lower(cs[0]) === 'o' && lower(cs[1]) === 'n';
};
const valueOk = (k, v) =>
	k === 'href' ? isLink(v) : k === 'src' ? isFileUrl(v) : k === 'tabindex' ? v === '0' || v === '-1' : k === 'type' ? TYPES.has(v) : true;

export const attrOk = (tag, k, v) =>
	typeof k === 'string' &&
	typeof v === 'string' &&
	!isHandler(k) &&
	k !== 'style' &&
	(GLOBAL.has(k) || k.startsWith('aria-') || (BY_TAG[tag] ?? []).includes(k)) &&
	valueOk(k, v);
export const tagOk = (tag) => typeof tag === 'string' && ALLOWED.has(tag) && !FORBIDDEN.has(tag);

/** The per-node check, and the node's shape. */
export function nodeOk(n) {
	if (typeof n === 'string') return true;
	if (!Array.isArray(n) || n.length !== 3 || !Array.isArray(n[1]) || !Array.isArray(n[2])) return false;
	const [tag, attrs] = n;
	return tagOk(tag) && attrs.every((a) => Array.isArray(a) && a.length === 2 && attrOk(tag, a[0], a[1]));
}

const utf8 = new TextEncoder();

/** The applier's check (`check`): every node, then depth, nodes and text, with a stack of its own. */
export function checkTree(tree, limits = TREE_LIMITS) {
	let nodes = 0;
	let text = 0;
	const stack = [[tree, 1]];
	while (stack.length) {
		const [n, depth] = stack.pop();
		nodes += 1;
		if (depth > limits.depth || nodes > limits.nodes || !nodeOk(n)) return false;
		if (typeof n === 'string') {
			text += utf8.encode(n).length;
			if (text > limits.text) return false;
		} else for (let i = n[2].length - 1; i >= 0; i--) stack.push([n[2][i], depth + 1]);
	}
	return true;
}

const byte = (x) => Number.isInteger(x) && x >= 0 && x <= 255;
const colour = (c) => (Array.isArray(c) || c instanceof Uint8Array) && c.length === 3 && [...c].every(byte);
const int = (x) => Number.isSafeInteger(x);
const text = (x) => typeof x === 'string';
/** A class name: lowercase letters, digits and `-` (`classOk`). */
export const classOk = (c) => typeof c === 'string' && /^[a-z0-9-]+$/.test(c);

const BOX = ['cqw', '%', 'px'];
const SIDES = { '': 'all', '-top': 'top', '-right': 'right', '-bottom': 'bottom', '-left': 'left' };
const PLACES = new Set(['top', 'right', 'bottom', 'left']);
/** A length of one of `units`, within ±10,000 of them (`Len.within`). */
const len = (l, units) => Array.isArray(l) && l.length === 2 && int(l[0]) && units.includes(l[1]) && Math.abs(l[0]) <= 1_000_000;
const nonNeg = (l, units) => len(l, units) && l[0] >= 0;
const step = (s) =>
	Array.isArray(s) &&
	s.length === 2 &&
	((s[0] === 'translateX' || s[0] === 'translateY') ? len(s[1], BOX)
		: s[0] === 'rotate' ? int(s[1]) && Math.abs(s[1]) <= 36000
		: s[0] === 'scale' ? int(s[1]) && s[1] > 0 && s[1] <= 1000
		: false);
/** The side a property's name ends in, after `base`: `margin`, `margin-top`, …; undefined for any other. */
const sideOf = (base, name) => (name.startsWith(base) ? SIDES[name.slice(base.length)] : undefined);

/** A declaration of Style's types, its values in range (`Decl.ofValue?` and `Decl.ok`). */
function declOk(d) {
	if (!Array.isArray(d) || !text(d[0])) return false;
	const [name, ...a] = d;
	const n = a.length;
	switch (name) {
		case 'position': return n === 1 && (a[0] === 'absolute' || a[0] === 'relative');
		case 'inset': case 'container-type': case 'overflow': case 'font-family': case 'text-transform':
		case 'text-align': case 'white-space': case 'clip-path':
			return n === 0;
		case 'width': case 'height': case 'gap': return n === 1 && nonNeg(a[0], BOX);
		case 'display': return n === 1 && ['block', 'inline-block', 'flex'].includes(a[0]);
		case 'aspect-ratio': return n === 2 && a.every((x) => int(x) && x >= 1 && x <= 100);
		case 'border-radius': return n === 1 && nonNeg(a[0], BOX);
		case 'background-color': case 'color': return n === 1 && colour(a[0]);
		case 'font-size': return n === 1 && len(a[0], ['cqw', 'px']) && a[0][0] > 0;
		case 'font-weight': return n === 1 && int(a[0]) && a[0] >= 100 && a[0] <= 999 && a[0] % 100 === 0;
		case 'line-height': return n === 1 && int(a[0]) && a[0] >= 50 && a[0] <= 300;
		case 'letter-spacing': return n === 1 && len(a[0], ['em']) && Math.abs(a[0][0]) <= 50;
		case 'transform': return n === 1 && Array.isArray(a[0]) && a[0].length >= 1 && a[0].length <= 4 && a[0].every(step);
		case 'transform-origin': return n === 2 && len(a[0], BOX) && len(a[1], BOX);
	}
	if (PLACES.has(name)) return n === 1 && len(a[0], BOX);
	if (sideOf('margin', name)) return n === 1 && len(a[0], BOX);
	if (sideOf('padding', name)) return n === 1 && nonNeg(a[0], BOX);
	if (sideOf('border', name)) return n === 3 && nonNeg(a[0], ['cqw', 'px']) && (a[1] === 'solid' || a[1] === 'dotted') && colour(a[2]);
	return false;
}

/** A compound: an allowlisted tag or none, up to four plain class names, at least one of the two (`Compound.ok`). */
const compoundOk = (c) =>
	Array.isArray(c) &&
	c.length === 2 &&
	(c[0] === null || (text(c[0]) && tagOk(c[0]))) &&
	Array.isArray(c[1]) &&
	c[1].length <= 4 &&
	c[1].every(classOk) &&
	(c[0] !== null || c[1].length > 0);

/** A rule of Style's types, and nothing else (`Rule.ok`): one to four compounds, one to 32 declarations. */
export const ruleOk = (r) =>
	Array.isArray(r) &&
	r.length === 2 &&
	Array.isArray(r[0]) &&
	r[0].length >= 1 &&
	r[0].length <= 4 &&
	r[0].every(compoundOk) &&
	Array.isArray(r[1]) &&
	r[1].length >= 1 &&
	r[1].length <= 32 &&
	r[1].every(declOk);

const hex = (c) => '#' + [...c].map((x) => x.toString(16).padStart(2, '0')).join('');
/** A number in hundredths as its shortest decimal (`Dec.css`). */
function dec(d) {
	const n = Math.abs(d);
	const frac = n % 100;
	const tail = frac === 0 ? '' : frac % 10 === 0 ? `.${frac / 10}` : `.${String(frac).padStart(2, '0')}`;
	return `${d < 0 ? '-' : ''}${Math.floor(n / 100)}${tail}`;
}
const lenCss = ([v, unit]) => (v === 0 ? '0' : `${dec(v)}${unit}`);
const stepCss = ([name, x]) =>
	name === 'rotate' ? `rotate(${dec(x)}deg)` : name === 'scale' ? `scale(${dec(x)})` : `${name}(${lenCss(x)})`;

/** A declaration's CSS text, written here from its typed values (`Decl.css`). */
function declCss([name, ...a]) {
	switch (name) {
		case 'position': return `position:${a[0]}`;
		case 'inset': return 'inset:0';
		case 'display': return `display:${a[0]}`;
		case 'aspect-ratio': return `aspect-ratio:${a[0]}/${a[1]}`;
		case 'container-type': return 'container-type:inline-size';
		case 'overflow': return 'overflow:hidden';
		case 'background-color': case 'color': return `${name}:${hex(a[0])}`;
		case 'font-family': return "font-family:'Inter Variable',system-ui,sans-serif";
		case 'font-weight': return `font-weight:${a[0]}`;
		case 'line-height': return `line-height:${dec(a[0])}`;
		case 'text-transform': return 'text-transform:uppercase';
		case 'text-align': return 'text-align:center';
		case 'white-space': return 'white-space:nowrap';
		case 'transform': return `transform:${a[0].map(stepCss).join(' ')}`;
		case 'transform-origin': return `transform-origin:${lenCss(a[0])} ${lenCss(a[1])}`;
		case 'clip-path': return 'clip-path:polygon(0 0,100% 50%,0 100%,25% 50%)';
	}
	if (a.length === 3) return `${name}:${lenCss(a[0])} ${a[1]} ${hex(a[2])}`;
	return `${name}:${lenCss(a[0])}`;
}

/** A rule's CSS text, written here from its typed values (`Rule.css`): its selector, then its declarations. */
export function ruleCss([sel, decls]) {
	const compound = ([tag, classes]) => (tag ?? '') + classes.map((c) => `.${c}`).join('');
	return `${sel.map(compound).join(' ')}{${decls.map(declCss).join(';')}}`;
}

function build(doc, n, file) {
	if (typeof n === 'string') return doc.createTextNode(n);
	const [tag, attrs, kids] = n;
	const el = doc.createElement(tag);
	for (const [k, v] of attrs) {
		if (k !== 'src' || !file) el.setAttribute(k, v);
		else {
			// a file named by its hash, where avenOS keeps it: the network's files or a bundle; none, no src
			const url = file(v.slice('/files/'.length));
			if (typeof url === 'string') el.setAttribute('src', url);
		}
	}
	for (const k of kids) el.appendChild(build(doc, k, file));
	return el;
}

// A face never draws outside its host: a runtime is untrusted, and a face drawn over avenOS's own buttons could fake
// them. Paint containment makes the host the containing block of every absolute and fixed descendant and clips them
// to its box; overflow clips what scrolls; isolation keeps every z-index inside it.
const HOST = ':host{display:block;position:relative;overflow:hidden;contain:layout paint style;isolation:isolate}';

/**
 * Draws a runtime's answer into `host`'s shadow root, replacing what was there: `{tree, style}`, the style a list of
 * rules (none for markdown-runtime). Refuses, and draws nothing, unless the tree passes the check and every rule is of
 * Face's types. `onEvent(name, element)` hears clicks on `data-on` nodes; `onLink(href)` hears clicks on links, which
 * the page never follows itself. `file(hash)`, if given, says where a `/files/<hash>` image is read from.
 */
export function draw(host, { tree, style = [] }, { onEvent = () => {}, onLink = () => {}, file = null } = {}) {
	if (!checkTree(tree)) throw new Error('the drawer refused a tree that fails the check');
	if (!Array.isArray(style) || !style.every(ruleOk)) throw new Error('the drawer refused a style that is not of its types');
	const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
	const doc = host.ownerDocument;
	const sheet = doc.createElement('style');
	sheet.textContent = [HOST, ...style.map(ruleCss)].join('\n');
	root.replaceChildren(sheet, build(doc, tree, file));
	if (!root.__avenDrawn) {
		root.__avenDrawn = true;
		root.addEventListener('click', (event) => {
			const at = event.composedPath().find((x) => x instanceof Element && (x.hasAttribute('data-on') || (x.localName === 'a' && x.hasAttribute('href'))));
			if (!at) return;
			if (at.localName === 'a' && at.hasAttribute('href')) {
				event.preventDefault();
				root.__avenLink?.(at.getAttribute('href'));
			} else root.__avenEvent?.(at.getAttribute('data-on'), at);
		});
	}
	root.__avenEvent = onEvent;
	root.__avenLink = onLink;
	return root;
}
