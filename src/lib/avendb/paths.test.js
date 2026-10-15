// @ts-nocheck — plain JS
// Records inside records as the page words and walks them (./paths.js): places at any depth in words, a write's
// changes in words, where two lines clash under a row, the fields a share's rules may name, and links.
// Run: bun test src/lib/avendb/paths.test.js
import { expect, test } from 'bun:test';
import {
	at,
	changeWords,
	clashes,
	fieldPaths,
	isLink,
	isLinks,
	isRows,
	pathWords,
	trailQuery,
	valueWords
} from './paths.js';

const hex = (n) => n.toString(16).padStart(64, '0');

test('a place reads in words at any depth', () => {
	expect(pathWords([])).toBe('anything');
	expect(pathWords(['status'])).toBe('its status');
	expect(pathWords(['blocks', { id: 2 }])).toBe('row 2 of its blocks');
	expect(pathWords(['nodes', { id: 1 }, 'kids', { id: 11 }, 'text'])).toBe(
		'the text of row 11 of the kids of row 1 of its nodes'
	);
	expect(pathWords(['nodes', '*', 'kids', '*', 'text'])).toBe('the text of any row of the kids of any row of its nodes');
	expect(pathWords(['blocks', '*', '*'])).toBe('any field of any row of its blocks');
	expect(pathWords(['blocks', { id: 2, copy: 1 }])).toBe('row 2 (its copy 2) of its blocks');
});

test('a write’s changes read in words', () => {
	const deep = ['nodes', { id: 1 }, 'kids', { id: 11 }, 'text'];
	expect(changeWords({ set: deep, value: 'North bed' })).toBe(
		'set the text of row 11 of the kids of row 1 of its nodes to “North bed”'
	);
	expect(changeWords({ unset: ['due'] })).toBe('took out its due');
	expect(changeWords({ rows: ['nodes', { id: 1 }, 'kids'], keys: [{ id: 12 }, { id: 11 }] })).toBe(
		'the kids of row 1 of its nodes: rows 12, 11'
	);
	expect(changeWords({ rows: 'nodes', keys: [] })).toBe('emptied its nodes');
	expect(changeWords({ rows: 'nodes', keys: null })).toBe('took out the rows of its nodes');
});

test('two lines clash where both changed one place differently, at any depth under the row', () => {
	const row = (north, south, beans) => ({
		id: 1,
		text: 'Beds',
		kids: [
			{ id: 11, text: north, kids: [{ id: 111, text: beans }] },
			{ id: 12, text: south, kids: [] }
		]
	});
	const base = row('North', 'South', 'Beans');
	// both changed the north bed's text, each its own way; one changed the beans, the other the south bed: no clash
	const ours = row('North bed', 'South', 'Runner beans');
	const theirs = row('Northern bed', 'South bed', 'Beans');
	expect(clashes(['nodes', { id: 1 }], base, ours, theirs)).toEqual([['nodes', { id: 1 }, 'kids', { id: 11 }, 'text']]);
	// one took the row out, the other changed it: the row itself
	expect(clashes(['nodes', { id: 1 }], base, null, ours)).toEqual([['nodes', { id: 1 }]]);
	// a row only one side added, and the other side also added with other words
	const added = (text) => ({ ...base, kids: [...base.kids, { id: 13, text }] });
	expect(clashes(['nodes', { id: 1 }], base, added('East'), added('West'))).toEqual([
		['nodes', { id: 1 }, 'kids', { id: 13 }, 'text']
	]);
});

test('a share’s rules may name fields at any depth, a shape of its own shape a few lists down', () => {
	const outline = {
		$defs: {
			node: {
				type: 'object',
				properties: {
					id: { type: 'integer' },
					text: { type: 'string' },
					done: { type: 'boolean' },
					kids: { type: 'array', items: { $ref: '#/$defs/node' } }
				},
				required: ['id']
			}
		},
		properties: { kind: { const: 'outline' }, nodes: { type: 'array', items: { $ref: '#/$defs/node' } } }
	};
	const fields = fieldPaths(outline, 2);
	const named = fields.map((f) => f.path.join('.'));
	expect(named).toEqual([
		'nodes',
		'nodes.*.text',
		'nodes.*.done',
		'nodes.*.kids',
		'nodes.*.kids.*.text',
		'nodes.*.kids.*.done',
		'nodes.*.kids.*.kids'
	]);
	expect(fields.find((f) => f.path.join('.') === 'nodes.*.done').values).toEqual([true, false]);
	expect(fields.filter((f) => f.rows).length).toBe(3);
});

test('links and rows are told apart from values, and walked', () => {
	const link = { vault: hex(1), entry: hex(2) };
	expect([isLink(link), isLink({ ...link, row: ['nodes', { id: 1 }], at: [hex(3)] })]).toEqual([true, true]);
	expect([isLink({ ...link, colour: 'red' }), isLink({ vault: 'x', entry: hex(2) })]).toEqual([false, false]);
	expect([isLinks([link, link]), isLinks([]), isLinks([link, 'x'])]).toEqual([true, false, false]);
	expect([isRows([]), isRows([{ id: 1 }]), isRows([{ id: 'x' }]), isRows('x')]).toEqual([true, true, false, false]);
	expect(valueWords({ ...link, row: ['nodes', { id: 1 }] })).toBe(`a link to row 1 of its nodes of entry ${hex(2).slice(0, 8)}`);
	const shown = { friend: { ...link, to: { name: 'Bo', notes: [link, { ...link, empty: 'NoEntry' }] } } };
	expect(at(shown, ['friend', { to: true }, 'name'])).toBe('Bo');
	expect(at(shown, ['friend', { to: true }, 'notes', 1, 'empty'])).toBe('NoEntry');
	expect(at(shown, ['friend', { to: true }, 'notes', 0, { to: true }])).toBeUndefined();
	expect(at({ nodes: [{ id: 1, kids: [{ id: 11, text: 'x' }] }] }, ['nodes', { id: 1 }, 'kids', { id: 11 }, 'text'])).toBe('x');
});

test('a trail through rows and links asks for the links it follows, no deeper than it goes', () => {
	expect(trailQuery([])).toEqual({ follow: [], depth: 1 });
	// rows alone follow nothing, and read a level down below the last
	expect(trailQuery(['nodes', { id: 1 }, 'kids', { id: 11 }])).toEqual({ follow: [], depth: 3 });
	// a link in a row, then a list of links in the record it leads to, then the same field again: each place once
	const trail = ['cards', { id: 1 }, 'owner', { to: true }, 'notes', 2, { to: true }, 'owner', { to: true }];
	expect(trailQuery(trail)).toEqual({ follow: [['cards', { id: 1 }, 'owner'], ['notes'], ['owner']], depth: 5 });
	expect(trailQuery(['friend', { to: true }, 'friend', { to: true }])).toEqual({ follow: [['friend']], depth: 3 });
});
