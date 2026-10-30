// Serves the suite's wasm on localhost (OPFS needs a secure context), opens it in Playwright's Chromium, and
// prints the report. Exits non-zero unless every case passed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = process.argv[2];
const page = `<!doctype html><script type="module">
import init, { conformance } from './opfs_conformance.js';
await init();
window.report = await conformance('aven-db-store-' + Date.now());
</script>`;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
	if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
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
	const report = await (await tab.waitForFunction(() => window.report, null, { timeout: 120_000 })).jsonValue();
	console.log(`opfs, ${await browser.version()}:\n${report}`);
	process.exitCode = report.startsWith('passed') ? 0 : 1;
} finally {
	await browser.close();
	server.close();
}
