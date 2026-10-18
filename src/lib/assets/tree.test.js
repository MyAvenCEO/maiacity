// An asset's parts tree (./tree.js), as the viewers list it: its own parts by assembly, each whole asset it carries
// apart, named as its host's catalog names it.
// Run: bun test src/lib/assets/tree.test.js
import { expect, test } from 'bun:test';
import { treeOf } from './tree.js';

const catalog = {
	assemblies: [
		{ id: 'frame', label: 'Frame' },
		{ id: 'bed', label: 'Bed' },
		{ id: 'cube-frame', label: 'Power Cube: Frame' },
		{ id: 'cube-engine', label: 'Power Cube: Engine' }
	],
	parts: [
		{ id: 'rails', label: 'Rails', assembly: 'frame' },
		{ id: 'tailgate', label: 'Tailgate', assembly: 'bed', ref: 'machines/pickup@2' },
		{ id: 'cage', label: 'Cage', assembly: 'cube-frame', ref: 'machines/powercube@3' },
		{ id: 'motor', label: 'Motor', assembly: 'cube-engine', ref: 'machines/powercube@3' }
	]
};

test('its own parts by assembly, then each asset it carries, named as its host names it, with its page', () => {
	const tree = treeOf(catalog, 'machines/pickup@2', (ref) => `#${ref}`);
	expect(tree.own.map((t) => [t.a.id, t.parts.map((p) => p.id)])).toEqual([
		['frame', ['rails']],
		['bed', ['tailgate']]
	]);
	expect(tree.units).toHaveLength(1);
	const [u] = tree.units;
	expect([u.ref, u.name, u.href, u.parts.map((p) => p.id), u.groups.map((g) => g.a.id)]).toEqual([
		'machines/powercube@3',
		'Power Cube',
		'#machines/powercube@3',
		['cage', 'motor'],
		['cube-frame', 'cube-engine']
	]);
});

test('no catalog, or one without parts, is an empty tree; a unit its host names otherwise goes by its ref', () => {
	expect(treeOf(null, undefined)).toEqual({ own: [], units: [] });
	expect(treeOf({ assemblies: [], parts: [] }, undefined)).toEqual({ own: [], units: [] });
	const mixed = { assemblies: [{ id: 'a', label: 'Cube: A' }, { id: 'b', label: 'Other: B' }], parts: [{ id: 'x', assembly: 'a', ref: 'r@1' }, { id: 'y', assembly: 'b', ref: 'r@1' }] };
	expect(treeOf(mixed, 'host@1').units.map((u) => [u.name, u.href])).toEqual([['r@1', null]]);
});
