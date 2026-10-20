// @ts-nocheck — plain JS
// One entry ref and one hash for everything we load (game/code/ref.js, game/hash.js): a code entry's ref and an
// asset's pin are read by the same grammar, strictly, and every BLAKE3 name of ours is made the same way.
// Run: bun test src/lib/code/ref.test.js
import { describe, expect, test } from 'bun:test';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { ENTRY_REF, entryRef, parseEntryRef } from '../../../game/code/ref.js';
import { hashBytes, hashText, holds } from '../../../game/hash.js';
import { PIN_REF, parsePin, pinRef } from '../assets/sources/avendb.js';
import { parseCodeRef } from '../../../game/code/index.js';

const [V, E, H1, H2] = ['ab', 'cd', 'ef', '01'].map((x) => x.repeat(32));

describe('the one entry ref', () => {
	test('reads a version as its heads, sorted, so one version is one string', () => {
		expect(parseEntryRef(`vault:${V}/${E}@${H1},${H2}?stage=9`)).toEqual({ vault: V, entry: E, heads: [H2, H1], query: 'stage=9' });
		expect(entryRef({ vault: V, entry: E, heads: [H1, H2] })).toBe(entryRef({ vault: V, entry: E, at: [H2, H1] }));
		expect(parseEntryRef(entryRef({ vault: V, entry: E, heads: [H1] }, 'a=1'))).toEqual({ vault: V, entry: E, heads: [H1], query: 'a=1' });
	});
	test('as data too, with the same rules', () => {
		expect(parseEntryRef({ entry: E, at: [H1] })).toEqual({ vault: null, entry: E, heads: [H1] });
		for (const bad of [{ entry: E, at: [] }, { entry: 'x', at: [H1] }, { entry: E, at: [H1], vault: 'short' }, { entry: E, at: Array(17).fill(H1) }]) expect(parseEntryRef(bad)).toBeNull();
	});
	test('refuses anything looser than avenDB ids', () => {
		for (const bad of [`vault:${V.slice(1)}/${E}@${H1}`, `vault:${V}/${E}@`, `vault:${V}/${E}@${H1}#x`, `vault:${V}/${E}@${H1} `, `vault:${V}/plants/apple@2`, `Vault:${V}/${E}@${H1}`, 42, null, `vault:${V}/${E}@${H1}?${'a'.repeat(3000)}`])
			expect(parseEntryRef(bad)).toBeNull();
	});
	test("an asset's pin and a code entry's ref are the same grammar", () => {
		expect(PIN_REF).toBe(ENTRY_REF);
		const ref = pinRef({ vault: V, entry: E, at: [H1] }, 'stage=9');
		expect(parsePin(ref)).toEqual({ vault: V, entry: E, at: [H1], params: { stage: '9' } });
		expect(parseCodeRef(pinRef({ vault: V, entry: E, at: [H1] }))).toEqual({ source: 'avendb', vault: V, entry: E, heads: [H1] });
	});
});

describe('the one hash', () => {
	test('is BLAKE3 in hex, of a text as its UTF-8 bytes', () => {
		const text = 'maiaCITY · ✓';
		expect(hashText(text)).toBe(bytesToHex(blake3(utf8ToBytes(text))));
		expect(hashBytes(utf8ToBytes(text))).toBe(hashText(text));
		expect(holds(utf8ToBytes(text), hashText(text))).toBe(true);
		expect(holds(text, hashText(text))).toBe(false);
		expect(holds(utf8ToBytes(`${text}!`), hashText(text))).toBe(false);
	});
});
