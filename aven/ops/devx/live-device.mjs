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
 *   node aven/ops/devx/live-device.mjs                           a run: reopen + unlock, 5 reference walks (Chat →
 *                                                                #Bla, Assets → asset → variant, Stories → story,
 *                                                                Proposals → AIP, Settings → Devices) while catching
 *                                                                up, sync, the walks again, Chat, Assets, report
 *   node aven/ops/devx/live-device.mjs --roundtrip [Bla]         the release gate (Samuel 2026-10-28): a message in the
 *                                                                room reaches the other device within 3 s (--gate;
 *                                                                the target is 1 s), both ways, whenever both are
 *                                                                online, catching up or not
 *
 * Options: --engine webkit|chromium (webkit), --base https://maia.city, --sync 240 (seconds to watch sync: 4 min finds most stalls, Samuel 2026-10-28),
 * --profile <dir>, --room Bla (the room the views open), --remove <id,…> (earlier runs' test devices to remove, by
 * recorded id), --headed (a visible WebKit window), --name <name> (this device's
 * name in Devices: test-device <profile>), --page <dir>: a candidate page not released yet, the static build of a branch (`bun run build`,
 * its `build/` folder), served at --base's own origin so the always-on peer takes the passkey as it takes the live
 * site's; the peer stays the live one. Each run writes build/live-device/<time>/: screenshots in order, run.json (step times, the unlock
 * sheet's steps, the sync pill over time, first paints, every diagnostics report the page sent, which is the phone's),
 * and prints one line of numbers with pass/fail against the targets below. One heavy job at a time on the 8 GB Mac:
 * don't run it beside a Rust build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
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
const viewRoom = option('--room', 'Bla');
// --remove <id,id,…>: devices of the person's own vault this run removes once its walks are done, each named by its
// recorded id (an earlier run's test device), never by name: Samuel 2026-10-29, "be careful to only remove your test
// devices". A device can't remove itself, so each run removes the ones before it.
const removeIds = (option('--remove', '') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const headed = args.includes('--headed');
const mac = platform() === 'darwin';
const profile = option('--profile', mac ? join(homedir(), 'Library/Application Support/maiacity-live-device', engine) : join(homedir(), '.maiacity-live-device', engine));
// the name this run's device carries in Devices (Samuel 2026-10-29: test devices get proper "test-device" names)
const deviceName = option('--name', `test-device ${basename(profile)}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join(root, 'build/live-device', stamp);
mkdirSync(out, { recursive: true });
mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a run must meet. */
export const TARGETS = { unlock: 5, firstPaint: 0.5, message: 1, view: 2 };
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

const log = { engine, base, started: new Date().toISOString(), steps: {}, sheet: [], views: {}, sync: [], memory: [], removed: [], reports: [], errors: [], shots: [] };
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
	const options = { headless: !headed, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(pageDir ? { serviceWorkers: 'block' } : {}) };
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

		// the reference walks, right away while the device still catches up (each view's actor manifest asks for its own
		// data first: Samuel 2026-10-29, "do you actually open the routes/actor views?"), then again once caught up
		log.views.catchingUp = await views(page, 'catching');

		// sync: the pill and its details, as they move
		t0 = Date.now();
		await page.click('.status .pill').catch(() => {});
		for (let i = 0; Date.now() - t0 < watchSync * 1000; i++) {
			const pill = await words(page, '.status');
			log.sync.push({ s: t(t0), pill });
			if (i % 10 === 0) await shot(page, `sync-${Math.round(t(t0))}s`);
			// the Mac's memory pressure beside it (one heavy job at a time on the 8 GB Mac)
			if (i % 10 === 0 && mac)
				try {
					const free = /(\d+)%/.exec(execFileSync('memory_pressure', ['-Q'], { encoding: 'utf8' }))?.[1];
					log.memory.push({ s: t(t0), free: free == null ? null : Number(free) });
				} catch {}
			if (/synced|up to date/i.test(pill) && !/behind|pulling|catching/i.test(pill) && i > 2) break;
			await sleep(1000);
		}
		await shot(page, 'sync-end');
		await page.click('.status .pill').catch(() => {});
		log.views.caughtUp = await views(page, 'synced');

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

		// this device's own id, for the next run's --remove, its name, and the earlier runs' devices this one removes
		await own(page);
		log.named = await nameDevice(page, deviceName);
		log.device = await page.evaluate(() => [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.chip.accent'))?.querySelector('.soft.mono')?.textContent?.trim() ?? null);
		for (const id of removeIds) log.removed.push({ id, ...(await removeDevice(page, id, log.device)) });
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
	const opened = Object.values(log.views).flat();
	const pass = {
		unlock: s.unlock != null && s.unlock < TARGETS.unlock && (s.ceremonies ?? 1) <= 1,
		firstPaint: paint.length === 2 && paint.every((x) => x < TARGETS.firstPaint),
		[`views<${TARGETS.view}s`]: opened.length > 0 && opened.every((v) => v.paint != null && v.paint < TARGETS.view),
		behind: closing,
		errors: !log.errors.length
	};
	log.pass = pass;
	writeFileSync(join(out, 'run.json'), JSON.stringify(log, null, 1));
	const line =
		`${stamp} ${engine} load ${s.load}s gate ${s.gate}s unlock ${s.unlock}s (${s.ceremonies ?? 0} ceremony) ` +
		`chat rooms ${s.chatRooms}s room ${s.chatRoom}s assets list ${s.assetsList}s asset ${s.asset}s ` +
		`views ${Object.entries(log.views).map(([when, vs]) => `${when} ${vs.map((v) => `${v.app}/${v.level} ${v.paint ?? '-'}s`).join(' ')}`).join(', ')} ` +
		`behind ${behind.length ? `${behind[0]}→${behind.at(-1)}` : 'n/a'} reports ${log.reports.length} errors ${log.errors.length} ` +
		`device ${log.device ?? '-'} named ${log.named ?? '-'} removed ${log.removed.map((r) => `${r.id.slice(0, 8)} ${r.result}`).join(' ') || '-'} ` +
		`memory free ${log.memory.length ? `${Math.min(...log.memory.map((m) => m.free ?? 100))}% min` : 'n/a'} ` +
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

/** The reference walks (Samuel 2026-10-29: "just a few reference examples ... clicking sub items, like chat actor/room
 *  or assets/select asset item/variant ... 5 actor apps ... their composite leaf pattern like sub interests"): each
 *  goes from an app's composite view down to a leaf, a click at a time, so each level's sub-interest is asked for
 *  (a slot binds on select: Chat's room, Assets' asset). A step goes to `go` or clicks `click` (the
 *  first element it matches), and has painted once `painted` matches, with `text` in it where given. A view's first
 *  paint is from the device's own data (local first): the 2 s target holds while the device still catches up. */
const WALKS = [
	{
		app: 'chat',
		steps: [
			// a room row, not the composite's own New message / New group / Note to self
			{ level: 'rooms', go: `${base}/app/chat/`, painted: '.chat-page button.nav-item:not([disabled])', not: 'New |Note to self' },
			{ level: `#${viewRoom}`, room: viewRoom, painted: '.chat-page article.msg' }
		]
	},
	{
		app: 'assets',
		steps: [
			// the recipes live in Maia City's coop vault, picked by its id where its name hasn't arrived yet
			{ level: 'list', go: `${base}/app/#assets`, painted: 'a.nav-item[href^="#assets/"]', vault: 'Maia City|aee5 ?73fe' },
			{ level: 'asset', click: 'a.nav-item[href^="#assets/"]', painted: '.about-head h3' },
			{ level: 'variant', click: '.lines a.line:has(> i.dot:not(.main))', painted: '.about-head p.soft', text: 'a variant' }
		]
	},
	{
		app: 'stories',
		steps: [
			{ level: 'list', go: `${base}/app/#stories`, painted: 'a.card[href^="#stories/"]' },
			{ level: 'story', click: 'a.card[href^="#stories/"]', painted: 'header.top input.title' }
		]
	},
	{
		app: 'proposals',
		steps: [
			// the board drawn: a card, or a column's own empty words once it isn't catching up ("Nothing waits for a yes.")
			{ level: 'board', go: `${base}/app/aips/`, painted: '.board ul.cards li', not: 'Catching up' },
			{ level: 'aip', click: '.board ul.cards li button', painted: 'section.detail h2' }
		]
	},
	{
		app: 'settings',
		steps: [
			{ level: 'settings', go: `${base}/app/#settings`, painted: 'section.part' },
			// the person's own devices are their human vault's, not the coop's the Assets walk picked
			{ level: 'devices', go: `${base}/app/#settings/devices`, painted: '#settings-devices li.device', vault: 'You\\s*$' }
		]
	}
];

/** Walks each of WALKS on `page`, timing each step to its first paint, up to 30 s a step; a step that didn't paint
 *  ends its walk: [{ app, level, paint (s or null), pill }]. */
async function views(page, when) {
	const seen = [];
	const first = (sel) => page.evaluate((sel) => !!document.querySelector(sel)?.click() || !!document.querySelector(sel), sel);
	for (const w of WALKS) {
		for (const step of w.steps) {
			const t0 = Date.now();
			const left = () => Math.max(0.1, 30 - (Date.now() - t0) / 1000);
			let ready = true;
			if (step.go) await go(page, step.go);
			if (step.click) ready = !!(await until(() => first(step.click), left()));
			if (ready && step.then) ready = !!(await until(() => first(step.then), left()));
			// a room the device doesn't know yet hasn't painted, whatever other room Chat shows
			if (step.room)
				ready = !!(await until(
					() =>
						page.evaluate((name) => {
							const b = [...document.querySelectorAll('.chat-page button.nav-item')].find((e) => e.textContent?.replace(/\s+/g, ' ').trim().replace(/^#\s*/, '') === name);
							b?.click();
							return !!b;
						}, step.room),
					left()
				));
			const painted = () =>
				page.evaluate(
					({ sel, text, not }) => [...document.querySelectorAll(sel)].some((e) => (!text || e.textContent?.includes(text)) && (!not || !new RegExp(not).test(e.textContent ?? ''))),
					{ sel: step.painted, text: step.text ?? '', not: step.not ?? '' }
				);
			let done = ready && (await until(painted, step.vault ? Math.min(5, left()) : left()));
			// the recipes live in Maia City: where the vault picked holds none, pick it in the nav pill's vaults, as a person does
			if (ready && !done && step.vault) {
				await page.evaluate(() => document.querySelector('button.item.identity')?.click());
				await sleep(300);
				await page.evaluate((name) => [...document.querySelectorAll('button.acct[role=menuitemradio]')].find((b) => new RegExp(name).test(b.textContent?.replace(/\s+/g, ' ') ?? ''))?.click(), step.vault);
				await sleep(300);
				await go(page, step.go);
				done = await until(painted, left());
			}
			seen.push({ app: w.app, level: step.level, paint: done ? Number(((Date.now() - t0) / 1000).toFixed(2)) : null, pill: await pill(page) });
			await shot(page, `view-${when}-${w.app}-${step.level.replace(/\W/g, '')}`);
			if (!done) break;
		}
	}
	return seen;
}

/** Opens Settings → Devices of the person's own vault on `page` (the entry that reads "…You" in the vault menu). */
async function own(page) {
	await go(page, `${base}/app/#settings/devices`);
	if (await until(() => page.$('#settings-devices li.device'), 5)) return;
	await page.evaluate(() => document.querySelector('button.item.identity')?.click());
	await sleep(300);
	await page.evaluate(() => [...document.querySelectorAll('button.acct[role=menuitemradio]')].find((b) => /You\s*$/.test(b.textContent?.replace(/\s+/g, ' ') ?? ''))?.click());
	await sleep(300);
	await go(page, `${base}/app/#settings/devices`);
	await until(() => page.$('#settings-devices li.device'), 30);
}

/** Names this device `name` in Settings → Devices on `page` (its own row's Rename), unless it is named so already. */
async function nameDevice(page, name) {
	const now = () => page.evaluate(() => [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.chip.accent'))?.querySelector('.who b')?.textContent?.trim() ?? null);
	if ((await now()) === name) return name;
	const opened = await page.evaluate(() => {
		const li = [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.chip.accent'));
		const b = [...(li?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Rename' && !b.disabled);
		b?.click();
		return !!b;
	});
	if (!opened || !(await until(() => page.$('#settings-devices li.device input.field'), 5))) return null;
	await page.fill('#settings-devices li.device input.field', name);
	await page.click('#settings-devices li.device input.field ~ button.btn.primary');
	return (await until(async () => ((await now()) === name ? name : null), 30)) ?? null;
}

/** Removes the device `id` (a full id, or at least its first 8 hex) from Settings → Devices on `page`: only where
 *  exactly one row shows its short id and that row isn't this device (`me`, its short id): { result, why? }. */
async function removeDevice(page, id, me) {
	if (!/^[0-9a-f]{8,}$/.test(id)) return { result: 'skipped', why: 'not an id' };
	const shortId = `${id.slice(0, 4)} ${id.slice(4, 8)}`;
	if (shortId === me) return { result: 'skipped', why: 'this device' };
	const rows = await page.evaluate((shortId) => [...document.querySelectorAll('#settings-devices li.device')].filter((li) => li.querySelector('.soft.mono')?.textContent?.trim() === shortId).length, shortId);
	if (rows !== 1) return { result: 'skipped', why: rows ? `${rows} rows show ${shortId}` : 'not listed' };
	// the page asks first (window.confirm in a browser): yes only to removing this one device
	const answer = (d) => (d.message().startsWith('Remove ') ? d.accept() : d.dismiss());
	page.once('dialog', answer);
	const clicked = await page.evaluate((shortId) => {
		const li = [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.soft.mono')?.textContent?.trim() === shortId);
		const b = [...(li?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Remove' && !b.disabled);
		b?.click();
		return !!b || (li?.querySelector('.remover .why')?.textContent?.trim() ?? 'no Remove button');
	}, shortId);
	if (clicked !== true) {
		page.off('dialog', answer);
		return { result: 'skipped', why: String(clicked) };
	}
	const said = await until(
		() =>
			page.evaluate((shortId) => {
				const li = [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.soft.mono')?.textContent?.trim() === shortId);
				if (!li) return 'Removed';
				const t = li.querySelector('.remover .why')?.textContent?.trim() ?? '';
				return /^(Removed|Not removed)/.test(t) ? t : null;
			}, shortId),
		120
	);
	await shot(page, `removed-${id.slice(0, 8)}`);
	return { result: said === 'Removed' ? 'removed' : 'not removed', why: said ?? 'no answer in 120 s' };
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
		// the fresh device stays one of the vault's: name it so it's known in Devices, and record its id for the next --remove
		await own(fresh.page);
		gate.freshDevice = await fresh.page.evaluate(() => [...document.querySelectorAll('#settings-devices li.device')].find((li) => li.querySelector('.chip.accent'))?.querySelector('.soft.mono')?.textContent?.trim() ?? null);
		gate.freshNamed = await nameDevice(fresh.page, `test-device roundtrip ${stamp.slice(5, 16)}`);
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
