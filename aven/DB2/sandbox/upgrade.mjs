// Upgrades are a clean refusal, checked (PEERS.md §7 and "How it is checked", 8): a peer of another wire version is
// refused with `update`, and the one behind follows. Around what only the host can do, restarting a Peer with
// `--wire-version` (up.mjs, `upgrades`): the script writes `upgrade-<what>` into the run's folder and waits for the
// host's `upgrade-<what>-done`.
//
//   1. On production's stand-in (http://localhost:5174), from an empty store: Chromium signs up, WebKit and Firefox
//      sign in with its passkey, and each starts a line in the chat without sending it: a draft.
//   2. The Aven Peer comes back a wire version ahead (`prod-ahead`). Every tab is refused with `update`, shows
//      "Updating…" and nothing else, and reloads by itself; its draft is in its line again after the reload.
//   3. The Aven Peer is back on this build's version (`prod-back`): every tab goes live again without a hand on it, its
//      draft still there, and sends it.
//   4. In the cast's box (http://localhost:5173), Alice Peer comes back a wire version behind (`alice-behind`): the
//      Aven Peer refuses it, and Alice's Control Room shows `update` on Alice Peer's card and in the timeline. It never
//      upgrades itself: back on this build's version (`alice-back`), the card says it no more and it is live again.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

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
const shot = (page, name) => page.screenshot({ path: `${run}/upgrade-${name}.png` }).catch(() => {});

// the host's part: a Peer restarted on another wire version, or back on this build's
async function host(what) {
	writeFileSync(`${run}/upgrade-${what}`, `${Date.now()}\n`);
	const done = `${run}/upgrade-${what}-done`;
	for (let i = 0; i < 240 && !existsSync(done); i++) await wait(500);
	if (!existsSync(done)) throw new Error(`the host never did ${what}`);
}

async function launch(engine, passkey) {
	const dir = `/tmp/avensandbox-upgrade-${engine.name()}`;
	rmSync(dir, { recursive: true, force: true });
	const context = await engine.launchPersistentContext(dir, { viewport: { width: 1000, height: 760 } });
	if (passkey) await context.credentials.create(passkey.rpId, passkey);
	await context.credentials.install();
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`${origin}/`);
	return { context, page };
}

// a value in the page's line to write in, waited for
async function drafted(page, want, timeout) {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		if ((await page.getByTestId('line').inputValue({ timeout: 1_000 }).catch(() => null)) === want) return true;
		await wait(250);
	}
	return false;
}

const tabs = {};
try {
	// 1. Signed in everywhere, each with a draft
	let passkey;
	let account;
	for (const engine of engines) {
		const name = engine.name();
		const b = await launch(engine, passkey);
		tabs[name] = b;
		report.engines[name] = {};
		await b.page.locator('[data-testid="status"][data-phase="live"]').waitFor({ timeout: 30_000 }).catch(() => {});
		if (!passkey) {
			await b.page.getByTestId('name').fill('Ada');
			await b.page.getByTestId('claim').click();
		} else await b.page.getByTestId('sign-in').click({ timeout: 30_000 }).catch(() => problems.push(`${name} finds no sign-in`));
		if (!(await seen(b.page.locator('[data-view="dashboard"]'))))
			problems.push(`${name} opened no dashboard: "${await text(b.page.getByTestId('refused'))}"`);
		account ??= await b.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
		[passkey] = await b.context.credentials.get({ rpId: 'localhost' });
		await b.page.goto(`${origin}/#/${account}/chat`);
		await b.page.getByTestId('line').fill(`a draft from ${name}, ${stamp}`);
		// marked, so its reload shows: a reloaded page has no mark
		await b.page.evaluate(() => (window.__beforeUpdate = true));
	}
	// the draft is on disk a moment after the last keystroke
	await wait(1_000);

	// 2. The Aven Peer a wire version ahead: every tab is refused, says "Updating…" and reloads, its draft kept
	const ahead = Date.now();
	await host('prod-ahead');
	await Promise.all(
		engines.map(async (engine) => {
			const name = engine.name();
			const { page } = tabs[name];
			const got = report.engines[name];
			got.updating = await seen(page.getByTestId('updating'), 30_000);
			if (got.updating) {
				got.updatingMs = Date.now() - ahead;
				got.onlyUpdating = (await page.locator('body').innerText()).trim() === 'Updating…';
				await shot(page, `${name}-updating`);
			}
			if (!got.updating) problems.push(`${name}, refused with update: no "Updating…"`);
			else if (!got.onlyUpdating) problems.push(`${name}, refused with update: shows more than "Updating…"`);
			const until = Date.now() + 30_000;
			while (Date.now() < until && (await page.evaluate(() => window.__beforeUpdate).catch(() => true))) await wait(250);
			got.reloaded = !(await page.evaluate(() => window.__beforeUpdate).catch(() => true));
			if (!got.reloaded) problems.push(`${name}, refused with update: it never reloaded`);
			else got.reloadMs = Date.now() - ahead;
			got.draftAfterReload = await drafted(page, `a draft from ${name}, ${stamp}`, 20_000);
			if (!got.draftAfterReload) problems.push(`${name}'s draft is gone after the update's reload`);
		}),
	);

	// 3. Back on this build's version: every tab is live again by itself, its draft still there, and sends it
	await host('prod-back');
	await Promise.all(
		engines.map(async (engine) => {
			const name = engine.name();
			const { page } = tabs[name];
			const got = report.engines[name];
			const back = Date.now();
			// a tab refused again after its reload waits a minute before the next, so it never reloads in a loop
			got.liveAgain = await seen(page.locator('[data-testid="say"]:visible'), 100_000);
			got.liveAgainMs = Date.now() - back;
			if (!got.liveAgain || (await page.getByTestId('updating').count())) problems.push(`${name} never came back from "Updating…"`);
			const draft = `a draft from ${name}, ${stamp}`;
			got.draftKept = await drafted(page, draft, 10_000);
			if (!got.draftKept) problems.push(`${name}'s draft is gone once it is back`);
			await page.getByTestId('say').click({ timeout: 10_000 }).catch(() => {});
			got.sent = await seen(page.getByTestId('lines').getByText(draft), 20_000);
			if (!got.sent) problems.push(`${name}'s draft, sent, never showed`);
			await shot(page, `${name}-back`);
		}),
	);
	for (const { context } of Object.values(tabs)) await context.close().catch(() => {});

	// 4. A native Peer left behind says `update`, in its owner's Control Room, until its owner upgrades it
	const context = await chromium.launchPersistentContext(`/tmp/avensandbox-upgrade-box`, { viewport: { width: 1280, height: 960 } });
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto('http://localhost:5173/#/alice/control-room');
	await page.locator('[data-view="control-room"][data-account="alice"]').waitFor({ timeout: 20_000 });
	await host('alice-behind');
	const card = page.locator('[data-peer="alice-peer"] [data-testid="peer-update"]');
	// watched together: the timeline shows its last lines only, and the Peer's redials soon follow its update
	const [update, timeline] = await Promise.all([seen(card, 30_000), seen(page.getByTestId('timeline').locator('[data-event="update"]'), 30_000)]);
	report.native = { update, timeline };
	if (!report.native.update) problems.push('Alice Peer, a wire version behind: its card says no update');
	else report.native.said = await text(card);
	if (!report.native.timeline) problems.push("Alice Peer, a wire version behind: no update in the Control Room's timeline");
	await shot(page, 'alice-peer-behind');
	await host('alice-back');
	report.native.cleared = await card
		.waitFor({ state: 'detached', timeout: 30_000 })
		.then(() => true, () => false);
	if (!report.native.cleared) problems.push('Alice Peer, upgraded by its owner: its card still says update');
	report.native.live = await seen(
		page.locator('[data-peer="alice-peer"] [data-testid="peer-status"]').filter({ hasText: 'live · direct to Aven Peer' }),
		30_000,
	);
	if (!report.native.live) problems.push('Alice Peer, upgraded by its owner: never live again');
	await context.close();
} catch (error) {
	problems.push(`the upgrade check stopped: ${error?.message ?? error}`);
}

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/upgrade.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`upgrade: ${problem}`);
if (report.ok) console.log(`upgrade: refused with update, every tab followed with its draft, and a Peer behind said so (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(report.ok ? 0 : 1);
