// A phone's video in the city-dome, from one browser to another (Samuel, 30 Oct 2026: a video shared in the chat
// didn't play at all, and nothing said why or how far along it was). In the cast's box, in production's shape: the Aven
// Peer on its S3 store, both Peer-Lights through its relay. Alice shares sandbox/media/phone.mp4 (H.264 and AAC with
// its index at the end, as an iPhone writes it: three chunks) from Chromium; Bob plays it in Chromium, WebKit and
// Firefox, a fresh browser each:
//
// - Alice's card says "Kept by the network" once the Aven Peer has kept it whole (its `kept` frame), and her own
//   player plays it;
// - Bob's player shows its first frame, and seeked to the middle plays on from there. Bob reads it through his Service
//   Worker, whose answers carry the file's true length from the first, and stream: they used to gather a whole movie
//   before answering, and to guess its length until its last chunk was there;
// - a player loads once its bubble is in view, a few at a time: of six movies above the newest, a fresh viewer asks
//   for no more than the few on its screen before it scrolls;
// - a press on a player still waiting for its turn loads it at once, and it plays;
// - only Alice's links are told her movie is kept (`kept`): Bob's Peer-Light never hears it;
// - a movie this browser can't play (bytes no player decodes, as an HEVC movie is in a browser without the codec)
//   says so with its download link, never a dead player.
//
// Playwright's WebKit on Linux (GStreamer) can drop a seek through a Service Worker (narrow.mjs): there a seek that
// doesn't play on is reported, not failed.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { lines } from './records.mjs';

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const problems = [];
const warnings = [];
const report = { engines: {} };
const started = Date.now();
const stamp = started.toString(36);
const phone = { width: 390, height: 844 };

async function open(engine, who) {
	const dir = `/tmp/avensandbox-video-${who}-${engine.name()}`;
	rmSync(dir, { recursive: true, force: true });
	const context = await engine.launchPersistentContext(dir, { viewport: phone });
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(`http://${who}.localhost:5173/#/${who}/chat`);
	await page.getByTestId('line').waitFor({ timeout: 30_000 });
	return { context, page };
}
const card = (page, name) => page.locator('[data-testid="file"]', { has: page.locator(`a[download="${name}"]`) });
const shown = (locator, timeout = 30_000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

// the player on `page`'s card of `name`: its first frame, then a seek to its middle that plays on
async function plays(page, name) {
	return card(page, name)
		.locator('video')
		.evaluate(async (el) => {
			// a player loads once it is in view (Chat.svelte, `lazy`)
			el.scrollIntoView({ block: 'center' });
			const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
			const until = async (ok, ms) => {
				for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (ok()) return true;
				return false;
			};
			const t = performance.now();
			el.muted = true;
			el.play().catch(() => {});
			const first = await until(() => el.readyState >= 2 && el.duration > 0, 60_000);
			const got = { first, firstMs: Math.round(performance.now() - t), duration: el.duration };
			if (!first) return got;
			el.pause();
			const middle = el.duration / 2;
			for (got.seeks = 1; got.seeks <= 3; got.seeks++) {
				const seeked = new Promise((done) => el.addEventListener('seeked', done, { once: true }));
				el.currentTime = middle;
				got.seeked = await Promise.race([seeked.then(() => true), sleep(10_000).then(() => false)]);
				if (got.seeked) break;
			}
			el.play().catch(() => {});
			got.on = await until(() => el.currentTime > middle + 0.3, 20_000);
			got.playedTo = el.currentTime;
			el.pause();
			return got;
		});
}

const alice = await open(chromium, 'alice');
const movie = `phone-${stamp}.mp4`;
const broken = `broken-${stamp}.mp4`;
const phoneMp4 = readFileSync(new URL('media/phone.mp4', import.meta.url));
// six movies above the newest, each its own file
const crowd = Array.from({ length: 6 }, (_, i) => ({ name: `crowd-${i}-${stamp}.mp4`, mimeType: 'video/mp4', buffer: Buffer.concat([phoneMp4, Buffer.from(`${stamp}-${i}`)]) }));
await alice.page.getByTestId('file-input').setInputFiles(crowd);
for (const c of crowd) if (!(await shown(card(alice.page, c.name)))) problems.push(`Alice's ${c.name} never showed`);
await alice.page.getByTestId('file-input').setInputFiles([
	// its own bytes, so it is a file the network doesn't hold yet: a player ignores what follows a movie's index
	{ name: movie, mimeType: 'video/mp4', buffer: Buffer.concat([phoneMp4, Buffer.from(stamp)]) },
	{ name: broken, mimeType: 'video/mp4', buffer: Buffer.from(`no player decodes this ${stamp} `.repeat(2000)) },
]);
if (!(await shown(card(alice.page, movie)))) problems.push("Alice's movie never showed in her chat");
report.movieFile = await card(alice.page, movie).getAttribute('data-file').catch(() => null);
// "Kept by the network" only once the Aven Peer says it holds the file whole (its `kept` frame)
report.sender = (await shown(card(alice.page, movie).getByTestId('file-kept'), 60_000)) ? 'kept' : 'not kept';
if (report.sender !== 'kept') problems.push("Alice's card never said the network keeps her movie");
// her own player plays it too, from her own store
report.alice = await plays(alice.page, movie).catch((e) => ({ first: false, why: e.message.split('\n')[0] }));
if (!report.alice.first) problems.push(`Alice's own player never showed her movie: ${JSON.stringify(report.alice)}`);
await alice.page.screenshot({ path: `${run}/video-alice.png` }).catch(() => {});

for (const engine of [chromium, webkit, firefox]) {
	const name = engine.name();
	const bob = await open(engine, 'bob');
	const asked = new Set();
	bob.context.on('request', (r) => {
		const file = /\/files\/([0-9a-f]{64})/.exec(r.url())?.[1];
		if (file) asked.add(file);
	});
	const got = (report.engines[name] = {});
	got.shown = await shown(card(bob.page, movie), 60_000);
	// before any scroll: only the players in view loaded, a few at a time
	await bob.page.waitForTimeout(3_000);
	const crowdFiles = await Promise.all(crowd.map((c) => card(bob.page, c.name).getAttribute('data-file').catch(() => null)));
	got.crowdAsked = crowdFiles.filter((f) => f && asked.has(f)).length;
	if (got.crowdAsked > 3) problems.push(`${name}: a fresh viewer asked for ${got.crowdAsked} of the six movies above the newest before scrolling`);
	// a press on a player nobody has loaded yet: it loads at once and plays
	const waiting = crowd.findIndex((c, i) => crowdFiles[i] && !asked.has(crowdFiles[i]));
	if (waiting >= 0) {
		const player = card(bob.page, crowd[waiting].name).locator('video');
		await player.evaluate((el) => (el.muted = true));
		const pressed = Date.now();
		// its Play button, there until the player has its src
		got.click = await card(bob.page, crowd[waiting].name)
			.getByTestId('tap')
			.click({ timeout: 10_000 })
			.then(() => 'ok', (e) => e.message.split('\n')[0]);
		got.tapped = await player
			.evaluate(async (el) => {
				for (let i = 0; i < 100 && !(el.readyState >= 2 && !el.paused); i++) await new Promise((done) => setTimeout(done, 100));
				return el.readyState >= 2 && !el.paused ? true : { readyState: el.readyState, paused: el.paused, src: Boolean(el.getAttribute('src')) };
			})
			.catch((e) => e.message.split('\n')[0]);
		got.tapMs = Date.now() - pressed;
		if (got.tapped !== true) problems.push(`${name}: a press on a player waiting for its turn didn't load and play it: ${JSON.stringify(got.tapped)}`);
	}
	if (!got.shown) problems.push(`${name}: Alice's movie never reached Bob's chat`);
	else {
		Object.assign(got, await plays(bob.page, movie).catch((e) => ({ first: false, why: e.message.split('\n')[0] })));
		if (!got.first) problems.push(`${name}: Bob's player never showed Alice's movie: ${JSON.stringify(got)}`);
		else if (!got.seeked || !got.on) (name === 'webkit' ? warnings : problems).push(`${name}: a seek to the middle didn't play on: ${JSON.stringify(got)}`);
	}
	got.unplayable = await shown(card(bob.page, broken).getByTestId('unplayable'), 60_000);
	if (!got.unplayable) problems.push(`${name}: a movie this browser can't play doesn't say so`);
	await bob.page.screenshot({ path: `${run}/video-bob-${name}.png` }).catch(() => {});
	await bob.context.close();
}
await alice.context.close();

// Alice's movie kept: told to her links only, never to Bob's
const movieFile = report.movieFile;
const told = lines().filter((l) => l.event === 'kept' && Array.isArray(l.files) && l.files.includes(movieFile));
report.keptTold = [...new Set(told.map((l) => l.peer))];
if (!report.keptTold.includes('alice-peer-light') || report.keptTold.some((peer) => peer !== 'alice-peer-light'))
	problems.push(`the movie's kept was told to ${JSON.stringify(report.keptTold)}, not to Alice's Peer-Light alone`);

report.ok = problems.length === 0;
report.problems = problems;
report.warnings = warnings;
report.ms = Date.now() - started;
writeFileSync(`${run}/video.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const problem of problems) console.log(`avenSANDBOX: video: ${problem}`);
for (const warning of warnings) console.log(`avenSANDBOX: video: warning: ${warning}`);
const firsts = Object.entries(report.engines).map(([n, g]) => `${n} ${((g.firstMs ?? 0) / 1000).toFixed(1)} s`).join(', ');
console.log(`avenSANDBOX: video: ${problems.length ? 'FAILED' : 'ok'} (${(report.ms / 1000).toFixed(1)} s; first frame: ${firsts})`);
process.exit(problems.length ? 1 : 0);
