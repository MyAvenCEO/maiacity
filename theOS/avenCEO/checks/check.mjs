#!/usr/bin/env node
// theOS's check command (AIP-1): serve theOS/, crawl every state a person can reach from an HTML entry page, and run
// the docs check (docs-check.mjs) on each, at 390x844 and 1280x720. Exits 1 when a state fails, 2 when the check
// itself could not run. Usage: node theOS/avenCEO/checks/check.mjs [--root <theOS dir>] [--entry <page under the root>] [--out <dir>]
import { createServer } from 'node:http';
import { createRequire, Module } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsCheck } from './docs-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 720 }];
const WORKERS = 3; // pages per size, sharing one queue

function args(argv) {
  const o = { root: resolve(HERE, '../..'), entry: null, out: join(HERE, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 4).join('\n')); process.exit(0); }
    if (!['--root', '--entry', '--out'].includes(k) || argv[i + 1] === undefined) throw new Error(`unknown argument: ${k}`);
    const v = argv[++i];
    o[k.slice(2)] = k === '--entry' ? v : resolve(v);
  }
  // --entry is a page under the root. By default the dashboard, or the Docs app on commits that have no dashboard.
  o.entry ??= ['index.html', 'docs/index.html'].find((p) => existsSync(join(o.root, p)));
  if (!o.entry) throw new Error(`no entry page in ${o.root}`);
  return o;
}

// Playwright: the check's own theOS's (theOS/node_modules, pinned in theOS/package.json, as inside avenSANDBOX's image),
// else the session's global one; never the legacy repository's node_modules above theOS/, nor the replayed commit's.
function playwright(root = resolve(HERE, '../..')) {
  const req = createRequire(join(root, 'package.json'));
  const own = join(root, 'node_modules/playwright/package.json');
  const pkg = existsSync(own) ? own : req.resolve('playwright/package.json', { paths: Module.globalPaths });
  const version = JSON.parse(readFileSync(pkg, 'utf8')).version;
  const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies?.playwright;
  if (pinned && pinned !== version) console.error(`warning: Playwright ${version}, not the pinned ${pinned}: another Chromium can lay pages out differently`);
  return { pw: req(dirname(pkg)), version };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function serve(root) {
  const server = createServer((req, res) => {
    let path;
    try { path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))); } catch { res.writeHead(400).end(); return; }
    let file = path.startsWith(root + sep) || path === root ? path : null;
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file || !existsSync(file)) { res.writeHead(404).end(); return; }
    // Files don't change while the check runs: the browser keeps them, so a page loaded again doesn't fetch every doc again.
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=3600' }).end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// Counts the page's fetches until their bodies are read; installed in every page before its own scripts run.
function countFetches() {
  let n = 0;
  const track = (p) => { n++; return p.finally(() => { n--; }); };
  const f = window.fetch;
  window.fetch = function (...a) { return track(f.apply(this, a)); };
  for (const m of ['json', 'text', 'arrayBuffer', 'blob']) {
    const o = Response.prototype[m];
    Response.prototype[m] = function () { return track(o.call(this)); };
  }
  Object.defineProperty(window, '__fetching', { get: () => n });
}

// Wait until the page is still: fonts loaded, no fetch open and no change to the DOM for 50 ms (at most 5 s); then
// every animation that ends is moved to its end, which is what a person sees once it stops.
async function settle(page) {
  await page.evaluate(() => new Promise((done) => {
    let last = performance.now();
    const obs = new MutationObserver(() => { last = performance.now(); });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const t0 = performance.now();
    const poll = () => {
      const now = performance.now();
      if ((window.__fetching || now - last < 50) && now - t0 < 5000) { setTimeout(poll, 20); return; }
      obs.disconnect();
      for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations !== Infinity) a.finish();
      done();
    };
    document.fonts.ready.then(poll);
  }));
}

// What a person can act on in this state: the theOS pages its links lead to (an HTML page, or a hash route on one),
// and its visible, enabled buttons, each named by its place among them and its markup.
const SEEN = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && !el.closest('[inert]');
async function actions(page, origin) {
  const { hrefs, buttons } = await page.evaluate((seen) => {
    const visible = new Function(`return ${seen}`)();
    // getAttribute, not .href: a link inside an SVG has no string href.
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => { try { return new URL(a.getAttribute('href'), document.baseURI).href; } catch { return null; } });
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible).map((b, i) => ({ i, html: b.outerHTML }));
    return { hrefs, buttons };
  }, SEEN.toString());
  const links = [...new Set(hrefs)].filter((h) => {
    const u = h && new URL(h);
    return u?.origin === origin && (/\.html$/.test(u.pathname) || u.pathname.endsWith('/'));
  });
  return { links, buttons };
}

// A state is a route and what it shows: the same URL with the same rendered text is one state.
const keyOf = async (page) => `${page.url()}\n${await page.evaluate(() => document.body?.innerText ?? '')}`;

// Bring the page to a state: its URL, then its buttons pressed again. Returns the key it reached, or null when a button
// is gone. When the page is on that document and untouched by a button since it was loaded, only the hash changes,
// which is much faster; an app can still keep something open across a hash change, so when that doesn't reach the
// expected state, the URL is loaded afresh.
async function reach(page, { url, clicks }, expect) {
  const now = page.url();
  if (page.clean && !clicks.length && new URL(url).hash && now !== url && now.split('#')[0] === url.split('#')[0]) {
    await page.evaluate((h) => { location.hash = h; }, new URL(url).hash);
    await settle(page);
    const key = await keyOf(page);
    if (!expect || key === expect) return key;
  }
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'load' });
  page.clean = true;
  await settle(page);
  for (const b of clicks) if (!(await press(page, b))) return null;
  return keyOf(page);
}

async function press(page, b) {
  const ok = await page.evaluate(({ b, seen }) => {
    const visible = new Function(`return ${seen}`)();
    const all = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
    const el = all[b.i]?.outerHTML === b.html ? all[b.i] : all.find((x) => x.outerHTML === b.html);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); // SVG has no .click()
    return true;
  }, { b, seen: SEEN.toString() });
  if (ok) { page.clean = false; await settle(page); }
  return ok;
}

// Every state a person can reach from the entry page at one size, by following links and pressing buttons; the docs
// check runs on each state when it is first reached. A button is pressed once per route it shows on; a button that
// leads to another route is taken to lead there from every route of its page, and is pressed once per page.
async function crawl(browser, size, start, origin) {
  const context = await browser.newContext({ viewport: size });
  await context.addInitScript(countFetches);
  context.on('page', async (p) => { if (await p.opener()) await p.close(); }); // a link or button that opens a new tab
  const states = [], keys = new Map(), pressed = new Set(), queue = [], loaded = new Set();
  const doc = (url) => url.split('#')[0];
  // A new state is checked, kept and queued to be opened; with layoutOnly, a known one is checked again and kept only
  // when it fails, never opened (its key already is).
  const found = async (page, recipe, layoutOnly = false) => {
    const key = await keyOf(page);
    if ((keys.has(key) && !layoutOnly) || !page.url().startsWith(origin)) return key;
    const state = { size: `${size.width}x${size.height}`, url: page.url().slice(origin.length + 1), recipe, key, fails: await page.evaluate(docsCheck) };
    if (layoutOnly) { if (state.fails.length) states.push({ ...state, layoutOnly }); return key; }
    keys.set(key, state);
    states.push(state);
    queue.push(state);
    return key;
  };
  const visit = async (page, url) => {
    if (loaded.has(url)) return;
    loaded.add(url);
    await reach(page, { url, clicks: [] });
    loaded.add(page.url());
    await found(page, { url: page.url(), clicks: [] });
  };
  const open = async () => {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    return page;
  };
  const pages = await Promise.all(Array.from({ length: WORKERS }, open));
  await visit(pages[0], start);
  let busy = 0;
  const work = async (page) => {
    for (;;) {
      const state = queue.shift();
      if (!state) { if (!busy) break; await new Promise((r) => setTimeout(r, 50)); continue; }
      busy++;
      try {
        // A route followed in place can show what its URL loaded afresh doesn't (the app kept something open): that
        // state is checked but can't be brought back, so it isn't opened further; what the URL shows is a state too.
        if ((await reach(page, state.recipe, state.key)) !== state.key) { state.inPlaceOnly = true; await found(page, { url: page.url(), clicks: [] }); continue; }
        const { links, buttons } = await actions(page, origin);
        const here = origin + '/' + state.url;
        let moved = false;
        for (const b of buttons) {
          const sig = `${here}\n${b.html}`, pageSig = `${doc(here)}\n${b.html}`;
          if (pressed.has(sig) || pressed.has(pageSig)) continue;
          pressed.add(sig);
          if (moved && (await reach(page, state.recipe, state.key)) !== state.key) break;
          moved = false;
          if (!(await press(page, b))) continue;
          const route = page.url() !== here;
          if (route) pressed.add(pageSig);
          const recipe = route ? { url: page.url(), clicks: [] } : { ...state.recipe, clicks: [...state.recipe.clicks, b] };
          const key = await found(page, recipe);
          // A button can change only the layout (the same text): that view is checked too, and kept when it fails.
          if (key === state.key) await found(page, recipe, true);
          moved = key !== state.key;
        }
        for (const l of links) await visit(page, l);
      } finally { busy--; }
    }
  };
  const tick = setInterval(() => console.error(`${size.width}x${size.height}: ${states.length} states, ${queue.length} to open`), 15000);
  await Promise.all(pages.map(work));
  clearInterval(tick);
  await context.close();
  return states;
}

async function main() {
  const o = args(process.argv.slice(2));
  const { pw, version } = playwright();
  const server = await serve(o.root);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await pw.chromium.launch();
  const t0 = Date.now();
  try {
    const states = (await Promise.all(SIZES.map((s) => crawl(browser, s, `${origin}/${o.entry}`, origin)))).flat();
    const failed = states.filter((s) => s.fails.length);
    const results = states.map(({ size, url, recipe, fails, inPlaceOnly, layoutOnly }) => ({ size, url, clicks: recipe.clicks.map((b) => b.html.slice(0, 120)), fails, ...(inPlaceOnly && { inPlaceOnly }), ...(layoutOnly && { layoutOnly }) }));
    const report = { root: o.root, entry: o.entry, playwright: version, seconds: Math.round((Date.now() - t0) / 1000), states: states.length, failed: failed.length, results };
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, 'report.json'), JSON.stringify(report, null, 1));
    for (const s of SIZES.map((x) => `${x.width}x${x.height}`)) {
      const mine = states.filter((x) => x.size === s);
      console.log(`${s}: ${mine.length} states, ${mine.filter((x) => x.fails.length).length} failed`);
    }
    for (const s of failed) for (const f of s.fails) console.log(`FAIL ${s.size} ${s.url}${s.recipe.clicks.length ? ` after ${s.recipe.clicks.length} button(s)` : ''}\n  ${f.rule}: ${f.where} (content ${f.content}px, box ${f.box}px, overflow ${f.overflow})`);
    console.log(`${failed.length ? 'red' : 'green'}: ${states.length} states in ${report.seconds} s with Playwright ${version}; report in ${join(o.out, 'report.json')}`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(2); });
