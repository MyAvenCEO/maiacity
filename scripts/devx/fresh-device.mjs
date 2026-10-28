/*
 * The fresh-device check, the gate before a goal's one PR (Goal 7 P2, Samuel 2026-10-28: "real world test of mac and
 * iphone"): what a person sees when their passkey opens avenDB on a device that never held it, against a peer on this
 * machine, each step timed against its budget.
 *
 *   1. peer      a local avenDB peer on an empty shelf, its offer read from its log
 *   2. site      the app's dev server, its device the localhost-passkeys build of avendb-browser
 *   3. found     device A, a fresh Chromium profile, signs up: the gate founds the human vault (two ceremonies)
 *   4. write     A writes `--entries` todos and a marker, as a person fills a vault on their Mac
 *   5. sign-in   device B, a fresh profile (Chromium, or WebKit with `--fresh webkit`, the iPhone's engine), signs in
 *                with the same passkey: one ceremony, its vault handed over by the peer
 *   6. catch-up  B shows every todo of A's, the marker among them, and its pull is over (`synced`: none behind)
 *   7. live      B writes and A shows it; A writes and B shows it
 *   8. unlock    A reloads and unlocks in one ceremony
 *   9. cut       device C signs in, and the peer is killed in the middle of its pull and started again on the same
 *                shelf: C still ends with every todo
 *  10. settle    C's processes (page, worker, network) come back under 10 % of one core, as an idle phone must
 *
 * The passkey is one software authenticator shared by every device, as a passkey synced by iCloud Keychain is: P-256
 * assertions and PRF outputs (CTAP2 hmac-secret, as WebAuthn's PRF hashes its salts) made with WebCrypto in the page,
 * the same in Chromium and WebKit. A browser's own virtual authenticator can't hand a passkey to another profile with
 * its PRF secret, and WebKit has none. Nothing here reaches a live peer, an account or a secret.
 *
 *   node scripts/devx/fresh-device.mjs [--fresh chromium|webkit] [--entries 2000] [--json] [--keep] [--build]
 *
 * --build rebuilds the device (wasm-bindgen 0.2.129) and the peer with `localhost-passkeys` first; without it, the
 * builds of a run before are taken, and made where none is. The device's package goes to avendb/target/fresh-device/,
 * never src/lib/avendb/device/, which holds the committed build: the dev server answers its two files from there.
 * --keep leaves the peer's shelf and the profiles in place and prints where. Exit 1 when a step fails or overruns.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer as listen } from 'node:net';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const avendb = join(root, 'avendb');
const target = process.env.CARGO_TARGET_DIR ?? join(avendb, 'target');
const pkg = join(target, 'fresh-device', 'pkg');
const peerBin = join(target, 'debug', 'avendb-server');

/** Seconds each step may take, on a 4-core cloud box; a step over its budget fails the check. */
export const BUDGETS = { peer: 30, site: 90, found: 90, write: 60, signin: 60, catchup: 60, live: 15, unlock: 30, cut: 90, settle: 30 };
/** Under this share of one core for SETTLE_FOR seconds, a device is idle. */
const IDLE = 0.1;
const SETTLE_FOR = 5;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const fresh = option('--fresh', 'chromium');
const entries = Number(option('--entries', '2000'));
if (!['chromium', 'webkit'].includes(fresh)) throw new Error('--fresh: chromium or webkit');
const json = flag('--json');
const say = (...a) => !json && console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── builds ───

function run(cmd, argv, cwd = avendb) {
	say(`  $ ${cmd} ${argv.join(' ')}`);
	const r = spawnSync(cmd, argv, { cwd, stdio: json ? ['ignore', 'ignore', 'inherit'] : 'inherit' });
	if (r.status !== 0) throw new Error(`${cmd} ${argv[0]} failed (${r.status ?? r.signal})`);
}
function build() {
	const want = '0.2.129';
	const have = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).stdout?.split(' ')[1]?.trim();
	if (have !== want) throw new Error(`needs wasm-bindgen ${want} (found ${have ?? 'none'}): cargo install wasm-bindgen-cli --version ${want} --locked`);
	run('cargo', ['build', '-p', 'avendb-browser', '--target', 'wasm32-unknown-unknown', '--release', '--features', 'localhost-passkeys']);
	run('wasm-bindgen', ['--target', 'web', '--no-typescript', '--out-dir', pkg, join(target, 'wasm32-unknown-unknown/release/avendb_browser.wasm')]);
	run('cargo', ['build', '-p', 'avendb-server', '--features', 'avendb/localhost-passkeys']);
}

// ─── the peer ───

const free = () =>
	new Promise((ok, no) => {
		const s = listen().once('error', no);
		s.listen(0, '127.0.0.1', () => {
			const { port } = /** @type {import('node:net').AddressInfo} */ (s.address());
			s.close(() => ok(port));
		});
	});

/** The peer on shelf `data`, at `ports`: its process and its offer, once it logged it. */
async function startPeer(data, ports) {
	const env = {
		...process.env,
		AVENDB_DATA: data,
		AVENDB_BIND: `127.0.0.1:${ports.bind}`,
		AVENDB_RELAY_BIND: `127.0.0.1:${ports.relay}`,
		AVENDB_RELAY_URL: `http://localhost:${ports.relay}`,
		AVENDB_FEED_BIND: `127.0.0.1:${ports.feed}`,
		RUST_LOG: process.env.RUST_LOG ?? 'info'
	};
	const child = spawn(peerBin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
	const offer = await new Promise((ok, no) => {
		let seen = '';
		const read = (b) => {
			seen = (seen + b).slice(-20000);
			const m = /offer (AVENDB1[A-Z0-9]+)/.exec(seen);
			if (m) ok(m[1]);
		};
		child.stdout.on('data', read);
		child.stderr.on('data', read);
		child.once('exit', (code) => no(new Error(`the peer ended before its offer (${code}): ${seen.slice(-2000)}`)));
	});
	child.stdout.resume();
	child.stderr.resume();
	return { child, offer };
}
const stopPeer = (peer, signal = 'SIGTERM') =>
	new Promise((ok) => {
		if (peer.child.exitCode !== null) return ok();
		peer.child.once('exit', ok);
		peer.child.kill(signal);
	});

// ─── the site ───

/** The app's dev server, the device's two files answered from the localhost-passkeys package. */
async function startSite() {
	const { createServer } = await import('vite');
	const files = { '/src/lib/avendb/device/avendb_browser.js': 'text/javascript', '/src/lib/avendb/device/avendb_browser_bg.wasm': 'application/wasm' };
	const swap = {
		name: 'fresh-device-package',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? '').split('?')[0];
				if (!files[path]) return next();
				res.setHeader('Content-Type', files[path]);
				res.setHeader('Cache-Control', 'no-store');
				res.end(readFileSync(join(pkg, path.split('/').pop())));
			});
		}
	};
	const server = await createServer({ root, logLevel: 'silent', clearScreen: false, plugins: [swap], server: { host: 'localhost', port: await free(), strictPort: true } });
	await server.listen();
	return { server, base: `http://localhost:${server.config.server.port}` };
}

// ─── the passkey: one software authenticator for every device ───

/** Runs in the page, before any of its own code: navigator.credentials as an authenticator holding passkey `key`. */
function authenticator(key) {
	const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const unb64u = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
	const bytes = (b) => (b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
	const join = (...parts) => {
		const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) out.set(p, (at += p.length) - p.length);
		return out;
	};
	const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
	const enc = new TextEncoder();
	const id = unb64u(key.id);
	const signing = crypto.subtle.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
	const { d: _, ...pub } = key.jwk;
	const spki = crypto.subtle
		.importKey('jwk', { ...pub, key_ops: ['verify'] }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
		.then((k) => crypto.subtle.exportKey('spki', k));
	const hmac = crypto.subtle.importKey('raw', unb64u(key.prf), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	/** WebAuthn's PRF: the salt hashed under its label, then the credential's hmac-secret over it */
	const prf = async (salt) =>
		crypto.subtle.sign('HMAC', await hmac, await sha(join(enc.encode('WebAuthn PRF'), new Uint8Array([0]), bytes(salt))));
	/** rpIdHash, flags (UP, UV, backup eligible and backed up, as a synced passkey), a zero counter */
	const authData = async (rpId) => join(await sha(enc.encode(rpId)), new Uint8Array([0x01 | 0x04 | 0x08 | 0x10, 0, 0, 0, 0]));
	/** WebCrypto's r‖s as the DER WebAuthn's assertions carry */
	const der = (rs) => {
		const int = (x) => {
			let i = 0;
			while (i < x.length - 1 && x[i] === 0) i++;
			x = x.slice(i);
			return x[0] & 0x80 ? join(new Uint8Array([0]), x) : x;
		};
		const [r, s] = [int(rs.slice(0, 32)), int(rs.slice(32))];
		return join(new Uint8Array([0x30, r.length + s.length + 4, 2, r.length]), r, new Uint8Array([2, s.length]), s);
	};
	const clientData = (type, challenge) =>
		enc.encode(JSON.stringify({ type, challenge: b64u(bytes(challenge)), origin: location.origin, crossOrigin: false }));
	const counts = (globalThis.__ceremonies = { created: 0, asserted: 0 });
	const credential = (response, extensions) => ({
		id: key.id,
		rawId: id.buffer,
		type: 'public-key',
		authenticatorAttachment: 'platform',
		response,
		getClientExtensionResults: () => extensions,
		toJSON: () => ({ id: key.id })
	});
	const credentials = {
		async create({ publicKey }) {
			counts.created++;
			const data = clientData('webauthn.create', publicKey.challenge);
			const key = await spki;
			return credential(
				{ clientDataJSON: data.buffer, attestationObject: new ArrayBuffer(0), getPublicKey: () => key, getPublicKeyAlgorithm: () => -7, getTransports: () => ['internal'] },
				{ prf: { enabled: true } }
			);
		},
		async get({ publicKey }) {
			const allowed = publicKey.allowCredentials ?? [];
			if (allowed.length && !allowed.some((c) => b64u(bytes(c.id)) === key.id)) throw new DOMException('no such passkey here', 'NotAllowedError');
			counts.asserted++;
			const data = clientData('webauthn.get', publicKey.challenge);
			const auth = await authData(publicKey.rpId ?? location.hostname);
			const signed = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signing, join(auth, await sha(data))));
			const ask = publicKey.extensions?.prf?.eval;
			const results = ask ? { first: await prf(ask.first), ...(ask.second ? { second: await prf(ask.second) } : {}) } : undefined;
			return credential(
				{ clientDataJSON: data.buffer, authenticatorData: auth.buffer, signature: der(signed).buffer, userHandle: null },
				results ? { prf: { results } } : {}
			);
		}
	};
	Object.defineProperty(navigator, 'credentials', { configurable: true, value: credentials });
	globalThis.PublicKeyCredential ??= /** @type {any} */ (class PublicKeyCredential {});
	PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
	PublicKeyCredential.getClientCapabilities = async () => ({ prf: true, extension_prf: true, passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: true });
}

/** A new passkey: its credential id, its P-256 key and its hmac-secret, which every device's authenticator holds. */
function passkey() {
	const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	return { id: randomBytes(16).toString('base64url'), jwk: privateKey.export({ format: 'jwk' }), prf: randomBytes(32).toString('base64url') };
}

// ─── the devices ───

/** A device: a browser of `engine` on a profile of its own, the passkey `key` in its authenticator, the peer `peer`. */
async function device(name, engine, key, at, dir = mkdtempSync(join(tmpdir(), `fresh-device-${name}-`))) {
	const pw = await import('playwright');
	const options = { headless: true, viewport: { width: 390, height: 844 } };
	if (engine === 'chromium') Object.assign(options, { executablePath: process.env.CHROME ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--no-sandbox'] });
	const context = await pw[engine].launchPersistentContext(dir, options).catch((e) => {
		if (engine === 'webkit') throw new Error(`no WebKit for Playwright ${pw.chromium.name?.() ?? ''}: install the one of this Playwright's version (${e.message.split('\n')[0]})`);
		throw e;
	});
	await context.addInitScript(authenticator, key);
	await context.addInitScript(([relay, server]) => {
		sessionStorage.setItem('avendb:relay', relay);
		sessionStorage.setItem('avendb:server', server);
	}, [at.relay, at.offer]);
	const page = context.pages()[0] ?? (await context.newPage());
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return { name, engine, dir, context, page, errors };
}

/** The app's own avenDB session (the module as the app loaded it) in device `d`: its phase and vault with no `op`,
 *  else what it answers op `op`. The page's CSP allows no eval, so this is the one function run in it. */
const inSession = (d, op = null) =>
	d.page.evaluate(async (op) => {
		const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => new URL(n).pathname === '/src/lib/avendb/session.svelte.js');
		const { session } = await import(url ?? '/src/lib/avendb/session.svelte.js');
		return op ? session.ask(op) : { phase: session.phase, mine: session.world?.mine ?? null };
	}, op);
const phase = (d) => inSession(d).catch((e) => ({ phase: 'loading', mine: null, error: String(e) }));
const ceremonies = (d) => d.page.evaluate(() => globalThis.__ceremonies?.asserted ?? 0);
/** The todos of vault `vault` this device shows, by title. */
const todos = (d, vault) =>
	inSession(d, { op: 'entry_views', vault, kind: 'todo' })
		.then((got) => (got?.ok?.rows ?? []).filter((e) => !e.deleted).map((e) => e.title ?? ''))
		.catch(() => []);
const synced = (d) => inSession(d, { op: 'synced' }).then((got) => got?.ok ?? null, () => null);
/** Adds todos titled `titles` to vault `vault`, a hundred to a batch. */
async function add(d, vault, titles) {
	for (let i = 0; i < titles.length; i += 100) {
		const ops = titles.slice(i, i + 100).map((title) => ({ op: 'create', vault, type: 'todo', value: { kind: 'todo', title } }));
		const out = await inSession(d, ops.length === 1 ? ops[0] : { op: 'batch', ops });
		if (out?.refused) throw new Error(`${d.name} could not write: ${out.why ?? JSON.stringify(out)}`);
	}
}
async function until(holds, seconds) {
	const end = Date.now() + seconds * 1000;
	for (;;) {
		const got = await holds();
		if (got) return got;
		if (Date.now() > end) return null;
		await sleep(250);
	}
}
/** Clicks the button whose words include `t`. */
const press = (d, t) =>
	d.page.evaluate((t) => {
		const b = [...document.querySelectorAll('button')].find((e) => e.textContent?.replace(/\s+/g, ' ').includes(t) && !e.disabled);
		b?.click();
		return !!b;
	}, t);
const words = (d) => d.page.evaluate(() => document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 400) ?? '');

/** The device's processes: its browser's and every one under it. */
function tree(d) {
	const procs = readdirSync('/proc').filter((p) => /^\d+$/.test(p));
	const parent = new Map();
	let top = null;
	for (const p of procs) {
		try {
			const stat = readFileSync(`/proc/${p}/stat`, 'utf8');
			parent.set(p, stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
			if (!top && readFileSync(`/proc/${p}/cmdline`, 'utf8').includes(d.dir)) top = p;
		} catch {
			/* gone */
		}
	}
	if (!top) return [];
	const all = new Set([top]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const [p, pp] of parent) if (!all.has(p) && all.has(pp)) all.add(p), (grew = true);
	}
	return [...all];
}
/** CPU seconds the device's processes used, all told. */
function cpu(d) {
	let ticks = 0;
	for (const p of tree(d)) {
		try {
			const f = readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' ');
			ticks += Number(f[11]) + Number(f[12]);
		} catch {
			/* gone */
		}
	}
	return ticks / 100;
}
/** Seconds until the device used under IDLE of a core for SETTLE_FOR seconds running, or null past `seconds`. */
async function settle(d, seconds) {
	const t0 = Date.now();
	const window = [];
	let [last, at] = [cpu(d), Date.now()];
	while (Date.now() - t0 < seconds * 1000) {
		await sleep(500);
		const [now, when] = [cpu(d), Date.now()];
		window.push({ used: now - last, span: (when - at) / 1000 });
		[last, at] = [now, when];
		while (window.reduce((n, w) => n + w.span, 0) > SETTLE_FOR + 0.25) window.shift();
		const span = window.reduce((n, w) => n + w.span, 0);
		if (span >= SETTLE_FOR && window.reduce((n, w) => n + w.used, 0) / span < IDLE) return (Date.now() - t0) / 1000 - SETTLE_FOR;
	}
	return null;
}

// ─── the check ───

const steps = [];
/** Runs step `name`, timed against its budget; `fn` says what it found, and throws where it failed. */
async function step(name, fn) {
	const t = Date.now();
	let found = '';
	let ok = true;
	try {
		found = (await fn()) ?? '';
	} catch (e) {
		[ok, found] = [false, e instanceof Error ? e.message : String(e)];
	}
	const seconds = (Date.now() - t) / 1000;
	const over = seconds > BUDGETS[name];
	steps.push({ step: name, seconds: Number(seconds.toFixed(1)), budget: BUDGETS[name], ok: ok && !over, found });
	say(`${ok && !over ? '✓' : '✕'} ${name.padEnd(8)} ${seconds.toFixed(1).padStart(6)} s of ${BUDGETS[name]} s  ${found}`);
	if (!ok) throw new Error(`${name}: ${found}`);
}

const temp = mkdtempSync(join(tmpdir(), 'fresh-device-peer-'));
const ports = { bind: await free(), relay: await free(), feed: await free() };
const devices = [];
let peer = null;
let site = null;
try {
	if (flag('--build') || !existsSync(join(pkg, 'avendb_browser_bg.wasm')) || !existsSync(peerBin)) build();
	const key = passkey();
	await step('peer', async () => {
		peer = await startPeer(temp, ports);
		return `offer ${peer.offer.slice(0, 16)}…`;
	});
	const at = { relay: `http://localhost:${ports.relay}`, offer: peer.offer };
	await step('site', async () => {
		site = await startSite();
		// the first load compiles the app's modules: warmed here, so the steps after time the device, not vite
		const warm = await device('warm', 'chromium', key, at);
		await warm.page.goto(`${site.base}/app/`, { waitUntil: 'load', timeout: BUDGETS.site * 1000 });
		await warm.context.close();
		rmSync(warm.dir, { recursive: true, force: true });
		return site.base;
	});

	let a = await device('A', 'chromium', key, at);
	devices.push(a);
	let vault = '';
	await step('found', async () => {
		await a.page.addInitScript(() => sessionStorage.setItem('maia:signup', 'Fresh Device'));
		await a.page.goto(`${site.base}/app/`, { waitUntil: 'domcontentloaded' });
		if (!(await until(() => press(a, 'Set up my human vault'), 30))) throw new Error(`no “Set up my human vault”: ${await words(a)}`);
		const open = await until(async () => ((await phase(a)).phase === 'open' && (await phase(a)).mine) || null, BUDGETS.found * 2);
		if (!open) throw new Error(`the vault didn't open: ${JSON.stringify(await phase(a))} ${await words(a)}`);
		vault = (await phase(a)).mine;
		const asked = await ceremonies(a);
		if (asked !== 2) throw new Error(`${asked} ceremonies, not 2`);
		return `vault ${vault.slice(0, 12)}…, 2 ceremonies`;
	});

	const marker = `marker ${Date.now()}`;
	await step('write', async () => {
		await add(a, vault, Array.from({ length: entries }, (_, i) => `todo ${i + 1} of ${entries}`));
		await add(a, vault, [marker]);
		const shown = await until(async () => (await todos(a, vault)).includes(marker), BUDGETS.write);
		if (!shown) throw new Error('A does not show its own marker');
		return `${entries + 1} todos`;
	});

	/** Device `name` signs in, fresh: one ceremony, its vault the same as A's. */
	const signIn = async (name) => {
		const d = await device(name, fresh, key, at);
		devices.push(d);
		await d.page.goto(`${site.base}/app/`, { waitUntil: 'domcontentloaded' });
		if (!(await until(() => press(d, 'Sign in with your passkey'), 30))) throw new Error(`no “Sign in with your passkey”: ${await words(d)}`);
		const open = await until(async () => ((await phase(d)).mine === vault) || null, BUDGETS.signin * 2);
		if (!open) throw new Error(`${name} didn't open A's vault: ${await words(d)}`);
		const asked = await ceremonies(d);
		if (asked !== 1) throw new Error(`${asked} ceremonies, not 1`);
		return d;
	};
	/** Whether `d` shows all A's todos with the marker, its pull over: what it shows, else null. */
	const caughtUp = async (d, want) => {
		const shown = await todos(d, vault);
		if (shown.length < want || !shown.includes(marker)) return null;
		const s = await synced(d);
		return s && s.behind === 0 && s.pulling === 0 ? { shown: shown.length, pages: s.pages } : null;
	};

	let b = null;
	await step('signin', async () => {
		b = await signIn('B');
		return `${fresh}, 1 ceremony`;
	});
	await step('catchup', async () => {
		const got = await until(() => caughtUp(b, entries + 1), BUDGETS.catchup * 2);
		if (!got) throw new Error(`B shows ${(await todos(b, vault)).length} of ${entries + 1} todos; synced ${JSON.stringify(await synced(b))}`);
		return `${got.shown} todos in ${got.pages} pages`;
	});

	await step('live', async () => {
		const fromB = `from B ${Date.now()}`;
		const fromA = `from A ${Date.now()}`;
		await add(b, vault, [fromB]);
		if (!(await until(async () => (await todos(a, vault)).includes(fromB), BUDGETS.live * 2))) throw new Error('A never showed B’s todo');
		const t = Date.now();
		await add(a, vault, [fromA]);
		if (!(await until(async () => (await todos(b, vault)).includes(fromA), BUDGETS.live * 2))) throw new Error('B never showed A’s todo');
		return `B→A then A→B ${((Date.now() - t) / 1000).toFixed(1)} s`;
	});

	await step('unlock', async () => {
		// the browser quit and started again on its profile, as a phone's app is: a reload keeps the device open
		await a.context.close();
		devices.splice(devices.indexOf(a), 1);
		a = await device('A', 'chromium', key, at, a.dir);
		devices.push(a);
		await a.page.goto(`${site.base}/app/`, { waitUntil: 'domcontentloaded' });
		if (!(await until(() => press(a, 'Unlock now'), 30))) throw new Error(`no “Unlock now”: ${await words(a)}`);
		const open = await until(async () => (await phase(a)).phase === 'open' || null, BUDGETS.unlock * 2);
		if (!open) throw new Error(`A didn't unlock: ${await words(a)}`);
		const asked = await ceremonies(a);
		if (asked !== 1) throw new Error(`${asked} ceremonies, not 1`);
		if (!(await until(async () => (await todos(a, vault)).includes(marker), 10))) throw new Error('A unlocked without its todos');
		return '1 ceremony, its todos there';
	});

	let c = null;
	await step('cut', async () => {
		c = await signIn('C');
		// cut in the middle of the pull: once its first todos came, before the last
		const total = entries + 3;
		await until(async () => (await todos(c, vault)).length > 0 || null, 30);
		const held = (await todos(c, vault)).length;
		await stopPeer(peer, 'SIGKILL');
		if (held >= total) throw new Error(`C held all ${total} todos before the cut: raise --entries`);
		await sleep(2000);
		const back = Date.now();
		peer = await startPeer(temp, ports);
		// what the person sees (every todo shown) and when the device's pulls are over: a pull bound to the killed
		// connection may hold `pulling` up after the todos are all there (2026-10-28: shown 4 s, over 40 s after)
		const shown = await until(async () => (await todos(c, vault)).length >= total || null, BUDGETS.cut * 2);
		const shownAfter = ((Date.now() - back) / 1000).toFixed(1);
		const got = shown && (await until(() => caughtUp(c, total), BUDGETS.cut * 2));
		if (!got) throw new Error(`after the cut C shows ${(await todos(c, vault)).length} of ${total}; synced ${JSON.stringify(await synced(c))}`);
		return `cut at ${held} of ${total} todos; all shown ${shownAfter} s, pulls over ${((Date.now() - back) / 1000).toFixed(1)} s after the peer came back`;
	});
	await step('settle', async () => {
		const procs = tree(c).length;
		if (!procs) throw new Error('found none of C’s processes to measure');
		const after = await settle(c, BUDGETS.settle * 2);
		if (after === null) throw new Error(`C still busy after ${BUDGETS.settle * 2} s`);
		return `${procs} processes under ${IDLE * 100} % of a core ${after.toFixed(1)} s after it caught up`;
	});

	for (const d of devices) if (d.errors.length) steps.push({ step: `errors ${d.name}`, seconds: 0, budget: 0, ok: false, found: d.errors.slice(0, 3).join(' | ') });
} catch (e) {
	if (!steps.some((s) => !s.ok)) steps.push({ step: 'run', seconds: 0, budget: 0, ok: false, found: e instanceof Error ? e.message : String(e) });
	say(`✕ ${e instanceof Error ? e.message : e}`);
} finally {
	for (const d of devices) {
		await d.context.close().catch(() => {});
		if (!flag('--keep')) rmSync(d.dir, { recursive: true, force: true });
	}
	await site?.server.close();
	if (peer) await stopPeer(peer);
	if (flag('--keep')) say(`kept: peer shelf ${temp}; profiles ${devices.map((d) => d.dir).join(' ')}`);
	else rmSync(temp, { recursive: true, force: true });
}

const failed = steps.filter((s) => !s.ok);
if (json) console.log(JSON.stringify({ fresh, entries, budgets: BUDGETS, steps, ok: !failed.length }, null, 1));
else say(`\n${failed.length ? `${failed.length} step(s) failed or overran` : 'every step within its budget'} (fresh device: ${fresh}, ${entries} todos)`);
process.exit(failed.length ? 1 : 0);
