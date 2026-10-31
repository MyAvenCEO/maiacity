import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { check, classes, parse } from './tree.js';
import { contrastOk, linear, luminance, rgb } from './contrast.js';
import { rewriteLinks } from './links.js';
import { ruleCss, ruleOk } from '../../os/web/runtimes/draw.js';
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

// the slides' style is the face-runtime's style data (STYLE.md, "A slide"): style/slide.style.json by hand, each slide's
// <id>.style.json from art/slides.mjs. A colour is a Value's JSON, `{ bytes }`; the drawer takes it as its 3 bytes.
const value = (v) =>
	Array.isArray(v) ? v.map(value) : v && typeof v === 'object' && 'bytes' in v ? Uint8Array.from(v.bytes.match(/../g), (b) => parseInt(b, 16)) : v;
const read = (path) => JSON.parse(readFileSync(`${brain}${path}`, 'utf8'));
const sheets = ['style/slide.style.json', ...readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.style.json')).map((f) => `id/slides/${f}`)];

describe('style data', () => {
	// every rule is one the drawer (os/web/runtimes/draw.js) takes, as Style.lean types it
	for (const sheet of sheets)
		test(`${sheet} is in Style`, () => expect(read(sheet).filter((r) => !ruleOk(value(r)))).toEqual([]));
	// no text on a slide under 2.6cqw: 9 px where a phone shows a slide 356 px wide
	test('every font size is at least 2.6cqw', () => {
		const small = [];
		for (const sheet of sheets)
			for (const [, decls] of read(sheet))
				for (const d of decls) if (d[0] === 'font-size' && (d[1][1] !== 'cqw' || d[1][0] < 260)) small.push(`${sheet}: ${JSON.stringify(d)}`);
		expect(small).toEqual([]);
	});
	// the face part the face-runtime takes: the slide's markup, as FaceRuntime.lean's forms, and every rule, shared first
	const markup = (n) =>
		typeof n === 'string' ? ['text', ['lit', n]] : ['el', n[0], n[1].map(([k, v]) => [k, ['lit', v]]), null, n[2].map(markup)];
	for (const f of readdirSync(`${brain}id/slides`).filter((f) => f.endsWith('.part.json'))) {
		const id = f.slice(0, -'.part.json'.length);
		test(`id/slides/${f} is its markup and its style`, () =>
			expect(read(`id/slides/${f}`)).toEqual([markup(parse(readFileSync(`${brain}id/slides/${id}.html`, 'utf8'))[0]), [...read('style/slide.style.json'), ...read(`id/slides/${id}.style.json`)]]));
	}
	// the runtimes' own vector for "A key signs" (face.json): its CSS, as Style.lean writes it, is what the drawer writes from ours
	test('face.json: the slide "A key signs" is the brain\'s', () => {
		const vector = vectors('face.json').find((v) => v.name === 'the slide "A key signs"');
		const ours = new Set([...read('style/slide.style.json'), ...read('id/slides/sign.style.json')].map((r) => ruleCss(value(r))));
		expect(vector.expected.css.filter((rule) => !ours.has(rule))).toEqual([]);
	});
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
