// @ts-nocheck — plain JS, trusted: the device cache's own worker (./cache.js)
/*
 * THE PICTURE WORKER — a build's pictures written as PNG files for the device cache, beside the page: each comes in as
 * an ImageBitmap of its own (a copy, handed over), is drawn on a canvas here and goes back as the PNG file's bytes,
 * handed over, not copied. Reading a picture back off the graphics card and encoding it takes the thread that does it
 * a while (seconds, on a busy software GPU), so it is never the page's: a world loading its assets keeps its frames.
 * Nothing of an asset runs here: only the browser's own encoder, on a picture the page already holds.
 */
self.onmessage = async (e) => {
	const { id, bitmap } = e.data;
	try {
		const c = new OffscreenCanvas(bitmap.width, bitmap.height);
		c.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0);
		bitmap.close();
		const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
		self.postMessage({ id, png }, [png.buffer]);
	} catch (err) {
		self.postMessage({ id, error: String(err?.message ?? err) });
	}
};
