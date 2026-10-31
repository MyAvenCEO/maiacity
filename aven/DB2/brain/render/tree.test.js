import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { check, classes, parse } from './tree.js';
import { contrastOk, linear, luminance, rgb } from './contrast.js';
import { rewriteLinks } from './links.js';
import { toCss, toStyle } from './style.js';
import { blocks, inline } from './markdown.js';

// the runtimes' spec vectors (aven/runtimes/spec/vectors): what Lean computes, replayed here
const vectors = (name) => JSON.parse(readFileSync(new URL(`../../../runtimes/spec/vectors/${name}`, import.meta.url), 'utf8'));
const fromVector = (v) => ('text' in v ? v.text : [v.tag, v.attrs, v.kids.map(fromVector)]);

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
		expect(check(['a', [['href', '#/brain/glossary']], ['ok']])).toEqual([]);
	});
	for (const v of vectors('tree.json'))
		test(`tree.json: ${v.name}`, () => expect(check(fromVector(v.input.tree)).length === 0).toBe(v.expected));
});

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
		const keep = (href) => (/^(https:\/\/|mailto:)/.test(href) ? href : null);
		const tree = rewriteLinks(blocks(readFileSync(`${brain}GLOSSARY.md`, 'utf8')), keep);
		expect(tree.flatMap((n) => check(n))).toEqual([]);
		expect(tree.filter((n) => n[0] === 'h2').length).toBeGreaterThan(5);
	});
});

// no text on a slide under 2.6cqw (STYLE.md, "A slide"): 9 px where a phone shows a slide 356 px wide
test('every font size in the slides\' CSS is at least 2.6cqw', () => {
	const sheets = ['style/slide.css', ...readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.css')).map((f) => `id/slides/${f}`)];
	const small = [];
	for (const sheet of sheets) {
		const css = readFileSync(`${brain}${sheet}`, 'utf8');
		for (const [, size] of css.matchAll(/font(?:-size)?:[^;]*?([\d.]+)cqw/g)) if (Number(size) < 2.6) small.push(`${sheet}: ${size}cqw`);
	}
	expect(small).toEqual([]);
});

// the slides' CSS stays in the subset the face-runtime compiles into typed style rules (README, "What the runtimes
// plan lacks"): these properties only, no custom properties, no url(), no :where or other pseudo-classes
const subset = new Set([
	'position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display', 'aspect-ratio', 'container-type',
	'overflow', 'margin', 'margin-top', 'margin-bottom', 'padding', 'padding-top', 'clip-path', 'border-radius', 'border',
	'border-top', 'border-right', 'border-bottom', 'border-left', 'background', 'filter', 'box-shadow', 'transform', 'transform-origin', 'font-family', 'font-size',
	'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'white-space', 'text-align', 'color', 'gap',
]);
test('the slides\' CSS is in the face-runtime\'s subset', () => {
	const sheets = ['style/slide.css', ...readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.css')).map((f) => `id/slides/${f}`)];
	const outside = [];
	for (const sheet of sheets) {
		const css = readFileSync(`${brain}${sheet}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
			if (/:/.test(selectors)) outside.push(`${sheet}: the selector ${selectors.trim()}`);
			for (const decl of body.split(';').map((d) => d.trim()).filter(Boolean)) {
				const [name, ...rest] = decl.split(':');
				const value = rest.join(':');
				if (!subset.has(name.trim())) outside.push(`${sheet}: ${name.trim()}`);
				if (/var\(|url\(/.test(value) || name.trim().startsWith('--')) outside.push(`${sheet}: ${decl}`);
			}
		}
	}
	expect(outside).toEqual([]);
});

// every drawing a slide shows is a file of the brain named by its own BLAKE3 hash, as the network names files
test('every image on a slide is a drawing, named by its BLAKE3 hash', () => {
	const wrong = [];
	for (const file of readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.html'))) {
		for (const [, hash] of readFileSync(`${brain}id/slides/${file}`, 'utf8').matchAll(/src="\/files\/([0-9a-f]{64})"/g)) {
			let bytes;
			try {
				bytes = readFileSync(`${brain}art/img/${hash}.png`);
			} catch {
				wrong.push(`${file}: no drawing ${hash}`);
				continue;
			}
			if (bytesToHex(blake3(bytes)) !== hash) wrong.push(`${file}: ${hash} is not its file's hash`);
		}
	}
	expect(wrong).toEqual([]);
});

// the slides' CSS as the face-runtime's style data (render/style.js), kept beside each sheet as <name>.style.json
describe('style data', () => {
	const sheets = [['style/slide.css', 'style/slide.style.json'], ...readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.css')).map((f) => [`id/slides/${f}`, `id/slides/${f.replace(/\.css$/, '.style.json')}`])];
	for (const [css, json] of sheets)
		test(`${json} is ${css}, as data`, () => expect(JSON.parse(readFileSync(`${brain}${json}`, 'utf8'))).toEqual(toStyle(readFileSync(`${brain}${css}`, 'utf8'))));
	test('a declaration outside the face-runtime\'s style throws', () => {
		expect(() => toStyle('.a { filter: blur(1px); }')).toThrow();
		expect(() => toStyle('.a:hover { color: #000000; }')).toThrow();
		expect(() => toStyle('.a { color: red; }')).toThrow();
		expect(() => toStyle('.a { margin: 0 1px; }')).toThrow();
	});
	// the runtimes' own vector for "A key signs": its CSS, as Style.lean writes it, is ours
	test('style.json: the slide "A key signs" is the brain\'s', () => {
		const vector = vectors('style.json').find((v) => v.name === 'the slide "A key signs"');
		const ours = new Set([...toCss(JSON.parse(readFileSync(`${brain}style/slide.style.json`, 'utf8'))), ...toCss(JSON.parse(readFileSync(`${brain}id/slides/sign.style.json`, 'utf8')))]);
		expect(vector.expected.css.filter((rule) => !ours.has(rule))).toEqual([]);
	});
});
