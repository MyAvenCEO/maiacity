/*
 * The proof of Maia City's code checked off the page's thread (./feed.js `verifyProof`): avenDB's WebAssembly replays
 * every signed edit, seconds of work on a slow machine, which on the page's thread froze the page and every view frame
 * that shares it (the view probe's clock, 2026-10-20).
 */
import init, { provenCode } from '../../../src/lib/avendb/device/avendb_browser.js';

const ready = init();
onmessage = async ({ data: { id, bytes, vault, kinds } }) => {
	try {
		await ready;
		postMessage({ id, rows: provenCode(bytes, vault, kinds) });
	} catch (e) {
		postMessage({ id, error: String(e?.message ?? e) });
	}
};
