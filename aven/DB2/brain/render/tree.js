// A slide's markup as a node tree, and the face-runtime's allowlist over it (aven/runtimes/spec/Aven/Runtime/Tree.lean,
// mirrored here until the face-runtime exists). A node is a string (text) or `[tag, [[name, value], …], [child, …]]`,
// the shape the Lean model gives a tree as a Value. The parser reads the strict subset slides are written in: elements,
// double-quoted attributes, text, a handful of entities and comments, which it drops. Anything else is an error, never
// a guess.

export const allowedTags = [
	'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code', 'em',
	'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'del', 'ins', 'kbd', 'mark', 'small', 'blockquote', 'hr', 'br', 'a',
	'img', 'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'input', 'label', 'section', 'article',
	'header', 'footer', 'nav', 'figure', 'figcaption', 'details', 'summary', 'slot',
];
const forbidden = [
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form',
	'svg', 'math', 'template', 'noscript', 'portal', 'video', 'audio', 'source', 'track', 'canvas',
];
const globalAttrs = ['class', 'id', 'role', 'title', 'lang', 'dir', 'tabindex', 'hidden', 'data-on', 'data-key', 'data-place'];
const tagAttrs = {
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
const voids = new Set(['br', 'hr', 'img', 'input']);

const isLink = (v) => v.startsWith('https://') || v.startsWith('mailto:') || v.startsWith('#');
const isFileUrl = (v) => /^\/files\/[0-9a-f]{64}$/.test(v);
function valueOk(name, value) {
	if (name === 'href') return isLink(value);
	if (name === 'src') return isFileUrl(value);
	if (name === 'tabindex') return value === '0' || value === '-1';
	if (name === 'type') return ['text', 'checkbox', 'radio', 'number', 'search', 'button'].includes(value);
	return true;
}
const attrOk = (tag, [name, value]) =>
	!name.toLowerCase().startsWith('on') &&
	name !== 'style' &&
	(globalAttrs.includes(name) || name.startsWith('aria-') || (tagAttrs[tag] ?? []).includes(name)) &&
	valueOk(name, value);

// every problem in a tree, as `<path>: what`; none means the face-runtime would draw it
export function check(node, path = '') {
	if (typeof node === 'string') return [];
	const [tag, attrs, kids] = node;
	const here = `${path}/${tag}`;
	const problems = [];
	if (!allowedTags.includes(tag) || forbidden.includes(tag)) problems.push(`${here}: the tag ${tag} is not allowed`);
	for (const attr of attrs) if (!attrOk(tag, attr)) problems.push(`${here}: the attribute ${attr[0]}="${attr[1]}" is not allowed`);
	kids.forEach((kid, i) => problems.push(...check(kid, `${here}[${i}]`)));
	return problems;
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→', larr: '←' };
export const decode = (text) =>
	text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, name) => {
		if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
		if (!(name in entities)) throw new Error(`unknown entity ${all}`);
		return entities[name];
	});

// markup → its top-level nodes. Text that is only whitespace between elements goes; other runs of whitespace become one
// space, as a browser lays them out.
export function parse(markup) {
	const root = ['#root', [], []];
	const stack = [root];
	let at = 0;
	const fail = (what) => {
		const line = markup.slice(0, at).split('\n').length;
		throw new Error(`line ${line}: ${what}`);
	};
	while (at < markup.length) {
		if (markup.startsWith('<!--', at)) {
			const end = markup.indexOf('-->', at);
			if (end < 0) fail('a comment that never ends');
			at = end + 3;
		} else if (markup.startsWith('</', at)) {
			const m = /^<\/([a-z][a-z0-9]*)\s*>/.exec(markup.slice(at));
			if (!m) fail('a malformed end tag');
			const open = stack.pop();
			if (open[0] !== m[1]) fail(`</${m[1]}> closes <${open[0]}>`);
			at += m[0].length;
		} else if (markup[at] === '<') {
			const m = /^<([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)\s*(\/?)>/.exec(markup.slice(at));
			if (!m) fail('a malformed tag');
			const attrs = [...m[2].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]);
			const node = [m[1], attrs, []];
			stack.at(-1)[2].push(node);
			if (!voids.has(m[1]) && !m[3]) stack.push(node);
			at += m[0].length;
		} else {
			const end = markup.indexOf('<', at);
			const raw = markup.slice(at, end < 0 ? undefined : end);
			if (raw.trim()) stack.at(-1)[2].push(decode(raw.replace(/\s+/g, ' ')));
			at += raw.length;
		}
	}
	if (stack.length > 1) fail(`<${stack.at(-1)[0]}> is never closed`);
	return root[2];
}

// every class a tree names, for the slide check: each visual element is a layer with a stable class
export const classes = (nodes) =>
	nodes.flatMap((n) => (typeof n === 'string' ? [] : [...(n[1].find(([k]) => k === 'class')?.[1].split(/\s+/) ?? []), ...classes(n[2])]));
