// Serves the suite's wasm on localhost (OPFS needs a secure context), opens it in Playwright's Chromium, WebKit
// (Safari's engine) and Firefox, and prints the report. In each it runs in a dedicated worker, the only place every
// engine has sync access handles and where the Peer-Light's leader runs them. WebKit has OPFS only with a profile
// directory (`launchPersistentContext`). Exits non-zero unless every case passed and the workload met its engine's
// gates (store/README.md, "What the store asks of the opfs driver", 4): medians of a chat line and a 1 MiB chunk put,
// and catching up 500 lines, in ms. Firefox's are its own: each sync access handle costs it ~23 ms (30 Oct 2026), the
// cost pack files remove ("Next: pack files").
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const dir = process.argv[2];
const page = `<!doctype html><script type="module">
const worker = new Worker('./worker.js', { type: 'module' });
const inWorker = await new Promise((done) => {
	worker.onmessage = ({ data }) => done(data);
	worker.onerror = (e) => done('FAILED: the worker threw ' + e.message);
});
window.report = { worker: inWorker };
</script>`;
const worker = `import init, { conformance } from './opfs_conformance.js';
try {
	await init();
	self.postMessage(await conformance('aven-db-store-worker-' + Date.now()));
} catch (e) {
	self.postMessage('FAILED: ' + (e?.message ?? e));
}`;
const gates = {
	chromium: { line: 60, chunk: 30, 'catch-up': 10_000 },
	webkit: { line: 60, chunk: 30, 'catch-up': 10_000 },
	firefox: { line: 150, chunk: 100, 'catch-up': 30_000 },
};
// the report's workload lines held to the engine's gates, each a line of its own after them
function gated(engine, text) {
	let held = true;
	const lines = [];
	for (const [what, gate] of Object.entries(gates[engine])) {
		const ms = Number(text.match(new RegExp(`^workload ${what}: ([0-9.]+) ms$`, 'm'))?.[1]);
		const ok = Number.isFinite(ms) && ms <= gate;
		held &&= ok;
		lines.push(`gate ${what}: ${Number.isFinite(ms) ? ms : 'missing'} ms, ${ok ? 'within' : 'OVER'} ${gate} ms`);
	}
	return { held, text: `${text}\n${lines.join('\n')}` };
}
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
		const { held, text } = gated(engine.name(), report.worker);
		console.log(`opfs, worker, ${engine.name()} ${version}:\n${text}`);
		return report.worker.startsWith('passed') && held;
	} finally {
		await context.close();
		await rm(profile, { recursive: true, force: true });
	}
}
const passed = await Promise.all([chromium, webkit, firefox].map(run));
server.close();
process.exitCode = passed.every(Boolean) ? 0 : 1;
