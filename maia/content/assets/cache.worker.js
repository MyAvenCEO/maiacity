// @ts-nocheck — plain JS, trusted: the device cache's own worker (./cache.js)
/*
 * THE CACHE'S WORKER — what the device cache writes, done beside the page. Its jobs, each asked by a message `{id, op}`
 * and answered `{id, ...}` or `{id, error}`:
 *
 * - `png`: a build's picture written as a PNG file. It comes in as an ImageBitmap of its own (a copy, handed over), is
 *   drawn on a canvas here and goes back as the PNG file's bytes, handed over, not copied. Reading a picture back off
 *   the graphics card and encoding it takes the thread that does it a while (seconds, on a busy software GPU), so it is
 *   never the page's: a world loading its assets keeps its frames.
 * - `write`: a file of the cache's folder in the origin private file system (OPFS) written whole, `bytes` (handed
 *   over) as the file `name` of the folder `dir`, flushed. A worker, because only a worker has OPFS's synchronous
 *   files; one file after another, so the same file is never open twice.
 * - `can`: whether it can write them (`can`): the file `name` of the folder `dir` written as `write` writes, then taken
 *   away again. Not every browser's workers have OPFS (Playwright's WebKit has none): the page then writes the cache's
 *   files itself, where it can.
 *
 * Nothing of an asset runs here: only the browser's own encoder, on a picture the page already holds, and the
 * browser's own files.
 */

/** a file's name in the cache's folder */
const NAME = /^[a-z0-9.-]+$/;

/** the cache's folder, opened when it is first written to */
let folder;
const folderOf = (dir) => (folder ??= navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(dir, { create: true })));

/** the files being written, one after another */
let writing = Promise.resolve();

/** writes `bytes` as the file `name` of the folder `dir`, whole and flushed */
async function write({ dir, name, bytes }) {
	if (!NAME.test(dir) || !NAME.test(name) || !(bytes instanceof Uint8Array)) throw new Error('no file of the cache');
	const file = await (await (await folderOf(dir)).getFileHandle(name, { create: true })).createSyncAccessHandle();
	try {
		file.truncate(0);
		if (file.write(bytes, { at: 0 }) !== bytes.byteLength) throw new Error('not all of it was written');
		file.flush();
	} finally {
		file.close();
	}
}

/** a picture as a PNG file's bytes @param {ImageBitmap} bitmap */
async function pngOf(bitmap) {
	const c = new OffscreenCanvas(bitmap.width, bitmap.height);
	c.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0);
	bitmap.close();
	return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

self.onmessage = async (e) => {
	const { id, op } = e.data;
	try {
		if (op === 'can') {
			const { dir, name } = e.data;
			const can = await write({ dir, name, bytes: new Uint8Array(1) }).then(() => true, () => false);
			if (can) await (await folderOf(dir)).removeEntry(name).catch(() => {});
			self.postMessage({ id, can });
		} else if (op === 'write') {
			const turn = writing.then(() => write(e.data));
			writing = turn.catch(() => {});
			await turn;
			self.postMessage({ id, ok: true });
		} else {
			const png = await pngOf(e.data.bitmap);
			self.postMessage({ id, png }, [png.buffer]);
		}
	} catch (err) {
		self.postMessage({ id, error: String(err?.message ?? err) });
	}
};
