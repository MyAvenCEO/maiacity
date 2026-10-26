// @ts-nocheck — mount the real selection/read effects; unrelated child views and media hosts stay outside this fixture.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { compile, compileModule } from 'svelte/compiler';
import { parseHTML } from 'linkedom';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createReadWindow } from './query-window.js';
import { createReactiveRead } from './reactive-read.js';
import { observedWindow } from './observed-window.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((w) => w.queries ?? []) : undefined };

const id = (n) => n.toString(16).padStart(64, '0');
const vault = id(99);
const item = (entry, title = 'Local document', extra = {}) => ({ entry, title, vault, type: 'story', tags: ['doc'], readers: [vault], writers: [], sharers: [], record: { text: title }, ...extra });
const world = (entries = []) => ({ entries, vaults: [{ id: vault, kind: 'human', name: 'Test vault', owners: [], devices: [] }], shares: [], groups: [], kinds: [], mine: vault });
let ui, folder;
const previous = new Map();
const domGetters = new Map();

beforeAll(async () => {
	const { window } = parseHTML('<html><body></body></html>');
	for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'Event']) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : window[key] });
	}
	// Svelte caches Node's DOM getters. Linkedom implements these on concrete subclasses instead.
	for (const key of ['firstChild', 'nextSibling']) {
		const original = Object.getOwnPropertyDescriptor(window.Node.prototype, key);
		domGetters.set(key, original);
		Object.defineProperty(window.Node.prototype, key, { configurable: true, get() {
			for (let p = Object.getPrototypeOf(this); p && p !== window.Node.prototype; p = Object.getPrototypeOf(p)) {
				const get = Object.getOwnPropertyDescriptor(p, key)?.get;
				if (get) return get.call(this);
			}
			return original.get.call(this);
		} });
	}
	const here = import.meta.dir;
	const mocks = new Map([
		[join(here, 'flows.js'), 'export const flowsFor = () => []; export const stageOf = () => null;'],
		[join(here, 'docs.js'), 'export const readable = text => text;'],
		[join(here, 'article.js'), 'export const DOC_PICTURE = ""; export const pictures = () => []; export const fileNamed = () => null; export const render = text => text;'],
		[join(here, 'files.js'), 'export const dataUrl = () => ""; export const mediaOf = () => ""; export const whole = () => { throw new Error("unexpected media read"); };'],
		[resolve(here, '../sandbox/math-host.js'), 'export const typesetIn = async () => {};']
	]);
	const harness = `<script>
		import Note from ${JSON.stringify(join(here, 'Note.svelte'))};
		import Docs from ${JSON.stringify(join(here, 'Docs.svelte'))};
		let { kind, initial } = $props();
		const { vault, actor, api, busy, onaccess } = initial;
		let world = $state.raw(initial.world), entry = $state(initial.entry);
		export function update(next) {
			if ('world' in next) world = next.world;
			if ('entry' in next) entry = next.entry;
		}
	</script>
	{#if kind === 'note'}<Note {world} {actor} {api} {busy} {entry} />{:else}<Docs {world} {vault} {actor} {api} {entry} {onaccess} />{/if}`;
	folder = await mkdtemp(join(tmpdir(), 'avendb-entry-bootstrap-'));
	const result = await Bun.build({
		entrypoints: ['entry-bootstrap-fixture'], outdir: folder, target: 'browser', format: 'esm', conditions: ['browser'],
		plugins: [{ name: 'entry-bootstrap-fixture', setup(build) {
			build.onResolve({ filter: /^entry-bootstrap-fixture$/ }, () => ({ path: 'entry', namespace: 'entry-fixture' }));
			build.onResolve({ filter: /^entry-bootstrap-harness$/ }, () => ({ path: 'harness', namespace: 'entry-fixture' }));
			build.onResolve({ filter: /^\$lib\// }, ({ path }) => ({ path: resolve(here, '..', path.slice(5)) }));
			build.onLoad({ filter: /.*/, namespace: 'entry-fixture' }, ({ path }) => ({
				contents: path === 'entry' ? 'export { mount, unmount, flushSync } from "svelte"; export { default as Harness } from "entry-bootstrap-harness";' : compile(harness, { filename: 'entry-bootstrap-harness.svelte', generate: 'client' }).js.code,
				loader: 'js', resolveDir: here
			}));
			build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
				contents: compile(['Note.svelte', 'Docs.svelte'].some((name) => path === join(here, name)) ? await readFile(path, 'utf8') : '<script>let { children } = $props();</script>{@render children?.()}', { filename: path, generate: 'client' }).js.code,
				loader: 'js', resolveDir: resolve(path, '..')
			}));
			build.onLoad({ filter: /\.svelte\.js$/ }, async ({ path }) => ({
				contents: compileModule(await readFile(path, 'utf8'), { filename: path, generate: 'client' }).js.code,
				loader: 'js', resolveDir: resolve(path, '..')
			}));
			build.onLoad({ filter: /\.js$/ }, ({ path }) => mocks.has(path) ? { contents: mocks.get(path), loader: 'js' } : undefined);
		} }]
	});
	if (!result.success) throw new AggregateError(result.logs, 'component fixture did not compile');
	ui = await import(result.outputs[0].path);
}, 30000);

afterAll(async () => {
	for (const [key, descriptor] of domGetters) Object.defineProperty(Node.prototype, key, descriptor);
	for (const [key, descriptor] of previous) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	if (folder) await rm(folder, { recursive: true, force: true });
});

const activeDemand = calls => [...new Map(calls.map(c => [c.scope, c.entries])).values()].filter(entries => entries.length);
const settle = async () => { for (let n = 0; n < 12; n++) { ui.flushSync(); await Promise.resolve(); } };
function fixture(kind, entries, entry) {
	const calls = [], reads = [], inventoryReads = [], observers = new Set();
	const d = { run: async (op) => { calls.push(flat(op)); return { ok: { accepted: true } }; } };
	const answer = (op) => {
		if (op.op === 'note') return new Promise((resolve) => reads.push({ op, resolve }));
		if (op.op !== 'entry_views') return Promise.resolve({ ok: {} });
		inventoryReads.push(op);
		// Mirror both canonical scoped modes: explicit IDs for detail views,
		// selected-vault positive types for collection discovery.
		if (('entries' in op) === ('vault' in op)) throw new Error('fixture requires one inventory scope');
		const selected = entries.filter(e => op.entries ? op.entries.includes(e.entry) : e.vault === op.vault);
		const rows = selected.filter(e => !op.types || op.types.includes(e.type));
		return Promise.resolve({ ok: { rows, totalEntries: selected.length, readableEntries: selected.length } });
	};
	const api = {
		ask: answer, window: () => createReadWindow({ device: () => d, read: (_, op) => answer(op) }),
		observe(query, take, failed) {
			const reader = createReactiveRead({ read: observedWindow((_, op) => answer(op)), take, failed });
			const refresh = () => reader.update(query(), d);
			observers.add(refresh); refresh();
			return () => { observers.delete(refresh); reader.close(); };
		}
	};
	const target = document.createElement('div'); document.body.append(target);
	const component = ui.mount(ui.Harness, { target, props: { kind, initial: { world: { ...world([]), entriesComplete: false }, vault, actor: vault, api, busy: false, entry, onaccess() {} } } });
	return { calls, reads, inventoryReads, target, component: { update(next) {
		if (next.world) entries = next.world.entries;
		component.update(next.world ? { ...next, world: { ...next.world, entries: [], entriesComplete: false } } : next);
		if (next.world) for (const refresh of observers) refresh();
	} }, async close() { await ui.unmount(component); target.remove(); await settle(); } };
}

test('an unknown explicit note starts a scoped read and reuses its scope as local metadata arrives', async () => {
	const f = fixture('note', [], id(1));
	try {
		await settle();
		expect(f.reads.map((r) => r.op.entry)).toEqual([id(1)]);
		expect(activeDemand(f.calls)).toContainEqual([id(1)]);
		const scopes = new Set(f.calls.map(c => c.scope));
		expect(scopes.size).toBe(2); // independent metadata and note history leases
		f.reads[0].resolve({ refused: 'NoEntry' }); await settle();
		f.component.update({ world: world([item(id(1))]) }); await settle();
		expect(f.reads.map((r) => r.op.entry)).toEqual([id(1), id(1)]);
		expect(new Set(f.calls.map((c) => c.scope))).toEqual(scopes); // revisions retain both scopes
		f.reads[1].resolve({ refused: 'NoEntry' }); await settle();
	} finally { await f.close(); }
	expect(activeDemand(f.calls)).toEqual([]);
});

for (const existing of [[], [item(id(2), 'Different document')]]) test(`an explicit missing doc is never replaced by ${existing.length ? 'the first local document' : 'an empty local list'}`, async () => {
	const f = fixture('docs', existing, id(1));
	try {
		await settle();
		expect(f.reads.map((r) => r.op.entry)).toEqual([id(1)]);
		expect(activeDemand(f.calls)).toContainEqual([id(1)]);
		expect(f.target.querySelector('article.doc')).toBeNull();
		f.reads[0].resolve({ refused: 'NoEntry' }); await settle();
		expect(f.target.textContent).toContain('hasn’t loaded this document');
		f.component.update({ world: world([...existing, item(id(1), 'Requested document')]) }); await settle();
		expect(f.reads.at(-1).op.entry).toBe(id(1));
		f.reads.at(-1).resolve({ ok: { entry: id(1), lines: [], edits: [] } }); await settle();
		expect(f.target.querySelector('article.doc h1')?.textContent).toBe('Requested document');
	} finally { await f.close(); }
});

test('Docs still selects the first local document only when no explicit target was given', async () => {
	const f = fixture('docs', [item(id(2), 'Default document')], '');
	try {
		await settle();
		expect(f.reads.map((r) => r.op.entry)).toEqual([id(2)]);
		expect(f.inventoryReads).toContainEqual({ op: 'entry_views', vault, as: vault, types: ['story', 'post'] });
		f.reads[0].resolve({ ok: { entry: id(2), lines: [], edits: [] } }); await settle();
		expect(f.target.querySelector('article.doc h1')?.textContent).toBe('Default document');
	} finally { await f.close(); }
});

test('switching the explicit doc clears old data and rejects an abandoned response', async () => {
	const f = fixture('docs', [item(id(1), 'First'), item(id(2), 'Second')], id(1));
	try {
		await settle();
		f.component.update({ entry: id(2) }); await settle();
		expect(f.reads.map((r) => r.op.entry)).toEqual([id(1), id(2)]);
		f.reads[0].resolve({ ok: { entry: id(1), lines: [{ line: null, record: { text: 'Abandoned text' } }], edits: [] } }); await settle();
		expect(f.target.textContent).not.toContain('Abandoned text');
		expect(f.target.querySelector('article.doc h1')?.textContent).toBe('Second');
		expect(activeDemand(f.calls)).toContainEqual([id(2)]);
		f.reads[1].resolve({ refused: 'NoEntry' }); await settle();
	} finally { await f.close(); }
});

test('a previous note answer is not displayed under a new explicit target', async () => {
	const f = fixture('note', [item(id(1), 'First'), item(id(2), 'Second')], id(1));
	try {
		await settle();
		const scope = f.calls.find((c) => c.entries.includes(id(1))).scope;
		f.reads[0].resolve({ ok: { entry: id(1), kind: 'story', lines: [{ line: null, title: 'Previous answer', text: '', heads: [], history: [], blocks: [], record: {} }], edits: [] } }); await settle();
		expect(f.target.querySelector('h1.title')?.textContent).toBe('Previous answer');
		f.component.update({ entry: id(2) }); await settle();
		expect(f.target.querySelector('h1.title')?.textContent).toBe('Second');
		expect(f.target.textContent).toContain('Opening the note');
		expect(f.calls.filter((c) => c.scope === scope).at(-1).entries).toEqual([]);
		expect(activeDemand(f.calls)).toEqual([[id(2)], [id(2)]]); // neither active lease retains the old target
		f.reads.at(-1).resolve({ refused: 'NoEntry' }); await settle();
		expect(f.target.textContent).not.toContain('Previous answer');
	} finally { await f.close(); }
});

test('unmount releases an unknown document and a late answer cannot republish it', async () => {
	const f = fixture('docs', [], id(1));
	await settle();
	expect(f.reads).toHaveLength(1);
	await f.close();
	f.reads[0].resolve({ ok: { entry: id(1), lines: [], edits: [] } }); await settle();
	expect(activeDemand(f.calls)).toEqual([]);
	expect(f.target.textContent).toBe('');
});

test('a known fork can demand its explicit original even when that original has no local row', async () => {
	const f = fixture('note', [item(id(1), 'Copy', { forkOf: id(3) })], id(1));
	try {
		await settle();
		expect(f.reads.map((r) => r.op.entry).sort()).toEqual([id(1), id(3)]);
		expect(f.calls.map((c) => c.entries)).toContainEqual([id(3)]);
		for (const read of f.reads) read.resolve({ refused: 'NoEntry' });
		await settle();
	} finally { await f.close(); }
});
