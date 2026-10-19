// @ts-nocheck — plain JS
// Each recipe builds in a worker of its own (./host.js, rooms of the shell, ../../sandbox/frame.js): a recipe that
// hears its worker's jobs and answers them with its own model, or answers every job number it may guess, never answers
// another recipe's build. The shell runs here as in a page, with its frame's own script (read out of the frame's
// document, ../../sandbox/policy.js SHELL_SCRIPT) and real workers; the engine is a stand-in that runs a recipe as
// the box's does (./engine.js: its code once in the worker's global scope, then its build), and the recipes are made
// to do harm. A recipe whose worker crashes, or that never stops, dies alone: its room is let go, and every other
// room of the box, and the machines running there, go on in the same frame. The box's lab (/app/assets/box/) tries the
// same with the real engine (./probe.js `answerRecipe`, `crashRecipe`, `spinRecipe`).
// Run: bun test src/lib/assets/box/host.test.js
import { afterAll, afterEach, expect, mock, test } from 'bun:test';

mock.module('$app/paths', () => ({ base: '' }));
const { Shell } = await import('../../sandbox/frame.js');
const { SHELL_SCRIPT } = await import('../../sandbox/policy.js');
const { AssetBox, ROOMS } = await import('./host.js');

/* ── a page: one frame per shell, its document's one script run with real workers, messages passed as a page's are ── */
const listeners = new Set();
const real = { add: globalThis.addEventListener, remove: globalThis.removeEventListener, document: globalThis.document };
globalThis.addEventListener = (type, f) => type === 'message' && listeners.add(f);
globalThis.removeEventListener = (type, f) => listeners.delete(f);
/** every frame made, and the workers of each still running */
const frames = [];
function frameOf() {
	const workers = new Set();
	let heard = null;
	const win = { postMessage: (data) => setTimeout(() => heard?.({ source: parent, data: structuredClone(data) })) };
	const parent = { postMessage: (data) => setTimeout(() => [...listeners].forEach((f) => f({ source: win, data }))) };
	class Worker extends globalThis.Worker {
		constructor(url) {
			super(url);
			workers.add(this);
		}
		terminate() {
			workers.delete(this);
			super.terminate();
		}
	}
	const el = {
		style: {},
		workers,
		contentWindow: win,
		setAttribute() {},
		addEventListener: (type, f) => type === 'load' && (el.loaded = f),
		remove: () => [...workers].forEach((w) => w.terminate()),
		// put into the page: the one script of its document runs, then it has loaded
		put() {
			const script = el.srcdoc.slice(el.srcdoc.indexOf('<script>') + 8, el.srcdoc.lastIndexOf('</script>'));
			new Function('parent', 'addEventListener', 'Worker', script)(parent, (type, f) => (heard = f), Worker);
			setTimeout(() => el.loaded());
		}
	};
	frames.push(el);
	return el;
}
globalThis.document = { createElement: frameOf, body: { append: (el) => el.put() } };

/**
 * The stand-in engine: a recipe is code that gives back its build, run once in the worker (as ./engine.js `recipeOf`
 * runs a recipe file), and each build's answer names its recipe; builds kept running answer with their recipe.
 */
const ENGINE = `const started = new Map(), sessions = new Map();
let next = 1;
const reply = (m) => self.postMessage([m, []], []);
self.onmessage = async (e) => {
	const { id, op, recipe } = e.data;
	try {
		if (op === 'tick') return reply({ id, ok: true, recipe: sessions.get(e.data.session) ?? null });
		if (op === 'end') return reply({ id, ok: true });
		if (!started.has(recipe.hash)) started.set(recipe.hash, new Function(recipe.code)());
		const data = await started.get(recipe.hash)();
		if (op === 'live') {
			sessions.set(next, recipe.hash);
			return reply({ id, ok: true, session: next++, nodes: 0 });
		}
		reply({ id, ok: true, data, card: { recipe: recipe.hash } });
	} catch (err) {
		reply({ id, ok: false, error: String(err?.message ?? err) });
	}
};
reply({ op: 'ready' });`;

/** a recipe that builds after a while, as itself */
const HONEST = { hash: 'honest', code: "return () => new Promise((ok) => setTimeout(() => ok('honest'), 30));" };
/**
 * A recipe made to answer for others: every job its worker hears, of any recipe, answered at once as that recipe's,
 * and, blind, every job number the page may ask, as the honest recipe's.
 */
const HOSTILE = {
	hash: 'hostile',
	code: `const forge = (id, recipe) => self.postMessage([{ id, ok: true, data: 'forged', card: { recipe } }, []], []);
self.addEventListener('message', (e) => e.data?.recipe && e.data.recipe.hash !== 'hostile' && forge(e.data.id, e.data.recipe.hash));
setInterval(() => { for (let id = 1; id <= 40; id++) forge(id, 'honest'); }, 5);
return () => 'hostile';`
};
/** recipe `i`, which builds into how many recipes its worker has started, itself among them */
const counting = (i) => ({ hash: `counting-${i}`, code: `/* ${i} */ self.ran = (self.ran ?? 0) + 1; const ran = self.ran; return () => ran;` });
/** a recipe that counts its own builds in its worker: 1 in a fresh one, then 2, 3… while that worker lives */
const KEPT = { hash: 'kept', code: 'let n = 0; return () => ++n;' };
/** a recipe that crashes its worker: an error thrown where nothing catches it, and its build never answered */
const CRASH = { hash: 'crash', code: "setTimeout(() => { throw new Error('this recipe crashed its worker'); }); return () => new Promise(() => {});" };
/** a recipe that never stops building */
const SPIN = { hash: 'spin', code: 'return () => { for (;;); };' };

const boxes = [];
const shellOf = () => {
	const s = new Shell({ code: async () => ENGINE });
	boxes.push(s);
	return s;
};
const boxOf = () => {
	const b = new AssetBox();
	b.code = async () => ENGINE;
	boxes.push(b);
	return b;
};
afterEach(() => boxes.splice(0).forEach((b) => b.stop()));
afterAll(() => {
	globalThis.addEventListener = real.add;
	globalThis.removeEventListener = real.remove;
	globalThis.document = real.document;
});

test('the frame’s one script is the one the page’s policy names by its hash', async () => {
	await shellOf().ask('build', { recipe: HONEST });
	const doc = frames.at(-1).srcdoc;
	expect(doc.slice(doc.indexOf('<script>') + 8, doc.lastIndexOf('</script>'))).toBe(SHELL_SCRIPT);
});

test('two recipes in one worker: the one there first answers the other’s build (why each has its own)', async () => {
	const shell = shellOf();
	expect((await shell.ask('build', { recipe: HOSTILE })).data).toBe('hostile');
	expect((await shell.ask('build', { recipe: HONEST })).data).toBe('forged');
});

test('in rooms of their own, no answer from another room is taken, heard or guessed', async () => {
	const shell = shellOf();
	expect((await shell.ask('build', { recipe: HOSTILE }, { room: 1 })).data).toBe('hostile');
	for (let i = 0; i < 3; i++) {
		const got = await shell.ask('build', { recipe: HONEST }, { room: 2 });
		expect([got.data, got.card.recipe]).toEqual(['honest', 'honest']);
	}
});

test('the box gives each recipe a worker of its own: no recipe answers another’s build', async () => {
	const box = boxOf();
	expect((await box.build(HOSTILE)).data).toBe('hostile');
	for (let i = 0; i < 3; i++) expect((await box.build(HONEST)).data).toBe('honest');
	// asked at once, side by side, too (what the hostile recipe answers its own build with is its own affair: the
	// page holds that to its own hash)
	const all = await Promise.all([box.build(HONEST), box.build(HOSTILE), box.build(HONEST)]);
	expect([all[0].data, all[2].data]).toEqual(['honest', 'honest']);
	expect(box.rooms.length).toBe(2);
});

test('each recipe is the first code its worker ran; the box keeps ROOMS rooms and one spare, and lets the rest go', async () => {
	const box = boxOf();
	for (let i = 0; i < ROOMS + 3; i++) expect((await box.build(counting(i))).data).toBe(1);
	// one asked again keeps its room while it is kept, and starts in a fresh worker once its room was let go
	expect((await box.build(counting(ROOMS + 2))).data).toBe(1);
	expect((await box.build(counting(0))).data).toBe(1);
	expect(box.rooms.length).toBe(ROOMS);
	await new Promise((ok) => setTimeout(ok, 50));
	expect(frames.at(-1).workers.size).toBe(ROOMS + 1);
});

test('builds kept running are stepped in their own recipe’s room, whatever session number its worker gave', async () => {
	const box = boxOf();
	const a = await box.live({ hash: 'a', code: 'return () => 1;' }, undefined, 0);
	const b = await box.live({ hash: 'b', code: 'return () => 2;' }, undefined, 0);
	expect(a.session).not.toBe(b.session);
	expect((await box.tick(a.session, {})).recipe).toBe('a');
	expect((await box.tick(b.session, {})).recipe).toBe('b');
	// a machine kept running keeps its room, however many recipes are built after it
	for (let i = 0; i < ROOMS + 2; i++) await box.build(counting(i));
	expect((await box.tick(a.session, {})).recipe).toBe('a');
	expect((await box.tick(b.session, {})).recipe).toBe('b');
	await box.end(a.session);
	await expect(box.tick(a.session, {})).rejects.toThrow(/no session/);
	box.stop();
	await expect(box.tick(b.session, {})).rejects.toThrow(/no session/);
});

test('a recipe that crashes its worker dies alone: the other rooms, and the builds kept running in them, go on', async () => {
	const box = boxOf();
	expect((await box.build(KEPT)).data).toBe(1);
	const running = await box.live({ hash: 'a', code: 'return () => 1;' }, undefined, 0);
	const frame = box.frame;
	// asked at once: the crash fails its own build alone, and the build asked after it still comes
	const [crashed, after] = await Promise.allSettled([box.build(CRASH), box.build(KEPT)]);
	expect(crashed.status).toBe('rejected');
	expect(crashed.reason.message).toMatch(/crashed/);
	expect(after.value?.data).toBe(2);
	// the same frame, the same worker for the recipe built before (its count goes on), the machine still running
	expect(box.frame).toBe(frame);
	expect((await box.build(KEPT)).data).toBe(3);
	expect((await box.tick(running.session, {})).recipe).toBe('a');
	// the crashed recipe's room is gone; built again, it starts in a fresh worker, and crashes alone again
	expect(box.rooms.some((r) => r.code === CRASH.code)).toBe(false);
	await expect(box.build(CRASH)).rejects.toThrow(/crashed/);
	expect(box.frame).toBe(frame);
	expect((await box.build(KEPT)).data).toBe(4);
});

test('a recipe that never stops is ended alone: its worker goes, the box and every other room go on', async () => {
	const box = boxOf();
	expect((await box.build(KEPT)).data).toBe(1);
	const running = await box.live({ hash: 'a', code: 'return () => 1;' }, undefined, 0);
	const frame = box.frame;
	const workers = frame.workers.size;
	await expect(box.build(SPIN, undefined, { timeout: 300 })).rejects.toThrow(/ran longer than 300 ms/);
	await new Promise((ok) => setTimeout(ok, 50));
	// its worker was ended (the spare it took was made again for the next new room)
	expect(frame.workers.size).toBe(workers);
	expect(box.frame).toBe(frame);
	expect((await box.build(KEPT)).data).toBe(2);
	expect((await box.tick(running.session, {})).recipe).toBe('a');
	expect(box.rooms.some((r) => r.code === SPIN.code)).toBe(false);
});

test('a running build whose worker crashes goes with it, and only that one', async () => {
	const box = boxOf();
	const doomed = await box.live({ hash: 'doomed', code: "self.addEventListener('message', (e) => e.data?.op === 'tick' && setTimeout(() => { throw new Error('a step that crashes'); })); return () => 1;" }, undefined, 0);
	const kept = await box.live({ hash: 'kept', code: 'return () => 2;' }, undefined, 0);
	expect((await box.tick(doomed.session, {})).recipe).toBe('doomed');
	await new Promise((ok) => setTimeout(ok, 50));
	await expect(box.tick(doomed.session, {})).rejects.toThrow(/no session/);
	expect((await box.tick(kept.session, {})).recipe).toBe('kept');
});

test('a host of one room (the logic host) is still torn down whole by a crash, and starts again', async () => {
	const shell = shellOf();
	await expect(shell.ask('build', { recipe: CRASH })).rejects.toThrow(/crashed/);
	expect(shell.frame).toBe(null);
	expect((await shell.ask('build', { recipe: HONEST })).data).toBe('honest');
});
