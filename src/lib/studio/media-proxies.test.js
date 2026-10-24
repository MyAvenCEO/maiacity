// @ts-nocheck — Bun test runtime, outside the browser type environment
import { expect, test } from 'bun:test';
import { audioProxyOf, hasSound } from './transcript.js';
import { isStoredMedia } from '../media/ref.js';

test('public and private audio proxies use the shared validated media boundary', () => {
	for (const ref of ['a'.repeat(64), 'a'.repeat(64) + '.mp3', `aven:${'b'.repeat(64)}:116:100:audio%2Fmpeg`]) {
		const item = /** @type {any} */ ({ kind: 'video', class: 'original', meta: { audio: ref, probe: { audio: false } } });
		expect(isStoredMedia(ref)).toBe(true);
		expect(audioProxyOf(item)).toBe(ref);
		expect(hasSound(item)).toBe(true);
	}
	for (const ref of ['aven:bad:1:1:', `aven:${'b'.repeat(64)}:1:100:`, 'https://example.com/file.mp3', 'vault://old', 'javascript:alert(1)']) {
		expect(isStoredMedia(ref)).toBe(false);
		expect(audioProxyOf(/** @type {any} */ ({ meta: { audio: ref } }))).toBeNull();
	}
});
