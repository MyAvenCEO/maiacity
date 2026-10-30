// The city-dome's chat with its history and files, checked in the cast's box (store/README.md, "How it is checked"),
// in the browsers' container, on Alice's and Bob's Peer-Lights at alice.localhost and bob.localhost:
//
// - Alice writes lines and Bob's chat shows them; Bob reloads and finds the whole chat, in order (3);
// - Bob, offline, writes a line: it shows at once, still on its way, and arrives on reconnect; then the room is live
//   for him again (4);
// - a fork of Bob's chain is raised by the Aven Peer and never shown; a line of a device that is no member's is
//   dropped by every peer and never shown (5);
// - Alice shares an image and a PDF: each is a file line of her chain, shown in her chat at once (local first) and
//   loaded from her own store through the Service Worker's /files/<hash>, a range of it a 206; Bob's chat loads them
//   too, their chunks fetched from the Aven Peer, which keeps every file, or from Alice;
// - last, a third browser on Bob's origin, with an empty OPFS, joins later and catches up on the whole chat (3); it
//   writes at once, before it knows its own head, and the line continues Bob's chain: never a fork of it.
//
// The fork and the stranger's line are signed here with the cast's test keys (public on purpose, valid only inside
// the box), as a cloned device or an outsider would, and sent through Alice's Peer-Light as they are. What a line's
// body is and what the peers answer comes from Lean (`Aven.DB.Chains`, its traces replayed by aven-db-core's tests);
// here only the box's mechanics.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { lines } from './records.mjs';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const problems = [];
const report = {};
const started = Date.now();
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const stamp = `${started}`;

async function line(match, since, timeout = 20_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const found = lines().find((l) => l.t >= since && match(l));
		if (found) return found;
		await wait(200);
	}
	return null;
}

const seen = (locator, timeout = 20_000) =>
	locator
		.first()
		.waitFor({ timeout })
		.then(() => true)
		.catch(() => false);
const shown = (page) => page.getByTestId('lines').locator('li[data-from]');
// each line shown by its name, its sender and its words: not whether it is still on its way, which a reload may learn
const texts = (page) =>
	shown(page).evaluateAll((lis) => lis.map((li) => `${li.dataset.id} ${li.querySelector('strong')?.textContent ?? ''} ${li.querySelector('.text, figcaption')?.textContent ?? ''}`));

// a cast's test key: its Ed25519 seed is sha256("avenSANDBOX test signer: <id>") (cast.json)
const seed = (id) => createHash('sha256').update(`avenSANDBOX test signer: ${id}`).digest();
const ed25519 = (seed) => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicHex = (key) => Buffer.from(key.export({ format: 'jwk' }).x, 'base64url').toString('hex');

// A line's blob (aven-db-core's `chain::Line::blob`): its body with the signature after its `at` line
function blob({ device, seq, prev, at, text }, key) {
	const head = `avenDB line 1\nnetwork aven\ndevice ${device}\nseq ${seq}\nprev ${prev ?? 'none'}\nat ${at}\n`;
	const body = `text\n${text}`;
	const sig = sign(null, Buffer.from(`${head}${body}`), key).toString('hex');
	return `${head}sig ${sig}\n${body}`;
}

// a line sent as it is through a page's Peer-Light, its worker opened as the page opens it (members.mjs)
const postLine = (page, name, blob) =>
	page.evaluate(
		async ({ name, blob }) => {
			const { port } = (await import('/peer/open.js')).openWorker(name);
			port.start?.();
			port.postMessage({ post_line: blob });
		},
		{ name, blob },
	);

// a 16 × 16 image, a PNG made here, its colour the run's own so each run shares a new file: its chunks, each with
// its CRC
function makePng(shade) {
	const chunk = (type, data) => {
		const head = Buffer.alloc(4);
		head.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([head, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(16, 0);
	ihdr.writeUInt32BE(16, 4);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(16 * 4, shade)]);
	const pixels = deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)));
	return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const profiles = {};
async function open(who, profile = who) {
	profiles[profile] ??= await browser.newContext({ viewport: { width: 1100, height: 700 } });
	const page = await profiles[profile].newPage();
	await page.goto(`http://${who}.localhost:5173/#/${who}/chat`);
	await seen(page.locator('[data-view="chat"]'));
	return page;
}
const say = async (page, text) => {
	await page.getByTestId('line').fill(text);
	await page.getByTestId('say').click();
};

const alice = await open('alice');
const bob = await open('bob');
await seen(bob.locator('[data-testid="present"] li[data-vault="alice"]'));

// Alice's lines reach Bob, and show in order
const written = [`one, ${stamp}`, `two, ${stamp}`, `three, ${stamp}`];
for (const text of written) await say(alice, text);
for (const text of written) if (!(await seen(bob.getByTestId('lines').locator('li', { hasText: text })))) problems.push(`"${text}" did not reach Bob`);

// Bob's chat is the whole chat, Alice's, once both caught up from the Aven Peer
const agree = async () => (await texts(bob)).join('\n') === (await texts(alice)).join('\n');
const agreeAt = Date.now();
for (let i = 0; i < 120 && !(await agree()); i++) await wait(250);
report.caughtUpMs = Date.now() - agreeAt;
if (!(await agree())) problems.push(`Bob's chat holds ${(await texts(bob)).length} lines, Alice's ${(await texts(alice)).length}, or not in the same order`);

// 3. Bob reloads and finds the whole chat, in order
const before = await texts(bob);
const reloadAt = Date.now();
await bob.reload();
await seen(bob.locator('[data-view="chat"]'));
const same = async (page) => (await texts(page)).join('\n') === before.join('\n');
for (let i = 0; i < 120 && !(await same(bob)); i++) await wait(250);
report.reloadMs = Date.now() - reloadAt;
if (!(await same(bob))) problems.push(`after a reload Bob's chat holds ${(await texts(bob)).length} of ${before.length} lines, or not in order`);
await bob.screenshot({ path: `${run}/dome-bob-reloaded.png` });

// 4. Bob, offline, writes a line: shown at once, still on its way; on reconnect it arrives
await profiles.bob.setOffline(true);
const offline = `written offline, ${stamp}`;
const offlineAt = Date.now();
await say(bob, offline);
if (!(await seen(bob.getByTestId('lines').locator('li', { hasText: offline }), 2000))) problems.push('a line written offline did not show at once');
report.offlineShownMs = Date.now() - offlineAt;
report.offlineSending = await bob.getByTestId('lines').locator('li', { hasText: offline }).getByTestId('sending').count();
await bob.screenshot({ path: `${run}/dome-bob-offline.png` });
await profiles.bob.setOffline(false);
if (!(await seen(alice.getByTestId('lines').locator('li', { hasText: offline }), 40_000))) problems.push('a line written offline did not arrive on reconnect');
report.offlineArrivedMs = Date.now() - offlineAt;
// and the room is live again for Bob: Alice's next line reaches him
const again = `live again, ${stamp}`;
const againAt = Date.now();
await say(alice, again);
if (!(await seen(bob.getByTestId('lines').locator('li', { hasText: again }), 40_000))) problems.push('after reconnecting, Bob did not hear the room live');
report.liveAgainMs = Date.now() - againAt;

// 5. a fork of Bob's chain: a second first line, as a cloned device would write it. Raised, never shown
const bobKey = ed25519(seed('bob-peer-light'));
const bobDevice = publicHex(bobKey);
const forkAt = Date.now();
const fork = blob({ device: bobDevice, seq: 1, at: forkAt, text: `a fork, ${stamp}` }, bobKey);
await postLine(alice, 'alice-peer-light', fork);
const raised = await line((l) => l.peer === 'aven-peer' && l.event === 'fork' && l.key === bobDevice, forkAt);
if (!raised) problems.push('the Aven Peer did not raise the fork');
// a line of a device that is no member's: dropped, never shown
const eve = ed25519(createHash('sha256').update(`not a member ${stamp}`).digest());
const strangerAt = Date.now();
await postLine(alice, 'alice-peer-light', blob({ device: publicHex(eve), seq: 1, at: strangerAt, text: `a stranger, ${stamp}` }, eve));
for (const peer of ['aven-peer', 'bob-peer-light']) {
	const dropped = await line((l) => l.peer === peer && l.event === 'dropped' && l.from === publicHex(eve).slice(0, 10), strangerAt);
	if (dropped?.why !== 'notMember') problems.push(`${peer} did not drop the stranger's line: ${JSON.stringify(dropped)}`);
}
await wait(1000);
for (const text of [`a fork, ${stamp}`, `a stranger, ${stamp}`])
	if (await bob.getByTestId('lines').locator('li', { hasText: text }).count()) problems.push(`Bob's chat shows "${text}"`);

// files: Alice shares an image and a PDF; her chat shows them at once, from her own store
const png = makePng(started % 256);
const pdf = Buffer.from(
	'%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const sharedAt = Date.now();
await alice.getByTestId('file-input').setInputFiles([
	{ name: `dot-${stamp}.png`, mimeType: 'image/png', buffer: png },
	{ name: `page-${stamp}.pdf`, mimeType: 'application/pdf', buffer: pdf },
]);
const image = alice.locator(`[data-testid="file"][data-kind="image"]`, { has: alice.locator(`a[download="dot-${stamp}.png"]`) }).last();
if (!(await seen(image))) problems.push("Alice's image did not show as a line of her chat");
if (!(await seen(alice.locator(`[data-testid="file"][data-kind="pdf"]`, { has: alice.locator(`a[download="page-${stamp}.pdf"]`) }))))
	problems.push("Alice's PDF did not show as a line of her chat");
report.fileShownMs = Date.now() - sharedAt;
await alice.screenshot({ path: `${run}/dome-alice-files.png` });
// the bytes, through the Service Worker's /files/<hash>: Alice's from her own store, a range of them as a 206
const loaded = async (img) => img.evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false);
const until = async (ok, ms = 30_000) => {
	for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if (await ok()) return true;
	return false;
};
if (!(await until(() => loaded(image.locator('img'))))) problems.push("Alice's image did not load from /files/<hash>");
report.imageLoadedMs = Date.now() - sharedAt;
const file = await image.getAttribute('data-file').catch(() => null);
const range = await alice.evaluate(async (path) => {
	const r = await fetch(path, { headers: { Range: 'bytes=1-3' } }).catch(() => null);
	return r && { status: r.status, range: r.headers.get('content-range'), bytes: [...new Uint8Array(await r.arrayBuffer())] };
}, `/files/${file}`);
report.range = range;
if (range?.status !== 206 || range.range !== `bytes 1-3/${png.length}` || JSON.stringify(range.bytes) !== JSON.stringify([...png.subarray(1, 4)]))
	problems.push(`a range of Alice's image is ${JSON.stringify(range)}`);
await alice.screenshot({ path: `${run}/dome-alice-files.png` });
// Bob's copy: his Peer-Light fetches the chunks from the Aven Peer, which kept the file, or from Alice
const bobImage = bob.locator(`[data-testid="file"][data-file="${file}"] img`).last();
if (!(await seen(bobImage)) || !(await until(() => loaded(bobImage)))) {
	problems.push("Bob's chat did not load Alice's image");
	report.bobImage = await bobImage
		.evaluate(async (i) => {
			const r = await fetch(i.src).catch((e) => ({ status: String(e) }));
			return { src: i.src, complete: i.complete, width: i.naturalWidth, status: r.status, type: r.headers?.get('content-type'), controlled: !!navigator.serviceWorker.controller };
		})
		.catch((e) => String(e));
}
report.bobImageMs = Date.now() - sharedAt;
const bobPdf = await bob.evaluate(async (name) => {
	const a = [...document.querySelectorAll('a[download]')].find((a) => a.getAttribute('download') === name);
	if (!a) return null;
	const r = await fetch(a.getAttribute('href'));
	return { status: r.status, type: r.headers.get('content-type'), start: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 8)) };
}, `page-${stamp}.pdf`);
report.bobPdf = bobPdf;
if (bobPdf?.status !== 200 || bobPdf.type !== 'application/pdf' || bobPdf.start !== '%PDF-1.1') problems.push(`Bob's PDF is ${JSON.stringify(bobPdf)}`);
await bob.screenshot({ path: `${run}/dome-bob-files.png` });
// last, a third browser on Bob's origin, its OPFS empty, joins later and catches up from the Aven Peer. It has Bob's
// cast key, so Bob's own browser closes first: two Peer-Lights with one key would take the relay from each other
const whole = await texts(alice);
await profiles.bob.close();
const late = await open('bob', 'late');
const lateAt = Date.now();
// it writes at once, before it can know its own head: the line waits, then continues Bob's chain. Never a fork
// (Aven.DB.Chains.learned_never_forks)
const fresh = `from a fresh profile, ${stamp}`;
await say(late, fresh);
if (!(await seen(alice.getByTestId('lines').locator('li', { hasText: fresh }), 30_000))) problems.push("the fresh profile's line did not reach Alice");
if (lines().some((l) => l.t >= lateAt && l.event === 'fork' && l.key === bobDevice)) problems.push('the fresh profile forked its own chain');
whole.splice(0, whole.length, ...(await texts(alice)));
const caughtUp = async () => (await texts(late)).join('\n') === whole.join('\n');
for (let i = 0; i < 80 && !(await caughtUp()); i++) await wait(250);
report.lateJoinerMs = Date.now() - lateAt;
if (!(await caughtUp())) problems.push(`a late joiner holds ${(await texts(late)).length} of ${whole.length} lines, or not in order`);
await late.screenshot({ path: `${run}/dome-late-joiner.png` });
await late.close();

await browser.close();

report.ok = problems.length === 0;
report.problems = problems;
report.ms = Date.now() - started;
writeFileSync(`${run}/dome.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: dome: ${problem}`);
console.log(`avenSANDBOX: dome: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s)`);
process.exit(problems.length ? 1 : 0);
