// A newer release, switched to at a safe point (PEERS.md §7, `Aven.ID.Release`), on avenOS's release build as Caddy
// serves it (prod.mjs, `served`, at http://localhost:5175, one of production's stand-in's origins), with a release
// record beside it as the release workflow writes one (deploy/release.mjs), in Chromium, WebKit and Firefox:
//
//   1. Release 1 is served. Each engine signs in (Chromium signs up first, the others with its passkey); its Service
//      Worker takes release 1's record as the release it runs. Each starts a line in the chat: a draft.
//   2. Release 2 is served: its page differs. The Service Worker checks (the hourly check, asked now), downloads it,
//      has the Peer-Light check it, and every tab is told it is ready. A tab in use doesn't switch; once hidden, it
//      shows "Updating…", reloads into release 2, and its draft is there.
//   3. Release 3 is served with a page whose bytes aren't the ones its record names: the Peer-Light refuses it, the
//      tabs are told why, and nobody switches.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { record } from '../deploy/release.mjs';
import { served } from './prod.mjs';

const run = process.argv[2] ?? 'runs/latest';
const origin = 'http://localhost:5175';
const root = '/tmp/avensandbox-release';
const problems = [];
const report = { engines: {} };
const started = Date.now();
const engines = [chromium, webkit, firefox];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const seen = (locator, timeout = 30_000) =>
	locator
		.first()
		.waitFor({ timeout })
		.then(() => true, () => false);
const shot = (page, name) => page.screenshot({ path: `${run}/release-${name}.png` }).catch(() => {});
const until = async (page, test, timeout) => {
	for (const end = Date.now() + timeout; Date.now() < end; await wait(250))
		if (await page.evaluate(test).catch(() => false)) return true;
	return false;
};

// release n: the build, its page marked n, and its record
const amd64 = 'd'.repeat(64);
function publish(n, { tamper = false } = {}) {
	const page = `${root}/index.html`;
	const html = readFileSync('/work/dist/index.html', 'utf8').replace('<head>', `<head><meta name="aven-release" content="${n}">`);
	writeFileSync(page, html);
	const made = record(root, `26.10.31v${n}`, n, { 'linux/amd64': amd64 });
	if (tamper) writeFileSync(page, html.replace(`content="${n}"`, `content="${n}-tampered"`));
	writeFileSync(`${root}/release.json`, JSON.stringify(made));
}
const marked = (page) => page.evaluate(() => document.querySelector('meta[name="aven-release"]')?.content).catch(() => null);
const told = (page) => page.evaluate(() => globalThis.__avenRelease ?? null).catch(() => null);
const check = (page) => page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ release: 'check' }));
// hidden, as a tab in the background is: what a person does by switching away, which a headless page can't
const hide = (page) =>
	page.evaluate(() => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	});

rmSync(root, { recursive: true, force: true });
cpSync('/work/dist', root, { recursive: true });
publish(1);
const server = await served({ root, port: 5175 });
const tabs = {};
try {
	// 1. Signed in on release 1, which each Service Worker takes as the release it runs; a draft in each
	let passkey;
	let account;
	for (const engine of engines) {
		const name = engine.name();
		const got = (report.engines[name] = {});
		const dir = `/tmp/avensandbox-release-${name}`;
		rmSync(dir, { recursive: true, force: true });
		const context = await engine.launchPersistentContext(dir, { viewport: { width: 1000, height: 760 } });
		if (passkey) await context.credentials.create(passkey.rpId, passkey);
		await context.credentials.install();
		const page = context.pages()[0] ?? (await context.newPage());
		tabs[name] = { context, page };
		await page.goto(`${origin}/`);
		await page.locator('[data-testid="status"][data-phase="live"]').waitFor({ timeout: 30_000 }).catch(() => {});
		if (!passkey) {
			await page.getByTestId('name').fill('Ada');
			await page.getByTestId('claim').click();
		} else await page.getByTestId('sign-in').click({ timeout: 30_000 }).catch(() => problems.push(`${name} finds no sign-in`));
		if (!(await seen(page.locator('[data-view="dashboard"]')))) problems.push(`${name} opened no dashboard`);
		account ??= await page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
		[passkey] = await context.credentials.get({ rpId: 'localhost' });
		got.running = await until(page, () => globalThis.__avenRelease?.running === 1, 30_000);
		if (!got.running) problems.push(`${name}'s Service Worker never took release 1 as the one it runs: ${JSON.stringify(await told(page))}`);
		await page.goto(`${origin}/#/${account}/chat`);
		await page.getByTestId('line').fill(`a draft from ${name}`);
		await page.getByTestId('line').press('End');
		await page.evaluate(() => (window.__beforeRelease = true));
	}

	// 2. Release 2: ready everywhere, switched to only once a tab is hidden, its draft kept
	publish(2);
	await Promise.all(
		engines.map(async (engine) => {
			const name = engine.name();
			const { page } = tabs[name];
			const got = report.engines[name];
			const since = Date.now();
			// in use: a key pressed just now, so only hiding it lets it switch
			await page.getByTestId('line').press('End');
			await check(page);
			got.ready = await until(page, () => globalThis.__avenRelease?.ready?.counter === 2, 60_000);
			got.readyMs = Date.now() - since;
			if (!got.ready) return problems.push(`${name}: release 2 was never ready: ${JSON.stringify(await told(page))}`);
			await wait(3_000);
			got.waitedInUse = (await page.evaluate(() => window.__beforeRelease).catch(() => false)) === true;
			if (!got.waitedInUse) problems.push(`${name} switched while in use`);
			await hide(page);
			got.updating = await seen(page.getByTestId('updating'), 10_000);
			got.reloaded = await until(page, () => window.__beforeRelease === undefined, 30_000);
			got.marked = await marked(page);
			if (!got.reloaded || got.marked !== '2') problems.push(`${name}, hidden: no switch to release 2 (${JSON.stringify(got)})`);
			const draft = `a draft from ${name}`;
			got.draft = (await page.getByTestId('line').inputValue({ timeout: 20_000 }).catch(() => null)) === draft;
			if (!got.draft) problems.push(`${name}'s draft is gone after the switch`);
			await shot(page, `${name}-switched`);
		}),
	);

	// 3. Release 3, its page not the bytes its record names: refused, and nobody switches
	publish(3, { tamper: true });
	await Promise.all(
		engines.map(async (engine) => {
			const name = engine.name();
			const { page } = tabs[name];
			const got = report.engines[name];
			await page.evaluate(() => (window.__beforeRelease = true));
			await check(page);
			got.refused = await until(page, () => globalThis.__avenRelease?.refused === 'file /index.html', 60_000);
			if (!got.refused) problems.push(`${name}: a tampered release 3 wasn't refused: ${JSON.stringify(await told(page))}`);
			await hide(page);
			await wait(3_000);
			got.stayed = (await page.evaluate(() => window.__beforeRelease).catch(() => false)) === true && (await marked(page)) === '2';
			if (!got.stayed) problems.push(`${name} switched to a tampered release`);
		}),
	);
} catch (error) {
	problems.push(`the release check stopped: ${error?.message ?? error}`);
}
for (const { context } of Object.values(tabs)) await context.close().catch(() => {});
server.close();

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/release.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`release: ${problem}`);
if (report.ok) console.log(`release: checked, switched at a safe point with every draft, and a tampered one refused (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(report.ok ? 0 : 1);
