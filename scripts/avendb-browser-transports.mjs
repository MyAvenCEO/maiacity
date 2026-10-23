/** Real Chromium carrier harness, launched by the ignored browser/tests/transports.rs target.
 * AVENDB_PKG is a freshly rebuilt localhost-passkeys WASM package. It never serves or opens a live account.
 * This fixture explicitly opts in to optional carriers. Response instrumentation observes packet counts/ready state;
 * authentication and packet flow are unchanged.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = process.env.AVENDB_PKG;
if (!pkg || !existsSync(join(pkg, 'avendb_browser_bg.wasm'))) throw new Error('AVENDB_PKG must be a rebuilt browser package');
const chrome = process.env.AVENDB_CHROMIUM ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error('AVENDB_CHROMIUM must name installed Chromium');
const input = createInterface({ input: process.stdin });
const inbox = input[Symbol.asyncIterator]();
const next = async () => { const { value, done } = await inbox.next(); if (done) throw new Error('native fixture ended'); return JSON.parse(value); };
const say = (value) => { if (!finishing && !process.stdout.destroyed) process.stdout.write(`${JSON.stringify(value)}\n`); };
const replace = (text, from, to) => { assert.equal(text.split(from).length, 2, `one observable marker: ${from}`); return text.replace(from, to); };
const probe = `
window.__transport = Object.create(null);
window.__probe = (kind, bytes = 1) => { window.__transport[kind] = (window.__transport[kind] ?? 0) + bytes; };
const ActualWorker = window.Worker;
window.Worker = class extends ActualWorker {
 constructor(...args) { super(...args); this.addEventListener('message', ({data}) => { if (data?.$probe) window.__probe(data.$probe, data.bytes); }); }
};
`;
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Disposable avenDB transport test</title>'); return; }
        if (path === '/device') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script>${probe}</script><script type="module" src="/fixture.js"></script>`); return; }
        if (path.includes('..')) throw new Error('invalid path');
        let file;
        if (path === '/fixture.js') file = join(root, 'avendb/crates/avendb-browser/tests/transports/device.js');
        else if (path === '/passkey.js') file = join(root, 'avendb/crates/avendb-browser/js/passkey.js');
        else if (path.startsWith('/client/device/avendb_browser')) file = join(pkg, path.slice('/client/device/'.length));
        else if (path.startsWith('/client/device/snippets/')) file = join(pkg, path.slice('/client/device/'.length));
        else if (path.startsWith('/client/')) file = join(root, 'src/lib/avendb', path.slice('/client/'.length));
        else throw new Error('not found');
        let body = await readFile(file);
        if (path.endsWith('/transports/config.js')) {
            // Serve the same explicit opt-in as VITE_AVENDB_BROWSER_CARRIERS=true; production defaults stay off.
            body = Buffer.from(replace(body.toString(), 'import.meta.env?.VITE_AVENDB_BROWSER_CARRIERS', "'true'"));
        }
        if (path.endsWith('/transports/webtransport.js')) {
            let text = body.toString();
            text = replace(text, 'transport = new WebTransport(url.href, { allowPooling: false, requireUnreliable: true, serverCertificateHashes });',
                'transport = new WebTransport(url.href, { allowPooling: false, requireUnreliable: true, serverCertificateHashes }); (globalThis.__testWebTransports ??= new Set()).add(transport);');
            text = replace(text, "await event({ kind: 'ready', mtu });", "await event({ kind: 'ready', mtu }); globalThis.postMessage({ $probe: 'wt-ready' });");
            text = replace(text, 'await writer.write(bytes); return true;', "await writer.write(bytes); globalThis.postMessage({ $probe: 'wt-send', bytes: bytes.byteLength }); return true;");
            text = replace(text, 'if (packet(value)) await receive(value);', "if (packet(value)) { await receive(value); globalThis.postMessage({ $probe: 'wt-receive', bytes: value.byteLength }); }");
            text = replace(text, '} catch (error) { close(error); }', "} catch (error) { globalThis.postMessage({ $probe: 'wt-error' }); close(error); }");
            body = Buffer.from(text);
        }
        if (path.endsWith('/transports/worker.js')) {
            let text = body.toString();
            text = replace(text, 'const { route: key, epoch } = command;', "globalThis.postMessage({ $probe: 'broker-' + command.kind }); const { route: key, epoch } = command;");
            text = replace(text, 'await device.transport_event({ ...value, route: key, epoch }); return true;', "await device.transport_event({ ...value, route: key, epoch }).catch((error) => { console.warn('carrier event failed', value.kind, String(error)); throw error; }); globalThis.postMessage({ $probe: 'event-' + value.kind }); return true;");
            text = replace(text, '} catch { /* A failed/older broker leaves its normal relay and device APIs intact. */ }', "} catch (error) { console.warn('carrier pump failed', String(error)); globalThis.postMessage({ $probe: 'pump-error' }); }");
            body = Buffer.from(text);
        }
        if (path.endsWith('/transports/webrtc.js')) {
            let text = body.toString();
            text = replace(text, "if (!stopped) settle(true);", "if (!stopped) { globalThis.__probe?.('rtc-ready'); settle(true); }");
            text = replace(text, 'channel.send(bytes); return true;', "channel.send(bytes); globalThis.__probe?.('rtc-send', bytes.byteLength); return true;");
            text = replace(text, 'incoming++; incomingBytes += bytes.byteLength;', "globalThis.__probe?.('rtc-receive', bytes.byteLength); incoming++; incomingBytes += bytes.byteLength;");
            body = Buffer.from(text);
        }
        res.setHeader('Content-Type', extname(file) === '.wasm' ? 'application/wasm' : 'text/javascript');
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'avendb-carrier-chromium-'));
let browser, launching, cleanupPromise, progressTimer, finishing = false, stage = 'launch', snapshots;
const progress = (value) => { stage = value; process.stderr.write(`carrier phase: ${stage}\n`); };
// A native assertion can close either pipe while an async browser step is running. Both
// paths share teardown, including a launch still in flight; never exit before our Chrome/profile close.
const cleanup = () => cleanupPromise ??= (async () => {
    finishing = true; clearInterval(progressTimer); input.close(); process.stdin.destroy();
    const owned = browser ?? await launching?.catch(() => undefined);
    try { await owned?.close(); }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        await rm(profile, { recursive: true, force: true });
    }
})();
const interrupted = () => {
    if (finishing) return;
    process.exitCode = 1;
    void cleanup().catch((error) => process.stderr.write(`carrier cleanup: ${error.message}\n`));
};
process.stdin.on('end', interrupted);
process.stdout.on('error', interrupted);
const until = async (what, check, timeout = 60_000) => {
    const end = Date.now() + timeout;
    while (!(await check())) { if (Date.now() > end) throw new Error(`timeout: ${what}`); await new Promise((resolve) => setTimeout(resolve, 100)); }
};
try {
    browser = await (launching = puppeteer.launch({ executablePath: chrome, userDataDir: profile, headless: true,
        args: ['--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--host-resolver-rules=MAP localhost 127.0.0.1'], protocolTimeout: 180_000 }));
    if (finishing) throw new Error('native fixture ended during browser launch');
    const page = await browser.newPage();
    page.on('pageerror', (error) => process.stderr.write(`browser page error: ${String(error.message).replace(/[0-9a-f]{64}/gi, '<hex>')}\n`));
    page.on('console', (message) => { if (['error', 'warn'].includes(message.type())) process.stderr.write(`browser ${message.type()}: ${message.text().replace(/[0-9a-f]{64}/gi, '<hex>')}\n`); });
    await page.goto(origin);
    const cdp = await page.createCDPSession();
    await cdp.send('WebAuthn.enable', { enableUI: false });
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
    } });
    say({ step: 'listening', origin, browser: await browser.version() });
    const config = await next();
    const frame = async (name) => {
        await page.evaluate((name) => { const frame = document.createElement('iframe'); frame.name = name; frame.src = `/device?name=${name}`; document.body.append(frame); }, name);
        let found; await until('frame fixture', async () => { found = page.frames().find((frame) => frame.name() === name); return found && await found.evaluate(() => !!window.fixture); });
        return found;
    };
    progress('first device founding');
    const first = await frame('first');
    const alice = await first.evaluate((config) => window.fixture.start({ name: 'first', ...config }), config);
    progress('second device linking');
    const second = await frame('second');
    const bob = await second.evaluate((config) => window.fixture.start(config), { name: 'second', relay: config.relay, offer: alice.offer });
    const metrics = snapshots = async () => Promise.all([first, second].map((frame) => frame.evaluate(() => ({ ...window.__transport }))));
    let reporting = false;
    progressTimer = setInterval(async () => {
        if (finishing || reporting) return; reporting = true;
        try { process.stderr.write(`carrier packets (${stage}): ${JSON.stringify(await metrics())}\n`); }
        catch { /* Teardown can close the frames during a diagnostic read. */ }
        finally { reporting = false; }
    }, 5000);
    progress('authorized bootstrap sync');
    const entry = await first.evaluate(() => window.fixture.write('relay bootstrap verified'));
    await until('authorized bootstrap sync', () => second.evaluate(async (entry) => (await window.fixture.text(entry)) === 'relay bootstrap verified', entry));
    // Give both protocols their bounded opening window; unavailable PQ WebTransport must retain the relay.
    progress('negotiated carrier readiness');
    await until('actual host-only RTC', async () => (await metrics()).every((m) => m['rtc-ready'] > 0));
    const wtEnd = Date.now() + 20_000;
    while (!(await metrics()).every((m) => m['wt-ready'] > 0) && Date.now() < wtEnd) await new Promise((resolve) => setTimeout(resolve, 100));
    const before = await metrics(), wt = before.every((m) => m['wt-ready'] > 0);
    say({ step: 'carriers', first: alice.endpoint, second: bob.endpoint, wt, metrics: before });
    assert.equal((await next()).op, 'write');
    progress(wt ? 'fresh edit and sealed blob with relay stopped' : 'WT unavailable, fresh edit and blob over fallback');
    const fresh = await first.evaluate(() => window.fixture.write('carrier replication verified'));
    await until('second receives carrier write', () => second.evaluate(async (entry) => (await window.fixture.text(entry)) === 'carrier replication verified', fresh));
    const file = await first.evaluate(() => window.fixture.bring());
    say({ step: 'written', entry: fresh, file });
    assert.equal((await next()).op, 'fallback');
    const wtAfter = await metrics();
    if (wt) assert(wtAfter.reduce((n, m, i) => n + (m['wt-send'] ?? 0) - (before[i]['wt-send'] ?? 0), 0) > file.len, 'fresh blob crossed actual WT datagrams');
    process.stderr.write(`WT fresh-data evidence: ${JSON.stringify({ wt, before, after: wtAfter })}\n`);
    progress('fresh edit and sealed blob after WT close and relay restart');
    // The owned relay has restarted. Remove WT availability and close the owned outer sockets only;
    // the core's normal closed-route processing and iroh fallback must preserve application authority.
    for (const worker of page.workers().filter((worker) => worker.url().endsWith('/remote.worker.js'))) {
        await worker.evaluate(() => { globalThis.WebTransport = undefined; for (const transport of globalThis.__testWebTransports ?? []) transport.close(); globalThis.__testWebTransports?.clear(); });
    }
    const fallback = await first.evaluate(() => window.fixture.write('relay fallback after carrier close'));
    const fallbackFile = await first.evaluate(() => window.fixture.bring(13));
    say({ step: 'fallback-written', entry: fallback, file: fallbackFile });
    assert.equal((await next()).op, 'offline');
    progress('fresh edit and sealed blob after native server and relay stop');
    const rtcBefore = await metrics();
    const offline = await second.evaluate(() => window.fixture.write('RTC after relay and native shutdown'));
    await until('RTC-only authorized sync', () => first.evaluate(async (entry) => (await window.fixture.text(entry)) === 'RTC after relay and native shutdown', offline));
    const rtcFile = await second.evaluate(() => window.fixture.bring(11));
    await until('RTC-only authorized blob', () => first.evaluate((file) => window.fixture.readFile(file), rtcFile));
    const after = await metrics();
    assert(after.some((m, i) => m['rtc-send'] > (rtcBefore[i]['rtc-send'] ?? 0)), 'actual RTC packets after shutdown');
    assert(after.reduce((n, m, i) => n + (m['rtc-send'] ?? 0) - (rtcBefore[i]['rtc-send'] ?? 0), 0) > rtcFile.len, 'fresh blob crossed actual RTC datagrams');
    await Promise.all([first, second].map((frame) => frame.evaluate(() => window.fixture.close())));
    say({ step: 'done', wt, rtc: true, metrics: after });
} catch (error) { say({ step: 'error', phase: stage, error: error.message, metrics: await snapshots?.().catch(() => undefined) }); process.exitCode = 1; }
finally { await cleanup(); }
