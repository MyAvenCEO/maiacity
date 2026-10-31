// avenBRAIN in avenOS (aven/DB2/brain): its package list, pages, slides and glossary, bundled from the repo at build time.
// Text comes in as Markdown and markup and leaves as node trees (brain/render), which Node.svelte draws: the shape the
// markdown-runtime and the face-runtime will hand over once they exist.
import list from '../../../brain/packages.json';
import { blocks, slug } from '../../../brain/render/markdown.js';
import { rewriteLinks } from '../../../brain/render/links.js';
import { check, parse } from '../../../brain/render/tree.js';
import '../../../brain/style/tokens.css';
import images from '../../../brain/art/images.json';
import shared from '../../../brain/style/slide.style.json';
import { ruleCss, ruleOk } from '../runtimes/draw.js';

const files = import.meta.glob('../../../brain/**/*.{md,html}', { query: '?raw', import: 'default', eager: true });
const file = (path) => files[`../../../brain/${path}`];

// The slides' style is data, the face-runtime's (brain/style/slide.style.json, then each slide's <id>.style.json): rules
// in the JSON form of a Value, a colour `{ bytes }`. Each is checked as the drawer checks it and written by the
// drawer's own writer, so a rule outside Style can't reach the page.
const sheets = import.meta.glob('../../../brain/*/slides/*.style.json', { import: 'default', eager: true });
const value = (v) =>
	Array.isArray(v) ? v.map(value) : v && typeof v === 'object' && 'bytes' in v ? Uint8Array.from(v.bytes.match(/../g), (b) => parseInt(b, 16)) : v;
const rules = [shared, ...Object.values(sheets)].flat().map(value);
const bad = rules.filter((r) => !ruleOk(r));
if (bad.length) throw new Error(`a slide's style is outside Style: ${JSON.stringify(bad[0])}`);
if (typeof document !== 'undefined' && !document.getElementById('brain-slides')) {
	const sheet = document.createElement('style');
	sheet.id = 'brain-slides';
	sheet.textContent = rules.map(ruleCss).join('\n');
	document.head.append(sheet);
}

export const packages = list.packages;

const repo = 'https://github.com/myavenceo/maiacity/blob/main/aven/DB2/brain/';
// a link in the brain's Markdown: a term (`glossary:vault`) goes to the glossary, a package's page to its page, any
// other file in the repo to GitHub, and the rest only if the allowlist takes it
export function linker(from) {
	return (href) => {
		if (href.startsWith('glossary:')) return `#/brain/glossary/${href.slice(9)}`;
		if (/^(https:\/\/|mailto:)/.test(href)) return href;
		if (href.startsWith('#')) return null;
		const url = new URL(href, `https://repo/${from}`);
		const path = url.pathname.slice(1);
		const own = packages.find((p) => p.page === path);
		if (own) return `#/brain/${own.id}`;
		return path.startsWith('../') ? null : `${repo}${path}${url.hash}`.replace('/brain/../', '/');
	};
}

// every tree is checked against the allowlist before it is drawn, whoever made it: Markdown too
function checked(where, tree) {
	const problems = tree.flatMap((node) => check(node));
	if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`);
	return tree;
}

// Markdown to a tree, its links rewritten, checked
const markdown = (path, options = {}) => checked(path, rewriteLinks(blocks(file(path) ?? '', options), linker(path)));

export const page = (path) => markdown(path);

// a slide: its markup as a tree, checked against the face-runtime's allowlist, and its text
export function slide(pkg, id) {
	const text = `${pkg}/slides/${id}.md`;
	return {
		id,
		tree: checked(`${pkg}/slides/${id}.html`, parse(file(`${pkg}/slides/${id}.html`) ?? '')).map(resolve),
		text: markdown(text),
	};
}

// the glossary: its tree, every term's entry with an id (`term-<word>`), and each word it defines, for #/brain/glossary/<word>
export function glossary() {
	const tree = rewriteLinks(blocks(file('GLOSSARY.md'), { idPrefix: 'g-' }), linker('GLOSSARY.md'));
	const terms = new Map();
	const words = (node) => (typeof node === 'string' ? node : node[2].map(words).join(''));
	const visit = (node) => {
		if (typeof node === 'string') return;
		if (node[0] === 'li' && node[2][0]?.[0] === 'strong') {
			const named = words(node[2][0])
				.split(/,| → | = /)
				.map((w) => slug(w.replace(/\(.*?\)/g, '')))
				.filter(Boolean);
			const id = `term-${named[0]}`;
			if (named[0] && !terms.has(named[0])) {
				node[1].push(['id', id]);
				for (const w of named) if (!terms.has(w)) terms.set(w, id);
			}
		}
		node[2].forEach(visit);
	};
	tree.forEach(visit);
	return { tree: checked('GLOSSARY.md', tree), terms };
}

// The drawings (brain/art), bundled. A slide names one as the network names a file, `/files/<BLAKE3 hash>`, and that is
// what the allowlist takes; avenOS serves the brain's own from its bundle, so the hash is resolved here, after the
// check, to the bundled file
const drawn = import.meta.glob('../../../brain/art/img/*.png', { query: '?url', import: 'default', eager: true });
const fileOf = (hash) => drawn[`../../../brain/art/img/${hash}.png`];
const resolve = (node) =>
	typeof node === 'string'
		? node
		: [node[0], node[1].map(([k, v]) => (k === 'src' && v.startsWith('/files/') && fileOf(v.slice(7)) ? [k, fileOf(v.slice(7))] : [k, v])), node[2].map(resolve)];

// an object's picture, for a card
export const art = (name) => fileOf(images[name]);
