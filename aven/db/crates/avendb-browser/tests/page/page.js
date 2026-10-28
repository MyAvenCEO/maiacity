/*
 * AVENDB'S DEVICE IN A PAGE, as tests/page.rs drives it in Chromium (P8e, v8 phase S): each device a frame of one tab,
 * so all of them share the tab's virtual authenticator, which holds the person's passkey. The query says who the
 * device is and what it does. With `server`, it makes the passkey and founds its person's vault, claiming the server if
 * nobody has yet, then writes a note; with `offer`, it links through that code; if its store (`store`, its shelf in
 * OPFS) holds a device already, it opens that one again. Then it waits to read `reads` in block 2 of the note, writes
 * `write` there, and waits to read `then`; with `wait`, it then waits for the test's word; once done, with `close`, it
 * closes, its shelf holding all it holds, and with `forget` it forgets the device, its shelf put aside. The device that
 * founds the vault also brings a file, whose pieces its shelf keeps, and reads it back; with `file`, a device reads
 * that file from its peers; with `ops`, it then runs the ops the page's screens send, each through `run` (V2), and
 * reports what each answered. The device that founds the vault also writes an outline, a record of rows inside rows;
 * with `nest`, a device adds a row of its own three lists down in it, at once with the other device, and waits until
 * it reads both rows. Each step is reported to the test, with the passkey's ceremonies so far, and how deep the
 * device's queries read. With `earlier`,
 * it keeps in OPFS what an earlier avenDB kept for the store, which the store keeps as it opens; with `twice`, it
 * tries to hold a store another page's device runs from.
 */
import init, * as avendb from '/pkg/avendb_browser.js';
import { ceremonies, create } from '/js/passkey.js';
import { open } from '/js/store.js';

const q = new URLSearchParams(location.search);

/** Tell the test a step is done, with what it found. */
const report = (/** @type {string} */ what, /** @type {object} */ found = {}) =>
	fetch(`/report/${q.get('page')}/${what}`, { method: 'POST', body: JSON.stringify(found) });

/** Note a step on the console, which the test shows if a page fails. */
const trace = (/** @type {string} */ step) => console.log(`avenDB test, page ${q.get('page')}: ${step}`);

const hex = (/** @type {Uint8Array} */ b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (/** @type {string} */ s) => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Op `op` of the ops engine run on the device, as the page runs every read and change (`PageDevice.run`), with the
 * passkey's `ceremony` for what the vault's owners approve and `read` for a file's bytes: what it did, or it throws.
 */
async function run(device, op, ceremony, read) {
	const out = await device.run(op, ceremony, read);
	if (!('ok' in out)) throw new Error(`${op.op} not done: ${JSON.stringify(out)}`);
	return out.ok;
}

/** The text of block 2 of the note, as the device reads it: undefined while it can't. */
async function text(device, note) {
	const out = await device.run({ op: 'get', entry: note.entry });
	return out.ok?.record.blocks?.find((/** @type {{id: number}} */ b) => b.id === 2)?.text;
}

/** A note as the page writes one: its heading (block 1) the title too, then a paragraph (block 2) that reads `text`. */
const titled = (/** @type {string} */ title, /** @type {string} */ text) => ({
	kind: 'document',
	title,
	blocks: [
		{ id: 1, type: 'heading', level: 1, text: title },
		{ id: 2, type: 'paragraph', text }
	]
});

/** An outline: nodes, each with a text and the nodes under it, at any depth. */
const OUTLINE = JSON.stringify({
	title: 'Outline',
	type: 'object',
	$defs: {
		node: {
			type: 'object',
			properties: {
				id: { type: 'integer' },
				text: { type: 'string', 'x-loro': 'text', default: '' },
				kids: { type: 'array', default: [], items: { $ref: '#/$defs/node' } }
			},
			required: ['id']
		}
	},
	properties: {
		kind: { const: 'outline' },
		title: { type: 'string', default: '' },
		nodes: { type: 'array', default: [], items: { $ref: '#/$defs/node' } }
	},
	required: ['kind']
});

/** The place of the kids of node 11, under node 1: where each device adds a row of its own. */
const KIDS = ['nodes', { id: 1 }, 'kids', { id: 11 }, 'kids'];

/** The rows under node 11, as the device reads the outline through its schema: undefined while it can't. */
async function kids(device, note) {
	const out = await device.run({ op: 'get', entry: note.outline });
	if (!out.ok?.schema) return undefined;
	return out.ok.record.nodes?.[0]?.kids?.find((/** @type {{id: number}} */ k) => k.id === 11)?.kids;
}

/**
 * Adds row `id`, reading `text`, under node 11 of the outline, as soon as the device reads the outline, then waits
 * until it reads two rows there, its own and the other device's, two minutes at most: the outline as it reads it then.
 */
async function nest(device, note, id, text) {
	const end = Date.now() + 120_000;
	while (!(await kids(device, note))) {
		if (Date.now() > end) throw new Error('the device never read the outline');
		await sleep(100);
	}
	await run(device, { op: 'insert', as: note.actor, entry: note.outline, path: KIDS, value: { id, text } });
	let rows = (await kids(device, note)) ?? [];
	while (rows.length < 2) {
		if (Date.now() > end) throw new Error(`the device never read the other row: ${JSON.stringify(rows)}`);
		await sleep(100);
		rows = (await kids(device, note)) ?? [];
	}
	return (await device.run({ op: 'get', entry: note.outline })).ok.record;
}

/** How long the file the founding browser brings is: more than three of the page's one megabyte steps. */
const FILE = 3 * 1024 * 1024 + 4321;

/** The bytes from `from` to `to` of the file the test brings. */
const pattern = (/** @type {number} */ from, /** @type {number} */ to) =>
	Uint8Array.from({ length: to - from }, (_, i) => ((from + i) * 7) % 251);

/**
 * Brings the test's file into vault `vault` (`put_file`, its bytes read a megabyte at a time) and reads it back: its
 * root and sealed size, in hex and bytes.
 */
async function bring(device, vault) {
	const op = { op: 'put_file', vault, name: 'Seeds.bin', media: 'application/octet-stream', tags: [], len: FILE };
	const [allowed] = await run(device, { op: 'may', ops: [op] });
	if (allowed !== true) throw new Error(`may put_file: ${JSON.stringify(allowed)}`);
	const read = (/** @type {number} */ at, /** @type {number} */ n) => pattern(at, at + n);
	const { entry, root, size } = await run(device, op, undefined, read);
	const world = await run(device, { op: 'world' });
	const [file] = world.entries.find((/** @type {{entry: string}} */ e) => e.entry === entry).files;
	if (file.root !== root || file.size !== size || file.len !== FILE) throw new Error('the world shows another file');
	if (!(await same(device, { root, size }))) throw new Error('the file it brought reads back wrong');
	return { root, size };
}

/**
 * Whether the device reads the test's file right across a step (`read_file`, a range of it, its bytes beside the
 * answer), or false while it can't read it yet.
 */
async function same(device, /** @type {{root: string, size: number}} */ file) {
	const [from, to] = [1024 * 1024 - 100, 2 * 1024 * 1024 + 50];
	const out = await device.run({ op: 'read_file', root: file.root, size: file.size, from, to }).catch(() => null);
	const [got, want] = [out?.ok && out.bytes, pattern(from, to)];
	if (!got || out.ok.from !== from || out.ok.to !== to || out.ok.len !== want.length) return false;
	return got.length === want.length && got.every((b, i) => b === want[i]);
}

/**
 * The ops the page's screens send, each through `run` (V2), on the device that founded vault `vault`: new vaults in
 * one ceremony; the world; a note in one of them, shared with the other to read and then no longer; a keep share; the
 * coop a co-owner of the other, then a threshold of two, each in a ceremony of the passkey, the threshold first asked
 * without one, which answers what it would sign and makes nothing; the steward's mark; the shares over it; and `may`
 * of each kind of answer. What each answered, for the test.
 */
async function ops(device, passkey, vault) {
	const out = {};
	// The real WASM API, not the UI's synthetic Device double: custom labels keep canonical todo kind.
	const task = await run(device, { op: 'create', vault, type: 'custom-task-label', value: { kind: 'todo', title: 'Collection runtime', status: 'open' } });
	const collection = () => run(device, { op: 'entry_views', vault, kind: 'todo', as: vault });
	let selected = await collection();
	const row = selected.rows.find((e) => e.entry === task.entry);
	if (!row || row.type !== 'custom-task-label' || row.kind !== 'todo' || row.status !== 'open' || !row.readers.includes(vault)) throw new Error('canonical collection omitted the custom-labeled todo');
	await run(device, { op: 'set', entry: task.entry, path: ['status'], value: 'doing' });
	selected = await collection();
	if (selected.rows.find((e) => e.entry === task.entry)?.status !== 'doing') throw new Error('accepted mutation missing from real collection read');
	if (selected.readableEntries > selected.totalEntries || selected.totalEntries < selected.rows.length) throw new Error('collection metadata count mismatch');
	const empty = await run(device, { op: 'entry_views', vault, types: [] });
	if (empty.rows.length || empty.totalEntries !== selected.totalEntries) throw new Error('empty type selection changed metadata');
	const refused = await device.run({ op: 'entry_views', vault, kind: 'not-a-kind' });
	if (!refused.refused) throw new Error('invalid collection selector accepted');
	const picked = await run(device, { op: 'entry_views', entries: [task.entry, task.entry], as: vault });
	if (picked.rows.length !== 1 || picked.rows[0].status !== 'doing' || picked.totalEntries !== 1) throw new Error('explicit ID collection mismatch');
	const ambiguous = await device.run({ op: 'entry_views', vault, entries: [task.entry] });
	if (!ambiguous.refused) throw new Error('ambiguous collection scope accepted');
	out.collection = true;
	const found = { op: 'found', vaults: [{ kind: 'coop', name: 'Eve Farm COOP' }, { kind: 'coop', name: 'Eve COOP' }] };
	[out.mayFound] = await run(device, { op: 'may', ops: [found] });
	let before = passkey.count();
	const { vaults } = await run(device, found, passkey.sign);
	out.foundCeremonies = passkey.count() - before;
	const [farm, coop] = (out.vaults = vaults);
	const world = await run(device, { op: 'world' });
	const made = world.vaults.filter((/** @type {{id: string}} */ v) => vaults.includes(v.id));
	out.made = made.map((v) => [v.kind, v.name, v.acting.as, v.owners]);
	const plan = { op: 'create', as: farm, vault: farm, type: 'note', value: titled('Plan', 'Beans first.') };
	const { entry } = await run(device, plan);
	const share = { op: 'share', as: farm, over: farm, who: { vault: coop }, level: 'Viewer', what: { entry: [entry] } };
	[out.mayShare] = await run(device, { op: 'may', ops: [share] });
	out.share = (await run(device, share)).share;
	out.revoke = await run(device, { op: 'revoke', share: out.share, as: farm });
	out.keep = (await run(device, { op: 'keep', over: vault, mode: 'opened', what: { type: ['note'] } })).share;
	const owner = { op: 'share', over: farm, who: { vault: coop }, level: 'Owner', what: 'everything' };
	[out.mayOwner] = await run(device, { op: 'may', ops: [owner] });
	before = passkey.count();
	out.owner = await run(device, owner, passkey.sign);
	const threshold = { op: 'settings', vault: farm, threshold: 2 };
	out.drafted = await device.run(threshold);
	out.threshold = await run(device, threshold, passkey.sign);
	out.ceremonies = passkey.count() - before;
	const now = await run(device, { op: 'world' });
	out.thresholdNow = now.vaults.find((/** @type {{id: string}} */ v) => v.id === farm).threshold;
	out.mark = await run(device, { op: 'mark', entry });
	out.rows = (await run(device, { op: 'shares', over: farm })).rows.map((r) => [r.kind, r.level, r.revoke]);
	const asked = [{ op: 'card', name: "Eve's browser" }, { ...threshold, threshold: 3 }, { ...threshold, threshold: 1 }];
	out.may = await run(device, { op: 'may', ops: asked });
	out.limits = await run(device, { op: 'set_limits', depth: 9 });
	return out;
}

/** Waits until the device reads the test's file from its peers, two minutes at most. */
async function fetched(device, /** @type {{root: string, size: number}} */ file) {
	const end = Date.now() + 120_000;
	while (!(await same(device, file))) {
		if (Date.now() > end) throw new Error('it doesn\'t read the file within two minutes');
		await sleep(500);
	}
}

/** The folder of store `name` in OPFS. */
async function folder(/** @type {string} */ name) {
	const stores = await (await navigator.storage.getDirectory()).getDirectoryHandle('avendb', { create: true });
	return stores.getDirectoryHandle(name, { create: true });
}

/** The names of what folder `dir` holds, in order, or none if there is no such folder. */
async function names(dir, /** @type {string[]} */ path) {
	try {
		for (const part of path) dir = await dir.getDirectoryHandle(part);
		const found = [];
		for await (const key of dir.keys()) found.push(key);
		return found.sort();
	} catch {
		return [];
	}
}

/** What store `name`'s shelf in generation `g` keeps of its blobs: each blob under its hash, and its outboard. */
async function shelved(/** @type {string} */ name, /** @type {string} */ g) {
	const dir = await folder(name);
	return { blobs: await names(dir, [g, 'blobs']), outboards: await names(dir, [g, 'outboards']) };
}

/** Waits until the device reads `body` in block 2 of the note, two minutes at most. */
async function reads(device, note, body) {
	const end = Date.now() + 120_000;
	while ((await text(device, note)) !== body) {
		if (Date.now() > end) throw new Error(`it doesn't read ${JSON.stringify(body)} within two minutes`);
		await sleep(100);
	}
}

/** The passkey's ceremonies, counted. */
function counted(passkey) {
	let count = 0;
	return {
		passkey,
		count: () => count,
		unlock: (nonce, challenge) => (count++, passkey.unlock(nonce, challenge)),
		sign: (challenge, step) => (count++, trace(`a ceremony: ${step}`), passkey.sign(challenge, step))
	};
}

/** What an earlier avenDB kept for a store: in its OPFS folder, its edits, what opened its device, a key and a shelf
 *  from before the last reset. */
const EARLIER = {
	ops: new Uint8Array([0, 0, 0, 3, 1, 2, 3]),
	meta: new TextEncoder().encode('\u0000\u0000\u0000\u0011{"name":"Eve\'s"}'),
	key: new Uint8Array([9, 9, 9])
};

/** Writes `bytes` as file `name` of `dir`. */
async function put(dir, /** @type {string} */ name, /** @type {Uint8Array} */ bytes) {
	const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
	await writable.write(bytes);
	await writable.close();
}

/** The bytes of file `name` of `dir`, in hex, or null if there is none. */
async function read(dir, /** @type {string} */ name) {
	try {
		return hex(new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()));
	} catch {
		return null;
	}
}

/** Keeps for store `name` what an earlier avenDB kept (`EARLIER`): what it kept, in hex. */
async function earlier(/** @type {string} */ name) {
	const dir = await folder(name);
	await put(dir, 'ops', EARLIER.ops);
	await put(dir, 'meta', EARLIER.meta);
	await put(await dir.getDirectoryHandle('keys', { create: true }), 'ab', EARLIER.key);
	const old = await (await dir.getDirectoryHandle('g1', { create: true })).getDirectoryHandle('meta', { create: true });
	await put(old, '0000000000000001', EARLIER.meta);
	return kept(name);
}

/** What store `name`'s folder holds of what an earlier avenDB kept, in hex. */
async function kept(/** @type {string} */ name) {
	const dir = await folder(name);
	const keys = await dir.getDirectoryHandle('keys').catch(() => null);
	const old = await dir.getDirectoryHandle('g1').catch(() => null);
	const shelf = old && (await old.getDirectoryHandle('meta').catch(() => null));
	const [ops, meta, key] = [await read(dir, 'ops'), await read(dir, 'meta'), keys && (await read(keys, 'ab'))];
	return { ops, meta, key, old: shelf && (await read(shelf, '0000000000000001')) };
}

/** Waits for the test's word to go on, set in the tab's storage. */
async function word() {
	const key = `go:${q.get('page')}`;
	while (!localStorage.getItem(key)) await sleep(100);
}

async function main() {
	if (q.get('earlier')) return report('earlier', await earlier(q.get('store')));
	await init();
	const store = await open(q.get('store'));
	if (q.get('twice')) {
		const refused = await store.hold().then(() => null, (e) => e.message);
		return report('twice', { refused });
	}
	const meta = await avendb.storeMeta(store);
	const start = performance.now();
	let device, passkey, note;
	if (meta) {
		passkey = counted(ceremonies(avendb, meta.credential));
		const unlock = await passkey.unlock(unhex(meta.nonce));
		device = await avendb.Device.open(unlock, undefined, store);
		note = JSON.parse(localStorage.getItem(`note:${q.get('store')}`));
	} else {
		const [name, relay] = [q.get('name'), q.get('relay')];
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		if (q.get('server')) {
			trace('making the passkey');
			const made = await create(name);
			passkey = counted(ceremonies(avendb, made.id));
			trace('unlocking and founding');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			const server = q.get('server');
			const [spki, sign] = [made.spki, passkey.sign];
			device = await avendb.Device.found(name, relay, server, spki, unlock, sign, undefined, undefined, store);
			const vault = await device.vault();
			const write = { op: 'create', vault, type: 'note', value: titled('Seeds', q.get('write')) };
			const { entry } = await run(device, write);
			trace('writing an outline');
			await run(device, { op: 'create', vault, type: 'schema', value: OUTLINE });
			const beds = [{ id: 1, text: 'Beds', kids: [{ id: 11, text: 'North', kids: [] }] }];
			const garden = { kind: 'outline', title: 'Garden', nodes: beds };
			const { entry: outline } = await run(device, { op: 'create', vault, type: 'note', value: garden });
			trace('bringing a file');
			note = { actor: vault, entry, outline, file: await bring(device, vault) };
		} else {
			passkey = counted(ceremonies(avendb));
			trace('unlocking and linking');
			const unlock = (/** @type {Uint8Array} */ challenge) => passkey.unlock(nonce, challenge);
			device = await avendb.Device.link(name, relay, q.get('offer'), unlock, undefined, store);
			note = { actor: q.get('actor'), entry: q.get('entry'), outline: q.get('outline') };
		}
		const kept = await device.keep(hex(nonce), passkey.passkey.held.id);
		if (kept.passkey !== device.passkey() || kept.device !== device.id()) throw new Error('it kept another device');
		localStorage.setItem(`note:${q.get('store')}`, JSON.stringify(note));
	}
	const ms = Math.round(performance.now() - start);
	const [vault, ceremonies_] = [await device.vault(), passkey.count()];
	const [edits, keys] = await device.size();
	const found = { ms, vault, edits, keys, ceremonies: ceremonies_, offer: device.offer(), endpoint: device.endpoint() };
	found.limits = (await run(device, { op: 'limits' })).depth;
	found.generations = (await names(await folder(q.get('store')), [])).filter((n) => /^g[0-9]+$/.test(n));
	found.shelf = await shelved(q.get('store'), found.generations.at(-1));
	await report(meta ? 'opened' : 'started', { ...found, ...note });
	if (q.get('ops')) {
		trace('running the ops');
		await report('ops', await ops(device, passkey, vault));
	}
	if (q.get('reads')) {
		trace('reading');
		await reads(device, note, q.get('reads'));
		await report('read');
	}
	if (q.get('file')) {
		const [root, size] = q.get('file').split(':');
		trace('reading the file');
		await fetched(device, { root, size: Number(size) });
		await report('fetched');
	}
	if (q.get('write') && !q.get('server')) {
		const path = ['blocks', { id: 2 }, 'text'];
		await run(device, { op: 'set', as: note.actor, entry: note.entry, path, value: q.get('write') });
		await report('wrote');
	}
	if (q.get('nest')) {
		const [id, text] = q.get('nest').split(':');
		trace('writing in the outline');
		await report('nested', { record: await nest(device, note, Number(id), text) });
	}
	if (q.get('then')) {
		await reads(device, note, q.get('then'));
		await report('read again');
	}
	if (q.get('wait')) await word();
	if (q.get('close')) {
		trace('closing');
		const [edits, keys] = await device.size();
		await device.close();
		const shelf = await store.names('');
		await report('closed', { edits, keys, shelf, ceremonies: passkey.count() });
		if (!q.get('forget')) return;
		trace('forgetting');
		await store.aside();
		const dir = await folder(q.get('store'));
		const generations = (await names(dir, [])).filter((n) => /^g[0-9]+$/.test(n));
		const metas = Object.fromEntries(await Promise.all(generations.map(async (g) => [g, await names(dir, [g, 'meta'])])));
		const after = await avendb.storeMeta(store);
		await report('forgot', { generations, metas, meta: after ?? null, earlier: await kept(q.get('store')) });
		return;
	}
	await report('done', { ceremonies: passkey.count() });
	// it stays on, for the next device to link through it
	Object.assign(globalThis, { device });
}

main().catch((e) => report('error', { error: String(e?.stack ?? e) }));
