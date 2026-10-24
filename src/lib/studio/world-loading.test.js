// @ts-nocheck — executed by bun:test
import { expect, test } from 'bun:test';
import { currentWorldPage, waitForWorld } from './world-loading.js';
const pending = () => new Promise(() => {});
test('a mounted world becomes ready', async () => {
	expect(await waitForWorld(Promise.resolve(), () => ({ present: true }), 100)).toBe(true);
});
test('navigation releases a hung child', async () => {
	let present = true;
	const wait = waitForWorld(pending(), () => ({ present }), 100, 2);
	present = false;
	expect(await wait).toBe(false);
});
test('native bootstrap error releases a hung ready promise', async () => {
	let error;
	const wait = waitForWorld(pending(), () => ({ present: true, error }), 100, 2);
	error = 'Recipe read failed';
	await expect(wait).rejects.toThrow('Recipe read failed');
});
test('a hung child expires with the actual loading stage', async () => {
	await expect(waitForWorld(pending(), () => ({ present: true, label: 'building assets' }), 10, 2)).rejects.toThrow('World loading timed out while building assets');
});
test('ready rejection is reported', async () => {
	await expect(waitForWorld(Promise.reject(new Error('GPU failed')), () => ({ present: true }), 100)).rejects.toThrow('GPU failed');
});

const page = (href, extra = {}) => ({ location: { href }, ...extra });
test('world handoff ignores outgoing errors and APIs until the requested document arrives', () => {
 const base = 'tauri://localhost/app/studio/';
 const wanted = '/games/maiacity-v2/?film&area=C';
 expect(currentWorldPage(page('tauri://localhost/games/maiacity-v1/?film&area=A', { __filmMountError: 'old failure' }), wanted, base)).toBe(false);
 expect(currentWorldPage(page('about:blank'), wanted, base)).toBe(false);
 expect(currentWorldPage(page('tauri://localhost' + wanted), wanted, base)).toBe(true);
 expect(currentWorldPage(page('tauri://localhost' + wanted, { __lost: true }), wanted, base)).toBe(false);
});
