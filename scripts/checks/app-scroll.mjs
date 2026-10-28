/*
 * The one page container's check (Goal 7 task 16, Samuel 2026-10-28: "the outer container never scrolls; only inner
 * content sets its own scrolling"): a headless Chromium opens every /app route, on a phone and on a desktop, and finds
 * the document one screen high, never scrolled however far it is asked to, the page inside the app's container
 * (src/routes/app/+layout.svelte `.app`) and that container one screen high, with no room of the page's own above the
 * head's, also once the page is made far taller than the screen. Every route of src/routes/app/ is opened, but a page of its own layout (`+page@.svelte`). The person goes on
 * without avenDB in this tab, as the gate offers (src/lib/app/entry.js `later`): nothing is signed in, no peer is
 * reached, and every /api/ call is answered 401 here.
 *
 *   bun scripts/checks/app-scroll.mjs [--out dir]      starts the dev server on a free port, stops it after
 *   BASE=http://localhost:5173 bun scripts/checks/app-scroll.mjs                     against a running one
 *
 * --out keeps a screenshot of each route and size there. Exit 1 when any route scrolls its document.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : '');
const out = arg('--out') && resolve(arg('--out'));
if (out) mkdirSync(out, { recursive: true });
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

/** Every /app route: a folder of src/routes/app/ with a `+page.svelte` (a page of its own layout, `+page@…`, aside). */
export function routes(dir = join(root, 'src/routes/app')) {
	const found = [];
	const walk = (d) => {
		const names = readdirSync(d, { withFileTypes: true });
		if (names.some((n) => n.name === '+page.svelte')) found.push(`/app/${relative(join(root, 'src/routes/app'), d)}`.replace(/\/?$/, '/'));
		for (const n of names) if (n.isDirectory() && !n.name.startsWith('[')) walk(join(d, n.name));
	};
	walk(dir);
	return found.sort();
}

const free = () => new Promise((yes) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => yes(port)); }); });

async function site() {
	if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop: () => {} };
	const port = await free();
	const vite = spawn('bunx', ['vite', 'dev', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
	let said = '';
	vite.stdout.on('data', (b) => (said += b));
	vite.stderr.on('data', (b) => (said += b));
	const base = `http://localhost:${port}`;
	for (let i = 0; i < 240; i++) {
		if (vite.exitCode !== null) throw new Error(`the dev server stopped:\n${said}`);
		if (await fetch(`${base}/app/`).then((r) => r.ok, () => false)) return { base, stop: () => vite.kill() };
		await new Promise((r) => setTimeout(r, 500));
	}
	vite.kill();
	throw new Error(`the dev server did not answer in 2 min:\n${said}`);
}

/** What the page shows of its scrolling: the document's, after it was asked to scroll to its foot, and the container's. */
const measure = () => {
	scrollTo(0, 1e6);
	const doc = document.scrollingElement;
	const app = document.querySelector('.app')?.getBoundingClientRect();
	const head = document.querySelector('.screen-chrome')?.getBoundingClientRect();
	const page = document.querySelector('.app > .page');
	const first = page?.querySelector('main, section, div')?.getBoundingClientRect();
	// a page far taller than the screen, as a long list makes one: the container's page scrolls it, the document not
	let tall = null;
	if (page) {
		const filler = Object.assign(document.createElement('div'), { style: 'height: 300vh' });
		page.append(filler);
		scrollTo(0, 1e6);
		tall = { scrolled: Math.round(scrollY), over: doc.scrollHeight - innerHeight, page: page.scrollHeight > page.clientHeight };
		filler.remove();
	}
	return {
		scrolled: Math.round(scrollY),
		over: doc.scrollHeight - innerHeight,
		app: app ? { top: Math.round(app.top), height: Math.round(app.height) } : null,
		gate: !!document.querySelector('.gate'),
		// how far below the head the page's first box starts, its own top room
		room: first && head ? Math.round(first.top - head.bottom) : null,
		tall,
		height: innerHeight
	};
};

if (import.meta.main) {
	const chrome = process.env.CHROME ?? ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));
	const { base, stop } = await site();
	const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
	let failed = 0;
	try {
		for (const [size, viewport] of Object.entries(SIZES)) {
			const context = await browser.newContext({ viewport });
			await context.addInitScript(() => sessionStorage.setItem('avendb:later', '1'));
			await context.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed out"}' }));
			const page = await context.newPage();
			for (const route of routes()) {
				// the app's container, or a gate with words of its own (not open to this person), past "One moment…"; a dev
				// server that optimised a dependency on first sight reloads the page once, so it is opened again once
				let opened = false;
				for (let i = 0; i < 2 && !opened; i++) {
					await page.goto(base + route, { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
					opened = await page.waitForSelector('.app, .gate h1', { timeout: 60_000 }).then(() => true, () => false);
				}
				await page.waitForTimeout(1500);
				const m = opened ? await page.evaluate(measure).catch((e) => ({ error: String(e) })) : { error: "neither the app's container nor its gate opened" };
				const bad = m.error ? m.error
					: m.scrolled > 0 || m.over > 0 ? `the document scrolls ${Math.max(m.scrolled, m.over)} px`
					: m.app && (m.app.top !== 0 || m.app.height !== m.height) ? `the container is ${m.app.height} px high at ${m.app.top}, not the screen`
					: m.tall && (m.tall.scrolled > 0 || m.tall.over > 0) ? `a tall page scrolls the document ${Math.max(m.tall.scrolled, m.tall.over)} px`
					: m.tall && !m.tall.page ? 'a tall page does not scroll inside the container'
					: m.room !== null && m.room > 40 ? `the page keeps ${m.room} px of its own below the head`
					: '';
				if (bad) failed++;
				console.log(`${bad ? '✕' : '✓'} ${size.padEnd(7)} ${route}${m.gate && !bad ? ' (behind its gate)' : ''}${bad ? `: ${bad}` : ''}`);
				if (out) await page.screenshot({ path: join(out, `${size}${route.replace(/\//g, '_')}.png`) });
			}
			await context.close();
		}
	} finally {
		await browser.close();
		stop();
	}
	console.log(failed ? `\n${failed} route views scroll their document` : '\nno /app route scrolls its document');
	process.exit(failed ? 1 : 0);
}
