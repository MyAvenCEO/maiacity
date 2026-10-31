// avenBRAIN in avenOS (aven/DB2/brain): its package list, pages, slides and glossary, bundled from the repo at build time.
// Text comes in as Markdown and leaves as a node tree (brain/render), which Node.svelte draws. A slide is a face: its
// tree and its style data, which the face-runtime's drawer (os/web/runtimes/draw.js) draws into a shadow root of its own.
import list from '../../../brain/packages.json';
import { blocks, slug } from '../../../brain/render/markdown.js';
import { rewriteLinks } from '../../../brain/render/links.js';
import { check, parse } from '../../../brain/render/tree.js';
import '../../../brain/style/tokens.css';
import images from '../../../brain/art/images.json';
import { draw, ruleOk } from '../runtimes/draw.js';

const files = import.meta.glob('../../../brain/**/*.{md,html}', { query: '?raw', import: 'default', eager: true });
const file = (path) => files[`../../../brain/${path}`];

// The slides' style is data, the face-runtime's (brain/style/slide.style.json, then each slide's <id>.style.json): rules
// in the JSON form of a Value, a colour `{ bytes }`, which the drawer takes as its 3 bytes. Checked here as the drawer
// checks them, so a rule outside Style fails the build's first page, not one slide.
const sheets = import.meta.glob(['../../../brain/style/slide.style.json', '../../../brain/*/slides/*.style.json'], { import: 'default', eager: true });
const value = (v) =>
	Array.isArray(v) ? v.map(value) : v && typeof v === 'object' && 'bytes' in v ? Uint8Array.from(v.bytes.match(/../g), (b) => parseInt(b, 16)) : v;
const style = (path) => {
	const rules = value(sheets[`../../../brain/${path}`] ?? []);
	const bad = rules.find((r) => !ruleOk(r));
	if (bad) throw new Error(`${path}: a rule outside Style: ${JSON.stringify(bad)}`);
	return rules;
};
const shared = style('style/slide.style.json');

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

// a slide: a face, its markup as one tree and its rules, every slide's first; and its text
export function slide(pkg, id) {
	const [tree, ...more] = checked(`${pkg}/slides/${id}.html`, parse(file(`${pkg}/slides/${id}.html`) ?? ''));
	if (!tree || more.length) throw new Error(`${pkg}/slides/${id}.html: a slide is one element`);
	return { id, face: { tree, style: [...shared, ...style(`${pkg}/slides/${id}.style.json`)] }, text: markdown(`${pkg}/slides/${id}.md`) };
}

// a Svelte action: the drawer draws the face into the node's own shadow root, its images from the bundle
export const face = (node, part) => {
	draw(node, part, { file: fileOf });
	return { update: (next) => draw(node, next, { file: fileOf }) };
};

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

// The drawings (brain/art), bundled. A slide names one as the network names a file, `/files/<BLAKE3 hash>`, the only
// image the allowlist takes; the drawer asks here where that file is, and avenOS serves the brain's own from its bundle
const drawn = import.meta.glob('../../../brain/art/img/*.png', { query: '?url', import: 'default', eager: true });
const fileOf = (hash) => drawn[`../../../brain/art/img/${hash}.png`] ?? null;

// an object's picture, for a card
export const art = (name) => fileOf(images[name]);
