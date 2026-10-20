// @ts-nocheck — plain JS
// Flows and their functions (./flows.js, ./functions.js): moving a post through the content flow runs the built-in
// Publish and Unpublish, and the device makes only what a function may ask for: changes to the entry moved, its posts,
// its pictures and the entries it created, and Public shares of those by their ids. A function that asks for more, or
// whose code the one checker refuses, makes nothing.
// Run: bun test src/lib/avendb/flows.test.js
import { plugin } from 'bun';
import { describe, expect, test } from 'bun:test';

// ./article.js lists the site's blog posts by Vite's import.meta.glob, which bun has not: here it lists none
plugin({
	name: 'no-blog-posts',
	setup(build) {
		build.onLoad({ filter: /\/avendb\/article\.js$/ }, async ({ path }) => ({
			contents: (await Bun.file(path).text()).replace(/import\.meta\.glob\([^)]*\)/g, '({})'),
			loader: 'js'
		}));
	}
});
const { CONTENT, FUNCTION, FUNCTIONS, functionsOf, moving, stageTag } = await import('./flows.js');
const { refusal, runFunction } = await import('./functions.js');

const id = (c) => c.repeat(64);
const [ME, CITY, SERVER, ALICE] = [id('1'), id('2'), id('3'), id('4')];
const [POST, PIC, OTHER, NOTE] = [id('a'), id('b'), id('c'), id('d')];
const PICTURE = `${id('e')}.jpg`;
const PUBLISHED = stageTag('content', 'published');
const DRAFT = stageTag('content', 'draft');

const vault = (vid, kind, owner, devices = []) => ({ id: vid, kind, name: null, owners: owner ? [{ vault: owner }] : [], devices });
const entry = (e) => ({ vault: CITY, kind: 'record', deleted: false, tags: [], public: false, writers: [ME], ...e });

/**
 * A world as the device shows it: the person's vault, the seed their claim founded (Maia City and its server), a
 * vault of someone else's, and in Maia City a post that shows one picture, that picture, another and a note; `fns`
 * are function records each vault holds besides.
 */
function world({ post = {}, fns = {} } = {}) {
	const held = Object.entries(fns).flatMap(([v, list]) =>
		list.map((f, i) => entry({ entry: `${v.slice(0, 8)}${String(i).padStart(56, '0')}`, vault: v, type: FUNCTION, record: f }))
	);
	return {
		mine: ME,
		vaults: [vault(ME, 'human'), vault(CITY, 'coop', ME), vault(SERVER, 'aven', CITY, [{ id: 'server' }]), vault(ALICE, 'human')],
		shares: [],
		entries: [
			entry({ entry: POST, type: 'post', title: 'A post', text: `Look.\n\n![a picture](${PICTURE})`, tags: [DRAFT], ...post }),
			entry({ entry: PIC, type: 'file', title: PICTURE, files: [{}] }),
			entry({ entry: OTHER, type: 'file', title: `${id('f')}.jpg`, files: [{}] }),
			entry({ entry: NOTE, type: 'note', title: 'A note', text: 'private' }),
			...held
		]
	};
}

/** a function of the content flow that runs as a post enters Published, with code `code` */
const fn = (name, code) => ({ kind: 'function', name, about: '', on: 'enter', flow: 'content', stage: 'published', code, enabled: true, tags: [] });
/** moving the post to `to`, the functions `fns` of each vault held besides the app's */
const move = (to, o) => {
	const w = world(o);
	return moving(w, ME, w.entries[0], CONTENT, to);
};

describe('the built-in Publish and Unpublish', () => {
	test('publishing: the Public share on the stage tag, the tag swapped, and the picture it shows tagged too', async () => {
		const { ops, errors } = await move('published');
		expect(errors).toEqual([]);
		expect(ops).toEqual([
			{ op: 'share', over: CITY, who: 'everyone', level: 'Public', what: { tag: PUBLISHED }, as: ME },
			{ op: 'tag', entry: POST, add: [PUBLISHED], remove: [DRAFT], as: ME },
			{ op: 'tag', entry: PIC, add: [PUBLISHED], as: ME }
		]);
	});
	test('taking it off: the tag swapped back, and the picture only it shows untagged', async () => {
		const w = world({ post: { tags: [PUBLISHED] } });
		w.entries[1].tags = [PUBLISHED];
		const { ops, errors } = await moving(w, ME, w.entries[0], CONTENT, 'draft');
		expect(errors).toEqual([]);
		expect(ops).toEqual([
			{ op: 'tag', entry: POST, add: [DRAFT], remove: [PUBLISHED], as: ME },
			{ op: 'tag', entry: PIC, remove: [PUBLISHED], as: ME }
		]);
	});
	test('their code passes the one checker', () => {
		for (const f of FUNCTIONS) expect([f.name, refusal(f.code)]).toEqual([f.name, '']);
	});
});

describe('a function asks for its own slice, and nothing wider', () => {
	/** the ops `code` asks for as the post is published, between the move's own two and Publish's one, and why not */
	const asking = async (code) => {
		const { ops, errors } = await move('published', { fns: { [CITY]: [fn('Mine', code)] } });
		expect(ops.at(-1)).toEqual({ op: 'tag', entry: PIC, add: [PUBLISHED], as: ME });
		return { asked: ops.slice(2, -1), errors };
	};
	const returning = (ops) => `export function run(event) { return ${JSON.stringify(ops)}; }`;

	test('a Public share of the post, its picture and the posts about it, by their ids', async () => {
		const { asked, errors } = await asking('export function run(e) { return [{ op: "share", who: "everyone", level: "Public", what: { entry: [e.item.entry, ...e.pictures] } }]; }');
		expect(errors).toEqual([]);
		expect(asked).toEqual([{ op: 'share', over: CITY, who: 'everyone', level: 'Public', what: { entry: [POST, PIC] }, as: ME }]);
	});
	test('an entry it creates, changed and shared by its $n, counted from the ops before it', async () => {
		const code = returning([
			{ op: 'create', vault: ALICE, type: 'note', value: { title: 'made' } },
			{ op: 'tag', entry: '$0', add: ['made'] },
			{ op: 'share', who: 'everyone', level: 'Public', what: { entry: ['$0'] } }
		]);
		const { asked, errors } = await asking(code);
		expect(errors).toEqual([]);
		expect(asked).toEqual([
			{ op: 'create', vault: CITY, type: 'note', value: { title: 'made' }, as: ME },
			{ op: 'tag', entry: '$2', add: ['made'], as: ME },
			{ op: 'share', over: CITY, who: 'everyone', level: 'Public', what: { entry: ['$2'] }, as: ME }
		]);
	});

	const WIDER = {
		'the whole vault (no what)': { op: 'share', who: 'everyone', level: 'Public' },
		'the whole vault (everything)': { op: 'share', who: 'everyone', level: 'Public', what: 'everything' },
		'the whole vault (all of nothing)': { op: 'share', who: 'everyone', level: 'Public', what: { all: [] } },
		'every entry of a tag': { op: 'share', who: 'everyone', level: 'Public', what: { tag: DRAFT } },
		'every entry of a type': { op: 'share', who: 'everyone', level: 'Public', what: { type: ['note'] } },
		'the entry and a tag besides': { op: 'share', who: 'everyone', level: 'Public', what: { entry: [POST], tag: 'x' } },
		'its entry or a type': { op: 'share', who: 'everyone', level: 'Public', what: { any: [{ entry: [POST] }, { type: ['note'] }] } },
		'an entry the move does not concern': { op: 'share', who: 'everyone', level: 'Public', what: { entry: [POST, NOTE] } },
		'a picture the post does not show': { op: 'share', who: 'everyone', level: 'Public', what: { entry: [OTHER] } },
		'no entry at all': { op: 'share', who: 'everyone', level: 'Public', what: { entry: [] } },
		'an entry by a $n that created nothing': { op: 'share', who: 'everyone', level: 'Public', what: { entry: ['$0'] } },
		'a share to a vault': { op: 'share', who: { vault: ALICE }, level: 'Public', what: { entry: [POST] } },
		'a share at another level': { op: 'share', who: 'everyone', level: 'Editor', what: { entry: [POST] } }
	};
	for (const [what, op] of Object.entries(WIDER))
		test(`a share of ${what} is refused, and the function makes nothing`, async () => {
			const { asked, errors } = await asking(returning([{ op: 'tag', entry: POST, add: ['fine'] }, op]));
			expect(asked).toEqual([]);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatch(/^Mine: a share it asks for is /);
		});

	const OUTSIDE = {
		'an op it may not ask for': [{ op: 'revoke', share: id('9') }],
		'a merge': [{ op: 'merge', entry: POST, from: id('9'), into: null }],
		'a change of an entry the move does not concern': [{ op: 'set', entry: NOTE, path: ['title'], value: 'mine now' }],
		'a tag on a picture the post does not show': [{ op: 'tag', entry: OTHER, add: [PUBLISHED] }],
		'a change by a $n no op of its own created': [{ op: 'set', entry: '$0', path: ['title'], value: 'x' }],
		'a change by a $n of a create after it': [
			{ op: 'tag', entry: '$1', add: ['x'] },
			{ op: 'create', type: 'note', value: {} }
		],
		'a create that brings a file': [{ op: 'create', type: 'file', value: {}, file: { len: 1 } }]
	};
	for (const [what, list] of Object.entries(OUTSIDE))
		test(`${what} is refused, and the function makes nothing`, async () => {
			const { asked, errors } = await asking(returning(list));
			expect(asked).toEqual([]);
			expect(errors).toHaveLength(1);
		});
});

describe('function code is checked as it loads', () => {
	for (const [what, code] of Object.entries({
		'one that imports': 'import x from "y"; export function run(e) { return []; }',
		'one that imports later': 'export async function run(e) { const m = await import("os"); return []; }',
		'one that requires': 'const fs = require("fs"); export function run(e) { return []; }',
		'one that exports no run': 'export function start(e) { return []; }',
		'one that is not text': 42
	}))
		test(`${what} is refused, and never runs`, async () => {
			expect(refusal(code)).not.toBe('');
			const r = await runFunction(code, { pictures: [] });
			expect(r.ops).toEqual([]);
			expect(r.error).toBe(refusal(code));
		});
	test('a move names the function the checker refused, and makes the rest', async () => {
		const { ops, errors } = await move('published', { fns: { [CITY]: [fn('Imports', 'import x from "y"; export function run(e) { return []; }')] } });
		expect(ops).toHaveLength(3);
		expect(errors).toEqual([expect.stringMatching(/^Imports: its code imports a module/)]);
	});
});

describe('a function runs on the logic engine its record names', () => {
	const code = 'export function run(e) { return []; }';
	test('one that names a frozen logic engine, or none, runs', async () => {
		expect(await runFunction(code, {}, { host: 'logic', version: 2 })).toEqual({ ops: [] });
		expect(await runFunction(code, {})).toEqual({ ops: [] });
	});
	test('one made for another host, or a logic engine this page does not have, runs nowhere', async () => {
		expect((await runFunction(code, {}, { host: 'view', version: 1 })).error).toMatch(/made for the view engine/);
		expect((await runFunction(code, {}, { host: 'logic', version: 999 })).error).toMatch(/logic engine 999/);
	});
});

describe('whose functions run', () => {
	test("the entry's own vault's and Maia City's, the seed the person's claim founded; never another vault's", () => {
		const w = world({ fns: { [CITY]: [fn('The city’s', 'export const run = () => [];')], [ALICE]: [fn('Alice’s', 'export const run = () => [];')] } });
		const names = (v) => functionsOf(w, v, 'content').map((f) => f.name);
		expect(names(CITY)).toEqual(['The city’s', ...FUNCTIONS.map((f) => f.name)]);
		expect(names(ME)).toEqual(['The city’s', ...FUNCTIONS.map((f) => f.name)]);
		expect(names(ALICE)).toEqual(['Alice’s', 'The city’s', ...FUNCTIONS.map((f) => f.name)]);
	});
	test("a coop the person's vault doesn't own is no seed: its functions run only on its own entries", () => {
		const w = world({ fns: { [CITY]: [fn('The city’s', 'export const run = () => [];')] } });
		w.vaults[1].owners = [{ vault: ALICE }];
		expect(functionsOf(w, ME, 'content').map((f) => f.name)).toEqual(FUNCTIONS.map((f) => f.name));
	});
});
