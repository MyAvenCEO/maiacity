// avenBRAIN in avenOS (aven/DB2/brain): its catalogue, pages, slides and glossary, bundled from the repo at build time.
// Text comes in as Markdown and markup and leaves as node trees (brain/render), which Node.svelte draws: the shape the
// markdown-runtime and the face-runtime will hand over once they exist.
import catalogue from '../../../brain/docs.json';
import { blocks, slug } from '../../../brain/render/markdown.js';
import { check, parse } from '../../../brain/render/tree.js';
import '../../../brain/style/tokens.css';
import '../../../brain/style/slide.css';

const files = import.meta.glob('../../../brain/**/*.{md,html}', { query: '?raw', import: 'default', eager: true });
import.meta.glob('../../../brain/*/slides/*.css', { eager: true });
const file = (path) => files[`../../../brain/${path}`];

export const packages = catalogue.packages;

const repo = 'https://github.com/myavenceo/maiacity/blob/main/aven/DB2/brain/';
// a link in the brain's Markdown: a term (`glossary:vault`) goes to the glossary, a package's page to its page, any
// other file in the repo to GitHub, and the rest only if the allowlist takes it
export function linker(from) {
	return (href) => {
		if (href.startsWith('glossary:')) return `#/docs/glossary/${href.slice(9)}`;
		if (/^(https:\/\/|mailto:)/.test(href)) return href;
		if (href.startsWith('#')) return null;
		const url = new URL(href, `https://repo/${from}`);
		const path = url.pathname.slice(1);
		const own = packages.find((p) => p.page === path);
		if (own) return `#/docs/${own.id}`;
		return path.startsWith('../') ? null : `${repo}${path}${url.hash}`.replace('/brain/../', '/');
	};
}

// every tree is checked against the allowlist before it is drawn, whoever made it: Markdown too
function checked(where, tree) {
	const problems = tree.flatMap((node) => check(node));
	if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`);
	return tree;
}

export const page = (path) => checked(path, blocks(file(path) ?? '', { link: linker(path) }));

// a slide: its markup as a tree, checked against the face-runtime's allowlist, and its text
export function slide(pkg, id) {
	const text = `${pkg}/slides/${id}.md`;
	return {
		id,
		tree: checked(`${pkg}/slides/${id}.html`, parse(file(`${pkg}/slides/${id}.html`) ?? '')),
		text: checked(text, blocks(file(text) ?? '', { link: linker(text) })),
	};
}

// the glossary: its tree, every term's entry with an id (`term-<word>`), and each word it defines, for #/docs/glossary/<word>
export function glossary() {
	const tree = blocks(file('GLOSSARY.md'), { link: linker('GLOSSARY.md'), idPrefix: 'g-' });
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
