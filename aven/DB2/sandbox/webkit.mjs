// The Peer-Lights in WebKit, Safari's engine, in the browsers' container (`bun run up --check`, after the restart and the
// wipe, before the claim). Playwright's WebKit has OPFS only with a profile directory (`launchPersistentContext`); a
// plain context gets `UnknownError` from `getDirectory`. Its virtual authenticator is Chromium's (CDP), so the passkey
// steps stay in Chromium (sandbox/claim.mjs).
//
//   1. Both cast Peer-Lights in WebKit, each live with "4 peers", each on its own OPFS: its mark differs from the other
//      origin's and survives a reload, and its record, kept in OPFS, is found again after the reload. The check's
//      Chromium is closed by now: two Peer-Lights with one key would take the relay from each other.
//   2. avenOS's views, in WebKit, held to Lean's vectors as check.mjs holds them in Chromium (sandbox/views.mjs): each
//      pushed by a Peer-Light, the page's one WebAssembly module.
//   3. avenOS's release build (dist/, `bun run build`), served as Caddy serves aven.maia.city (sandbox/prod.mjs,
//      `served`), in front of the prod peer, in WebKit and in Chromium: each browser makes its device key in OPFS and
//      reaches the Aven Peer, live, and the network shows unclaimed. The dev server never runs the build; a build that
//      left its Peer-Light behind showed "Connecting to the network…" on aven.maia.city in every browser (30 Oct 2026).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { served } from './prod.mjs';
import { lines } from './records.mjs';
import { walkViews } from './views.mjs';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const problems = [];
const started = Date.now();
const report = {};
const profile = (name) => {
	const dir = `/tmp/avensandbox-webkit-${name}`;
	rmSync(dir, { recursive: true, force: true });
	return dir;
};
const text = async (locator) => (await locator.textContent({ timeout: 1_000 }).catch(() => '')).trim();

// 1. The cast's Peer-Lights
{
	const since = Date.now();
	const context = await webkit.launchPersistentContext(profile('cast'), { viewport: { width: 1000, height: 760 } });
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
			await new Promise((done) => setTimeout(done, 250));
			got = await shown();
		}
		return got;
	};
	const first = await until(60_000);
	report.castLiveMs = Date.now() - since;
	if (!settled(first)) problems.push(`WebKit's Peer-Lights aren't both live with their OPFS after 60 s: ${JSON.stringify(first)}`);
	if (first.alice.mark && first.alice.mark === first.bob.mark) problems.push("WebKit's two Peer-Lights share one OPFS mark");
	for (const [origin, tab] of Object.entries(tabs)) await tab.screenshot({ path: `${run}/webkit-peer-light-${origin}.png` });
	// each record kept in OPFS, as the Peer-Light's own `stored` line says
	const stored = (peer, after) => lines().findLast((l) => l.peer === peer && l.event === 'stored' && l.t >= after);
	for (const origin of Object.keys(tabs))
		if (stored(`${origin}-peer-light`, since)?.store !== 'opfs') problems.push(`WebKit's ${origin} Peer-Light keeps no record in OPFS`);

	const reloaded = Date.now();
	for (const tab of Object.values(tabs)) await tab.reload();
	const again = await until(30_000);
	report.castReloadMs = Date.now() - reloaded;
	for (const origin of Object.keys(tabs)) {
		if (again[origin].mark !== first[origin].mark) problems.push(`WebKit's ${origin} OPFS mark changed on reload`);
		if (again[origin].record !== first[origin].record) problems.push(`WebKit's ${origin} record changed on reload`);
		if (stored(`${origin}-peer-light`, reloaded)?.kept !== true) problems.push(`WebKit's ${origin} Peer-Light didn't find its record again`);
	}
	report.cast = again;
	await context.close();
}

// 2. Every view, as the model says, in WebKit
{
	const since = Date.now();
	const context = await webkit.launchPersistentContext(profile('views'), { viewport: { width: 1000, height: 760 } });
	const page = context.pages()[0] ?? (await context.newPage());
	problems.push(...(await walkViews(page, 'WebKit')));
	report.viewsMs = Date.now() - since;
	await page.goto('http://localhost:5173/#/alice/vault');
	await page.screenshot({ path: `${run}/webkit-vault-alice.png` });
	await context.close();
}

// 3. The release build, as aven.maia.city serves it
{
	const port = 5175;
	const server = await served({ root: '/work/dist', port });
	report.build = {};
	for (const [name, engine] of Object.entries({ webkit, chromium })) {
		const since = Date.now();
		const context = await engine.launchPersistentContext(profile(`build-${name}`), { viewport: { width: 1000, height: 760 } });
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(`http://localhost:${port}/`);
		const live = await page
			.locator('[data-testid="status"][data-phase="live"]')
			.waitFor({ timeout: 30_000 })
			.then(() => true, () => false);
		const unclaimed = await page.locator('[data-view="claim"]').count();
		const got = { live, unclaimed: unclaimed === 1, status: await text(page.getByTestId('status')), trouble: await text(page.getByTestId('trouble')), ms: Date.now() - since };
		report.build[name] = got;
		if (!got.live || !got.unclaimed) problems.push(`the release build in ${name} isn't live and unclaimed: ${JSON.stringify(got)}`);
		await page.screenshot({ path: `${run}/build-${name}.png` });
		await context.close();
	}
	server.close();
}

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/webkit.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: webkit: ${problem}`);
console.log(`avenSANDBOX: WebKit: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
