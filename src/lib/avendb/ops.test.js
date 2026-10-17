// @ts-nocheck — plain JS
// Which ops bring a file, its bytes handed over beside them (./ops.js `brings`, avendb's `engine::brings`): the page's
// device and the Mac app's read them only for those.
// Run: bun test src/lib/avendb/ops.test.js
import { expect, test } from 'bun:test';
import { brings } from './ops.js';

test('a put_file brings a file, into a new entry or one it names, and a create brings one only with its file', () => {
	expect(brings({ op: 'put_file', vault: 'v', len: 3 })).toBe(true);
	expect(brings({ op: 'put_file', entry: 'e', len: 3 })).toBe(true);
	expect(brings({ op: 'create', vault: 'v', type: 'recipe', value: {}, file: { len: 3, name: 'lamp.js' } })).toBe(true);
	expect(brings({ op: 'create', vault: 'v', type: 'recipe', value: {} })).toBe(false);
	expect(brings({ op: 'set', entry: 'e', path: [], value: {}, file: { len: 3 } })).toBe(false);
	expect(brings({ op: 'read_file', root: 'r' })).toBe(false);
	expect(brings(null)).toBe(false);
});
