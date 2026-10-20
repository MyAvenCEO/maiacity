// The words of the site's document pages as Markdown, for the Maia City vault (src/lib/avendb/docs.js): the theOS
// paper (/theos/) into docs/theos.md. Run after a build, whenever it changes:
//
//   npx vite build && node scripts/docs-markdown.mjs
//
// It reads the prerendered pages (build/), takes their <main>, and writes it down: headings, paragraphs, lists, term
// lists, tables, code, links, and each formula as LaTeX (KaTeX keeps its source); a figure, which is drawn live on the
// page, becomes its caption, in italics, under a line that names it. Numbers the page computes read as they were at the
// build.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const PAGES = [
	{ from: 'build/theos/index.html', to: 'docs/theos.md', page: '/theos/' }
];

const SKIP = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'NAV', 'INPUT', 'SELECT', 'LABEL', 'NOSCRIPT', 'TEMPLATE']);
const squash = (s) => s.replace(/\s+/g, ' ');

/** An element's text as Markdown, inline: marks, links, code and formulas. */
function inline(node) {
	if (node.nodeType === 3) return squash(node.textContent);
	if (node.nodeType !== 1 || SKIP.has(node.tagName)) return '';
	const el = node;
	if (el.classList?.contains('katex')) {
		const tex = el.querySelector('annotation')?.textContent?.trim() ?? '';
		return el.parentElement?.classList?.contains('katex-display') ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
	}
	if (el.tagName === 'svg') return '';
	const inner = () => [...el.childNodes].map(inline).join('');
	switch (el.tagName) {
		case 'STRONG':
		case 'B':
			return wrap('**', inner());
		case 'EM':
		case 'I':
			return wrap('*', inner());
		case 'CODE':
			return `\`${el.textContent}\``;
		case 'BR':
			return '  \n';
		case 'A': {
			const href = el.getAttribute('href') ?? '';
			const words = inner().trim();
			return href && !href.startsWith('#') ? `[${words}](${href})` : words;
		}
		case 'SUP':
			return `^${inner()}`;
		default:
			return inner();
	}
}

const wrap = (mark, s) => (s.trim() ? `${s.match(/^\s*/)[0]}${mark}${s.trim()}${mark}${s.match(/\s*$/)[0]}` : s);

/** A table as Markdown: its caption, its head, its rows. */
function table(el) {
	const cell = (c) => inline(c).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ');
	const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map(cell));
	if (!rows.length) return '';
	const width = Math.max(...rows.map((r) => r.length));
	const line = (r) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
	const caption = el.querySelector('caption');
	const head = caption ? `*${inline(caption).trim()}*\n\n` : '';
	return `${head}${line(rows[0])}\n| ${Array(width).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}`;
}

let figures = 0;

/** A block and what it holds, as Markdown blocks. */
function blocks(node, out) {
	if (node.nodeType === 3) {
		const t = squash(node.textContent).trim();
		if (t) out.push(t);
		return;
	}
	if (node.nodeType !== 1 || SKIP.has(node.tagName)) return;
	const el = node;
	const tag = el.tagName;
	if (/^H[1-6]$/.test(tag)) return void out.push(`${'#'.repeat(Number(tag[1]))} ${inline(el).trim()}`);
	if (tag === 'P') return void push(out, inline(el).trim());
	if (tag === 'PRE') return void out.push(`\`\`\`\n${el.textContent.replace(/\n$/, '')}\n\`\`\``);
	if (tag === 'TABLE') return void out.push(table(el));
	if (tag === 'UL' || tag === 'OL') {
		const items = [...el.children].filter((c) => c.tagName === 'LI');
		return void out.push(items.map((li, i) => `${tag === 'OL' ? `${i + 1}.` : '-'} ${inline(li).trim().replace(/\n+/g, ' ')}`).join('\n'));
	}
	if (tag === 'DL') {
		const lines = [];
		for (const c of el.children) {
			if (c.tagName === 'DT') lines.push(`**${inline(c).trim()}**`);
			if (c.tagName === 'DD') lines.push(`: ${inline(c).trim()}`);
		}
		return void out.push(lines.join('\n'));
	}
	if (tag === 'BLOCKQUOTE') {
		const inner = [];
		for (const c of el.childNodes) blocks(c, inner);
		return void out.push(inner.join('\n\n').replace(/^/gm, '> '));
	}
	if (tag === 'svg') return;
	if (tag === 'FIGURE' || (el.querySelector?.(':scope > svg') && el.querySelector?.('figcaption'))) {
		const caption = el.querySelector('figcaption');
		const rest = [];
		for (const c of el.childNodes) if (c !== caption && c.tagName !== 'svg') blocks(c, rest);
		figures += 1;
		const said = caption ? inline(caption).trim() : '';
		return void out.push(...rest, `*[Figure ${figures}, drawn live on the page]${said ? ` ${said}` : ''}*`);
	}
	if (el.classList?.contains('katex-display')) return void out.push(inline(el).trim());
	// a block of inline content only (a div standing for a paragraph) reads as one paragraph
	const blockish = [...el.children].some((c) => /^(P|H[1-6]|UL|OL|DL|TABLE|PRE|FIGURE|SECTION|DIV|BLOCKQUOTE|HEADER|FOOTER|ASIDE|ARTICLE)$/.test(c.tagName));
	if (!blockish) return void push(out, inline(el).trim());
	for (const c of el.childNodes) blocks(c, out);
}

const push = (out, s) => s && out.push(s.replace(/\n{3,}/g, '\n\n'));

for (const { from, to, page } of PAGES) {
	figures = 0;
	const { document } = parseHTML(readFileSync(from, 'utf8'));
	const main = document.querySelector('main') ?? document.body;
	const out = [];
	for (const c of main.childNodes) blocks(c, out);
	const head = `<!-- The words of maia.city${page} as Markdown, made by scripts/docs-markdown.mjs from the built page. -->`;
	const md = `${head}\n\n${out.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
	writeFileSync(to, md);
	console.log(`${to}: ${md.length} characters, ${figures} figures`);
}
