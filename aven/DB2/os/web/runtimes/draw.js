// The tree drawer, the applier (aven/runtimes/README.md, "Two kinds of output, and the drawers"): trusted page code
// that draws what markdown-runtime and face-runtime give back into a shadow root of its own. It trusts nothing it is
// handed: it checks the tree again against the one allowlist (Aven.Runtime.Tree, held to its vectors by
// sandbox/drawer.mjs) and each style rule against Face's types, and refuses the whole answer if anything fails.
// It builds the DOM node by node (createElement, setAttribute, createTextNode), never from markup text, and writes
// the CSS itself from the typed rules (`Rule.css`): no CSS text comes from a runtime. A click on a node with
// `data-on` is an event by name; a click on a link is handed to the host, which asks before it opens anything; the
// page never follows one by itself.
//
// A tree is the Value it crosses in (Node.value): text is a string; an element is [tag, [[name, value], …], [kid, …]].
// A rule is Rule.value: [class, colour or null, background or null, size or null, bold or null], a colour three
// bytes.

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
const colour = (c) => c === null || ((Array.isArray(c) || c instanceof Uint8Array) && c.length === 3 && [...c].every(byte));
/** A class name: lowercase letters, digits and `-` (`classOk`). */
export const classOk = (c) => typeof c === 'string' && /^[a-z0-9-]+$/.test(c);

/** A rule of Face's types, and nothing else. */
export const ruleOk = (r) =>
	Array.isArray(r) &&
	r.length === 5 &&
	classOk(r[0]) &&
	colour(r[1]) &&
	colour(r[2]) &&
	(r[3] === null || (Number.isInteger(r[3]) && r[3] >= 0)) &&
	(r[4] === null || typeof r[4] === 'boolean');

const hex = (c) => '#' + [...c].map((x) => x.toString(16).padStart(2, '0')).join('');

/** A rule's CSS text, written here from its typed values (`Rule.css`). */
export function ruleCss([cls, color, background, size, bold]) {
	const decls = [];
	if (color) decls.push(`color:${hex(color)}`);
	if (background) decls.push(`background-color:${hex(background)}`);
	if (size !== null) decls.push(`font-size:${size}px`);
	if (bold !== null) decls.push(`font-weight:${bold ? '700' : '400'}`);
	return `.${cls}{${decls.join(';')}}`;
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
	sheet.textContent = [':host{display:block}', ...style.map(ruleCss)].join('\n');
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
