// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { createEntryWindow } from './query-window.js';
import { visibleEntries } from './visible-entries.js';

const id = (n) => n.toString(16).padStart(64, '0');
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
const node = () => {
	const calls = [];
	return { calls, run: async (op) => { calls.push(op); return { ok: { accepted: true } }; } };
};

test('scrolling releases rows but retains selected files and shared previews until their last consumer leaves', async () => {
	const d = node();
	const window = createEntryWindow({ device: () => d });
	const visible = visibleEntries((entries) => void window.replace(entries));
	const a = {}, b = {};
	try {
		visible.show(a, [id(1), id(3)]);
		visible.show(b, [id(2), id(3)]);
		visible.select([id(4)]); await flush();
		expect(d.calls.at(-1).entries).toEqual([id(4), id(1), id(3), id(2)]);
		visible.hide(a); await flush();
		expect(d.calls.at(-1).entries).toEqual([id(4), id(2), id(3)]);
		visible.hide(b); await flush();
		expect(d.calls.at(-1).entries).toEqual([id(4)]);
		visible.select([]); await flush();
		expect(d.calls.at(-1).entries).toEqual([]);
		expect(new Set(d.calls.map((op) => op.scope)).size).toBe(1);
	} finally { window.close(); }
});

test('mounted entry windows rebind their current demand without sending stale clears to a replacement device', async () => {
	const a = node(), b = node(); let device = a;
	const window = createEntryWindow({ device: () => device });
	try {
		await window.replace([id(1)]);
		device = b; await window.invalidate(); await flush();
		expect(a.calls.map((op) => op.entries)).toEqual([[id(1)], []]);
		expect(b.calls.map((op) => op.entries)).toEqual([[id(1)]]);
		expect(a.calls[0].scope).not.toBe(b.calls[0].scope);
		window.close(); await flush();
		expect(a.calls).toHaveLength(2);
		expect(b.calls.at(-1).entries).toEqual([]);
		await window.replace([id(2)]); await window.invalidate();
		expect(b.calls).toHaveLength(2);
	} finally { window.close(); }
});

test('a locked view retains its desired entries but never opens a device or reads content', async () => {
	let device = null;
	const d = node();
	const window = createEntryWindow({ device: () => device });
	try {
		expect(await window.replace([id(1)])).toBe(false);
		device = d; await window.invalidate();
		expect(d.calls.map((op) => op.entries)).toEqual([[id(1)]]);
		device = null; await window.invalidate(); await flush();
		expect(d.calls.at(-1).entries).toEqual([]);
		await window.clear(); device = d; await window.invalidate();
		expect(d.calls).toHaveLength(2);
	} finally { window.close(); }
});

test('rapid viewport replacements reuse one scope, and selected entries remain first under the bound', async () => {
	const d = node(), window = createEntryWindow({ device: () => d });
	const visible = visibleEntries((entries) => void window.replace(entries));
	try {
		for (let n = 0; n < 150; n++) { visible.show('row', [id(n)]); await flush(); }
		expect(new Set(d.calls.map((op) => op.scope)).size).toBe(1);
		visible.show('large fallback', ['bad', ...Array.from({ length: 1000 }, (_, n) => id(n))]);
		visible.select([id(1001)]); await flush();
		expect(d.calls.at(-1).entries).toHaveLength(512);
		expect(d.calls.at(-1).entries[0]).toBe(id(1001));
		visible.clear(); await flush();
		expect(d.calls.at(-1).entries).toEqual([]);
	} finally { window.close(); }
});

test('older native apps can decline metadata without blocking viewport reads or retrying every scroll', async () => {
	const calls = [];
	const d = { run: async (op) => { calls.push(op); return { refused: 'BadOp' }; } };
	const window = createEntryWindow({ device: () => d });
	try {
		expect(await window.replace([id(1)])).toBe(false);
		expect(await window.replace([id(2)])).toBe(false);
		expect(calls).toHaveLength(1);
	} finally { window.close(); }
});
