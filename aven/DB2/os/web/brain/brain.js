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
		// the runtime's tree, checked again by the drawer's own check before the page draws it, as a face's is
		const tree = runtime('markdown-runtime', { bytes: hex(file(path) ?? '') }, input).then((root) => {
			const bad = root[2].find((node) => !checkTree(node));
			if (bad) throw new Error(`${path}: a node outside the allowlist: ${JSON.stringify(bad).slice(0, 120)}`);
			return root[2];
		});
		// a refusal isn't kept: the next ask runs it again
		tree.catch(() => trees.delete(path));
		trees.set(path, tree);
	}
	return trees.get(path);
}

// A page's tree, its decisions' ids made links: an `A<n>` in its text that the log holds goes to that row (A203)
export const page = async (path) => linkIds(structuredClone(await markdown(path)), await known());

// the text of a node and all under it
export const textOf = (node) => (typeof node === 'string' ? node : node[2].map(textOf).join(''));
const attr = (node, name) => node[1].find(([k]) => k === name)?.[1];

// A page's headings, for its contents: each h2 and h3 with its id, as markdown-runtime gives it
export const headings = (tree) =>
	tree.filter((n) => typeof n !== 'string' && (n[0] === 'h2' || n[0] === 'h3') && attr(n, 'id')).map((n) => ({ id: attr(n, 'id'), level: n[0] === 'h2' ? 2 : 3, name: textOf(n) }));

// The decision log (DECISIONS.md, A203): the runtime's tree of the file, read as its table's rows. The Markdown stays
// the one source and is drawn by markdown-runtime alone; this is page logic over its checked tree, as the glossary's
// term ids are. A row is its id, when, who decided, its decision's nodes and its title (the first bold run), and what
// it supersedes: wholly (a bare id) or in part (an id with a note in brackets). "— (refines …)" supersedes nothing.
// Each row also learns which later rows supersede it.
const LISTS = ['A', 'rule', 'actors', 'caps D', 'caps E', 'docs', 'engine', 'runtimes', 'peers', 'store', 'milestone2', 'sandbox'];
const ID = /\b(A\d+|rule \d+|caps [DE] ?\d+|(?:actors|docs|engine|runtimes|peers|store|milestone2|sandbox) \d+)\b/g;
const norm = (id) => id.replace(/^caps ([DE]) ?/, 'caps $1');
// an id in a link: `A192`, `caps-D13`, `sandbox-4`
export const idSlug = (id) => norm(id).replace(/ /g, '-');
// the list an id is numbered in: `A`, `rule`, `caps D`, `sandbox`, …
const listOf = (id) => (/^A\d/.test(id) ? 'A' : (/^(caps [DE])/.exec(norm(id))?.[1] ?? id.split(' ')[0]));

let log = null;
export function decisions() {
	log ??= markdown('DECISIONS.md').then((tree) => {
		const at = tree.findIndex((n) => n[0] === 'table');
		if (at < 0) throw new Error('DECISIONS.md: no table');
		const body = tree[at][2].find((n) => n[0] === 'tbody')?.[2] ?? [];
		const rows = body.map((tr) => {
			const cells = tr[2].filter((n) => n[0] === 'td');
			const [id, when, by] = cells.slice(0, 3).map((c) => textOf(c).trim());
			const decision = cells[3]?.[2] ?? [];
			const supersedes = cells[4]?.[2] ?? [];
			const plain = textOf(cells[4] ?? '').trim();
			const replaces = plain.startsWith('—')
				? []
				: plain.split(';').flatMap((part) => {
						const p = part.trim();
						if (/^(refines|places|applies|realizes|settles|completes|extends)\b/.test(p)) return [];
						const head = p.split('(')[0];
						const partly = p.includes('(');
						return [...head.matchAll(ID)].map((m) => ({ id: norm(m[1]), partly }));
					});
			const strong = decision.find((n) => typeof n !== 'string' && n[0] === 'strong');
			return {
				id: norm(id),
				slug: idSlug(id),
				list: listOf(id),
				when,
				by,
				title: strong ? textOf(strong).trim() : textOf(['p', [], decision]).slice(0, 80),
				decision,
				supersedes,
				replaces,
				later: [],
				text: `${id} ${when} ${by} ${textOf(['p', [], decision])} ${plain}`.toLowerCase(),
			};
		});
		const byId = new Map(rows.map((r) => [r.id, r]));
		for (const r of rows) for (const { id, partly } of r.replaces) byId.get(id)?.later.push({ id: r.id, slug: r.slug, partly });
		for (const r of rows) r.stands = !r.later.some((x) => !x.partly);
		const ids = new Set(rows.map((r) => r.id));
		for (const r of rows) {
			r.decision = linkIds(structuredClone(r.decision), ids);
			r.supersedes = linkIds(structuredClone(r.supersedes), ids);
		}
		return { intro: linkIds(structuredClone(tree.slice(0, at)), ids), rows, after: linkIds(structuredClone(tree.slice(at + 1)), ids), lists: LISTS.filter((l) => rows.some((r) => r.list === l)) };
	});
	log.catch(() => (log = null));
	return log;
}
const known = async () => new Set((await decisions()).rows.map((r) => r.id));

// `A<n>` in text becomes a link to its row, when the log holds it; never inside a link, code or a heading
const SKIP = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
export function linkIds(tree, ids) {
	const visit = (node) => {
		if (typeof node === 'string' || SKIP.has(node[0])) return node;
		node[2] = node[2].flatMap((kid) => {
			if (typeof kid !== 'string') return [visit(kid)];
			const out = [];
			let last = 0;
			for (const m of kid.matchAll(/\bA\d+\b/g)) {
				if (!ids.has(m[0])) continue;
				if (m.index > last) out.push(kid.slice(last, m.index));
				out.push(['a', [['href', `#/brain/decisions/${m[0]}`], ['class', 'decision-link']], [m[0]]]);
				last = m.index + m[0].length;
			}
			if (!out.length) return [kid];
			if (last < kid.length) out.push(kid.slice(last));
			return out;
		});
		return node;
	};
	return tree.map(visit);
}

// a slide: a face's part, and its text's tree
export async function slide(pkg, id) {
	const part = parts[`../../../brain/${pkg}/slides/${id}.part.json`];
	if (!part) throw new Error(`${pkg}/slides/${id}.part.json: no part; bun brain/art/slides.mjs writes it`);
	return { id, part, text: await page(`${pkg}/slides/${id}.md`) };
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
	return { tree: linkIds(tree, await known()), terms };
}

// The drawings (brain/art), bundled. A slide names one as the network names a file, `/files/<BLAKE3 hash>`, the only
// image the allowlist takes; the drawer asks here where that file is, and avenOS serves the brain's own from its bundle
const drawn = import.meta.glob('../../../brain/art/img/*.png', { query: '?url', import: 'default', eager: true });
const fileOf = (hash) => drawn[`../../../brain/art/img/${hash}.png`] ?? null;

// an object's picture, for a card
export const art = (name) => fileOf(images[name]);
