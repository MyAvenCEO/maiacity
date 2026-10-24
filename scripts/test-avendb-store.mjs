/** The actual Store bridge and OPFS worker, with no account/WASM/passkey or live profile.
 * StoredView/V1 assumes verified saved state is available; this tests its persistence
 * interface, not AEAD or replay. Acknowledged Keep bytes must survive a new worker
 * and document. A damaged slot must not damage the other slot or authoritative history.
 *   bun scripts/test-avendb-store.mjs [--browser chromium|webkit]
 * Chromium defaults to installed Chrome on macOS, otherwise Playwright's pinned browser.
 */
const { chromium, webkit } = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const at = process.argv.indexOf('--browser');
const engine = at < 0 ? 'chromium' : process.argv[at + 1];
assert(['chromium', 'webkit'].includes(engine));
const locations = { canonical: 'avendb/crates/avendb-browser/js', shipped: 'src/lib/avendb/device' };
// Use HTTPS: WebKitGTK does not expose worker storage on every HTTP loopback origin.
// This disposable certificate is trusted only by this isolated test context.
const profile = await mkdtemp(join(tmpdir(), 'avendb-opfs-test-'));
const keyPath = join(profile, 'key.pem'), certPath = join(profile, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (req, res) => {
	try {
		const path = new URL(req.url, 'http://localhost').pathname;
		res.setHeader('Cache-Control', 'no-store');
		if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disposable avenDB OPFS fixture</title>'); return; }
		const match = /^\/(canonical|shipped)\/(store(?:\.worker)?\.js)$/.exec(path);
		if (!match) { res.writeHead(404); res.end(); return; }
		res.setHeader('Content-Type', 'text/javascript');
		res.end(await readFile(join(root, locations[match[1]], match[2])));
	} catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${server.address().port}`;
// WebKit's ephemeral contexts may not provide OPFS. Use a fresh disk-backed
// profile for this persistence test; it is never a user profile and is removed below.
let context;
try {
	const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	const executablePath = process.env.AVENDB_CHROMIUM ?? (existsSync(macChrome) ? macChrome : undefined);
	context = await (engine === 'webkit'
		? webkit.launchPersistentContext(profile, { headless: true, ignoreHTTPSErrors: true })
		: chromium.launchPersistentContext(profile, { headless: true, executablePath, ignoreHTTPSErrors: true }));
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	for (const source of Object.keys(locations)) {
		await page.goto(origin);
		assert(await page.evaluate(() => isSecureContext), 'OPFS fixture must run in a secure context');
		await page.evaluate(async source => {
			const { open } = await import(`/${source}/store.js`);
			const store = await open(`keep-test-${source}`).catch(error => { throw new Error(`${source} open: ${error.message}`); });
			const call = store.call.bind(store);
			store.call = (op, ...args) => call(op, ...args).catch(error => { throw new Error(`${source} ${op}: ${error.message}`); });
			try {
				await store.hold();
				const journal = new Uint8Array([31, 41, 59]);
				await store.put('journal/0001', journal);
				if (journal.byteLength !== 0) throw new Error('whole journal buffer was copied instead of transferred');
				const view = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 251);
				await store.keep('slots/view-0', view);
				if (view.byteLength !== 0) throw new Error('whole snapshot buffer was copied instead of transferred');
				const parent = new Uint8Array([10, 20, 30, 40]);
				await store.put('journal/partial', parent.subarray(1, 3));
				await store.keep('slots/partial', parent.subarray(1, 3));
				if (parent.byteLength !== 4 || parent[3] !== 40) throw new Error('subarray consumed unrelated backing bytes');
				await store.keep('slots/view-1', new Uint8Array([9, 2, 6]));
				let refused = false;
				try { await store.keep('journal/0001', new Uint8Array([0])); } catch { refused = true; }
				if (!refused) throw new Error('Keep must not replace authoritative objects');
			} finally { await store.close(); }
		}, source);
		// A new document imports a new Store and spawns a new worker on the same origin.
		await page.reload();
		await page.evaluate(async source => {
			const { open } = await import(`/${source}/store.js`);
			const store = await open(`keep-test-${source}`).catch(error => { throw new Error(`${source} open: ${error.message}`); });
			const call = store.call.bind(store);
			store.call = (op, ...args) => call(op, ...args).catch(error => { throw new Error(`${source} ${op}: ${error.message}`); });
			const same = (got, want) => got?.length === want.length && want.every((b, i) => got[i] === b);
			try {
				await store.hold();
				if (!same(await store.get('journal/partial'), [20, 30]) || !same(await store.get('slots/partial'), [20, 30])) throw new Error('partial buffer bytes changed across reopen');
				const view = await store.get('slots/view-0');
				if (view?.length !== 256 * 1024 || !view.every((b, i) => b === i % 251)) throw new Error('acknowledged view changed across reopen');
				if (!same(await store.get('slots/view-1'), [9, 2, 6])) throw new Error('second slot did not survive');
				await store.keep('slots/view-0', new Uint8Array([5, 8, 9]));
				// Opaque malformed bytes model a torn/corrupt slot. Rust, not this
				// byte bridge, authenticates it and chooses the retained fallback.
				await store.keep('slots/view-1', new Uint8Array([0]));
				if (!same(await store.get('journal/0001'), [31, 41, 59])) throw new Error('authoritative history changed');
			} finally { await store.close(); }
		}, source);
		await page.reload();
		await page.evaluate(async source => {
			const { open } = await import(`/${source}/store.js`);
			const store = await open(`keep-test-${source}`).catch(error => { throw new Error(`${source} open: ${error.message}`); });
			const call = store.call.bind(store);
			store.call = (op, ...args) => call(op, ...args).catch(error => { throw new Error(`${source} ${op}: ${error.message}`); });
			const same = (got, want) => got?.length === want.length && want.every((b, i) => got[i] === b);
			try {
				await store.hold();
				if (!same(await store.get('slots/view-0'), [5, 8, 9])) throw new Error('replacement slot did not persist');
				if (!same(await store.get('slots/view-1'), [0])) throw new Error('damaged slot fixture missing');
				if (!same(await store.get('journal/0001'), [31, 41, 59])) throw new Error('history changed after slot replacement');
			} finally { await store.close(); }
		}, source);
		console.log(`PASS ${engine} ${source}: Keep acknowledged, two real OPFS document/worker reopens, other slot/history preserved`);
	}
} finally {
	try { await context?.close(); }
	finally {
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		await rm(profile, { recursive: true, force: true });
	}
}
