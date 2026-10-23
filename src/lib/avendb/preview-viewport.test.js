// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { previewPool } from './preview-pool.js';
import { previewViewport } from './preview-viewport.js';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function fixture() {
	const observers = [], started = [], freed = [], changes = [], requests = [];
	class Observer {
		constructor(callback) { this.callback = callback; observers.push(this); }
		observe(node) { this.node = node; }
		disconnect() { this.disconnected = true; }
		show(value) { this.callback([{ isIntersecting: value }]); }
	}
	const pool = previewPool({ changed: (...args) => changes.push(args), dispose: (value) => freed.push(value) });
	const spec = (key) => ({ key, bytes: 4, load(signal) {
		started.push(key);
		return new Promise((resolve) => requests.push({ signal, resolve }));
	} });
	const node = {};
	const row = previewViewport(node, { key: 'a' }, (value, showing, observed) => {
		if (showing && observed) pool.retain(node, spec(value.key)); else pool.release(node);
	}, Observer);
	return { observers, started, freed, changes, requests, pool, spec, row };
}

test('replacement world records retain one observer and the same loading or ready preview', async () => {
	const f = fixture();
	try {
		f.observers[0].show(true); await flush();
		for (let i = 0; i < 20; i++) f.row.update({ key: 'a', revision: i });
		await flush();
		expect(f.observers.length).toBe(1); expect(f.started).toEqual(['a']);
		expect(f.requests[0].signal.aborted).toBe(false);
		f.requests[0].resolve('url-a'); await flush();
		f.row.update({ key: 'a', title: 'updated title' }); await flush();
		expect(f.changes).toEqual([['a', 'url-a']]); expect(f.freed).toEqual([]);
		f.row.destroy(); expect(f.freed).toEqual(['url-a']);
	} finally { f.row.destroy(); f.pool.close(); }
});

test('a changed file cancels its old read and destroyed observers cannot reacquire ownership', async () => {
	const f = fixture();
	try {
		f.row.update({ key: 'b' }); await flush(); expect(f.started).toEqual([]);
		f.observers[0].show(true); await flush(); expect(f.started).toEqual(['b']);
		f.row.update({ key: 'c' }); await flush();
		expect(f.requests[0].signal.aborted).toBe(true); expect(f.started).toEqual(['b', 'c']);
		f.requests[0].resolve('old-b'); await flush(); expect(f.changes).toEqual([]);
		f.requests[1].resolve('url-c'); await flush();
		f.row.destroy(); f.observers[0].show(true); f.row.update({ key: 'd' }); await flush();
		expect(f.observers[0].disconnected).toBe(true);
		expect(f.started).toEqual(['b', 'c']); expect(f.freed).toEqual(['old-b', 'url-c']);
	} finally { f.row.destroy(); f.pool.close(); }
});

test('the selected viewer keeps its shared poster when the grid row unmounts', async () => {
	const f = fixture(), viewer = {};
	try {
		f.observers[0].show(true); await flush(); f.requests[0].resolve('poster'); await flush();
		f.pool.retain(viewer, f.spec('a')); f.row.destroy(); await flush();
		expect(f.started).toEqual(['a']); expect(f.freed).toEqual([]);
		expect(f.changes).toEqual([['a', 'poster']]);
		f.pool.release(viewer); expect(f.freed).toEqual(['poster']);
	} finally { f.row.destroy(); f.pool.close(); }
});

test('without an observer metadata stays visible but no automatic preview is requested', () => {
	const changes = [];
	const row = previewViewport({}, 'first', (...args) => changes.push(args), null);
	row.update('replacement'); row.destroy(); row.destroy(); row.update('late');
	expect(changes).toEqual([['first', true, false], ['replacement', true, false], ['replacement', false, false]]);
});
