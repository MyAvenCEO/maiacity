// A shared file never runs on avenOS's origin (store/README.md, "What a file may run"), in all three of Playwright's
// engines, in the browsers' container (`bun run up --check`, after the engines' step). avenOS's origin holds the
// device's secret in OPFS, and its Service Worker (os/web/public/files-sw.js) serves the chat's files there as
// /files/<hash>, as the file registry (aven/runtimes) decides from their bytes, never as their sender claims. A member
// who shares an HTML page or an SVG with a script must not run it there: not opened in a tab of its own, not framed,
// not as an image.
//
// Here the Service Worker is served alone on localhost, and the page plays the Peer-Light's leader on its
// BroadcastChannel, answering its reads with the files a hostile member would share, each decided as the leader does:
// by the Peer-Light's own wasm (`decide`, built by `bun run up` into target/light). Each file's script, if it ever ran
// on this origin, writes to its localStorage and posts on a BroadcastChannel the page listens on. Checked:
//   1. every answer forbids sniffing and sandboxes the document; only what the registry serves inline is inline (a
//      native image, audio, video, a PDF, by its bytes), everything else is application/octet-stream and an
//      attachment, whatever its claim;
//   2. opened in a tab, framed, embedded or shown as an image, no file's script runs on the origin;
//   3. the control: the same HTML served by this server as text/html does run, so the probe would see it.
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from 'playwright';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const worker = readFileSync(new URL('../os/web/public/files-sw.js', import.meta.url));
const script = `try { localStorage.setItem('ran', location.href) } catch {} try { new BroadcastChannel('ran').postMessage(location.href) } catch {}`;
const html = `<!doctype html><title>shared</title><script>${script}</script>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>${script}</script><rect width="10" height="10"/></svg>`;
// a 1×1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const hash = (i) => i.toString(16).padStart(64, '0');
// each file as shared: its claimed type, its bytes, and how the Service Worker must serve it
const files = [
	{ name: 'an HTML page', type: 'text/html', body: html, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'an SVG', type: 'image/svg+xml', body: svg, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'an SVG in capitals', type: 'IMAGE/SVG+XML', body: svg, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'an HTML page with a charset', type: 'text/html; charset=utf-8', body: html, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'an HTML page claimed as a PNG', type: 'image/png', body: html, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'XHTML', type: 'application/xhtml+xml', body: html, served: 'application/octet-stream', as: 'attachment' },
	{ name: 'a PNG', type: 'image/png', body: png, served: 'image/png', as: 'inline' },
	{ name: 'a PNG claimed as HTML', type: 'text/html', body: png, served: 'image/png', as: 'inline' },
	{ name: 'an SVG claimed as a PNG', type: 'image/png', body: svg, served: 'application/octet-stream', as: 'attachment' },
].map((f, i) => ({ ...f, hash: hash(i + 1) }));

// the Peer-Light's wasm, as `bun run up` built it
const light = new URL('../target/light/', import.meta.url);
if (!existsSync(new URL('aven_peer_light.js', light))) {
	console.log("avenSANDBOX: inline: FAILED, the Peer-Light's wasm isn't built (bun run up builds it)");
	process.exit(1);
}
const page = `<!doctype html><title>probe</title><script type="module">
window.ran = [];
new BroadcastChannel('ran').onmessage = ({ data }) => window.ran.push(data);
const core = await import('/peer-light/aven_peer_light.js');
await core.default();
const files = ${JSON.stringify(files.map((f) => ({ hash: f.hash, type: f.type, body: Buffer.from(f.body).toString('base64') })))};
const leader = new BroadcastChannel('aven-peer-light:probe');
leader.onmessage = ({ data }) => {
	if (!data?.read) return;
	const f = files.find((f) => f.hash === data.read.file);
	if (!f) return leader.postMessage({ id: data.id, error: 'not found' });
	const bytes = Uint8Array.from(atob(f.body), (c) => c.charCodeAt(0));
	// as the leader does (peer/worker.js): the registry decides from the first 64 KiB, the size and the claim
	const how = core.decide(bytes.subarray(0, 65536), bytes.length, f.type, undefined);
	leader.postMessage({ id: data.id, size: bytes.length, type: how.inline, bytes: bytes.slice(data.read.start, data.read.end) });
};
window.ready = true;
</script>`;
const server = createServer((req, res) => {
	const path = new URL(req.url, 'http://localhost').pathname;
	if (path === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page);
	if (path === '/files-sw.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(worker);
	if (path === '/peer-light/aven_peer_light.js')
		return res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(new URL('aven_peer_light.js', light)));
	if (path === '/peer-light/aven_peer_light_bg.wasm')
		return res.writeHead(200, { 'content-type': 'application/wasm' }).end(readFileSync(new URL('aven_peer_light_bg.wasm', light)));
	if (path === '/control.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
	res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://localhost:${server.address().port}`;

async function probe(engine) {
	const problems = [];
	const say = (p) => problems.push(`${engine.name()}: ${p}`);
	const context = await engine.launchPersistentContext(`/tmp/avensandbox-inline-${engine.name()}-${Date.now()}`, { acceptDownloads: true });
	try {
		const tab = context.pages()[0] ?? (await context.newPage());
		await tab.goto(`${origin}/`);
		await tab.waitForFunction(() => window.ready, null, { timeout: 30_000 });
		await tab.evaluate(async () => {
			await navigator.serviceWorker.register('/files-sw.js?name=probe');
			await navigator.serviceWorker.ready;
			for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
		});
		if (!(await tab.evaluate(() => !!navigator.serviceWorker.controller))) {
			say('the Service Worker did not take the page');
			return problems;
		}
		// 1. the headers
		for (const f of files) {
			const got = await tab.evaluate(async (path) => {
				const r = await fetch(path);
				const h = (n) => r.headers.get(n);
				return { status: r.status, type: h('content-type'), as: h('content-disposition'), sniff: h('x-content-type-options'), csp: h('content-security-policy') };
			}, `/files/${f.hash}`);
			const want = { status: 200, type: f.served, as: f.as, sniff: 'nosniff' };
			for (const [k, v] of Object.entries(want)) if (got[k] !== v) say(`${f.name} is served with ${k} ${got[k]}, not ${v}`);
			if (!/^sandbox;/.test(got.csp ?? '') || !/default-src 'none'/.test(got.csp)) say(`${f.name} is served with the policy ${got.csp}`);
		}
		// 2. opened in a tab of its own, then framed, embedded and as an image, in the leader's page
		for (const f of files) {
			const other = await context.newPage();
			await other.goto(`${origin}/files/${f.hash}`, { timeout: 10_000 }).catch(() => {});
			await wait(500);
			await other.close();
		}
		await tab.evaluate((hashes) => {
			for (const h of hashes) {
				const frame = document.createElement('iframe');
				frame.src = `/files/${h}`;
				const object = document.createElement('object');
				object.data = `/files/${h}`;
				const img = document.createElement('img');
				img.src = `/files/${h}`;
				document.body.append(frame, object, img);
			}
		}, files.map((f) => f.hash));
		await wait(2_000);
		const ran = await tab.evaluate(() => ({ heard: window.ran, stored: localStorage.getItem('ran') }));
		if (ran.heard.length || ran.stored) say(`a shared file's script ran on avenOS's origin: ${JSON.stringify(ran)}`);
		// 3. the control: served as text/html by the server, the same page runs, and the probe sees it
		const control = await context.newPage();
		await control.goto(`${origin}/control.html`);
		await wait(500);
		await control.close();
		const seen = await tab.evaluate(() => ({ heard: window.ran.length, stored: localStorage.getItem('ran') }));
		if (!seen.heard || !seen.stored) say(`the control did not register: ${JSON.stringify(seen)}`);
	} catch (e) {
		say(`threw ${e.message}`);
	} finally {
		await context.close();
	}
	return problems;
}

const started = Date.now();
const problems = (await Promise.all([chromium, webkit, firefox].map(probe))).flat();
server.close();
writeFileSync(`${run}/inline.json`, `${JSON.stringify({ ok: !problems.length, problems, files: files.map((f) => f.name) }, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: inline: ${problem}`);
console.log(`avenSANDBOX: inline: ${problems.length ? 'FAILED' : 'ok'}, ${files.length} files in 3 engines (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
