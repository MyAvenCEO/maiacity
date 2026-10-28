/*
 * The self-test device (Samuel 2026-10-28: "use a browser instead of the iPhone ... so you can self serve your own
 * testing, screenshots and timings"): Playwright WebKit (the iPhone's engine) on the Mac, on a profile of its own that
 * keeps its shelf between runs, opening maia.city against the always-on peer as a phone does. Its passkey is a
 * disposable software one (./passkey.mjs) kept in the Mac's login Keychain, which theOS's Settings → "Add a test
 * passkey" makes and adds as one more owner key of Samuel's own vault: the browser signs in as another device of his,
 * admitted by his vault's standing, and syncs what his phone syncs. Revoking that owner disposes of it. (--setup and
 * --accept, a dev vault of its own that co-owns his, are the older way.)
 *
 *   node aven/ops/devx/live-device.mjs --setup ['<invite link>'] once: found the dev vault (through the app's gate, or
 *                                                                an invite's join page), print its id for Settings → Owners
 *   node aven/ops/devx/live-device.mjs --accept                  once, after Samuel invited it: accept co-owning
 *   node aven/ops/devx/live-device.mjs                           a run: reopen + unlock, sync, Chat, Assets, report
 *   node aven/ops/devx/live-device.mjs --roundtrip [Bla]         the release gate (Samuel 2026-10-28): a message in the
 *                                                                room reaches the other device within 3 s (--gate;
 *                                                                the target is 1 s), both ways, whenever both are
 *                                                                online, catching up or not
 *
 * Options: --engine webkit|chromium (webkit), --base https://maia.city, --sync 240 (seconds to watch sync: 4 min finds most stalls, Samuel 2026-10-28),
 * --profile <dir>, --page <dir>: a candidate page not released yet, the static build of a branch (`bun run build`,
 * its `build/` folder), served at --base's own origin so the always-on peer takes the passkey as it takes the live
 * site's; the peer stays the live one. Each run writes build/live-device/<time>/: screenshots in order, run.json (step times, the unlock
 * sheet's steps, the sync pill over time, first paints, every diagnostics report the page sent, which is the phone's),
 * and prints one line of numbers with pass/fail against the targets below. One heavy job at a time on the 8 GB Mac:
 * don't run it beside a Rust build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticator, passkey } from './passkey.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = option('--engine', 'webkit');
const base = option('--base', 'https://maia.city').replace(/\/$/, '');
const watchSync = Number(option('--sync', '240'));
const pageDir = args.includes('--page') ? resolve(option('--page')) : null;
const messages = Math.max(1, Number(option('--messages', '1')));
const mac = platform() === 'darwin';
const profile = option('--profile', mac ? join(homedir(), 'Library/Application Support/maiacity-live-device', engine) : join(homedir(), '.maiacity-live-device', engine));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join(root, 'build/live-device', stamp);
mkdirSync(out, { recursive: true });
mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a run must meet. */
export const TARGETS = { unlock: 5, firstPaint: 0.5, message: 1 };
/** What the roundtrip gates at now (--gate, Samuel 2026-10-28: 3 s for this sync build), the 1 s target still reported. */
const GATE = Number(option('--gate', '3'));

// ─── the key: in the login Keychain on the Mac, else a file only its owner reads ───

const SERVICE = 'maiacity-live-device';
function readKey() {
	try {
		if (mac) return JSON.parse(execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', 'passkey', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
		return JSON.parse(readFileSync(join(profile, '..', 'passkey.json'), 'utf8'));
	} catch {
		return null;
	}
}
function keepKey(key) {
	const text = JSON.stringify(key);
	if (mac) execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', 'passkey', '-l', 'maiaCITY dev browser passkey (disposable)', '-w', text]);
	else {
		writeFileSync(join(profile, '..', 'passkey.json'), text);
		chmodSync(join(profile, '..', 'passkey.json'), 0o600);
	}
}

// ─── the browser ───

const log = { engine, base, started: new Date().toISOString(), steps: {}, sheet: [], sync: [], reports: [], errors: [], shots: [] };
let shotNo = 0;
async function shot(page, name) {
	const file = `${String(++shotNo).padStart(2, '0')}-${name}.png`;
	await page.screenshot({ path: join(out, file) }).catch(() => {});
	log.shots.push(file);
}
const words = (page, s = 'body') => page.evaluate((s) => document.querySelector(s)?.innerText?.replace(/\s+/g, ' ').trim() ?? '', s).catch(() => '');
const press = (page, t, scope = 'body') =>
	page.evaluate(([t, scope]) => {
		const b = [...document.querySelectorAll(`${scope} button`)].find((e) => e.textContent?.replace(/\s+/g, ' ').includes(t) && !e.disabled);
		b?.click();
		return !!b;
	}, [t, scope]).catch(() => false);
async function until(holds, seconds) {
	const end = Date.now() + seconds * 1000;
	for (;;) {
		const got = await holds().catch(() => null);
		if (got) return got;
		if (Date.now() > end) return null;
		await sleep(100);
	}
}
/** Goes to `href` inside the app, as a tap on a link does (a full load would start the device again). */
const go = (page, href) =>
	page.evaluate((href) => {
		const a = Object.assign(document.createElement('a'), { href });
		document.body.append(a);
		a.click();
		a.remove();
	}, href);
const open = (page) => until(async () => !(await page.$('.gate')) && !!(await page.$('nav.pill')), 2);

async function launch(dir = profile) {
	const pw = await import('playwright');
	const key = readKey();
	if (!key) throw new Error(`no dev passkey yet: run with --setup '<invite link>' first`);
	// a service worker would answer the page's requests past --page's routes
	const options = { headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(pageDir ? { serviceWorkers: 'block' } : {}) };
	// WEBKIT_PATH: a newer WebKit than this Playwright's own, where its own opens no saved profile (macOS 26.1, build 2215)
	if (engine === 'webkit' && process.env.WEBKIT_PATH) options.executablePath = process.env.WEBKIT_PATH;
	// on the Mac, WebKit keeps a site's OPFS (the device's shelf) under ~/Library/WebKit/<its bundle>, outside the
	// profile, so every profile reopened one shared store: a home of the profile's own makes a profile one device
	if (engine === 'webkit' && mac) {
		mkdirSync(join(dir, 'home'), { recursive: true });
		options.env = { ...process.env, CFFIXED_USER_HOME: join(dir, 'home') };
	}
	if (engine === 'chromium' && existsSync('/opt/pw-browsers/chromium')) Object.assign(options, { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
	const context = await pw[engine].launchPersistentContext(dir, options).catch((e) => {
		throw new Error(`${engine} didn't start (${e.message.split('\n')[0]}): on the Mac, once: npx playwright install ${engine}`);
	});
	await context.addInitScript(authenticator, key);
	if (pageDir) await serveCandidate(context);
	// a dev site against a local peer (aven/ops/devx/fresh-device.mjs's): RELAY and SERVER, which only a dev build takes
	if (process.env.RELAY && process.env.SERVER)
		await context.addInitScript(([relay, server, signup]) => {
			sessionStorage.setItem('avendb:relay', relay);
			sessionStorage.setItem('avendb:server', server);
			if (signup) sessionStorage.setItem('maia:signup', signup);
		}, [process.env.RELAY, process.env.SERVER, process.env.SIGNUP ?? '']);
	const page = context.pages()[0] ?? (await context.newPage());
	page.on('pageerror', (e) => log.errors.push(e.message));
	// the diagnostics report the page sends the peer, as the phone does: kept whole
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('/feed/diagnostics')) {
			try {
				log.reports.push({ at: Date.now(), body: JSON.parse(r.postData() ?? 'null') });
			} catch {
				log.reports.push({ at: Date.now(), raw: (r.postData() ?? '').slice(0, 200000) });
			}
		}
	});
	return { context, page };
}

/** Content types of what a static build holds. */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** --page: --base's own pages answered from the candidate's static build, at --base's origin (the passkey's), and
 *  everything else, the feed, the peer, a POST, from the network as ever. */
async function serveCandidate(context) {
	if (!existsSync(join(pageDir, 'index.html')) && !existsSync(join(pageDir, '404.html'))) throw new Error(`--page ${pageDir}: no static build there (bun run build)`);
	const file = (path) => {
		const at = normalize(join(pageDir, decodeURIComponent(path)));
		if (!at.startsWith(pageDir)) return null;
		for (const f of [at, join(at, 'index.html'), `${at}.html`]) if (existsSync(f) && statSync(f).isFile()) return f;
		return null;
	};
	await context.route(`${base}/**`, async (route) => {
		const url = new URL(route.request().url());
		if (route.request().method() !== 'GET' || url.pathname.startsWith('/feed/') || url.pathname.startsWith('/api/')) return route.continue();
		const f = file(url.pathname) ?? join(pageDir, '404.html');
		if (!existsSync(f)) return route.continue();
		await route.fulfill({ status: 200, contentType: TYPES[extname(f)] ?? 'application/octet-stream', body: readFileSync(f) });
	});
	log.page = pageDir;
}

// ─── once: sign up and found the dev vault; accept co-owning ───

async function setup(link) {
	if (!readKey()) keepKey(passkey());
	const { context, page } = await launch();
	try {
		if (link) {
			// with an invite link: the join page signs up first
			await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
			await page.goto(link, { waitUntil: 'domcontentloaded' });
			if (!(await until(() => page.$('#name'), 30))) throw new Error(`no sign-up form: ${(await words(page)).slice(0, 300)}`);
			await page.fill('#name', 'Dev browser');
			await press(page, 'Join as a founder');
		} else {
			// without one: the app's gate founds the vault for the name the tab signed up with, as the join page leaves it
			await page.addInitScript(() => sessionStorage.setItem('maia:signup', 'Dev browser'));
			await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
		}
		if (!(await until(() => press(page, 'Set up my human vault'), 60))) throw new Error(`no “Set up my human vault”: ${(await words(page)).slice(0, 300)}`);
		await shot(page, 'setup-founding');
		if (!(await until(() => open(page), 180))) throw new Error(`the dev vault didn't open: ${(await words(page)).slice(0, 300)}`);
		await go(page, `${base}/app/#settings`);
		const id = await until(async () => /\b[0-9a-f]{64}\b/.exec(await words(page, 'main'))?.[0], 60);
		await shot(page, 'setup-settings');
		console.log(id ? `dev vault id: ${id}\nNext: in your avenDB, Settings → Owners → “A person’s vault by its id…”, paste it, Invite; then run with --accept.` : 'founded, but no vault id shown: see the screenshots');
	} finally {
		await context.close();
	}
}

async function accept() {
	const { context, page } = await launch();
	try {
		await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
		if (await until(() => press(page, 'Unlock now'), 30)) await until(() => open(page), 120);
		await go(page, `${base}/app/#home`);
		const ok = await until(() => press(page, 'Accept'), 120);
		await shot(page, 'accept');
		await sleep(5000);
		console.log(ok ? 'accepted: approve it once on your consent screen with your passkey' : 'no invitation to accept yet: did Settings → Owners → Invite go through?');
	} finally {
		await context.close();
	}
}

// ─── a run ───

async function run() {
	const { context, page } = await launch();
	const t = (from) => Number(((Date.now() - from) / 1000).toFixed(2));
	try {
		// reopen: the page's own load, then the gate
		let t0 = Date.now();
		await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
		log.steps.load = t(t0);
		const gate = await until(async () => ((await page.$('.gate button.pill-btn')) ? 'gate' : (await open(page)) ? 'open' : null), 60);
		log.steps.gate = t(t0);
		await shot(page, 'gate');
		if (gate === 'gate') {
			const before = await page.evaluate(() => globalThis.__ceremonies?.asserted ?? 0);
			t0 = Date.now();
			// a reopen unlocks; a profile that holds no device yet signs in (or founds, on a dev site's sign-up)
			for (const t of ['Unlock now', 'Sign in with your passkey', 'Set up my human vault']) if (await press(page, t)) break;
			// the sheet while it runs, then at its end
			await sleep(500);
			await shot(page, 'unlock-running');
			let last = '';
			const opened = await until(async () => {
				const s = await words(page, '.signing');
				if (s) last = s;
				return open(page);
			}, 180);
			log.steps.unlock = t(t0);
			log.steps.ceremonies = (await page.evaluate(() => globalThis.__ceremonies?.asserted ?? 0)) - before;
			log.sheet = await page.$$eval('.signing .steps li', (els) => els.map((e) => e.textContent?.replace(/\s+/g, ' ').trim())).catch(() => []);
			log.sheetText = last;
			await shot(page, 'unlock-done');
			if (!opened) throw new Error(`didn't open: ${(await words(page)).slice(0, 300)}`);
		} else log.steps.unlock = 0;

		// sync: the pill and its details, as they move
		t0 = Date.now();
		await page.click('.status .pill').catch(() => {});
		for (let i = 0; Date.now() - t0 < watchSync * 1000; i++) {
			const pill = await words(page, '.status');
			log.sync.push({ s: t(t0), pill });
			if (i % 10 === 0) await shot(page, `sync-${Math.round(t(t0))}s`);
			if (/synced|up to date/i.test(pill) && !/behind|pulling|catching/i.test(pill) && i > 2) break;
			await sleep(1000);
		}
		await shot(page, 'sync-end');
		await page.click('.status .pill').catch(() => {});

		// Chat: the room list, then the first room's messages
		t0 = Date.now();
		await go(page, `${base}/app/chat/`);
		const rooms = await until(() => page.$('.chat-page button.nav-item[aria-current], .chat-page nav button.nav-item:not([data-pick][disabled])'), 30);
		const roomItem = await until(async () => (await page.$$('.chat-page button.nav-item')).at(-1) ?? null, 30);
		log.steps.chatRooms = rooms || roomItem ? t(t0) : null;
		if (roomItem) {
			const t1 = Date.now();
			await page.evaluate(() => {
				const list = [...document.querySelectorAll('.chat-page button.nav-item')].filter((b) => !b.hasAttribute('disabled') && !/New |Note to self/.test(b.textContent ?? ''));
				list[0]?.click();
			});
			log.steps.chatRoom = (await until(() => page.$('.chat-page article.msg'), 30)) ? t(t1) : null;
		}
		await shot(page, 'chat');

		// Assets: the list, then the first asset shown
		t0 = Date.now();
		await go(page, `${base}/app/#assets`);
		// the recipes live in Maia City: where the vault picked holds none, pick Maia City in the nav pill's vaults
		const list = () => page.$('a.nav-item[href^="#assets/"]');
		const elsewhere = () => page.evaluate(() => /kept in/.test(document.querySelector('main p.empty')?.textContent ?? '') || null);
		if (!(await until(async () => (await list()) || (await elsewhere()), 30)) || !(await list())) {
			await page.evaluate(() => document.querySelector('button.item.identity')?.click());
			await sleep(300);
			await page.evaluate(() => [...document.querySelectorAll('button.acct[role=menuitemradio]')].find((b) => /Maia City/.test(b.textContent ?? '') && !/COOP/.test(b.textContent ?? ''))?.click());
			await sleep(300);
			t0 = Date.now();
			await go(page, `${base}/app/#assets`);
		}
		log.steps.assetsList = (await until(list, 60)) ? t(t0) : null;
		await shot(page, 'assets-list');
		const t2 = Date.now();
		await page.evaluate(() => document.querySelector('a.nav-item[href^="#assets/"]')?.click());
		log.steps.asset = (await until(async () => (await page.$('.viewer canvas')) && !(await page.$('.viewer .canvas-note')), 120)) ? t(t2) : null;
		await shot(page, 'asset');

		// the report the phone would send: the page sends one ~10 s after a view opens
		await until(async () => log.reports.length > 0 || null, 45);
	} catch (e) {
		log.errors.push(`run: ${e instanceof Error ? e.message : e}`);
		await shot(page, 'failed');
	} finally {
		await context.close();
	}

	const s = log.steps;
	const behind = log.sync.map((x) => Number(/(\d+)\s*(?:logs?\s*)?behind/i.exec(x.pill)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
	const closing = !behind.length || behind.at(-1) === 0 || behind.at(-1) < behind[0];
	const paint = [s.chatRoom, s.assetsList].filter((x) => x != null);
	const pass = {
		unlock: s.unlock != null && s.unlock < TARGETS.unlock && (s.ceremonies ?? 1) <= 1,
		firstPaint: paint.length === 2 && paint.every((x) => x < TARGETS.firstPaint),
		behind: closing,
		errors: !log.errors.length
	};
	log.pass = pass;
	writeFileSync(join(out, 'run.json'), JSON.stringify(log, null, 1));
	const line =
		`${stamp} ${engine} load ${s.load}s gate ${s.gate}s unlock ${s.unlock}s (${s.ceremonies ?? 0} ceremony) ` +
		`chat rooms ${s.chatRooms}s room ${s.chatRoom}s assets list ${s.assetsList}s asset ${s.asset}s ` +
		`behind ${behind.length ? `${behind[0]}→${behind.at(-1)}` : 'n/a'} reports ${log.reports.length} errors ${log.errors.length} ` +
		`| ${Object.entries(pass).map(([k, v]) => `${k} ${v ? 'PASS' : 'FAIL'}`).join(', ')}`;
	writeFileSync(join(out, 'line.txt'), `${line}\n`);
	console.log(line);
	console.log(`run folder: ${out}`);
	return Object.values(pass).every(Boolean);
}

// ─── the release gate: a message both ways while the receiving device catches up ───

/** Opens avenDB on `page`: unlocks a device it holds, or signs in as a new one. When it opened, or null. */
async function openOn(page) {
	await page.goto(`${base}/app/`, { waitUntil: 'domcontentloaded' });
	await until(async () => (await page.$('.gate button.pill-btn')) || (await open(page)), 60);
	for (const t of ['Unlock now', 'Sign in with your passkey']) if (await press(page, t)) break;
	return (await until(() => open(page), 180)) ? Date.now() : null;
}

/** Opens room `room` in Chat on `page`, once its device knows it: true, or false after `seconds`. */
async function room(page, name, seconds) {
	await go(page, `${base}/app/chat/`);
	const picked = await until(
		() =>
			page.evaluate((name) => {
				const b = [...document.querySelectorAll('.chat-page button.nav-item')].find((e) => e.textContent?.replace(/\s+/g, ' ').trim().replace(/^#\s*/, '') === name);
				b?.click();
				return !!b;
			}, name),
		seconds
	);
	return !!picked && !!(await until(() => page.$('.chat-page textarea'), 10));
}

/** The sync pill's words on `page`. */
const pill = (page) => words(page, '.status');
const catching = (text) => /behind|pulling|catching|syncing/i.test(text);

/** Sends `text` from `from` and times it until `to` shows it, its own copy no longer pending: seconds, or null. */
async function message(from, to, text, side) {
	const toPill = await pill(to);
	await from.fill('.chat-page textarea', text);
	const t0 = Date.now();
	await from.click('.chat-page button.send');
	const shown = await until(
		() => to.evaluate((text) => [...document.querySelectorAll('.chat-page article.msg')].some((m) => m.textContent?.includes(text) && !m.classList.contains('pending')), text),
		30
	);
	const seconds = shown ? Number(((Date.now() - t0) / 1000).toFixed(2)) : null;
	await shot(to, `roundtrip-${side}`);
	return { seconds, receiverPill: toPill, receiverCatchingUp: catching(toPill) };
}

async function roundtrip(name) {
	const home = await launch();
	const freshDir = mkdtempSync(join(tmpdir(), 'maiacity-fresh-'));
	let fresh = null;
	const gate = (log.roundtrip = { name, fresh: freshDir });
	try {
		// the caught-up device: this profile's, the room open
		if (!(await openOn(home.page))) throw new Error(`the caught-up device didn't open: ${(await words(home.page)).slice(0, 300)}`);
		if (!(await room(home.page, name, 60))) throw new Error(`no room “${name}” on the caught-up device`);
		await shot(home.page, 'roundtrip-home');
		// a new device of the same vault, on a profile of nothing: it signs in and starts its catch-up
		fresh = await launch(freshDir);
		const t0 = Date.now();
		const opened = await openOn(fresh.page);
		if (!opened) throw new Error(`the fresh device didn't open: ${(await words(fresh.page)).slice(0, 300)}`);
		gate.open = Number(((opened - t0) / 1000).toFixed(2));
		await fresh.page.click('.status .pill').catch(() => {});
		await shot(fresh.page, 'roundtrip-fresh-open');
		if (!(await room(fresh.page, name, 60))) throw new Error(`the fresh device didn't get room “${name}” in 60 s`);
		gate.room = Number(((Date.now() - t0) / 1000).toFixed(2));
		const tag = `rt ${stamp}`;
		// to the device catching up, then back from it while it still is
		gate.toFresh = await message(home.page, fresh.page, `${tag} → fresh`, 'to-fresh');
		gate.fromFresh = await message(fresh.page, home.page, `${tag} ← fresh`, 'from-fresh');
		// --messages n: n each way in all, the first above, for each direction's p50 and p95
		gate.to = [gate.toFresh];
		gate.from = [gate.fromFresh];
		for (let i = 2; i <= messages; i++) {
			gate.to.push(await message(home.page, fresh.page, `${tag} → fresh ${i}`, `to-fresh-${i}`));
			gate.from.push(await message(fresh.page, home.page, `${tag} ← fresh ${i}`, `from-fresh-${i}`));
		}
		gate.freshPillAfter = await pill(fresh.page);
	} catch (e) {
		log.errors.push(`roundtrip: ${e instanceof Error ? e.message : e}`);
		await shot((fresh ?? home).page, 'roundtrip-failed');
	} finally {
		await fresh?.context.close();
		await home.context.close();
	}
	const ways = [...(gate.to ?? [gate.toFresh]), ...(gate.from ?? [gate.fromFresh])];
	const under = (limit) => ways.every((w) => w?.seconds != null && w.seconds < limit);
	/** The p-th percentile of a direction's times (null for one that never arrived counts as the slowest). */
	const pct = (list, p) => {
		const xs = (list ?? []).map((w) => w?.seconds ?? Infinity).sort((a, b) => a - b);
		return xs.length ? xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] : null;
	};
	gate.stats = { to: { p50: pct(gate.to, 50), p95: pct(gate.to, 95) }, from: { p50: pct(gate.from, 50), p95: pct(gate.from, 95) } };
	// the gate holds whenever both are online; whether the fresh one was still catching up is said, not gated
	const pass = (log.pass = { [`message<${GATE}s`]: under(GATE), errors: !log.errors.length });
	log.target = { [`message<${TARGETS.message}s`]: under(TARGETS.message) };
	writeFileSync(join(out, 'run.json'), JSON.stringify(log, null, 1));
	const line =
		`${stamp} ${engine} roundtrip #${name}: fresh open ${gate.open ?? '-'}s room ${gate.room ?? '-'}s ` +
		`first →fresh ${gate.toFresh?.seconds ?? 'none'}s ←fresh ${gate.fromFresh?.seconds ?? 'none'}s ` +
		(messages > 1 ? `| ${messages} each way →fresh p50 ${gate.stats.to.p50}s p95 ${gate.stats.to.p95}s ←fresh p50 ${gate.stats.from.p50}s p95 ${gate.stats.from.p95}s ` : '') +
		`(fresh pill at send: ${gate.toFresh?.receiverPill || '?'}) errors ${log.errors.length} ` +
		`| ${Object.entries(pass).map(([k, v]) => `${k} ${v ? 'PASS' : 'FAIL'}`).join(', ')} ` +
		`(target message<${TARGETS.message}s ${log.target[`message<${TARGETS.message}s`] ? 'met' : 'not met'})`;
	writeFileSync(join(out, 'line.txt'), `${line}\n`);
	console.log(line);
	console.log(`run folder: ${out}  (the fresh device stays a device of the vault: revoke it under Devices when done)`);
	return Object.values(pass).every(Boolean);
}

if (args.includes('--setup')) await setup((option('--setup') ?? '').startsWith('http') ? option('--setup') : '');
else if (args.includes('--accept')) await accept();
else if (args.includes('--roundtrip')) {
	const name = option('--roundtrip');
	process.exit((await roundtrip(name && !name.startsWith('--') ? name : 'Bla')) ? 0 : 1);
}
else process.exit((await run()) ? 0 : 1);
