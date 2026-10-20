// @ts-nocheck — plain JS
// Versions and pins in words (./versions.js), from what avenDB's `history`, `note` and `pin` ops read.
// Run: bun test src/lib/avendb/versions.test.js
import { expect, test } from 'bun:test';
import { editWords, lineName, pinLabel, versionWords } from './versions.js';

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

test('an edit reads as the history of the line shown says it, its lines by name', () => {
	const lines = [{ line: null, name: null }, { line: 'p', name: 'Warmer' }, { line: 'b', name: 'Silkie', variant: true }];
	const e = (o) => ({ kind: 'edit', line: null, deps: ['x'], name: null, from: null, ...o });
	expect(lineName(lines[0])).toBe('main');
	expect(lineName({ line: 'q', name: null })).toBe('a line this browser can’t name');
	expect(editWords(e({ deps: [] }), lines, null, 'the note')).toBe('Wrote the note');
	expect(editWords(e({}), lines, null)).toBe('Edited');
	expect(editWords(e({ line: 'p' }), lines, null)).toBe('Edited on “Warmer”');
	expect(editWords(e({ kind: 'propose', line: 'p', name: 'Warmer', from: { line: null } }), lines, 'p')).toBe('Proposed “Warmer” from “main”');
	expect(editWords(e({ kind: 'merge', from: { line: 'p' } }), lines, null)).toBe('Merged “Warmer” into main');
	expect(editWords(e({ kind: 'merge', line: 'b', from: { line: null } }), lines, 'b')).toBe('Brought main into “Silkie”');
	expect(editWords(e({ kind: 'merge', line: 'p', from: { line: null } }), lines, 'p')).toBe('Updated “Warmer” from main');
});
