// @ts-nocheck — plain JS
// What the rules made of each file (./made.js), as the Library's table lists them under it: the made files of each
// rule's newest done task, every rule's newest step, a step that makes files still to come, deleted files left out.
// Run: bun test src/lib/avendb/made.test.js
import { expect, test } from 'bun:test';
import { familyOf, roleOf, stateOf } from './made.js';

const file = (entry, tags = [], extra = {}) => ({ entry, vault: 'v', kind: 'file', type: 'file', tags, deleted: false, files: [], ...extra });
const task = (entry, rule, from, status, outputs = [], at = 1) => ({
	entry,
	vault: 'v',
	type: 'task',
	kind: 'record',
	tags: [],
	deleted: false,
	record: { kind: 'task', rule, status, inputs: [{ name: 'original', entry: from, at: [] }], outputs, at }
});

test('a film keeps its proxy, still and preview, in the order its steps run', () => {
	const world = {
		entries: [
			file('film', ['media:original']),
			file('proxy', ['media:proxy']),
			file('still', ['media:still']),
			file('preview', ['media:preview']),
			task('t3', 'still', 'film', 'done', ['still', 'preview']),
			task('t1', 'probe', 'film', 'done'),
			task('t2', 'proxy', 'film', 'done', ['proxy'])
		]
	};
	const f = familyOf(world);
	expect(f.made.get('film').map((m) => [m.entry.entry, m.role])).toEqual([
		['proxy', 'Proxy · ACEScct'],
		['still', 'Grading still · ACEScct'],
		['preview', 'Preview · Rec.709']
	]);
	expect(f.steps.get('film').map((s) => s.name)).toEqual(['Probe', 'Proxy', 'Grading still']);
	expect(f.of.get('preview')).toBe('film');
});

test('the newest step says where it is; what it made comes from the newest done one', () => {
	const world = {
		entries: [
			file('film', ['media:original']),
			file('old', ['media:proxy']),
			task('a', 'proxy', 'film', 'done', ['old'], 1),
			task('b', 'proxy', 'film', 'claimed', [], 2),
			task('c', 'transcript', 'film', 'held', [], 1)
		]
	};
	const f = familyOf(world);
	const [proxy, words] = f.steps.get('film');
	expect([proxy.rule, proxy.done, proxy.makes, stateOf(proxy.task)]).toEqual(['proxy', false, true, 'being made']);
	expect([words.rule, words.makes, stateOf(words.task)]).toEqual(['transcript', false, 'held for you']);
	expect(f.made.get('film').map((m) => m.entry.entry)).toEqual(['old']);
});

test('a deleted made file and a task of no file are left out', () => {
	const world = {
		entries: [
			file('film', ['media:original']),
			file('gone', ['media:proxy'], { deleted: true }),
			{ entry: 'cut', vault: 'v', kind: 'record', type: 'cut', tags: [], deleted: false },
			file('delivery', ['media:delivery']),
			task('a', 'proxy', 'film', 'done', ['gone']),
			task('b', 'render', 'cut', 'done', ['delivery'])
		]
	};
	const f = familyOf(world);
	expect(f.made.get('film')).toBeUndefined();
	expect(f.of.has('delivery')).toBe(false);
	expect(f.steps.has('cut')).toBe(false);
});

test('a made file without a role tag is named by its rule', () => {
	expect(roleOf(file('x', ['media:transcript']), 'transcript')).toBe('Transcript');
});
