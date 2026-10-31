import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastOk, linear, luminance, rgb } from './contrast.js';
import { rewriteLinks } from './links.js';
import { checkTree } from '../../os/web/runtimes/draw.js';
import { blocks, inline } from './markdown.js';

// the runtimes' spec vectors (aven/runtimes/spec/vectors): what Lean computes, replayed here
const vectors = (name) => JSON.parse(readFileSync(new URL(`../../../runtimes/spec/vectors/${name}`, import.meta.url), 'utf8'));

const brain = new URL('..', import.meta.url).pathname;

describe('contrast', () => {
	const [table, ...pairs] = vectors('contrast.json');
	test('linear light, as Face.lean tabulates it', () => expect(linear).toEqual(table.linear));
	test(`contrast.json: ${pairs.length} pairs`, () => {
		const wrong = pairs.filter((v) => {
			const fg = rgb(v.input.fg);
			const bg = rgb(v.input.bg);
			return luminance(fg) !== v.expected.fg || luminance(bg) !== v.expected.bg || contrastOk(fg, bg, false) !== v.expected.normal || contrastOk(fg, bg, true) !== v.expected.large;
		});
		expect(wrong.map((v) => v.name)).toEqual([]);
	});
});

describe('Markdown', () => {
	test('inline: code, strong, emphasis and links, rewritten or dropped in one pass over the tree', () => {
		const link = (h) => (h.startsWith('glossary:') ? '#/brain/glossary/key' : null);
		expect(rewriteLinks([['p', [], inline('a **b `c`** *d* [e](glossary:key) [f](x.md)')]], link)[0][2]).toEqual([
			'a ',
			['strong', [], ['b ', ['code', [], ['c']]]],
			' ',
			['em', [], ['d']],
			' ',
			['a', [['href', '#/brain/glossary/key']], ['e']],
			' ',
			'f',
		]);
	});
	test('a tight list with continuation lines, and a table', () => {
		const md = '- **key**: signs\n  and opens.\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n';
		expect(blocks(md)).toEqual([
			['ul', [], [['li', [], [['strong', [], ['key']], ': signs and opens.']], ['li', [], ['two']]]],
			[
				'table',
				[],
				[
					['thead', [], [['tr', [], [['th', [['scope', 'col']], ['A']], ['th', [['scope', 'col']], ['B']]]]]],
					['tbody', [], [['tr', [], [['td', [], ['1']], ['td', [], ['2']]]]]],
				],
			],
		]);
	});
	test('raw HTML stays text', () => {
		expect(blocks('<script>x</script>')).toEqual([['p', [], ['<script>x</script>']]]);
	});
});

// the whole glossary renders to a tree the drawer takes (os/web/runtimes/draw.js, the allowlist's checker on the page)
test('the whole glossary renders to an allowlisted tree', () => {
	const keep = (href) => (/^(https:\/\/|mailto:)/.test(href) ? href : null);
	const tree = rewriteLinks(blocks(readFileSync(`${brain}GLOSSARY.md`, 'utf8')), keep);
	expect(tree.every((n) => checkTree(n))).toBe(true);
	expect(tree.filter((n) => n[0] === 'h2').length).toBeGreaterThan(5);
});
