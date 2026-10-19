// @ts-nocheck — plain JS
// The site's media copied into Maia City (./sitemedia.js): what is left to copy, what marks it, and each file read as
// a device reads it, twice from the start, its bytes checked against the hash it is named by.
// Run: bun test src/lib/avendb/sitemedia.test.js
import { expect, test } from 'bun:test';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bringing, marking, nameOf, SITE, source, uncopied } from './sitemedia.js';

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
		{ op: 'tag', entry: 'e2', add: [SITE], remove: [], as: 'me' }
	]);
	expect(marking(left, 'city', 'me', true)).toHaveLength(1);
	expect(bringing(left[1], 'city', 'me', ['coop:files', SITE])).toEqual({
		op: 'put_file',
		vault: 'city',
		name: `${h('c')}.mp3`,
		media: 'audio/mpeg',
		tags: [SITE, 'coop:files'],
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
