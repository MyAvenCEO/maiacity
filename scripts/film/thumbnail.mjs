// A film's thumbnail — the hook title over one of its frames — in every shape it is delivered in: 16:9 (YouTube,
// X, LinkedIn), 9:16 (the Reel cover), 1:1 (the feeds) and 5:2 (an X Article's cover, the blog's wide header).
//
//   node scripts/film/thumbnail.mjs blog/day-NN-<slug>/thumbnail.json
//
// Each card and hook layer goes into the vault (described; the Mac app must be running): the cards public, tagged
// "Day NN", "role:thumbnail", "shape:16x9" …; the hook layers "role:hook". A new one takes its place from the one
// before (which is kept, superseded). Their hashes are written back into thumbnail.json ("cards", "hooks"), where the
// article and the day's posts take them from.
//
// The hook layers are the same title, transparent (its shade, no picture, no day): the render worker lays them over
// the first 2.5 s of the moving film in the social copies — the Short's and X's cover is a frame of the film, so the
// title has to be in the film, and a still card at the start would stop it. In 9:16 it sits lower than the card's,
// clear of the Shorts and Reels header.
//
// thumbnail.json: { "frame": "<the background's hash>", "shapes": ["16x9", "1x1"],
//   "title": { "kicker": "The city of", "big": "tomorrow", "line": "that feeds itself", "after": "— it starts with <b>233</b> settlers" } }
// Every day's banner and thumbnails carry its hook like this (the blog's cover, the film's poster, YouTube's
// thumbnail). The hook: the day's title, cut to its promise — subject, action, end state, contrast.
//
// The frame should be large (a 2160 still, rendered 3240 wide), so the wide and the tall crops stay sharp; a shape
// can have its own frame — "frames": { "9x16": "<a taller still's hash>" } — when the main one is too small to crop.
// Set like a YouTube thumbnail: few words, heavy and big enough to read at phone size, the number in gold, a firm
// shade behind them and nothing else across the picture; the day ("DAY 01", as the journal writes it) in the bottom-right corner. The font
// (Fraunces) and the frames are embedded (setContent cannot load files).
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { add, bare, describe, fileOf } from './vault.mjs';

const config = process.argv[2];
if (!config) throw new Error('usage: node scripts/film/thumbnail.mjs blog/day-NN-<slug>/thumbnail.json');
const settings = JSON.parse(readFileSync(config, 'utf8'));
const { frame, frames = {}, title: TITLE, shapes: only, place = {}, width = {}, day: dayNo } = settings;
const dir = mkdtempSync(join(tmpdir(), 'title-cards-'));
// every frame it is set on, by its hash: the vault's bytes, fetched once into the cache
const refs = [frame, ...Object.values(frames), ...(settings.split ? [settings.split.old, settings.split.new] : [])].filter(Boolean);
const local = new Map(await Promise.all(refs.map(async (r) => /** @type {[string, string]} */ ([r, await fileOf(bare(r))]))));
const fromVault = (ref) => /** @type {string} */ (local.get(ref));
const HOOK_TOP = { '9x16': 280 }; // a hook layer's top where it differs from the card's (the Shorts / Reels header)
// the day it is ("DAY 1"): given, or read off the day's folder (blog/day-01-…)
const day = dayNo ?? Number(/day-(\d+)/.exec(config)?.[1] ?? NaN);
// per shape, the title may sit at the bottom (a face at the top of the frame) — "place": { "1x1": "bottom" } — and
// run narrower — "width": { "16x9": "46%" } — so it never crosses the subject
// by shape: the size, the title's scale and room, and the shade behind it (a 16:9 title stands left of the subject,
// a 9:16 or 1:1 one across the top)
const SHAPES = [
	{ tag: '16x9', w: 1920, h: 1080, unit: 1, left: 84, top: 72, width: '46%', shade: 'linear-gradient(100deg, rgba(6,10,8,.86) 0%, rgba(6,10,8,.62) 36%, rgba(6,10,8,0) 60%)' },
	{ tag: '9x16', w: 1080, h: 1920, unit: 1.1, left: 70, top: 160, width: 'auto', shade: 'linear-gradient(to bottom, rgba(6,10,8,.86) 0%, rgba(6,10,8,.55) 30%, rgba(6,10,8,0) 48%)' },
	// wide, the title on the left: an X Article's cover, and the blog's header on a wide screen (so drawn at twice
	// X's 1500×600, to stay sharp across a whole screen)
	{ tag: '5x2', w: 3000, h: 1200, unit: 1.2, left: 120, top: 96, width: '46%', shade: 'linear-gradient(100deg, rgba(6,10,8,.86) 0%, rgba(6,10,8,.6) 38%, rgba(6,10,8,0) 58%)' },
	{ tag: '1x1', w: 1080, h: 1080, unit: 0.8, left: 64, top: 60, width: 'auto', shade: 'linear-gradient(to bottom, rgba(6,10,8,.86) 0%, rgba(6,10,8,.5) 34%, rgba(6,10,8,0) 52%)' }
];
const LOW = (u) => `linear-gradient(to top, rgba(6,10,8,.9) 0%, rgba(6,10,8,.62) 30%, rgba(6,10,8,0) ${u}%)`;

const image = (f) => `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,` + readFileSync(f).toString('base64');
const font = 'data:font/woff2;base64,' + readFileSync('node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2').toString('base64');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
async function draw(s, hook) {
	const u = (px) => `${Math.round(px * s.unit)}px`;
	const low = place[s.tag] === 'bottom';
	const top = hook ? (HOOK_TOP[s.tag] ?? s.top) : s.top;
	const shade = low ? LOW(s.tag === '9x16' ? 50 : 62) : s.shade;
	const bg = hook ? '' : image(fromVault(frames[s.tag] ?? frame));
	await page.setViewport({ width: s.w, height: s.h });
	await page.setContent(`<!doctype html><html><head><style>
@font-face { font-family: F; src: url(${font}) format('woff2'); font-weight: 100 900; }
html,body{margin:0;width:${s.w}px;height:${s.h}px;overflow:hidden;background:${hook ? 'transparent' : '#111'}}
.bg{position:absolute;inset:0;background:url(${bg}) center/cover;filter:saturate(1.12) contrast(1.08)}
.shade{position:absolute;inset:0;background:${shade}}
.t{position:absolute;left:${s.left}px;${low ? `bottom:${Math.round(s.top * 1.9)}px;right:${s.left}px` : `top:${top}px`};width:${width[s.tag] ?? s.width};color:#fff;font-family:F,serif;text-shadow:0 4px 18px rgba(0,0,0,.55),0 2px 3px rgba(0,0,0,.45)}
.k{font-weight:760;font-size:${u(50)};letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.94)}
.n{font-weight:860;font-size:${u(172)};line-height:.9;letter-spacing:-.03em;color:#f6c75a;margin-top:${u(8)}}
.h{font-weight:830;font-size:${u(138)};line-height:.92;letter-spacing:-.025em;margin-top:${u(6)}}
.x{font-weight:560;font-style:italic;font-size:${u(58)};line-height:1.12;margin-top:${u(22)};color:#fff}
.x b{font-style:normal;font-weight:820;color:#f6c75a}
.d{position:absolute;right:${s.left}px;bottom:${Math.round(s.top * 0.8)}px;padding:${u(8)} ${u(20)} ${u(10)};border:${u(4)} solid #f6c75a;border-radius:${u(12)};background:rgba(6,10,8,.62);color:#fff;font-family:F,serif;font-weight:820;font-size:${u(46)};line-height:1;letter-spacing:.1em}
</style></head><body>${hook ? '' : '<div class="bg"></div>'}<div class="shade"></div>
<div class="t"><div class="k">${TITLE.kicker}</div><div class="n">${TITLE.big}</div><div class="h">${TITLE.line}</div><div class="x">${TITLE.after}</div></div>
${!hook && Number.isFinite(day) ? `<div class="d">DAY ${String(day).padStart(2, "0")}</div>` : ''}
</body></html>`, { waitUntil: 'load' });
	await page.evaluate(() => document.fonts.ready);
	const out = join(dir, hook ? `hook-${s.tag}.png` : `thumbnail-${s.tag}.jpg`);
	await page.screenshot(hook ? { path: out, type: 'png', omitBackground: true } : { path: out, type: 'jpeg', quality: 92 });
}
/**
 * The split card: the old world against the new, the title in two halves — "split": { "old": <hash>, "new": <hash> },
 * "title": { "old": "Every city on earth is built wrong.", "new": "This is what starting over looks like." }. The old
 * half cold and grey, the new warm; side by side in a wide card, stacked in a square or tall one. The last words of
 * each half set big (the old in white, the new in gold); the day's badge on the new half.
 */
async function drawSplit(s) {
	const wide = s.w / s.h > 1.2;
	const u = (px) => `${Math.round(px * s.unit * (wide ? 0.82 : 0.95))}px`;
	const half = (side, img, part) => {
		const { kicker, big, after } = parts(part);
		return `<div class="half ${side}"><div class="bg" style="background-image:url(${image(fromVault(img))})"></div><div class="shade"></div>
<div class="t">${kicker ? `<div class="k">${kicker}</div>` : ''}<div class="n">${big}</div>${after ? `<div class="x">${after}</div>` : ''}</div></div>`;
	};
	await page.setViewport({ width: s.w, height: s.h });
	await page.setContent(`<!doctype html><html><head><style>
@font-face { font-family: F; src: url(${font}) format('woff2'); font-weight: 100 900; }
html,body{margin:0;width:${s.w}px;height:${s.h}px;overflow:hidden;background:#111;font-family:F,serif}
.wrap{display:flex;flex-direction:${wide ? 'row' : 'column'};width:100%;height:100%}
.half{position:relative;flex:1;overflow:hidden}
.bg{position:absolute;inset:0;background-size:cover;background-position:center}
.old .bg{filter:grayscale(.85) contrast(1.05) brightness(.8)}
.new .bg{filter:saturate(1.2) contrast(1.08)}
.shade{position:absolute;inset:0}
.old .shade{background:linear-gradient(${wide ? 'to bottom' : 'to bottom'}, rgba(10,12,14,.82) 0%, rgba(10,12,14,.35) 55%, rgba(10,12,14,.15) 100%)}
.new .shade{background:linear-gradient(to bottom, rgba(6,10,8,.82) 0%, rgba(6,10,8,.3) 55%, rgba(6,10,8,0) 100%)}
.x{font-weight:620;font-style:italic;font-size:${u(62)};line-height:1.1;margin-top:${u(14)}}
.t{position:absolute;left:${u(64)};right:${u(64)};top:${u(wide ? 110 : 70)};color:#fff;text-shadow:0 4px 18px rgba(0,0,0,.6),0 2px 3px rgba(0,0,0,.45)}
.k{font-weight:780;font-size:${u(58)};line-height:1.05;letter-spacing:-.01em}
.n{font-weight:880;font-size:${u(150)};line-height:.9;letter-spacing:-.03em;margin-top:${u(10)}}
.old .n{color:#fff}
.new .n{color:#f6c75a}
.seam{position:absolute;${wide ? `top:0;bottom:0;left:calc(50% - ${u(4)});width:${u(8)}` : `left:0;right:0;top:calc(50% - ${u(4)});height:${u(8)}`};background:#f6c75a;box-shadow:0 0 30px rgba(0,0,0,.5)}
.d{position:absolute;right:${u(56)};bottom:${u(48)};padding:${u(8)} ${u(20)} ${u(10)};border:${u(4)} solid #f6c75a;border-radius:${u(12)};background:rgba(6,10,8,.62);color:#fff;font-weight:820;font-size:${u(46)};line-height:1;letter-spacing:.1em}
</style></head><body><div class="wrap">${half('old', settings.split.old, TITLE.old)}${half('new', settings.split.new, TITLE.new)}</div>
<div class="seam"></div>${Number.isFinite(day) ? `<div class="d">DAY ${String(day).padStart(2, '0')}</div>` : ''}
</body></html>`, { waitUntil: 'load' });
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: join(dir, `thumbnail-${s.tag}.jpg`), type: 'jpeg', quality: 92 });
}
// a half's words: { kicker, big, after } as given, or a plain line whose last two words are set big
function parts(v) {
	if (v && typeof v === 'object') return v;
	const words = String(v).trim().split(/\s+/);
	const n = words.length > 4 ? 2 : 1;
	return { kicker: words.slice(0, -n).join(' '), big: words.slice(-n).join(' ') };
}

if (settings.split) {
	for (const s of SHAPES.filter((x) => !only || only.includes(x.tag))) await drawSplit(s);
} else {
	for (const s of SHAPES.filter((x) => !only || only.includes(x.tag))) await draw(s, false);
	// the hook layers, for the shapes a film is delivered in (not the X Article's cover)
	for (const s of SHAPES.filter((x) => x.tag !== '5x2')) await draw(s, true);
}
await browser.close();

// into the vault, each in its place; their hashes back into thumbnail.json
const DAY = `Day ${String(day).padStart(2, '0')}`;
const hookLine = ['kicker', 'big', 'line', 'after', 'old', 'new'].map((k) => (TITLE[k] && typeof TITLE[k] === 'object' ? Object.values(TITLE[k]).join(' ') : TITLE[k] ?? '')).join(' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const put = async (file, role, shape, isPublic, replaces) =>
	(await add(file, { title: `${DAY} · ${role === 'hook' ? 'hook layer' : 'title card'} ${shape.replace('x', ':')}`, description: hookLine,
		tags: [DAY, `role:${role}`, `shape:${shape}`], public: isPublic, ...(replaces ? { replaces: [replaces] } : {}) })).hash;
const before = { ...(settings.cards ?? {}), ...Object.fromEntries(Object.entries(settings.hooks ?? {}).map(([k, v]) => [`hook-${k}`, v])) };
settings.cards = {};
settings.hooks = {};
for (const f of readdirSync(dir)) {
	const [, kind, shape] = /^(thumbnail|hook)-(\d+x\d+)\./.exec(f) ?? [];
	if (!kind) continue;
	const hash = await put(join(dir, f), kind === 'hook' ? 'hook' : 'thumbnail', shape, kind !== 'hook', before[kind === 'hook' ? `hook-${shape}` : shape]);
	(kind === 'hook' ? settings.hooks : settings.cards)[shape] = hash;
	console.log(`${kind === 'hook' ? 'hook layer' : 'title card'} ${shape} → ${hash}`);
}
writeFileSync(config, JSON.stringify(settings, null, 2) + '\n');
// the film's title-card marker names them too (its meta, merged), for the render and the studio
if (settings.marker) await describe(bare(settings.marker), { meta: { cards: settings.cards, hooks: settings.hooks } });
// the day's article and posts named the cards before: they name the new ones now
const dayDir = join(config, '..');
for (const f of ['post.md', 'derivatives.json']) {
	let text;
	try {
		text = readFileSync(join(dayDir, f), 'utf8');
	} catch {
		continue;
	}
	for (const [k, old] of Object.entries(before)) {
		const now = k.startsWith('hook-') ? settings.hooks[k.slice(5)] : settings.cards[k];
		if (old && now && old !== now) text = text.replaceAll(old, now);
	}
	writeFileSync(join(dayDir, f), text);
}
rmSync(dir, { recursive: true, force: true });
