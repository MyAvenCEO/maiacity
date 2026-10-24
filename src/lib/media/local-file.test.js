// @ts-nocheck — Bun test runner, matching the other plain JS tests.
import { expect, test } from 'bun:test';
import { localFile } from './local-file.js';
const hash = 'a'.repeat(64);
const picture = { type: 'file', vault: 'samuel', title: 'profile.jpg', files: [{ root: hash }] };
test('profile lookup respects the vault and deletion', () => {
	expect(localFile([picture], 'samuel', 'profile.jpg')).toBe(picture);
	expect(localFile([picture], 'daniel', 'profile.jpg')).toBeUndefined();
	expect(localFile([{ ...picture, deleted: true }], 'samuel', 'profile.jpg')).toBeUndefined();
});
test('legacy hash media resolves to the local named file, not an HTTP gateway', () => {
	const file = { ...picture, title: `${hash}.mp4` };
	expect(localFile([file], 'samuel', hash)).toBe(file);
	expect(localFile([file], 'samuel', 'a'.repeat(63))).toBeUndefined();
});
