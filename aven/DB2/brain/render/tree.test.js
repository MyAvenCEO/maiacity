import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { check, classes, parse } from './tree.js';
import { blocks, inline } from './markdown.js';

const brain = new URL('..', import.meta.url).pathname;

describe('the tree', () => {
	test('parses elements, attributes, text and entities, and drops comments', () => {
		expect(parse('<div class="a b"><!-- note --><p>Hi &amp; bye</p><br></div>')).toEqual([
			['div', [['class', 'a b']], [['p', [], ['Hi & bye']], ['br', [], []]]],
		]);
	});
	test('refuses what it does not read', () => {
		expect(() => parse('<div><p></div>')).toThrow('closes');
		expect(() => parse("<div class='x'></div>")).toThrow('malformed');
		expect(() => parse('<div>')).toThrow('never closed');
	});
	test('checks the allowlist as Tree.lean has it', () => {
		expect(check(['div', [['class', 'x'], ['aria-label', 'y']], []])).toEqual([]);
		expect(check(['svg', [], []])).toHaveLength(1);
		expect(check(['div', [['style', 'color: red']], []])).toHaveLength(1);
		expect(check(['div', [['onclick', 'x()']], []])).toHaveLength(1);
		expect(check(['a', [['href', 'javascript:x()']], []])).toHaveLength(1);
		expect(check(['a', [['href', '#/docs/glossary']], ['ok']])).toEqual([]);
	});
});

describe('Markdown', () => {
	test('inline: code, strong, emphasis and links, rewritten or dropped', () => {
		expect(inline('a **b `c`** *d* [e](glossary:key) [f](x.md)', { link: (h) => (h.startsWith('glossary:') ? '#/docs/glossary/key' : null) })).toEqual([
			'a ',
			['strong', [], ['b ', ['code', [], ['c']]]],
			' ',
			['em', [], ['d']],
			' ',
			['a', [['href', '#/docs/glossary/key']], ['e']],
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

// every slide in the brain: allowlisted, no inline style, and every element a named layer
describe('the slides', () => {
	const slides = readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.html'));
	test('there is at least one', () => expect(slides.length).toBeGreaterThan(0));
	for (const file of slides) {
		test(file, () => {
			const tree = parse(readFileSync(`${brain}id/slides/${file}`, 'utf8'));
			expect(tree).toHaveLength(1);
			expect(tree.flatMap((n) => check(n))).toEqual([]);
			const unnamed = [];
			const walk = (n) => {
				if (typeof n === 'string') return;
				if (!n[1].some(([k]) => k === 'class')) unnamed.push(n[0]);
				n[2].forEach(walk);
			};
			tree.forEach(walk);
			expect(unnamed).toEqual([]);
			expect(classes(tree)).toContain('slide');
		});
	}
	test('the whole glossary renders to an allowlisted tree', () => {
		const tree = blocks(readFileSync(`${brain}GLOSSARY.md`, 'utf8'));
		expect(tree.flatMap((n) => check(n))).toEqual([]);
		expect(tree.filter((n) => n[0] === 'h2').length).toBeGreaterThan(5);
	});
});
