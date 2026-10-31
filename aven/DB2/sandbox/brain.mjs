// Brain, avenOS's documentation (aven/DB2/brain, os/web/brain), in all three of Playwright's engines, in the browsers' container (`bun
// run up --check`). Read on production's stand-in (localhost:5174) by a browser that never signed in, as anyone reads
// them, and on the box's own view (localhost:5173). Checked, at a desktop's 1280 px and a phone's 390 px:
//   1. the dashboard has an item per package, avenID's open and the rest coming; the main nav reaches it;
//   2. avenID's page draws each slide as 16:9, through the face-runtime's drawer into a shadow root of its own, with no
//      slide style left in the page's own sheets; the glossary draws, and #/brain/glossary/vault marks that term;
//   3. no page scrolls sideways;
//   4. every text has 4.5:1 against the background under it (3:1 when large), as WCAG has it, and no text on a slide is
//      under 9 px at a phone's width (brain/STYLE.md, "A slide");
//   5. a screenshot of each, in the run's folder.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { linear } from '../brain/render/contrast.js';

// Brain's dashboard shows one tile per entry of its list
const { packages } = JSON.parse(readFileSync(new URL('../brain/packages.json', import.meta.url), 'utf8'));

const run = process.argv[2] ?? 'runs/latest';
mkdirSync(run, { recursive: true });
const problems = [];
const report = {};
const widths = { desktop: 1280, phone: 390 };
const pages = { dashboard: 'brain', id: 'brain/id', glossary: 'brain/glossary/vault' };

// every element's own text, its colour and the first opaque background behind it, as the page lays it out; the
// ratio is Face.lean's, in integers over its linear table (brain/render/contrast.js, held to the spec's vectors)
function contrasts(table) {
	const parse = (c) => {
		const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
		return { rgb: m.slice(0, 3), a: m[3] ?? 1 };
	};
	const lum = ([r, g, b]) => 2126 * table[Math.round(r)] + 7152 * table[Math.round(g)] + 722 * table[Math.round(b)];
	const flare = 5_000_000_000;
	// a slide is drawn in a shadow root: look in every one, and behind one to its host
	const deep = (root) => [...root.querySelectorAll('*')].flatMap((el) => (el.shadowRoot ? [el, ...deep(el.shadowRoot)] : [el]));
	const behind = (el) => {
		for (let at = el; at; at = at.parentElement ?? at.getRootNode().host) {
			const bg = parse(getComputedStyle(at).backgroundColor);
			if (bg.a > 0.5) return bg.rgb;
		}
		return [255, 255, 255];
	};
	const out = [];
	for (const el of deep(document).filter((e) => e.closest('.brain') || e.getRootNode().host?.closest('.brain'))) {
		const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		const box = el.getBoundingClientRect();
		if (!own || !box.width || getComputedStyle(el).visibility === 'hidden') continue;
		const style = getComputedStyle(el);
		const fg = lum(parse(style.color).rgb);
		const bg = lum(behind(el));
		const [hi, lo] = [Math.max(fg, bg) + flare, Math.min(fg, bg) + flare];
		const size = parseFloat(style.fontSize);
		const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
		const ok = large ? hi >= 3 * lo : 2 * hi >= 9 * lo;
		out.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round((hi / lo) * 100) / 100, need: large ? 3 : 4.5, ok });
	}
	return out;
}

async function read(engine) {
	const name = engine.name();
	const browser = await engine.launch();
	const got = (report[name] = {});
	try {
		for (const [size, width] of Object.entries(widths)) {
			const context = await browser.newContext({ viewport: { width, height: 900 } });
			const page = await context.newPage();
			const errors = [];
			page.on('pageerror', (e) => errors.push(e.message));
			for (const [where, origin] of [
				['visitor', 'http://localhost:5174'],
				['box', 'http://localhost:5173'],
			]) {
				for (const [view, route] of Object.entries(pages)) {
					// the box's own view is reached through the main nav, a visitor's by its address
					if (where === 'box' && view !== 'dashboard') continue;
					const say = (p) => problems.push(`${name}, ${size}, ${where}, ${view}: ${p}`);
					if (where === 'box') {
						await page.goto(`${origin}/`);
						await page.getByTestId('nav-brain').first().click({ timeout: 30_000 });
					} else await page.goto(`${origin}/#/${route}`);
					const ready = { dashboard: '[data-testid="brain-id"]', id: '[data-testid="slide-owns"] .slide', glossary: '#term-vault.here' }[view];
					if (!(await page.locator(ready).first().waitFor({ timeout: 30_000 }).then(() => true, () => false))) {
						say(`${ready} never showed`);
						continue;
					}
					// each slide is drawn once face-runtime has run its part, in the runtimes worker: wait for every one, drawn or
					// refused (os/web/brain/brain.js, `face`)
					if (view === 'id') {
						const settled = () => [...document.querySelectorAll('.face')].every((h) => h.shadowRoot?.querySelector('.slide') || h.dataset.refused);
						await page.waitForFunction(settled, null, { timeout: 30_000 }).catch(() => {});
						const refused = await page.evaluate(() => [...document.querySelectorAll('.face')].map((h) => h.dataset.refused).filter(Boolean));
						for (const why of refused) say(`face-runtime refused a slide: ${why}`);
					}
					await page.evaluate(() => document.fonts.ready);
					const seen = {};
					if (view === 'dashboard') {
						seen.items = await page.locator('[data-testid^="brain-"]').count();
						seen.open = await page.locator('[data-testid^="brain-"] a').count();
						if (seen.items !== packages.length) say(`${seen.items} items, not ${packages.length}`);
						if (!(await page.locator('[data-testid="brain-id"] a').count())) say('avenID is not open');
					}
					if (view === 'id') {
						const box = await page.locator('.slide').first().boundingBox();
						seen.ratio = Math.round((box.width / box.height) * 1000) / 1000;
						if (Math.abs(seen.ratio - 16 / 9) > 0.02) say(`the slide is ${seen.ratio}:1, not 16:9`);
						// every text on every slide, as the reader sees it
						// each slide is a face, drawn into its own shadow root; none is left in the page itself
						seen.faces = await page.evaluate(() => [...document.querySelectorAll('.face')].filter((h) => h.shadowRoot?.querySelector('.slide')).length);
						if (seen.faces !== 9) say(`${seen.faces} slides drawn in shadow roots, not 9`);
						if (await page.evaluate(() => !!document.querySelector('.slide'))) say('a slide is drawn in the page, outside a shadow root');
						const leaked = await page.evaluate(() =>
							[...document.styleSheets].flatMap((sheet) => {
								try {
									return [...sheet.cssRules].map((r) => r.selectorText ?? '');
								} catch {
									return [];
								}
							}).filter((t) => /\.slide(?![\w-])/.test(t)),
						);
						if (leaked.length) say(`the page's own sheets style slides: ${leaked[0]}`);
						const small = await page.evaluate(() =>
							[...document.querySelectorAll('.face')].flatMap((h) => [...h.shadowRoot.querySelectorAll('.slide *')])
								.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
								.map((el) => ({ text: el.textContent.trim().slice(0, 30), px: parseFloat(getComputedStyle(el).fontSize) }))
								.filter((t) => t.px < 9),
						);
						seen.smallest = small;
						if (size === 'phone') for (const t of small) say(`"${t.text}" on a slide is ${t.px.toFixed(1)} px, under 9 px`);
					}
					seen.scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
					if (seen.scrollWidth > width) say(`the page is ${seen.scrollWidth} px wide at ${width} px: it scrolls sideways`);
					const low = (await page.evaluate(contrasts, linear)).filter((c) => !c.ok);
					seen.lowContrast = low;
					for (const c of low) say(`"${c.text}" has ${c.ratio}:1, under ${c.need}:1`);
					await page.screenshot({ path: `${run}/brain-${view}-${where}-${size}-${name}.png`, fullPage: view !== 'glossary' });
					got[`${where}-${view}-${size}`] = seen;
				}
			}
			for (const e of errors) problems.push(`${name}, ${size}: a page error: ${e}`);
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

for (const engine of [chromium, webkit, firefox]) {
	try {
		await read(engine);
	} catch (error) {
		problems.push(`${engine.name()}: ${error.message}`);
	}
}
writeFileSync(`${run}/brain.json`, `${JSON.stringify({ ok: problems.length === 0, problems, report }, null, 2)}\n`);
for (const p of problems) console.log(`brain: ${p}`);
console.log(problems.length ? 'the brain step FAILED' : 'Brain reads in Chromium, WebKit and Firefox, at 1280 and 390 px, with 4.5:1 text');
process.exit(problems.length ? 1 : 0);
