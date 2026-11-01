#!/usr/bin/env node
// theOS's check command (aip-31df): serve theOS/, crawl every state a person can reach from an HTML entry page, and run
// the docs check (docs-check.mjs) on each, at 390x844 and 1280x720; --fixtures runs the check's own test pages instead.
// Exits 1 when a state fails, 2 when the check itself could not run.
// Usage: node theOS/avenCEO/checks/check.mjs [--root <theOS dir>] [--entry <page under the root>] [--out <dir>] [--fixtures]
import { createServer } from 'node:http';
import { createRequire, Module } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsCheck } from './docs-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 720 }];
const WORKERS = 3; // pages per size, sharing one queue
const LIMIT = 300; // seconds: c4, the check finishes in under 5 minutes or it is red
const MOST = 5000; // states per size: more means a route shows new text each time (a clock), and the crawl would not end

function args(argv) {
  const o = { root: resolve(HERE, '../..'), entry: null, out: join(HERE, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fixtures') { o.fixtures = true; continue; }
    if (k === '--help' || k === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 5).join('\n')); process.exit(0); }
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
// and its visible, enabled buttons, each named by its place among them and its markup. window.__buttons is installed in every
// page, next to countFetches.
function pageButtons() {
  const seen = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && !el.closest('[inert]');
  window.__buttons = () => [...document.querySelectorAll('button, [role="button"]')].filter(seen);
}
async function actions(page, origin) {
  const { hrefs, buttons } = await page.evaluate(() => {
    // getAttribute, not .href: a link inside an SVG has no string href.
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => { try { return new URL(a.getAttribute('href'), document.baseURI).href; } catch { return null; } });
    const buttons = window.__buttons().map((b, i) => ({ i, html: b.outerHTML, kind: window.__kind(b) }));
    return { hrefs, buttons };
  });
  const links = [...new Set(hrefs)].filter((h) => {
    const u = h && new URL(h);
    return u?.origin === origin && (/\.html$/.test(u.pathname) || u.pathname.endsWith('/'));
  });
  return { links, buttons };
}

// A state is a route and what it shows: the same URL with the same rendered text and the same view is one state.
const keyOf = async (page) => `${page.url()}\n${await page.evaluate(() => `${document.body?.innerText ?? ''}\n${window.__view()}`)}`;

// A view type: which boxes the page renders, whatever their text, each named by element and classes. All decision pages
// are one view type, unless one of them shows a part the others don't. Only boxes count (an element that isn't inline),
// since they make the layout; inline text styling doesn't. A button's kind adds the names of its data attributes, so a
// tab (data-tab) isn't taken for a plain button. Installed in every page, next to countFetches.
function pageView() {
  window.__kind = (e) => e.tagName.toLowerCase() + [...e.classList].sort().map((c) => `.${c}`).join('')
    + Object.keys(e.dataset).sort().map((k) => `[${k}]`).join('');
  window.__view = () => [...new Set([...document.querySelectorAll('body *')]
    .filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'inline')
    .map((e) => e.tagName.toLowerCase() + [...e.classList].sort().map((c) => `.${c}`).join('')))].sort().join(' ');
}

// Bring the page to a state: its URL, then its buttons pressed again. Returns the key it reached, or null when a button
// is gone. When the page is on that document, only the hash changes, which is much faster; an app can keep something
// open across a hash change, so this is tried only when the state to reach is known (and then checked against it) or
// no button was pressed since the page was loaded; otherwise, or when it misses, the URL is loaded afresh.
async function reach(page, { url, clicks }, expect) {
  const now = page.url();
  if ((page.clean || expect) && !clicks.length && new URL(url).hash && now !== url && now.split('#')[0] === url.split('#')[0]) {
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
  const ok = await page.evaluate((b) => {
    const all = window.__buttons();
    const el = all[b.i]?.outerHTML === b.html ? all[b.i] : all.find((x) => x.outerHTML === b.html);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); // SVG has no .click()
    return true;
  }, b);
  if (ok) { page.clean = false; await settle(page); }
  return ok;
}

// Every state a person can reach from the entry page at one size, by following links and pressing buttons, each checked
// by the docs check when first reached. Buttons are pressed only in the first state of each view type, one of each kind:
// a first version, for speed (d-5afb); a state behind one of several buttons of the same kind can be missed.
async function crawl(browser, size, start, origin, out) {
  const context = await browser.newContext({ viewport: size });
  for (const f of [countFetches, pageButtons, pageView]) await context.addInitScript(f);
  context.on('page', async (p) => { if (await p.opener()) await p.close(); }); // a link or button that opens a new tab
  const states = [], keys = new Set(), views = new Set(), queue = [], loaded = new Set();
  // A new state is checked and kept, and its links are queued; when its view type is new, it is queued to have its
  // buttons pressed too.
  const found = async (page, recipe) => {
    const key = await keyOf(page);
    if (keys.has(key) || !page.url().startsWith(origin)) return key;
    if (states.length >= MOST) throw new Error(`more than ${MOST} states at ${size.width}x${size.height}; the last at ${page.url()}: does a route show new text each time?`);
    keys.add(key);
    const state = { size: `${size.width}x${size.height}`, url: page.url().slice(origin.length + 1), recipe, key, fails: await page.evaluate(docsCheck) };
    states.push(state); // its number, read right after with no await between, names its screenshot: parallel pages mustn't share one
    // A screenshot of the state as a person sees it in the window; settle() waited for document.fonts.ready.
    state.shot = join('shots', state.size, `${String(states.length).padStart(4, '0')}.png`);
    // A failed screenshot doesn't stop the check: the state's verdict stands without it.
    await page.screenshot({ path: join(out, state.shot) }).catch(() => { state.shot = null; });
    for (const l of (await actions(page, origin)).links) if (!loaded.has(l)) { loaded.add(l); queue.push({ visit: l }); }
    const view = await page.evaluate(() => window.__view());
    if (!views.has(view)) { views.add(view); queue.push({ state }); }
    return key;
  };
  const open = async () => {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    return page;
  };
  const pages = await Promise.all(Array.from({ length: WORKERS }, open));
  loaded.add(start);
  queue.push({ visit: start });
  let busy = 0;
  const work = async (page) => {
    for (;;) {
      const job = queue.shift();
      if (!job) { if (!busy) break; await new Promise((r) => setTimeout(r, 50)); continue; }
      busy++;
      try {
        if (job.visit) {
          await reach(page, { url: job.visit, clicks: [] });
          loaded.add(page.url());
          await found(page, { url: page.url(), clicks: [] });
          continue;
        }
        const { state } = job;
        // A route followed in place can show what its URL loaded afresh doesn't (the app kept something open): that
        // state is checked but can't be brought back, so its buttons aren't pressed; what the URL shows is a state too.
        if ((await reach(page, state.recipe, state.key)) !== state.key) { state.inPlaceOnly = true; await found(page, { url: page.url(), clicks: [] }); continue; }
        const here = origin + '/' + state.url;
        let moved = false;
        const kinds = new Set(); // one button of each kind (window.__kind): the others of its kind lead to the same view types
        for (const b of (await actions(page, origin)).buttons) {
          if (kinds.has(b.kind)) continue;
          kinds.add(b.kind);
          if (moved && (await reach(page, state.recipe, state.key)) !== state.key) break;
          moved = false;
          if (!(await press(page, b))) continue;
          const recipe = page.url() !== here ? { url: page.url(), clicks: [] } : { ...state.recipe, clicks: [...state.recipe.clicks, b] };
          moved = (await found(page, recipe)) !== state.key;
        }
      } finally { busy--; }
    }
  };
  const tick = setInterval(() => console.error(`${size.width}x${size.height}: ${states.length} states, ${views.size} view types, ${queue.length} to do`), 15000);
  await Promise.all(pages.map(work));
  clearInterval(tick);
  await context.close();
  return { states, views: views.size };
}

// Crawl from one entry page at both sizes; write the report and a screenshot of every state to out/; print what
// failed. Returns the report.
async function run(browser, origin, root, entry, out) {
  const t0 = Date.now();
  rmSync(join(out, 'shots'), { recursive: true, force: true });
  const runs = await Promise.all(SIZES.map((s) => crawl(browser, s, `${origin}/${entry}`, origin, out)));
  const states = runs.flatMap((r) => r.states), failed = states.filter((s) => s.fails.length);
  const results = states.map(({ size, url, recipe, fails, shot, inPlaceOnly }) => ({ size, url, clicks: recipe.clicks.map((b) => b.html.slice(0, 120)), shot, fails, ...(inPlaceOnly && { inPlaceOnly }) }));
  const report = { root, entry, seconds: Math.round((Date.now() - t0) / 1000), reached: states.length, views: runs.reduce((n, r) => n + r.views, 0), failed: failed.length, results };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const s of failed) for (const f of s.fails) console.log(`FAIL ${s.size} ${s.url}${s.recipe.clicks.length ? ` after ${s.recipe.clicks.length} button(s)` : ''}\n  ${f.rule}: ${f.where} (content ${f.content}px, box ${f.box}px, overflow ${f.overflow})`);
  return report;
}

async function main() {
  const t0 = Date.now(); // c4 times the whole command: start-up, the browser and the crawl
  const o = args(process.argv.slice(2));
  const { pw, version } = playwright();
  const server = await serve(o.root);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await pw.chromium.launch();
  try {
    if (o.fixtures) {
      // The check's own test: each page in fixtures/ says in <meta name="expect"> whether the check must be red or green.
      let wrong = 0;
      for (const f of readdirSync(join(HERE, 'fixtures')).filter((x) => x.endsWith('.html')).sort()) {
        // red-after-click: red, and only in states reached by pressing a button that kept the route (one that changes the
        // route is recorded like a link).
        const expect = /<meta name="expect" content="(red|green|red-after-click)">/.exec(readFileSync(join(HERE, 'fixtures', f), 'utf8'))?.[1];
        const r = await run(browser, origin, o.root, `avenCEO/checks/fixtures/${f}`, join(o.out, 'fixtures', f));
        const bad = r.results.filter((x) => x.fails.length);
        const got = !bad.length ? 'green' : bad.every((x) => x.clicks.length) ? 'red-after-click' : 'red';
        if (got !== expect) wrong++;
        console.log(`${got === expect ? 'ok' : 'WRONG'} ${f}: ${got}, expected ${expect ?? 'nothing (no meta)'}`);
      }
      console.log(`${wrong ? 'red' : 'green'}: the check's own test, ${wrong} wrong`);
      process.exitCode = wrong ? 1 : 0;
      return;
    }
    const r = await run(browser, origin, o.root, o.entry, o.out);
    r.seconds = Math.round((Date.now() - t0) / 1000);
    if (r.seconds >= LIMIT) console.log(`FAIL the check took ${r.seconds} s, at or over its limit of ${LIMIT} s (c4)`);
    console.log(`${r.failed ? 'red' : 'green'}: ${r.reached} states checked (${r.views} view types), ${r.failed} failed, in ${r.seconds} s with Playwright ${version}; report in ${join(o.out, 'report.json')}`);
    process.exitCode = r.failed || r.seconds >= LIMIT ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(2); });
