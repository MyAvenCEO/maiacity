// @ts-nocheck — plain JS
// Versions and pins in words (./versions.js), from what avenDB's `history`, `note` and `pin` ops read.
// Run: bun test src/lib/avendb/versions.test.js
import { expect, test } from 'bun:test';
import { pinLabel, versionWords } from './versions.js';

test('a version reads by its release and the edits after it', () => {
	expect(versionWords({ version: 3, edits: 0 })).toBe('v3');
	expect(versionWords({ version: 3, edits: 1 })).toBe('v3 + 1 edit');
	expect(versionWords({ version: 3, edits: 2 })).toBe('v3 + 2 edits');
	expect(versionWords({ version: null, edits: 0 })).toBe('draft');
	expect(versionWords(null)).toBe('');
});

test('a pin is labelled by avenDB alone: title, version, line, short id', () => {
	const pin = { entry: '01627d33'.padEnd(64, 'a'), at: ['b'.repeat(64)], line: null, name: 'main',
		version: { version: 4, edits: 0 }, title: 'Crawler excavator', short: '01627d33' };
	expect(pinLabel(pin)).toBe('Crawler excavator v4 · 01627d33…');
	expect(pinLabel({ ...pin, line: 'c'.repeat(64), name: 'Silkie', title: 'Chicken', version: { version: 3, edits: 0 } }))
		.toBe('Chicken v3 · Silkie · 01627d33…');
});
