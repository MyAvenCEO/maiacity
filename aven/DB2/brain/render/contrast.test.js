import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastOk, linear, luminance, rgb } from './contrast.js';

// the runtimes' spec vectors (aven/runtimes/spec/vectors): what Lean computes, replayed here
const vectors = (name) => JSON.parse(readFileSync(new URL(`../../../runtimes/spec/vectors/${name}`, import.meta.url), 'utf8'));

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
