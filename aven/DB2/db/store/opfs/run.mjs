// Serves the suite's wasm on localhost (OPFS needs a secure context), opens it in Playwright's Chromium, and
// prints the report. It runs twice: on the page, and in a worker, where the Peer-Light runs and which has no `window`.
// Exits non-zero unless every case passed in both.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = process.argv[2];
const page = `<!doctype html><script type="module">
import init, { conformance } from './opfs_conformance.js';
await init();
const page = await conformance('aven-db-store-page-' + Date.now());
const worker = new Worker('./worker.js', { type: 'module' });
const inWorker = await new Promise((done) => {
	worker.onmessage = ({ data }) => done(data);
	worker.onerror = (e) => done('FAILED: the worker threw ' + e.message);
});
window.report = { page, worker: inWorker };
</script>`;
const worker = `import init, { conformance } from './opfs_conformance.js';
try {
	await init();
	postMessage(await conformance('aven-db-store-worker-' + Date.now()));
} catch (e) {
	postMessage('FAILED: ' + (e?.message ?? e));
}`;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
	if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
	if (req.url === '/worker.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(worker);
	try {
		const file = await readFile(join(dir, req.url.slice(1)));
		res.writeHead(200, { 'content-type': types[req.url.slice(req.url.lastIndexOf('.'))] ?? 'application/octet-stream' }).end(file);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const browser = await chromium.launch();
try {
	const tab = await browser.newPage();
	tab.on('pageerror', (e) => console.error(`page error: ${e.message}`));
	tab.on('console', (m) => m.type() === 'error' && console.error(`console: ${m.text()}`));
	await tab.goto(`http://localhost:${server.address().port}/`);
	const report = await (await tab.waitForFunction(() => window.report, null, { timeout: 240_000 })).jsonValue();
	for (const [where, text] of Object.entries(report)) console.log(`opfs, ${where}, ${await browser.version()}:\n${text}`);
	process.exitCode = Object.values(report).every((text) => text.startsWith('passed')) ? 0 : 1;
} finally {
	await browser.close();
	server.close();
}
