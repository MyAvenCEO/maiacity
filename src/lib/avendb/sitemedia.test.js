// @ts-nocheck — plain JS
// The site's media copied into Maia City (./sitemedia.js): what is left to copy, what marks it, and each file read as
// a device reads it, twice from the start, its bytes checked against the hash it is named by.
// Run: bun test src/lib/avendb/sitemedia.test.js
import { expect, test } from 'bun:test';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bringing, copyAll, LEGACY, marking, nameOf, SITE, source, uncopied } from './sitemedia.js';

const hex = (b) => bytesToHex(blake3(b));
const h = (c) => c.repeat(64);

test('a file is named by its hash and the ending of its type, and only a type the site shows', () => {
	expect(nameOf(h('a'), 'image/jpeg')).toBe(`${h('a')}.jpg`);
	expect(nameOf(h('b'), 'audio/mpeg')).toBe(`${h('b')}.mp3`);
	expect(nameOf(h('c'), 'video/mp4')).toBe(`${h('c')}.mp4`);
	expect(nameOf(h('d'), 'text/html')).toBeNull();
	expect(nameOf('abc', 'image/png')).toBeNull();
});

test('what is left: the files Maia City lacks, and those it holds untagged, which only need the tag', () => {
	const file = (entry, title, tags = [], extra = {}) => ({ entry, vault: 'city', type: 'file', title, tags, deleted: false, files: [{}], ...extra });
	const world = {
		entries: [
			file('e1', `${h('a')}.jpg`, [SITE]),
			file('e2', `${h('b')}.jpg`, ['journal']),
			file('e3', `${h('c')}.mp3`, [SITE], { deleted: true }),
			file('e4', `${h('d')}.png`, [SITE], { vault: 'alice' })
		]
	};
	const manifest = {
		[h('a')]: { mime: 'image/jpeg', title: 'done' },
		[h('b')]: { mime: 'image/jpeg', title: 'a journal picture' },
		[h('c')]: { mime: 'audio/mpeg', title: 'deleted, so copied again' },
		[h('d')]: { mime: 'image/png', title: '' },
		[h('e')]: { mime: 'text/html', title: 'never' }
	};
	const left = uncopied(world, 'city', manifest);
	expect(left).toEqual([
		{ hash: h('b'), name: `${h('b')}.jpg`, media: 'image/jpeg', title: 'a journal picture', entry: 'e2' },
		{ hash: h('c'), name: `${h('c')}.mp3`, media: 'audio/mpeg', title: 'deleted, so copied again' },
		{ hash: h('d'), name: `${h('d')}.png`, media: 'image/png', title: `${h('d')}.png` }
	]);
	expect(marking(left, 'city', 'me', false)).toEqual([
		{ op: 'share', over: 'city', who: 'everyone', level: 'Public', what: { tag: SITE }, as: 'me' },
		{ op: 'tag', entry: 'e2', add: [SITE, LEGACY], remove: [], as: 'me' }
	]);
	expect(marking(left, 'city', 'me', true)).toHaveLength(1);
	expect(bringing(left[1], 'city', 'me', ['coop:files', SITE])).toEqual({
		op: 'put_file',
		vault: 'city',
		name: `${h('c')}.mp3`,
		media: 'audio/mpeg',
		tags: [LEGACY, SITE, 'coop:files'],
		as: 'me'
	});
});

/** A server of `bytes`, in pieces of `piece` bytes, naming its length or not; how many downloads it served. */
function server(bytes, { piece = 7, length = true, status = 200, cut = bytes.length } = {}) {
	const served = { downloads: 0 };
	const get = async () => {
		served.downloads++;
		let at = 0;
		const body = new ReadableStream({
			pull(c) {
				if (at >= cut) return c.close();
				c.enqueue(bytes.slice(at, Math.min(cut, at + piece)));
				at += piece;
			}
		});
		return new Response(body, { status, headers: length ? { 'content-length': String(bytes.length) } : {} });
	};
	return { get, served };
}

/** Reads `file` as a device does: twice from the start, `n` bytes at a time. */
async function twice(file, n) {
	const out = [];
	for (let pass = 0; pass < 2; pass++) {
		const all = new Uint8Array(file.size);
		for (let at = 0; at < file.size; at += n) all.set(new Uint8Array(await file.slice(at, Math.min(file.size, at + n)).arrayBuffer()), at);
		out.push(all);
	}
	return out;
}

const bytesOf = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);

test('a small file is downloaded once, read twice and checked against its name', async () => {
	const bytes = bytesOf(1000);
	const { get, served } = server(bytes);
	const file = await source('u', hex(bytes), get);
	expect(file.size).toBe(1000);
	const [one, two] = await twice(file, 64);
	expect(one).toEqual(bytes);
	expect(two).toEqual(bytes);
	expect(served.downloads).toBe(1);
});

test('a large file streams through once for each reading, never whole', async () => {
	const bytes = bytesOf(5000);
	const { get, served } = server(bytes, { piece: 333 });
	const file = await source('u', hex(bytes), get, 1000);
	const [one, two] = await twice(file, 256);
	expect(one).toEqual(bytes);
	expect(two).toEqual(bytes);
	expect(served.downloads).toBe(2);
	file.close();
});

test('bytes other than its name says stop the first reading as it ends', async () => {
	const bytes = bytesOf(3000);
	const { get } = server(bytes);
	const file = await source('u', h('0'), get, 1000);
	await expect(twice(file, 512)).rejects.toThrow(/hashes to/);
});

test('a download that ends early, or answers other than whole, stops it', async () => {
	const bytes = bytesOf(3000);
	const short = await source('u', hex(bytes), server(bytes, { cut: 2000 }).get, 1000);
	await expect(twice(short, 512)).rejects.toThrow(/ended at 2000 of 3000/);
	await expect(source('u', hex(bytes), server(bytes, { status: 404 }).get)).rejects.toThrow(/answered 404/);
});

test('a download that names no length is read whole first', async () => {
	const bytes = bytesOf(2500);
	const { get, served } = server(bytes, { length: false });
	const file = await source('u', hex(bytes), get);
	expect(file.size).toBe(2500);
	expect((await twice(file, 1000))[1]).toEqual(bytes);
	expect(served.downloads).toBe(1);
});

test('a file copied private, as the old vault keeps it, is done too', () => {
	const world = { entries: [{ entry: 'e1', vault: 'city', type: 'file', title: `${h('a')}.mp3`, tags: [LEGACY], deleted: false, files: [{}] }] };
	expect(uncopied(world, 'city', { [h('a')]: { mime: 'audio/mpeg', title: 'kept' } })).toEqual([]);
});

/** Answers each address of `answers` in turn: a status, or a server of bytes; how often each was asked. */
function addresses(answers) {
	const asked = {};
	const get = async (url, init) => {
		asked[url] = (asked[url] ?? 0) + 1;
		const a = answers[url];
		const now = Array.isArray(a) ? a[Math.min(asked[url], a.length) - 1] : a;
		if (now === 'drop') throw new TypeError('network');
		return typeof now === 'number' ? new Response('no', { status: now }) : now.get(url, init);
	};
	return { get, asked };
}

test('a file the old vault keeps private comes through the Mac app’s key, and a failing server is asked again', async () => {
	const bytes = bytesOf(1500);
	const { get, asked } = addresses({ public: 401, keyed: ['drop', 502, server(bytes)] });
	const file = await source(['public', 'keyed'], hex(bytes), get, undefined, 0);
	expect(file.kept).toBe(true);
	expect((await twice(file, 400))[1]).toEqual(bytes);
	expect(asked).toEqual({ public: 1, keyed: 3 });
	const open = await source(['public', 'keyed'], hex(bytes), addresses({ public: server(bytes), keyed: 500 }).get, undefined, 0);
	expect(open.kept).toBe(false);
	await expect(source(['public'], hex(bytes), addresses({ public: 401 }).get, undefined, 0)).rejects.toThrow(/keeps it private/);
	await expect(source(['public'], hex(bytes), addresses({ public: [503, 503, 503, server(bytes)] }).get, undefined, 0)).rejects.toThrow(/answered 503/);
});

test('copying everything marks what Maia City holds, brings the rest each as the old vault shows it, and goes on past a failure', async () => {
	const [one, two, three] = [bytesOf(900), bytesOf(1200).map((b) => b ^ 1), bytesOf(700).map((b) => b ^ 2)];
	const pieces = [
		{ hash: h('9'), name: `${h('9')}.jpg`, media: 'image/jpeg', title: 'held', entry: 'e9' },
		{ hash: hex(one), name: `${hex(one)}.jpg`, media: 'image/jpeg', title: 'public' },
		{ hash: hex(two), name: `${hex(two)}.mp3`, media: 'audio/mpeg', title: 'private' },
		{ hash: h('8'), name: `${h('8')}.png`, media: 'image/png', title: 'gone' },
		{ hash: hex(three), name: `${hex(three)}.mp4`, media: 'video/mp4', title: 'film' }
	];
	const answers = {
		[`p/${hex(one)}`]: server(one),
		[`p/${hex(two)}`]: 401,
		[`k/${hex(two)}`]: server(two),
		[`p/${h('8')}`]: 404,
		[`k/${h('8')}`]: 404,
		[`p/${hex(three)}`]: server(three)
	};
	const ran = [];
	const brought = [];
	const api = {
		runAll: async (what, ops) => (ran.push(...ops), ops.map(() => ({}))),
		bring: async (what, op, file) => {
			brought.push({ name: op.name, tags: op.tags, bytes: (await twice(file, 256))[1] });
			return { entry: op.name };
		},
		refresh: async () => ran.push('refreshed')
	};
	const seen = [];
	const out = await copyAll({
		api,
		left: pieces,
		vault: 'city',
		actor: 'city',
		shared: false,
		asked: [],
		urlsOf: (hash) => [`p/${hash}`, `k/${hash}`],
		progress: (at) => seen.push(at.done),
		get: addresses(answers).get
	});
	expect(ran.map((o) => o.op ?? o)).toEqual(['share', 'tag', 'refreshed']);
	expect(brought.map((b) => [b.name.split('.')[1], b.tags])).toEqual([
		['jpg', [LEGACY, SITE]],
		['mp3', [LEGACY]],
		['mp4', [LEGACY, SITE]]
	]);
	expect(brought.map((b) => b.bytes)).toEqual([one, two, three]);
	expect({ done: out.done, of: out.of, kept: out.kept }).toEqual({ done: 4, of: 5, kept: 1 });
	expect(out.failed.map((f) => [f.piece.title, f.why])).toEqual([['gone', expect.stringMatching(/answered 404/)]]);
	expect(seen.at(-1)).toBe(4);
});

test('copying leaves a file another device copied meanwhile', async () => {
	const [one, two] = [bytesOf(900), bytesOf(1200).map((b) => b ^ 3)];
	const pieces = [
		{ hash: hex(one), name: `${hex(one)}.jpg`, media: 'image/jpeg', title: 'one' },
		{ hash: h('7'), name: `${h('7')}.jpg`, media: 'image/jpeg', title: 'copied elsewhere' },
		{ hash: hex(two), name: `${hex(two)}.mp3`, media: 'audio/mpeg', title: 'two' }
	];
	const log = [];
	const api = {
		runAll: async (what, ops) => ops.map(() => ({})),
		bring: async (what, op, file) => {
			await twice(file, 256);
			log.push(`brought ${op.name.split('.')[1]}`);
			return { entry: op.name };
		}
	};
	const out = await copyAll({
		api,
		left: pieces,
		vault: 'city',
		actor: 'city',
		shared: true,
		asked: [],
		urlsOf: (hash) => [`p/${hash}`],
		get: addresses({ [`p/${hex(one)}`]: server(one), [`p/${hex(two)}`]: server(two) }).get,
		held: (p) => p.hash === h('7')
	});
	expect({ done: out.done, of: out.of, failed: out.failed }).toEqual({ done: 3, of: 3, failed: [] });
	expect(log).toEqual(['brought jpg', 'brought mp3']);
});

