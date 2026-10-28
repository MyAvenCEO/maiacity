// @ts-nocheck — plain JS
// Sandbox 8 runs one build of its upstream, pinned by the BLAKE3 of its bytes (./build.json), which the vault keeps as
// the code package `sandbox-8` (src/lib/code/packages.json): the two pins agree, the app holds no copy of the
// upstream's code, and the page takes only Maia City's file entry tagged with the pin.
// Run: bun test src/lib/sandbox-8
import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';

mock.module('$lib/avendb/local.js', () => ({ localDevice: async () => null }));
const { MAIA_CITY } = await import('../../../game/code/sources/feed.js');
const { PIN_TAG, pinnedFile } = await import('./pinned.js');
const PIN = (await import('./build.json')).default;
const CODE = (await import('../code/packages.json')).default;

describe("Sandbox 8's pinned build", () => {
	test('the code package pins the very file the page runs', () => {
		const pack = CODE.packages.find((p) => p.id === 'sandbox-8');
		expect(pack.files).toEqual([expect.objectContaining({ name: PIN.file.name, size: PIN.file.size, blake3: PIN.file.blake3 })]);
		expect(pack.version).toBe(PIN.commit.slice(0, 7));
		expect(PIN.file.blake3).toMatch(/^[0-9a-f]{64}$/);
	});

	test('the app holds no copy of the upstream', () => {
		expect(existsSync(new URL('./cc', import.meta.url))).toBe(false);
		expect(readdirSync(new URL('.', import.meta.url)).filter((f) => /\.(tsx?|json)$/.test(f))).toEqual(['build.json']);
	});

	test("the page takes only Maia City's file entry tagged with the pin, and its newest file", () => {
		const file = (root) => ({ root, size: 10, len: PIN.file.size });
		const row = (o) => ({ vault: MAIA_CITY, type: 'file', tags: ['package', PIN_TAG], files: [file('old'), file('new')], ...o });
		expect(pinnedFile({ ok: { rows: [row({})] } })).toEqual(file('new'));
		for (const other of [{ vault: 'f'.repeat(64) }, { type: 'note' }, { tags: ['package'] }, { deleted: true }, { tags: [PIN_TAG, 'avendb:deleted'] }])
			expect(pinnedFile({ ok: { rows: [row(other)] } })).toBeUndefined();
		expect(pinnedFile(null)).toBeUndefined();
	});
});
