// avenBRAIN in avenOS (aven/DB2/brain): its package list, pages, slides and glossary, bundled from the repo at build time.
// Text comes in as Markdown and leaves as a node tree (brain/render), which Node.svelte draws. A slide is a face: its
// part (<id>.part.json, its markup and every rule) goes through the frozen face-runtime, loaded by its hash in the
// runtimes worker (os/web/runtimes), and the drawer (os/web/runtimes/draw.js) draws its answer into a shadow root of its
// own. No slide is drawn that face-runtime didn't accept.
import list from '../../../brain/packages.json';
import { blocks, slug } from '../../../brain/render/markdown.js';
import { rewriteLinks } from '../../../brain/render/links.js';
import '../../../brain/style/tokens.css';
import images from '../../../brain/art/images.json';
import { checkTree, draw } from '../runtimes/draw.js';
import { fromJson, runtime } from '../runtimes/runtimes.js';

const files = import.meta.glob('../../../brain/**/*.md', { query: '?raw', import: 'default', eager: true });
const file = (path) => files[`../../../brain/${path}`];

// Each slide's part, as brain/art/slides.mjs writes it: its markup and its rules, style/slide.style.json's first, in
// the JSON form of a Value
const parts = import.meta.glob('../../../brain/*/slides/*.part.json', { import: 'default', eager: true });

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

// every tree is checked against the allowlist before it is drawn, whoever made it: Markdown too, by the drawer's check
function checked(where, tree) {
	const bad = tree.find((node) => !checkTree(node));
	if (bad) throw new Error(`${where}: a node outside the allowlist: ${JSON.stringify(bad).slice(0, 120)}`);
	return tree;
}

// Markdown to a tree, its links rewritten, checked
const markdown = (path, options = {}) => checked(path, rewriteLinks(blocks(file(path) ?? '', options), linker(path)));

export const page = (path) => markdown(path);

// a slide: a face's part, and its text
export function slide(pkg, id) {
	const part = parts[`../../../brain/${pkg}/slides/${id}.part.json`];
	if (!part) throw new Error(`${pkg}/slides/${id}.part.json: no part; bun brain/art/slides.mjs writes it`);
	return { id, part, text: markdown(`${pkg}/slides/${id}.md`) };
}

// A Svelte action: face-runtime runs the part (no data: a slide's text is its markup's), and the drawer draws its
// answer into the node's own shadow root, its images from the bundle. A part face-runtime refuses draws nothing, and
// the node says why (`data-refused`). Only the newest part's answer is drawn.
export const face = (node, part) => {
	let asked = 0;
	const show = async (next) => {
		const mine = ++asked;
		try {
			const answer = fromJson(await runtime('face-runtime', next, {}));
			if (mine !== asked) return;
			draw(node, answer, { file: fileOf });
			delete node.dataset.refused;
		} catch (error) {
			if (mine !== asked) return;
			node.dataset.refused = String(error?.message ?? error);
			console.error(`a slide wasn't drawn: ${node.dataset.refused}`);
		}
	};
	show(part);
	return { update: show };
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
