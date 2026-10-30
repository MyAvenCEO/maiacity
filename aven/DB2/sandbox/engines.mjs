// avenOS in all three of Playwright's engines (Samuel, 30 Oct 2026): Chromium, WebKit (Safari's) and Firefox, in the
// browsers' container (`bun run up --check`, after the restart and the wipe, before the claim). WebKit has OPFS only
// with a profile directory (`launchPersistentContext`), never in an ephemeral context; every engine here gets one.
//
//   1. Both cast Peer-Lights in WebKit, then in Firefox: each live with "4 peers", on its own OPFS, whose mark differs
//      from the other origin's and survives a reload, and whose record is kept there and found again. The check's
//      Chromium is closed by now, and one engine runs at a time: two Peer-Lights with one key would take the relay
//      from each other.
//   2. avenOS's views in WebKit and Firefox, held to Lean's vectors as check.mjs holds them in Chromium
//      (sandbox/views.mjs): each pushed by a Peer-Light, the page's one WebAssembly module.
//   3. avenOS's release build (dist/, `bun run build`), served as Caddy serves aven.maia.city (sandbox/prod.mjs,
//      `served`, at localhost:5175, one of the prod peer's origins), in all three engines at once: each makes its
//      device key in OPFS, reaches the Aven Peer, live, and finds the network unclaimed; and a worker nobody started
//      asks for its start, refuses a line with why, and starts with a line that carries it. The dev server never runs
//      the build; a build that left its Peer-Light behind showed "Connecting to the network…" on aven.maia.city.
//      And a Firefox that blocks cookies and site data, whose OPFS throws: avenOS says plainly that it keeps no storage.
//   4. The passkeys on that build, in WebKit and Firefox, through Playwright's `context.credentials`: a stand-in for
//      `navigator.credentials` that signs ES256 in Node, so it checks our ceremony, not the engine's own WebAuthn.
//      WebKit signs up first, so claims the network, opens its dashboard and sees its own chat line shown; Firefox's
//      deliberate second signup (`#/claim`) is refused; Firefox signs in with WebKit's passkey, as a synced one, and
//      opens the same vault's dashboard. Chromium's virtual authenticator (CDP) runs the whole claim step after this
//      one (sandbox/claim.mjs), which starts by wiping the prod peer's store.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { served } from './prod.mjs';
import { narrow } from './narrow.mjs';
import { lines } from './records.mjs';
import { walkViews } from './views.mjs';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const problems = [];
const started = Date.now();
const report = { cast: {}, views: {}, narrow: {}, build: {}, passkeys: {} };
const launch = (engine, name) => {
	const dir = `/tmp/avensandbox-${engine.name()}-${name}`;
	rmSync(dir, { recursive: true, force: true });
	return engine.launchPersistentContext(dir, { viewport: { width: 1000, height: 760 } });
};
const text = async (locator) => (await locator.textContent({ timeout: 1_000 }).catch(() => '')).trim();
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const timed = (since) => Date.now() - since;

// 1. The cast's Peer-Lights, one engine at a time
async function cast(engine) {
	const name = engine.name();
	const since = Date.now();
	const context = await launch(engine, 'cast');
	const tabs = {};
	for (const origin of ['alice', 'bob']) {
		tabs[origin] = await context.newPage();
		await tabs[origin].goto(`http://${origin}.localhost:5173/`);
	}
	const shown = async () => {
		const out = {};
		for (const [origin, tab] of Object.entries(tabs))
			out[origin] = {
				status: await text(tab.getByTestId('status')),
				mark: (await text(tab.getByTestId('mark'))).match(/mark ([0-9a-f]{8})/)?.[1],
				record: Number((await tab.locator('[data-testid="record"][data-first]').getAttribute('data-first', { timeout: 1_000 }).catch(() => null)) ?? NaN),
			};
		return out;
	};
	const settled = (got) => Object.values(got).every((g) => g.status === 'live · 4 peers' && g.mark && g.record);
	const until = async (ms) => {
		const deadline = Date.now() + ms;
		let got = await shown();
		while (!settled(got) && Date.now() < deadline) {
			await wait(250);
			got = await shown();
		}
		return got;
	};
	const first = await until(60_000);
	const liveMs = timed(since);
	if (!settled(first)) problems.push(`${name}'s Peer-Lights aren't both live with their OPFS after 60 s: ${JSON.stringify(first)}`);
	if (first.alice.mark && first.alice.mark === first.bob.mark) problems.push(`${name}'s two Peer-Lights share one OPFS mark`);
	for (const [origin, tab] of Object.entries(tabs)) await tab.screenshot({ path: `${run}/${name}-peer-light-${origin}.png` });
	// each record kept in OPFS, as the Peer-Light's own `stored` line says
	const stored = (peer, after) => lines().findLast((l) => l.peer === peer && l.event === 'stored' && l.t >= after);
	for (const origin of Object.keys(tabs))
		if (stored(`${origin}-peer-light`, since)?.store !== 'opfs') problems.push(`${name}'s ${origin} Peer-Light keeps no record in OPFS`);

	const reloaded = Date.now();
	for (const tab of Object.values(tabs)) await tab.reload();
	const again = await until(30_000);
	for (const origin of Object.keys(tabs)) {
		if (again[origin].mark !== first[origin].mark) problems.push(`${name}'s ${origin} OPFS mark changed on reload`);
		if (again[origin].record !== first[origin].record) problems.push(`${name}'s ${origin} record changed on reload`);
		if (stored(`${origin}-peer-light`, reloaded)?.kept !== true) problems.push(`${name}'s ${origin} Peer-Light didn't find its record again`);
	}
	report.cast[name] = { ...again, liveMs, reloadMs: timed(reloaded), ms: timed(since) };
	await context.close();
}

// 2. Every view, as the model says, one engine at a time
async function views(engine) {
	const since = Date.now();
	const context = await launch(engine, 'views');
	const page = context.pages()[0] ?? (await context.newPage());
	const name = engine.name();
	problems.push(...(await walkViews(page, name)));
	await page.goto('http://localhost:5173/#/alice/vault');
	await page.screenshot({ path: `${run}/${name}-vault-alice.png` });
	report.views[name] = { ms: timed(since) };
	await context.close();
}

// 2b. A phone's width (sandbox/narrow.mjs): Alice's chat, with a long word, a long file name, an image, a movie and
// many presence chips, and the other views, no wider than 375 and 390 px screens, one engine at a time
async function phone(engine) {
	const since = Date.now();
	const context = await launch(engine, 'narrow');
	const page = context.pages()[0] ?? (await context.newPage());
	const got = await narrow(page, engine.name(), run);
	problems.push(...got.problems);
	for (const warning of got.warnings) console.log(`avenSANDBOX: engines: warning: ${warning}`);
	report.narrow[engine.name()] = { warnings: got.warnings, ms: timed(since) };
	await context.close();
}

// 3. The release build in one engine: live, and the network unclaimed
const origin = 'http://localhost:5175';
// the Peer-Light's worker as the build names it
const workerUrl = `/assets/${readdirSync('/work/dist/assets').find((file) => /^worker-.*\.js$/.test(file))}`;
async function build(engine) {
	const name = engine.name();
	const since = Date.now();
	const context = await launch(engine, 'build');
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`${origin}/`);
	const live = await page
		.locator('[data-testid="status"][data-phase="live"]')
		.waitFor({ timeout: 30_000 })
		.then(() => true, () => false);
	const unclaimed = (await page.locator('[data-view="claim"]').count()) === 1;
	const got = { live, unclaimed, status: await text(page.getByTestId('status')), trouble: await text(page.getByTestId('trouble')), ms: timed(since) };
	report.build[name] = got;
	if (!got.live || !got.unclaimed) problems.push(`the release build in ${name} isn't live and unclaimed: ${JSON.stringify(got)}`);
	// a worker nobody has started, as a new leader is until its tabs say hello: it asks for its
	// start, refuses a line with why, and starts with the start a line carries. Before, it called the Peer-Light it had
	// never loaded: "undefined is not an object (evaluating 'r[t]')" under Make an invite, and a chat line lost
	got.unstarted = await page.evaluate(async (url) => {
		const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
		// a worker of its own name, reached as every tab reaches its leader's: over the BroadcastChannel it is named by
		const name = `aven-peer-light:unstarted-${Date.now()}`;
		const channel = new BroadcastChannel(name);
		const heard = [];
		channel.onmessage = ({ data }) => data?.to === 'check' && heard.push(JSON.parse(data.line));
		new Worker(url, { type: 'module', name });
		await sleep(500);
		channel.postMessage({ tab: 'check', data: { say: 'nobody started me' } });
		for (let i = 0; i < 40 && !heard.some((l) => l.event === 'refused'); i++) await sleep(50);
		const start = { name: '', secret: 'opfs', avenKey: (await (await fetch('/aven.json')).json()).peer, avenName: 'aven-peer' };
		channel.postMessage({ tab: 'check', data: { start, say: 'now I am' } });
		for (let i = 0; i < 100 && !heard.some((l) => l.event === 'started'); i++) await sleep(50);
		return {
			asked: heard.some((l) => l.event === 'start?'),
			refused: heard.find((l) => l.event === 'refused')?.why ?? null,
			started: heard.some((l) => l.event === 'started'),
		};
	}, workerUrl);
	const { asked, refused, started } = got.unstarted;
	if (!asked || !/^the Peer-Light isn't running: nothing started it$/.test(refused ?? '') || !started)
		problems.push(`a worker nobody started, in ${name}: ${JSON.stringify(got.unstarted)}`);
	await page.screenshot({ path: `${run}/build-${name}.png` });
	await context.close();
}

// 3b. A browser that keeps no storage for the host: Firefox with cookies and site data blocked, whose OPFS throws
// "SecurityError: Security error when calling GetDirectory" (Samuel's Firefox on aven.maia.city, 30 Oct 2026; a private
// window throws the same). avenOS says so plainly, with the reason under it, and starts no Peer-Light, rather than
// "Connecting to the network… offline"
async function noStorage() {
	const since = Date.now();
	const browser = await firefox.launch({ firefoxUserPrefs: { 'network.cookie.cookieBehavior': 2 } });
	const page = await browser.newPage();
	await page.goto(`${origin}/#/join/${'ab'.repeat(32)}`);
	const shown = await page
		.locator('[data-view="no-storage"]')
		.waitFor({ timeout: 15_000 })
		.then(() => true, () => false);
	const got = { shown, said: await text(page.getByTestId('no-storage')), why: await text(page.getByTestId('no-storage-why')) };
	got.connecting = (await page.locator('[data-view="connecting"]').count()) > 0;
	got.ms = timed(since);
	report.build.noStorage = got;
	const plain =
		"This browser doesn't allow avenOS to store data for localhost. In Firefox, check that cookies and site data are allowed for this site and that 'Always use private browsing mode' is off, or open the link in another browser.";
	if (!shown || got.said.replace(/\s+/g, ' ') !== plain || !/^SecurityError/.test(got.why) || got.connecting)
		problems.push(`a Firefox that blocks site data isn't told plainly that it keeps no storage: ${JSON.stringify(got)}`);
	await page.screenshot({ path: `${run}/build-firefox-no-storage.png` });
	await browser.close();
}

// 4. The passkeys, through `context.credentials`
async function withPasskeys(engine, name) {
	const context = await launch(engine, name);
	await context.credentials.install();
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`${origin}/`);
	return { context, page };
}
const shows = (page, view, timeout = 30_000) =>
	page
		.locator(`[data-view="${view}"]`)
		.first()
		.waitFor({ timeout })
		.then(() => true, () => false);
async function passkeys() {
	const since = Date.now();
	// WebKit signs up first: a name, then a passkey, and the network is its admin's
	const first = await withPasskeys(webkit, 'signup');
	await first.page.locator('[data-testid="status"][data-phase="live"]').waitFor({ timeout: 30_000 }).catch(() => {});
	await first.page.getByTestId('name').fill('Ada');
	await first.page.getByTestId('claim').click();
	const signedUp = Date.now();
	if (!(await shows(first.page, 'dashboard'))) problems.push(`WebKit's signup opened no dashboard: "${await text(first.page.getByTestId('refused'))}"`);
	report.passkeys.signupMs = timed(signedUp);
	const admin = await first.page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (!admin?.startsWith('person-')) problems.push(`WebKit's dashboard acts as ${admin}, not the admin's vault`);
	await first.page.screenshot({ path: `${run}/webkit-signed-up.png` });
	// the admin's line in the network's room comes back and is shown
	await first.page.goto(`${origin}/#/${admin}/chat`);
	await first.page.getByTestId('line').fill('hello from WebKit');
	await first.page.getByTestId('say').click();
	const said = await first.page
		.getByTestId('lines')
		.getByText('hello from WebKit')
		.waitFor({ timeout: 10_000 })
		.then(() => true, () => false);
	if (!said) problems.push(`WebKit's chat line was not shown: "${await text(first.page.getByTestId('refused'))}"`);
	await first.page.screenshot({ path: `${run}/webkit-chat.png` });
	const [passkey] = await first.context.credentials.get({ rpId: 'localhost' });
	await first.context.close();

	// Firefox: invite only; a deliberate second signup with a passkey of its own is refused
	const second = await withPasskeys(firefox, 'second');
	if (!(await shows(second.page, 'invite-only'))) problems.push('a claimed network shows Firefox no "invite only"');
	await second.page.goto(`${origin}/#/claim`);
	await shows(second.page, 'claim');
	await second.page.getByTestId('name').fill('Eve');
	await second.page.getByTestId('claim').click();
	report.passkeys.refused = await text(second.page.getByTestId('refused').filter({ hasText: /./ }));
	if (!report.passkeys.refused) {
		await second.page.getByTestId('refused').waitFor({ timeout: 15_000 }).catch(() => {});
		report.passkeys.refused = await text(second.page.getByTestId('refused'));
	}
	if (!report.passkeys.refused) problems.push("Firefox's second signup shows no refusal");
	await second.page.screenshot({ path: `${run}/firefox-refused.png` });
	await second.context.close();

	// Firefox signs in with WebKit's passkey, as a synced one, and becomes a device of the same vault
	const third = await launch(firefox, 'sign-in');
	if (passkey) await third.credentials.create(passkey.rpId, passkey);
	await third.credentials.install();
	const page = third.pages()[0] ?? (await third.newPage());
	await page.goto(`${origin}/`);
	await shows(page, 'invite-only');
	await page.getByTestId('sign-in').click({ timeout: 30_000 }).catch(() => problems.push('Firefox finds no sign-in'));
	const signedIn = Date.now();
	if (!(await shows(page, 'dashboard'))) problems.push(`Firefox's sign-in opened no dashboard: "${await text(page.getByTestId('refused'))}"`);
	report.passkeys.signInMs = timed(signedIn);
	const acting = await page.locator('[data-view="dashboard"]').first().getAttribute('data-account').catch(() => null);
	if (acting !== admin) problems.push(`Firefox acts as ${acting} after its sign-in, not ${admin}`);
	await page.screenshot({ path: `${run}/firefox-signed-in.png` });
	await third.close();
	report.passkeys.ms = timed(since);
}

for (const engine of [webkit, firefox]) await cast(engine);
for (const engine of [webkit, firefox]) await views(engine);
for (const engine of [chromium, webkit, firefox]) await phone(engine);
const server = await served({ root: '/work/dist', port: 5175 });
const builds = Date.now();
await Promise.all([chromium, webkit, firefox].map(build));
report.build.ms = timed(builds);
await noStorage();
await passkeys();
server.close();

report.ok = problems.length === 0;
report.problems = problems;
report.ms = timed(started);
writeFileSync(`${run}/engines.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: engines: ${problem}`);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(
	`avenSANDBOX: engines: ${problems.length ? 'FAILED' : 'ok'} (${seconds(report.ms)}: WebKit's Peer-Lights ${seconds(report.cast.webkit?.ms ?? 0)}, Firefox's ${seconds(report.cast.firefox?.ms ?? 0)}, the views ${seconds((report.views.webkit?.ms ?? 0) + (report.views.firefox?.ms ?? 0))}, a phone's width ${seconds(Object.values(report.narrow).reduce((n, r) => n + r.ms, 0))}, the build in three engines ${seconds(report.build.ms)}, the passkeys ${seconds(report.passkeys.ms ?? 0)})`,
);
process.exit(problems.length ? 1 : 0);
