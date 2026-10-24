// @ts-nocheck — Bun test runtime, outside the browser type environment
import { expect, test } from 'bun:test';
import { registerAssets } from './register.js';
import { versioned } from '../app/versions.js';

test('registration preserves metadata and builder identity, including historical variants', () => {
	const old = () => 'old';
	const current = () => 'current';
	const items = [{ id: 'chair', label: 'Chair', make: current, params: [], units: 'm' }];
	const history = { chair: [{ v: 1, date: '2026-10-01', note: 'old', build: old }, { v: 2, date: '2026-10-02', note: 'new' }] };
	expect(registerAssets(items, 'make', history)).toEqual(versioned(items, 'make', history));
	expect(registerAssets([{ id: 'animal', variants: [{ id: 'small', make: old }] }], 'variants')[0].versions[0].build[0].make).toBe(old);
});

test('registration rejects ambiguous IDs, broken histories and variant builders', () => {
	const item = { id: 'chair', make: () => {} };
	expect(() => registerAssets([item, item], 'make')).toThrow(/duplicate/);
	expect(() => registerAssets([{ ...item, id: 'chair@1' }], 'make')).toThrow(/identity/);
	expect(() => registerAssets([item], 'make', { chair: [] })).toThrow(/history/);
	expect(() => registerAssets([item], 'make', { chair: [{ v: 2, date: '2026-10-01', note: '' }] })).toThrow(/history/);
	expect(() => registerAssets([{ id: 'animal', variants: [{ id: 'small' }] }], 'variants')).toThrow(/variant/);
});

test('unavailable world history stays explicitly unavailable, never relabelled as kept', () => {
	const item = { id: 'tent', make: () => {} };
	const history = { tent: [{ v: 1, date: '2026-10-01', note: 'world' }, { v: 2, date: '2026-10-02', note: 'object' }] };
	expect(registerAssets([item], 'make', history)[0].versions[0].kept).toBe(false);
});
