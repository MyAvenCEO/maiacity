// @ts-nocheck — plain JS
// Manifests (./manifests.js): what a page needs, declared as a composite of manifests whose leaves are entries and
// queries, walked once per page, the kernel first.
import { expect, test } from 'bun:test';
import { MANIFEST_V1, bringDeclared, covers, entriesOf, leavesFor, namedBy } from './manifests.js';
import { MANIFESTS } from '../../../src/lib/avendb/manifests.js';
import { MAIA_CITY } from './anchor.js';

const id = (i) => i.toString(16).padStart(64, '0');
const m = (o) => ({ kind: 'manifest', title: o.id, ...o });

const kernel = m({ id: 'kernel', routes: ['*'], priority: 'high', parts: [{ query: { type: ['capgroup'] } }] });
const world = m({ id: 'world', parts: [{ manifest: 'kernel' }, { entry: id(7), follow: 1 }] });
const game = m({ id: 'game', routes: ['/app/games/x/'], parts: [{ manifest: 'kernel' }, { manifest: 'world' }, { query: { tags: ['game:x'] }, limit: 1 }] });
// a cycle comes round and ends
const loop = m({ id: 'loop', routes: ['/loop/*'], parts: [{ manifest: 'loop' }, { entry: id(9) }] });

test('a route covers its own path, a path under it with *, and * every path', () => {
	expect(covers('/app/', '/app/')).toBe(true);
	expect(covers('/app/', '/app/x/')).toBe(false);
	expect(covers('/app/*', '/app/x/')).toBe(true);
	expect(covers('*', '/anything/')).toBe(true);
});

test('the walk holds each manifest once, each leaf once at its highest priority, the kernel first', () => {
	const leaves = leavesFor([kernel, world, game, loop], '/app/games/x/');
	expect(leaves.map((l) => [l.rank, l.leaf.entry ?? l.leaf.query])).toEqual([
		[0, { type: ['capgroup'] }],
		[1, id(7)],
		[1, { tags: ['game:x'] }]
	]);
	// another page: the kernel alone
	expect(leavesFor([kernel, world, game], '/universe/').length).toBe(1);
	expect(leavesFor([kernel, loop], '/loop/a/').map((l) => l.leaf.entry ?? 'q')).toEqual(['q', id(9)]);
	// no manifests: nothing
	expect(leavesFor([], '/app/')).toEqual([]);
});

test('queries read the rows newest first, at most their limit, and only rows of their types and tags', () => {
	const rows = [
		{ entry: id(1), type: 'config', tags: ['game:x'], created: 1 },
		{ entry: id(2), type: 'view', tags: ['game:x'], created: 3 },
		{ entry: id(3), type: 'capgroup', tags: [], created: 2 },
		{ entry: id(4), type: 'view', tags: ['game:y'], created: 9 }
	];
	expect(entriesOf(leavesFor([kernel, world, game], '/app/games/x/'), rows)).toEqual([id(3), id(7), id(2)]);
});

test('a record names the entries of its pins and its vault refs, in JSON held in a string too', () => {
	const rec = { world: { entry: id(5), at: ['h'] }, timeline: JSON.stringify({ clips: [{ src: `vault:${id(0)}/${id(6)}@h` }] }) };
	expect(namedBy(rec).sort()).toEqual([id(5), id(6)]);
	expect(namedBy({ entry: 'short' })).toEqual([]);
});

test('a device brings what the manifests declare a priority at a time, then what the brought records name', async () => {
	const asked = [];
	const records = { [id(7)]: { pin: { entry: id(8), at: [] } } };
	const d = {
		run: async (op) => {
			if (op.op === 'query' && op.where?.type?.[0] === 'manifest') return { ok: { rows: [kernel, world, game].map((record) => ({ record })) } };
			if (op.op === 'query') return { ok: { rows: [{ entry: id(3), type: 'capgroup', tags: [] }, { entry: id(2), type: 'view', tags: ['game:x'], created: 1 }] } };
			if (op.op === 'get') return { ok: { record: records[op.entry] ?? null } };
			return { ok: {} };
		}
	};
	const fetch = async () => { throw new Error('Manifest discovery must not use HTTP'); };
	const got = await bringDeclared('/app/games/x/', { device: d, bring: async (ids) => asked.push(ids), fetch });
	expect(asked).toEqual([[id(3)], [id(7)], [id(2)], [id(8)]]);
	expect(got).toEqual([id(3), id(7), id(2), id(8)]);
});

test('a vault that holds no manifest brings nothing more', async () => {
	const d = { run: async () => ({ ok: { rows: [] } }) };
	const fetch = async () => new Response('{"entries":[]}');
	expect(await bringDeclared('/app/', { device: d, bring: async () => { throw new Error('nothing to bring'); }, fetch })).toEqual([]);
});

test("the repo's manifests hold the kernel, each held manifest exists, and each fits the schema's shape", () => {
	const ids = new Set(MANIFESTS.map((x) => x.id));
	expect(ids.size).toBe(MANIFESTS.length);
	expect(MANIFESTS.find((x) => x.id === 'kernel').routes).toEqual(['*']);
	const schema = JSON.parse(MANIFEST_V1);
	const pattern = new RegExp(schema.properties.id.pattern);
	for (const x of MANIFESTS) {
		expect(pattern.test(x.id)).toBe(true);
		for (const p of x.parts) if (p.manifest) expect(ids.has(p.manifest)).toBe(true);
		for (const k of schema.required) expect(x[k]).toBeDefined();
	}
	// every game's page walks to the kernel and its own code
	const leaves = leavesFor(MANIFESTS, '/app/games/sandbox-5/');
	expect(leaves[0].leaf.query.type).toContain('capgroup');
	expect(leaves.some((l) => l.leaf.query?.tags?.[0] === 'game:sandbox-5')).toBe(true);
});

test('duplicate feed and local rows do not consume a visible query window', () => {
	const rows = [{ entry: id(1), created: 3 }, { entry: id(1), created: 3 }, { entry: 'invalid', created: 2 }, { entry: id(2), created: 1 }];
	expect(entriesOf([{ leaf: { query: {}, limit: 2 } }], rows)).toEqual([id(1), id(2)]);
});

test('each reference root keeps its own follow depth, including already brought shared entries', async () => {
	const manifest = m({ id: 'depths', routes: ['*'], parts: [{ entry: id(1), follow: 1 }, { entry: id(2), follow: 3 }, { entry: id(5) }] });
	const links = { 1: 3, 2: 5, 3: 4, 5: 6, 6: 7, 7: 8 };
	const read = [], brought = [];
	const d = { run: async (op) => {
		if (op.op === 'query') return { ok: { rows: [{ record: manifest }] } };
		read.push(op.entry);
		return { ok: { record: { entry: id(links[parseInt(op.entry, 16)] ?? 99) } } };
	} };
	await bringDeclared('/', { device: d, fetch: null, bring: async (ids) => brought.push(...ids) });
	expect(brought).toEqual([id(1), id(2), id(5), id(3), id(6), id(7)]);
	expect(read).not.toContain(id(3));
	expect(brought).not.toContain(id(8));
});

test('an abandoned view issues no later priority batch or reference reads', async () => {
	const controller = new AbortController();
	const manifest = m({ id: 'first', priority: 'high', routes: ['*'], parts: [{ entry: id(1), follow: 2 }] });
	const later = m({ id: 'later', routes: ['*'], parts: [{ entry: id(2) }] });
	const reads = [], brings = [];
	const d = { run: async (op) => { reads.push(op); return { ok: { rows: [manifest, later].map((record) => ({ record })) } }; } };
	await expect(bringDeclared('/', { device: d, signal: controller.signal, fetch: null, bring: async (ids) => { brings.push(ids); controller.abort(); } })).rejects.toThrow();
	expect(brings).toEqual([[id(1)]]);
	expect(reads.filter((o) => o.op === 'get')).toEqual([]);
});

test('film shot references participate in manifest dependency traversal', () => {
 expect(namedBy({ timeline: JSON.stringify({ clips: [{ shot: `shot:${id(5)}` }] }) })).toEqual([id(5)]);
});
test('missing manifests never fall back to HTTP discovery', async () => {
 let fetched = false;
 const result = await bringDeclared('/app/studio/', { device: { run: async () => ({ ok: { rows: [] } }) }, bring: async () => {}, fetch: async () => { fetched = true; } });
 expect(result).toEqual([]);
 expect(fetched).toBe(false);
});


test('following a timeline prioritizes audio file entries named by aven roots', async () => {
	const root = 'a'.repeat(64);
	const timeline = id(10), audio = id(11);
	const d = { run: async op => {
		if (op.op === 'query') return { ok: { rows: [{ record: m({ id: 'film', routes: ['/studio/'], parts: [{ entry: timeline, follow: 1 }] }) }] } };
		if (op.op === 'get') return { ok: { record: { clips: JSON.stringify([{ hash: `aven:${root}:100:84:audio%2Fmpeg` }]) } } };
		if (op.op === 'world_summary') return { ok: { vaults: [{ id: MAIA_CITY }] } };
        if (op.op === 'entry_views') {
            expect(op.types).toEqual(['file']);
            return { ok: { rows: [{ entry: audio, files: [{ root }] }] } };
        }
        throw new Error('Unexpected full-world read');
	} };
	const brought = [];
	await bringDeclared('/studio/', { device: d, bring: async ids => brought.push(...ids) });
	expect(brought).toEqual([timeline, audio]);
});

test('manifest diagnostics report scheduling without claiming delivery or retaining IDs', async () => {
 const { manifestDiagnostics } = await import('./manifests.js');
 await bringDeclared('/private/route/', { device: { run: async () => ({ ok: { rows: [] } }) }, bring: async () => {} });
 const state = manifestDiagnostics();
 expect(state.pending).toBe(0);
 expect(state.runs.at(-1).state).toBe('scheduled');
 expect(state.runs.at(-1).requested).toBe(0);
 expect(JSON.stringify(state)).not.toContain('/private/route/');
});

test('known view dependencies are prioritized while unrelated query history is withheld', async () => {
 const controller = new AbortController();
 let release, hinted;
 const withheld = new Promise(resolve => { release = resolve; });
 const published = new Promise(resolve => { hinted = resolve; });
 const hints = [], brought = [], selectors = [];
 const manifest = m({ id: 'partial', routes: ['*'], parts: [{ entry: id(71) }, { query: { type: ['note'] } }] });
 const device = { run: async op => {
  if (op.op === 'query' && op.where?.type?.[0] === 'manifest') return { ok: { rows: [{ record: manifest }] } };
  if (op.op === 'query') return withheld;
  if (op.op === 'get' && op.entry === id(71)) return { ok: { record: { title: 'Useful local view' } } };
  throw new Error('Unexpected broad or remote read');
 } };
 const running = bringDeclared('/partial/', { device, signal: controller.signal,
  prioritize: async (ids, queries) => { hints.push(...ids); selectors.push(...queries); hinted(); }, bring: async ids => brought.push(...ids) });
 await Promise.race([published, new Promise((_, reject) => setTimeout(() => reject(new Error('demand blocked by unrelated history')), 100))]);
 expect(hints).toEqual([id(71)]);
 expect(selectors).toEqual([{ types: ['note'], vault: MAIA_CITY }]);
 expect((await device.run({ op: 'get', entry: id(71) })).ok.record.title).toBe('Useful local view');
 // Scheduling is not a claim of complete discovery or peer delivery.
 expect(brought).toEqual([id(71)]);
 const { manifestDiagnostics } = await import('./manifests.js');
 expect(manifestDiagnostics().pending).toBeGreaterThan(0);
 controller.abort();
 release({ ok: { rows: [{ entry: id(72), type: 'note' }] } });
 await expect(running).rejects.toThrow();
 expect(brought).toEqual([id(71)]);
 expect(hints).toEqual([id(71)]);
});

test('an unacknowledged demand lease cannot block canonical local query discovery', async () => {
 let queried;
 const discovered = new Promise(resolve => { queried = resolve; });
 let acknowledge;
 const waiting = new Promise(resolve => { acknowledge = resolve; });
 const manifest = m({ id: 'ack', routes: ['*'], parts: [{ entry: id(91) }, { query: { type: ['note'] } }] });
 const d = { run: async op => {
  if (op.where?.type?.[0] === 'manifest') return { ok: { rows: [{ record: manifest }] } };
  queried();
  return { ok: { rows: [{ entry: id(92), type: 'note' }] } };
 } };
 const brought = [];
 const done = bringDeclared('/ack/', { device: d, prioritize: () => waiting, bring: async ids => brought.push(...ids) });
 try {
  await Promise.race([discovered, new Promise((_, reject) => setTimeout(() => reject(new Error('query waited for demand acknowledgement')), 100))]);
  expect(await done).toEqual([id(91), id(92)]);
  expect(brought).toEqual([id(91), id(92)]);
 } finally { acknowledge(); }
});


test('high-rank dependencies finish before any lower-rank collection query starts', async () => {
 const order = [];
 const high = m({ id: 'high', priority: 'high', routes: ['*'], parts: [{ entry: id(1), follow: 1 }] });
 const low = m({ id: 'low', priority: 'low', routes: ['*'], parts: [{ query: { type: ['note'] } }] });
 const controller = new AbortController();
 const d = { run: async op => {
  if (op.where?.type?.[0] === 'manifest') return { ok: { rows: [high, low].map(record => ({record})) } };
  if (op.op === 'get') { order.push('follow'); return {ok:{record:{entry:id(2)}}}; }
  order.push('low-query'); controller.abort(); return {ok:{rows:[{entry:id(3),type:'note'}]}};
 } };
 await expect(bringDeclared('/', {device:d,signal:controller.signal,bring:async ids=>order.push(...ids)})).rejects.toThrow();
 expect(order).toEqual([id(1), 'follow', id(2), 'low-query']);
});


test('cancellation during a reference read prevents a subsequent broad file scan', async () => {
 const controller = new AbortController();
 let world = false;
 const manifest = m({id:'cancel-follow',routes:['*'],parts:[{entry:id(1),follow:1}]});
 const d = {run:async op=>{
  if(op.op==='query') return {ok:{rows:[{record:manifest}]}};
  if(op.op==='get') {controller.abort(); return {ok:{record:{audio:`aven:${id(2)}:100:84:audio`}}};}
  world=true; return {ok:{entries:[]}};
 }};
 await expect(bringDeclared('/',{device:d,signal:controller.signal,bring:async()=>{}})).rejects.toThrow();
 expect(world).toBe(false);
});

test('zero concrete IDs distinguishes missing catalog, unmatched route and active query discovery', async () => {
 const { manifestDiagnostics } = await import('./manifests.js');
 const cases = [
  { rows: [], expected: { catalog: 'local', heldManifests: 0, matchedLeaves: 0, typeDiscoveryHints: 0 } },
  { rows: [{ record: m({ id: 'other', routes: ['/other/'], parts: [{ query: { type: ['room'] } }] }) }], expected: { catalog: 'local', heldManifests: 1, matchedLeaves: 0, typeDiscoveryHints: 0 } },
  { rows: [{ record: m({ id: 'current', routes: ['*'], parts: [{ query: { type: ['room'] } }] }) }], expected: { catalog: 'local', heldManifests: 1, matchedLeaves: 1, queryLeaves: 1, typeDiscoveryHints: 1, localRows: 0 } }
 ];
 for (const c of cases) {
  let hints = [];
  const device = { run: async op => ({ ok: { rows: op.select ? [] : c.rows } }) };
  expect(await bringDeclared('/current/', { device, bring: async () => { throw new Error('No local IDs'); }, prioritize: (_ids, queries) => { hints = queries; } })).toEqual([]);
  const last = manifestDiagnostics().runs.at(-1);
  expect(last).toMatchObject({ requested: 0, state: 'scheduled', ...c.expected });
  expect(hints.length).toBe(c.expected.typeDiscoveryHints);
  expect(JSON.stringify(last)).not.toContain('/current/');
  expect(JSON.stringify(last)).not.toContain('room');
 }
});

test('a refused catalog is not reported as a successful empty local catalog', async () => {
 const { manifestDiagnostics } = await import('./manifests.js');
 await bringDeclared('/private/', { device: { run: async () => ({ refused: 'NoCap' }) }, bring: async () => {} });
 expect(manifestDiagnostics().runs.at(-1)).toMatchObject({ catalog: 'refused', heldManifests: 0, requested: 0 });
});

test('shipped cold game and Chat leaves provide typed discovery before local rows exist', async () => {
 for (const path of ['/app/chat/', '/app/games/sandbox-5/']) {
  const hints=[];
  const d={run:async op=>({ok:{rows:op.where?.type?.includes('manifest') ? MANIFESTS.map(record=>({record})) : []}})};
  await bringDeclared(path,{device:d,bring:async()=>{},prioritize:(_ids,queries)=>hints.push(...queries)});
  expect(hints.some(q=>q.types.includes(path.includes('chat')?'room':'config'))).toBe(true);
  expect(leavesFor(MANIFESTS,path).filter(l=>l.leaf.query).every(l=>l.leaf.query.type?.length>0)).toBe(true);
 }
});
