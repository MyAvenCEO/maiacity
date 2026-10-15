// @ts-nocheck — plain JS
// A name of 32 bytes in an address ($lib/ids.js): the Universe's doc ids read as before, and every one reads back.
// Run: bun test src/lib/ids.test.js
import { expect, test } from 'bun:test';
import { ID, hexOf, idOf } from './ids.js';

// the Universe's own base32 before it was shared, kept here to hold the new one to it
function before(bytes) {
	const abc = 'abcdefghijklmnopqrstuvwxyz234567';
	let bits = 0, value = 0, out = '';
	for (const b of bytes) {
		value = ((value << 8) | b) & 0xffff;
		bits += 8;
		while (bits >= 5) out += abc[(value >>> (bits -= 5)) & 31];
	}
	return bits ? out + abc[(value << (5 - bits)) & 31] : out;
}

const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

test('32 bytes read as the Universe read them, 52 letters, and back', () => {
	for (const hex of ['0'.repeat(64), 'f'.repeat(64), ...Array.from({ length: 500 }, random)]) {
		const id = idOf(hex);
		expect(id).toBe(before(hex.match(/../g).map((h) => parseInt(h, 16))));
		expect(ID.test(id)).toBe(true);
		expect(hexOf(id)).toBe(hex);
	}
	expect(idOf('AB'.repeat(32))).toBe(idOf('ab'.repeat(32)));
});

test('anything else is no name', () => {
	expect(() => idOf('ab'.repeat(31))).toThrow();
	expect(() => idOf('xy'.repeat(32))).toThrow();
	const id = idOf(random());
	expect(hexOf(id.slice(0, 51))).toBeUndefined();
	expect(hexOf(id.toUpperCase())).toBeUndefined();
	expect(hexOf(id.slice(0, 51) + '1')).toBeUndefined();
	// the last letter carries one bit of the bytes and 4 past them, which are 0: so no 32 bytes have two names
	const abc = 'abcdefghijklmnopqrstuvwxyz234567';
	const last = abc.indexOf(id[51]);
	expect(last & 15).toBe(0);
	for (const extra of [1, 2, 4, 8]) expect(hexOf(id.slice(0, 51) + abc[last | extra])).toBeUndefined();
});
