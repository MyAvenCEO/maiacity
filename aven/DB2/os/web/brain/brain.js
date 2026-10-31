// avenBRAIN in avenOS (aven/DB2/brain): its package list, pages, slides and glossary, bundled from the repo at build time.
// Its Markdown goes through the frozen markdown-runtime and leaves as a checked node tree, which Node.svelte draws; a
// slide is a face: its part (<id>.part.json, its markup and every rule) goes through the frozen face-runtime, and the
// drawer (os/web/runtimes/draw.js) draws its answer into a shadow root of its own. Both run by their hash in the
// runtimes worker (os/web/runtimes), apart from the device key. Nothing is drawn that a runtime didn't accept.
import list from '../../../brain/packages.json';
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

// Where the brain's Markdown sits in the repository: each document resolves its links against its own path there
const home = 'aven/DB2/brain/';
// The brain's links, for markdown-runtime (its `links`, the first rule whose prefix a resolved link starts with): a
// term (`glossary:vault`) goes to the glossary, a package's page to its page, any other file of the repository to
// GitHub. A link no rule turns into one the allowlist takes keeps only its text.
const rules = [
	['glossary:', '#/brain/glossary/'],
	...packages.filter((p) => p.page).map((p) => [`${home}${p.page}`, `#/brain/${p.id}`]),
	['aven/', 'https://github.com/myavenceo/maiacity/blob/main/aven/'],
];

const hex = (text) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');

// A document's tree, as markdown-runtime draws it: the nodes under its root. Each is drawn once.
const trees = new Map();
function markdown(path, idPrefix = '') {
	if (!trees.has(path)) {
		const input = { links: rules, base: `${home}${path}`, idPrefix };
		// the runtime's tree, checked again by the drawer's own check before the page draws it, as a face's is; an
		// in-page link (`#heading`) goes to the page's own route, since avenOS routes by the hash
		const owner = (packages.find((p) => p.page === path) ?? packages.find((p) => path.startsWith(`${p.id}/`)))?.id;
		const tree = runtime('markdown-runtime', { bytes: hex(file(path) ?? '') }, input).then((root) => {
			const bad = root[2].find((node) => !checkTree(node));
			if (bad) throw new Error(`${path}: a node outside the allowlist: ${JSON.stringify(bad).slice(0, 120)}`);
			return owner ? root[2].map((node) => inPage(node, owner)) : root[2];
		});
		// a refusal isn't kept: the next ask runs it again
		tree.catch(() => trees.delete(path));
		trees.set(path, tree);
	}
	return trees.get(path);
}

// A link to a heading of its own page, `#heading`, as the page's route, `#/brain/<page>/heading`
const inPage = (node, page) =>
	typeof node === 'string'
		? node
		: [
				node[0],
				node[1].map(([k, v]) => [k, k === 'href' && v.startsWith('#') && !v.startsWith('#/') ? `#/brain/${page}/${v.slice(1)}` : v]),
				node[2].map((kid) => inPage(kid, page)),
			];

export const page = (path) => markdown(path);

// a slide: a face's part, and its text's tree
export async function slide(pkg, id) {
	const part = parts[`../../../brain/${pkg}/slides/${id}.part.json`];
	if (!part) throw new Error(`${pkg}/slides/${id}.part.json: no part; bun brain/art/slides.mjs writes it`);
	return { id, part, text: await markdown(`${pkg}/slides/${id}.md`) };
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

// a term's word as an id: lower case, punctuation gone, spaces to hyphens
const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/\s/g, '-');

// The glossary: its tree, its headings' ids `g-`'s, every term's entry with an id (`term-<word>`), and each word it
// defines, for #/brain/glossary/<word>. A term's id is the page's own, given to the tree markdown-runtime drew.
export async function glossary() {
	const tree = structuredClone(await markdown('GLOSSARY.md', 'g-'));
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
	return { tree, terms };
}

// The drawings (brain/art), bundled. A slide names one as the network names a file, `/files/<BLAKE3 hash>`, the only
// image the allowlist takes; the drawer asks here where that file is, and avenOS serves the brain's own from its bundle
const drawn = import.meta.glob('../../../brain/art/img/*.png', { query: '?url', import: 'default', eager: true });
const fileOf = (hash) => drawn[`../../../brain/art/img/${hash}.png`] ?? null;

// an object's picture, for a card
export const art = (name) => fileOf(images[name]);
