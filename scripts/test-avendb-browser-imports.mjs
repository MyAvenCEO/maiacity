/** Actual Chromium module-graph smoke check: no WASM startup, account, or native peer required. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixturePath } from './avendb-browser-fixture-path.mjs';
const { chromium } = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = resolve(root, 'src/lib/avendb/device');
const missing = [];
const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script type="module" src="/fixture.js"></script>'); return; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(fixturePath(path, root, pkg))); }
    catch (error) { missing.push(`${path}: ${error.message}`); res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.AVENDB_CHROMIUM || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => !!window.fixture, null, { timeout: 10000 });
    assert.deepEqual(missing, [], 'every transitive production module must have a fixture route');
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => typeof window.fixture.start), 'function');
    console.log('PASS: actual Chromium loads the production remote-worker fixture module graph without 404s.');
} finally {
    await browser?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (missing.length) console.error(missing.join('\n'));
}
