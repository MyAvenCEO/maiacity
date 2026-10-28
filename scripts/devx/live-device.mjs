/*
 * The self-test device (Samuel 2026-10-28: "use a browser instead of the iPhone ... so you can self serve your own
 * testing, screenshots and timings"): Playwright WebKit (the iPhone's engine) on the Mac, on a profile of its own that
 * keeps its shelf between runs, opening maia.city against the always-on peer as a phone does. Its passkey is a
 * disposable software one (./passkey.mjs) kept in the Mac's login Keychain; it roots a small "Dev browser" vault that
 * Samuel makes a co-owner of his own, so it syncs what his phone syncs. Removing that owner disposes of it.
 *
 *   node scripts/devx/live-device.mjs --setup ['<invite link>'] once: found the dev vault (through the app's gate, or
 *                                                                an invite's join page), print its id for Settings → Owners
 *   node scripts/devx/live-device.mjs --accept                  once, after Samuel invited it: accept co-owning
 *   node scripts/devx/live-device.mjs                           a run: reopen + unlock, sync, Chat, Assets, report
 *
 * Options: --engine webkit|chromium (webkit), --base https://maia.city, --sync 60 (seconds to watch sync),
 * --profile <dir>. Each run writes build/live-device/<time>/: screenshots in order, run.json (step times, the unlock
 * sheet's steps, the sync pill over time, first paints, every diagnostics report the page sent, which is the phone's),
 * and prints one line of numbers with pass/fail against the targets below. One heavy job at a time on the 8 GB Mac:
 * don't run it beside a Rust build.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticator, passkey } from './passkey.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const engine = option('--engine', 'webkit');
const base = option('--base', 'https://maia.city').replace(/\/$/, '');
const watchSync = Number(option('--sync', '60'));
const mac = platform() === 'darwin';
const profile = option('--profile', mac ? join(homedir(), 'Library/Application Support/maiacity-live-device', engine) : join(homedir(), '.maiacity-live-device', engine));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join(root, 'build/live-device', stamp);
mkdirSync(out, { recursive: true });
mkdirSync(profile, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a run must meet. */
export const TARGETS = { unlock: 5, firstPaint: 0.5 };

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

async function launch() {
	const pw = await import('playwright');
	const key = readKey();
	if (!key) throw new Error(`no dev passkey yet: run with --setup '<invite link>' first`);
	const options = { headless: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
	if (engine === 'chromium' && existsSync('/opt/pw-browsers/chromium')) Object.assign(options, { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
	const context = await pw[engine].launchPersistentContext(profile, options).catch((e) => {
		throw new Error(`${engine} didn't start (${e.message.split('\n')[0]}): on the Mac, once: npx playwright install ${engine}`);
	});
	await context.addInitScript(authenticator, key);
	// a dev site against a local peer (scripts/devx/fresh-device.mjs's): RELAY and SERVER, which only a dev build takes
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

if (args.includes('--setup')) await setup((option('--setup') ?? '').startsWith('http') ? option('--setup') : '');
else if (args.includes('--accept')) await accept();
else process.exit((await run()) ? 0 : 1);
