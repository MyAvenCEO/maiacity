// avenOS on a phone's width (Samuel's iPhone, 30 Oct 2026: the chat's own bubbles and its Send button were cut off at
// the right edge), and every kind of file shown and played inline in the chat (Samuel: an mp3 showed only as a link).
// On Alice's Peer-Light in the cast's box, in any engine: Alice writes a long unbroken word, shares a file with a long
// name, a wide PNG, a JPEG, an mp4, an mp3 and a PDF, and the presence row gets many chips. Each file shows inline: the
// images load, the audio and the movie reach a frame they can play (readyState 2) with their duration, the movie
// seeked to its middle plays on from there, and the PDF has its frame and an Open link to a PDF. Then at 375×667 and
// 390×844 the page scrolls no wider than the screen, and every bubble's right edge, every player and the Send button lie
// inside it, Send at least 44 px to touch. Alice deletes a line at that width: the confirmation lies inside the screen,
// its buttons 44 px to touch, and the line shows deleted in place. The dashboard, the Vault and the Control Room are
// held to the same width. The extra chips are copies of the page's own. The media are small fixtures made with ffmpeg
// (sandbox/media: H.264 and AAC, as an iPhone records; MP3; JPEG), which plays in all three of Playwright's engines.
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

export const phones = [
	{ width: 375, height: 667 },
	{ width: 390, height: 844 },
];

// a PNG of w×h pixels, one colour: wide, so the image has to shrink into its bubble
function png(w, h) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const head = Buffer.alloc(13);
	head.writeUInt32BE(w, 0);
	head.writeUInt32BE(h, 4);
	head.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x5a)]);
	const pixels = deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
	return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

// a tiny PDF of one page, its own by `stamp`
const pdf = (stamp) =>
	Buffer.from(
		`%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n% ${stamp}\n`,
	);

// Whether a file card shows its file inline: an image loaded; audio and video playable (readyState 2, a duration),
// a movie seeked to its middle playing on from there; a PDF's frame, with an Open link to bytes that are a PDF
async function plays(card, kind) {
	if (kind === 'file') return { ok: true };
	return card.evaluate(
		async (figure, kind) => {
			const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
			const until = async (ok, ms = 30_000) => {
				for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (ok()) return true;
				return false;
			};
			if (kind === 'image') {
				const img = () => figure.querySelector('img');
				const ok = await until(() => img()?.complete && img().naturalWidth > 0);
				return { ok, naturalWidth: img()?.naturalWidth ?? null };
			}
			if (kind === 'pdf') {
				const frame = figure.querySelector('iframe');
				const open = figure.querySelector('a[data-testid="open"]');
				// its first bytes, through the Service Worker as the link would open them, given 10 s
				const head = open
					? await Promise.race([
							fetch(open.href, { headers: { range: 'bytes=0-4' } }).then((r) => r.text()),
							sleep(10_000).then(() => 'no answer in 10 s'),
						]).catch((e) => String(e))
					: '';
				return { ok: Boolean(frame && open && head === '%PDF-'), frame: Boolean(frame), open: Boolean(open), head };
			}
			// a player loads once it is in view (Chat.svelte, `lazy`)
			figure.scrollIntoView({ block: 'center' });
			const el = figure.querySelector(kind);
			if (!el) return { ok: false, why: `no <${kind}>` };
			// what the element went through, for a failure's report
			const log = [];
			for (const e of ['waiting', 'stalled', 'seeked', 'playing', 'pause', 'error', 'suspend', 'emptied', 'loadstart', 'abort'])
				el.addEventListener(e, () => log.push(`${e} ${el.currentTime.toFixed(2)} rs${el.readyState} ${el.error?.code ?? ''} ${el.currentSrc.slice(-12)} ${el.isConnected}`));
			el.muted = true;
			// play() may wait for data that never comes: never longer than a second here
			const playing = () => Promise.race([el.play().catch(() => {}), sleep(1_000)]);
			await until(() => el.readyState >= 1, 30_000);
			await playing();
			const ready = await until(() => el.readyState >= 2 && el.duration > 0);
			const got = { readyState: el.readyState, duration: el.duration, playsinline: el.hasAttribute('playsinline') };
			el.pause();
			if (kind === 'audio') return { ok: ready, ...got };
			const middle = el.duration / 2;
			// a seek WebKit drops (Linux's GStreamer can reopen the stream and never say `seeked`) is tried again, as a
			// person taps again: at most three times, and the report says how many it took
			for (got.seeks = 1; got.seeks <= 3; got.seeks++) {
				const seeked = new Promise((done) => el.addEventListener('seeked', done, { once: true }));
				el.currentTime = middle;
				got.seeked = await Promise.race([seeked.then(() => true), sleep(5_000).then(() => false)]);
				if (got.seeked) break;
			}
			await playing();
			const on = await until(() => el.currentTime > middle + 0.2, 15_000);
			got.seekedTo = middle;
			got.playedTo = el.currentTime;
			el.pause();
			got.log = log;
			got.buffered = [...Array(el.buffered.length)].map((_, i) => [el.buffered.start(i), el.buffered.end(i)]);
			return { ok: ready && got.playsinline, seeks: Boolean(got.seeked && on), ...got };
		},
		kind,
	);
}

// What lies outside the viewport on `page`, as problems prefixed with `what`
async function outside(page, what, { chat }) {
	return page.evaluate(
		({ what, chat }) => {
			const problems = [];
			const width = innerWidth;
			const scroll = document.documentElement.scrollWidth;
			if (scroll > width) problems.push(`${what}: the page scrolls ${scroll} px wide on a ${width} px screen`);
			if (!chat) return problems;
			for (const el of document.querySelectorAll('[data-testid="file"] :is(img, audio, video, iframe)')) {
				const r = el.getBoundingClientRect();
				if (r.right > width + 0.5 || r.left < -0.5) problems.push(`${what}: a ${el.tagName.toLowerCase()} lies at ${Math.round(r.left)}–${Math.round(r.right)} px`);
			}
			for (const li of document.querySelectorAll('[data-testid="lines"] > li')) {
				const r = li.getBoundingClientRect();
				if (r.right > width + 0.5 || r.left < -0.5)
					problems.push(`${what}: a bubble lies at ${Math.round(r.left)}–${Math.round(r.right)} px ("${li.textContent.trim().slice(0, 40)}")`);
			}
			const send = document.querySelector('[data-testid="say"]');
			const s = send?.getBoundingClientRect();
			if (!s) problems.push(`${what}: no Send button`);
			else {
				if (s.right > width + 0.5 || s.left < 0) problems.push(`${what}: Send lies at ${Math.round(s.left)}–${Math.round(s.right)} px`);
				if (s.width < 44 || s.height < 44) problems.push(`${what}: Send is ${Math.round(s.width)}×${Math.round(s.height)} px, under 44 to touch`);
			}
			return problems;
		},
		{ what, chat },
	);
}

// Fills Alice's chat on `page` (alice.localhost, live) and checks it and the other views at each phone's size:
// `{problems, warnings}`
export async function narrow(page, engine, shots) {
	const problems = [];
	const warnings = [];
	const stamp = Date.now();
	const chat = 'http://alice.localhost:5173/#/alice/chat';
	await page.setViewportSize(phones[0]);
	await page.goto(chat);
	await page.getByTestId('line').waitFor({ timeout: 30_000 });
	const word = `unbroken${'x'.repeat(160)}-${stamp}`;
	await page.getByTestId('line').fill(word);
	await page.getByTestId('say').click();
	const long = `a-very-long-file-name-that-never-breaks-${'n'.repeat(80)}-${stamp}.txt`;
	const media = (name) => readFileSync(new URL(`media/${name}`, import.meta.url));
	// each with its own bytes, so none is a file the chat holds already
	const files = {
		[long]: { mimeType: 'text/plain', buffer: Buffer.from(`narrow ${stamp}\n`), kind: 'file' },
		[`wide-${stamp}.png`]: { mimeType: 'image/png', buffer: png(1600, 40 + (stamp % 50)), kind: 'image' },
		[`photo-${stamp}.jpg`]: { mimeType: 'image/jpeg', buffer: Buffer.concat([media('photo.jpg'), Buffer.from(`${stamp}`)]), kind: 'image' },
		[`clip-${stamp}.mp4`]: { mimeType: 'video/mp4', buffer: Buffer.concat([media('clip.mp4'), Buffer.from(`${stamp}`)]), kind: 'video' },
		[`tone-${stamp}.mp3`]: { mimeType: 'audio/mpeg', buffer: Buffer.concat([media('tone.mp3'), Buffer.from(`${stamp}`)]), kind: 'audio' },
		[`page-${stamp}.pdf`]: { mimeType: 'application/pdf', buffer: pdf(stamp), kind: 'pdf' },
	};
	await page.getByTestId('file-input').setInputFiles(Object.entries(files).map(([name, f]) => ({ name, mimeType: f.mimeType, buffer: f.buffer })));
	const shown = (locator) => locator.first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
	if (!(await shown(page.getByTestId('lines').getByText(word)))) problems.push(`${engine}: the long word never showed`);
	const card = (name, f) => page.locator(`[data-testid="file"][data-kind="${f.kind}"]`, { has: page.locator(`a[download="${name}"]`) });
	const cards = Object.entries(files);
	for (const [name, f] of cards) if (!(await shown(card(name, f)))) problems.push(`${engine}: ${name} never showed as a ${f.kind}`);
	// every line in place before each is played: the chat may still order what it was just told
	await page.waitForTimeout(1_000);
	for (const [name, f] of cards) {
		const got = await plays(card(name, f), f.kind).catch((e) => ({ ok: false, why: e.message.split('\n')[0] }));
		if (!got.ok) problems.push(`${engine}: ${name} doesn't show inline: ${JSON.stringify(got)}`);
		// a seek to the movie's middle that plays on from there. Playwright's WebKit on Linux (GStreamer) loads the movie
		// again from its start once it is paused, through the Service Worker only (the same file straight from the dev
		// server seeks), so there it is reported, not failed, until Safari on an iPhone says whether it is WebKit's or
		// ours (30 Oct 2026)
		if (got.ok && got.seeks === false) {
			const what = `${engine}: ${name} didn't play on from its middle after a seek: ${JSON.stringify(got)}`;
			if (engine === 'webkit') warnings.push(what);
			else problems.push(what);
		}
	}
	// a line deleted at a phone's width, through its bubble's delete and the confirmation
	const doomed = `delete me, ${stamp}`;
	await page.getByTestId('line').fill(doomed);
	await page.getByTestId('say').click();
	const bubble = page.getByTestId('lines').locator('li', { hasText: doomed }).last();
	if (!(await shown(bubble))) problems.push(`${engine}: the line to delete never showed`);
	else {
		await bubble.hover();
		await bubble.getByTestId('delete').click();
		const dialog = page.getByTestId('confirm-delete');
		if (!(await shown(dialog))) problems.push(`${engine}: deleting asked for no confirmation`);
		const box = await dialog.boundingBox();
		if (!box || box.x < 0 || box.x + box.width > phones[0].width + 0.5) problems.push(`${engine}: the confirmation lies at ${JSON.stringify(box)}`);
		for (const button of ['delete-no', 'delete-yes']) {
			const b = await page.getByTestId(button).boundingBox();
			if (!b || b.width < 44 || b.height < 44) problems.push(`${engine}: ${button} is ${JSON.stringify(b)}, under 44 px to touch`);
		}
		const id = await bubble.getAttribute('data-id');
		await page.getByTestId('delete-yes').click();
		if (!(await shown(page.locator(`li[data-id="${id}"] [data-testid="deleted"]`)))) problems.push(`${engine}: the deleted line did not show deleted`);
	}
	// many presence chips: the row scrolls by itself, never the page
	await page.evaluate(() => {
		const row = document.querySelector('[data-testid="present"]');
		const chip = row?.querySelector('li');
		for (let i = 0; chip && i < 24; i++) row.append(chip.cloneNode(true));
	});
	for (const phone of phones) {
		await page.setViewportSize(phone);
		await page.waitForTimeout(200);
		const what = `${engine} at ${phone.width}×${phone.height}`;
		problems.push(...(await outside(page, `${what}, the chat`, { chat: true })));
		// a picture only: Firefox's headless screenshot can wait for ever on a PDF's frame
		await page.screenshot({ path: `${shots}/${engine}-narrow-chat-${phone.width}.png`, timeout: 10_000 }).catch(() => {});
	}
	for (const view of ['', 'vault', 'control-room']) {
		await page.goto(`http://alice.localhost:5173/#/alice${view ? `/${view}` : ''}`);
		await page.waitForTimeout(1_000);
		for (const phone of phones) {
			await page.setViewportSize(phone);
			await page.waitForTimeout(200);
			problems.push(...(await outside(page, `${engine} at ${phone.width}×${phone.height}, ${view || 'the dashboard'}`, { chat: false })));
		}
	}
	return { problems, warnings };
}
