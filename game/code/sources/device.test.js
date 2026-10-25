// @ts-nocheck — plain JS
// A page's learned manifest (./device.js `learn`, `learned`, Samuel 2026-10-21: a device syncs first what its pages
// need): the entries a page read are kept per page on this browser, and a device opened on the page brings them first.
import { afterEach, expect, test } from 'bun:test';
import { AT_ONCE, bringEntries, learn, learned, useDevice } from './device.js';

const id = (i) => i.toString(16).padStart(64, '0');
const store = () => {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
};

afterEach(() => {
	useDevice(null);
	delete globalThis.localStorage;
});

test('a page keeps the entries it read, newest first, and a device opened on it brings them before anything else', async () => {
	globalThis.localStorage = store();
	learn([id(1), id(2)], '/app/worlds/room/');
	learn([id(3), id(1), 'not an id'], '/app/worlds/room/');
	expect(learned('/app/worlds/room/')).toEqual([id(3), id(1), id(2)]);
	expect(learned('/universe/')).toEqual([]);
	// what a page brings is learned too
	const asked = [];
	const d = { run: async (op) => (asked.push(op), op.op === 'query' ? { ok: { rows: [] } } : { ok: { new: 1, peers: 1, reached: true } }), read: async () => new Uint8Array() };
	await bringEntries([id(9)], d);
	expect(learned('')).toEqual([]);
	// a device opened on a page that read before brings those first, AT_ONCE at most
	globalThis.location = { pathname: '/app/worlds/room/' };
	const fetched = globalThis.fetch;
	globalThis.fetch = async () => new Response('{"entries":[]}');
	try {
		learn(Array.from({ length: AT_ONCE + 5 }, (_, i) => id(100 + i)));
		asked.length = 0;
		useDevice(d);
		await new Promise((r) => setTimeout(r, 10));
		const brings = asked.filter((o) => o.op === 'bring');
		expect(brings.length).toBe(1);
		expect(brings[0].entries.length).toBe(AT_ONCE);
	} finally {
		delete globalThis.location;
		globalThis.fetch = fetched;
	}
});

test('a browser that keeps nothing learns nothing, and the page reads on', async () => {
	globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
	learn([id(1)], '/x/');
	expect(learned('/x/')).toEqual([]);
});

test('cancelled demand preserves issued work but never starts another batch', async () => {
	const controller = new AbortController();
	const calls = [];
	const d = { run: async (op) => { calls.push(op); controller.abort(); return { ok: { new: 1, peers: 1, reached: true } }; } };
	const ids = Array.from({ length: AT_ONCE + 2 }, (_, i) => id(1000 - i));
	expect(await bringEntries(ids, d, { signal: controller.signal, path: '/old/' })).toBeNull();
	expect(calls.map((o) => o.entries)).toEqual([ids.slice(0, AT_ONCE)]);
});

test('navigation supersedes a slow manifest read without bringing its entries or mislearning them', async () => {
	globalThis.localStorage = store();
	globalThis.location = { pathname: '/old/' };
	const { useView } = await import('./device.js');
	let release;
	const pending = new Promise((resolve) => { release = resolve; });
	const calls = [];
	let queries = 0;
	const manifests = [
		{ kind: 'manifest', id: 'old', routes: ['/old/'], parts: [{ entry: id(1) }] },
		{ kind: 'manifest', id: 'new', routes: ['/new/'], parts: [{ entry: id(2) }] }
	];
	const result = { ok: { rows: manifests.map((record) => ({ record })) } };
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return ++queries === 1 ? pending : result;
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		const old = useView('/old/');
		await useView('/new/');
		release(result);
		await old;
		expect(calls.filter((o) => o.op === 'bring').map((o) => o.entries)).toEqual([[id(2)]]);
		expect(learned('/new/')).toEqual([id(2)]);
		expect(learned('/old/')).toEqual([]);
	} finally {
		delete globalThis.location;
	}
});

test('a capable node receives scoped priorities without an uncancellable legacy want', async () => {
	globalThis.location = { pathname: '/active/' };
	const { useView } = await import('./device.js');
	const calls = [];
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return { ok: { rows: [{ record: { kind: 'manifest', id: 'active', routes: ['*'], parts: [{ entry: id(7) }] } }] } };
		if (op.op === 'demand') return { ok: { accepted: true, lease_ms: 90000 } };
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		await useView('/active/');
		expect(calls.filter((op) => op.op === 'bring')).toEqual([]);
		useDevice(null);
		await new Promise((r) => setTimeout(r, 1));
		const priorities = calls.filter((op) => op.op === 'demand');
		expect(priorities.some(op => op.entries.includes(id(7)))).toBe(true);
		expect(priorities.at(-1).entries).toEqual([]);
		expect(priorities.at(-1).scope).toBe(priorities[0].scope);
		expect(priorities.at(-1).revision).toBeGreaterThan(priorities[0].revision);
	} finally { delete globalThis.location; }
});

test('an older node gets the original bring shape after rejecting demand', async () => {
	globalThis.location = { pathname: '/legacy/' };
	const { useView } = await import('./device.js');
	const calls = [];
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return { ok: { rows: [{ record: { kind: 'manifest', id: 'legacy', routes: ['*'], parts: [{ entry: id(8) }] } }] } };
		if (op.op === 'demand') return { refused: 'BadOp', why: 'unknown op' };
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		await useView('/legacy/');
		expect(calls.filter((op) => op.op === 'bring')).toEqual([{ op: 'bring', entries: [id(8)] }]);
	} finally { delete globalThis.location; }
});


test('an empty local catalog does not wait for an unfinished background bring', async () => {
	const { deviceRows, bringRows } = await import('./device.js');
	let finish;
	const blocked = new Promise(resolve => { finish = resolve; });
	const d = { run: async op => op.op === 'code' ? { ok: [] } : op.op === 'bring' ? blocked : { ok: {} } };
	useDevice(d);
	const sync = bringRows([{ entry: id(91) }]);
	const result = await Promise.race([deviceRows(['recipe']), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))]);
	finish({ ok: { new: 1 } });
	await sync;
	expect(result).toBeNull();
});

test('learned demand publishes before manifest discovery and closes on device replacement', async () => {
 const { useView } = await import('./device.js');
 globalThis.localStorage = store();
 globalThis.location = { pathname: '/fresh/' };
 learn([id(81)], '/fresh/');
 let release, publish;
 const withheld = new Promise(resolve => { release = resolve; });
 const published = new Promise(resolve => { publish = resolve; });
 const calls = [];
 const d = { run: async op => {
  calls.push(op);
  if (op.op === 'query') return withheld;
  if (op.op === 'demand') { publish(); return { ok: { accepted: true } }; }
  throw new Error('No transfer before discovery');
 } };
 try {
  useDevice(d);
  const pending = useView('/fresh/');
  await Promise.race([published, new Promise((_, reject) => setTimeout(() => reject(new Error('learned demand blocked')), 100))]);
  expect(calls.filter(op => op.op === 'demand')[0].entries).toEqual([id(81)]);
  useDevice(null);
  await Promise.resolve();
  expect(calls.filter(op => op.op === 'demand').at(-1).entries).toEqual([]);
  release({ ok: { rows: [{ record: { kind: 'manifest', id: 'late', routes: ['*'], parts: [{ entry: id(82) }] } }] } });
  await pending;
  expect(calls.filter(op => op.op === 'bring')).toEqual([]);
  expect(calls.filter(op => op.op === 'demand').flatMap(op => op.entries)).not.toContain(id(82));
 } finally { delete globalThis.location; }
});

test('explicit current-view dependencies precede a full learned lease without clearing the other hints', async () => {
 const { useView } = await import('./device.js');
 globalThis.localStorage = store();
 globalThis.location = { pathname: '/capacity/' };
 const hints = Array.from({ length: 512 }, (_, i) => id(1000 + i));
 const target = id(9999), calls = [];
 let release;
 const blocked = new Promise(resolve => { release = resolve; });
 const d = { run: async op => {
  calls.push(op);
  if (op.op === 'query') return blocked;
  if (op.op === 'demand') return { ok: { accepted: true } };
  return { ok: { new: 0, peers: 0, reached: false } };
 } };
 try {
  useDevice(d);
  const pending = useView('/capacity/');
  learn(hints, '/capacity/');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls.filter(op => op.op === 'demand').at(-1).entries).toEqual(hints);
  release({ ok: { rows: [{ record: { kind: 'manifest', id: 'current', routes: ['*'], parts: [{ entry: target }] } }] } });
  await pending;
  expect(calls.filter(op => op.op === 'demand').at(-1).entries).toEqual([target, ...hints.slice(0, 511)]);
 } finally { delete globalThis.location; }
});

for (const reply of [{ ok: { accepted: true } }, { refused: 'Denied' }]) {
 test(`manifest ranks do not await legacy history transfer: ${JSON.stringify(reply)}`, async () => {
  const { useView } = await import('./device.js');
  globalThis.localStorage = store();
  globalThis.location = { pathname: '/ranks/' };
  const calls = [];
  const d = { run: async op => {
   calls.push(op);
   if (op.op === 'demand') return reply;
   if (op.op === 'query') return { ok: { rows: [
    { record: { kind: 'manifest', id: 'first', routes: ['*'], priority: 'high', parts: [{ entry: id(21) }] } },
    { record: { kind: 'manifest', id: 'last', routes: ['*'], priority: 'low', parts: [{ entry: id(22) }] } }
   ] } };
   if (op.op === 'bring') return new Promise(() => {});
   return { ok: {} };
  } };
  try {
   useDevice(d);
   const result = await Promise.race([useView('/ranks/'), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))]);
   expect(result).toEqual([id(21), id(22)]);
   expect(calls.filter(op => op.op === 'bring')).toEqual([]);
   expect(learned('/ranks/')).toContain(id(22));
   expect(calls.filter(op => op.op === 'demand').at(-1).entries).toContain(id(22));
  } finally { delete globalThis.location; }
 });
}

const until = async check => {
 const end = Date.now() + 1500;
 while (!check()) {
  if (Date.now() > end) throw new Error('revision-driven replan did not complete');
  await new Promise(resolve => setTimeout(resolve, 10));
 }
};

test('cold manifest and later reference arrival replan the same route without overlapping walks or replacing its lease', async () => {
 const { useView, refreshActiveView } = await import('./device.js');
 globalThis.location = { pathname: '/cold/' };
 const calls = [];
 let hasManifest = false, hasRecord = false, scans = 0, running = 0, peak = 0;
 const d = { run: async op => {
  calls.push(op);
  if (op.op === 'demand') return { ok: { accepted: true } };
  if (op.op === 'query') {
   scans++; peak = Math.max(peak, ++running);
   await new Promise(resolve => setTimeout(resolve, 2));
   running--;
   return { ok: { rows: hasManifest ? [{ record: { kind: 'manifest', id: 'cold', routes: ['*'], parts: [{ entry: id(31), follow: 1 }] } }] : [] } };
  }
  if (op.op === 'get') return hasRecord ? { ok: { record: { pin: { entry: id(32) } } } } : { refused: 'NoEntry' };
  throw new Error('Unexpected legacy transfer');
 } };
 try {
  useDevice(d);
  await useView('/cold/');
  expect(calls[0]).toMatchObject({ op: 'query' });
  expect(calls.find(op => op.op === 'demand').queries[0].types).toEqual(['manifest']);
  hasManifest = true;
  for (let i = 0; i < 100; i++) refreshActiveView();
  await until(() => calls.some(op => op.op === 'demand' && op.entries.includes(id(31))));
  await useView('/cold/');
  expect(scans).toBe(2);
  hasRecord = true;
  for (let i = 0; i < 100; i++) refreshActiveView();
  await until(() => calls.some(op => op.op === 'demand' && op.entries.includes(id(32))));
  expect(scans).toBe(3);
  expect(peak).toBe(1);
  expect(new Set(calls.filter(op => op.op === 'demand').map(op => op.scope)).size).toBe(1);
  expect(calls.filter(op => op.op === 'bring')).toEqual([]);
 } finally { delete globalThis.location; }
});

test('navigation cancels a queued revision walk without reviving its old scope', async () => {
 const { useView, refreshActiveView } = await import('./device.js');
 globalThis.location = { pathname: '/before/' };
 const calls = [];
 const d = { run: async op => {
  calls.push(op);
  return op.op === 'query' ? { ok: { rows: [] } } : { ok: { accepted: true } };
 } };
 try {
  useDevice(d);
  await useView('/before/');
  const oldScope = calls.find(op => op.op === 'demand').scope;
  refreshActiveView();
  await useView('/after/');
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(calls.filter(op => op.op === 'query').length).toBe(2);
  const old = calls.filter(op => op.op === 'demand' && op.scope === oldScope);
  expect(old.length).toBe(2);
  expect(old.at(-1).entries).toEqual([]);
  expect(old.at(-1).queries).toBeUndefined();
 } finally { delete globalThis.location; }
});

test('revisions during a pending local manifest query queue one follow-up walk', async () => {
 const { useView, refreshActiveView } = await import('./device.js');
 globalThis.location = { pathname: '/pending/' };
 let release, reads = 0;
 const blocked = new Promise(resolve => { release = resolve; });
 const d = { run: async op => {
  if (op.op === 'demand') return { ok: { accepted: true } };
  if (op.op === 'query') return ++reads === 1 ? blocked : { ok: { rows: [] } };
  throw new Error('Unexpected operation');
 } };
 try {
  useDevice(d);
  const first = useView('/pending/');
  for (let i = 0; i < 100; i++) refreshActiveView();
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(reads).toBe(1);
  release({ ok: { rows: [] } });
  await first;
  await until(() => reads === 2);
  await useView('/pending/');
  expect(reads).toBe(2);
 } finally { release({ ok: { rows: [] } }); delete globalThis.location; }
});
