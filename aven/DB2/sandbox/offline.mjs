// Offline first, checked (README rule 3, "a device's own log is its truth and never waits for another peer"; Samuel's
// iPhone on aven.maia.city, 30 Oct 2026: "Sign in with your passkey", "offline", "Unable to connect to remote"), on
// production's stand-in at http://localhost:5174, in Chromium, WebKit and Firefox, with Playwright's
// `context.credentials` as engines.mjs uses it. One run, around what only the host can do: stopping the Aven Peer and
// starting it again. The script writes `offline-stop-<n>` and `offline-start-<n>` into the run's folder when it wants
// that, and waits for the host's `offline-stopped-<n>` and `offline-started-<n>` (up.mjs, `offlines`).
//
//   1. With the Aven Peer up, on an empty store: Chromium signs up, so claims the network; WebKit and Firefox sign in
//      with its passkey, as synced ones. Each says a line, and each line reaches the Aven Peer.
//   2. The Aven Peer stops. Each returning browser reloads and opens its dashboard and its chat with their history
//      from what it keeps, and says plainly that it can't reach the network, never "Unable to connect to remote";
//      each writes a line, which survives two reloads.
//   3. Still stopped: a new Chromium shows "Sign in with your passkey" while it connects, taps it once, and is told it
//      joins as soon as it reaches the network; a reload keeps that.
//   4. The Aven Peer starts again: without a reload or a tap, every returning browser goes live, the lines written
//      offline reach the others, and the new browser opens its vault's dashboard by itself. Then 3 and 4 again for a
//      new WebKit and a new Firefox, one stop each: Playwright's passkey counts its signatures, so its copies must sign
//      in one after another (a synced passkey on a phone keeps its counter at 0).
//   5. The host itself can't be reached (aven.maia.city down, or the phone without a network): avenOS's release build,
//      served as Caddy serves it (prod.mjs, `served`, at localhost:5175, one of the prod peer's origins). Each engine
//      signs in there once, online, so its Service Worker keeps the shell (public/files-sw.js); then the host stops,
//      page and relay both, and a reload still opens the dashboard from the cached shell and what the Peer-Light keeps,
//      saying it is offline; the host comes back, and the page goes live without a reload.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { served } from './prod.mjs';

const run = process.argv[2] ?? 'runs/latest';
const origin = 'http://localhost:5174';
mkdirSync(run, { recursive: true });
const problems = [];
const report = { engines: {} };
const started = Date.now();
const stamp = started.toString(36);
const engines = [chromium, webkit, firefox];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const seen = (locator, timeout = 30_000) =>
	locator
		.first()
		.waitFor({ timeout })
		.then(() => true, () => false);
const text = async (locator) => (await locator.first().textContent({ timeout: 1_000 }).catch(() => '')).trim();
const shot = (page, name) => page.screenshot({ path: `${run}/offline-${name}.png` }).catch(() => {});

// the host's part: stop or start the Aven Peer, and wait until it says it has
let stops = 0;
async function host(what) {
	if (what === 'stop') stops++;
	writeFileSync(`${run}/offline-${what}-${stops}`, `${Date.now()}\n`);
	const done = `${run}/offline-${what === 'stop' ? 'stopped' : 'started'}-${stops}`;
	for (let i = 0; i < 240 && !existsSync(done); i++) await wait(500);
	if (!existsSync(done)) throw new Error(`the host never ${what === 'stop' ? 'stopped' : 'started'} the Aven Peer`);
}

async function launch(engine, name, passkey) {
	const dir = `/tmp/avensandbox-offline-${engine.name()}-${name}`;
	rmSync(dir, { recursive: true, force: true });
	const context = await engine.launchPersistentContext(dir, { viewport: { width: 1000, height: 760 } });
	if (passkey) await context.credentials.create(passkey.rpId, passkey);
	await context.credentials.install();
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`${origin}/`);
	return { context, page };
}

const dashboard = (page, timeout) => seen(page.locator('[data-view="dashboard"]'), timeout);
const accountOf = (page) => page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
async function say(page, account, line) {
	if (!page.url().includes('/chat')) await page.goto(`${origin}/#/${account}/chat`);
	await page.getByTestId('line').fill(line);
	await page.getByTestId('say').click();
	return seen(page.getByTestId('lines').getByText(line), 10_000);
}
const shows = (page, line, timeout) => seen(page.getByTestId('lines').getByText(line), timeout);
// a line of its own the Aven Peer holds: shown without "sending"
const sent = (page, line, timeout) => seen(page.getByTestId('lines').locator('li', { hasText: line }).filter({ hasNot: page.getByTestId('sending') }), timeout);

const returning = {};
const fresh = {};
try {
	// 1. The network claimed by Chromium; WebKit and Firefox sign in with its passkey
	let passkey;
	let account;
	for (const engine of engines) {
		const name = engine.name();
		const b = await launch(engine, 'returning', passkey);
		returning[name] = b;
		await b.page.locator('[data-testid="status"][data-phase="live"]').waitFor({ timeout: 30_000 }).catch(() => {});
		if (!passkey) {
			await b.page.getByTestId('name').fill('Ada');
			await b.page.getByTestId('claim').click();
		} else {
			await b.page.getByTestId('sign-in').click({ timeout: 30_000 }).catch(() => problems.push(`${name} finds no sign-in`));
		}
		if (!(await dashboard(b.page))) problems.push(`${name} opened no dashboard: "${await text(b.page.getByTestId('refused'))}"`);
		account ??= await accountOf(b.page);
		// the next copy counts on from this one's signature
		[passkey] = await b.context.credentials.get({ rpId: 'localhost' });
		const line = `before, from ${name}, ${stamp}`;
		if (!(await say(b.page, account, line))) problems.push(`${name}'s line was not shown`);
		if (!(await sent(b.page, line, 20_000))) problems.push(`${name}'s line never reached the Aven Peer`);
	}

	// every browser holds every line from before, so what it shows offline is what it kept
	for (const engine of engines)
		for (const other of engines)
			if (!(await shows(returning[engine.name()].page, `before, from ${other.name()}, ${stamp}`, 30_000)))
				problems.push(`${engine.name()} never got ${other.name()}'s line before the Aven Peer stopped`);

	// 2. The Aven Peer stops: each returning browser opens from what it keeps
	await host('stop');
	for (const engine of engines) {
		const name = engine.name();
		const { page } = returning[name];
		const got = (report.engines[name] = {});
		const since = Date.now();
		await page.goto(`${origin}/`);
		await page.reload();
		got.dashboard = await dashboard(page, 15_000);
		got.openMs = Date.now() - since;
		if (!got.dashboard) problems.push(`${name}, the Aven Peer stopped: no dashboard from what it keeps (${await text(page.locator('main'))})`);
		got.offline = await seen(page.getByTestId('offline'), 20_000);
		got.said = (await page.locator('body').textContent()).includes('Unable to connect');
		if (!got.offline || got.said) problems.push(`${name}, the Aven Peer stopped: offline isn't said plainly: ${JSON.stringify(got)}`);
		await shot(page, `${name}-stopped-dashboard`);
		await page.goto(`${origin}/#/${account}/chat`);
		for (const other of engines)
			if (!(await shows(page, `before, from ${other.name()}, ${stamp}`, 10_000))) problems.push(`${name}, offline: its chat has no "${other.name()}" line from before`);
		const line = `offline, from ${name}, ${stamp}`;
		if (!(await say(page, account, line))) problems.push(`${name}'s line written offline was not shown`);
		for (const reload of [1, 2]) {
			await page.reload();
			if (!(await shows(page, line, 15_000))) problems.push(`${name}'s line written offline is gone after reload ${reload}`);
		}
		await shot(page, `${name}-stopped-chat`);
	}

	// 3. Still stopped: a new browser signs in with one tap, and is told it joins once it is back
	async function signInOffline(engine) {
		const name = engine.name();
		const b = await launch(engine, 'new', passkey);
		fresh[name] = b;
		const got = (report.engines[name].fresh = {});
		got.button = await seen(b.page.getByTestId('sign-in'), 20_000);
		if (!got.button) problems.push(`a new ${name}, the Aven Peer stopped: no "Sign in with your passkey"`);
		else await b.page.getByTestId('sign-in').click({ timeout: 10_000 }).catch(() => {});
		got.pending = await seen(b.page.getByTestId('signed-in-pending'), 15_000);
		[passkey] = await b.context.credentials.get({ rpId: 'localhost' });
		await b.page.reload();
		got.kept = await seen(b.page.getByTestId('signed-in-pending'), 15_000);
		if (!got.pending || !got.kept) problems.push(`a new ${name}'s sign-in made offline isn't kept waiting: ${JSON.stringify(got)}`);
		await shot(b.page, `${name}-new-pending`);
	}
	// 4b. The new browser joins by itself once the Aven Peer is back
	async function joins(engine, back) {
		const name = engine.name();
		const { page } = fresh[name];
		const got = report.engines[name].fresh;
		got.joined = await dashboard(page, 60_000);
		got.joinedMs = Date.now() - back;
		got.account = await accountOf(page);
		if (!got.joined || got.account !== account) problems.push(`a new ${name} didn't join ${account} by itself once the Aven Peer was back: ${JSON.stringify(got)}`);
		await shot(page, `${name}-new-joined`);
	}
	await signInOffline(chromium);

	// 4. The Aven Peer is back: no reload, no tap
	await host('start');
	const back = Date.now();
	for (const engine of engines) {
		const name = engine.name();
		const { page } = returning[name];
		const got = report.engines[name];
		// the dashboard shows the status line; a change of hash is no reload
		await page.goto(`${origin}/#/${account}`);
		got.live = await seen(page.locator('[data-testid="status"][data-phase="live"]'), 60_000);
		got.liveMs = Date.now() - back;
		if (!got.live) problems.push(`${name} didn't go live by itself once the Aven Peer was back`);
	}
	for (const engine of engines) {
		const { page } = returning[engine.name()];
		await page.goto(`${origin}/#/${account}/chat`);
		for (const other of engines)
			if (!(await shows(page, `offline, from ${other.name()}, ${stamp}`, 60_000)))
				problems.push(`${other.name()}'s line written offline never reached ${engine.name()}`);
		await shot(page, `${engine.name()}-back-chat`);
	}
	await joins(chromium, back);
	for (const engine of [webkit, firefox]) {
		await host('stop');
		await signInOffline(engine);
		await host('start');
		await joins(engine, Date.now());
	}

	// 5. The host unreachable: the release build, from the shell its Service Worker keeps
	const at = 'http://localhost:5175';
	const sockets = new Set();
	const serve = async () => {
		const server = await served({ root: '/work/dist', port: 5175 });
		server.on('connection', (socket) => (sockets.add(socket), socket.on('close', () => sockets.delete(socket))));
		return server;
	};
	let server = await serve();
	for (const engine of engines) {
		const name = engine.name();
		const got = (report.engines[name].shell = {});
		const dir = `/tmp/avensandbox-offline-${name}-shell`;
		rmSync(dir, { recursive: true, force: true });
		const context = await engine.launchPersistentContext(dir, { viewport: { width: 1000, height: 760 } });
		await context.credentials.create(passkey.rpId, passkey);
		await context.credentials.install();
		const page = context.pages()[0] ?? (await context.newPage());
		try {
			await page.goto(`${at}/`);
			await page.getByTestId('sign-in').click({ timeout: 30_000 });
			got.signedIn = await dashboard(page, 30_000);
			[passkey] = await context.credentials.get({ rpId: 'localhost' });
			// the shell kept: the page and the Peer-Light's wasm, which the Service Worker caches once it is installed
			got.kept = await page.evaluate(async () => {
				await navigator.serviceWorker.ready;
				for (let i = 0; i < 300; i++) {
					const cache = await caches.open('aven-shell-1');
					if ((await cache.match('/')) && (await cache.match('/peer-light/aven_peer_light_bg.wasm'))) return true;
					await new Promise((done) => setTimeout(done, 100));
				}
				return false;
			});
			// a moment, as a person who just signed in: the Peer-Light keeps the network it was told right after it tells
			// the page, and Firefox's OPFS takes its time. A browser closed in that moment opens on "Sign in" until it is
			// online again
			await wait(3_000);
			// the host goes: its page and its relay
			const closed = new Promise((done) => server.close(done));
			for (const socket of sockets) socket.destroy();
			await closed;
			const since = Date.now();
			await page.reload();
			got.opened = await dashboard(page, 20_000);
			got.openMs = Date.now() - since;
			got.offline = await seen(page.getByTestId('offline'), 30_000);
			await shot(page, `${name}-host-unreachable`);
			// back: live again without a reload
			server = await serve();
			got.live = await seen(page.locator('[data-testid="status"][data-phase="live"]'), 60_000);
		} catch (error) {
			got.why = error.message.split('\n')[0];
			if (!server.listening) server = await serve();
		}
		if (!got.signedIn || !got.kept || !got.opened || !got.offline || !got.live)
			problems.push(`${name}, the host unreachable: the release build didn't open from its kept shell: ${JSON.stringify(got)}`);
		await context.close();
	}
	server.close();
	for (const socket of sockets) socket.destroy();
} catch (error) {
	problems.push(`offline: ${error?.message ?? error}`);
} finally {
	for (const b of [...Object.values(returning), ...Object.values(fresh)]) await b.context.close().catch(() => {});
}

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/offline.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: offline: ${problem}`);
console.log(`avenSANDBOX: offline: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
