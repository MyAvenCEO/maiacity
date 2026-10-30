// Serves the suite's wasm on localhost (OPFS needs a secure context), opens it in Playwright's Chromium, WebKit
// (Safari's engine) and Firefox, and prints the report. In each it runs three times: on the page, in a worker, which
// has no `window`, and in a shared worker, where the Peer-Light runs. WebKit has OPFS only with a profile directory
// (`launchPersistentContext`). Exits non-zero unless every case passed everywhere.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

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
const shared = new SharedWorker('./worker.js?shared', { type: 'module' });
const inShared = await new Promise((done) => {
	shared.port.onmessage = ({ data }) => done(data);
	shared.onerror = (e) => done('FAILED: the shared worker threw ' + e.message);
});
window.report = { page, worker: inWorker, 'shared worker': inShared };
</script>`;
// a shared worker answers its first page's port; a worker, its page
const worker = `import init, { conformance } from './opfs_conformance.js';
const port = await new Promise((done) => ('onconnect' in self ? (self.onconnect = (e) => done(e.ports[0])) : done(self)));
try {
	await init();
	port.postMessage(await conformance('aven-db-store-' + ('onconnect' in self ? 'shared' : 'worker') + '-' + Date.now()));
} catch (e) {
	port.postMessage('FAILED: ' + (e?.message ?? e));
}`;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
	if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
	if (req.url.startsWith('/worker.js')) return res.writeHead(200, { 'content-type': 'text/javascript' }).end(worker);
	try {
		const file = await readFile(join(dir, req.url.slice(1)));
		res.writeHead(200, { 'content-type': types[req.url.slice(req.url.lastIndexOf('.'))] ?? 'application/octet-stream' }).end(file);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
// every engine at once, each on a profile of its own; each prints its report whole
async function run(engine) {
	const profile = await mkdtemp(join(tmpdir(), `opfs-${engine.name()}-`));
	const context = await engine.launchPersistentContext(profile);
	const version = context.browser()?.version() ?? '';
	try {
		const tab = context.pages()[0] ?? (await context.newPage());
		tab.on('pageerror', (e) => console.error(`${engine.name()} page error: ${e.message}`));
		tab.on('console', (m) => m.type() === 'error' && console.error(`${engine.name()} console: ${m.text()}`));
		await tab.goto(`http://localhost:${server.address().port}/`);
		const report = await (await tab.waitForFunction(() => window.report, null, { timeout: 240_000 })).jsonValue();
		console.log(Object.entries(report).map(([where, text]) => `opfs, ${where}, ${engine.name()} ${version}:\n${text}`).join('\n'));
		return Object.values(report).every((text) => text.startsWith('passed'));
	} finally {
		await context.close();
		await rm(profile, { recursive: true, force: true });
	}
}
const passed = await Promise.all([chromium, webkit, firefox].map(run));
server.close();
process.exitCode = passed.every(Boolean) ? 0 : 1;
