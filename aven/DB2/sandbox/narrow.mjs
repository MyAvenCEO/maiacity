// avenOS on a phone's width (Samuel's iPhone, 30 Oct 2026: the chat's own bubbles and its Send button were cut off at
// the right edge). On Alice's Peer-Light in the cast's box, in any engine: Alice writes a long unbroken word, shares a
// file with a long name, a wide image and a movie, and the presence row gets many chips; then at 375×667 and 390×844
// the page scrolls no wider than the screen, and every bubble's right edge and the Send button lie inside it, Send
// at least 44 px to touch. Alice deletes a line at that width: the confirmation lies inside the screen, its buttons 44
// px to touch, and the line shows deleted in place. The dashboard, the Vault and the Control Room are held to the same
// width. Only layout is checked here, so the extra chips are copies of the page's own.
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

// What lies outside the viewport on `page`, as problems prefixed with `what`
async function outside(page, what, { chat }) {
	return page.evaluate(
		({ what, chat }) => {
			const problems = [];
			const width = innerWidth;
			const scroll = document.documentElement.scrollWidth;
			if (scroll > width) problems.push(`${what}: the page scrolls ${scroll} px wide on a ${width} px screen`);
			if (!chat) return problems;
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

// Fills Alice's chat on `page` (alice.localhost, live) and checks it and the other views at each phone's size
export async function narrow(page, engine, shots) {
	const problems = [];
	const stamp = Date.now();
	const chat = 'http://alice.localhost:5173/#/alice/chat';
	await page.setViewportSize(phones[0]);
	await page.goto(chat);
	await page.getByTestId('line').waitFor({ timeout: 30_000 });
	const word = `unbroken${'x'.repeat(160)}-${stamp}`;
	await page.getByTestId('line').fill(word);
	await page.getByTestId('say').click();
	const long = `a-very-long-file-name-that-never-breaks-${'n'.repeat(80)}-${stamp}.txt`;
	await page.getByTestId('file-input').setInputFiles([
		{ name: long, mimeType: 'text/plain', buffer: Buffer.from(`narrow ${stamp}\n`) },
		{ name: `wide-${stamp}.png`, mimeType: 'image/png', buffer: png(1600, 40) },
		{ name: `movie-${stamp}.mp4`, mimeType: 'video/mp4', buffer: Buffer.from(`not really a movie ${stamp}`) },
	]);
	const shown = (locator) => locator.first().waitFor({ timeout: 20_000 }).then(() => true, () => false);
	if (!(await shown(page.getByTestId('lines').getByText(word)))) problems.push(`${engine}: the long word never showed`);
	for (const name of [long, `wide-${stamp}.png`, `movie-${stamp}.mp4`])
		if (!(await shown(page.locator(`[data-testid="file"] a[download="${name}"]`)))) problems.push(`${engine}: ${name} never showed`);
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
		await page.screenshot({ path: `${shots}/${engine}-narrow-chat-${phone.width}.png` });
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
	return problems;
}
