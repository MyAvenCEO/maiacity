// avenID's slides, read as avenOS draws them: each <id>.part.json, its markup and its rules. Whether the face-runtime
// takes a part (its allowlist, every rule's range, size, contrast, read aloud) is the host test `slides`, every part
// through the frozen face-runtime; these are the brain's own rules for a slide (STYLE.md, "A slide").
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ruleCss, ruleOk } from '../../os/web/runtimes/draw.js';
import { fromMarkup, html } from './face.mjs';

const brain = new URL('..', import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(`${brain}${path}`, 'utf8'));
// a colour is a Value's JSON, `{ bytes }`; the drawer takes it as its 3 bytes
const value = (v) =>
	Array.isArray(v) ? v.map(value) : v && typeof v === 'object' && 'bytes' in v ? Uint8Array.from(v.bytes.match(/../g), (b) => parseInt(b, 16)) : v;
const shared = read('style/slide.style.json');
const ids = readdirSync(`${brain}id/slides`)
	.filter((f) => f.endsWith('.part.json'))
	.map((f) => f.slice(0, -'.part.json'.length));
const walk = (n, f) => {
	if (typeof n === 'string') return;
	f(n);
	n[2].forEach((k) => walk(k, f));
};

test('there are avenID\'s nine', () => expect(ids.length).toBe(9));

for (const id of ids)
	describe(id, () => {
		const [mark, style] = read(`id/slides/${id}.part.json`);
		const tree = fromMarkup(mark);
		test('its rules are style/slide.style.json\'s, then its own', () => expect(style).toEqual([...shared, ...read(`id/slides/${id}.style.json`)]));
		test('its .html is a preview of its tree', () => expect(readFileSync(`${brain}id/slides/${id}.html`, 'utf8')).toBe(`${html(tree)}\n`));
		// a slide is one figure, and every element a layer with a stable class, so a motion version can move each one
		test('every element is a named layer', () => {
			expect(tree[0]).toBe('figure');
			expect(tree[1].find(([k]) => k === 'class')?.[1].split(' ')).toEqual(['slide', id]);
			const unnamed = [];
			walk(tree, (n) => n[1].some(([k, v]) => k === 'class' && v) || unnamed.push(n[0]));
			expect(unnamed).toEqual([]);
		});
		test('every rule is of Style, as the drawer checks it', () => expect(style.filter((r) => !ruleOk(value(r)))).toEqual([]));
		// no text on a slide under 2.6cqw: 9 px where a phone shows a slide 356 px wide
		test('no font size under 2.6cqw', () =>
			expect(style.flatMap(([, ds]) => ds).filter((d) => d[0] === 'font-size' && (d[1][1] !== 'cqw' || d[1][0] < 260))).toEqual([]));
		// every drawing it shows is a file of the brain named by its own BLAKE3 hash, as the network names files
		test('every image is a drawing, named by its BLAKE3 hash', () => {
			const wrong = [];
			walk(tree, (n) => {
				const src = n[1].find(([k]) => k === 'src')?.[1];
				if (!src) return;
				const hash = src.slice('/files/'.length);
				let bytes;
				try {
					bytes = readFileSync(`${brain}art/img/${hash}.png`);
				} catch {
					return wrong.push(`no drawing ${src}`);
				}
				if (bytesToHex(blake3(bytes)) !== hash) wrong.push(`${hash} is not its file's hash`);
			});
			expect(wrong).toEqual([]);
		});
	});

// the runtimes' own vector for "A key signs" (aven/runtimes/spec/vectors/face.json): its CSS, as Style.lean writes it,
// is what the drawer writes from the brain's rules
test('face.json: the slide "A key signs" is the brain\'s', () => {
	const vector = JSON.parse(readFileSync(new URL('../../../runtimes/spec/vectors/face.json', import.meta.url), 'utf8')).find((v) => v.name === 'the slide "A key signs"');
	const ours = new Set(read('id/slides/sign.part.json')[1].map((r) => ruleCss(value(r))));
	expect(vector.expected.css.filter((rule) => !ours.has(rule))).toEqual([]);
});
